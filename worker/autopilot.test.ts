// node --experimental-strip-types --test worker/autopilot.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { copySpecs, defaultRules, describeRules, excludedSymbols, isCrypto, advanceMark, pickTraders, realWorldShareOf, sanitizeRules, weekCurve, WEEK_POINTS, coverageFor, type Candidate } from "./autopilot.ts";

const SYMBOLS = ["BTC-USD", "ETH-USD", "ADA-USD", "SP500-USD", "XAU-USD", "WTI-USD", "NVDA-USD"];
const cands: Candidate[] = [
  { lead: "0xsteady", score: 0.6, dd: 0.02, roi30d: 0.15, realWorldShare: 0.1 },
  { lead: "0xbest", score: 0.7, dd: 0.15, roi30d: 0.3, realWorldShare: 0.5 },
  { lead: "0xrocket", score: 0.62, dd: 0.2, roi30d: 1.2, realWorldShare: 0 },
  { lead: "0xmacro", score: 0.5, dd: 0.05, roi30d: 0.2, realWorldShare: 0.9 },
];

test("rules are validated; leverage and stop-loss can't be looser than the risk level", () => {
  assert.equal(sanitizeRules({ ...defaultRules(300), risk: "yolo" }), null);
  const r = sanitizeRules({ ...defaultRules(9_999, "low"), maxLeverage: 50, stopLossPct: 0.9, traders: 20 })!;
  assert.deepEqual([r.budgetUsd, r.maxLeverage, r.stopLossPct, r.traders], [500, 3, 0.1, 6]); // beta cap, low-risk limits
});

test("markets: crypto vs real-world symbols become Strike exclusions", () => {
  assert.ok(isCrypto("BTC-USD") && !isCrypto("XAU-USD") && !isCrypto("SP500"));
  assert.deepEqual(excludedSymbols("realworld", SYMBOLS), ["BTC-USD", "ETH-USD", "ADA-USD"]);
  assert.deepEqual(excludedSymbols("crypto", SYMBOLS), ["SP500-USD", "XAU-USD", "WTI-USD", "NVDA-USD"]);
  assert.deepEqual(excludedSymbols("all", SYMBOLS), []);
});

test("goals change the order: steady = calmest good traders, growth = more upside, balanced = score", () => {
  const r = (goal: "steady" | "balanced" | "growth") => pickTraders(cands, { ...defaultRules(300), goal, traders: 2 }).map((c) => c.lead);
  assert.deepEqual(r("balanced"), ["0xbest", "0xrocket"]);
  assert.deepEqual(r("steady"), ["0xbest", "0xsteady"]); // 0.7×0.85 = 0.595 vs 0.6×0.98 = 0.588 vs rocket 0.496
  assert.deepEqual(r("growth"), ["0xrocket", "0xbest"]);
  // Real-world only: traders who barely trade there drop out.
  assert.deepEqual(pickTraders(cands, { ...defaultRules(300), markets: "realworld", traders: 3 }).map((c) => c.lead), ["0xbest", "0xmacro"]);
});

test("copy specs: risk sets how much works and Strike's limits; small budgets copy fewer traders", () => {
  const low = copySpecs(cands.slice(0, 3), { ...defaultRules(300, "low"), traders: 3 }, SYMBOLS);
  // Low risk deploys 50% of $300 = $150 → 3 copies of $50, 3x leverage cap, stop at −10%.
  assert.deepEqual(low.map((s) => [s.amount, s.maxLeverage, s.stopLossUsd, s.multiplier]), [[50, 3, 5, 1], [50, 3, 5, 1], [50, 3, 5, 1]]);
  const high = copySpecs(cands.slice(0, 2), { ...defaultRules(400, "high"), traders: 2, maxLeverage: 10 }, SYMBOLS);
  assert.deepEqual(high.map((s) => [s.amount, s.multiplier, s.maxMarginPerSymbol]), [[200, 2, 100], [200, 2, 100]]);
  // $120 at medium risk = $90 working: only one $90 copy fits the $50 minimum.
  assert.equal(copySpecs(cands, { ...defaultRules(120), traders: 3 }, SYMBOLS).length, 1);
  assert.equal(copySpecs(cands, { ...defaultRules(40), traders: 3 }, SYMBOLS).length, 0);
});

test("rules read as plain language", () => {
  assert.match(describeRules({ ...defaultRules(300, "low"), markets: "realworld" }), /low risk: 50% of \$300 working.*real-world markets only.*leverage capped at 3x/);
});

