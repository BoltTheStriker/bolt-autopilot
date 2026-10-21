// node --experimental-strip-types --test bot/markets.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { strikeBase, strikeShare } from "./markets.ts";

const strike = new Set(["BTC", "HYPE", "NEAR", "XAU", "WTI", "NAS100"]);

test("Hyperliquid names map to Strike's: plain perps, xyz aliases, no spot", () => {
  assert.equal(strikeBase("BTC"), "BTC");
  assert.equal(strikeBase("xyz:GOLD"), "XAU");
  assert.equal(strikeBase("xyz:CL"), "WTI");
  assert.equal(strikeBase("xyz:XYZ100"), "NAS100");
  assert.equal(strikeBase("xyz:NVDA"), "NVDA");
  assert.equal(strikeBase("@107"), null);
  assert.equal(strikeBase("flx:FOO"), null);
});

test("share of trading Strike can copy, by notional, ignoring spot", () => {
  const fills = [
    { coin: "LIT", px: 1, sz: 900 }, // not on Strike
    { coin: "BTC", px: 100, sz: 1 },
    { coin: "@107", px: 1, sz: 5000 }, // spot: ignored
  ];
  assert.equal(strikeShare(fills, [], strike), 0.1);
  assert.equal(strikeShare([], [{ coin: "xyz:GOLD", value: 50 }, { coin: "ENA", value: 50 }], strike), 0.5);
  assert.equal(strikeShare([], [], strike), undefined); // nothing to judge
  assert.equal(strikeShare(fills, [], null), undefined); // no market list
});
