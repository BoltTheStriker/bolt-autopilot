// Holder demo: wallets holding 1M+ $BOLT can try the bot with $10,000 of fake money, under
// their own rules (see demoEngine.ts). Accounts, the bot's shortlist ("pool") and each
// trader's return index live in one store. Off by default; switched on from the admin page.
import { createHash } from "node:crypto";
import type { CupEntry } from "./cup.ts";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { leverageOf, newPortfolio, portfolioValue, posValue, type LeadIndex, type PoolLead, type Portfolio, type Style } from "./demoEngine.ts";

export const BOLT = { policy: "14628c260a749e78e69e58acca32d0baa09808d50388c84fa7e1ae47", assetHex: "0014df10424f4c54", decimals: 6 };
export const DEMO = { minHolding: 1_000_000, startBalance: 10_000 };

/** `startIndex` is from the first version (followed the bot's paper equity); kept to migrate old accounts. */
export type DemoAccount = { stake: string; address: string; startedAt: number; startBalance: number; startIndex?: number; portfolio?: Portfolio; cup?: CupEntry };
/** Per-trader tracking for the return index: the last marks used to advance it. */
export type Track = {
  idx: number;
  lastFillMs: number;
  unrealized: number;
  accountValue: number;
  coverage: number;
  /** What the trader holds right now on markets Strike can copy (their size, their open profit). */
  open?: { coin: string; long: boolean; upnl: number }[];
};
export type DemoStore = { enabled: boolean; accounts: Record<string, DemoAccount>; pool?: PoolLead[]; track?: Record<string, Track> };

export const indexMap = (store: DemoStore): LeadIndex => Object.fromEntries(Object.entries(store.track ?? {}).map(([k, t]) => [k, t.idx]));

export function loadDemo(path: string): DemoStore {
  try {
    if (existsSync(path)) return { enabled: false, accounts: {}, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {}
  return { enabled: false, accounts: {} };
}

export function saveDemo(path: string, store: DemoStore) {
  writeFileSync(`${path}.tmp`, JSON.stringify(store));
  renameSync(`${path}.tmp`, path);
}

// ---------- bech32 (BIP-173), enough to read a Cardano address and write its stake address ----------

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
function polymod(values: number[]) {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
const hrpExpand = (hrp: string) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
function convert(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0, bits = 0;
  const out: number[] = [], max = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & max);
  else if (!pad && (bits >= from || ((acc << (to - bits)) & max))) return null;
  return out;
}

export function bech32Decode(s: string): { hrp: string; bytes: Uint8Array } | null {
  const str = s.toLowerCase();
  const pos = str.lastIndexOf("1");
  if (pos < 1 || pos + 7 > str.length) return null;
  const hrp = str.slice(0, pos);
  const data = [...str.slice(pos + 1)].map((c) => CHARSET.indexOf(c));
  if (data.some((d) => d < 0) || polymod([...hrpExpand(hrp), ...data]) !== 1) return null;
  const bytes = convert(data.slice(0, -6), 5, 8, false);
  return bytes ? { hrp, bytes: Uint8Array.from(bytes) } : null;
}

export function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const data = convert([...bytes], 8, 5, true)!;
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31);
  return hrp + "1" + [...data, ...checksum].map((d) => CHARSET[d]).join("");
}

/** The stake address (stake1…) of a mainnet base address, or null (enterprise/pointer/other). */
export function stakeAddressOf(addr: string): string | null {
  const d = bech32Decode(addr);
  if (!d || d.hrp !== "addr" || d.bytes.length !== 57) return null;
  const type = d.bytes[0] >> 4;
  if (type > 3) return null; // only base addresses carry a stake credential
  const scriptStake = type === 1 || type === 3;
  const header = (scriptStake ? 0xf0 : 0xe0) | (d.bytes[0] & 0x0f);
  return bech32Encode("stake", Uint8Array.from([header, ...d.bytes.slice(29)]));
}

// ---------- holdings ----------

const KOIOS = "https://api.koios.rest/api/v1";
const filter = `policy_id=eq.${BOLT.policy}&asset_name=eq.${BOLT.assetHex}`;

/** $BOLT held by the whole wallet (every address under its stake key), or by the one address. */
export async function boltHeld(address: string): Promise<{ stake: string | null; held: number }> {
  const stake = stakeAddressOf(address);
  const [path, body] = stake ? ["account_assets", { _stake_addresses: [stake] }] : ["address_assets", { _addresses: [address] }];
  const res = await fetch(`${KOIOS}/${path}?${filter}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Couldn't read the wallet (${res.status})`);
  const rows = (await res.json()) as { quantity?: string }[];
  const raw = rows.reduce((t, r) => t + Number(r.quantity ?? 0), 0);
  return { stake, held: raw / 10 ** BOLT.decimals };
}

