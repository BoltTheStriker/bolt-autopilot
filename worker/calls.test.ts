// node --experimental-strip-types --test worker/calls.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { authorStats, callReturn, closeCall, leaders, newCall, settle, type Call, type CallStore } from "./calls.ts";

const T = Date.parse("2026-10-26T12:00:00Z");
const marks = { "BTC-USD": 80_000, "XAU-USD": 4_000 };
const ok = (c: Call | { error: string }) => {
  if ("error" in c) throw new Error(c.error);
  return c;
};

test("a call's entry is the mark price now, with take-profit and stop-loss as prices on the right side", () => {
  const store: CallStore = { calls: [] };
  const long = ok(newCall(store, { symbol: "btc-usd", side: "long", leverage: 5, tpPct: 0.1, slPct: 0.05, thesis: "ETF inflows keep coming" }, "stake1a", marks, T));
  assert.equal(long.entry, 80_000);
  assert.equal(long.tp, 88_000);
  assert.equal(long.sl, 76_000);
  const short = ok(newCall(store, { symbol: "XAU-USD", side: "short", leverage: 2, tpPct: 0.05, thesis: "Gold looks stretched here" }, "stake1a", marks, T));
  assert.equal(short.tp, 3_800);
  assert.equal(short.sl, null);
});

test("bad calls are refused with a reason", () => {
  const store: CallStore = { calls: [] };
  const base = { symbol: "BTC-USD", side: "long", leverage: 5, thesis: "A good reason to go long" };
  assert.match((newCall(store, { ...base, symbol: "FAKE-USD" }, "a", marks, T) as { error: string }).error, /markets/);
  assert.match((newCall(store, { ...base, side: "up" }, "a", marks, T) as { error: string }).error, /long or short/);
  assert.match((newCall(store, { ...base, leverage: 50 }, "a", marks, T) as { error: string }).error, /Leverage/);
  assert.match((newCall(store, { ...base, thesis: "moon" }, "a", marks, T) as { error: string }).error, /why/);
  // At 10x a 15% stop never fires: the position is liquidated at about 10% first.
  assert.match((newCall(store, { ...base, leverage: 10, slPct: 0.15 }, "a", marks, T) as { error: string }).error, /liquidated/);
});

test("an author can hold at most 3 open calls", () => {
  const store: CallStore = { calls: [] };
  for (let i = 0; i < 3; i++) store.calls.push(ok(newCall(store, { symbol: "BTC-USD", side: "long", leverage: 2, thesis: "Long BTC, again and again" }, "a", marks, T + i)));
  assert.match((newCall(store, { symbol: "BTC-USD", side: "long", leverage: 2, thesis: "One more for luck" }, "a", marks, T + 9) as { error: string }).error, /open calls/);
  assert.ok(!("error" in newCall(store, { symbol: "BTC-USD", side: "long", leverage: 2, thesis: "Someone else's call" }, "b", marks, T + 9)));
});

test("returns are the price move times leverage, both ways", () => {
  const store: CallStore = { calls: [] };
  const long = ok(newCall(store, { symbol: "BTC-USD", side: "long", leverage: 5, thesis: "Breakout above the range" }, "a", marks, T));
  const short = ok(newCall(store, { symbol: "BTC-USD", side: "short", leverage: 5, thesis: "Fade the breakout here" }, "b", marks, T));
  assert.ok(Math.abs(callReturn(long, 82_000)! - 0.125) < 1e-9); // +2.5% × 5
  assert.ok(Math.abs(callReturn(short, 82_000)! + 0.125) < 1e-9);
});

test("calls close at their own take-profit or stop-loss level, and stats count only closed calls", () => {
  const store: CallStore = { calls: [] };
  const a = ok(newCall(store, { symbol: "BTC-USD", side: "long", leverage: 2, tpPct: 0.05, slPct: 0.02, thesis: "Bounce off support" }, "a", marks, T));
  const b = ok(newCall(store, { symbol: "BTC-USD", side: "long", leverage: 2, tpPct: 0.05, slPct: 0.02, thesis: "Second leg higher" }, "a", marks, T));
  const c = ok(newCall(store, { symbol: "BTC-USD", side: "long", leverage: 2, thesis: "Slow grind up" }, "a", marks, T));
  store.calls.push(a, b, c);
  assert.equal(settle(a, 81_000, T + 1), false); // between its levels: still open
  assert.equal(settle(a, 84_500, T + 2), true); // past +5%: closes at 84,000, not 84,500
  assert.equal(a.status, "tp");
  assert.equal(a.exit, 84_000);
  assert.equal(settle(b, 78_000, T + 3), true);
  assert.equal(b.status, "sl");
  assert.equal(closeCall(c, 80_800, T + 4), true);
  const s = authorStats(store.calls, "a");
  assert.equal(s.closed, 3);
  assert.equal(s.wins, 2);
  assert.ok(Math.abs(s.avgReturn! - (0.1 - 0.04 + 0.02) / 3) < 1e-9);
  assert.deepEqual(leaders(store.calls).map((l) => l.author), ["a"]);
  assert.deepEqual(leaders(store.calls, 4), []); // too few closed calls to rank
});

test("order sizes are rounded down to Strike's step and checked against its minimum", async () => {
  const { sizeFor, toStep } = await import("./strikeMarkets.ts");
  assert.equal(toStep(0.0012345, 0.00001), "0.00123");
  assert.equal(toStep(12.7, 1), "12");
  const btc = { symbol: "BTC-USD", qtyStep: 0.00001, minQty: 0.00001, minNotional: 10, tick: 0.1 };
  assert.deepEqual(sizeFor(20, 5, 80_000, btc), { size: "0.00125", notional: 100 }); // $20 at 5x = $100 of BTC
  assert.ok("error" in sizeFor(1, 2, 80_000, btc)); // a $2 position is under the $10 minimum
});
