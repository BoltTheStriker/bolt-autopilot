// Autopilot mode: the bot looks after a user's setup by itself, inside the limits the user chose.
// Claude decides when it's available; a plain-rules version decides otherwise. Either way every
// decision goes through applyDecision, which only lets through:
//   - rules no looser than the user's own (risk, budget, leverage, stop-loss, daily limit, markets, goal),
//   - dropping traders the user is copying right now (the engine then picks the next best fit).
// It never touches withdrawals, deposits or anything outside the copy settings.
import type Anthropic from "@anthropic-ai/sdk";
import { boostOf, describeRules, MIN_COPY_USD, RISK_LEVELS, sanitizeRules, type AutoRules, type Goal, type Risk } from "./autopilot.ts";

export const AUTOTUNE_MODEL = "claude-opus-5-5";
const RISKS: Risk[] = ["low", "medium", "high"];
const GOAL_CALM: Record<Goal, number> = { steady: 0, balanced: 1, growth: 2 };
const HOUR = 3_600_000;
export const DROP_MS = 24 * HOUR; // a dropped trader isn't picked again for a day
const MIN_GAP_MS = HOUR; // between reviews
const URGENT_GAP_MS = HOUR / 2; // when losses near the daily limit
const MAX_REVIEWS_PER_DAY = 8;

/** What Autopilot changed: the rules it runs with now, and why. Absent: the user's own rules. */
export type Tuned = { rules: AutoRules; at: number; reason: string };
export type Drops = Record<string, { until: number; reason: string }>; // lowercased lead →
/** One review, as the user sees it: what prompted it, who decided, what changed, the limits check, and what Strike then did. */
export type DecisionRecord = { at: number; by: "ai" | "rules"; note?: string; why: string[]; did: string[]; limits: string; changed: boolean; strike?: string[] };
export type AutotuneState = { tuned?: Tuned; drops?: Drops; reviewedAt?: number; reviews?: { day: string; n: number }; decisions?: DecisionRecord[] };

/** A trader as the review sees them (from the bot's ranking). */
export type TraderStats = { lead: string; score: number; dd: number; roi7d: number; roi30d: number; realWorldShare: number };
export type CopyNow = { lead: string; amount: number; pnl: number };
export type Signal = { kind: "daily" | "out_of_ranking" | "losing_copy" | "near_daily_limit"; lead?: string; detail: string };
export type Decision = { rules: AutoRules | null; drop: { lead: string; reason: string }[]; summary: string; by: "ai" | "rules"; note?: string };

