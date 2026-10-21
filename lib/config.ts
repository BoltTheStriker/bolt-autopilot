// Single source of truth for everything launch-specific.
// Fill the TODOs at launch. Until `solada.id` is set the site shows pre-launch states, never made-up numbers.

export const site = {
  name: "Bolt",
  fullName: "Bolt The Striker",
  ticker: "BOLT",
  tagline: "Hold Bolt. Get paid in STRIKE.",
  description:
    "Bolt The Striker is a community memecoin on Solada, built for the Strike Finance community. Half of every fee is paid to holders in STRIKE; the other half runs a Strike copy-trade vault whose profits buy back and burn the chart.",
  url: "https://www.boltstriker.io",

  token: {
    policyId: "14628c260a749e78e69e58acca32d0baa09808d50388c84fa7e1ae47", // minted by Solada at launch
    assetNameHex: "0014df10424f4c54", // "BOLT" with the CIP-68 fungible prefix
    totalSupply: 1_000_000_000,
    decimals: 6,
    launchpad: { name: "Solada", url: "https://www.solada.fun/coin/14628c260a749e78e69e58acca32d0baa09808d50388c84fa7e1ae47" },
  },

  /** The coin's id in Solada's API (its original solada.fun/coin/<id>; the public page now uses the policy id). Empty = pre-launch. */
  solada: { id: "draft-bolt" },

  /** Settings you choose when launching on Solada. */

  /** How trading fees are split. Must add up to 100. */
  split: { holders: 50, copyTrade: 50 },

  /** The deployer wallet comes from Solada automatically. Add the copy-trade wallet if it's a different one. */
  wallets: {
    copyTrade: "addr1q9uwmv5vuc36nppyzflhhprlg7tg9dcl22ge2eppcdc0fqhs6a964q4c8uxnuf8hkdthn7yzma2lzm58l9xjnndy2xysxa4jek", // team wallet: funds the Strike copy-trade, buybacks & burns
  },

  strike: {
    ticker: "STRIKE",
    policyId: "f13ac4d66b3ee19a6aa0f2a22298737bd907cc95121662fc971b5275", // STRIKE on Cardano (verified via Koios)
    assetNameHex: "535452494b45",
    decimals: 6,
    app: "https://app.strikefinance.org",
    vaults: "https://app.strikefinance.org/vaults",
    site: "https://www.strikefinance.org",
  },

  /** The copy-trade strategy the team follows on Strike. */
  strategy: {
    name: "Cross Exchange ARB", // TODO: the strategy you pick
    leader: "Strike Vault",
    url: "https://app.strikefinance.org/vaults",
    markets: ["BTC-PERP", "ETH-PERP", "ADA-PERP"],
  },

  /** Burn address (Solada's shared burn script). Any $BOLT sent here counts as burned, read live from the chain. */
  burnAddress: "addr1w8qmxkacjdffxah0l3qg8hq2pmvs58q8lcy42zy9kda2ylc6dy5r4",

  /** The always-on copy-trade bot worker (Railway). The site reads its live state from here. */
  // Strike's official logo on the Autopilot pages (public/strike/). Get Strike's OK (Shan) before the
  // pages go public or into a video; false falls back to text-only "Built on Strike".
  strikeBrand: true,
  botApi: process.env.NEXT_PUBLIC_BOT_API || "https://bolt-worker-production.up.railway.app", // env override for local testing

  socials: {
    x: "https://x.com/bolthestriker",
  },

  /** Solada snapshots holders and shares the holder pot daily. */
  distributionEvery: "Daily",

  // TODO: confirm every claim here matches how you actually launch.
  tokenomicsBlurb: "Fair launch on Solada's bonding curve. No presale and no team bag. Rewards and burns are paid only out of trading fees.",

  disclaimer:
    "Community memecoin. Not affiliated with, issued, endorsed or managed by Strike Finance. STRIKE is used only as the reward token. Copy trading carries risk of loss, and past vault performance does not guarantee future results. Nothing here is financial advice.",
} as const;

export const explorer = {
  tx: (hash: string) => `https://cexplorer.io/tx/${hash}`,
  address: (addr: string) => `https://cexplorer.io/address/${addr}`,
  asset: (policy: string, nameHex: string) => `https://cexplorer.io/asset/${policy}${nameHex}`,
};

export const tokenUnit = site.token.policyId + site.token.assetNameHex;
