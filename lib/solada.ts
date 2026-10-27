// Server-side reads from Solada's public JSON API (the same endpoints solada.fun's own
// pages call). Solada sends no CORS headers, so the browser goes through our /api routes.
// These endpoints are unofficial and could change, so every field is read defensively.
import "server-only";
import { fetchT } from "./fetchT";
import { cacheLife } from "next/cache";
import { site } from "./config";
import { simulatedCopyTrade } from "./botSnapshot";
import { getBotState } from "./botState";
import { getLedger } from "./ledger";
import { getCopyTrade, type CopyTradeSnapshot } from "./strike";

const SOLADA = "https://www.solada.fun";
const STRIKE_UNIT = site.strike.policyId + site.strike.assetNameHex;

async function solada<T>(path: string): Promise<T | null> {
  try {
    const res = await fetchT(`${SOLADA}${path}`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    return json && typeof json === "object" && "error" in json ? null : (json as T);
  } catch {
    return null;
  }
}

const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

export type CoinSnapshot = {
  /** false until `site.solada.id` is set; every market/reward figure is then empty, never invented. */
  launched: boolean;
  id: string;
  ticker: string;
  chain: string;
  priceAda: number | null;
  marketCapAda: number | null;
  marketCapUsd: number | null;
  volumeAda: number | null; // curve volume + Minswap volume (all-time while the pool is < 7 days old)
  volume24hAda: number | null; // Minswap, last 24h
  volumeAllTime: boolean; // false once Minswap's 7-day window no longer covers the pool's whole life
  trades: number | null;
  holders: number;
  progressPct: number; // bonding-curve progress toward graduation
  graduated: boolean;
  holderSharePct: number;
  paidInStrike: boolean;
  pot: { ada: number; usdc: number }; // holder rewards waiting for the next payout
  lastPayoutAt: string | null;
  lastSnapshotAt: string | null;
  /**
   * Lifetime trading fees and how they split. Solada's `earned*` is the coin's total fees;
   * the holder pot is exactly `holderShareBps` of it (verified across live coins), the rest
   * is the creator's. Cardano-curve coins earn in ADA, Pump-side coins in USDC.
   */
  fees: { currency: "ADA" | "USDC"; total: number; holders: number; creator: number };
  creator: { address: string; claimedAda: number | null }; // null: Solada no longer shows it publicly
  /** The wallet that funds the copy-trade (config override, else the deployer), balance from Koios. */
  teamWallet: { address: string; ada: number | null };
  /** The team's Strike copy-trade account (USD), or the bot's paper portfolio until that account exists. */
  copyTrade: CopyTradeSnapshot | null;
  candles: { time: number; close: number }[];
  /** $BOLT sent to the burn address, newest first, read from the chain. */
  burns: { at: number; txHash: string; amount: number; ada: number | null }[];
  burned: number;
  candleSeconds: number; // resolution actually used: 60, 300 or 3600
  updatedAt: number;
};

type Candles = { startPrice?: number; candles?: { time: number; open: number; close: number }[] };

/**
 * Coarsest resolution that gives a readable line (>= 20 points), else the most detailed one,
 * so a just-launched coin still gets a chart. Starts from the launch price.
 */
function pickCandles(options: [number, Candles | null][]): { candles: { time: number; close: number }[]; candleSeconds: number } {
  const usable = options.filter(([, c]) => (c?.candles?.length ?? 0) > 0);
  if (!usable.length) return { candles: [], candleSeconds: 3600 };
  const [sec, c] = usable.find(([, c]) => c!.candles!.length >= 20) ?? usable.at(-1)!;
  const list = c!.candles!;
  const start = { time: list[0].time - sec, close: c!.startPrice ?? list[0].open };
  return { candles: [start, ...list.map((k) => ({ time: k.time, close: k.close }))], candleSeconds: sec };
}

type Launch = Record<string, unknown> & { id: string; curve?: Record<string, unknown> | null };

export async function getCoin(): Promise<CoinSnapshot> {
  "use cache";
  // Refreshed every 30s. Long enough to be prerendered into the page HTML, so it never paints empty;
  // the browser then polls /api/coin to stay live.
  cacheLife({ stale: 30, revalidate: 30, expire: 3600 });

  const id = site.solada.id;
  if (!id) return await preLaunchCoin();

  const coinPath = `/api/coins/${encodeURIComponent(id)}`;
  const [l, rewards, c1m, c5m, c1h] = await Promise.all([
    solada<Launch>(coinPath),
    solada<Record<string, unknown>>(`/api/holder-rewards?id=${encodeURIComponent(id)}`),
    ...[60, 300, 3600].map((sec) => solada<Candles>(`${coinPath}/candles?seconds=${sec}`)),
  ]);
  // Until Solada opens trading (status live) the site keeps its pre-launch states, then
  // switches over by itself on the next refresh: no redeploy needed at launch.
  if (String(l?.status ?? "").toLowerCase() !== "live") return await preLaunchCoin();
  const teamAddress = site.wallets.copyTrade || String(l?.launcherAddress ?? "");
  const raw = l?.curve ?? null;
  // Since Solada's AWS move (2026-10-27) the curve reports `state` and ADA amounts; older fields are kept as fallbacks.
  const curve: (Record<string, unknown> & { graduated: boolean; volumeAda: number; supply: number }) | null = raw && {
    ...raw,
    graduated: raw.state === "graduated" || Boolean(raw.graduated),
    volumeAda: raw.volumeAda !== undefined ? n(raw.volumeAda) : n(raw.volumeLovelace) / 1e6,
    supply: n((raw.reserves as Record<string, unknown> | undefined)?.supply ?? l?.totalSupply),
  };
  const policy = String(l?.policyId ?? ""), assetHex = String(l?.assetName ?? "");
  // Everything below is independent, so it's fetched in parallel: one slow provider costs one
  // timeout, not a timeout per step. (Holders only waits for the pool, to exclude its address.)
  // After graduation Solada's curve figures freeze; the live price is in the Minswap pool.
  const poolP = curve?.graduated ? minswapPoolOrLastGood(policy, assetHex) : Promise.resolve(null);
  const [pool, dex, holders, teamAda, copyTrade, burns] = await Promise.all([
    poolP,
    curve?.graduated ? minswapMetrics(policy, assetHex) : Promise.resolve(null),
    poolP.then((pl) => onChainHolders(policy, assetHex, [String(curve?.curveAddress ?? ""), pl?.address ?? ""])),
    teamAddress ? adaBalance(teamAddress) : Promise.resolve(null),
    teamCopyTradeOrSimulation(teamAddress),
    burnsOnChain(String(l?.policyId ?? site.token.policyId), String(l?.assetName ?? site.token.assetNameHex)),
  ]);
  const supply = (curve?.supply || site.token.totalSupply * 10 ** site.token.decimals) / 10 ** site.token.decimals;
  const units = Array.isArray(l?.rewardUnits) ? (l.rewardUnits as unknown[]) : [l?.rewardUnit];
  // Lifetime fees are now only shown to the launcher wallet; keep the last figure Solada published until it's public again.
  const earnedAda = n(l?.earnedLovelace) / 1e6 || site.solada.lastKnownFeesAda;

  return {
    launched: true,
    id,
    ticker: String(l?.ticker ?? site.ticker),
    chain: l?.pumpMint ? "pump" : "cardano",
    priceAda: pool ? pool.priceAda : n(l?.priceAda) || null,
    marketCapAda: pool ? pool.priceAda * supply : n(l?.marketCapAda) || null,
    marketCapUsd: n(l?.marketCapUsd) || null,
    ...volumeFigures(curve ? curve.volumeAda : null, dex),
    trades: curve ? n(curve.trades) : null,
    // Solada's reward counter only updates at its daily snapshot; count holders on-chain instead.
    holders: holders ?? n(l?.holders ?? rewards?.holders),
    progressPct: n(curve?.progressBps) / 100,
    graduated: Boolean(curve?.graduated),
    holderSharePct: n(l?.holderShareBps ?? rewards?.holderShareBps) / 100,
    paidInStrike: units.includes(STRIKE_UNIT),
    pot: { ada: n(rewards?.potLovelace) / 1e6, usdc: n(rewards?.potUsdc) / 1e6 },
    lastPayoutAt: (rewards?.lastPayoutAt as string) ?? null,
    lastSnapshotAt: (rewards?.lastSnapshotAt as string) ?? null,
    fees: splitFees(earnedAda, n(l?.earnedUsdc) / 1e6, n(l?.holderShareBps) / 10_000),
    creator: { address: String(l?.launcherAddress ?? ""), claimedAda: l?.claimLovelace === undefined ? null : n(l.claimLovelace) / 1e6 },
    teamWallet: { address: teamAddress, ada: teamAda },
    copyTrade,
    ...burns,
    ...pickCandles([
      [3600, c1h],
      [300, c5m],
      [60, c1m],
    ]),
    updatedAt: Date.now(),
  };
}

/**
 * Every UTxO holding $BOLT at the burn address is one burn. The address is a shared
 * script, so we look the token up (asset_utxos) rather than the address's ~20k UTxOs.
 * ADA spent comes from data/ledger.json when the burn's tx is logged there.
 */
async function burnsOnChain(policy: string, assetHex: string): Promise<Pick<CoinSnapshot, "burns" | "burned">> {
  const empty = { burns: [], burned: 0 };
  if (!policy || !assetHex || !site.burnAddress) return empty;
  try {
    const res = await fetchT("https://api.koios.rest/api/v1/asset_utxos", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ _asset_list: [[policy, assetHex]], _extended: true }),
    });
    if (!res.ok) return empty;
    const utxos = (await res.json()) as { address: string; tx_hash: string; block_time?: number; asset_list: { policy_id: string; asset_name: string; quantity: string }[] }[];
    const logged = new Map(getLedger().burns.map((b) => [b.txHash, b.ada]));
    const burns = utxos
      .filter((u) => u.address === site.burnAddress)
      .map((u) => ({
        at: (u.block_time ?? 0) * 1000,
        txHash: u.tx_hash,
        amount: n(u.asset_list.find((a) => a.policy_id === policy && a.asset_name === assetHex)?.quantity) / 10 ** site.token.decimals,
        ada: logged.get(u.tx_hash) ?? null,
      }))
      .sort((a, b) => b.at - a.at);
    return { burns, burned: burns.reduce((s, b) => s + b.amount, 0) };
  } catch {
    return empty;
  }
}