// ---------- share cards ----------

/** Short public id for a demo account's share card (doesn't reveal the wallet). */
export const cardId = (key: string) => createHash("sha256").update(`bolt-demo:${key}`).digest("hex").slice(0, 12);

export type DemoCard = { startedAt: number; startBalance: number; value: number; pnl: number; pct: number; traders: number; style: Style; leverage: number };

/** The numbers on a share card, from the holder's own portfolio. */
export function demoCard(store: DemoStore, id: string): DemoCard | null {
  const account = Object.values(store.accounts).find((a) => cardId(a.stake) === id);
  if (!account?.portfolio) return null;
  const value = portfolioValue(account.portfolio, indexMap(store));
  const pnl = value - account.startBalance;
  return { startedAt: account.startedAt, startBalance: account.startBalance, value, pnl, pct: pnl / account.startBalance, traders: account.portfolio.positions.length, style: account.portfolio.settings.style, leverage: leverageOf(account.portfolio.settings) };
}

// ---------- what the site sees ----------

/** A portfolio as the demo page shows it. */
export function summarize(account: DemoAccount, idx: LeadIndex, track: Record<string, Track> = {}) {
  const pf = account.portfolio!;
  const value = portfolioValue(pf, idx);
  const position = (p: Portfolio["positions"][number]) => {
    const lev = leverageOf(pf.settings);
    const v = posValue(p, idx, lev);
    const tr = track[p.lead];
    // A fixed-ratio copy holds (our value ÷ their account) of each trade, for the share Strike can copy, times the leverage.
    const ratio = tr && tr.accountValue > 0 ? (v / tr.accountValue) * tr.coverage * lev : 0;
    return {
      lead: p.lead,
      cost: p.cost,
      value: v,
      pnl: v - p.cost,
      openedAt: p.openedAt,
      open: tr?.open ? tr.open.map((o) => ({ market: o.coin, long: o.long, pnl: ratio * o.upnl })) : null,
    };
  };
  return {
    startedAt: account.startedAt,
    startBalance: account.startBalance,
    value,
    pnl: value - account.startBalance,
    cash: pf.cash,
    banked: pf.banked,
    settings: pf.settings,
    positions: pf.positions.map(position),
    decisions: pf.decisions.slice(0, 30),
    cup: account.cup ?? null,
    history: pf.history,
  };
}
export type DemoSummary = ReturnType<typeof summarize>;

export type DemoView =
  | { enabled: boolean; status: "locked"; held: number; min: number }
  | { enabled: boolean; status: "ready"; held: number; min: number; startBalance: number }
  | { enabled: boolean; status: "active"; held: number; min: number; demo: DemoSummary; cardId: string };

export function demoView(store: DemoStore, key: string, held: number): DemoView {
  const base = { enabled: store.enabled, held, min: DEMO.minHolding };
  if (held < DEMO.minHolding) return { ...base, status: "locked" };
  const account = store.accounts[key];
  return account?.portfolio
    ? { ...base, status: "active", demo: summarize(account, indexMap(store), store.track), cardId: cardId(key) }
    : { ...base, status: "ready", startBalance: DEMO.startBalance };
}

/** Start a demo account (idempotent: an existing one is kept as is). */
export function startDemo(store: DemoStore, key: string, address: string, now: number): DemoAccount {
  return (store.accounts[key] ??= { stake: key, address, startedAt: now, startBalance: DEMO.startBalance, portfolio: newPortfolio(DEMO.startBalance, now) });
}

/** Start a demo over: fresh $10K and an empty log, same rules. The share-card id stays (it's the wallet's). */
export function resetDemo(a: DemoAccount, now: number, why = "Started fresh"): void {
  const settings = a.portfolio?.settings;
  a.startedAt = now;
  a.startBalance = DEMO.startBalance;
  delete a.startIndex;
  a.portfolio = newPortfolio(DEMO.startBalance, now, settings);
  a.portfolio.decisions[0].text = `${why} with ${DEMO.startBalance.toLocaleString("en-US", { style: "currency", currency: "USD" })}.`;
  // A cup entry that hasn't started keeps its place; its start value is taken when the cup begins.
  if (a.cup && a.cup.startValue !== undefined) delete a.cup;
}

/** First-version accounts (no portfolio): carry their value over at the bot's equity now, with default settings. */
export function migrateAccounts(store: DemoStore, botEquity: number, now: number) {
  for (const a of Object.values(store.accounts)) {
    if (a.portfolio) continue;
    const value = a.startIndex && a.startIndex > 0 ? (a.startBalance * botEquity) / a.startIndex : a.startBalance;
    a.portfolio = newPortfolio(value, now);
    a.portfolio.decisions[0].text = `Upgraded to your own rules with $${value.toFixed(2)}.`;
  }
}
