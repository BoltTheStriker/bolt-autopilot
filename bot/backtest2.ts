// Backtest v2: compares how we PICK traders, how we SIZE copies, and whether stepping risk down
// in a drawdown helps. Walk-forward on Strike's 30-day curves: on each decision day, use only
// data up to that day, hold for HOLD days, score what happened next (after copy costs).
//   node --experimental-strip-types bot/backtest2.ts <traders.json>
//
// Limits: ~30 days of history (few periods), and today's universe (traders who blew up and
// vanished are missing, which flatters everyone). Read it as a comparison between variants.
import { readFileSync } from "node:fs";

type Raw = { address: string; account_value: string; volume?: Record<string, string>; pnl_curve_30d?: [number, string][]; equity_curve_30d?: [number, string][] };
type Curve = [number, number][];
type T = { address: string; curve: Curve; equity: Curve; start: number; turnover: number };

const DAY = 86_400_000;
const HOLD = Number(process.env.HOLD ?? 3);
const COST = 0.001; // taker fee + slippage per unit of mirrored volume
const STOP = 0.15;
const MIN_EQUITY = 10_000;
const num = (v: unknown) => (v === undefined || v === null || v === "" ? 0 : Number(v));

const raw = JSON.parse(readFileSync(process.argv[2], "utf8")) as Raw[];
const traders: T[] = raw
  .map((r) => {
    const curve = (r.pnl_curve_30d ?? []).map(([t, v]) => [t, num(v)] as [number, number]);
    const equity = (r.equity_curve_30d ?? []).map(([t, v]) => [t, num(v)] as [number, number]);
    const av = num(r.account_value);
    const gained = curve.length ? curve.at(-1)![1] - curve[0][1] : 0;
    return { address: r.address, curve, equity, start: av - gained, turnover: av > 0 ? num(r.volume?.["30d"]) / 30 / av : 0 };
  })
  .filter((t) => t.curve.length >= 20);

function at(c: Curve, ts: number) {
  if (ts <= c[0][0]) return c[0][1];
  if (ts >= c.at(-1)![0]) return c.at(-1)![1];
  for (let i = 1; i < c.length; i++)
    if (c[i][0] >= ts) {
      const [t0, v0] = c[i - 1], [t1, v1] = c[i];
      return v0 + ((v1 - v0) * (ts - t0)) / (t1 - t0 || 1);
    }
  return c.at(-1)![1];
}
const equityAt = (t: T, ts: number) => (t.equity.length ? at(t.equity, ts) : t.start);
const ret = (t: T, from: number, to: number) => (at(t.curve, to) - at(t.curve, from)) / equityAt(t, from);

/** Lookback features from data in [from, to] only. */
function features(t: T, from: number, to: number) {
  const base = equityAt(t, from);
  if (base < MIN_EQUITY) return null;
  const pts = t.curve.filter(([ts]) => ts >= from && ts <= to).map(([, v]) => v / base);
  if (pts.length < 6) return null;
  const roi = pts.at(-1)! - pts[0];
  let peak = -Infinity, dd = 0;
  for (const v of pts) {
    peak = Math.max(peak, v);
    dd = Math.max(dd, peak - v);
  }
  const steps = pts.slice(1).map((v, i) => v - pts[i]);
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
  const vol = Math.sqrt(steps.reduce((a, b) => a + (b - mean) ** 2, 0) / steps.length) || 1e-6;
  // Consistency: share of 4 equal sub-windows that made money.
  const q = Math.max(1, Math.floor(pts.length / 4));
  let up = 0, wins = 0;
  for (let i = 0; i + q < pts.length; i += q) {
    if (pts[i + q] > pts[i]) wins++;
    up++;
  }
  const cons = up ? wins / up : 0;
  // R² of a straight line (0 if falling): the current bot's "smoothness".
  const n = pts.length, mx = (n - 1) / 2, my = pts.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - mx) * (pts[i] - my);
    sxx += (i - mx) ** 2;
    syy += (pts[i] - my) ** 2;
  }
  const r2 = sxx && syy && sxy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  const roi7 = ret(t, Math.max(from, to - 7 * DAY), to);
  return { roi, dd, vol, cons, r2, roi7 };
}
type F = NonNullable<ReturnType<typeof features>>;
type Cand = { t: T; f: F };

const quality = (c: Cand) => c.f.roi > 0 && c.f.dd < 0.25 && c.t.turnover <= 3 && c.f.roi <= 5;
const pick: Record<string, (c: Cand[], n: number) => Cand[]> = {
  // What the live bot does today: smoothness + return − drawdown.
  current: (c, n) => c.filter(quality).sort((a, b) => cur(b) - cur(a)).slice(0, n),
  // Research score (hl-copy-core style): return × (1 − drawdown) × consistency.
  research: (c, n) => c.filter(quality).sort((a, b) => res(b) - res(a)).slice(0, n),
  // Return per unit of drawdown (Calmar-like) × consistency.
  calmar: (c, n) => c.filter(quality).sort((a, b) => cal(b) - cal(a)).slice(0, n),
  // Our "Aggressive" style: hottest last 7 days.
  hottest7d: (c, n) => c.filter((x) => x.t.turnover <= 3).sort((a, b) => b.f.roi7 - a.f.roi7).slice(0, n),
  // Our bold slot: highest return over the lookback.
  topReturn: (c, n) => c.filter((x) => x.f.roi <= 5 && x.t.turnover <= 3).sort((a, b) => b.f.roi - a.f.roi).slice(0, n),
  everyone: (c) => c,
};
const cur = (x: Cand) => 0.4 * x.f.r2 + 0.3 * Math.min(x.f.roi, 1) + 0.3 * (1 - Math.min(x.f.dd, 0.5) / 0.5);
const res = (x: Cand) => x.f.roi * (1 - x.f.dd) * (0.5 + 0.5 * x.f.cons);
const cal = (x: Cand) => (x.f.roi / Math.max(x.f.dd, 0.02)) * (0.5 + 0.5 * x.f.cons);