type DexMetrics = { volume24h: number; volume7d: number; createdAt: number };

/** Minswap's public asset metrics (ADA volume). Their windows stop at 7 days. */
async function minswapMetrics(policy: string, assetHex: string): Promise<DexMetrics | null> {
  if (!policy || !assetHex) return null;
  try {
    const res = await fetchT(`https://api-mainnet-prod.minswap.org/v1/assets/${policy}${assetHex}/metrics`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as { volume_24h?: number; volume_7d?: number; created_at?: string };
    return { volume24h: n(j.volume_24h), volume7d: n(j.volume_7d), createdAt: Date.parse(j.created_at ?? "") || 0 };
  } catch {
    return null;
  }
}

/**
 * While the Minswap pool is younger than 7 days, its 7-day volume is its whole history, so
 * curve + 7d is the true all-time total. After that, report the 7-day figure, labelled as such.
 */
function volumeFigures(curveVolume: number | null, dex: DexMetrics | null): Pick<CoinSnapshot, "volumeAda" | "volume24hAda" | "volumeAllTime"> {
  if (!dex) return { volumeAda: curveVolume, volume24hAda: null, volumeAllTime: true };
  const allTime = dex.createdAt > 0 && Date.now() - dex.createdAt < 7 * 86_400_000;
  return {
    volumeAda: allTime ? (curveVolume ?? 0) + dex.volume7d : dex.volume7d,
    volume24hAda: dex.volume24h,
    volumeAllTime: allTime,
  };
}

const MINSWAP_V2 = "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c"; // Minswap V2 pool/LP policy

// Last successful pool read, so a brief Koios hiccup never shows the frozen curve price.
let lastPool: { address: string; priceAda: number; at: number } | null = null;
async function minswapPoolOrLastGood(policy: string, assetHex: string) {
  const fresh = await minswapPool(policy, assetHex);
  if (fresh) lastPool = { ...fresh, at: Date.now() };
  return fresh ?? (lastPool && Date.now() - lastPool.at < 6 * 3_600_000 ? lastPool : null);
}

/** Price from the token's Minswap V2 pool reserves: the UTxO holding a Minswap V2 token and the most of ours. */
async function minswapPool(policy: string, assetHex: string): Promise<{ address: string; priceAda: number } | null> {
  if (!policy || !assetHex) return null;
  try {
    const res = await fetchT("https://api.koios.rest/api/v1/asset_utxos?select=address,value,asset_list", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ _asset_list: [[policy, assetHex]], _extended: true }),
    });
    if (!res.ok) return null;
    const utxos = (await res.json()) as { address: string; value: string; asset_list: { policy_id: string; asset_name: string; quantity: string }[] }[];
    const ours = (u: (typeof utxos)[number]) => n(u.asset_list.find((a) => a.policy_id === policy && a.asset_name === assetHex)?.quantity);
    const pool = utxos.filter((u) => u.asset_list.some((a) => a.policy_id === MINSWAP_V2)).sort((a, b) => ours(b) - ours(a))[0];
    if (!pool || !ours(pool)) return null;
    const ada = n(pool.value) / 1e6;
    const tokens = ours(pool) / 10 ** site.token.decimals;
    return { address: pool.address, priceAda: ada / tokens };
  } catch {
    return null;
  }
}

