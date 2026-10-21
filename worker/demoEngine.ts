// Holder demo engine: each holder's own fake-money portfolio, run by their own rules.
// Pure functions, no I/O. The worker keeps a running return index per trader on the bot's
// shortlist ("pool"); each copy follows its trader's index (times the holder's leverage), so marking is arithmetic.

export type Style = "steady" | "balanced" | "bold" | "aggressive";
export type TpMode = "off" | "bank" | "close";
export type DemoSettings = {
  traders: number; // 1–10
  style: Style;
  stopLoss: number; // 0.05–0.25, drop a trader whose copy falls this much
  trailing: number | null; // 0.10–0.30 off the copy's best, or off
  tp: { mode: TpMode; pct: number }; // take profit at +pct (0.05–0.50)
  leverage?: number; // 1–3: each copy moves this many times the trader's return (demo only)
};

export const DEFAULT_SETTINGS: DemoSettings = { traders: 5, style: "balanced", stopLoss: 0.15, trailing: 0.2, tp: { mode: "off", pct: 0.1 }, leverage: 1 };
/** Aggressive concentrates: at most this many traders, whatever the slider says. */
export const AGGRESSIVE_MAX = 3;
export const leverageOf = (s: DemoSettings) => s.leverage ?? 1;
/** How many traders the rules actually copy. */
export const tradersFor = (s: DemoSettings) => (s.style === "aggressive" ? Math.min(s.traders, AGGRESSIVE_MAX) : s.traders);

/** A trader on the bot's shortlist, with what the styles need. */
export type PoolLead = { lead: string; score: number; roi30d: number; roi7d?: number; dd: number };
/** Running return index per trader (starts at 1 when it joins the pool). */
export type LeadIndex = Record<string, number>;

/** A copy. `val` is its value at the trader's index `lastIdx`; from there it moves by leverage × the index change.
 *  First-version copies only had `units` (value = units × index); they're converted on their next step. */
export type DemoPos = { lead: string; val?: number; units?: number; cost: number; peak: number; openedAt: number; lastIdx: number };
export type DemoDecision = { at: number; kind: "open" | "close" | "bank" | "settings" | "info"; text: string };
export type Portfolio = {
  settings: DemoSettings;
  cash: number; // investable cash
  positions: DemoPos[];
  cooldowns: Record<string, number>;
  decisions: DemoDecision[];
  history: { at: number; value: number }[];
  banked: number; // profit set aside by "bank & keep": counts in the balance, never reinvested
};

const HOUR = 3_600_000;
const COOLDOWN = 24 * HOUR;
const HISTORY_STEP = 15 * 60_000;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (f: number) => `${(f * 100).toFixed(1)}%`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Validate settings from the site; null if they don't make sense. */
export function sanitizeSettings(x: unknown): DemoSettings | null {
  const s = x as Partial<DemoSettings> | null;
  if (!s || typeof s !== "object") return null;
  const style = s.style;
  const mode = s.tp?.mode;
  if (!["steady", "balanced", "bold", "aggressive"].includes(style as string) || !["off", "bank", "close"].includes(mode as string)) return null;
  const traders = Math.round(Number(s.traders));
  const stopLoss = Number(s.stopLoss);
  const tpPct = Number(s.tp?.pct);
  if (!Number.isFinite(traders) || !Number.isFinite(stopLoss) || !Number.isFinite(tpPct)) return null;
  const trailing = s.trailing === null || s.trailing === undefined ? null : Number(s.trailing);
  if (trailing !== null && !Number.isFinite(trailing)) return null;
  const leverage = s.leverage === undefined ? 1 : Math.round(Number(s.leverage));
  if (!Number.isFinite(leverage)) return null;
  return {
    traders: clamp(traders, 1, 10),
    style: style as Style,
    stopLoss: clamp(stopLoss, 0.05, 0.25),
    trailing: trailing === null ? null : clamp(trailing, 0.1, 0.3),
    tp: { mode: mode as TpMode, pct: clamp(tpPct, 0.05, 0.5) },
    leverage: clamp(leverage, 1, 3),
  };
}

