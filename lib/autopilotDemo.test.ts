// node --experimental-strip-types --test lib/autopilotDemo.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_BALANCE, demoCopies, demoValue, startDemo, stepDemo } from "./autopilotDemo.ts";
import { defaultRules, type LiveMark, type PreviewTrader } from "../worker/autopilot.ts";

const t = (lead: string, score: number): PreviewTrader => ({ lead, score, dd: 0.05, roi30d: 0.2, realWorldShare: 0.2, roi7d: 0.05, week: [], open: [] });
const mark = (pnl: number, positions: LiveMark["positions"] = [], since = 1): LiveMark => ({ pnl, unrealized: 0, acct: 10_000, since, at: 0, positions });
const rules = { ...defaultRules(DEMO_BALANCE, "medium"), traders: 2 }; // 75% working: 2 × $375

test("starts at $1,000 with the engine's picks and moves with each trader's profit ÷ account size", () => {
  const d0 = startDemo([t("a", 0.9), t("b", 0.8), t("c", 0.1)], { a: mark(0), b: mark(500), c: mark(0) }, rules, 0);
  assert.deepEqual(d0.copies.map((c) => c.lead), ["a", "b"]);
  assert.equal(demoValue(d0, rules.stopLossPct), DEMO_BALANCE);
  // a makes $500 on a $10K account (+5%), b loses $200 (−2%).
  const d1 = stepDemo(d0, { a: mark(500), b: mark(300) }, rules, 60_000);
  const [a, b] = demoCopies(d1, { a: mark(500), b: mark(300) }, rules.stopLossPct);
  assert.equal(a.pnl, 18.75); // $375 × 5%
  assert.equal(b.pnl, -7.5); // $375 × −2%
  assert.equal(demoValue(d1, rules.stopLossPct), DEMO_BALANCE + 18.75 - 7.5);
});

test("stop-loss closes a copy at its limit and it stays closed", () => {
  const d0 = startDemo([t("a", 0.9)], { a: mark(0) }, { ...rules, traders: 1 }, 0);
  const d1 = stepDemo(d0, { a: mark(-2_000) }, { ...rules, traders: 1 }, 60_000); // −20% < −15%
  assert.notEqual(d1.copies[0].stopped, null);
  assert.ok(d1.log.some((l) => /Stop-loss/.test(l.text)));
  const d2 = stepDemo(d1, { a: mark(5_000) }, { ...rules, traders: 1 }, 120_000); // recovers: too late
  assert.equal(demoCopies(d2, {}, rules.stopLossPct)[0].pnl, -0.15 * d0.copies[0].amount);
});

test("logs what the trader opens and closes; a feed restart doesn't jump the copy", () => {
  const d0 = startDemo([t("a", 0.9)], { a: mark(0) }, { ...rules, traders: 1 }, 0);
  const d1 = stepDemo(d0, { a: mark(100, [{ coin: "xyz:GOLD", long: true, pnl: 100 }]) }, { ...rules, traders: 1 }, 60_000);
  assert.ok(d1.log.some((l) => l.text.includes("opened GOLD long")));
  const before = d1.copies[0].ret;
  const d2 = stepDemo(d1, { a: mark(0, [], 2) }, { ...rules, traders: 1 }, 120_000); // feed restarted at 0
  assert.equal(d2.copies[0].ret, before);
  assert.ok(d2.log.some((l) => l.text.includes("closed GOLD long")));
});

test("Autopilot mode: a stopped copy's money moves to the next best fit; the money adds up", () => {
  const T0 = Date.UTC(2026, 9, 22, 12);
  const am = (pnl: number): LiveMark => ({ pnl, unrealized: 0, acct: 100_000, since: T0, at: T0, positions: [] });
  const traders = ["A", "B", "C", "D"].map((l, i) => t(l, 0.9 - i * 0.1));
  const start = startDemo(traders, { A: am(0), B: am(0), C: am(0), D: am(0) }, rules, T0);
  assert.deepEqual(start.copies.map((c) => c.lead), ["A", "B"]);
  assert.deepEqual(start.bench, ["C", "D"]);
  // A's trader loses 20% of their account: the copy hits its stop-loss (−15%).
  const marks = { A: am(-20_000), B: am(0), C: am(500), D: am(0) };
  const plain = stepDemo(start, marks, rules, T0 + 60_000);
  const auto = stepDemo(start, marks, rules, T0 + 60_000, { autopilot: true });
  assert.equal(plain.copies[0].stopped, T0 + 60_000); // "Follow my rules": the copy just stops
  assert.equal(auto.copies[0].lead, "C"); // Autopilot: what's left goes on to C
  assert.equal(auto.copies[0].stopped, null);
  assert.equal(auto.copies[0].amount, 318.75); // $375 − 15%
  assert.match(auto.log[0].text, /^Autopilot: A hit its stop-loss, so it moved the remaining \$318\.75 to C/);
  assert.equal(Math.round(demoValue(auto, rules.stopLossPct) * 100), Math.round(demoValue(plain, rules.stopLossPct) * 100)); // same money, moved
  assert.deepEqual(auto.bench, ["D"]);
});
