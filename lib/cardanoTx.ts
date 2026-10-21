// Adds a CIP-30 wallet's signatures to an unsigned Cardano transaction without re-encoding it.
// Wallets' signTx returns only a witness set; the signed transaction is the original bytes with
// that witness set spliced in. The body must stay byte-for-byte identical (its hash is what was
// signed), so we cut the transaction into its four raw parts instead of decoding and re-encoding.

const hexToBytes = (hex: string) => Uint8Array.from((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Length in bytes of the CBOR item starting at `p` (definite and indefinite lengths). */
function itemEnd(b: Uint8Array, p: number): number {
  const ib = b[p];
  const major = ib >> 5;
  const info = ib & 31;
  let q = p + 1;
  let n = 0;
  if (info < 24) n = info;
  else if (info >= 24 && info <= 27) {
    const size = 1 << (info - 24);
    for (let i = 0; i < size; i++) n = n * 256 + b[q + i];
    q += size;
  } else if (info === 31) {
    // Indefinite length: items until the 0xff break.
    if (major === 7) throw new Error("unexpected break");
    while (b[q] !== 0xff) q = itemEnd(b, q);
    return q + 1;
  } else throw new Error("bad CBOR");
  switch (major) {
    case 0:
    case 1:
    case 7:
      return q;
    case 2:
    case 3:
      return q + n;
    case 4:
      for (let i = 0; i < n; i++) q = itemEnd(b, q);
      return q;
    case 5:
      for (let i = 0; i < 2 * n; i++) q = itemEnd(b, q);
      return q;
    case 6:
      return itemEnd(b, q);
  }
  throw new Error("bad CBOR");
}

/** Raw [key, value] slices of a CBOR map at `p`. */
function mapEntries(b: Uint8Array, p: number): { key: Uint8Array; val: Uint8Array; keyNum: number }[] {
  const ib = b[p];
  if (ib >> 5 !== 5) throw new Error("witness set is not a map");
  const info = ib & 31;
  let q = p + 1;
  let count = Infinity;
  if (info < 24) count = info;
  else if (info === 24) {
    count = b[q];
    q += 1;
  }
  else if (info === 25) {
    count = b[q] * 256 + b[q + 1];
    q += 2;
  }
  else if (info !== 31) throw new Error("witness set too large");
  const out: { key: Uint8Array; val: Uint8Array; keyNum: number }[] = [];
  while (count === Infinity ? b[q] !== 0xff : out.length < count) {
    const k0 = q;
    q = itemEnd(b, q);
    const v0 = q;
    q = itemEnd(b, q);
    out.push({ key: b.slice(k0, v0), val: b.slice(v0, q), keyNum: b[k0] < 24 ? b[k0] : -1 });
  }
  return out;
}

/** Raw items of a CBOR array value (e.g. the list of vkey witnesses), handling tag 258 sets. */
function arrayItems(val: Uint8Array): { items: Uint8Array[]; tag258: boolean } {
  let p = 0;
  let tag258 = false;
  if (val[0] === 0xd9 && val[1] === 0x01 && val[2] === 0x02) {
    tag258 = true;
    p = 3;
  }
  const ib = val[p];
  if (ib >> 5 !== 4) throw new Error("expected a list");
  const info = ib & 31;
  let q = p + 1;
  let count = Infinity;
  if (info < 24) count = info;
  else if (info === 24) {
    count = val[q];
    q += 1;
  }
  else if (info === 25) {
    count = val[q] * 256 + val[q + 1];
    q += 2;
  }
  else if (info !== 31) throw new Error("list too large");
  const items: Uint8Array[] = [];
  while (count === Infinity ? val[q] !== 0xff : items.length < count) {
    const s = q;
    q = itemEnd(val, q);
    items.push(val.slice(s, q));
  }
  return { items, tag258 };
}

const head = (major: number, n: number) => (n < 24 ? [(major << 5) | n] : n < 256 ? [(major << 5) | 24, n] : [(major << 5) | 25, n >> 8, n & 255]);
const concat = (...parts: (Uint8Array | number[])[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));

/** The signed transaction (hex): the unsigned tx with the wallet's witnesses merged into its witness set. */
export function addWitnesses(unsignedTxHex: string, walletWitnessSetHex: string): string {
  const tx = hexToBytes(unsignedTxHex);
  if (tx[0] >> 5 !== 4) throw new Error("not a transaction");
  // [body, witness_set, is_valid, auxiliary_data] (older era: 3 items)
  const info = tx[0] & 31;
  let p = 1;
  const parts: Uint8Array[] = [];
  const count = info < 24 ? info : info === 31 ? Infinity : -1;
  if (count < 0) throw new Error("not a transaction");
  while (count === Infinity ? tx[p] !== 0xff : parts.length < count) {
    const s = p;
    p = itemEnd(tx, p);
    parts.push(tx.slice(s, p));
  }
  const ours = mapEntries(parts[1], 0);
  const theirs = mapEntries(hexToBytes(walletWitnessSetHex), 0);
  // Merge key by key; for the vkey list (0) keep every signature once.
  const merged = new Map<number, Uint8Array>(ours.map((e) => [e.keyNum, e.val]));
  for (const e of theirs) {
    const prev = merged.get(e.keyNum);
    if (e.keyNum === 0 && prev) {
      const a = arrayItems(prev);
      const b = arrayItems(e.val);
      const seen = new Set(a.items.map(bytesToHex));
      const all = [...a.items, ...b.items.filter((x) => !seen.has(bytesToHex(x)))];
      merged.set(0, concat(a.tag258 || b.tag258 ? [0xd9, 0x01, 0x02] : [], head(4, all.length), ...all));
    } else merged.set(e.keyNum, e.val);
  }
  const keys = [...merged.keys()].sort((x, y) => x - y);
  const witnessSet = concat(head(5, keys.length), ...keys.flatMap((k) => [head(0, k), merged.get(k)!]));
  return bytesToHex(concat(head(4, parts.length), parts[0], witnessSet, ...parts.slice(2)));
}