const lc = (s: string) => s.toLowerCase();
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const today = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Rule fields only the user sets (Autopilot's decision tool doesn't carry them; withinLimits keeps the user's). */
const USERS_OWN = new Set<keyof AutoRules>(["stopAtProfitUsd", "stopAtLossUsd", "boost", "dailyProfitUsd", "pauseUntil", "weekdaysOnly", "avoid"]);

/** The user's limits applied to proposed rules: anything looser is pulled back to what they chose.
 *  Profit lock and the number of traders are free (banking gains and spreading out never add risk). */
export function withinLimits(p: AutoRules, limit: AutoRules): AutoRules {
  const risk = RISKS[Math.min(RISKS.indexOf(p.risk), RISKS.indexOf(limit.risk))];
  const level = RISK_LEVELS[risk];
  return {
    budgetUsd: Math.min(p.budgetUsd, limit.budgetUsd),
    risk,
    goal: GOAL_CALM[p.goal] <= GOAL_CALM[limit.goal] ? p.goal : limit.goal,
    markets: limit.markets === "all" ? p.markets : limit.markets,
    traders: Math.round(Math.min(6, Math.max(1, p.traders))),
    maxLeverage: Math.min(p.maxLeverage, limit.maxLeverage, level.maxLeverage),
    stopLossPct: Math.min(p.stopLossPct, limit.stopLossPct, level.stopLossPct),
    profitLockPct: p.profitLockPct,
    dailyLossPct: Math.min(p.dailyLossPct, limit.dailyLossPct, level.dailyLossPct),
    // Copy size: never above the user's own (Autopilot may only step it down).
    ...(p.boost || limit.boost ? { boost: Math.min(p.boost ?? boostOf(limit), boostOf(limit)) } : {}),
    // The user's own targets, schedule and blocked traders, untouched: Autopilot never moves them.
    ...(limit.stopAtProfitUsd ? { stopAtProfitUsd: limit.stopAtProfitUsd } : {}),
    ...(limit.stopAtLossUsd ? { stopAtLossUsd: limit.stopAtLossUsd } : {}),
    ...(limit.dailyProfitUsd ? { dailyProfitUsd: limit.dailyProfitUsd } : {}),
    ...(limit.pauseUntil ? { pauseUntil: limit.pauseUntil } : {}),
    ...(limit.weekdaysOnly ? { weekdaysOnly: true } : {}),
    ...(limit.avoid?.length ? { avoid: limit.avoid } : {}),
  };
}

/** The rules a user's bot runs with: Autopilot's, when it's on and has changed something. */
export function effectiveRules(u: { mode: string; rules: AutoRules | null } & AutotuneState): AutoRules | null {
  if (!u.rules) return null;
  return u.mode === "autopilot" && u.tuned ? withinLimits(u.tuned.rules, u.rules) : u.rules;
}

/** Leads Autopilot has set aside for now. */
export const droppedLeads = (s: AutotuneState, now: number) => new Set(Object.entries(s.drops ?? {}).filter(([, d]) => d.until > now).map(([l]) => l));

/** What should wake a review. Empty: nothing to look at (or too soon since the last one). */
export function autopilotSignals(
  u: { mode: string; rules: AutoRules | null } & AutotuneState,
  ctx: { now: number; copies: CopyNow[]; ranked: Set<string>; dayLossUsd: number },
): Signal[] {
  const rules = effectiveRules(u);
  if (u.mode !== "autopilot" || !rules || !u.rules) return [];
  const { now } = ctx;
  const signals: Signal[] = [];
  const limitUsd = rules.dailyLossPct * rules.budgetUsd;
  const urgent = ctx.dayLossUsd >= 0.6 * limitUsd && limitUsd > 0;
  if (urgent) signals.push({ kind: "near_daily_limit", detail: `down $${ctx.dayLossUsd.toFixed(2)} today; the daily limit is $${limitUsd.toFixed(2)}` });
  for (const c of ctx.copies) {
    if (!ctx.ranked.has(lc(c.lead))) signals.push({ kind: "out_of_ranking", lead: c.lead, detail: `${short(c.lead)} left the bot's ranking of Strike traders` });
    else if (c.pnl <= -0.6 * rules.stopLossPct * c.amount) signals.push({ kind: "losing_copy", lead: c.lead, detail: `${short(c.lead)} is down $${(-c.pnl).toFixed(2)} on $${c.amount.toFixed(0)}, near its stop-loss` });
  }
  const sinceReview = now - (u.reviewedAt ?? 0);
  if (sinceReview >= 24 * HOUR) signals.push({ kind: "daily", detail: "daily review" });
  if (!signals.length) return [];
  if (sinceReview < (urgent ? URGENT_GAP_MS : MIN_GAP_MS)) return [];
  if (u.reviews?.day === today(now) && u.reviews.n >= MAX_REVIEWS_PER_DAY) return [];
  return signals;
}

/** The plain-rules decision: drop traders who left the ranking or are failing with a bad week,
 *  step risk down a level when losses near the daily limit, and step back toward the user's own
 *  rules on a calm day. */
export function rulesDecision(u: { rules: AutoRules | null } & AutotuneState, signals: Signal[], stats: (lead: string) => TraderStats | undefined): Decision {
  const limit = u.rules!;
  const current = u.tuned ? withinLimits(u.tuned.rules, limit) : limit;
  const drop: Decision["drop"] = [];
  for (const s of signals) {
    if (!s.lead) continue;
    if (s.kind === "out_of_ranking") drop.push({ lead: s.lead, reason: "it left the bot's ranking of Strike traders" });
    const st = stats(s.lead);
    if (s.kind === "losing_copy" && st && st.roi7d < 0) drop.push({ lead: s.lead, reason: `it's near its stop-loss and its last week is ${(st.roi7d * 100).toFixed(1)}%` });
  }
  let rules: AutoRules | null = null;
  let why = "";
  const idx = RISKS.indexOf(current.risk);
  if (signals.some((s) => s.kind === "near_daily_limit") && idx > 0) {
    const lower = RISKS[idx - 1];
    const lv = RISK_LEVELS[lower];
    rules = withinLimits({ ...current, risk: lower, maxLeverage: Math.min(current.maxLeverage, lv.maxLeverage), stopLossPct: Math.min(current.stopLossPct, lv.stopLossPct) }, limit);
    why = `losses are close to today's limit, so it stepped down to ${lower} risk`;
  } else if (signals.some((s) => s.kind === "daily") && u.tuned && !signals.some((s) => s.kind !== "daily")) {
    rules = limit; // a calm day: back to the user's own setup
    why = "a calm day, so it went back to your own settings";
  }
  const parts = [...drop.map((d) => `stopped copying ${short(d.lead)} (${d.reason})`), ...(why ? [why] : [])];
  return { rules, drop, summary: parts.length ? parts.join("; ") + "." : "no changes needed.", by: "rules" };
}

const SYSTEM = `You are Bolt Autopilot's decision step. A user switched their copy-trading bot on Strike Finance to Autopilot: you may adjust how it runs, but only inside the limits they chose. Your output goes through a validator that rejects anything looser than their limits.

You can:
- keep everything as it is (often the right call; avoid churn),
- stop copying traders the user copies now (the bot then copies the next best fit from its ranking), when there's a clear reason: they left the ranking, they are near their stop-loss with a poor recent week, or their trading no longer fits the user's goal,
- change the rules within the user's limits: a lower risk level, less leverage, a tighter stop-loss or daily limit, a smaller budget at work, calmer picks (steady), narrower markets, more or fewer traders, a profit lock; or move back toward the user's own settings when things are calm.

Always answer by calling autopilot_decision exactly once, even when nothing needs changing.

Principles: protect the user's money first; prefer the smallest change that fixes the problem; never promise returns. Decide with the numbers given; never invent any. The summary is shown to the user in their activity feed: one or two plain sentences saying what you changed and why (or that nothing needed changing), without markdown.`;

const DECIDE: Anthropic.Beta.BetaTool = {
  name: "autopilot_decision",
  description: "Record the decision. Set change_rules to false to keep the current rules (rules is then ignored).",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      change_rules: { type: "boolean" },
      rules: {
        type: "object",
        properties: {
          risk: { type: "string", enum: ["low", "medium", "high"] },
          goal: { type: "string", enum: ["steady", "balanced", "growth"] },
          markets: { type: "string", enum: ["all", "crypto", "realworld"] },
          traders: { type: "integer" },
          budgetUsd: { type: "number" },
          maxLeverage: { type: "integer" },
          stopLossPct: { type: "number" },
          dailyLossPct: { type: "number" },
          profitLockPct: { type: ["number", "null"] },
        },
        required: ["risk", "goal", "markets", "traders", "budgetUsd", "maxLeverage", "stopLossPct", "dailyLossPct", "profitLockPct"],
        additionalProperties: false,
      },
      drop: {
        type: "array",
        items: { type: "object", properties: { lead: { type: "string" }, reason: { type: "string" } }, required: ["lead", "reason"], additionalProperties: false },
      },
      summary: { type: "string" },
    },
    required: ["change_rules", "rules", "drop", "summary"],
    additionalProperties: false,
  },
};

