// node --experimental-strip-types --test lib/cardanoValue.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeValue } from "./cardanoValue.ts";

const POLICY = "7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae";

test("ADA only: a bare coin", () => {
  const v = decodeValue("1a05f5e100"); // 100,000,000 lovelace
  assert.equal(v.lovelace, 100_000_000n);
  assert.equal(v.assets.size, 0);
});

test("ADA plus tokens: [coin, {policy: {name: amount}}], keyed by policy+name", () => {
  // [5 ADA, { POLICY: { "sUSDr": 250_000_000, "USDr": 7 } }]
  const cbor = "82" + "1a004c4b40" + "a1" + "581c" + POLICY + "a2" + "45" + "7355534472" + "1a0ee6b280" + "44" + "55534472" + "07";
  const v = decodeValue(cbor);
  assert.equal(v.lovelace, 5_000_000n);
  assert.equal(v.assets.get(POLICY + "7355534472"), 250_000_000n);
  assert.equal(v.assets.get(POLICY + "55534472"), 7n);
});

test("big amounts (8-byte) and indefinite-length maps", () => {
  const cbor = "82" + "1b0000000ba43b7400" + "bf" + "581c" + POLICY + "a1" + "45" + "7355534472" + "1b00000002540be400" + "ff";
  const v = decodeValue(cbor);
  assert.equal(v.lovelace, 50_000_000_000n);
  assert.equal(v.assets.get(POLICY + "7355534472"), 10_000_000_000n);
});
