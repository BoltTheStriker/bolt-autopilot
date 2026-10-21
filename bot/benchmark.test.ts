// node --experimental-strip-types --test bot/benchmark.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { bot } from "./config.ts";
import { curveStats, initialBenchmark, stepBenchmark, stepTop, topReturners, TOP_N } from "./benchmark.ts";
import type { Lead } from "./strategy.ts";

const NOW = Date.UTC(2026, 9, 22, 6);
const lead = (address: string, roi30d: number, o: Partial<Lead> = {}): Lead => ({
  address,
  platform: "hyperliquid",
  account_value: "100000",
  pnl: { "1d": "0", "7d": "0", "30d": "0", all: "50000" },
  roi: { "1d": "0", "7d": "0.02", "30d": String(roi30d), all: "0.5" },
  volume: { "1d": "0", "7d": "0", "30d": "0", all: "1000000" },
  last_traded_at_ms: NOW - 3_600_000,
  ...o,
});

test("topReturners: the best 30-day returns among real, active accounts", () => {
  const cands = [lead("a", 0.5), lead("b", 2.0), lead("tiny", 9, { account_value: "500" }), lead("idle", 3, { last_traded_at_ms: NOW - 10 * 86_400_000 }), lead("c", 1.0)];
  assert.deepEqual(topReturners(cands, bot, NOW, 2).map((l) => l.address), ["b", "c"]);
});

test("stepTop: buys the day's top N in equal parts, marks with the bot's fee model, re-picks the next day", () => {
  const cands = Array.from({ length: 12 }, (_, i) => lead(`L${i}`, 1 - i * 0.05));
  const b1 = stepTop({ cash: 1000, positions: [], pickedDay: null }, cands, new Map(), bot, NOW);
  assert.equal(b1.positions.length, TOP_N);
  assert.equal(b1.positions[0].value, 100);
  // L0 makes $10k on a $100k account (+10%), no extra volume: its $100 copy is worth $110.
  const later = cands.map((c) => (c.address === "L0" ? { ...c, pnl: { ...c.pnl, all: "60000" } } : c));
  const b2 = stepTop(b1, later, new Map(), bot, NOW + 6 * 3_600_000);
  assert.equal(Math.round(b2.positions.find((p) => p.lead === "L0")!.value * 100) / 100, 110);
  assert.equal(b2.pickedDay, b1.pickedDay); // same day: no re-pick
  const b3 = stepTop(b2, later, new Map(), bot, NOW + 24 * 3_600_000);
  assert.notEqual(b3.pickedDay, b1.pickedDay);
  assert.equal(Math.round(b3.positions.reduce((t, p) => t + p.value, 0) + b3.cash), 1010); // value carried into the new picks
});

test("stepBenchmark: both books advance and the curve gets a point", () => {
  const cands = Array.from({ length: 12 }, (_, i) => lead(`L${i}`, 0.3 - i * 0.01, { copy_score: "70", recommended_direction: "copy" }));
  const b = stepBenchmark(initialBenchmark(bot, NOW), cands, cands, new Map(), bot, NOW);
  assert.equal(b.points.length, 2);
  assert.equal(b.top.positions.length, TOP_N);
});

test("curveStats: return, worst drop, return per unit of drop", () => {
  const s = curveStats([1000, 1100, 990, 1050]);
  assert.equal(Math.round(s.ret * 1000) / 1000, 0.05);
  assert.equal(Math.round(s.maxDrawdown * 1000) / 1000, 0.1);
  assert.equal(Math.round(s.retPerDrawdown! * 100) / 100, 0.5);
  assert.equal(curveStats([1000]).retPerDrawdown, null);
});
