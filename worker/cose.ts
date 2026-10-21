// Checks a CIP-30 `signData` result: proves the person holds the keys of a Cardano address
// (free, no transaction). Ed25519 comes from node:crypto; CBOR and BLAKE2b are small enough
// to keep here, so the worker stays dependency-free.

import { createPublicKey, verify } from "node:crypto";

// ---------- BLAKE2b (RFC 7693), any output length; Cardano key hashes are BLAKE2b-224 ----------

const IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];
const M64 = (1n << 64n) - 1n;
const rotr = (x: bigint, n: bigint) => ((x >> n) | (x << (64n - n))) & M64;

export function blake2b(input: Uint8Array, outLen: number): Uint8Array {
  const h = [...IV];
  h[0] ^= 0x01010000n ^ BigInt(outLen);
  const blocks = Math.max(1, Math.ceil(input.length / 128));
  for (let b = 0; b < blocks; b++) {
    const block = new Uint8Array(128);
    block.set(input.subarray(b * 128, b * 128 + 128));
    const m = Array.from({ length: 16 }, (_, i) => {
      let w = 0n;
      for (let j = 7; j >= 0; j--) w = (w << 8n) | BigInt(block[i * 8 + j]);
      return w;
    });
    const last = b === blocks - 1;
    const t = BigInt(last ? input.length : (b + 1) * 128);
    const v = [...h, ...IV];
    v[12] ^= t & M64;
    v[13] ^= t >> 64n;
    if (last) v[14] ^= M64;
    const g = (a: number, bb: number, c: number, d: number, x: bigint, y: bigint) => {
      v[a] = (v[a] + v[bb] + x) & M64;
      v[d] = rotr(v[d] ^ v[a], 32n);
      v[c] = (v[c] + v[d]) & M64;
      v[bb] = rotr(v[bb] ^ v[c], 24n);
      v[a] = (v[a] + v[bb] + y) & M64;
      v[d] = rotr(v[d] ^ v[a], 16n);
      v[c] = (v[c] + v[d]) & M64;
      v[bb] = rotr(v[bb] ^ v[c], 63n);
    };
    for (let r = 0; r < 12; r++) {
      const s = SIGMA[r % 10];
      g(0, 4, 8, 12, m[s[0]], m[s[1]]);
      g(1, 5, 9, 13, m[s[2]], m[s[3]]);
      g(2, 6, 10, 14, m[s[4]], m[s[5]]);
      g(3, 7, 11, 15, m[s[6]], m[s[7]]);
      g(0, 5, 10, 15, m[s[8]], m[s[9]]);
      g(1, 6, 11, 12, m[s[10]], m[s[11]]);
      g(2, 7, 8, 13, m[s[12]], m[s[13]]);
      g(3, 4, 9, 14, m[s[14]], m[s[15]]);
    }
    for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
  }
  const out = new Uint8Array(64);
  h.forEach((w, i) => {
    for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((w >> BigInt(8 * j)) & 0xffn);
  });
  return out.slice(0, outLen);
}

// ---------- CBOR: just enough to read COSE_Sign1 / COSE_Key and write the Sig_structure ----------

type Cbor = number | bigint | string | Uint8Array | Cbor[] | Map<Cbor, Cbor> | boolean | null | undefined;

export function cborDecode(bytes: Uint8Array): Cbor {
  let p = 0;
  const len = (info: number): number => {
    if (info < 24) return info;
    const n = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : -1;
    if (n < 0 || p + n > bytes.length) throw new Error("bad CBOR length");
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + bytes[p++];
    return v;
  };
  const item = (): Cbor => {
    if (p >= bytes.length) throw new Error("CBOR ended early");
    const b = bytes[p++];
    const major = b >> 5;
    const info = b & 31;
    if (major === 7) return info === 20 ? false : info === 21 ? true : info === 22 ? null : undefined;
    const n = len(info);
    switch (major) {
      case 0: return n;
      case 1: return -1 - n;
      case 2: {
        if (p + n > bytes.length) throw new Error("CBOR ended early");
        return bytes.slice(p, (p += n));
      }
      case 3: {
        if (p + n > bytes.length) throw new Error("CBOR ended early");
        return new TextDecoder().decode(bytes.slice(p, (p += n)));
      }
      case 4: return Array.from({ length: n }, item);
      case 5: {
        const m = new Map<Cbor, Cbor>();
        for (let i = 0; i < n; i++) m.set(item(), item());
        return m;
      }
      case 6: return item(); // tag (COSE_Sign1 may be tagged 18): keep the content
    }
    throw new Error("unsupported CBOR");
  };
  return item();
}

const head = (major: number, n: number) =>
  n < 24 ? [(major << 5) | n] : n < 256 ? [(major << 5) | 24, n] : n < 65536 ? [(major << 5) | 25, n >> 8, n & 255] : [(major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const bstr = (b: Uint8Array) => [...head(2, b.length), ...b];

/** COSE Sig_structure for Sign1: ["Signature1", protected, h'', payload]. */
export function sigStructure(protectedBytes: Uint8Array, payload: Uint8Array): Uint8Array {
  const ctx = new TextEncoder().encode("Signature1");
  return Uint8Array.from([...head(4, 4), ...head(3, ctx.length), ...ctx, ...bstr(protectedBytes), ...bstr(new Uint8Array()), ...bstr(payload)]);
}

// ---------- signData check ----------

export const hex = (s: string) => Uint8Array.from((s.match(/../g) ?? []).map((x) => parseInt(x, 16)));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const SPKI_ED25519 = hex("302a300506032b6570032100");

/**
 * True when `signature` (COSE_Sign1 hex) and `key` (COSE_Key hex) from CIP-30 signData show that
 * the holder of `addressBytes`' payment key signed exactly `message`. Throws with a reason if not.
 */
export function verifySignData(signature: string, key: string, addressBytes: Uint8Array, message: string): true {
  const sign1 = cborDecode(hex(signature));
  if (!Array.isArray(sign1) || sign1.length !== 4) throw new Error("not a COSE_Sign1");
  const [prot, unprot, payload, sig] = sign1;
  if (!(prot instanceof Uint8Array) || !(sig instanceof Uint8Array) || sig.length !== 64) throw new Error("bad signature");
  const headers = cborDecode(prot);
  if (!(headers instanceof Map) || headers.get(1) !== -8) throw new Error("not an Ed25519 signature");
  const signedAddress = headers.get("address");
  if (!(signedAddress instanceof Uint8Array) || !same(signedAddress, addressBytes)) throw new Error("signed for a different address");

  const msg = new TextEncoder().encode(message);
  const hashed = unprot instanceof Map && unprot.get("hashed") === true;
  if (!(payload instanceof Uint8Array) || !same(payload, hashed ? blake2b(msg, 28) : msg)) throw new Error("signed a different message");

  const coseKey = cborDecode(hex(key));
  const pub = coseKey instanceof Map ? coseKey.get(-2) : null;
  if (!(pub instanceof Uint8Array) || pub.length !== 32) throw new Error("bad public key");
  // The key must be the address's payment key: its BLAKE2b-224 hash is bytes 1–28 of the address.
  if ((addressBytes[0] >> 4) % 2 !== 0) throw new Error("script addresses can't sign");
  if (!same(blake2b(pub, 28), addressBytes.slice(1, 29))) throw new Error("key doesn't belong to this address");

  const pk = createPublicKey({ key: Buffer.from([...SPKI_ED25519, ...pub]), format: "der", type: "spki" });
  if (!verify(null, sigStructure(prot, payload), pk, Buffer.from(sig))) throw new Error("signature doesn't match");
  return true;
}
