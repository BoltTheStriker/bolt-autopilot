// Walk-forward backtest of trader-selection rules on Strike's 30-day PnL curves.
//   node --experimental-strip-types bot/backtest.ts <traders.json> [results.json]
//
// On each decision day, pick traders using ONLY curve data up to that day, hold them for
// HOLD_DAYS, and score the picks on what happened next (after copy costs). Compared with
// simpler strategies, so we can tell whether the bot's rules add anything.
//
// Limits (read the result with these in mind):
// - Only ~30 days of history exist, so there are few periods; treat results as directional.
// - The universe is today's leaderboard (traders who blew up and vanished are missing), which
//   flatters every strategy; the comparison between strategies is the useful part.
// - Returns are PnL over the equity at the decision time, so deposits/withdrawals don't count as profit.
// - Trade frequency and volume are today's figures (no history for those).
import { readFileSync, writeFileSync } from "node:fs";

type Raw = {
  address: string;
  account_value: string;
  volume?: Record<string, string>;
  fills_window_days?: string;
  pnl_curve_30d?: [number, string][];
  equity_curve_30d?: [number, string][];
};

type Curve = [number, number][];
type T = { address: string; av: number; start: number; curve: Curve; equity: Curve; tpd?: number; dailyTurnover: number };

const DAY = 86_400_000;
const HOLD_DAYS = Number(process.env.HOLD ?? 3);
const COST = Number(process.env.COST ?? 0.0005 + 0.0005); // taker fee + slippage, per unit of mirrored volume
const STOP = 0.15; // each copy has a Strike-side stop-loss
const TP = Number(process.env.TP ?? 0); // take profit: stop the copy once it's up this much (0 = off)
const MIN_EQUITY = 10_000;
const num = (v: unknown) => (v === undefined || v === null || v === "" ? 0 : Number(v));

const file = process.argv[2];
if (!file) throw new Error("usage: backtest.ts <traders.json>  (Strike /v2/copy/discover items)");
const raw = JSON.parse(readFileSync(file, "utf8")) as Raw[];

const traders: T[] = raw
  .map((r) => {
    const curve = (r.pnl_curve_30d ?? []).map(([t, v]) => [t, num(v)] as [number, number]);
    const equity = (r.equity_curve_30d ?? []).map(([t, v]) => [t, num(v)] as [number, number]);
    const av = num(r.account_value);
    const gained = curve.length ? curve.at(-1)![1] - curve[0][1] : 0;
    const fwd = num(r.fills_window_days);
    return {
      address: r.address,
      av,
      start: av - gained, // equity at the start of the window (approx.)
      curve,
      equity,
      tpd: fwd > 0 ? 2000 / fwd : undefined,
      dailyTurnover: av > 0 ? num(r.volume?.["30d"]) / 30 / av : 0,
    };
  })
  .filter((t) => t.curve.length >= 20);

/** Curve value at time ts (linear interpolation between points). */
function at(c: Curve, ts: number): number {
  if (ts <= c[0][0]) return c[0][1];
  if (ts >= c.at(-1)![0]) return c.at(-1)![1];
  for (let i = 1; i < c.length; i++) {
    if (c[i][0] >= ts) {
      const [t0, v0] = c[i - 1];
      const [t1, v1] = c[i];
      return v0 + ((v1 - v0) * (ts - t0)) / (t1 - t0 || 1);
    }
  }
  return c.at(-1)![1];
}

const pnlAt = (t: T, ts: number) => at(t.curve, ts);
/** Equity at a time (falls back to the window-start estimate). */
const equityAt = (t: T, ts: number) => (t.equity.length ? at(t.equity, ts) : t.start);

/** Return between two times, relative to the equity when the copy starts. */
const ret = (t: T, from: number, to: number) => (pnlAt(t, to) - pnlAt(t, from)) / equityAt(t, from);

