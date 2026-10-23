// "Deposit any Cardano token": SteelSwap (a Cardano DEX aggregator) swaps a wallet token to ADA, which then goes to
// Strike as a normal ADA deposit. SteelSwap's own /swap/build makes the whole transaction, with their service fee in it:
// we never assemble or change it (the fee is the condition of using their key). Only plain batched DEX orders, so the
// wallet signs alone. The key stays on this server (STEELSWAP_API_KEY).

const BASE = "https://api.steelswap.io/api/v2";
const KEY = process.env.STEELSWAP_API_KEY ?? "";
// Cloudflare in front of their API turns away requests without a real User-Agent.
const HEADERS = { "content-type": "application/json", accept: "application/json", "x-api-key": KEY, "user-agent": "BoltAutopilot/1.0 (+https://autopilot.boltstriker.io)" };
const IGNORE = ["atomic", "forwardRouting", "internalRouting"]; // plain DEX orders only: the wallet signs them alone

export const steelOn = () => KEY.length > 0;

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: HEADERS, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`SteelSwap answered ${res.status}`);
  }
  if (!res.ok) throw Object.assign(new Error(String(json.message || json.error || `SteelSwap answered ${res.status}`)), { status: res.status });
  return json as T;
}

export type WalletToken = { unit: string; ticker: string | null; name: string | null; decimals: number; logoUrl: string | null; priceAda: number | null };

/** Names, decimals, logos and ADA prices for the tokens a wallet holds (max 100). */
export async function steelTokens(units: string[]): Promise<WalletToken[]> {
  const list = [...new Set(units.filter((u) => /^[0-9a-f]{56,120}$/.test(u)))].slice(0, 100);
  if (!list.length) return [];
  const [meta, prices] = await Promise.all([
    call<{ tokens: { unit: string; decimals: number; decimalsKnown: boolean; ticker?: string | null; name?: string | null; logoUrl?: string | null }[] }>("/tokens/metadata?useLogoUrl=true", { units: list }).catch(() => ({ tokens: [] })),
    call<Record<string, number>>("/taptools/token/prices", list).catch(() => ({}) as Record<string, number>),
  ]);
  const byUnit = new Map(meta.tokens.map((t) => [t.unit, t]));
  return list.map((unit) => {
    const t = byUnit.get(unit);
    const logo = t?.logoUrl ? (t.logoUrl.startsWith("http") ? t.logoUrl : `https://api.steelswap.io${t.logoUrl}`) : null;
    return { unit, ticker: t?.ticker ?? null, name: t?.name ?? null, decimals: t?.decimalsKnown ? t.decimals : 0, logoUrl: logo, priceAda: Number.isFinite(prices[unit]) ? prices[unit] : null };
  });
}

type Amount = { unit: string; amount: string };
export type SwapQuote = { outputLovelace: number; batcherLovelace: number; depositLovelace: number; serviceLovelace: number; venue: string };

/** Best plain-order route for selling `amount` (in the token's smallest units) to ADA. */
export async function steelQuote(unit: string, amount: string): Promise<SwapQuote> {
  const r = await call<{ output: Amount; fees: { batcher: Amount; deposit: Amount; service: Amount }; split: { dex: string }[] }>("/swap/estimate", {
    input: { unit, amount },
    outputUnit: "lovelace",
    ignore: IGNORE,
  });
  return {
    outputLovelace: Number(r.output.amount),
    batcherLovelace: Number(r.fees.batcher.amount),
    depositLovelace: Number(r.fees.deposit.amount),
    serviceLovelace: Number(r.fees.service.amount),
    venue: [...new Set(r.split.map((l) => l.dex))].join(" + "),
  };
}

/** SteelSwap's own unsigned swap transaction for this wallet (their fee included), for the wallet to sign. */
export async function steelBuild(o: { address: string; utxos: string[]; unit: string; amount: string; expectedLovelace: number; slippageBps: number }) {
  const r = await call<{ txCbor: string; txHash: string; partialSign: boolean }>("/swap/build", {
    input: { unit: o.unit, amount: o.amount },
    outputUnit: "lovelace",
    ignore: IGNORE,
    addressSource: o.address,
    changeAddress: o.address,
    utxos: o.utxos.length ? o.utxos : null,
    expectedOutput: { unit: "lovelace", amount: String(Math.floor(o.expectedLovelace)) },
    slippageBps: o.slippageBps,
    ttlSeconds: 900,
  });
  if (!r.txCbor || !r.txHash) throw new Error("SteelSwap didn't return a transaction");
  return r;
}

/** Tells SteelSwap a swap was submitted (their order tracking and partner attribution). */
export async function steelNotify(txHash: string, txCbor: string) {
  await call("/swap/notify", { txHash, txCbor }).catch(() => {});
}
