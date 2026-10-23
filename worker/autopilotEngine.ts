// Runs one Autopilot user's bot against their own Strike account: compares the copies their
// rules call for with what's running, then stops and starts copies to match. Mirrors the live
// bot's sync (worker/live.ts) but per user, with isolated copy sub-accounts and the user's limits.

import { MIN_COPY_USD, pausedNow, type CopySpec } from "./autopilot.ts";
import { logUser, type AutoUser } from "./autopilotStore.ts";
import type { CopyPosition, CopySub, StrikeClient, SubAccount } from "./strike-live.ts";

export type UserAction = { type: "stop"; lead: string; id: string; reason: string } | { type: "subscribe"; spec: CopySpec };

const lc = (s: string) => s.toLowerCase();

/** What must change for this user: stop copies the rules no longer want, start the missing ones. Pure. */
export function planUser(managed: Record<string, string>, specs: CopySpec[], active: CopySub[]): UserAction[] {
  const want = new Set(specs.map((s) => lc(s.lead)));
  const activeIds = new Set(active.map((s) => s.subscription_id));
  const activeLeads = new Set(active.map((s) => lc(s.lead_account_id)));
  const actions: UserAction[] = [];
  for (const [lead, id] of Object.entries(managed)) {
    if (activeIds.has(id) && !want.has(lc(lead))) actions.push({ type: "stop", lead, id, reason: "no longer in your bot's picks" });
  }
  for (const spec of specs) if (!activeLeads.has(lc(spec.lead))) actions.push({ type: "subscribe", spec });
  return actions;
}

const today = (now: number) => new Date(now).toISOString().slice(0, 10);
const COOLDOWN_MS = 6 * 3_600_000;

/** Money sitting in this user's copy sub-accounts with no copy running there (Strike leaves it
 *  behind when a copy ends). */
export function parkedOf(u: AutoUser, subAccts: SubAccount[], active: CopySub[]) {
  const busy = new Set(active.map((s) => s.account_id).filter(Boolean));
  return subAccts
    .filter((a) => (u.subs ?? []).includes(a.account_id) && !busy.has(a.account_id) && !(Number(a.margin_used_pct ?? 0) > 0))
    .map((a) => ({ id: a.account_id, available: Math.floor(Number(a.available_balance ?? 0) * 100) / 100 }))
    .filter((a) => a.available >= 0.01);
}

/** Copy sub-accounts this bot started before it kept track of them: match Strike's "Copy · 0x3b3d9…5b464"
 *  names against the traders the bot's own log says it copied. */
