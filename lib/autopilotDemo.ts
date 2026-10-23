// Demo mode: $1,000 of pretend money that starts when you press Start and then moves live with
// the traders the real engine picked for your rules. Each copy follows its trader's trading
// profit since your start (closed trades net of fees + open positions) divided by their account
// size, the way Strike sizes copies. Your stop-losses, profit lock and daily limit apply.
// An estimate on pretend money: real copies also pay fees and can fill differently.
import type { AutoCopy, AutoDecision } from "./autopilotApi.ts";
import { boostOf, copySpecs, MIN_COPY_USD, pausedNow, pickTraders, type AutoRules, type LiveMark, type PreviewTrader } from "../worker/autopilot.ts";

export const DEMO_BALANCE = 1_000;
const MAX_POINTS = 1_500;

export type DemoCopy = {
  lead: string;
  amount: number;
  mult: number; // 2× sizing on High risk
  acct: number; // the trader's account value at the start (copy-sizing base)
  basePnl: number; // their profit figure when this stretch started
  baseSince: number; // the feed's watch-start stamp (changes if the feed restarts)
  carried: number; // return carried over a feed restart
  ret: number; // latest return of this copy
  banked: number; // profit locked in so far
  stopped: number | null; // when its stop-loss closed it
  closed?: number | null; // when a stop target closed it at its current result (kept in `banked`)
  open: string[]; // the trader's open positions last time we looked
};
export type DemoLive = {
  startedAt: number;
  copies: DemoCopy[];
  log: { at: number; text: string }[];
  curve: [number, number][];
  dayStart: number;
  dayStartValue: number;
  haltedDay: number | null;
  bench?: string[]; // the next best fits for these rules, for Autopilot to move money to
  autoNote?: { at: number; text: string }; // Autopilot's latest action
  decisions?: AutoDecision[]; // Autopilot's reviews, newest first (the demo's are decided by rules, not Claude)
  done?: { at: number; text: string }; // a stop target ended the demo run (the app switches it off)
};
export type DemoOptions = { autopilot?: boolean };

const posKey = (p: { coin: string; long: boolean }) => `${p.coin}:${p.long ? "L" : "S"}`;
const name = (coin: string) => coin.replace(/^xyz:/, "");
const money = (v: number) => `$${Math.abs(v).toFixed(2)}`;
const dayOf = (t: number) => Math.floor(t / 86_400_000);

export function copyValue(c: DemoCopy, stopLossPct: number): number {
  return c.stopped !== null ? c.amount * (1 - stopLossPct) : c.closed ? c.amount : c.amount * (1 + c.ret);
}
export function demoValue(d: DemoLive, stopLossPct: number): number {
  const working = d.copies.reduce((t, c) => t + c.amount, 0);
  return DEMO_BALANCE - working + d.copies.reduce((t, c) => t + copyValue(c, stopLossPct) + c.banked, 0);
}

/** Start: the engine's picks for these rules (traders with a live feed), sized like the real bot. */
export function startDemo(traders: PreviewTrader[], marks: Record<string, LiveMark>, rules: AutoRules, now: number): DemoLive {
  const live = traders.filter((t) => (marks[t.lead]?.acct ?? 0) > 0);
  const specs = copySpecs(pickTraders(live, rules), rules, []);
  const mult = boostOf(rules); // the user's boost (picks already skip blocked traders)
  const copies: DemoCopy[] = specs.map((s) => {
    const m = marks[s.lead];
    return { lead: s.lead, amount: s.amount, mult, acct: m.acct, basePnl: m.pnl, baseSince: m.since, carried: 0, ret: 0, banked: 0, stopped: null, open: m.positions.map(posKey) };
  });
  const log = [
    { at: now, text: `Demo started with $${DEMO_BALANCE.toLocaleString("en-US")}: copying ${copies.length} trader${copies.length === 1 ? "" : "s"}.` },
    ...copies.map((c) => ({ at: now, text: `Copying ${c.lead} with $${c.amount.toFixed(0)} (stops at −$${(c.amount * rules.stopLossPct).toFixed(0)}).` })),
  ];
  // The next best fits, in order, for Autopilot mode (smallest copy size: they must be followable when money moves).
  const bench = pickTraders(live, { ...rules, traders: 6 })
    .map((t) => t.lead)
    .filter((l) => !specs.some((s) => s.lead === l));
  return { startedAt: now, copies, log, curve: [[now, DEMO_BALANCE]], dayStart: dayOf(now), dayStartValue: DEMO_BALANCE, haltedDay: null, bench };
}

/** Move the demo to the latest marks. Pure: returns a new state. In Autopilot mode, money a stop-loss
 *  frees goes on to the next best fit for the rules (the real bot's Autopilot does the same, and more). */
