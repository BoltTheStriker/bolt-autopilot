// node --experimental-strip-types --test lib/wallet.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { cborUint, stakeOf } from "./wallet.ts";

test("cborUint: CIP-30 amounts in each CBOR size", () => {
  assert.equal(cborUint(BigInt(5)), "05");
  assert.equal(cborUint(BigInt(200)), "18c8");
  assert.equal(cborUint(BigInt(1000)), "1903e8");
  assert.equal(cborUint(BigInt(253_000_000)), "1a0f147940");
  assert.equal(cborUint(BigInt(10_000_000_000)), "1b00000002540be400");
});

test("stakeOf: the same stake key for two base addresses of one account; none for other address types", () => {
  // The public $BOLT team wallet (a base address): 57 bytes, the last 28 are the stake key.
  const team = "addr1q9uwmv5vuc36nppyzflhhprlg7tg9dcl22ge2eppcdc0fqhs6a964q4c8uxnuf8hkdthn7yzma2lzm58l9xjnndy2xysxa4jek";
  const s = stakeOf(team)!;
  assert.match(s, /^[0-9a-f]{56}$/);
  assert.equal(stakeOf("addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8"), undefined); // enterprise address
});