/** Claude's decision for one review. Throws on any API trouble (the caller falls back to rulesDecision).
 *  Opus 5.5 rejects a forced tool_choice, so the prompt asks for the call and a reply without one is asked again once. */
export async function aiDecision(
  client: Pick<Anthropic, "beta">,
  u: { rules: AutoRules | null } & AutotuneState,
  ctx: { signals: Signal[]; copies: CopyNow[]; dayLossUsd: number; held: TraderStats[]; candidates: TraderStats[] },
): Promise<Decision> {
  const limit = u.rules!;
  const current = u.tuned ? withinLimits(u.tuned.rules, limit) : limit;
  const state = {
    user_limits: { ...limit, text: describeRules(limit) },
    running_with: { ...current, text: describeRules(current) },
    why_now: ctx.signals.map((s) => s.detail),
    today: { loss_usd: Math.round(ctx.dayLossUsd * 100) / 100, daily_limit_usd: Math.round(current.dailyLossPct * current.budgetUsd * 100) / 100 },
    copies: ctx.copies.map((c) => ({ lead: c.lead, amount_usd: c.amount, profit_usd: Math.round(c.pnl * 100) / 100, stats: ctx.held.find((h) => lc(h.lead) === lc(c.lead)) ?? "not in the ranking" })),
    next_best_traders: ctx.candidates.slice(0, 8),
    min_copy_usd: MIN_COPY_USD,
  };
  let call: Anthropic.Beta.BetaToolUseBlock | undefined;
  let stop: string | null = null;
  for (let attempt = 0; attempt < 2 && !call; attempt++) {
    const res = await client.beta.messages.create({
      model: AUTOTUNE_MODEL,
      max_tokens: 2_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools: [DECIDE],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      messages: [{ role: "user", content: `Review this bot now and record your decision with autopilot_decision:\n${JSON.stringify(state)}` }],
    });
    call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === DECIDE.name);
    stop = res.stop_reason;
    if (stop === "refusal") break;
  }
  if (!call) throw new Error(`no decision (${stop})`);
  const x = call.input as { change_rules: boolean; rules: unknown; drop: { lead: string; reason: string }[]; summary: string };
  return {
    rules: x.change_rules ? sanitizeRules(x.rules, limit.budgetUsd) : null,
    drop: Array.isArray(x.drop) ? x.drop.filter((d) => typeof d?.lead === "string" && typeof d?.reason === "string") : [],
    summary: String(x.summary ?? "").slice(0, 400) || "Reviewed your setup.",
    by: "ai",
  };
}