/** Wallets holding the token (excluding the bonding curve), from Koios. Null if unavailable. */
async function onChainHolders(policy: string, assetHex: string, exclude: string[]): Promise<number | null> {
  if (!policy || !assetHex) return null;
  try {
    let count = 0;
    for (let offset = 0; offset < 20_000; offset += 1000) {
      const res = await fetchT(
        `https://api.koios.rest/api/v1/asset_addresses?_asset_policy=${policy}&_asset_name=${assetHex}&offset=${offset}&limit=1000`,
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) return null;
      const page = (await res.json()) as { payment_address: string; quantity: string }[];
      count += page.filter((h) => !exclude.includes(h.payment_address) && n(h.quantity) > 0).length;
      if (page.length < 1000) break;
    }
    return count;
  } catch {
    return null;
  }
}

async function teamCopyTradeOrSimulation(address: string): Promise<CopyTradeSnapshot | null> {
  const real = address ? await getCopyTrade(address) : null;
  return real?.found ? real : simulatedCopyTrade(await getBotState());
}

async function adaBalance(address: string): Promise<number | null> {
  try {
    const res = await fetchT("https://api.koios.rest/api/v1/address_info", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ _addresses: [address] }),
    });
    if (!res.ok) return null;
    const [row] = (await res.json()) as { balance?: string }[];
    return row ? Number(row.balance) / 1e6 : 0;
  } catch {
    return null;
  }
}

