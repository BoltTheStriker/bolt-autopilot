// node --experimental-strip-types --test lib/rulesReplay.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultRules, WEEK_POINTS, type PreviewTrader } from "../worker/autopilot.ts";
import { replayWeek } from "./rulesReplay.ts";

const line = (end: number) => Array.from({ length: WEEK_POINTS }, (_, i) => (end * i) / (WEEK_POINTS - 1));
const trader = (lead: string, score: number, week: number[], roi30d = 0.2, dd = 0.05): PreviewTrader => ({ lead, score, dd, roi30d, realWorldShare: 0.3, roi7d: week.at(-1)!, week, open: [] });

test("replays the picks over the week, on the whole budget (reserve included)", () => {
  const rules = { ...defaultRules(1000, "medium"), traders: 2 }; // 2 × $375 working
  const r = replayWeek([trader("A", 0.9, line(0.1)), trader("B", 0.8, line(0.02))], rules)!;
  assert.equal(r.copies.length, 2);
  assert.equal(r.curve.length, WEEK_POINTS);
  assert.equal(r.pnl, 375 * 0.1 + 375 * 0.02); // $45 on $1,000
  assert.equal(r.ret, 0.045);
  assert.equal(r.worst, 0);
});

test("a stop-loss caps a copy's loss; High risk sizes copies 2×", () => {
  const med = { ...defaultRules(1000, "medium"), traders: 1 }; // $750, stop at −15%
  const r = replayWeek([trader("A", 0.9, line(-0.3))], med)!;
  assert.equal(r.copies[0].stopped, true);
  assert.equal(r.pnl, -750 * 0.15);
  const high = { ...defaultRules(1000, "high"), traders: 1 }; // $1,000 at 2×
  assert.equal(replayWeek([trader("A", 0.9, line(0.05))], high)!.pnl, 1000 * 0.05 * 2);
});

test("profit lock banks a gain and copies again; the daily limit closes copies until tomorrow", () => {
  const lock = { ...defaultRules(1000, "medium"), traders: 1, profitLockPct: 0.05 };
  const banked = replayWeek([trader("A", 0.9, line(0.2))], lock)!;
  assert.ok(banked.copies[0].ret > 0.05);
  // A sharp fall on day one: −8% of the budget triggers the daily limit; the copy waits for tomorrow.
  const crash = Array.from({ length: WEEK_POINTS }, (_, i) => (i === 0 ? 0 : i <= 2 ? -0.12 * i : -0.24));
  const r = replayWeek([trader("A", 0.9, crash)], { ...defaultRules(1000, "medium"), traders: 1, stopLossPct: 0.15, dailyLossPct: 0.08 })!;
  assert.ok(r.pnl > -750 * 0.15 - 0.01); // never worse than the stop-loss
  assert.ok(r.worst < 0);
});

test("no trader fits: no replay", () => {
  assert.equal(replayWeek([], defaultRules(1000)), null);
});
