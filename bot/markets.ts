// Which Hyperliquid coins Strike can actually copy. Strike lists its markets by base asset
// (GET /v2/markets); Hyperliquid names most perps the same, but its builder-deployed "xyz"
// markets (stocks, commodities) use their own tickers. Copies of a coin Strike doesn't list are
// skipped, so a trader who mostly trades those can't be copied at all.

/** Hyperliquid xyz tickers that Strike lists under another name (seen in real Strike copies). */
const XYZ_ALIASES: Record<string, string> = {
  GOLD: "XAU",
  SILVER: "XAG",
  CL: "WTI",
  XYZ100: "NAS100",
  SKHX: "SKHYNIX",
};

/** Strike base asset for a Hyperliquid coin, or null for spot ("@123") and unknown dex prefixes. */
export function strikeBase(coin: string): string | null {
  if (coin.startsWith("@")) return null; // spot, never copied
  const [dex, name] = coin.includes(":") ? coin.split(":", 2) : ["", coin];
  if (!dex) return name;
  if (dex === "xyz") return XYZ_ALIASES[name] ?? name;
  return null;
}

export const onStrike = (coin: string, markets: Set<string>) => {
  const base = strikeBase(coin);
  return base !== null && markets.has(base);
};

/**
 * Share of a lead's recent trading (fills, plus open positions) in coins Strike lists.
 * Undefined when there's nothing to judge (no recent fills or positions) or no market list.
 */
export function strikeShare(
  fills: { coin: string; px: string | number; sz: string | number }[],
  positions: { coin: string; value: number }[],
  markets: Set<string> | null,
): number | undefined {
  if (!markets?.size) return undefined;
  let total = 0, copyable = 0;
  const add = (coin: string, usd: number) => {
    if (coin.startsWith("@") || !(usd > 0)) return;
    total += usd;
    if (onStrike(coin, markets)) copyable += usd;
  };
  for (const f of fills) add(f.coin, Number(f.px) * Number(f.sz));
  for (const p of positions) add(p.coin, p.value);
  return total > 0 ? copyable / total : undefined;
}