export const describeSettings = (s: DemoSettings) =>
  `${tradersFor(s)} trader${tradersFor(s) === 1 ? "" : "s"}, ${s.style}, ${leverageOf(s)}x, stop-loss ${pct(s.stopLoss)}, trailing ${s.trailing ? pct(s.trailing) : "off"}, take profit ${
    s.tp.mode === "off" ? "off" : `${s.tp.mode === "bank" ? "bank & keep" : "close"} at +${pct(s.tp.pct)}`
  }`;

/** The shortlist in the order a style prefers. Steady: calmest first (lowest drawdown);
 *  Balanced: the bot's score; Bold: highest 30-day returns; Aggressive: the bot's top picks, concentrated.
 *  Every style always has picks. */
export function pickForStyle(pool: PoolLead[], style: Style): PoolLead[] {
  if (style === "steady") return [...pool].sort((a, b) => a.dd - b.dd || b.score - a.score);
  if (style === "bold") return [...pool].sort((a, b) => b.roi30d - a.roi30d);
  // Aggressive = the bot's very best picks, concentrated (at most AGGRESSIVE_MAX). Chasing this
  // week's hottest traders doubled the drawdowns in the backtest (bot/backtest2.ts).
  if (style === "aggressive") return [...pool].sort((a, b) => b.score - a.score);
  return [...pool].sort((a, b) => b.score - a.score);
}

export function newPortfolio(balance: number, now: number, settings: DemoSettings = DEFAULT_SETTINGS): Portfolio {
  return { settings, cash: balance, positions: [], cooldowns: {}, decisions: [{ at: now, kind: "info", text: `Demo started with ${usd(balance)}.` }], history: [{ at: now, value: balance }], banked: 0 };
}

const baseVal = (p: DemoPos) => p.val ?? (p.units ?? 0) * p.lastIdx;
/** A copy's value now: its last value, moved by leverage × the trader's return since then (never below 0). */
export const posValue = (p: DemoPos, idx: LeadIndex, leverage = 1) => Math.max(0, baseVal(p) * (1 + leverage * ((idx[p.lead] ?? p.lastIdx) / p.lastIdx - 1)));
export const portfolioValue = (pf: Portfolio, idx: LeadIndex) =>
  pf.cash + pf.banked + pf.positions.reduce((t, p) => t + posValue(p, idx, leverageOf(pf.settings)), 0);

function log(pf: Portfolio, now: number, kind: DemoDecision["kind"], text: string) {
  pf.decisions.unshift({ at: now, kind, text });
  pf.decisions = pf.decisions.slice(0, 60);
}

/** Apply new settings from now: keep the balance, log it; the next step acts on them. */
export function applySettings(pf: Portfolio, settings: DemoSettings, now: number) {
  pf.settings = settings;
  log(pf, now, "settings", `Settings changed: ${describeSettings(settings)}.`);
}

