// Strike's public market data for Bolt Calls: mark prices for every market (one request), and each market's size and price
// steps so orders are rounded the way Strike accepts them. No keys needed.

const BASE = "https://api.strikefinance.org";

export type MarketRules = { symbol: string; qtyStep: number; minQty: number; minNotional: number; tick: number };

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Strike ${path} → ${r.status}`);
  return (await r.json()) as T;
}

let marksCache: { at: number; marks: Record<string, number> } = { at: 0, marks: {} };
/** Mark price per market ("BTC-USD" → 79,946.1), at most `maxAgeMs` old. */
export async function strikeMarks(now: number, maxAgeMs = 10_000): Promise<Record<string, number>> {
  if (now - marksCache.at < maxAgeMs && Object.keys(marksCache.marks).length) return marksCache.marks;
  const rows = await getJson<{ s: string; p: string }[]>("/price/v2/markPrice");
  const marks: Record<string, number> = {};
  for (const r of rows) if (Number(r.p) > 0) marks[r.s] = Number(r.p);
  marksCache = { at: now, marks };
  return marks;
}

let rulesCache: { at: number; rules: Record<string, MarketRules> } = { at: 0, rules: {} };
/** Size and price steps per market (refreshed hourly: they rarely change). */
export async function strikeMarketRules(now: number): Promise<Record<string, MarketRules>> {
  if (now - rulesCache.at < 3_600_000 && Object.keys(rulesCache.rules).length) return rulesCache.rules;
  type Filter = { filterType: string; stepSize?: string; minQty?: string; tickSize?: string; notional?: string; minNotional?: string };
  const info = await getJson<{ symbols: { symbol: string; status: string; filters?: Filter[] }[] }>("/price/v2/exchangeInfo");
  const rules: Record<string, MarketRules> = {};
  for (const s of info.symbols ?? []) {
    if (s.status !== "trading") continue;
    const f = Object.fromEntries((s.filters ?? []).map((x) => [x.filterType, x]));
    rules[s.symbol] = {
      symbol: s.symbol,
      qtyStep: Number(f.LOT_SIZE?.stepSize ?? f.MARKET_LOT_SIZE?.stepSize ?? 0) || 0,
      minQty: Number(f.LOT_SIZE?.minQty ?? 0) || 0,
      minNotional: Number(f.MIN_NOTIONAL?.notional ?? f.MIN_NOTIONAL?.minNotional ?? 10) || 10,
      tick: Number(f.PRICE_FILTER?.tickSize ?? 0) || 0,
    };
  }
  rulesCache = { at: now, rules };
  return rules;
}

/** `x` rounded down to a multiple of `step`, written with the step's decimals (Strike rejects extra digits). */
export function toStep(x: number, step: number): string {
  if (!(step > 0)) return String(x);
  const decimals = Math.max(0, (String(step).split(".")[1] ?? "").replace(/0+$/, "").length);
  return (Math.floor(x / step + 1e-9) * step).toFixed(decimals);
}

/** The order size for spending `marginUsd` at `leverage` on this market, or why it can't be placed. */
export function sizeFor(marginUsd: number, leverage: number, mark: number, r: MarketRules): { size: string; notional: number } | { error: string } {
  const size = toStep((marginUsd * leverage) / mark, r.qtyStep);
  const notional = Number(size) * mark;
  if (!(Number(size) > 0) || Number(size) < r.minQty || notional < r.minNotional)
    return { error: `That's under Strike's minimum order here ($${r.minNotional} of position). Use a bit more, or more leverage.` };
  return { size, notional };
}
