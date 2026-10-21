// Bolt Autopilot: each user's own copy-trading bot on their own Strike account, run by our
// engine with their rules. Pure functions only (no I/O): the rules model, what it means in
// Strike copy settings, and which traders a user's bot should copy.
//
// Users (or the AI copilot) set goals; the engine turns them into Strike-enforced settings:
//   risk     → how much of the budget is deployed, the leverage cap, stop-loss, multiplier
//   goal     → how traders are chosen from the bot's ranked list
//   markets  → which symbols copies may trade (Strike `excluded_symbols`)

export type Risk = "low" | "medium" | "high";
export type Goal = "steady" | "balanced" | "growth";
export type Markets = "all" | "crypto" | "realworld";

export type AutoRules = {
  budgetUsd: number; // what the bot may use on the user's Strike account
  risk: Risk;
  goal: Goal;
  markets: Markets;
  traders: number; // 1–6 copies
  maxLeverage: number; // 1–20: cap on each copied trade's leverage (Strike enforces it)
  stopLossPct: number; // 0.05–0.30 of a copy: Strike ends the copy at this loss
  profitLockPct: number | null; // bank a copy's profit at +X% and copy the trader again; null = off
  dailyLossPct: number; // 0.03–0.25 of the budget: stop every copy for the day
};

/** What each risk level means. Users can tighten leverage / stop-loss beyond these. */
export const RISK_LEVELS: Record<Risk, { deploy: number; maxLeverage: number; stopLossPct: number; multiplier: number; dailyLossPct: number }> = {
  low: { deploy: 0.5, maxLeverage: 3, stopLossPct: 0.1, multiplier: 1, dailyLossPct: 0.05 },
  medium: { deploy: 0.75, maxLeverage: 5, stopLossPct: 0.15, multiplier: 1, dailyLossPct: 0.08 },
  high: { deploy: 1, maxLeverage: 10, stopLossPct: 0.2, multiplier: 2, dailyLossPct: 0.12 },
};

export const MIN_COPY_USD = 50; // smaller copies skip most of a trader's orders
export const BETA_MAX_BUDGET_USD = 500;

