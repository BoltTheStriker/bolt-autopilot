// The PnL cup: holders who join (by signing with their wallet) compete on their demo bot's
// return during the contest week. To be fair, every player starts fresh with $10,000 when the
// cup opens (or when they join, if later), keeping their rules. Pure functions, no I/O.

import { portfolioValue, leverageOf, type LeadIndex } from "./demoEngine.ts";
import { resetDemo, type DemoAccount, type DemoStore } from "./demo.ts";
import { standings, type ContestStore } from "./contest.ts";

/** A holder's place in a cup: `cupId` is the cup's start time, so a new cup starts clean. */
export type CupEntry = { cupId: number; joinedAt: number; startValue?: number; endValue?: number };

export const CUP_MIN_HOLDING = 1_000_000;
const JOIN_WINDOW_MS = 10 * 60_000;

/** The exact text a holder signs to start their demo over. */
export const resetMessage = (address: string, time: string) => `Start my $BOLT demo over\nWallet: ${address}\nTime: ${time}`;

/** No starting over while competing: it would erase a losing run. */
export function resetBlocked(a: { cup?: CupEntry }, cupStart: number | null, cupEnd: number | null, now: number): boolean {
  return Boolean(a.cup && cupStart !== null && a.cup.cupId === cupStart && now >= cupStart && cupEnd !== null && now < cupEnd + 86_400_000);
}

/** The exact text a holder signs to join. */
export const joinMessage = (address: string, time: string) => `Join the $BOLT Bot Cup\nWallet: ${address}\nTime: ${time}`;
/** The wording before the rename, still accepted from pages loaded before it. */
export const oldJoinMessage = (address: string, time: string) => `Join the $BOLT Trading Cup\nWallet: ${address}\nTime: ${time}`;

/** A join's signed time must be recent (and not from the future), so an old signature can't be reused later. */
export function freshJoinTime(time: string, now: number): boolean {
  const t = Date.parse(time);
  return Number.isFinite(t) && t <= now + 60_000 && now - t <= JOIN_WINDOW_MS;
}

const value = (a: DemoAccount, idx: LeadIndex) => (a.portfolio ? portfolioValue(a.portfolio, idx) : a.startBalance);

/** Everyone plays the cup from the same fresh $10K (style, leverage and traders kept). */
function freshStart(a: DemoAccount & { cup?: CupEntry }, e: CupEntry, now: number) {
  resetDemo(a, now, "Fresh start for the Bot Cup");
  e.startValue = a.startBalance;
}

/** Join (idempotent). If the cup is already running, the holder starts fresh now. */
export function joinCup(a: DemoAccount & { cup?: CupEntry }, cupStart: number, cupEnd: number, now: number, idx: LeadIndex): CupEntry {
  if (now >= cupEnd) throw new Error("The cup has ended.");
  if (a.cup?.cupId === cupStart) return a.cup;
  const e: CupEntry = { cupId: cupStart, joinedAt: now };
  a.cup = e;
  if (now >= cupStart) freshStart(a, e, now);
  return e;
}

/** Start every player fresh when the cup begins and freeze end values when it ends. Returns true if anything changed. */
export function snapshotCup(store: DemoStore, cupStart: number, cupEnd: number, now: number, idx: LeadIndex): boolean {
  let changed = false;
  for (const a of Object.values(store.accounts) as (DemoAccount & { cup?: CupEntry })[]) {
    const e = a.cup;
    if (!e || e.cupId !== cupStart) continue;
    if (now >= cupStart && e.startValue === undefined) {
      freshStart(a, e, now);
      changed = true;
    }
    if (now >= cupEnd && e.endValue === undefined) {
      e.endValue = value(a, idx);
      changed = true;
    }
  }
  return changed;
}

export type CupRow = {
  key: string;
  address: string;
  handle: string | null;
  pct: number;
  value: number;
  style: string;
  leverage: number;
  held: number | null;
  out: string | null;
  rank: number | null;
  prizeUsd: number;
};

/** Leaderboard, pool and phase for the /contest page. The pool comes from the trade feed, like the buy contest. */
export function cupStandings(demo: DemoStore, contest: ContestStore, now: number, idx: LeadIndex) {
  const s = standings(contest, now);
  if (!("pool" in s) || !contest.config) return { phase: "off" as const };
  const c = contest.config;
  const min = c.minHolding ?? CUP_MIN_HOLDING;
  const rows: CupRow[] = [];
  for (const a of Object.values(demo.accounts) as (DemoAccount & { cup?: CupEntry })[]) {
    const e = a.cup;
    if (!e || e.cupId !== c.start || !a.portfolio) continue;
    const v = e.endValue ?? value(a, idx);
    const start = e.startValue;
    const held = contest.holdings[a.stake]?.held ?? null;
    rows.push({
      key: a.stake,
      address: a.address,
      handle: contest.handles?.[a.stake]?.handle ?? null,
      pct: start ? v / start - 1 : 0,
      value: v,
      style: a.portfolio.settings.style,
      leverage: leverageOf(a.portfolio.settings),
      held,
      // Must still hold the minimum to win (checked on the chain for the top of the board).
      out: held !== null && held < min ? `holds less than ${(min / 1e6).toLocaleString("en-US")}M $BOLT` : null,
      rank: null,
      prizeUsd: 0,
    });
  }
  const ok = rows.filter((r) => !r.out).sort((a, b) => b.pct - a.pct || b.value - a.value);
  const started = now >= c.start;
  ok.forEach((r, i) => {
    r.rank = i + 1;
    r.prizeUsd = started ? (s.prizes?.[i] ?? 0) : 0;
  });
  return {
    kind: "pnl" as const,
    phase: s.phase,
    start: c.start,
    end: c.end,
    payoutAt: s.payoutAt,
    pool: s.pool,
    prizes: s.prizes,
    volumeAda: s.volumeAda,
    players: rows.length,
    minHolding: min,
    leaderboard: ok,
    disqualified: rows.filter((r) => r.out),
  };
}

/** Players worth a balance (and handle) check: the top of the board, plus anyone already marked out. */
export function cupToCheck(demo: DemoStore, contest: ContestStore, now: number, idx: LeadIndex, top = 10): CupRow[] {
  const s = cupStandings(demo, contest, now, idx);
  return s.phase === "off" ? [] : [...(s.leaderboard ?? []).slice(0, top), ...(s.disqualified ?? [])];
}
