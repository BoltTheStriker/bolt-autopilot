// Reads a CIP-30 `getBalance()` value: CBOR `coin` or `[coin, multiasset]`, where multiasset is
// { policyId(bytes): { assetName(bytes): amount } }. Returns ADA in lovelace and each token's
// amount keyed by policyId + assetName hex (the "unit" Cardano tools use).

export type WalletValue = { lovelace: bigint; assets: Map<string, bigint> };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string) => Uint8Array.from((s.match(/../g) ?? []).map((x) => parseInt(x, 16)));

type Item = bigint | Uint8Array | Item[] | Map<Item, Item> | null;

function read(b: Uint8Array, p: { i: number }): Item {
  const ib = b[p.i++];
  const major = ib >> 5;
  const info = ib & 31;
  let n: bigint;
  if (info < 24) n = BigInt(info);
  else if (info >= 24 && info <= 27) {
    const size = 1 << (info - 24);
    n = 0n;
    for (let k = 0; k < size; k++) n = (n << 8n) | BigInt(b[p.i++]);
  } else if (info === 31) n = -1n; // indefinite
  else throw new Error("bad CBOR");
  switch (major) {
    case 0:
      return n;
    case 2: {
      if (n < 0n) throw new Error("indefinite bytes not supported");
      const out = b.slice(p.i, p.i + Number(n));
      p.i += Number(n);
      return out;
    }
    case 4: {
      const arr: Item[] = [];
      if (n < 0n) while (b[p.i] !== 0xff) arr.push(read(b, p));
      else for (let k = 0n; k < n; k++) arr.push(read(b, p));
      if (n < 0n) p.i++;
      return arr;
    }
    case 5: {
      const m = new Map<Item, Item>();
      if (n < 0n) {
        while (b[p.i] !== 0xff) m.set(read(b, p), read(b, p));
        p.i++;
      } else for (let k = 0n; k < n; k++) m.set(read(b, p), read(b, p));
      return m;
    }
    case 6:
      return read(b, p); // tags (e.g. 258 sets) wrap the value we want
    case 7:
      return null;
  }
  throw new Error("unsupported CBOR");
}

export function decodeValue(cborHex: string): WalletValue {
  const v = read(fromHex(cborHex), { i: 0 });
  const assets = new Map<string, bigint>();
  if (typeof v === "bigint") return { lovelace: v, assets };
  if (!Array.isArray(v) || typeof v[0] !== "bigint") throw new Error("not a Cardano value");
  const multi = v[1];
  if (multi instanceof Map)
    for (const [policy, names] of multi)
      if (policy instanceof Uint8Array && names instanceof Map)
        for (const [name, amount] of names) if (name instanceof Uint8Array && typeof amount === "bigint") assets.set(hex(policy) + hex(name), amount);
  return { lovelace: v[0], assets };
}
