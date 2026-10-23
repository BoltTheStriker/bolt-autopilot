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
  /** Stop the whole bot (every copy, then off) once the profit since Start reaches this many dollars; null = off. */
  stopAtProfitUsd?: number | null;
  /** Stop the whole bot once the loss since Start reaches this many dollars (copies that already ended count); null = off. */
  stopAtLossUsd?: number | null;
  /** Copy size against the trader's (Strike's ratio multiplier), up to the risk level's ceiling; null = the level's default. */
  boost?: number | null;
  /** Stop for the day (copies closed, back tomorrow) once today's profit reaches this many dollars; null = off. */
  dailyProfitUsd?: number | null;
  /** No copying until this time (ms); copies close and the bot picks up again by itself; null = not paused. */
  pauseUntil?: number | null;
  /** No copying on Saturdays and Sundays (UTC): copies close for the weekend. */
  weekdaysOnly?: boolean;
  /** Traders never to copy: full addresses, or the short 0x1234…abcd form the app shows. */
  avoid?: string[];
};

/** What each risk level means. Users can tighten leverage / stop-loss beyond these. */
export const RISK_LEVELS: Record<Risk, { deploy: number; maxLeverage: number; stopLossPct: number; multiplier: number; maxBoost: number; dailyLossPct: number }> = {
  low: { deploy: 0.5, maxLeverage: 3, stopLossPct: 0.1, multiplier: 1, maxBoost: 1, dailyLossPct: 0.05 },
  medium: { deploy: 0.75, maxLeverage: 5, stopLossPct: 0.15, multiplier: 1, maxBoost: 2, dailyLossPct: 0.08 },
  high: { deploy: 1, maxLeverage: 10, stopLossPct: 0.2, multiplier: 2, maxBoost: 3, dailyLossPct: 0.12 },
};

/** The copy size a rule set runs at: the user's boost, or the level's default, never above the level's ceiling. */
export const boostOf = (r: AutoRules) => Math.min(r.boost ?? RISK_LEVELS[r.risk].multiplier, RISK_LEVELS[r.risk].maxBoost);

/** Whether the rules say never to copy this trader (full address, or the app's short form). */
export function avoids(r: AutoRules, lead: string): boolean {
  const l = lead.toLowerCase();
  return (r.avoid ?? []).some((a) => {
    const x = a.toLowerCase();
    if (!x.includes("…")) return x === l;
    const [head, tail] = x.split("…");
    return l.startsWith(head) && l.endsWith(tail);
  });
}

/** Why the bot may not copy right now by the user's own schedule (a timed pause, the weekend), or null. */
export function pausedNow(r: AutoRules, now: number): string | null {
  if (r.pauseUntil && r.pauseUntil > now) return `Paused until ${new Date(r.pauseUntil).toUTCString().replace(/:\d\d GMT$/, " UTC")}, as you asked`;
  const day = new Date(now).getUTCDay();
  if (r.weekdaysOnly && (day === 0 || day === 6)) return "Weekend break, as you asked: copying picks up again on Monday (UTC)";
  return null;
}

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
  // Whole-bot targets in dollars: a positive amount, or off (null). Anything else is off.
  const usdOrNull = (v: unknown) => (v === null || v === undefined || !(Number(v) >= 1) ? null : Math.round(Number(v) * 100) / 100);
  const pauseAt = r.pauseUntil === null || r.pauseUntil === undefined ? NaN : typeof r.pauseUntil === "string" ? Date.parse(r.pauseUntil) : Number(r.pauseUntil);
  const avoid = (Array.isArray(r.avoid) ? r.avoid : [])
    .map((a) => String(a).trim().toLowerCase())
    .filter((a) => /^0x[0-9a-f]{3,}(…[0-9a-f]{3,})?$/.test(a) && (a.includes("…") || a.length === 42))
    .slice(0, 20);
  const budget = clamp(Number(r.budgetUsd), 0, maxBudget);
  return {
    budgetUsd: budget,
    risk: r.risk as Risk,
    goal: r.goal as Goal,
    markets: r.markets as Markets,
    traders: Math.round(clamp(Number(r.traders), 1, 6)),
    maxLeverage: Math.round(clamp(Number(r.maxLeverage), 1, level.maxLeverage)),
    stopLossPct: clamp(Number(r.stopLossPct), 0.05, level.stopLossPct),
    profitLockPct: lock === null ? null : clamp(lock, 0.05, 0.5),
    dailyLossPct: clamp(Number(r.dailyLossPct), 0.03, level.dailyLossPct),
    stopAtProfitUsd: usdOrNull(r.stopAtProfitUsd),
    stopAtLossUsd: usdOrNull(r.stopAtLossUsd) === null ? null : Math.min(usdOrNull(r.stopAtLossUsd)!, Math.max(1, budget)),
    boost: r.boost === null || r.boost === undefined || !Number.isFinite(Number(r.boost)) ? null : Math.round(clamp(Number(r.boost), 1, level.maxBoost)),
    dailyProfitUsd: usdOrNull(r.dailyProfitUsd),
    pauseUntil: Number.isFinite(pauseAt) && pauseAt > 0 ? pauseAt : null,
    weekdaysOnly: r.weekdaysOnly === true,
    avoid: [...new Set(avoid)],
  };
}

