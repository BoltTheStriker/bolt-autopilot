// node --experimental-strip-types --test lib/cardanoTx.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { addWitnesses } from "./cardanoTx.ts";

// Hand-built CBOR pieces: a tiny body map, witness sets with fake vkey witnesses.
const body = "a300818258200000000000000000000000000000000000000000000000000000000000000000000181825839" + "01".repeat(57) + "1a000f4240021a0002a3c8";
const vkey = (b: string) => "82" + "5820" + b.repeat(32) + "5840" + b.repeat(64); // [pubkey, signature]
const tx = (ws: string) => "84" + body + ws + "f5" + "f6";

test("adds the wallet's witness to an empty witness set; the body bytes don't change", () => {
  const signed = addWitnesses(tx("a0"), "a1" + "00" + "81" + vkey("aa"));
  assert.equal(signed, tx("a1" + "00" + "81" + vkey("aa")));
  assert.ok(signed.startsWith("84" + body)); // body (what was signed) untouched
});

test("merges with witnesses already there (e.g. a script) and keeps the tag-258 set form", () => {
  const existing = "a2" + "00" + "d90102" + "81" + vkey("bb") + "01" + "80"; // vkeys (set) + native scripts
  const signed = addWitnesses(tx(existing), "a1" + "00" + "81" + vkey("aa"));
  assert.equal(signed, tx("a2" + "00" + "d90102" + "82" + vkey("bb") + vkey("aa") + "01" + "80"));
  // The same wallet signing twice doesn't add a duplicate.
  assert.equal(addWitnesses(signed, "a1" + "00" + "81" + vkey("aa")), signed);
});

test("rejects things that aren't transactions", () => {
  assert.throws(() => addWitnesses("a0", "a0"), /not a transaction/);
});