export function defaultRules(budgetUsd: number, risk: Risk = "medium"): AutoRules {
  const r = RISK_LEVELS[risk];
  return { budgetUsd, risk, goal: "balanced", markets: "all", traders: 3, maxLeverage: r.maxLeverage, stopLossPct: r.stopLossPct, profitLockPct: null, dailyLossPct: r.dailyLossPct };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Validate rules from the site or the copilot; null if they don't make sense. Leverage and
 *  stop-loss can only be as loose as the risk level allows. */
export function sanitizeRules(x: unknown, maxBudget = BETA_MAX_BUDGET_USD): AutoRules | null {
  const r = x as Partial<AutoRules> | null;
  if (!r || typeof r !== "object") return null;
  if (!["low", "medium", "high"].includes(r.risk as string) || !["steady", "balanced", "growth"].includes(r.goal as string) || !["all", "crypto", "realworld"].includes(r.markets as string)) return null;
  const level = RISK_LEVELS[r.risk as Risk];
  const nums = [r.budgetUsd, r.traders, r.maxLeverage, r.stopLossPct, r.dailyLossPct].map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const lock = r.profitLockPct === null || r.profitLockPct === undefined ? null : Number(r.profitLockPct);
  if (lock !== null && !Number.isFinite(lock)) return null;
  return {
    budgetUsd: clamp(Number(r.budgetUsd), 0, maxBudget),
    risk: r.risk as Risk,
    goal: r.goal as Goal,
    markets: r.markets as Markets,
    traders: Math.round(clamp(Number(r.traders), 1, 6)),
    maxLeverage: Math.round(clamp(Number(r.maxLeverage), 1, level.maxLeverage)),
    stopLossPct: clamp(Number(r.stopLossPct), 0.05, level.stopLossPct),
    profitLockPct: lock === null ? null : clamp(lock, 0.05, 0.5),
    dailyLossPct: clamp(Number(r.dailyLossPct), 0.03, level.dailyLossPct),
  };
}

/** Strike's markets that are crypto; everything else (stocks, indices, metals, oil) is real-world. */
export const CRYPTO = new Set(["ADA", "BNB", "BTC", "ETH", "HYPE", "NEAR", "NIGHT", "PUMP", "SOL", "XRP", "ZEC"]);
export const isCrypto = (symbol: string) => CRYPTO.has(symbol.replace(/-USD$/, ""));

/** Symbols a user's copies must skip (Strike `excluded_symbols`), given every listed market. */
export function excludedSymbols(markets: Markets, allSymbols: string[]): string[] {
  if (markets === "crypto") return allSymbols.filter((s) => !isCrypto(s));
  if (markets === "realworld") return allSymbols.filter((s) => isCrypto(s));
  return [];
}

/** A trader from the bot's ranked list, with what the goals need. */
export type Candidate = {
  lead: string;
  score: number; // the bot's risk-adjusted score (0–1)
  dd: number; // 30-day drawdown
  roi30d: number;
  realWorldShare: number; // share of their recent trading in real-world markets (0–1)
  /** Share of their trades a copy of each size could follow (Strike's copy_amount_coverage). */
  coverage?: { amount: number; share: number }[];
};

export const MIN_COVERAGE = 0.6; // a copy must be able to follow at least this share of the trader's trades

/** Share of a trader's trades a copy of `amount` can follow (unknown: assume yes). */
export function coverageFor(c: Candidate, amount: number): number {
  if (!c.coverage?.length) return 1;
  return c.coverage.reduce((best, t) => (t.amount <= amount ? Math.max(best, t.share) : best), 0);
}

/** What the public demo gets about a trader: enough to make the same picks and estimate a week of copying. */
export type PreviewTrader = Candidate & { roi7d: number; week: number[]; open: { coin: string; long: boolean }[] };

export const WEEK_POINTS = 29; // every 6 hours over 7 days
const WEEK_MS = 7 * 86_400_000;

/** A trader's return over the last 7 days as WEEK_POINTS evenly spaced values (0 at the start),
 *  from their 30-day return curve ([time, return since 30 days ago]). Without a usable curve: a
 *  straight line to their 7-day return. Always ends at `roi7d`. */
export function weekCurve(curve30d: [number, number][], roi7d: number, now: number): number[] {
  const line = () => Array.from({ length: WEEK_POINTS }, (_, i) => (roi7d * i) / (WEEK_POINTS - 1));
  if (curve30d.length < 2) return line();
  const at = (t: number) => {
    let v = curve30d[0][1];
    for (const [ts, r] of curve30d) {
      if (ts > t) break;
      v = r;
    }
    return v;
  };
  const start = now - WEEK_MS;
  const base = 1 + at(start);
  if (base <= 0) return line();
  const path = Array.from({ length: WEEK_POINTS }, (_, i) => (1 + at(start + (i / (WEEK_POINTS - 1)) * WEEK_MS)) / base - 1);
  // The curve is rebuilt from PnL and current account size, so deposits and withdrawals bend it.
  // Keep its shape but make it end at Strike's own 7-day return.
  const end = path.at(-1)!;
  if (Math.abs(end) < 1e-4 || Math.sign(end) !== Math.sign(roi7d)) return line();
  return path.map((r) => Math.round(r * (roi7d / end) * 10_000) / 10_000);
}

/** A trader's live state for the forward-running demo. `pnl` is their trading profit since we
 *  started watching (closed trades net of fees, plus the change in open positions), so deposits
 *  and withdrawals don't move it. A copy's return = Δpnl ÷ `acct`, as Strike sizes copies by the
 *  trader's account value. */
export type LiveMark = { pnl: number; unrealized: number; acct: number; since: number; at: number; positions: { coin: string; long: boolean; pnl: number }[] };

export function advanceMark(prev: LiveMark | undefined, now: { unrealized: number; realized: number; acct: number; at: number; positions: LiveMark["positions"] }): LiveMark {
  const pnl = prev ? prev.pnl + now.realized + (now.unrealized - prev.unrealized) : 0;
  // `since` changes only when watching (re)starts, e.g. after a worker restart: clients rebase then.
  return { pnl: Math.round(pnl * 100) / 100, unrealized: now.unrealized, acct: now.acct || prev?.acct || 0, since: prev?.since ?? now.at, at: now.at, positions: now.positions };
}

/** Traders a user's bot should copy, best first: the goal decides the order, the markets
 *  rule drops traders who'd barely trade there. Traders already being copied (`held`) stay
 *  while they're still on the ranked list, so a reshuffle of the ranking doesn't churn copies;
 *  only empty slots take new picks. */
export function pickTraders(cands: Candidate[], rules: AutoRules, held: string[] = []): Candidate[] {
  // New picks must be copyable at this user's own copy size (bigger copies can follow more traders).
  const perCopy = (rules.budgetUsd * RISK_LEVELS[rules.risk].deploy) / Math.max(1, rules.traders);
  const keepIds = new Set(held.map((h) => h.toLowerCase()));
  cands = cands.filter((c) => keepIds.has(c.lead.toLowerCase()) || coverageFor(c, perCopy) >= MIN_COVERAGE);
  const fits = cands.filter((c) => (rules.markets === "realworld" ? c.realWorldShare >= 0.3 : rules.markets === "crypto" ? c.realWorldShare <= 0.7 : true));
  const by =
    rules.goal === "steady"
      ? (c: Candidate) => c.score * (1 - Math.min(c.dd, 0.5)) // calmest of the good ones
      : rules.goal === "growth"
        ? (c: Candidate) => c.score * (1 + Math.min(Math.max(c.roi30d, 0), 1) * 0.5) // good ones with more upside
        : (c: Candidate) => c.score;
  const keep = new Set(held.map((h) => h.toLowerCase()));
  const kept = fits.filter((c) => keep.has(c.lead.toLowerCase()));
  const rest = fits.filter((c) => !keep.has(c.lead.toLowerCase())).sort((a, b) => by(b) - by(a));
  return [...kept.sort((a, b) => by(b) - by(a)), ...rest].slice(0, rules.traders);
}

/** The Strike copy settings for each pick: the money each copy gets and the limits Strike enforces. */
export type CopySpec = { lead: string; amount: number; stopLossUsd: number; maxLeverage: number; multiplier: number; maxMarginPerSymbol: number; excludedSymbols: string[] };

export function copySpecs(picks: Candidate[], rules: AutoRules, allSymbols: string[]): CopySpec[] {
  const level = RISK_LEVELS[rules.risk];
  const deployed = rules.budgetUsd * level.deploy;
  // Fewer copies if the budget can't give each one a useful size.
  const n = Math.min(picks.length, Math.floor(deployed / MIN_COPY_USD));
  if (n < 1) return [];
  const amount = Math.floor((deployed / n) * 100) / 100;
  const excluded = excludedSymbols(rules.markets, allSymbols);
  return picks.slice(0, n).map((p) => ({
    lead: p.lead,
    amount,
    stopLossUsd: Math.max(1, Math.round(amount * rules.stopLossPct * 100) / 100),
    maxLeverage: rules.maxLeverage,
    multiplier: level.multiplier,
    // No single symbol may take more than half a copy's money.
    maxMarginPerSymbol: Math.floor(amount * 0.5 * 100) / 100,
    excludedSymbols: excluded,
  }));
}

/** Plain-language summary, for the app and the copilot. */
export function describeRules(r: AutoRules): string {
  const level = RISK_LEVELS[r.risk];
  const m = r.markets === "all" ? "crypto and real-world markets" : r.markets === "crypto" ? "crypto only" : "real-world markets only (stocks, indices, gold, oil)";
  return [
    `${r.risk} risk: ${Math.round(level.deploy * 100)}% of $${r.budgetUsd.toFixed(0)} working, ${r.traders} trader${r.traders === 1 ? "" : "s"}`,
    `${r.goal} picks, ${m}`,
    `leverage capped at ${r.maxLeverage}x, each copy stops at −${Math.round(r.stopLossPct * 100)}%`,
    r.profitLockPct ? `profit locked at +${Math.round(r.profitLockPct * 100)}%` : "no profit lock",
    `everything stops for the day at −${Math.round(r.dailyLossPct * 100)}%`,
  ].join("; ");
}

/** Share of a trader's main markets that are real-world (stocks, indices, metals, oil), from
 *  Strike's `top_assets`. Hyperliquid's `xyz:` markets are all real-world; other non-Strike
 *  coins count as crypto. */
export function realWorldShareOf(topAssets: { asset?: string; symbol?: string }[] | undefined): number {
  const list = topAssets ?? [];
  if (!list.length) return 0;
  const rw = list.filter((a) => {
    const asset = String(a.asset ?? "");
    if (/^xyz:/i.test(asset)) return true;
    const base = (a.symbol || asset).replace(/-USD$/, "").toUpperCase();
    return !!a.symbol && !CRYPTO.has(base);
  }).length;
  return rw / list.length;
}