/** One pass of a holder's rules: mark, exits, take profit, trim, fill. Mutates and returns the portfolio. */
export function stepPortfolio(pf: Portfolio, pool: PoolLead[], idx: LeadIndex, now: number): Portfolio {
  const s = pf.settings;
  const lev = leverageOf(s);
  const n = tradersFor(s);
  const inPool = new Map(pool.map((l) => [l.lead, l]));

  // 1. Mark: fold the move since the last mark into each copy's value.
  for (const p of pf.positions) {
    p.val = posValue(p, idx, lev);
    delete p.units;
    if (idx[p.lead] !== undefined) p.lastIdx = idx[p.lead];
    p.peak = Math.max(p.peak, p.val);
  }
  const value = (p: DemoPos) => p.val!;

  // 2. Exits and take profit.
  const close = (p: DemoPos, reason: string, cooldown = true) => {
    const v = value(p);
    pf.cash += v;
    pf.positions = pf.positions.filter((q) => q !== p);
    if (cooldown) pf.cooldowns[p.lead] = now + COOLDOWN;
    const change = v - p.cost;
    log(pf, now, "close", `Stopped copying ${short(p.lead)}: ${reason}. ${change >= 0 ? "+" : "−"}${usd(Math.abs(change))} on ${usd(p.cost)}.`);
  };
  for (const p of [...pf.positions]) {
    const v = value(p);
    if (pool.length && !inPool.has(p.lead)) close(p, "left the bot's shortlist", false);
    else if (v <= p.cost * (1 - s.stopLoss)) close(p, `hit your ${pct(s.stopLoss)} stop-loss`);
    else if (s.trailing && p.peak > p.cost && v <= p.peak * (1 - s.trailing)) close(p, `fell ${pct(s.trailing)} off its best (trailing stop)`);
    else if (s.tp.mode !== "off" && v >= p.cost * (1 + s.tp.pct)) {
      if (s.tp.mode === "close") close(p, `took profit at +${pct(v / p.cost - 1)}`);
      else {
        // Bank & keep: profit to cash, keep copying at the original size.
        const profit = v - p.cost;
        pf.banked += profit;
        p.val = p.cost;
        p.peak = p.cost;
        log(pf, now, "bank", `Banked +${usd(profit)} from ${short(p.lead)} at +${pct(profit / p.cost)}; still copying it with ${usd(p.cost)}.`);
      }
    }
  }

  // 3. Fewer traders than held: drop the weakest by the bot's score.
  if (pf.positions.length > n) {
    const weakest = [...pf.positions].sort((a, b) => (inPool.get(a.lead)?.score ?? 0) - (inPool.get(b.lead)?.score ?? 0));
    for (const p of weakest.slice(0, pf.positions.length - n)) close(p, "you lowered the number of traders", false);
  }

  // 4. Fill free slots with the style's best picks, evenly sized.
  const picks = pickForStyle(pool, s.style).filter((l) => idx[l.lead] !== undefined && !pf.positions.some((p) => p.lead === l.lead) && !(pf.cooldowns[l.lead] > now));
  const total = portfolioValue(pf, idx) - pf.banked; // banked profit stays aside
  const slot = total / n;
  if (pf.positions.length < n && picks.length && pf.cash < slot * 0.5) {
    // More traders wanted but the money is all invested: trim bigger copies down to the new slot size.
    for (const p of pf.positions) {
      const v = value(p);
      if (v <= slot) continue;
      const k = slot / v;
      pf.cash += v - slot;
      p.val = slot;
      p.cost *= k;
      p.peak *= k;
    }
  }
  for (const l of picks) {
    if (pf.positions.length >= n) break;
    const amount = Math.min(slot, pf.cash);
    if (amount < 1) break;
    pf.cash -= amount;
    pf.positions.push({ lead: l.lead, val: amount, cost: amount, peak: amount, openedAt: now, lastIdx: idx[l.lead] });
    log(pf, now, "open", `Copying ${short(l.lead)} with ${usd(amount)} (score ${l.score.toFixed(2)}, 30d ${pct(l.roi30d)}).`);
  }
  // All slots full but cash left over (e.g. after dropping a trader): spread it over the copies.
  if (pf.positions.length === n && pf.cash >= 1) {
    const each = pf.cash / pf.positions.length;
    for (const p of pf.positions) {
      p.val = value(p) + each;
      p.cost += each;
      p.peak += each;
    }
    pf.cash = 0;
  }
  for (const [k, until] of Object.entries(pf.cooldowns)) if (until <= now) delete pf.cooldowns[k];

  // 5. History for the chart: a point every 15 minutes, the latest kept live.
  const valueNow = portfolioValue(pf, idx);
  const h = pf.history;
  if (h.length > 1 && now - h[h.length - 2].at < HISTORY_STEP) h[h.length - 1] = { at: now, value: valueNow };
  else h.push({ at: now, value: valueNow });
  if (h.length > 2_000) h.splice(0, h.length - 2_000);
  return pf;
}

/** Return of a trader between two marks, as a fraction of their account (what a fixed-ratio copy earns). */
export function indexStep(realized: number, unrealizedDelta: number, volume: number, accountValue: number, coverage: number, costRate: number): number {
  if (!(accountValue > 0)) return 0;
  return (coverage * (realized + unrealizedDelta - volume * costRate)) / accountValue;
}
