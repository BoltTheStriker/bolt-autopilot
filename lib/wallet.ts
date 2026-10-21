// Minimal CIP-30 helpers: list installed wallets, connect, read the wallet's address.

type Cip30Api = {
  getUsedAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
  signData(addr: string, payload: string): Promise<{ signature: string; key: string }>;
  getUtxos(): Promise<string[] | undefined>;
  getBalance(): Promise<string>;
  signTx(tx: string, partialSign?: boolean): Promise<string>;
  submitTx(tx: string): Promise<string>;
};
type Cip30Wallet = { name: string; icon: string; apiVersion: string; enable(): Promise<Cip30Api> };

declare global {
  interface Window {
    cardano?: Record<string, Cip30Wallet>;
  }
}

export type InstalledWallet = { key: string; name: string; icon: string };

const KNOWN = ["eternl", "lace", "vespr", "nami", "typhoncip30", "flint", "gerowallet", "nufi", "yoroi", "begin"];

export function installedWallets(): InstalledWallet[] {
  const c = typeof window !== "undefined" ? window.cardano : undefined;
  if (!c) return [];
  const keys = [...KNOWN, ...Object.keys(c)].filter((k) => typeof c[k]?.enable === "function" && c[k]?.icon);

  // Some wallets (Vespr, for one) register under several keys for compatibility, so
  // collapse entries that are the same object or report the same name. Prefer the key
  // that matches the wallet's own name, so "vespr" wins over an alias like "nami".
  const byName = new Map<string, InstalledWallet>();
  const seen = new Set<Cip30Wallet>();
  for (const key of keys) {
    const w = c[key];
    const name = (w.name || key).trim();
    const id = name.toLowerCase();
    const existing = byName.get(id);
    if (seen.has(w) && !existing) continue;
    seen.add(w);
    if (!existing || (key.toLowerCase() === id && existing.key.toLowerCase() !== id)) byName.set(id, { key, name, icon: w.icon });
  }
  return [...byName.values()];
}

/** The wallet's main address: raw hex (for signData) and bech32 (addr1…). */
async function mainAddress(api: Cip30Api) {
  const raw = (await api.getUsedAddresses())[0] ?? (await api.getChangeAddress());
  if (!raw) throw new Error("Wallet returned no address");
  // CIP-30 returns raw address bytes as hex; base addresses are 57 bytes, enterprise 29.
  const hex = raw.length > 114 ? raw.slice(-114) : raw;
  const bytes = hexToBytes(hex);
  const mainnet = (bytes[0] & 0x0f) === 1;
  if (!mainnet) throw new Error("Switch your wallet to Cardano mainnet");
  return { hex, bech32: bech32Encode("addr", bytes) };
}

/** Connects and returns the wallet's main bech32 payment address (addr1…). */
export async function connectAddress(key: string): Promise<string> {
  return (await mainAddress(await window.cardano![key].enable())).bech32;
}

/** Signs a message with the wallet (CIP-30 signData: free, no transaction), proving it owns the address. */
export async function signMessage(key: string, message: (address: string) => string) {
  const api = await window.cardano![key].enable();
  const { hex, bech32 } = await mainAddress(api);
  const payload = [...new TextEncoder().encode(message(bech32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const signed = await api.signData(hex, payload);
  return { address: bech32, signature: signed.signature, key: signed.key };
}

/** Signs a payload that's already hex (Strike's withdrawal message comes hex-encoded). Returns Strike's
 *  Cardano signature format, `{coseSign1Hex}:{coseKeyHex}`, plus the signing address. */
export async function signHexPayload(key: string, payloadHex: string) {
  const api = await window.cardano![key].enable();
  const { hex, bech32 } = await mainAddress(api);
  const signed = await api.signData(hex, payloadHex);
  return { address: bech32, wallet_signature: `${signed.signature}:${signed.key}` };
}

/** Signs a transaction Strike built and returns the signed CBOR without submitting it (Strike submits). */
export async function signOnly(key: string, unsignedTx: string): Promise<string> {
  const api = await window.cardano![key].enable();
  const witnesses = await api.signTx(unsignedTx, true);
  const { addWitnesses } = await import("./cardanoTx");
  return addWitnesses(unsignedTx, witnesses);
}

/** ADA and token balances in the wallet (CIP-30 getBalance). Tokens are keyed by policyId+assetName hex. */
export async function walletBalance(key: string) {
  const { decodeValue } = await import("./cardanoValue");
  return decodeValue(await (await window.cardano![key].enable()).getBalance());
}

/** Signs a plain-text message (e.g. Strike's connect consent) with the wallet's main address. */
export async function signText(key: string, text: string) {
  return signMessage(key, () => text);
}

/** The wallet's spendable coins (hex CBOR), which Strike needs to build a deposit. */
export async function walletUtxos(key: string): Promise<string[]> {
  return (await (await window.cardano![key].enable()).getUtxos()) ?? [];
}

/** Signs a transaction Strike built, adds the signature without re-encoding it, and submits it. Returns the tx hash. */
export async function signAndSubmit(key: string, unsignedTx: string, onSigned?: () => void): Promise<string> {
  const api = await window.cardano![key].enable();
  const witnesses = await api.signTx(unsignedTx, true);
  onSigned?.(); // the wallet signed; what's left is sending it
  const { addWitnesses } = await import("./cardanoTx");
  return api.submitTx(addWitnesses(unsignedTx, witnesses));
}

function hexToBytes(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// BIP-173 bech32
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values: number[]) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
  }
  return chk;
}
function bech32Encode(hrp: string, bytes: Uint8Array) {
  const data: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) data.push((acc >>> (bits -= 5)) & 31);
  }
  if (bits) data.push((acc << (5 - bits)) & 31);
  const hrpExp = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat(0, [...hrp].map((c) => c.charCodeAt(0) & 31));
  const mod = polymod([...hrpExp, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + "1" + [...data, ...checksum].map((d) => CHARSET[d]).join("");
}
