// "Preview before you go live": the bot's current picks for a rule set, replayed over the traders'
// last 7 days on Strike, with the rules' own limits (copy sizes, High risk's 2× sizing, a stop-loss
// on every copy, profit lock, the daily loss limit). Past data replayed: an estimate, not a promise.
import { copySpecs, pickTraders, RISK_LEVELS, WEEK_POINTS, type AutoRules, type PreviewTrader } from "../worker/autopilot.ts";

export type Replay = {
  copies: { lead: string; amount: number; ret: number; stopped: boolean }[];
  curve: number[]; // the whole budget's return at each point (WEEK_POINTS, every 6 hours)
  ret: number; // over the 7 days, on the budget
  pnl: number; // in dollars
  worst: number; // deepest fall from a high along the way (≤ 0)
  roi30d: number; // the picks' own last 30 days, weighted by copy size (the traders' return, no copy sizing)
  dd30d: number; // the deepest 30-day drawdown among the picks
};

const POINTS_PER_DAY = 4;

export function replayWeek(traders: PreviewTrader[], rules: AutoRules): Replay | null {
  const specs = copySpecs(pickTraders(traders, rules), rules, []);
  if (!specs.length) return null;
  const mult = RISK_LEVELS[rules.risk].multiplier;
  const byLead = new Map(traders.map((t) => [t.lead, t]));
  const weeks = specs.map((s) => {
    const t = byLead.get(s.lead)!;
    return t.week?.length === WEEK_POINTS ? t.week : Array.from({ length: WEEK_POINTS }, (_, i) => (t.roi7d * i) / (WEEK_POINTS - 1));
  });
  const state = specs.map(() => ({ base: 0, ret: 0, banked: 0, stopped: false }));
  const budget = rules.budgetUsd;
  const value = () => budget + specs.reduce((t, s, k) => t + s.amount * (state[k].ret + state[k].banked), 0);
  const curve: number[] = [0];
  let dayStart = budget;
  let paused = false; // the daily limit closed the copies; they start again tomorrow
  let resumeAt = 0;
  for (let i = 1; i < WEEK_POINTS; i++) {
    if ((i - 1) % POINTS_PER_DAY === 0) dayStart = value(); // a new day (points are 6 hours apart)
    if (paused && i >= resumeAt) {
      paused = false;
      specs.forEach((_, k) => {
        if (!state[k].stopped) state[k].base = weeks[k][i - 1]; // fresh copies from here
      });
    }
    if (!paused) {
      specs.forEach((_, k) => {
        const st = state[k];
        if (st.stopped) return;
        const w = weeks[k];
        // This copy's return since its (latest) start: the trader's growth since then, times the sizing.
        st.ret = ((1 + w[i]) / (1 + st.base) - 1) * mult;
        if (st.ret <= -rules.stopLossPct) {
          st.ret = -rules.stopLossPct;
          st.stopped = true;
        } else if (rules.profitLockPct && st.ret >= rules.profitLockPct) {
          st.banked += st.ret; // bank it, then copy the trader again from here
          st.ret = 0;
          st.base = w[i];
        }
      });
      if (dayStart - value() >= rules.dailyLossPct * budget) {
        paused = true;
        resumeAt = (Math.floor((i - 1) / POINTS_PER_DAY) + 1) * POINTS_PER_DAY + 1;
        for (const st of state) if (!st.stopped) {
          st.banked += st.ret; // closed for the day: the loss is taken
          st.ret = 0;
        }
      }
    }
    curve.push(Math.round(((value() - budget) / budget) * 10_000) / 10_000);
  }
  let peak = 1;
  let worst = 0;
  for (const r of curve) {
    peak = Math.max(peak, 1 + r);
    worst = Math.min(worst, (1 + r) / peak - 1);
  }
  const working = specs.reduce((t, s) => t + s.amount, 0);
  const end = curve.at(-1)!;
  return {
    copies: specs.map((s, k) => ({ lead: s.lead, amount: s.amount, ret: Math.round((state[k].ret + state[k].banked) * 10_000) / 10_000, stopped: state[k].stopped })),
    curve,
    ret: end,
    pnl: Math.round(end * budget * 100) / 100,
    worst: Math.round(worst * 10_000) / 10_000,
    roi30d: Math.round((specs.reduce((t, s) => t + s.amount * (byLead.get(s.lead)!.roi30d ?? 0), 0) / working) * 10_000) / 10_000,
    dd30d: Math.max(...specs.map((s) => byLead.get(s.lead)!.dd ?? 0)),
  };
}
