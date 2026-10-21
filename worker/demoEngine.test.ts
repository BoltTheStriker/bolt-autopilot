// node --experimental-strip-types --test worker/demoEngine.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { applySettings, DEFAULT_SETTINGS, newPortfolio, pickForStyle, portfolioValue, sanitizeSettings, stepPortfolio, type PoolLead } from "./demoEngine.ts";

const H = 3_600_000;
const T = 1_800_000_000_000;
const pool: PoolLead[] = [
  { lead: "0xaaaa00000000000000000000000000000000aaaa", score: 0.8, roi30d: 0.3, dd: 0.05 },
  { lead: "0xbbbb00000000000000000000000000000000bbbb", score: 0.7, roi30d: 1.2, dd: 0.2 },
  { lead: "0xcccc00000000000000000000000000000000cccc", score: 0.6, roi30d: 0.2, dd: 0.08 },
];
const [A, B, C] = pool.map((l) => l.lead);
const idx = () => ({ [A]: 1, [B]: 1, [C]: 1 });

test("settings are validated and clamped", () => {
  assert.equal(sanitizeSettings({ traders: 3, style: "wild" }), null);
  const s = sanitizeSettings({ traders: 99, style: "bold", stopLoss: 0.9, trailing: 0.01, tp: { mode: "bank", pct: 2 } })!;
  assert.deepEqual([s.traders, s.stopLoss, s.trailing, s.tp.pct], [10, 0.25, 0.1, 0.5]);
  assert.equal(sanitizeSettings({ ...DEFAULT_SETTINGS, trailing: null })!.trailing, null);
});

test("styles: Steady prefers the calmest, Balanced ranks by score, Bold by returns", () => {
  assert.deepEqual(pickForStyle(pool, "steady").map((l) => l.lead), [A, C, B]);
  assert.deepEqual(pickForStyle(pool, "balanced").map((l) => l.lead), [A, B, C]);
  assert.deepEqual(pickForStyle(pool, "bold").map((l) => l.lead)[0], B);
});

test("fills N traders evenly, and follows each trader's index", () => {
  const pf = newPortfolio(10_000, T, { ...DEFAULT_SETTINGS, traders: 2 });
  stepPortfolio(pf, pool, idx(), T);
  assert.deepEqual(pf.positions.map((p) => p.lead), [A, B]);
  assert.equal(Math.round(pf.cash), 0);
  const i = { ...idx(), [A]: 1.1 }; // A up 10%
  stepPortfolio(pf, pool, i, T + H);
  assert.equal(Math.round(portfolioValue(pf, i)), 10_500);
});

test("stop-loss and trailing stop close copies and cool the trader down", () => {
  const pf = newPortfolio(10_000, T, { ...DEFAULT_SETTINGS, traders: 1, stopLoss: 0.1, trailing: 0.2 });
  stepPortfolio(pf, pool, idx(), T);
  stepPortfolio(pf, pool, { ...idx(), [A]: 0.89 }, T + H); // −11%
  assert.match(pf.decisions.find((d) => d.kind === "close")!.text, /stop-loss/);
  assert.ok(pf.cooldowns[A] > T + H);
  assert.equal(pf.positions[0].lead, B); // refilled with the next pick
  // Trailing: B rises 50% then falls 25% off its best → closed.
  stepPortfolio(pf, pool, { ...idx(), [A]: 0.89, [B]: 1.5 }, T + 2 * H);
  stepPortfolio(pf, pool, { ...idx(), [A]: 0.89, [B]: 1.12 }, T + 3 * H);
  assert.match(pf.decisions[1].text, /trailing/);
});

test("take profit: bank & keep moves profit to cash and keeps copying; close stops", () => {
  const bank = newPortfolio(10_000, T, { ...DEFAULT_SETTINGS, traders: 1, tp: { mode: "bank", pct: 0.1 } });
  stepPortfolio(bank, pool, idx(), T);
  stepPortfolio(bank, pool, { ...idx(), [A]: 1.12 }, T + H);
  assert.equal(bank.positions[0].lead, A);
  assert.equal(Math.round(bank.banked), 1_200); // set aside, not reinvested
  assert.equal(Math.round(bank.cash), 0);
  assert.equal(Math.round(bank.positions[0].cost), 10_000);
  assert.equal(Math.round(portfolioValue(bank, { ...idx(), [A]: 1.12 })), 11_200);

  const close = newPortfolio(10_000, T, { ...DEFAULT_SETTINGS, traders: 1, tp: { mode: "close", pct: 0.1 } });
  stepPortfolio(close, pool, idx(), T);
  stepPortfolio(close, pool, { ...idx(), [A]: 1.12 }, T + H);
  assert.match(close.decisions.find((d) => d.kind === "close")!.text, /took profit/);
  assert.equal(close.positions[0].lead, B);
});