export function stepDemo(prev: DemoLive, marks: Record<string, LiveMark>, rules: AutoRules, now: number, opts: DemoOptions = {}): DemoLive {
  const d: DemoLive = { ...prev, copies: prev.copies.map((c) => ({ ...c })), log: [...prev.log], curve: [...prev.curve] };
  const say = (text: string) => d.log.unshift({ at: now, text });
  if (dayOf(now) !== d.dayStart) {
    d.dayStart = dayOf(now);
    d.dayStartValue = demoValue(d, rules.stopLossPct);
  }
  // A timed pause or the weekend (the user's schedule) holds the demo still, like a halted day.
  const halted = d.haltedDay === d.dayStart || !!pausedNow(rules, now);
  for (const c of d.copies) {
    const m = marks[c.lead];
    if (!m || c.stopped !== null || c.closed || halted || d.done) continue;
    if (m.since !== c.baseSince) {
      // The feed restarted: keep what this copy made so far and continue from the new baseline.
      c.carried = c.ret;
      c.basePnl = m.pnl;
      c.baseSince = m.since;
    }
    c.ret = c.carried + ((m.pnl - c.basePnl) / c.acct) * c.mult;
    // What the trader did since we last looked.
    const open = m.positions.map(posKey);
    const opened = m.positions.filter((p) => !c.open.includes(posKey(p)));
    const closed = c.open.filter((k) => !open.includes(k));
    for (const p of opened.slice(0, 3)) say(`${c.lead} opened ${name(p.coin)} ${p.long ? "long" : "short"}: your copy follows.`);
    for (const k of closed.slice(0, 3)) say(`${c.lead} closed ${name(k.slice(0, k.lastIndexOf(":")))} ${k.endsWith(":L") ? "long" : "short"}.`);
    c.open = open;
    if (c.ret <= -rules.stopLossPct) {
      c.stopped = now;
      say(`Stop-loss: copy of ${c.lead} closed at −${money(c.amount * rules.stopLossPct)}. The rest kept running.`);
      if (opts.autopilot) autopilotSwap(d, c, marks, rules, now, say);
    } else if (rules.profitLockPct && c.ret >= rules.profitLockPct) {
      const gain = c.amount * c.ret;
      c.banked += gain;
      say(`Profit locked: banked +${money(gain)} from ${c.lead}, then copied them again fresh.`);
      c.carried = 0;
      c.ret = 0;
      c.basePnl = m.pnl;
    }
  }
  const value = demoValue(d, rules.stopLossPct);
  // The user's whole-bot targets: close every running copy at its current result and end the run.
  const profit = value - DEMO_BALANCE;
  const hit = d.done ? null : rules.stopAtProfitUsd && profit >= rules.stopAtProfitUsd ? "profit" : rules.stopAtLossUsd && profit <= -rules.stopAtLossUsd ? "loss" : null;
  if (hit) {
    for (const c of d.copies.filter((x) => x.stopped === null && !x.closed)) {
      c.banked += c.amount * c.ret;
      c.ret = 0;
      c.closed = now;
    }
    const text =
      hit === "profit"
        ? `Profit target reached: +${money(profit)} since Start (your target was +${money(rules.stopAtProfitUsd!)}). Every copy closed; start again whenever you like.`
        : `Loss limit reached: −${money(profit)} since Start (your limit was −${money(rules.stopAtLossUsd!)}). Every copy closed.`;
    d.done = { at: now, text };
    say(text);
  }
  if (opts.autopilot && !d.done && (!d.decisions?.length || now - d.decisions[0].at >= HOUR)) autopilotCheck(d, rules, value, now, say);
  if (!halted && value <= d.dayStartValue * (1 - rules.dailyLossPct)) {
    d.haltedDay = d.dayStart;
    say(`Daily loss limit (−${Math.round(rules.dailyLossPct * 100)}%) reached: copying paused until tomorrow.`);
  } else if (!halted && !d.done && rules.dailyProfitUsd && value - d.dayStartValue >= rules.dailyProfitUsd) {
    d.haltedDay = d.dayStart;
    say(`Daily profit target reached (+${money(value - d.dayStartValue)} today, your target was +${money(rules.dailyProfitUsd)}): copying paused until tomorrow.`);
  }
  const last = d.curve.at(-1);
  if (!last || now - last[0] >= 30_000) d.curve.push([now, Math.round(value * 100) / 100]);
  if (d.curve.length > MAX_POINTS) d.curve.splice(1, d.curve.length - MAX_POINTS); // keep the start point
  if (d.log.length > 200) d.log.length = 200;
  return d;
}

