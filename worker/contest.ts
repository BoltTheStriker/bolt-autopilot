// $BOLT trading contest: the biggest buyers in a time window win STRIKE from a prize pool
// that grows with every trade. Trades come from Solada's public trade feed (curve + Minswap);
// the ranking is plain arithmetic over them, so anyone can check it against the chain.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export type ContestConfig = {
  /** "buy": biggest buyers win. "pnl": best demo-bot return wins (see cup.ts). */
  kind?: "buy" | "pnl";
  /** pnl cup: $BOLT a player must keep holding to win. */
  minHolding?: number;
  start: number; // ms
  end: number; // ms
  baseUsd: number; // prize pool at the start
  /** Share of the project's fee cut that goes into the pool (0–1). */
  poolShare: number;
  /** Trading fee on every trade, and the project's share of it (the rest goes to holders). */
  feeRate: number;
  projectShare: number;
  /** Prizes are paid this long after the end, to wallets that still hold what they bought. */
  payoutDelayDays: number;
  /** Wallets that can't win (the project's own). Matched against the trader's address or key. */
  exclude: string[];
};

export const DEFAULT_CONTEST: Omit<ContestConfig, "start" | "end"> = {
  baseUsd: 200,
  poolShare: 0.25, // a quarter of the project's 1% = 0.25% of every trade; the rest still funds the project
  feeRate: 0.02,
  projectShare: 0.5,
  payoutDelayDays: 3,
  exclude: [],
};

export const PRIZE_SPLIT = [0.5, 0.3, 0.2];

export type Trade = { atMs: number; side: "buy" | "sell"; lovelace: number; tokens: number; trader: string; key: string; tx: string; dev: boolean };

export type ContestStore = {
  config: ContestConfig | null;
  trades: Record<string, Trade>; // by id (tx + side + amount), window trades only
  syncedTo: number; // newest trade time already read
  adaUsd: number;
  holdings: Record<string, { held: number; at: number }>; // by trader key, $BOLT tokens
  handles: Record<string, { handle: string | null; at: number }>; // ADA Handle by trader key, for display
};

export const emptyContest = (): ContestStore => ({ config: null, trades: {}, syncedTo: 0, adaUsd: 0, holdings: {}, handles: {} });