function adoptParked(u: AutoUser, subAccts: SubAccount[]) {
  const copied = [...u.log.map((l) => l.text).join(" ").matchAll(/Copying (0x[0-9a-f]{4})…([0-9a-f]{4})/gi)].map((m) => [m[1].toLowerCase(), m[2].toLowerCase()]);
  for (const a of subAccts) {
    const name = a.name.toLowerCase();
    if (!name.startsWith("copy") || u.subs!.includes(a.account_id)) continue;
    if (copied.some(([head, tail]) => name.includes(head) && name.includes(tail))) u.subs!.push(a.account_id);
  }
}
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The bot's copies for this user and each one's profit the way Strike's screen shows it: realized plus
 *  open positions at mark (a subscription's own `pnl` lags). Shared by the sync and the live read. */
export function copiesNow(u: AutoUser, active: CopySub[], rows: CopyPosition[] | null) {
  const ours = active.filter((s) => Object.values(u.managed).includes(s.subscription_id));
  return ours.map((s) => {
    const open = (rows ?? []).filter((r) => !r.own && r.subscription_id === s.subscription_id);
    const profit = Number(s.realized_pnl ?? 0) + (rows ? open.reduce((t, r) => t + Number(r.pnl ?? 0), 0) : Number(s.pnl ?? 0) - Number(s.realized_pnl ?? 0));
    // isolated: runs in its own sub-account (first version), so its money isn't in the main balance.
    const isolated = !!s.account_id && s.account_id !== u.accountId;
    return { lead: s.lead_account_id, amount: Number(s.copy_amount ?? 0), pnl: profit, isolated, positions: open.map((r) => ({ market: r.market, long: r.side === "long", pnl: Number(r.pnl ?? 0) })) };
  });
}

/** Money in minus money out on the user's Strike account (at most once a minute), so profit = what's there − what was
 *  put in. The dashboard reads it with the balance, so a new deposit never shows up as profit. */
export async function readFlows(u: AutoUser, client: StrikeClient, now: number) {
  if (u.flows && now - u.flows.at < 60_000) return;
  try {
    const p = await client.request<{ capital_flows?: Record<string, string> }>("GET", "/v2/portfolio");
    const f = p.data?.capital_flows;
    if (f) u.flows = { netIn: num(f.all_time_deposits) - num(f.all_time_withdrawals) + num(f.all_time_transfer_in) - num(f.all_time_transfer_out), at: now };
  } catch {
    // display-only: a failed read never holds up the sync
  }
}
const num = (v: unknown) => Number(v) || 0;

/** Strike's reasons for not copying an order, in the user's words. */
export function skipReason(code: string): string {
  if (code === "max_margin_per_symbol") return "it would put more of this copy on one coin than its limit allows";
  if (code === "max_margin_total") return "this copy's money is already fully in use";
  if (code === "zero_size") return "at this copy's size the trade rounds down to nothing (a bigger copy can follow it)";
  if (code === "excluded_symbol") return "your rules leave that market out";
  if (/leverage/.test(code)) return "Strike couldn't set the leverage for it";
  if (/market_order/.test(code)) return "it broke one of Strike's order rules (size or price limits)";
  return code.replace(/_/g, " ");
}

/** Orders Strike couldn't copy for this user, told once each (newest first, at most 3 a sync): a copy that stays empty
 *  should never fail silently. Only this user's own copies, over the last day. */
async function tellSkips(u: AutoUser, client: StrikeClient, now: number) {
  const ours = new Set(Object.values(u.managed));
  if (!ours.size) return;
  type Failed = { orders?: { id: string; subscription_id: string; lead_account_id: string; symbol: string; error_message?: string | null; created_at_ms: number }[] };
  let r: { data: Failed } | null = null;
  try {
    r = await client.request<Failed>("GET", "/v2/copy/orders?status=failed&limit=20");
  } catch {
    return; // a missing reason never holds up the sync
  }
  const told = new Set(u.skipsTold ?? []);
  const fresh = (r?.data?.orders ?? []).filter((o) => ours.has(o.subscription_id) && !told.has(o.id) && now - o.created_at_ms < 86_400_000 && o.error_message);
  for (const o of fresh.slice(0, 3).reverse())
    logUser(u, now, `Couldn't copy a ${o.symbol.replace(/-USD$/, "")} trade from ${short(o.lead_account_id)}: ${skipReason(o.error_message!)}.`);
  u.skipsTold = [...fresh.map((o) => o.id), ...(u.skipsTold ?? [])].slice(0, 100);
}

/**
 * One sync for one user. Mutates the user. Never throws: errors land on the user's log.
 * `specs` empty = stop everything (the user switched off, or the daily limit was hit).
 */
export async function syncUser(u: AutoUser, client: StrikeClient, specs: CopySpec[], now: number): Promise<void> {
  try {
    // Isolated copies run in their own sub-accounts: read the master account and all of them.
    const active = await client.subscriptions("active", true);
    const subAccts = await client.subAccounts().catch(() => []);
    u.subs ??= [];
    for (const s of active) if (s.account_id && s.account_id !== u.accountId && Object.values(u.managed).includes(s.subscription_id) && !u.subs.includes(s.account_id)) u.subs.push(s.account_id);
    adoptParked(u, subAccts);
    // A run lasts from Start until the bot stops; its profit includes copies that already ended (for the stop targets).
    if (u.mode !== "off") u.run ??= { since: now, closed: 0 };
    const lastPnl = (lead: string) => (u.copies ?? []).find((c) => lc(c.lead) === lc(lead))?.pnl ?? 0;
    // Copies Strike already ended (stop-loss hit, stopped in the Strike app).
    for (const [lead, id] of Object.entries(u.managed)) {
      if (!active.some((s) => s.subscription_id === id)) {
        if (u.run) u.run.closed += lastPnl(lead); // its last known result, from the previous sync
        delete u.managed[lead];
        logUser(u, now, `Copy of ${short(lead)} ended on Strike (stop-loss or stopped in the app).`);
      }
    }
    // Each copy's profit the way Strike's screen shows it: realized + open positions at mark
    // (the subscription's own `pnl` lags). Kept on the user for their page.
    const ours = active.filter((s) => Object.values(u.managed).includes(s.subscription_id));
    // Volume each copy has traded on Strike (kept after a copy ends, for the impact page).
    u.volume ??= {};
    for (const s of ours) {
      const prev = u.volume[s.subscription_id];
      const usd = Number(s.total_volume ?? 0);
      const orders = Number(s.filled_order_count ?? 0);
      if (!prev || usd >= prev.usd) u.volume[s.subscription_id] = { usd, orders };
    }
    const rows = await client.copyPositions(true).catch(() => null);
    u.copies = copiesNow(u, active, rows);
    await tellSkips(u, client, now);
    await readFlows(u, client, now);
    // Daily loss limit: today's change in the copies' profit, against the budget.
    const pnl = u.copies.reduce((t, c) => t + c.pnl, 0);
    // The dashboard's chart: profit on the running copies at each sync (while the bot runs or holds copies).
    if (u.mode !== "off" || u.copies.length) {
      u.history ??= [];
      if (!u.history.length || now - u.history[u.history.length - 1].at >= 60_000)
        u.history.push({ at: now, pnl: Math.round(pnl * 100) / 100, working: Math.round(u.copies.reduce((t, c) => t + c.amount, 0) * 100) / 100 });
      if (u.history.length > 1_000) u.history.splice(0, u.history.length - 1_000);
    }
    if (u.dayStart?.day !== today(now)) u.dayStart = { day: today(now), pnl };
    const limit = u.rules ? u.rules.dailyLossPct * u.rules.budgetUsd : Infinity;
    if (u.haltedDay !== today(now) && u.dayStart.pnl - pnl > limit) {
      u.haltedDay = today(now);
      logUser(u, now, `Daily loss limit hit (−$${(u.dayStart.pnl - pnl).toFixed(2)}): stopping every copy until tomorrow.`);
    } else if (u.haltedDay !== today(now) && u.rules?.dailyProfitUsd && pnl - u.dayStart.pnl >= u.rules.dailyProfitUsd) {
      u.haltedDay = today(now);
      logUser(u, now, `Daily profit target reached (+$${(pnl - u.dayStart.pnl).toFixed(2)} today, your target was +$${u.rules.dailyProfitUsd.toFixed(2)}): closing every copy to keep it; back tomorrow.`);
    }
    // The user's whole-bot targets: at either one, stop every copy and switch the bot off.
    const runPnl = (u.run?.closed ?? 0) + pnl;
    const goal = u.rules;
    if (u.mode !== "off" && goal?.stopAtProfitUsd && runPnl >= goal.stopAtProfitUsd) {
      u.mode = "off";
      logUser(u, now, `Profit target reached: +$${runPnl.toFixed(2)} since Start (your target was +$${goal.stopAtProfitUsd.toFixed(2)}). Stopping every copy; start again whenever you like.`);
    } else if (u.mode !== "off" && goal?.stopAtLossUsd && runPnl <= -goal.stopAtLossUsd) {
      u.mode = "off";
      logUser(u, now, `Loss limit reached: −$${(-runPnl).toFixed(2)} since Start (your limit was −$${goal.stopAtLossUsd.toFixed(2)}). Stopping every copy.`);
    }
    // The user's own schedule: a timed pause or the weekend closes the copies; the bot picks up again by itself.
    const pause = u.rules && u.mode !== "off" ? pausedNow(u.rules, now) : null;
    if (pause && Object.keys(u.managed).length) logUser(u, now, `${pause}: closing every copy.`);
    const target = u.haltedDay === today(now) || u.mode === "off" || pause ? [] : specs;

    u.pending ??= {};
    u.cooldown ??= {};
    // Money parked in copy sub-accounts whose copy ended (no copy running there now).
    const parked = parkedOf(u, subAccts, active)
      .filter((a) => a.available >= MIN_COPY_USD)
      .sort((x, y) => y.available - x.available);
    // Free balance on the main account, read once when a copy is about to start (null: Strike didn't say).
    let free: number | null | undefined;
    const freeNow = async () =>
      free !== undefined
        ? free
        : (free = await Promise.resolve()
            .then(() => client.account())
            .then((a) => (Number.isFinite(Number(a?.available_balance)) ? Number(a.available_balance) : null), () => null));
    for (const a of planUser(u.managed, target, active)) {
      if (a.type === "stop") {
        const sub = active.find((x) => x.subscription_id === a.id)?.account_id;
        await client.stop(a.id, sub && sub !== u.accountId ? sub : undefined);
        if (u.run) u.run.closed += lastPnl(a.lead);
        delete u.managed[a.lead];
        logUser(u, now, `Stopped copying ${short(a.lead)}: ${a.reason}.`);
        continue;
      }
      let s = a.spec;
      try {
        const spot = !u.pending[lc(s.lead)] ? parked.shift() : undefined;
        if (spot) {
          // Reuse money an earlier copy left in its sub-account (sized to what's there, limits scaled).
          const amount = Math.min(s.amount, spot.available);
          const k = amount / s.amount;
          const r = await client.subscribeInto(spot.id, { ...s, amount, stopLossUsd: Math.max(1, Math.round(s.stopLossUsd * k * 100) / 100), maxMarginPerSymbol: Math.floor(s.maxMarginPerSymbol * k * 100) / 100 });
          if (r.status !== "active" || !r.subscription_id) throw new Error(r.error ?? r.status);
          u.managed[s.lead] = r.subscription_id;
          logUser(u, now, `Copying ${short(s.lead)} with $${amount.toFixed(2)}, reusing money from an earlier copy (leverage ≤ ${s.maxLeverage}x).`);
          continue;
        }
        // Less free money on Strike than the copy asks for (a deposit still on its way, a budget above the balance): use
        // what's there, a dollar kept for fees, with the limits scaled to match. Under a useful copy size, wait and say
        // so once (the trader isn't at fault, so no cooldown).
        const f = await freeNow();
        const usable = f === null ? Infinity : Math.floor((f - 1) * 100) / 100;
        if (usable < s.amount) {
          if (usable < MIN_COPY_USD) {
            const told = `${Math.floor(f!)}:${s.amount}`;
            if (u.fundsTold !== told) {
              u.fundsTold = told;
              logUser(u, now, `Not enough free balance on Strike for another copy: $${f!.toFixed(2)} free, a copy needs at least $${MIN_COPY_USD}. It starts by itself once more money arrives.`);
            }
            continue;
          }
          const k = usable / s.amount;
          s = { ...s, amount: usable, stopLossUsd: Math.max(1, Math.round(s.stopLossUsd * k * 100) / 100), maxMarginPerSymbol: Math.floor(s.maxMarginPerSymbol * k * 100) / 100 };
        }
        // From the main account: the money returns to the main balance when the copy stops.
        delete u.pending[lc(s.lead)];
        let r = await client.subscribeShared(s).catch((e: unknown) => e);
        let note = `leverage ${s.maxLeverage}x`;
        if (r instanceof Error && /\b400\b/.test(r.message)) {
          // Strike may not take a leverage setting on this kind of copy: try once without it.
          r = await client.subscribeShared(s, false);
          note = "Strike's default leverage";
        }
        if (r instanceof Error) throw r;
        const sub = r as CopySub;
        if (!sub.subscription_id) throw new Error("Strike didn't return a copy id");
        u.managed[s.lead] = sub.subscription_id;
        if (typeof free === "number") free -= s.amount;
        u.fundsTold = undefined;
        const smaller = s.amount < a.spec.amount ? `, all that's free on Strike right now (your rules ask for $${a.spec.amount.toFixed(2)})` : "";
        logUser(u, now, `Copying ${short(s.lead)} with $${s.amount.toFixed(2)}${smaller} (${note}, stop at −$${s.stopLossUsd.toFixed(2)}).`);
      } catch (e) {
        // Strike refused this copy: say so once, and don't retry this trader for a while.
        delete u.pending[lc(s.lead)];
        u.cooldown[lc(s.lead)] = now + COOLDOWN_MS;
        logUser(u, now, `Couldn't start a copy of ${short(s.lead)}: ${e instanceof Error ? e.message.replace(/^Strike \S+ \S+ → /, "") : String(e)}. Trying other traders.`);
      }
    }
    if (u.mode === "off" && !Object.keys(u.managed).length) delete u.run; // the run is over once nothing is copied
    u.lastSyncAt = now;
    u.lastError = undefined;
  } catch (e) {
    u.lastError = e instanceof Error ? e.message : String(e);
    logUser(u, now, `Error: ${u.lastError}`);
  }
}