/** Autopilot: move what a stopped copy has left to the next best fit that has a live feed. */
function autopilotSwap(d: DemoLive, c: DemoCopy, marks: Record<string, LiveMark>, rules: AutoRules, now: number, say: (t: string) => void) {
  const lost = c.amount * rules.stopLossPct;
  const rest = c.amount - lost;
  const next = (d.bench ?? []).find((l) => (marks[l]?.acct ?? 0) > 0 && !d.copies.some((x) => x.lead === l));
  if (!next || rest < MIN_COPY_USD) return;
  const m = marks[next];
  const from = c.lead;
  Object.assign(c, { lead: next, amount: Math.floor(rest * 100) / 100, acct: m.acct, basePnl: m.pnl, baseSince: m.since, carried: 0, ret: 0, banked: c.banked - lost, stopped: null, open: m.positions.map(posKey) });
  d.bench = (d.bench ?? []).filter((l) => l !== next);
  const text = `Autopilot: ${from} hit its stop-loss, so it moved the remaining ${money(rest)} to ${next}, the next best fit for your rules.`;
  say(text);
  d.autoNote = { at: now, text };
  record(d, {
    at: now,
    by: "rules",
    why: [`${from} hit its stop-loss (−${Math.round(rules.stopLossPct * 100)}%)`],
    did: [`Move the remaining ${money(rest)} to ${next}, the next best fit for your rules`],
    limits: "Same budget and the same rules: the money moved, nothing was added.",
    changed: true,
    strike: ["Demo: pretend money, so no real orders."],
  });
}

/** "Switch trader" in the demo: the copy keeps its money (what it made so far is banked) and follows the next best fit
 *  with a live feed instead. Null when there's no one to switch to. */
export function swapDemoCopy(prev: DemoLive, lead: string, marks: Record<string, LiveMark>, now: number): DemoLive | null {
  const next = (prev.bench ?? []).find((l) => (marks[l]?.acct ?? 0) > 0 && !prev.copies.some((x) => x.lead === l));
  const i = prev.copies.findIndex((c) => c.lead === lead && c.stopped === null && !c.closed);
  if (!next || i < 0) return null;
  const d: DemoLive = { ...prev, copies: prev.copies.map((c) => ({ ...c })), log: [...prev.log], bench: (prev.bench ?? []).filter((l) => l !== next) };
  const c = d.copies[i];
  const m = marks[next];
  Object.assign(c, { lead: next, banked: c.banked + c.amount * c.ret, ret: 0, carried: 0, acct: m.acct, basePnl: m.pnl, baseSince: m.since, open: m.positions.map(posKey) });
  d.log.unshift({ at: now, text: `Switched from ${lead} to ${next} as you asked: ${next} is the next best fit for your rules.` });
  return d;
}

const HOUR = 3_600_000;
const record = (d: DemoLive, r: AutoDecision) => (d.decisions = [r, ...(d.decisions ?? [])].slice(0, 20));

/** Autopilot's routine check in the demo (on switching it on, then hourly): every copy against its stop-loss, today against the daily limit. */
function autopilotCheck(d: DemoLive, rules: AutoRules, value: number, now: number, say: (t: string) => void) {
  const running = d.copies.filter((c) => c.stopped === null);
  const worst = [...running].sort((a, b) => a.ret - b.ret)[0];
  const today = d.dayStartValue ? value / d.dayStartValue - 1 : 0;
  const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
  record(d, {
    at: now,
    by: "rules",
    why: [d.decisions?.length ? "Hourly check" : "You switched on Autopilot"],
    did: ["Keep everything as it is"],
    limits: [
      worst ? `Every copy is inside its stop-loss (closest: ${worst.lead} at ${pct(worst.ret)}, stop at −${Math.round(rules.stopLossPct * 100)}%).` : "",
      `Today ${pct(today)}, inside the −${Math.round(rules.dailyLossPct * 100)}% daily limit.`,
    ].filter(Boolean).join(" "),
    changed: false,
  });
  say("Autopilot checked your setup: everything is inside your rules.");
}

/** The dashboard's copies: each copy's profit, and the trader's open positions scaled to the copy. */
export function demoCopies(d: DemoLive, marks: Record<string, LiveMark>, stopLossPct: number): (AutoCopy & { stopped: boolean })[] {
  return d.copies.map((c) => {
    const m = marks[c.lead];
    const scale = (c.amount / c.acct) * c.mult;
    return {
      lead: c.lead,
      amount: c.amount,
      pnl: Math.round((copyValue(c, stopLossPct) - c.amount + c.banked) * 100) / 100,
      positions: c.stopped !== null || !m ? [] : m.positions.map((p) => ({ market: p.coin, long: p.long, pnl: Math.round(p.pnl * scale * 100) / 100 })),
      stopped: c.stopped !== null,
    };
  });
}