export function loadContest(path: string): ContestStore {
  try {
    if (existsSync(path)) return { ...emptyContest(), ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {}
  return emptyContest();
}

export function saveContest(path: string, store: ContestStore) {
  writeFileSync(`${path}.tmp`, JSON.stringify(store));
  renameSync(`${path}.tmp`, path);
}

const TOKEN_DECIMALS = 6;
const n = (v: unknown) => (v === undefined || v === null || v === "" ? 0 : Number(v));

/** One row of Solada's /api/trades feed, in our terms. */
export function parseTrade(x: Record<string, unknown>): Trade | null {
  const side = x.side === "buy" || x.side === "sell" ? x.side : null;
  const trader = String(x.trader ?? "");
  if (!side || !trader || !x.tx || !x.atMs) return null;
  return {
    atMs: n(x.atMs),
    side,
    lovelace: n(x.lovelace),
    tokens: n(x.tokens) / 10 ** TOKEN_DECIMALS,
    trader,
    key: String(x.traderKey ?? trader),
    tx: String(x.tx),
    dev: Boolean(x.dev),
  };
}

export const tradeId = (t: Trade) => `${t.tx}:${t.side}:${t.lovelace}`;

/** Add trades from the feed; keeps only the contest window. Returns how many were new. */
export function addTrades(store: ContestStore, trades: Trade[]): number {
  const c = store.config;
  if (!c) return 0;
  let added = 0;
  for (const t of trades) {
    store.syncedTo = Math.max(store.syncedTo, t.atMs);
    if (t.atMs < c.start || t.atMs >= c.end) continue;
    const id = tradeId(t);
    if (store.trades[id]) continue;
    store.trades[id] = t;
    added++;
  }
  return added;
}

export type Phase = "off" | "upcoming" | "live" | "checking" | "final";
export type Entry = {
  key: string;
  trader: string;
  handle: string | null;
  boughtAda: number;
  boughtTokens: number;
  buys: number;
  sells: number;
  held: number | null; // last balance check
  out: string | null; // why it doesn't qualify
  rank: number | null;
  prizeUsd: number;
};

/** The leaderboard, the pool and the phase, as the /contest page shows them. */
export function standings(store: ContestStore, now: number) {
  const c = store.config;
  if (!c) return { phase: "off" as Phase };
  const payoutAt = c.end + c.payoutDelayDays * 86_400_000;
  const phase: Phase = now < c.start ? "upcoming" : now < c.end ? "live" : now < payoutAt ? "checking" : "final";
  const excluded = (t: Trade) => t.dev || c.exclude.some((e) => e === t.trader || e === t.key);

  const trades = Object.values(store.trades).filter((t) => !excluded(t));
  const volumeAda = trades.reduce((s, t) => s + t.lovelace, 0) / 1e6;
  const addedAda = volumeAda * c.feeRate * c.projectShare * c.poolShare;
  const addedUsd = addedAda * store.adaUsd;
  const poolUsd = c.baseUsd + addedUsd;

  const by = new Map<string, Entry>();
  for (const t of trades) {
    const e = by.get(t.key) ?? { key: t.key, trader: t.trader, handle: null, boughtAda: 0, boughtTokens: 0, buys: 0, sells: 0, held: null, out: null, rank: null, prizeUsd: 0 };
    if (t.side === "buy") {
      e.boughtAda += t.lovelace / 1e6;
      e.boughtTokens += t.tokens;
      e.buys++;
    } else e.sells++;
    by.set(t.key, e);
  }
  const entries = [...by.values()].filter((e) => e.buys > 0);
  for (const e of entries) {
    const h = store.holdings[e.key];
    e.held = h ? h.held : null;
    e.handle = store.handles?.[e.key]?.handle ?? null;
    if (e.sells) e.out = "sold during the contest";
    // Must still hold at least what it bought (a transfer out counts like a sell). 0.1% slack for rounding.
    else if (h && h.held < e.boughtTokens * 0.999) e.out = "moved or sold the $BOLT it bought";
  }
  const ok = entries.filter((e) => !e.out).sort((a, b) => b.boughtAda - a.boughtAda);
  ok.forEach((e, i) => {
    e.rank = i + 1;
    e.prizeUsd = (PRIZE_SPLIT[i] ?? 0) * poolUsd;
  });
  const out = entries.filter((e) => e.out).sort((a, b) => b.boughtAda - a.boughtAda);

  return {
    phase,
    start: c.start,
    end: c.end,
    payoutAt,
    pool: { baseUsd: c.baseUsd, addedAda, addedUsd, totalUsd: poolUsd, sharePct: c.feeRate * c.projectShare * c.poolShare * 100 },
    prizes: PRIZE_SPLIT.map((f) => f * poolUsd),
    volumeAda,
    buyers: ok.length,
    leaderboard: ok,
    disqualified: out,
    adaUsd: store.adaUsd,
    syncedTo: store.syncedTo,
  };
}

/** Wallets shown on the board (whose ADA Handle is worth looking up). */
export function shown(store: ContestStore, now: number, top = 25): Entry[] {
  const s = standings(store, now);
  return "leaderboard" in s ? [...s.leaderboard!.slice(0, top), ...s.disqualified!] : [];
}

/** Wallets worth a balance check: the biggest buyers that haven't sold (only they can win).
 *  Ones already out for moving tokens are checked again, in case a read was wrong or they bought back. */
export function toCheck(store: ContestStore, now: number, top = 10): Entry[] {
  const s = standings(store, now);
  if (!("leaderboard" in s)) return [];
  return [...s.leaderboard!, ...s.disqualified!.filter((e) => !e.sells)].sort((a, b) => b.boughtAda - a.boughtAda).slice(0, top);
}
