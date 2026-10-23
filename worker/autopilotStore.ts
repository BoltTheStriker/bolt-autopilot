// Autopilot users: who connected, their Strike account, their trading key (encrypted), their
// rules, and the copies the bot runs for them. Saved to the Railway volume like the demo.
//
// Trading keys: generated on the server during connect (the bot trades 24/7, after the user
// closes the page), encrypted at rest with AES-256-GCM under AUTOPILOT_SECRET. A Strike API
// wallet can trade but can never withdraw: withdrawals need the user's own wallet signature.

import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { describeRules, type AutoRules } from "./autopilot.ts";
import type { DecisionRecord, Drops, Tuned } from "./autotune.ts";

export type Mode = "off" | "on" | "autopilot"; // on = runs the user's rules; autopilot = the copilot may also adjust them within limits
export type AutoUser = {
  stake: string; // key: the wallet's stake address (or payment address if none)
  address: string;
  accountId: string;
  apiPublicKey: string;
  apiPrivateKeyEnc: string; // AES-256-GCM: iv.tag.ciphertext (hex)
  network: "testnet" | "mainnet";
  createdAt: number;
  rules: AutoRules | null; // null until the user (or copilot) sets them
  mode: Mode;
  managed: Record<string, string>; // lead → subscription id the bot created for this user
  log: { at: number; text: string }[];
  sessions: { hash: string; until: number }[];
  dayStart?: { day: string; pnl: number };
  /** Copies running for this user at the last sync, with profit, for their page. */
  copies?: { lead: string; amount: number; pnl: number; isolated?: boolean; positions: { market: string; long: boolean; pnl: number }[] }[];
  pending?: Record<string, string>; // lead → request id while Strike sets up an isolated copy
  subs?: string[]; // copy sub-accounts the bot created for this user (Strike leaves money there when a copy ends)
  cooldown?: Record<string, number>; // lead → until when not to retry after Strike refused a copy
  volume?: Record<string, { usd: number; orders: number }>; // subscription id → traded volume (kept after the copy ends)
  haltedDay?: string; // daily loss limit hit on this UTC day
  shareId?: string; // 12 hex: the public result card's id, made when the user first shares
  idle?: string; // why the bot is on but copies nothing yet (shown on the dashboard); unset once copies run
  // Autopilot mode (autotune.ts): rules it runs with now (inside the user's own), traders it set aside, review pacing.
  tuned?: Tuned;
  drops?: Drops;
  reviewedAt?: number;
  reviews?: { day: string; n: number };
  decisions?: DecisionRecord[]; // Autopilot's reviews, newest first
  run?: { since: number; closed: number }; // since Start: when, and the profit of copies that already ended
  skipsTold?: string[]; // Strike's failed copy orders already shown in the activity feed
  fundsTold?: string; // the "not enough free balance" notice already shown (free dollars:copy size), so it isn't repeated
  repick?: boolean; // the rules just changed: the next sync picks traders fresh
  flows?: { netIn: number; at: number }; // money put into the Strike account minus taken out (deposits, withdrawals, transfers)
  worth?: { usd: number; at: number }; // everything on Strike when the user last opened the app (for the share card's profit)
  note?: string; // why the bot runs fewer copies than the rules ask for (null when it doesn't)
  /** Profit on the running copies at each sync (for the dashboard's chart), newest last, at most 1,000. */
  history?: { at: number; pnl: number; working: number }[];
  lastSyncAt?: number;
  lastError?: string;
};
export type AutoStore = { users: Record<string, AutoUser> };

export function loadAutoStore(path: string): AutoStore {
  try {
    if (existsSync(path)) return { users: {}, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {}
  return { users: {} };
}
export function saveAutoStore(path: string, store: AutoStore) {
  writeFileSync(`${path}.tmp`, JSON.stringify(store));
  renameSync(`${path}.tmp`, path);
}

// ---------- trading keys ----------

/** A fresh Ed25519 key pair as raw hex (32-byte seed, 32-byte public key), like Strike's API wallets. */
export function newApiKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(16).toString("hex");
  return { publicKey: pub, privateKey: seed };
}

/** The public key a seed belongs to (to check a stored key decrypts to the right one). */
export function publicKeyOf(seedHex: string): string {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seedHex, "hex")]);
  return createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }).subarray(12).toString("hex");
}

const secretKey = (secret: string) => createHash("sha256").update(secret).digest(); // any length secret → 32 bytes

export function encrypt(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secretKey(secret), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv.toString("hex"), c.getAuthTag().toString("hex"), body.toString("hex")].join(".");
}
export function decrypt(enc: string, secret: string): string {
  const [iv, tag, body] = enc.split(".");
  const d = createDecipheriv("aes-256-gcm", secretKey(secret), Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(body, "hex")), d.final()]).toString("utf8");
}

// ---------- sessions (so only the wallet owner can change their bot) ----------

const SESSION_DAYS = 30;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new session for a user; returns the token for the browser (only its hash is stored). */
export function newSession(u: AutoUser, now: number): string {
  const token = randomBytes(32).toString("hex");
  u.sessions = [...u.sessions.filter((s) => s.until > now), { hash: hash(token), until: now + SESSION_DAYS * 86_400_000 }].slice(-5);
  return token;
}
export function checkSession(u: AutoUser | undefined, token: string, now: number): boolean {
  if (!u || !token) return false;
  const h = hash(token);
  return u.sessions.some((s) => s.hash === h && s.until > now);
}

export function logUser(u: AutoUser, now: number, text: string) {
  u.log = [{ at: now, text }, ...u.log].slice(0, 100);
}

/** At most n points, evenly spread, the newest kept. */
function thin<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  const step = xs.length / n;
  return [...Array.from({ length: n - 1 }, (_, i) => xs[Math.floor(i * step)]), xs[xs.length - 1]];
}

/** What the user's own page may show: never the keys or session hashes. */
export function publicUser(u: AutoUser) {
  return { address: u.address, accountId: u.accountId, network: u.network, createdAt: u.createdAt, rules: u.rules, mode: u.mode, copies: u.copies ?? [], log: u.log.slice(0, 40), lastSyncAt: u.lastSyncAt, lastError: u.lastError, idle: u.idle ?? null,
    // What Autopilot runs with right now, when it changed something (always inside the user's rules).
    autopilot: u.tuned ? { rulesText: describeRules(u.tuned.rules), reason: u.tuned.reason, at: u.tuned.at } : null, reviewedAt: u.reviewedAt ?? null,
    history: thin(u.history ?? [], 300), decisions: (u.decisions ?? []).slice(0, 10), run: u.run ?? null, netIn: u.flows?.netIn ?? null, note: u.note ?? null };
}