function splitFees(ada: number, usdc: number, share: number): CoinSnapshot["fees"] {
  const [currency, total] = usdc && !ada ? (["USDC", usdc] as const) : (["ADA", ada] as const);
  return { currency, total, holders: total * share, creator: total * (1 - share) };
}

export class PreLaunchError extends Error {
  constructor() {
    super(`Rewards checking opens when $${site.ticker} launches.`);
  }
}

export type WalletRewards = {
  held: number; // tokens
  /** Accrued this period, converted at payout. Null when Solada only shows it to the wallet signed in there. */
  earningAda: number | null;
  nextPayoutAtMs: number | null;
  paidIn: string;
  /** STRIKE this wallet has earned, from Solada's per-reward-token breakdown (null when Solada needs a sign-in). */
  strike: {
    claimed: number; // STRIKE already claimed
    unclaimed: number; // STRIKE ready to claim
    claimedAda: number; // ADA value when claimed
    unclaimedAda: number; // ADA value now
    /** Other coins whose rewards are also paid in STRIKE to this wallet (included in the totals). */
    otherSources: string[];
  } | null;
};

type RewardToken = { unit?: string; tokens?: string; claimedTokens?: string; valueLovelace?: string; claimedValueLovelace?: string; decimals?: number; from?: string[] };

