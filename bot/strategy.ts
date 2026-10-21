// Pure decision logic: no network, no clock, no files. run.ts feeds it data and the
// current time; tests feed it fixtures.
import type { BotConfig } from "./config.ts";

/** The subset of Strike's /v2/copy/discover item the bot reads. Numbers arrive as strings. */
export type Lead = {
  address: string;
  platform: string;
  account_value: string;
  pnl: Record<"1d" | "7d" | "30d" | "all", string>;
  roi: Record<"1d" | "7d" | "30d" | "all", string>;
  volume: Record<"1d" | "7d" | "30d" | "all", string>;
  style?: string;
  copy_score?: string;
  copy_score_breakdown?: Record<string, { raw?: string }>;
  copy_amount_coverage?: { copy_amount: string; coverage: string }[];
  recommended_direction?: "copy" | "counter" | "none";
  last_traded_at_ms?: number;
  pnl_curve_30d?: [number, string][];
  /** Added by the worker from Hyperliquid: hours (of the last 24) with at least one trade. */
  activeHours24h?: number;
  /** Share of their recent trading in coins Strike lists (0–1); set by the worker. */
  strikeShare?: number;
  /** Positions the lead holds right now (coin + direction), from Hyperliquid; set by the worker. */
  openBets?: { coin: string; long: boolean }[];
  /** Days covered by the lead's last 2,000 fills (Strike profile), so 2000 / this = trades per day. */
  fills_window_days?: string;
  /** Top markets by notional (Strike profile). */
  top_assets?: { asset: string; symbol?: string }[];
};

/** Trades per day, from Strike's 2,000-fill window. Undefined if unknown. */
export const tradesPerDay = (lead: Lead) => (num(lead.fills_window_days) > 0 ? 2000 / num(lead.fills_window_days) : undefined);
/** Daily trading volume as a multiple of the account (30-day average). Copy costs scale with it. */
export const dailyTurnover = (lead: Lead) => (num(lead.account_value) > 0 ? num(lead.volume?.["30d"]) / 30 / num(lead.account_value) : 0);
export const topAsset = (lead: Lead | undefined) => lead?.top_assets?.[0]?.asset;

/** Return of a lead between two marks of its cumulative PnL, relative to its account size. */
export const leadReturn = (from: { pnlAll: number; av: number }, pnlNow: number) => (from.av > 0 ? (pnlNow - from.pnlAll) / from.av : 0);

export type Position = {
  lead: string;
  openedAt: number;
  cost: number; // USD put in
  value: number; // USD now (simulated)
  peak: number;
  fees: number; // simulated taker fees paid so far
  score: number; // score when opened
  scoreNow?: number; // score at the latest hourly review (live copies are funded in this order)
  coverage: number; // copyable share of the lead's trades at our size
  // Lead's figures at the last mark; returns are measured between marks.
  mark: { pnlAll: number; volumeAll: number; accountValue: number; at: number };
  /** Lead's figures when we started copying, to compare picks with skipped candidates. */
  entry?: { pnlAll: number; av: number };
  /** The experimental bold slot (see cfg.bold): its own stop-loss, never rotated out by normal picks. */
  bold?: boolean;
};

/** A candidate the bot ranked highly but did not copy, followed on paper for comparison. */
export type Shadow = { lead: string; addedAt: number; start: { pnlAll: number; av: number }; lastPnl: number };

export type ClosedPosition = Position & { closedAt: number; reason: string; pnlUsd: number; pnlPct: number };

export type Decision = { at: number; action: "open" | "close" | "rotate" | "info"; lead?: string; detail: string };