test("settings apply from now: fewer traders trims the weakest; more traders rebalances", () => {
  const pf = newPortfolio(9_000, T, { ...DEFAULT_SETTINGS, traders: 3 });
  stepPortfolio(pf, pool, idx(), T);
  applySettings(pf, { ...pf.settings, traders: 1 }, T + H);
  stepPortfolio(pf, pool, idx(), T + H);
  assert.deepEqual(pf.positions.map((p) => p.lead), [A]);
  assert.equal(Math.round(pf.positions[0].cost), 9_000); // the dropped traders' money went to the one left
  assert.equal(Math.round(pf.cash), 0);
  applySettings(pf, { ...pf.settings, traders: 3 }, T + 2 * H);
  stepPortfolio(pf, pool, idx(), T + 2 * H);
  assert.equal(pf.positions.length, 3);
  assert.ok(pf.positions.every((p) => Math.round(p.cost) === 3_000));
  assert.equal(Math.round(portfolioValue(pf, idx())), 9_000); // no money created or lost
});

test("a trader leaving the bot's shortlist is dropped (no cooldown)", () => {
  const pf = newPortfolio(10_000, T, { ...DEFAULT_SETTINGS, traders: 1 });
  stepPortfolio(pf, pool, idx(), T);
  stepPortfolio(pf, pool.slice(1), idx(), T + H);
  assert.match(pf.decisions.find((d) => d.kind === "close")!.text, /shortlist/);
  assert.equal(pf.cooldowns[A], undefined);
});

test("leverage multiplies each copy's move, both ways, and is clamped to 1–3", () => {
  assert.equal(sanitizeSettings({ ...DEFAULT_SETTINGS, leverage: 9 })!.leverage, 3);
  assert.equal(sanitizeSettings({ ...DEFAULT_SETTINGS, leverage: undefined })!.leverage, 1);
  const pf = newPortfolio(10_000, T, { ...DEFAULT_SETTINGS, traders: 1, leverage: 2, trailing: null });
  stepPortfolio(pf, pool, idx(), T);
  stepPortfolio(pf, pool, { ...idx(), [A]: 1.05 }, T + H); // trader +5%
  assert.equal(Math.round(portfolioValue(pf, { ...idx(), [A]: 1.05 })), 11_000); // copy +10%
  stepPortfolio(pf, pool, { ...idx(), [A]: 1.05 * 0.96 }, T + 2 * H); // trader −4% from there
  assert.equal(Math.round(portfolioValue(pf, { ...idx(), [A]: 1.008 })), 10_120); // copy −8%: 11,000 × 0.92
  // At 3x a 5% drop is a 15% loss: the 15% stop-loss fires.
  const three = newPortfolio(10_000, T, { ...DEFAULT_SETTINGS, traders: 1, leverage: 3 });
  stepPortfolio(three, pool, idx(), T);
  stepPortfolio(three, pool, { ...idx(), [A]: 0.95 }, T + H);
  assert.match(three.decisions.find((d) => d.kind === "close")!.text, /stop-loss/);
});

test("Aggressive copies the bot's top picks only (not this week's hottest), at most 3", () => {
  const hot = [...pool, { lead: "0xdddd00000000000000000000000000000000dddd", score: 0.5, roi30d: 0.1, roi7d: 1.5, dd: 0.3 }];
  const D = hot[3].lead;
  assert.equal(pickForStyle(hot, "aggressive")[0].lead, A); // best score, not the hottest week (D)
  const pf = newPortfolio(9_000, T, { ...DEFAULT_SETTINGS, traders: 10, style: "aggressive" });
  stepPortfolio(pf, hot, { ...idx(), [D]: 1 }, T);
  assert.equal(pf.positions.length, 3);
  assert.deepEqual(pf.positions.map((p) => p.lead), [A, B, C]);
  assert.ok(pf.positions.every((p) => Math.round(p.cost) === 3_000));
});

test("first-version copies (units) carry their value over", () => {
  const pf = newPortfolio(0, T, { ...DEFAULT_SETTINGS, traders: 1 });
  pf.positions = [{ lead: A, units: 5_000, cost: 5_000, peak: 5_000, openedAt: T, lastIdx: 1 }];
  stepPortfolio(pf, pool, { ...idx(), [A]: 1.2 }, T + H);
  assert.equal(Math.round(pf.positions[0].val!), 6_000);
  assert.equal(pf.positions[0].units, undefined);
});