export async function getWalletRewards(address: string): Promise<WalletRewards> {
  const id = site.solada.id;
  if (!id) throw new PreLaunchError();

  const a = encodeURIComponent(address);
  const [earning, mine] = await Promise.all([
    solada<{ coins?: Record<string, unknown>[] }>(`/api/holder-earning?address=${a}`),
    solada<{ coins?: Record<string, unknown>[]; tokens?: RewardToken[] }>(`/api/my-rewards?address=${a}`),
  ]);
  // Since Solada's AWS move both answer only the wallet signed in on solada.fun: show what the chain says and send
  // people to Solada for their rewards.
  if (!earning && !mine) return chainOnlyRewards(address, id);
  const e = earning?.coins?.find((c) => c.id === id);
  const m = mine?.coins?.find((c) => c.id === id);
  const decimals = n(e?.decimals ?? site.token.decimals);
  // Rewards are bought and held per reward token; STRIKE's entry lists which coins fed it ("from").
  const unit = site.strike.policyId + site.strike.assetNameHex;
  const t = (mine?.tokens ?? []).find((x) => x.unit === unit);
  const sd = 10 ** n(t?.decimals ?? site.strike.decimals);
  return {
    held: n(e?.heldTokens ?? m?.held) / 10 ** decimals,
    earningAda: n(e?.earningLovelace) / 1e6,
    nextPayoutAtMs: e?.nextPayoutAtMs ? n(e.nextPayoutAtMs) : null,
    paidIn: String(e?.paidIn ?? site.strike.ticker),
    strike: {
      claimed: n(t?.claimedTokens) / sd,
      unclaimed: n(t?.tokens) / sd,
      claimedAda: n(t?.claimedValueLovelace) / 1e6,
      unclaimedAda: n(t?.valueLovelace) / 1e6,
      otherSources: (t?.from ?? []).filter((f) => f.toUpperCase() !== site.ticker.toUpperCase()),
    },
  };
}

/** The wallet's $BOLT from Koios and the next daily payout from the coin's last one; rewards themselves stay on Solada. */
async function chainOnlyRewards(address: string, id: string): Promise<WalletRewards> {
  const [assets, rewards] = await Promise.all([
    fetchT("https://api.koios.rest/api/v1/address_assets", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ _addresses: [address] }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ policy_id: string; asset_name: string; quantity: string }[]>) : null))
      .catch(() => null),
    solada<{ lastPayoutAt?: string }>(`/api/holder-rewards?id=${encodeURIComponent(id)}`),
  ]);
  if (!assets) throw new Error("Couldn't read this wallet from the chain right now. Try again in a minute.");
  const mine = assets.find((x) => x.policy_id === site.token.policyId && x.asset_name === site.token.assetNameHex);
  const next = Date.parse(rewards?.lastPayoutAt ?? "") + 86_400_000;
  return {
    held: n(mine?.quantity) / 10 ** site.token.decimals,
    earningAda: null,
    nextPayoutAtMs: next > Date.now() ? next : null,
    paidIn: site.strike.ticker,
    strike: null,
  };
}

// Before launch: nothing exists on Solada yet. The copy-trade bot's paper portfolio is real, so it still shows.
async function preLaunchCoin(): Promise<CoinSnapshot> {
  return {
    launched: false,
    id: "",
    ticker: site.ticker,
    chain: "cardano",
    priceAda: null,
    marketCapAda: null,
    marketCapUsd: null,
    volumeAda: null,
    volume24hAda: null,
    volumeAllTime: true,
    trades: null,
    holders: 0,
    progressPct: 0,
    graduated: false,
    holderSharePct: site.split.holders,
    paidInStrike: true,
    pot: { ada: 0, usdc: 0 },
    lastPayoutAt: null,
    lastSnapshotAt: null,
    fees: { currency: "ADA", total: 0, holders: 0, creator: 0 },
    creator: { address: "", claimedAda: 0 },
    // The team wallet is public before launch so holders can follow it from day one.
    teamWallet: { address: site.wallets.copyTrade, ada: site.wallets.copyTrade ? await adaBalance(site.wallets.copyTrade) : null },
    copyTrade: await teamCopyTradeOrSimulation(site.wallets.copyTrade),
    candles: [],
    burns: [],
    burned: 0,
    candleSeconds: 3600,
    updatedAt: 0,
  };
}