/** Trailing features using only data in [from, to]. */
function features(t: T, from: number, to: number) {
  const base = equityAt(t, from);
  if (base < MIN_EQUITY) return null; // too small to copy meaningfully
  const pts = t.curve.filter(([ts]) => ts >= from && ts <= to).map(([, v]) => v / base);
  if (pts.length < 5) return null;
  const roi = pts.at(-1)! - pts[0];
  let peak = -Infinity, dd = 0;
  for (const v of pts) {
    peak = Math.max(peak, v);
    dd = Math.max(dd, peak - v);
  }
  // R² of a straight line through the curve; 0 if falling.
  const n = pts.length, xs = pts.map((_, i) => i);
  const mx = (n - 1) / 2, my = pts.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (pts[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (pts[i] - my) ** 2;
  }
  const r2 = sxx && syy && sxy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { roi, dd, r2 };
}

type Pick = (cands: { t: T; f: NonNullable<ReturnType<typeof features>> }[], n: number) => T[];

const speed = (t: T) => (t.tpd === undefined || t.tpd <= 150 ? 1 : t.tpd >= 1500 ? 0.6 : 1 - (0.4 * (t.tpd - 150)) / 1350);

const strategies: Record<string, Pick> = {
  // Bolt's rules: profitable, shallow drawdown, not a scalper; rank by smoothness + return − drawdown.
  bolt: (c, n) =>
    c
      .filter(({ t, f }) => f.roi > 0 && f.dd < 0.25 && (t.tpd ?? 0) <= 800)
      .map(({ t, f }) => ({ t, s: (0.4 * f.r2 + 0.3 * Math.min(f.roi, 1) + 0.3 * (1 - Math.min(f.dd, 0.5) / 0.5)) * speed(t) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, n)
      .map((x) => x.t),
  // Same, but also requiring a very steady curve (R² ≥ 0.8).
  "bolt-strict": (c, n) =>
    strategies.bolt(c.filter(({ f }) => f.r2 >= 0.8), n),
  // Bolt, skipping hot streaks (more than +50% in the lookback tends to give back).
  "bolt-capped": (c, n) => strategies.bolt(c.filter(({ f }) => f.roi <= 0.5), n),
  // Bolt, skipping heavy churners (copy costs eat their edge).
  "bolt-lowturn": (c, n) => strategies.bolt(c.filter(({ t }) => t.dailyTurnover <= 3), n),
  "bolt-both": (c, n) => strategies.bolt(c.filter(({ t, f }) => f.roi <= 0.5 && t.dailyTurnover <= 3), n),
  // Naive: whoever made the most recently.
  momentum: (c, n) => [...c].sort((a, b) => b.f.roi - a.f.roi).slice(0, n).map((x) => x.t),
  // Smoothest climbers, nothing else.
  smooth: (c, n) => c.filter(({ f }) => f.roi > 0).sort((a, b) => b.f.r2 - a.f.r2).slice(0, n).map((x) => x.t),
};

function run(name: string, lookbackDays: number, n: number) {
  // Common timeline from the typical curve; traders whose curve doesn't cover a period sit it out.
  const mid = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const end = mid(traders.map((t) => t.curve.at(-1)![0]));
  const first = mid(traders.map((t) => t.curve[0][0]));
  const periods: { at: number; r: number; picks: string[] }[] = [];
  for (let d = first + lookbackDays * DAY; d + HOLD_DAYS * DAY <= end; d += HOLD_DAYS * DAY) {
    const cands = traders.flatMap((t) => {
      if (t.curve[0][0] > d - lookbackDays * DAY + DAY / 2 || t.curve.at(-1)![0] < d + HOLD_DAYS * DAY - DAY / 2) return [];
      if (equityAt(t, d) < MIN_EQUITY) return [];
      const f = features(t, d - lookbackDays * DAY, d);
      return f ? [{ t, f }] : [];
    });
    const picks = strategies[name](cands, n);
    if (!picks.length) {
      periods.push({ at: d, r: 0, picks: [] });
      continue;
    }
    // Equal weight; costs = turnover × cost over the hold.
    // Losses stop at the stop-loss; gains capped at +100% to keep data glitches from dominating.
    const one = (t: T) => {
      // Walk the curve through the hold; the stop-loss or take-profit ends the copy early.
      const end = d + HOLD_DAYS * DAY;
      const steps = t.curve.filter(([ts]) => ts > d && ts < end).map(([ts]) => ts).concat(end);
      let r = 0, days = HOLD_DAYS;
      for (const ts of steps) {
        r = ret(t, d, ts);
        if (r <= -STOP) { r = -STOP; days = (ts - d) / DAY; break; }
        if (TP > 0 && r >= TP) { days = (ts - d) / DAY; break; }
      }
      return Math.min(1, r) - Math.min(t.dailyTurnover, 50) * days * COST;
    };
    const r = picks.reduce((s, t) => s + one(t), 0) / picks.length;
    periods.push({ at: d, r, picks: picks.map((t) => t.address) });
  }
  const total = periods.reduce((acc, p) => acc * (1 + p.r), 1) - 1;
  const wins = periods.filter((p) => p.r > 0).length;
  return { name, lookbackDays, n, periods: periods.length, total, winRate: periods.length ? wins / periods.length : 0, worst: periods.length ? Math.min(...periods.map((p) => p.r)) : 0, best: periods.length ? Math.max(...periods.map((p) => p.r)) : 0, detail: periods };
}

// Market baseline: every trader, equal weight.
function baseline(lookbackDays: number) {
  return run("all-traders", lookbackDays, Infinity);
}
strategies["all-traders"] = (c) => c.map((x) => x.t);

const results = [];
const LOOKBACKS = (process.env.LB ?? "7,10,14,20").split(",").map(Number);
for (const lb of LOOKBACKS)
  for (const name of (process.env.STRATS ?? "bolt,bolt-strict,bolt-capped,bolt-lowturn,bolt-both,momentum,smooth").split(","))
    for (const n of [3, 5, 10, 20]) results.push(run(name, lb, n));
for (const lb of LOOKBACKS) results.push(baseline(lb));

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
console.log(`Universe: ${traders.length} traders · hold ${HOLD_DAYS}d · cost ${(COST * 100).toFixed(2)}% of mirrored volume\n`);
console.log("strategy       lookback  N   periods  total     win%   worst    best");
for (const r of results.sort((a, b) => b.total - a.total))
  console.log(`${r.name.padEnd(14)} ${String(r.lookbackDays).padStart(4)}d   ${String(r.n === Infinity ? "all" : r.n).padStart(3)}  ${String(r.periods).padStart(5)}    ${pct(r.total).padStart(8)}  ${(r.winRate * 100).toFixed(0).padStart(4)}%  ${pct(r.worst).padStart(7)}  ${pct(r.best).padStart(7)}`);

if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify({ at: Date.now(), universe: traders.length, holdDays: HOLD_DAYS, results }, null, 1));