export type BotState = {
  mode: "simulate";
  /** The experimental bold slot, switched on/off from /admin. */
  bold?: { enabled: boolean };
  startedAt: number;
  startingCapital: number;
  cash: number;
  positions: Position[];
  closed: ClosedPosition[];
  cooldowns: Record<string, number>; // lead → no re-entry before this ms
  decisions: Decision[];
  equity: { at: number; value: number }[];
  lastRunAt: number | null;
  /** What the bot saw on its latest check, for the public "bot thinking" panel. */
  lastScan?: Scan;
  shadow?: Shadow[];
  /** Public summary of the live-trading controls, added by the worker's /state. */
  liveStatus?: {
    mode: "paper" | "dry" | "live";
    copies: number;
    account?: { allocated: number; pnl: number; equity?: number; netIn?: number; at?: number }; // netIn: money moved in minus moved out
    budgetUsd?: number;
    liveSince?: number;
    /** The bot's real copies on Strike (live mode only). */
    positions?: { lead: string; amount: number; pnl: number; since?: number; positions?: { market: string; long: boolean; entry: number; mark: number; pnl: number }[] }[];
    /** Profit on the real copies over time. */
    history?: { at: number; pnl: number; equity?: number; netIn?: number }[];
    /** Profit lock on the bold slot's copy: banked total and the latest lock-ins. */
    lock?: { enabled: boolean; pct: number; banked: number; events: { at: number; lead: string; amount: number; copy: number }[] };
  };
  /** Holder demo switch and account count, added by the worker's /state. */
  demo?: { enabled: boolean; accounts: number };
  /** Live trade feed from the copied leads (newest first), written by the Railway worker. */
  feed?: FeedEvent[];
  /** Per-lead cursors for the live worker. */
  live?: Record<string, { lastFillMs: number; unrealized: number; open?: OpenPosition[] }>;
  lastTickAt?: number;
};

/** A position a copied lead holds right now, with our paper copy's share of its open profit. */
export type OpenPosition = { coin: string; long: boolean; entryPx: number; value: number; leadUpnl: number; ourUpnl: number };

export type FeedEvent = {
  at: number;
  lead: string;
  coin: string;
  dir: string; // "Open Long", "Close Short", …
  notional: number; // lead's USD size
  leadPnl: number; // lead's realized PnL on this trade (USD)
  ourPnl: number; // our paper copy's share (USD)
};

export type Scan = {
  at: number;
  checked: number; // traders pulled from Strike
  eligible: number; // passed every entry rule (excluding ones we hold or cooled down)
  rejections: Record<string, number>;
  moves: { lead: string; change: number; value: number }[]; // per held copy, USD change since the previous check
  nextUp: { lead: string; score: number; roi30d: number }[]; // best candidates we're not copying yet
  weakestHeldScore: number | null;
  /** Picks vs skipped: average lead return since each was added (null until there is data). */
  compare?: { picks: number | null; skipped: number | null; skippedCount: number };
  /** How many markets Strike listed at this review (0 if the list couldn't be read). */
  strikeMarkets?: number;
  /** 30-day track record of each lead we copy, from Strike: total return and a return curve. */
  trackRecord?: { lead: string; roi30d: number; coverage: number; curve: [number, number][] }[];
};

