// Browser side of Bolt Autopilot: talks to the bot server's /autopilot routes.
import { useEffect, useState } from "react";
import { site } from "@/lib/config";
import type { AutoRules, LiveMark, PreviewTrader } from "@/worker/autopilot";

export type AutoMode = "off" | "on" | "autopilot";
export type AutoCopy = { lead: string; amount: number; pnl: number; isolated?: boolean; positions: { market: string; long: boolean; pnl?: number }[] };
export type AutoUserView = {
  address: string;
  accountId: string;
  network: "testnet" | "mainnet";
  createdAt: number;
  rules: AutoRules | null;
  mode: AutoMode;
  copies: AutoCopy[];
  log: { at: number; text: string }[];
  lastSyncAt?: number;
  lastError?: string;
  idle?: string | null; // why the bot is on but copies nothing yet
  autopilot?: { rulesText: string; reason: string; at: number } | null; // what Autopilot runs with, when it changed something
  reviewedAt?: number | null; // Autopilot's last check
  history?: { at: number; pnl: number; working: number }[]; // profit on the running copies at each sync
};
export type AutoMe = {
  user: AutoUserView;
  balance: { wallet: number; available: number; equity?: number } | null; // equity: main account incl. copies from it
  earn?: { value: number; pnl: number } | null; // the user's SLP position
  realfi?: { custody: number; pledged: number; debtUsd: number; headroomUsd: number; health: number | null } | null; // sUSDrf on Strike
  /** Latest deposits/withdrawals with Strike's status: pending (not credited yet) → pending_settlement (credited) → settled. */
  parked?: number; // USD left in older copies' sub-accounts (reused by the next copy, or moved back on withdraw)
  parkedSubs?: { id: string; available: number }[];
  transfers?: { type: "deposit" | "withdraw"; status: string; usd: number; asset: string; assetAmount: number; txHash: string | null; at: number | null }[];
  maxBudgetUsd: number;
  rulesText: string | null;
};
/** Strike's SLP vault: where Borrow & Earn credit goes (including RealFi sUSDrf-backed lines). */
export type SlpInfo = {
  name: string;
  apr: number;
  equity: number;
  sharePrice: number;
  lockupDays: number;
  minDeposit: number;
  depositors: number;
  feeBps: number;
  /** RealFi's sUSDrf as Borrow & Earn collateral (yield measured by Strike over 28 days). */
  susdrf: { yieldApr: number; price: number; openLines: number; collateral: number; debt: number; referenceLoss: number } | null;
};
export type WithdrawQuote = { withdrawId: string; fee: number; messageToSign: string; txCbor: string | null };
export type AutoStatus = { open: boolean; ready?: boolean; network: "testnet" | "mainnet"; maxBudgetUsd: number; traders: number; copilot?: boolean };
/** What the copilot sees of the app (it can only propose; the user applies). */
export type CopilotContext = { demo: boolean; rules: AutoRules | null; balance: number | null; copies: { lead: string; amount: number; pnl: number }[] };

const SESSION = "bolt-autopilot-session"; // per-viewer convenience: stay signed in on this browser

export type Session = { address: string; token: string; wallet?: string }; // wallet: the CIP-30 key it was connected with
export function savedSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION) ?? "null");
    return s?.address && s?.token ? s : null;
  } catch {
    return null;
  }
}
export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION, JSON.stringify(s));
    else localStorage.removeItem(SESSION);
  } catch {}
}

async function call<T>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(
    `${site.botApi}/autopilot/${path}`,
    body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) },
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error ?? `Something went wrong (${res.status})`), { status: res.status });
  return j as T;
}

/** Whether Autopilot is open to everyone (false until the server says so). */
export function useAutopilotOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    autopilot.status().then((s) => setOpen(s.open), () => {});
  }, []);
  return open;
}

export const autopilot = {
  status: () => call<AutoStatus>("status"),
  preview: () => call<{ at: number; traders: PreviewTrader[] }>("preview"),
  earn: () => call<{ slp: SlpInfo }>("earn"),
  marks: () => call<{ at: number; marks: Record<string, LiveMark> }>("marks"),
  copilot: (messages: { role: "user" | "assistant"; text: string }[], context: CopilotContext) =>
    call<{ reply: string; proposal: AutoRules | null; proposalText: string | null }>("copilot", { messages, context }),
  // In private beta the server only lets an admin start a connect: send this browser's admin key if it has one.
  connectStart: (address: string, adminKey?: string) => call<{ nonce: string; message: string }>("connect/start", { address }, adminKey ? { "x-admin-key": adminKey } : {}),
  connectFinish: (nonce: string, signature: string, key: string) => call<{ token: string; user: AutoUserView }>("connect/finish", { nonce, signature, key }),
  me: (s: Session) => call<AutoMe>("me", s),
  rules: (s: Session, rules: AutoRules) => call<{ user: AutoUserView; rulesText: string }>("rules", { ...s, rules }),
  mode: (s: Session, mode: AutoMode) => call<{ user: AutoUserView }>("mode", { ...s, mode }),
  /** This account's share id for its public result card (made once, then reused). */
  share: (s: Session) => call<{ id: string }>("share", s),
  deposit: (s: Session, amount: number, utxos: string[], asset: "ADA" | "sUSDrf" = "ADA") =>
    call<{ requestId: string; usd: number; unsignedTx: string }>("deposit", { ...s, amount, asset, utxos }),
  depositSubmit: (s: Session, requestId: string, txHash: string) => call<{ status: string }>("deposit/submit", { ...s, requestId, txHash }),
  withdrawLimits: (s: Session, asset: string) => call<Record<string, unknown>>("withdraw/limits", { ...s, asset }),
  withdrawQuote: (s: Session, q: { mode: "balance"; usd: number; asset: "ADA" | "USDM" } | { mode: "collateral"; amount: number }) => call<WithdrawQuote>("withdraw/quote", { ...s, ...q }),
  withdrawConfirm: (s: Session, withdrawId: string, walletSignature: string, signedTxCbor: string | null) =>
    call<{ id: string; status: string }>("withdraw/confirm", { ...s, withdrawId, walletSignature, signedTxCbor }),
  withdrawStatus: (s: Session, id: string) => call<{ queued?: boolean; status?: string; wait_seconds?: number }>("withdraw/status", { ...s, id }),
};