/** Apply a decision, checked: rules pulled inside the user's limits, drops only for traders being
 *  copied now (at most all but one per review). Returns the line for the activity feed, or null. */
export function applyDecision(u: { rules: AutoRules | null } & AutotuneState, d: Decision, now: number, copying: string[], why: string[] = []): string | null {
  const limit = u.rules;
  if (!limit) return null;
  const held = new Set(copying.map(lc));
  const drops = d.drop.filter((x) => held.has(lc(x.lead))).slice(0, Math.max(1, copying.length - 1));
  u.drops = Object.fromEntries(Object.entries(u.drops ?? {}).filter(([, v]) => v.until > now));
  for (const x of drops) u.drops[lc(x.lead)] = { until: now + DROP_MS, reason: x.reason.slice(0, 200) };
  let changed = drops.length > 0;
  const did = drops.map((x) => `Stop copying ${short(x.lead)}: ${x.reason}`);
  let clamped = 0;
  if (d.rules) {
    const next = withinLimits(d.rules, limit);
    const chosen = (Object.keys(next) as (keyof AutoRules)[]).filter((k) => !USERS_OWN.has(k)); // not Autopilot's to choose
    clamped = chosen.filter((k) => JSON.stringify(next[k]) !== JSON.stringify(d.rules![k])).length;
    const before = u.tuned ? withinLimits(u.tuned.rules, limit) : limit;
    if (describeRules(next) !== describeRules(before)) {
      changed = true;
      if (describeRules(next) === describeRules(limit)) delete u.tuned;
      else u.tuned = { rules: next, at: now, reason: d.summary };
      did.push(u.tuned ? `Run with: ${describeRules(next)}` : "Back to your own rules");
    }
  }
  const skipped = d.drop.length - drops.length;
  const checks = [
    clamped ? `pulled ${clamped} setting${clamped > 1 ? "s" : ""} back inside your limits` : "",
    skipped ? `skipped ${skipped} stop${skipped > 1 ? "s" : ""} (a trader not copied now, or the last copy)` : "",
  ].filter(Boolean);
  const record: DecisionRecord = {
    at: now,
    by: d.by,
    ...(d.note ? { note: d.note } : {}),
    why,
    did: did.length ? did : ["Keep everything as it is"],
    limits: checks.length ? `Validator ${checks.join("; ")}.` : "Everything stays inside your limits.",
    changed,
  };
  u.decisions = [record, ...(u.decisions ?? [])].slice(0, 30);
  u.reviewedAt = now;
  const day = today(now);
  u.reviews = u.reviews?.day === day ? { day, n: u.reviews.n + 1 } : { day, n: 1 };
  if (!changed) return `Autopilot checked your setup: ${d.summary}`;
  return `Autopilot: ${d.summary}`;
}
