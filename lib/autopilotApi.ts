// Browser side of Bolt Autopilot: talks to the bot server's /autopilot routes.
import { useEffect, useState } from "react";
import { site } from "@/lib/config";
import type { AutoRules, LiveMark, PreviewTrader, SharedRules } from "@/worker/autopilot";

export type AutoMode = "off" | "on" | "autopilot";
export type AutoCopy = { lead: string; amount: number; pnl: number; isolated?: boolean; positions: { market: string; long: boolean; pnl?: number }[] };
/** One Autopilot review: what prompted it, who decided, what changed, the limits check, what Strike then did. */
export type AutoDecision = { at: number; by: "ai" | "rules"; note?: string; why: string[]; did: string[]; limits: string; changed: boolean; strike?: string[] };
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
  decisions?: AutoDecision[]; // Autopilot's latest reviews, newest first
  run?: { since: number; closed: number } | null; // since Start: the profit of copies that already ended (for the stop targets)
  netIn?: number | null; // money put into the Strike account minus taken out: all-time profit = total − netIn
  note?: string | null; // why the bot runs fewer copies than the rules ask for
  started?: boolean; // the bot has run before (stopping it keeps the dashboard)
  history?: { at: number; pnl: number; working: number }[]; // profit on the running copies at each sync
  liveAt?: number | null; // set when `copies` were just read live from Strike (not the last sync)
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
export type AutoStatus = { open: boolean; ready?: boolean; network: "testnet" | "mainnet"; maxBudgetUsd: number; traders: number; copilot?: boolean; adaUsd?: number | null };
/** What the copilot sees of the app (it can only propose; the user applies). */
export type CopilotContext = {
  demo: boolean;
  rules: AutoRules | null;
  balance: number | null;
  copies: { lead: string; amount: number; pnl: number; name?: string }[]; // name: what the user calls this trader
  mode?: AutoMode | null;
  sinceStart?: number | null; // profit since Start
  today?: number | null; // profit today (UTC)
};
/** A trader Bolt follows, as the trader window shows them (public data; the address as it was asked). */
export type TraderCard = {
  lead: string;
  rank: number | null;
  ranked: number;
  stats: { score: number; dd: number; roi7d: number; roi30d: number; realWorldShare: number; strikeShare: number | null; activeHours24h: number | null } | null;
  accountUsd: number | null;
  pnl: { day: number | null; week: number | null; month: number | null; allTime: number | null };
  volume30d: number | null;
  curve: [number, number][]; // 30 days: [time, profit in $]
  positions: { market: string; long: boolean; valueUsd: number; entry: number; pnl: number; onStrike: boolean }[];
  trades: { at: number; market: string; dir: string; px: number; sizeUsd: number; pnl: number; onStrike: boolean }[];
  closes14d: { count: number; wins: number };
  at: number;
};
export type WalletToken = { unit: string; ticker: string | null; name: string | null; decimals: number; logoUrl: string | null; priceAda: number | null };
export type SwapQuote = { outputLovelace: number; batcherLovelace: number; depositLovelace: number; serviceLovelace: number; venue: string };
/** A one-tap action the copilot can offer. */
export type CopilotAction = "start" | "stop" | "autopilot" | "follow_rules";

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

/** A Bolt Call as the feed shows it: entry at Strike's mark price when posted, live result on today's mark. */
export type BoltCall = {
  id: string;
  name?: string; // the caller, as their short wallet address
  symbol: string;
  side: "long" | "short";
  leverage: number;
  entry: number;
  tp: number | null;
  sl: number | null;
  thesis: string;
  at: number;
  status: "open" | "tp" | "sl" | "closed";
  exit?: number;
  closedAt?: number;
  tails: number;
  mark: number | null;
  ret: number | null; // return on margin: price move × leverage
};
export type CallLeader = { name?: string; calls: number; closed: number; wins: number; winRate: number | null; avgReturn: number | null };
export type CallInput = { symbol: string; side: "long" | "short"; leverage: number; tpPct?: number | null; slPct?: number | null; thesis: string };

export const calls = {
  feed: () => call<{ at: number; marks: Record<string, number>; calls: BoltCall[]; leaders: CallLeader[] }>("calls"),
  post: (s: Session, c: CallInput) => call<{ call: BoltCall }>("calls/new", { ...s, ...c }),
  mine: (s: Session) => call<{ ids: string[] }>("calls/mine", s),
  close: (s: Session, id: string) => call<{ call: BoltCall }>("calls/close", { ...s, id }),
  tail: (s: Session, id: string, usd: number, adminKey: string) => call<{ ok: true; size: string; notional: number }>("calls/tail", { ...s, id, usd }, adminKey ? { "x-admin-key": adminKey } : {}),
};

export const autopilot = {
  status: () => call<AutoStatus>("status"),
  preview: () => call<{ at: number; traders: PreviewTrader[] }>("preview"),
  earn: () => call<{ slp: SlpInfo }>("earn"),
  marks: () => call<{ at: number; marks: Record<string, LiveMark> }>("marks"),
  copilot: (messages: { role: "user" | "assistant"; text: string }[], context: CopilotContext) =>
    call<{ reply: string; proposal: AutoRules | null; proposalText: string | null; action?: CopilotAction | null }>("copilot", { messages, context }),
  // In private beta the server only lets an admin start a connect: send this browser's admin key if it has one.
  connectStart: (address: string, adminKey?: string) => call<{ nonce: string; message: string }>("connect/start", { address }, adminKey ? { "x-admin-key": adminKey } : {}),
  connectFinish: (nonce: string, signature: string, key: string) => call<{ token: string; user: AutoUserView }>("connect/finish", { nonce, signature, key }),
  me: (s: Session) => call<AutoMe>("me", s),
  rules: (s: Session, rules: AutoRules) => call<{ user: AutoUserView; rulesText: string }>("rules", { ...s, rules }),
  mode: (s: Session, mode: AutoMode) => call<{ user: AutoUserView }>("mode", { ...s, mode }),
  swap: (s: Session, lead: string) => call<{ user: AutoUserView }>("swap", { ...s, lead }),
  trader: (lead: string) => call<TraderCard>(`trader?lead=${encodeURIComponent(lead)}`),
  // Deposit any Cardano token: swapped to ADA through SteelSwap in the user's wallet, then a normal ADA deposit.
  swapTokens: (s: Session, units: string[]) => call<{ tokens: WalletToken[] }>("swap/tokens", { ...s, units }),
  swapQuote: (s: Session, unit: string, amount: string) => call<SwapQuote>("swap/quote", { ...s, unit, amount }),
  swapBuild: (s: Session, unit: string, amount: string, utxos: string[], expectedLovelace: number) =>
    call<{ txCbor: string; txHash: string; partialSign: boolean }>("swap/build", { ...s, unit, amount, utxos, expectedLovelace }),
  swapNotify: (s: Session, txHash: string, txCbor: string) => call<{ ok: boolean }>("swap/notify", { ...s, txHash, txCbor }),
  /** A shared setup by share id: the rules' shape and the sharer's verified result. */
  setup: (id: string) => call<{ rules: SharedRules; card: { ret: number; since: number; traders: number; mode: AutoMode } }>(`setup/${id}`),
  /** The copies' profit right now, read live from Strike (for the stop confirmation). */
  live: (s: Session) => call<{ at: number; copies: number; pnl: number; working: number }>("live", s),
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