/** What a shared setup link carries: the shape of the rules, never a budget, dollar targets or blocked traders. */
export type SharedRules = Pick<AutoRules, "risk" | "goal" | "markets" | "traders" | "maxLeverage" | "stopLossPct" | "dailyLossPct" | "profitLockPct"> & {
  boost?: number | null;
  weekdaysOnly?: boolean;
};

export const sharedRules = (r: AutoRules): SharedRules => ({
  risk: r.risk,
  goal: r.goal,
  markets: r.markets,
  traders: r.traders,
  maxLeverage: r.maxLeverage,
  stopLossPct: r.stopLossPct,
  dailyLossPct: r.dailyLossPct,
  profitLockPct: r.profitLockPct,
  boost: r.boost ?? null,
  weekdaysOnly: !!r.weekdaysOnly,
});

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
  /** Share of their recent trading in markets Strike lists (a copy skips the rest); unknown = undefined. */
  strikeShare?: number;
  /** In how many of the last 24 hours they traded; unknown = undefined. */
  activeHours24h?: number;
  /** Holding positions right now (a new copy opens them at once); unknown = undefined. */
  holding?: boolean;
  /** Return over the last 7 days; unknown = undefined. */
  roi7d?: number;
  /** What they hold now, as "BTC:L" / "ETH:S" (for spreading copies over different bets); unknown = undefined. */
  bets?: string[];
};

export const MIN_COVERAGE = 0.6; // a copy must be able to follow at least this share of the trader's trades
export const MIN_STRIKE_SHARE = 0.7; // a new pick trades mostly in Strike's markets (the rest is invisible to a copy), as the live bot asks

/** How well a copy would actually work with this trader right now, about 0.3–1.1. A copy opens the trader's current
 *  positions at once and then follows new trades: so holding positions now, trading through the day, trading in
 *  Strike's markets and not losing this week all count. */
export function followFit(c: Candidate): number {
  const onStrike = c.strikeShare === undefined ? 1 : Math.min(1, Math.max(0, c.strikeShare));
  const busy = c.activeHours24h === undefined ? 1 : Math.min(1, 0.4 + 0.1 * c.activeHours24h); // 2h → 0.6, 6h+ → 1
  const now = c.holding === undefined ? 1 : c.holding ? 1.1 : 0.85; // in a trade now: the copy starts working at once
  const week = c.roi7d === undefined ? 1 : Math.min(1.1, Math.max(0.6, 1 + c.roi7d * 2)); // −10% this week → 0.8, +5% → 1.1
  return (0.5 + 0.5 * onStrike) * busy * now * week;
}

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
/** Each copy's size under these rules. */
export const perCopyUsd = (rules: AutoRules) => (rules.budgetUsd * RISK_LEVELS[rules.risk].deploy) / Math.max(1, rules.traders);