test("real-world share from Strike's top assets: xyz: markets and listed stocks count, coins don't", () => {
  assert.equal(realWorldShareOf([{ asset: "UNITREE", symbol: "UNITREE-USD" }, { asset: "XYZ:ZHIPU", symbol: "" }, { asset: "BTC", symbol: "BTC-USD" }, { asset: "LIT", symbol: "" }]), 0.5);
  assert.equal(realWorldShareOf([]), 0);
});

test("weekCurve: last 7 days of the 30-day curve, rebased to 0 a week ago", () => {
  const D = 86_400_000;
  const now = 30 * D;
  // +10% by 7 days ago, +21% now: the curve's week is +10% (1.21 / 1.10 − 1), rising half way through.
  const curve: [number, number][] = [[0, 0], [23 * D, 0.1], [26.5 * D, 0.155], [30 * D, 0.21]];
  const w = weekCurve(curve, 0.1, now);
  assert.equal(w.length, WEEK_POINTS);
  assert.equal(w[0], 0);
  assert.equal(w.at(-1), 0.1);
  assert.ok(w[14] > 0.04 && w[14] < 0.06); // shape kept: about half way at mid-week
  // Strike's own 7-day return wins: same shape, scaled to end there.
  const scaled = weekCurve(curve, 0.05, now);
  assert.equal(scaled.at(-1), 0.05);
  assert.ok(Math.abs(scaled[14] - w[14] / 2) < 0.002);
  // A curve that disagrees on direction isn't trusted: straight line instead.
  assert.ok(Math.abs(weekCurve(curve, -0.03, now)[14] + 0.015) < 1e-9);
  // No usable curve: a straight line to the 7-day return.
  const line = weekCurve([], 0.14, now);
  assert.equal(line[0], 0);
  assert.equal(line.at(-1), 0.14);
});

test("advanceMark: profit from closed trades plus the change in open positions; deposits don't count", () => {
  const p = [{ coin: "BTC", long: true, pnl: 0 }];
  const a = advanceMark(undefined, { unrealized: 500, realized: 0, acct: 10_000, at: 0, positions: p });
  assert.equal(a.pnl, 0); // starts at zero
  const b = advanceMark(a, { unrealized: 800, realized: 0, acct: 10_000, at: 1, positions: p });
  assert.equal(b.pnl, 300); // open position gained $300
  const c = advanceMark(b, { unrealized: 0, realized: 750, acct: 25_000, at: 2, positions: [] });
  assert.equal(c.pnl, 250); // closed for +$750 realized; the $800 open profit is gone: net −$50 this step
  assert.equal(c.acct, 25_000); // a deposit changes the account size, not the profit
});

test("pickTraders keeps copies that are still ranked, and fills only empty slots", () => {
  const c = (lead: string, score: number): Candidate => ({ lead, score, dd: 0.05, roi30d: 0.2, realWorldShare: 0.2 });
  const cands = [c("0xnew", 0.9), c("0xheld", 0.4), c("0xmid", 0.6)];
  const rules = { ...defaultRules(500), traders: 2 };
  assert.deepEqual(pickTraders(cands, rules).map((x) => x.lead), ["0xnew", "0xmid"]); // fresh: best two
  assert.deepEqual(pickTraders(cands, rules, ["0xHELD"]).map((x) => x.lead), ["0xheld", "0xnew"]); // held stays, best fills the slot
  assert.deepEqual(pickTraders(cands, rules, ["0xgone"]).map((x) => x.lead), ["0xnew", "0xmid"]); // dropped off the ranking: replaced
});

test("new picks must be copyable at the user's own copy size", () => {
  const cov = (pairs: [number, number][]) => pairs.map(([amount, share]) => ({ amount, share }));
  const big = { lead: "0xbig", score: 0.9, dd: 0.05, roi30d: 0.2, realWorldShare: 0.2, coverage: cov([[100, 0.3], [250, 0.7]]) }; // needs $250+ copies
  const any = { lead: "0xany", score: 0.5, dd: 0.05, roi30d: 0.2, realWorldShare: 0.2, coverage: cov([[50, 0.8]]) };
  assert.equal(coverageFor(big, 120), 0.3);
  assert.equal(coverageFor(big, 300), 0.7);
  const small = { ...defaultRules(300), risk: "medium" as const, traders: 2 }; // $112 per copy
  assert.deepEqual(pickTraders([big, any], small).map((c) => c.lead), ["0xany"]);
  const large = { ...defaultRules(500), risk: "high" as const, traders: 2 }; // $250 per copy
  assert.deepEqual(pickTraders([big, any], large).map((c) => c.lead), ["0xbig", "0xany"]);
  assert.deepEqual(pickTraders([big, any], small, ["0xbig"]).map((c) => c.lead), ["0xbig", "0xany"]); // a held copy isn't dropped for this
});
