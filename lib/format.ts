const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const two = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export const fmtCompact = (n: number) => compact.format(n);
export const fmt = (n: number) => whole.format(n);
export const fmt2 = (n: number) => two.format(n);
export const fmtPct = (n: number, digits = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
export const shortHash = (h: string, n = 6) => (h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-n)}` : h);
export const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** On-chain integer quantity → display number. */
export const fromUnits = (q: bigint, decimals: number) => Number(q) / 10 ** decimals;

/** Named formatters, so server components can pick one for a client component by key. */
export const formatters = {
  compact: fmtCompact,
  int: fmt,
  ada: (n: number) => `₳${fmtCompact(n)}`,
  usd: (n: number) => `$${fmtCompact(n)}`,
  usdWhole: (n: number) => `$${fmt(n)}`, // for zoomed axes where compact would repeat "$1K"
  usdCents: (n: number) => `$${fmt2(n)}`, // small paper-money moves
  pnl: (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${fmt2(Math.abs(n))}`, // signed profit/loss
  price: (n: number) => (n ? `₳${n.toPrecision(3)}` : "₳0"),
};
export type FormatKey = keyof typeof formatters;
