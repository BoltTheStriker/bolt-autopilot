// Bolt vs the leaderboard: two paper portfolios tracked forward on Strike's public data.
//   Bolt: the bot's own engine (step(): its entry rules, stop-losses, rotation).
//   Leaderboard: the 10 best 30-day returners, equal weight, re-picked each day, held without
//   stops, which is what copying "the top traders" by hand looks like.
// Both start at $1,000 and pay the same taker fee and slippage on every mirrored trade.
//   node --experimental-strip-types bot/benchmark.ts      (run every 6 hours by .github/workflows/benchmark.yml)
import { bot, type BotConfig } from "./config.ts";
import { equityOf, initialState, markToMarket, step, type BotState, type Lead, type Position } from "./strategy.ts";

export const TOP_N = 10;
const HOUR = 3_600_000;
const MAX_POINTS = 2_000;

export type Book = { cash: number; positions: Position[]; pickedDay: string | null };
export type Benchmark = { startedAt: number; bolt: BotState; top: Book; points: { at: number; bolt: number; top: number }[] };

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const day = (now: number) => new Date(now).toISOString().slice(0, 10);

/** The leaderboard pick: the best 30-day returns among real, active accounts on the bot's platform. */
export function topReturners(cands: Lead[], cfg: BotConfig, now: number, n = TOP_N): Lead[] {
  return cands
    .filter((c) => c.platform === cfg.entry.platform && num(c.account_value) >= cfg.entry.minAccountValue && !!c.last_traded_at_ms && now - c.last_traded_at_ms <= cfg.entry.maxIdleHours * HOUR)
    .sort((a, b) => num(b.roi["30d"]) - num(a.roi["30d"]))
    .slice(0, n);
}

const bookValue = (b: Book) => b.cash + b.positions.reduce((t, p) => t + p.value, 0);

/** One leaderboard step: mark every holding to the leads' latest figures (same fee model as the bot),
 *  then, once a day, sell everything and buy the day's top N in equal parts. */
export function stepTop(prev: Book, cands: Lead[], held: Map<string, Lead | undefined>, cfg: BotConfig, now: number): Book {
  const positions = prev.positions.map((p) => {
    const lead = held.get(p.lead) ?? cands.find((c) => c.address === p.lead);
    return lead ? markToMarket(p, lead, cfg, now) : p;
  });
  let book: Book = { ...prev, positions };
  if (book.pickedDay !== day(now)) {
    const picks = topReturners(cands, cfg, now);
    if (picks.length) {
      const total = bookValue(book);
      const each = total / picks.length;
      book = {
        cash: total - each * picks.length,
        pickedDay: day(now),
        positions: picks.map((l) => ({
          lead: l.address,
          openedAt: now,
          cost: each,
          value: each,
          peak: each,
          fees: 0,
          score: 0,
          coverage: 1,
          mark: { pnlAll: num(l.pnl.all), volumeAll: num(l.volume.all), accountValue: num(l.account_value), at: now },
        })),
      };
    }
  }
  return book;
}

export function initialBenchmark(cfg: BotConfig, now: number): Benchmark {
  return { startedAt: now, bolt: initialState(cfg, now), top: { cash: cfg.startingCapital, positions: [], pickedDay: null }, points: [{ at: now, bolt: cfg.startingCapital, top: cfg.startingCapital }] };
}

/** One benchmark run: both books advance on the same moment's data. The bot ranks from its usual list;
 *  the leaderboard picks from every trader seen. Pure. */
export function stepBenchmark(b: Benchmark, boltCands: Lead[], topCands: Lead[], held: Map<string, Lead | undefined>, cfg: BotConfig, now: number): Benchmark {
  const boltNext = step(b.bolt, boltCands, held, cfg, now);
  // Keep the saved state small: the page only needs the curves and current holdings.
  const bolt: BotState = { ...boltNext, decisions: boltNext.decisions.slice(0, 30), closed: boltNext.closed.slice(-50), equity: boltNext.equity.slice(-MAX_POINTS), lastScan: undefined, shadow: undefined };
  const top = stepTop(b.top, topCands, held, cfg, now);
  const points = [...b.points, { at: now, bolt: Math.round(equityOf(bolt) * 100) / 100, top: Math.round(bookValue(top) * 100) / 100 }].slice(-MAX_POINTS);
  return { ...b, bolt, top, points };
}

/** What the page shows for one curve: return, worst drop from a high, and return per unit of that drop. */
export function curveStats(values: number[]): { ret: number; maxDrawdown: number; retPerDrawdown: number | null } {
  if (values.length < 2) return { ret: 0, maxDrawdown: 0, retPerDrawdown: null };
  let peak = values[0];
  let dd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    dd = Math.max(dd, 1 - v / peak);
  }
  const ret = values.at(-1)! / values[0] - 1;
  return { ret, maxDrawdown: dd, retPerDrawdown: dd > 0.0005 ? ret / dd : null };
}

// ---- the run itself (skipped when imported by tests) ----
async function main() {
  const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
  const FILE = new URL("../data/benchmark.json", import.meta.url);
  const API = "https://api.strikefinance.org";
  const get = async <T,>(path: string): Promise<T | null> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(API + path, { headers: { accept: "application/json" } }).catch(() => null);
      if (res?.ok) return (await res.json()) as T;
      if (res?.status === 404) return null;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    throw new Error(`Strike API unreachable: ${path}`);
  };
  const now = Date.now();
  const prev: Benchmark = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : initialBenchmark(bot, now);
  const q = new URLSearchParams({ platform: bot.entry.platform, sort: "copy_score", order: "desc", enriched_only: "true", limit: "100" });
  const cands = (await get<{ items?: Lead[] }>(`/v2/copy/discover?${q}`))?.items ?? [];
  // The leaderboard view: the same traders sorted by 30-day return (Strike's list can be sorted either way).
  const byRoi = (await get<{ items?: Lead[] }>(`/v2/copy/discover?${new URLSearchParams({ platform: bot.entry.platform, sort: "roi_30d", order: "desc", enriched_only: "true", limit: "100" })}`).catch(() => null))?.items ?? []; // optional: topReturners sorts anyway
  const all = [...new Map([...cands, ...byRoi].map((c) => [c.address, c])).values()];
  // Fresh figures for everything either book holds (they may have left the lists).
  const held = new Map<string, Lead | undefined>();
  for (const p of [...prev.bolt.positions, ...prev.top.positions]) {
    if (held.has(p.lead)) continue;
    held.set(p.lead, all.find((c) => c.address === p.lead) ?? (await get<Lead>(`/v2/copy/discover/${p.lead}`)) ?? undefined);
  }
  const next = stepBenchmark(prev, cands, all, held, bot, now);
  writeFileSync(FILE, JSON.stringify(next) + "\n");
  const p = next.points.at(-1)!;
  console.log(`Bolt $${p.bolt.toFixed(2)} (${next.bolt.positions.length} copies) · Top ${TOP_N} $${p.top.toFixed(2)} (${next.top.positions.length}) · ${cands.length}/${byRoi.length} traders seen`);
}
if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) void main();