/** A lead's 30-day PnL curve as cumulative return vs. their starting equity. */
export function returnCurve(lead: Lead): [number, number][] {
  const pts = (lead.pnl_curve_30d ?? []).map(([t, v]) => [t, num(v)] as const);
  if (pts.length < 2) return [];
  const gained = pts.at(-1)![1] - pts[0][1];
  const startEquity = num(lead.account_value) - gained;
  if (startEquity <= 0) return [];
  return pts.map(([t, v]) => [t, (v - pts[0][1]) / startEquity]);
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const HOUR = 3_600_000;

export function initialState(cfg: BotConfig, now: number): BotState {
  return {
    mode: "simulate",
    startedAt: now,
    startingCapital: cfg.startingCapital,
    cash: cfg.startingCapital,
    positions: [],
    closed: [],
    cooldowns: {},
    decisions: [{ at: now, action: "info", detail: `Simulation started with $${cfg.startingCapital.toLocaleString("en-US")} paper capital.` }],
    equity: [{ at: now, value: cfg.startingCapital }],
    lastRunAt: null,
  };
}

/** Copyable share of the lead's trades at a given allocation (conservative: largest tier at or below it). */
export function coverageAt(lead: Lead, amount: number): number {
  let best = 0;
  for (const c of lead.copy_amount_coverage ?? []) if (num(c.copy_amount) <= amount) best = Math.max(best, num(c.coverage));
  return best;
}

/** How steadily the lead's 30-day PnL climbs: R² of a straight-line fit, 0 if it's falling. */
export function smoothness(curve: [number, string][] | undefined): number {
  const pts = (curve ?? []).map(([t, v]) => [t, num(v)] as const);
  if (pts.length < 5) return 0;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (!sxx || !syy || sxy <= 0) return 0;
  return (sxy * sxy) / (sxx * syy);
}

export const drawdown30d = (lead: Lead) => num(lead.copy_score_breakdown?.drawdown_30d?.raw);

/**
 * 0–1 ranking score. Strike's copy score already weighs ROI, drawdown, consistency,
 * activity and copyability; we add how smooth the PnL curve is, recent ROI and how
 * much of the lead is copyable at our size, then discount by drawdown.
 */
/**
 * Return ÷ drawdown × consistency over the 30-day curve, squashed to 0–1. In the walk-forward
 * backtest (bot/backtest2.ts, Oct 2026: 877 traders, 18 settings) this beat the old blend on
 * return, drawdown and worst period; ranking by raw or recent return gave the worst drawdowns.
 */
export function riskAdjusted(lead: Lead): number {
  const vals = returnCurve(lead).map(([, v]) => v);
  if (vals.length < 6) return 0;
  const roi = vals.at(-1)! - vals[0];
  let peak = -Infinity, dd = 0;
  for (const v of vals) {
    peak = Math.max(peak, v);
    dd = Math.max(dd, peak - v);
  }
  // Consistency: share of four equal stretches of the month that made money.
  const q = Math.max(1, Math.floor(vals.length / 4));
  let parts = 0, up = 0;
  for (let i = 0; i + q < vals.length; i += q) {
    parts += 1;
    if (vals[i + q] > vals[i]) up += 1;
  }
  const x = (Math.max(roi, 0) / Math.max(dd, 0.02)) * (0.5 + 0.5 * (parts ? up / parts : 0));
  return x / (x + 3);
}

export function scoreLead(lead: Lead, slotSize: number): number {
  // Steadiness: share of the last 24 hours the lead traded in. Unknown counts as neutral.
  const activity = lead.activeHours24h === undefined ? 0.5 : Math.min(lead.activeHours24h / 24, 1);
  // Core: risk-adjusted, consistent returns, with Strike's own copy score as a second opinion.
  const quality = 0.8 * riskAdjusted(lead) + 0.2 * (num(lead.copy_score) / 100);
  // Copiability: how much of their trading we can mirror at our size, and how steadily they trade.
  const copiable = (0.5 + 0.5 * coverageAt(lead, slotSize)) * (0.8 + 0.2 * activity);
  // Very fast traders copy badly (delay + fees on every fill): fade their score from 150/day to 1,500/day.
  const tpd = tradesPerDay(lead);
  const speed = tpd === undefined || tpd <= 150 ? 1 : tpd >= 1500 ? 0.6 : 1 - (0.4 * (tpd - 150)) / 1350;
  return quality * copiable * speed;
}

/** Why a lead fails the entry rules, or null if it passes. */
export function entryRejection(lead: Lead, cfg: BotConfig, slotSize: number, now: number): string | null {
  const e = cfg.entry;
  if (lead.platform !== e.platform) return "wrong platform";
  if (num(lead.copy_score) < e.minCopyScore) return "copy score too low";
  if (num(lead.roi["30d"]) < e.minRoi30d) return "30d ROI too low";
  if (num(lead.roi["30d"]) > e.maxRoi30d) return "30d ROI suspiciously high";
  if (drawdown30d(lead) > e.maxDrawdown30d) return "30d drawdown too deep";
  if (num(lead.account_value) < e.minAccountValue) return "account too small";
  if ((e.excludeStyles as readonly string[]).includes(lead.style ?? "")) return `style ${lead.style}`;
  if (e.requireCopyRecommendation && lead.recommended_direction !== "copy") return "Strike doesn't recommend copying";
  if (!lead.last_traded_at_ms || now - lead.last_traded_at_ms > e.maxIdleHours * HOUR) return "not trading recently";
  if (coverageAt(lead, slotSize) < e.minCoverage) return "too few trades copyable at our size";
  if (lead.activeHours24h !== undefined && lead.activeHours24h < e.minActiveHours24h) return "trades too rarely";
  const tpd = tradesPerDay(lead);
  if (tpd !== undefined && tpd > e.maxTradesPerDay) return "trades too fast to copy well";
  if (dailyTurnover(lead) > e.maxDailyTurnover) return "churns too much (copy costs eat the profit)";
  if (lead.strikeShare !== undefined && lead.strikeShare < e.minStrikeShare) return "trades coins Strike can't copy";
  if (lead.roi?.["7d"] !== undefined && num(lead.roi["7d"]) < e.minRoi7d) return "cooling off this week";
  if (e.requirePositiveAllTime && lead.roi?.all !== undefined && num(lead.roi.all) <= 0) return "not profitable all-time";
  return null;
}

/**
 * Advance a paper position from its last mark to the lead's latest figures.
 * Strike's fixed-ratio copy sizes every fill at (our amount ÷ lead account value), so our
 * PnL over an interval ≈ our value × lead PnL change ÷ lead account value, scaled by the
 * copyable share. Fees are the taker fee on the volume we'd have mirrored.
 */
export function markToMarket(p: Position, lead: Lead, cfg: BotConfig, now: number): Position {
  const pnlAll = num(lead.pnl.all);
  const volumeAll = num(lead.volume.all);
  const av = p.mark.accountValue > 0 ? p.mark.accountValue : num(lead.account_value);
  if (av <= 0) return { ...p, mark: { ...p.mark, at: now } };

  const ratio = p.value / av;
  const gross = ratio * (pnlAll - p.mark.pnlAll) * p.coverage;
  // Taker fee + slippage on every trade we'd mirror (copies fill a little late, at a worse price).
  const fees = ratio * Math.max(volumeAll - p.mark.volumeAll, 0) * p.coverage * (cfg.takerFee + cfg.slippage);
  const value = Math.max(p.value + gross - fees, 0);
  return {
    ...p,
    value,
    peak: Math.max(p.peak, value),
    fees: p.fees + fees,
    mark: { pnlAll, volumeAll, accountValue: num(lead.account_value), at: now },
  };
}

/** Why a held position should be closed now, or null to keep it. `lead` is undefined if Strike no longer lists it. */
/** A copy's stop-loss: the bold slot runs a tighter one. */
const stopLossOf = (p: Position, cfg: BotConfig) => (p.bold ? cfg.bold.stopLoss : cfg.exit.stopLoss);

export function exitReason(p: Position, lead: Lead | undefined, cfg: BotConfig, now: number): string | null {
  const x = cfg.exit;
  if (p.value <= p.cost * (1 - stopLossOf(p, cfg))) return `stop-loss: down ${pct(1 - p.value / p.cost)}`;
  if (p.value <= p.peak * (1 - x.trailingStop)) return `trailing stop: ${pct(1 - p.value / p.peak)} off its peak`;
  // Quality exits only cut copies that aren't making money: in our live data they mostly closed
  // winners (9 of 11). Stops, a stopped or delisted trader still close a winner too.
  const winning = p.value > p.cost;
  // A copy that can't trade on Strike is dead weight; no point waiting out the hold period.
  if (!winning && lead?.strikeShare !== undefined && lead.strikeShare < x.minStrikeShare) return `trades coins Strike can't copy (${pct(lead.strikeShare)} on Strike)`;
  if (now - p.openedAt < x.minHoldHours * HOUR) return null;
  if (!lead) return "lead no longer listed by Strike";
  if (!lead.last_traded_at_ms || now - lead.last_traded_at_ms > x.maxIdleHours * HOUR) return "lead stopped trading";
  if (winning) return null;
  const tpd = tradesPerDay(lead);
  if (tpd !== undefined && tpd > cfg.entry.maxTradesPerDay) return `trades too fast to copy well (~${Math.round(tpd)}/day)`;
  const turn = dailyTurnover(lead);
  if (turn > cfg.entry.maxDailyTurnover) return `churns ${turn.toFixed(1)}× its account a day (copy costs eat the profit)`;
  if (num(lead.copy_score) < x.minCopyScore) return `copy score fell to ${num(lead.copy_score)}`;
  return null;
}

/** Stop-loss / trailing stop only; checked on every live tick. */
export function hardStopReason(p: Position, cfg: BotConfig): string | null {
  if (p.value <= p.cost * (1 - stopLossOf(p, cfg))) return `stop-loss: down ${pct(1 - p.value / p.cost)}`;
  if (p.value <= p.peak * (1 - cfg.exit.trailingStop)) return `trailing stop: ${pct(1 - p.value / p.peak)} off its peak`;
  return null;
}

export const pct = (f: number) => `${(f * 100).toFixed(1)}%`;
export const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export const equityOf = (s: BotState) => s.cash + s.positions.reduce((t, p) => t + p.value, 0);

/**
 * One bot cycle. `candidates` is the discover list; `held` maps each held lead's address to
 * its fresh profile (missing = no longer listed). Returns the next state; the input is untouched.
 */
export function step(
  state: BotState,
  candidates: Lead[],
  held: Map<string, Lead | undefined>,
  cfg: BotConfig,
  now: number,
  // The live worker marks positions itself from Hyperliquid fills; marking again from
  // Strike's slower stats would double-count, so it passes false.
  opts: { markFromStrike?: boolean } = {},
): BotState {
  const markFromStrike = opts.markFromStrike ?? true;
  const s: BotState = structuredClone(state);
  const log = (d: Omit<Decision, "at">) => s.decisions.push({ at: now, ...d });

  // 1. Mark every position to the lead's latest numbers.
  // Moves are measured against each copy's value at the previous check, so they also
  // capture the live worker's tick-by-tick marking between hourly checks.
  const moves: Scan["moves"] = [];
  const prevScan = new Map((state.lastScan?.moves ?? []).map((m) => [m.lead, m.value]));
  s.positions = s.positions.map((p) => {
    const lead = held.get(p.lead);
    const next = lead && markFromStrike ? markToMarket(p, lead, cfg, now) : p;
    moves.push({ lead: p.lead, change: next.value - (prevScan.get(p.lead) ?? p.value), value: next.value });
    return next;
  });

  // 2. Exits.
  const close = (p: Position, reason: string, cooldownMs = cfg.cooldownDays * 24 * HOUR) => {
    s.positions = s.positions.filter((q) => q !== p);
    s.cash += p.value;
    s.closed.push({ ...p, closedAt: now, reason, pnlUsd: p.value - p.cost, pnlPct: p.cost ? p.value / p.cost - 1 : 0 });
    s.cooldowns[p.lead] = now + cooldownMs;
    log({ action: "close", lead: p.lead, detail: `Stopped copying ${short(p.lead)} (${reason}). ${signed(p.value - p.cost)} on $${p.cost.toFixed(0)}.` });
  };
  for (const p of [...s.positions]) {
    const why = exitReason(p, held.get(p.lead), cfg, now);
    if (why) close(p, why);
  }

  // 3. Rank today's eligible candidates. The bold slot, when on, is one extra slot.
  const boldOn = Boolean(s.bold?.enabled);
  if (!boldOn) for (const p of s.positions.filter((q) => q.bold)) close(p, "bold slot switched off", 24 * HOUR);
  const slots = cfg.maxLeads + (boldOn ? 1 : 0);
  const normalCount = () => s.positions.filter((p) => !p.bold).length;
  const slotSize = equityOf(s) / slots;
  const heldSet = new Set(s.positions.map((p) => p.lead));
  const ranked = candidates
    .filter((c) => !heldSet.has(c.address) && !(s.cooldowns[c.address] > now) && entryRejection(c, cfg, slotSize, now) === null)
    .map((c) => ({ lead: c, score: scoreLead(c, slotSize) }))
    .sort((a, b) => b.score - a.score);

  // Open bets (coin + direction) across the copies we hold, so a new trader doesn't
  // stack a third copy onto the same trade. Live positions from the worker win over
  // the lead's snapshot.
  const betKey = (b: { coin: string; long: boolean }) => `${b.coin}:${b.long ? "long" : "short"}`;
  const betsOf = (address: string): { coin: string; long: boolean }[] =>
    s.live?.[address]?.open ?? held.get(address)?.openBets ?? candidates.find((c) => c.address === address)?.openBets ?? [];
  const betCount = new Map<string, number>();
  const countBets = (address: string, d: 1 | -1) => {
    for (const k of new Set(betsOf(address).map(betKey))) betCount.set(k, (betCount.get(k) ?? 0) + d);
  };
  for (const p of s.positions) countBets(p.lead, 1);

  // Copies we already hold can drift into the same bet (three traders all short HYPE).
  // While more than maxSameBet copies hold the same sizable bet, stop the weakest of them.
  const bigBets = (p: Position) => {
    const open = s.live?.[p.lead]?.open;
    const av = p.mark.accountValue;
    const bets = open ? open.filter((b) => !(av > 0) || b.value >= av * cfg.overlapExit.minShare) : betsOf(p.lead);
    return new Set(bets.map(betKey));
  };
  for (;;) {
    const holders = new Map<string, Position[]>();
    for (const p of s.positions) for (const k of bigBets(p)) holders.set(k, [...(holders.get(k) ?? []), p]);
    const over = [...holders].find(([, ps]) => ps.length > cfg.maxSameBet);
    if (!over) break;
    const [bet, ps] = over;
    // Trim the copy doing worst (then the lowest score), so a winner keeps its place.
    const weakest = ps
      .map((p) => ({ p, perf: p.cost ? p.value / p.cost : 1, score: held.get(p.lead) ? scoreLead(held.get(p.lead)!, slotSize) : 0 }))
      .sort((a, b) => a.perf - b.perf || a.score - b.score)[0].p;
    countBets(weakest.lead, -1);
    close(weakest, `${ps.length} copies held the same ${bet.replace(":", " ")}; dropped the one doing worst`, cfg.overlapExit.cooldownHours * HOUR);
  }

  /** The bet this lead would stack past the limit, or null. */
  const stacked = (lead: Lead) => (lead.openBets ?? []).find((b) => (betCount.get(betKey(b)) ?? 0) >= cfg.maxSameBet) ?? null;
  const overlapSkips = new Set<string>();

  // The bold slot's pick: highest 30d return among leads passing looser rules (cfg.bold).
  const boldCfg = { ...cfg, entry: { ...cfg.entry, minRoi30d: cfg.bold.minRoi30d, maxDrawdown30d: cfg.bold.maxDrawdown30d, minCopyScore: cfg.bold.minCopyScore } } as unknown as BotConfig; // config is `as const`: same shape, other numbers
  const holding = new Set(s.positions.map((p) => p.lead));
  const boldPick =
    boldOn && !s.positions.some((p) => p.bold)
      ? (candidates
          .filter((c) => !holding.has(c.address) && !(s.cooldowns[c.address] > now) && entryRejection(c, boldCfg, slotSize, now) === null && !stacked(c))
          .sort((a, b) => num(b.roi["30d"]) - num(a.roi["30d"]))[0] ?? null)
      : null;

  // 4. Rotation: swap the weakest holding for a clearly better candidate (the bold slot is left alone).
  let rotations = 0;
  if (normalCount() >= cfg.maxLeads) {
    for (const cand of ranked) {
      if (rotations >= cfg.rotation.maxPerRun) break;
      if (boldPick && cand.lead.address === boldPick.address) continue;
      const weakest = s.positions
        // Never rotate out a copy that's making money: our live data showed quality-based
        // swaps mostly cut winners. Winners leave through stops, the profit lock or real exits.
        .filter((p) => !p.bold && now - p.openedAt >= cfg.rotation.minHoldHours * HOUR && p.value <= p.cost)
        .map((p) => ({ p, score: held.get(p.lead) ? scoreLead(held.get(p.lead)!, slotSize) : 0 }))
        .sort((a, b) => a.score - b.score)[0];
      if (!weakest || cand.score < weakest.score + cfg.rotation.scoreMargin) break;
      if (stacked(cand.lead)) continue; // would pile onto a bet we already hold twice
      countBets(weakest.p.lead, -1);
      close(weakest.p, `rotated out for ${short(cand.lead.address)} (score ${weakest.score.toFixed(2)} → ${cand.score.toFixed(2)})`);
      s.decisions[s.decisions.length - 1].action = "rotate";
      rotations++;
    }
  }

  // 5. Free slots but no cash (e.g. maxLeads was raised): shrink every copy to an even
  //    slot, keeping each one's P&L in proportion, so new leads can be added.
  if (s.positions.length < slots && (ranked.length || boldPick) && s.cash < slotSize * 0.5) {
    for (const p of s.positions) {
      if (p.value <= slotSize) continue;
      const k = slotSize / p.value;
      s.cash += p.value - slotSize;
      p.value = slotSize;
      p.cost *= k;
      p.peak *= k;
      p.fees *= k;
    }
    log({ action: "info", detail: `Rebalanced to ${slots} slots of about $${slotSize.toFixed(0)} each to make room for more traders.` });
  }

  // 5b. The bold slot.
  if (boldPick && s.cash >= 1) {
    const size = Math.min(slotSize, s.cash);
    const coverage = coverageAt(boldPick, size);
    s.cash -= size;
    s.positions.push({
      lead: boldPick.address,
      openedAt: now,
      cost: size,
      value: size,
      peak: size,
      fees: 0,
      score: scoreLead(boldPick, size),
      coverage,
      mark: { pnlAll: num(boldPick.pnl.all), volumeAll: num(boldPick.volume.all), accountValue: num(boldPick.account_value), at: now },
      entry: { pnlAll: num(boldPick.pnl.all), av: num(boldPick.account_value) },
      bold: true,
    });
    countBets(boldPick.address, 1);
    log({
      action: "open",
      lead: boldPick.address,
      detail: `Bold slot: copying ${short(boldPick.address)} with $${size.toFixed(0)}: 30d ROI ${pct(num(boldPick.roi["30d"]))}, drawdown ${pct(drawdown30d(boldPick))}, stop-loss ${pct(cfg.bold.stopLoss)}.`,
    });
  }

  // 6. Fill free slots with the best candidates, at most `maxPerTopAsset` per main market.
  const taken = new Set(s.positions.map((p) => p.lead));
  const perAsset = new Map<string, number>();
  for (const p of s.positions) {
    const a = topAsset(held.get(p.lead) ?? candidates.find((c) => c.address === p.lead));
    if (a) perAsset.set(a, (perAsset.get(a) ?? 0) + 1);
  }
  for (const { lead, score } of ranked) {
    if (normalCount() >= cfg.maxLeads) break;
    if (taken.has(lead.address)) continue;
    const asset = topAsset(lead);
    if (asset && (perAsset.get(asset) ?? 0) >= cfg.maxPerTopAsset) continue;
    const bet = stacked(lead);
    if (bet) {
      overlapSkips.add(lead.address);
      continue;
    }
    if (asset) perAsset.set(asset, (perAsset.get(asset) ?? 0) + 1);
    const size = Math.min(slotSize, s.cash);
    if (size < 1) break;
    const coverage = coverageAt(lead, size);
    s.cash -= size;
    s.positions.push({
      lead: lead.address,
      openedAt: now,
      cost: size,
      value: size,
      peak: size,
      fees: 0,
      score,
      coverage,
      mark: { pnlAll: num(lead.pnl.all), volumeAll: num(lead.volume.all), accountValue: num(lead.account_value), at: now },
      entry: { pnlAll: num(lead.pnl.all), av: num(lead.account_value) },
    });
    taken.add(lead.address);
    countBets(lead.address, 1);
    log({
      action: "open",
      lead: lead.address,
      detail: `Copying ${short(lead.address)} with $${size.toFixed(0)}: score ${score.toFixed(2)}, 30d ROI ${pct(num(lead.roi["30d"]))}, drawdown ${pct(drawdown30d(lead))}, ${pct(coverage)} of trades copyable.`,
    });
  }
  if (!s.positions.length && !ranked.length) log({ action: "info", detail: "No lead passes the entry rules right now; staying in cash." });

  // 7. Record what the bot saw, for the public panel.
  const rejections: Record<string, number> = {};
  for (const c of candidates) {
    const r = entryRejection(c, cfg, slotSize, now);
    if (r) rejections[r] = (rejections[r] ?? 0) + 1;
  }
  if (overlapSkips.size) rejections["would stack a bet we already hold"] = overlapSkips.size;
  const heldNow = new Set(s.positions.map((p) => p.lead));
  const heldScores = s.positions.map((p) => (held.get(p.lead) ? scoreLead(held.get(p.lead)!, slotSize) : p.score));
  s.positions.forEach((p, i) => (p.scoreNow = heldScores[i]));
  s.lastScan = {
    at: now,
    checked: candidates.length,
    eligible: ranked.length,
    rejections,
    moves: moves.filter((m) => heldNow.has(m.lead)),
    nextUp: ranked
      .filter((r) => !heldNow.has(r.lead.address))
      .slice(0, 3)
      .map((r) => ({ lead: r.lead.address, score: r.score, roi30d: num(r.lead.roi["30d"]) })),
    weakestHeldScore: heldScores.length ? Math.min(...heldScores) : null,
    trackRecord: s.positions.flatMap((p) => {
      const lead = held.get(p.lead) ?? candidates.find((c) => c.address === p.lead);
      if (!lead) return [];
      return [{ lead: p.lead, roi30d: num(lead.roi["30d"]), coverage: p.coverage, curve: returnCurve(lead) }];
    }),
  };

  // 8. Shadow test: follow the best candidates we did NOT copy, and compare with our picks.
  const heldNow8 = new Set(s.positions.map((p) => p.lead));
  const shadow = (s.shadow ?? []).filter((x) => !heldNow8.has(x.lead));
  const pnlNow = (lead: string) => {
    const l = held.get(lead) ?? candidates.find((c) => c.address === lead);
    return l ? num(l.pnl.all) : undefined;
  };
  for (const x of shadow) x.lastPnl = pnlNow(x.lead) ?? x.lastPnl;
  // Benchmark = Strike's own top copy-score traders that Bolt did not pick
  // (what a naive "copy the leaderboard" strategy would follow).
  const benchmark = [...candidates].sort((a, b) => num(b.copy_score) - num(a.copy_score));
  for (const lead of benchmark) {
    if (shadow.length >= cfg.shadowSize) break;
    if (heldNow8.has(lead.address) || shadow.some((x) => x.lead === lead.address)) continue;
    shadow.push({ lead: lead.address, addedAt: now, start: { pnlAll: num(lead.pnl.all), av: num(lead.account_value) }, lastPnl: num(lead.pnl.all) });
  }
  s.shadow = shadow.slice(-cfg.shadowSize * 3);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const pickReturns = s.positions.flatMap((p) => {
    const now_ = pnlNow(p.lead);
    if (now_ === undefined) return [];
    if (!p.entry) p.entry = { pnlAll: p.mark.pnlAll, av: p.mark.accountValue }; // older copies: start from now
    return [leadReturn(p.entry, now_)];
  });
  if (s.lastScan) s.lastScan.compare = { picks: avg(pickReturns), skipped: avg(s.shadow.map((x) => leadReturn(x.start, x.lastPnl))), skippedCount: s.shadow.length };

  // 9. Housekeeping.
  for (const [k, until] of Object.entries(s.cooldowns)) if (until <= now) delete s.cooldowns[k];
  s.equity.push({ at: now, value: equityOf(s) });
  s.equity = s.equity.slice(-cfg.maxEquityPointsKept);
  s.decisions = s.decisions.slice(-cfg.maxDecisionsKept);
  s.lastRunAt = now;
  return s;
}

const signed = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;
