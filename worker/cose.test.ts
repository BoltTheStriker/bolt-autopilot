// node --experimental-strip-types --test worker/cose.test.ts
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { blake2b, cborDecode, hex, sigStructure, verifySignData } from "./cose.ts";

const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

test("BLAKE2b matches node's BLAKE2b-512, and the known BLAKE2b-224 vector", () => {
  for (const s of ["", "abc", "x".repeat(127), "y".repeat(128), "z".repeat(300)]) {
    assert.equal(toHex(blake2b(new TextEncoder().encode(s), 64)), createHash("blake2b512").update(s).digest("hex"), `len ${s.length}`);
  }
  assert.equal(toHex(blake2b(new Uint8Array(), 28)), "836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07");
});

test("CBOR reads maps with int and text keys, byte strings and tags", () => {
  // 18([h'a10127', {}, h'01', h'02']) with a protected map {1: -8}
  const v = cborDecode(hex("d28443a10127a041014102")) as unknown[];
  assert.equal(v.length, 4);
  assert.equal((cborDecode(v[0] as Uint8Array) as Map<unknown, unknown>).get(1), -8);
});

// A wallet's signData, built the way CIP-30 wallets do, with a fresh key.
function fakeWallet(message: string, opts: { hashed?: boolean; otherAddress?: boolean } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = new Uint8Array(publicKey.export({ format: "der", type: "spki" }).subarray(12));
  const address = Uint8Array.from([0x61, ...blake2b(pub, 28)]); // enterprise, mainnet, key hash
  const signedAddr = opts.otherAddress ? Uint8Array.from([0x61, ...new Uint8Array(28)]) : address;
  const enc = (major: number, n: number) => [(major << 5) | (n < 24 ? n : 24), ...(n < 24 ? [] : [n])];
  const bstr = (b: Uint8Array) => [...enc(2, b.length), ...b];
  const tstr = (s: string) => [...enc(3, s.length), ...new TextEncoder().encode(s)];
  const prot = Uint8Array.from([0xa2, 0x01, 0x27, ...tstr("address"), ...bstr(signedAddr)]);
  const msg = new TextEncoder().encode(message);
  const payload = opts.hashed ? blake2b(msg, 28) : msg;
  const sig = new Uint8Array(sign(null, sigStructure(prot, payload), privateKey));
  const unprot = [0xa1, ...tstr("hashed"), opts.hashed ? 0xf5 : 0xf4];
  const signature = Uint8Array.from([0x84, ...bstr(prot), ...unprot, ...bstr(payload), ...bstr(sig)]);
  const key = Uint8Array.from([0xa4, 0x01, 0x01, 0x03, 0x27, 0x20, 0x06, 0x21, ...bstr(pub)]);
  return { signature: toHex(signature), key: toHex(key), address };
}

test("accepts a real signature for the right address and message", () => {
  const w = fakeWallet("Join the cup");
  assert.equal(verifySignData(w.signature, w.key, w.address, "Join the cup"), true);
  const h = fakeWallet("Join the cup", { hashed: true });
  assert.equal(verifySignData(h.signature, h.key, h.address, "Join the cup"), true);
});

test("rejects a different message, address, or someone else's key", () => {
  const w = fakeWallet("Join the cup");
  assert.throws(() => verifySignData(w.signature, w.key, w.address, "Something else"), /different message/);
  const other = fakeWallet("Join the cup");
  assert.throws(() => verifySignData(w.signature, w.key, other.address, "Join the cup"), /different address/);
  assert.throws(() => verifySignData(w.signature, other.key, w.address, "Join the cup"), /doesn't belong/);
  const lie = fakeWallet("Join the cup", { otherAddress: true });
  assert.throws(() => verifySignData(lie.signature, lie.key, Uint8Array.from([0x61, ...new Uint8Array(28)]), "Join the cup"), /doesn't belong/);
});