/** One copy over the hold: stop-loss ends it early; costs from the trader's turnover. */
function copyReturn(t: T, d: number) {
  const end = d + HOLD * DAY;
  const steps = t.curve.filter(([ts]) => ts > d && ts < end).map(([ts]) => ts).concat(end);
  let r = 0, days = HOLD;
  for (const ts of steps) {
    r = ret(t, d, ts);
    if (r <= -STOP) { r = -STOP; days = (ts - d) / DAY; break; }
  }
  return Math.min(1, r) - Math.min(t.turnover, 50) * days * COST;
}

function run(sel: string, sizing: "equal" | "invvol", tiers: boolean, lb: number, n: number) {
  const mid = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const end = mid(traders.map((t) => t.curve.at(-1)![0]));
  const first = mid(traders.map((t) => t.curve[0][0]));
  let eq = 1, peak = 1, maxDD = 0;
  const rs: number[] = [];
  for (let d = first + lb * DAY; d + HOLD * DAY <= end; d += HOLD * DAY) {
    const cands = traders.flatMap((t) => {
      if (t.curve[0][0] > d - lb * DAY + DAY / 2 || t.curve.at(-1)![0] < d + HOLD * DAY - DAY / 2) return [];
      const f = features(t, d - lb * DAY, d);
      return f ? [{ t, f }] : [];
    });
    const picks = pick[sel](cands, n);
    // Sizing: equal, or inverse volatility (calmer traders get more), each capped at 2× equal.
    let w = picks.map(() => 1 / Math.max(1, picks.length));
    if (sizing === "invvol" && picks.length) {
      const inv = picks.map((p) => 1 / p.f.vol);
      const s = inv.reduce((a, b) => a + b, 0);
      w = inv.map((x) => Math.min(x / s, 2 / picks.length));
      const ws = w.reduce((a, b) => a + b, 0);
      w = w.map((x) => x / ws);
    }
    // Drawdown tiers: exposure 100% → 60% beyond −5% → 30% beyond −10% (the rest sits in cash).
    const dd = 1 - eq / peak;
    const exposure = !tiers ? 1 : dd > 0.1 ? 0.3 : dd > 0.05 ? 0.6 : 1;
    const r = picks.length ? exposure * picks.reduce((s, p, i) => s + w[i] * copyReturn(p.t, d), 0) : 0;
    rs.push(r);
    eq *= 1 + r;
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, 1 - eq / peak);
  }
  const total = eq - 1;
  return { sel, sizing, tiers, lb, n, periods: rs.length, total, maxDD, ratio: total / Math.max(maxDD, 0.005), win: rs.filter((r) => r > 0).length / Math.max(1, rs.length), worst: Math.min(...rs) };
}

const out = [];
const LBS = (process.env.LB ?? "10,14").split(",").map(Number);
const NS = (process.env.N ?? "4,8").split(",").map(Number);
for (const lb of LBS)
  for (const n of NS)
    for (const sel of Object.keys(pick).filter((k) => k !== "everyone"))
      for (const sizing of ["equal", "invvol"] as const) for (const tiers of [false, true]) out.push(run(sel, sizing, tiers, lb, n));
for (const lb of LBS) out.push(run("everyone", "equal", false, lb, Infinity));

if (process.env.JSON) {
  console.log(JSON.stringify(out.map((r) => ({ ...r, n: r.n === Infinity ? 0 : r.n, hold: HOLD }))));
  process.exit(0);
}
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
console.log(`Universe ${traders.length} traders · hold ${HOLD}d · cost ${(COST * 100).toFixed(2)}% of volume · stop ${STOP * 100}%\n`);
console.log("pick       sizing  tiers  lb   N  periods   total    maxDD  ret/DD   win   worst");
for (const r of out.sort((a, b) => b.ratio - a.ratio))
  console.log(`${r.sel.padEnd(10)} ${r.sizing.padEnd(7)} ${(r.tiers ? "on" : "off").padEnd(5)} ${String(r.lb).padStart(3)} ${String(r.n === Infinity ? "all" : r.n).padStart(3)}  ${String(r.periods).padStart(5)}  ${pct(r.total).padStart(7)}  ${pct(-r.maxDD).padStart(7)}  ${r.ratio.toFixed(2).padStart(6)}  ${(r.win * 100).toFixed(0).padStart(3)}%  ${pct(r.worst).padStart(7)}`);