/** Traders a copy of `perCopy` dollars can follow well, mostly in Strike's markets, and not blocked (held ones stay). */
export function fitting(cands: Candidate[], rules: AutoRules, held: string[] = [], perCopy = perCopyUsd(rules)): Candidate[] {
  const keepIds = new Set(held.map((h) => h.toLowerCase()));
  return cands.filter(
    (c) => !avoids(rules, c.lead) && (keepIds.has(c.lead.toLowerCase()) || (coverageFor(c, perCopy) >= MIN_COVERAGE && (c.strikeShare === undefined || c.strikeShare >= MIN_STRIKE_SHARE))),
  );
}

export function pickTraders(cands: Candidate[], rules: AutoRules, held: string[] = []): Candidate[] {
  // New picks must be copyable at this user's own copy size (bigger copies can follow more traders).
  cands = fitting(cands, rules, held);
  const fits = cands.filter((c) => (rules.markets === "realworld" ? c.realWorldShare >= 0.3 : rules.markets === "crypto" ? c.realWorldShare <= 0.7 : true));
  const goal =
    rules.goal === "steady"
      ? (c: Candidate) => c.score * (1 - Math.min(c.dd, 0.5)) // calmest of the good ones
      : rules.goal === "growth"
        ? (c: Candidate) => c.score * (1 + Math.min(Math.max(c.roi30d, 0), 1) * 0.5) // good ones with more upside
        : (c: Candidate) => c.score;
  const by = (c: Candidate) => goal(c) * followFit(c);
  const keep = new Set(held.map((h) => h.toLowerCase()));
  const kept = fits.filter((c) => keep.has(c.lead.toLowerCase())).sort((a, b) => by(b) - by(a));
  const rest = fits.filter((c) => !keep.has(c.lead.toLowerCase())).sort((a, b) => by(b) - by(a));
  // Spread the copies: prefer a trader whose current positions don't repeat a bet another pick already holds (three
  // copies all long BTC are one bet). Stack only when nobody else fits.
  const picks = kept.slice(0, rules.traders);
  const taken = new Set(picks.flatMap((c) => c.bets ?? []));
  const overlaps = (c: Candidate) => (c.bets ?? []).some((b) => taken.has(b));
  for (const pass of [false, true])
    for (const c of rest) {
      if (picks.length >= rules.traders) break;
      if (picks.includes(c) || (!pass && overlaps(c))) continue;
      picks.push(c);
      for (const b of c.bets ?? []) taken.add(b);
    }
  return picks;
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
    multiplier: boostOf(rules),
    // Low risk keeps at most half a copy on one coin (Strike skips orders past it). Medium and high let a copy follow a
    // trader who's all-in on one coin; the copy's stop-loss and the daily limit still cap the loss.
    maxMarginPerSymbol: rules.risk === "low" ? Math.floor(amount * 0.5 * 100) / 100 : amount,
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
    ...(boostOf(r) > 1 ? [`copies at ${boostOf(r)}× the trader's size`] : []),
    ...(r.dailyProfitUsd ? [`stops for the day once it's up $${r.dailyProfitUsd.toFixed(2)} that day`] : []),
    ...(r.weekdaysOnly ? ["weekdays only (no copies on weekends)"] : []),
    ...(r.pauseUntil && r.pauseUntil > Date.now() ? [`paused until ${new Date(r.pauseUntil).toUTCString().replace(/:\d\d GMT$/, " UTC")}`] : []),
    ...(r.avoid?.length ? [`never copies ${r.avoid.length} trader${r.avoid.length > 1 ? "s" : ""} you blocked`] : []),
    ...(r.stopAtProfitUsd || r.stopAtLossUsd
      ? [`the bot stops for good ${[r.stopAtProfitUsd ? `at +$${r.stopAtProfitUsd.toFixed(2)} profit` : "", r.stopAtLossUsd ? `at −$${r.stopAtLossUsd.toFixed(2)} loss` : ""].filter(Boolean).join(" or ")} since Start`]
      : []),
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
