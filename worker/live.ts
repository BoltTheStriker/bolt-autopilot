// Live copy-trading controller. The paper engine (bot/strategy.ts) decides WHO to copy;
// this mirrors those decisions as real Strike copy subscriptions.
//
// Modes (switched at runtime from the admin page, persisted in state):
//   paper : simulation only, Strike is never called            (default)
//   dry   : reads the real Strike account and logs the actions it WOULD take
//   live  : places and stops real copy subscriptions
//
// Safety: only touches subscriptions it created (tracked in `managed`); every copy gets a
// Strike-side stop-loss and margin cap; a daily loss limit trips the kill switch.
import type { CopyPosition, CopySub, StrikeClient } from "./strike-live.ts";

export type LiveMode = "paper" | "dry" | "live";

export type LiveCtl = {
  mode: LiveMode;
  budgetUsd: number; // total allocated across all copies
  managed: Record<string, string>; // lead address → subscription id the bot created
  dayStart?: { day: string; pnl: number }; // for the daily loss limit
  killedAt?: number;
  lastSyncAt?: number;
  lastError?: string;
  log: { at: number; text: string }[];
  /** netIn: money moved into the bot's account minus money moved out (deposits, withdrawals and
   *  sub-account transfers), so profit = equity − netIn whatever else happens on the wallet. */
  account?: { subs: number; allocated: number; pnl: number; at: number; equity?: number; netIn?: number; flowsAt?: number };
  /** The bot's real copies on Strike at the last sync, for the public page. */
  copies?: { lead: string; amount: number; pnl: number; since?: number; positions?: { market: string; long: boolean; entry: number; mark: number; pnl: number }[] }[];
  /** When live trading was first switched on. */
  liveSince?: number;
  /** Profit on the bot's copies over time: a point every 5 minutes, the last one kept live. */
  history?: { at: number; pnl: number; equity?: number; netIn?: number }[];
  /** Profit lock on one copy (the bold slot): at +pct of the copy, stop it (banking the profit) and re-copy. */
  lock?: { enabled: boolean; pct: number; banked: number; events: { at: number; lead: string; amount: number; copy: number }[] };
};

const HISTORY_STEP_MS = 5 * 60_000;
const HISTORY_KEPT = 3_000; // ~10 days at 5-minute steps

/** Add the latest profit reading to the chart history. */
export function recordHistory(ctl: LiveCtl, at: number) {
  if (ctl.mode !== "live" || !ctl.account) return;
  const h = (ctl.history ??= []);
  if (!h.length) h.push({ at: ctl.liveSince ?? at, pnl: 0 }); // the chart starts from break-even
  const point = { at, pnl: ctl.account.pnl, equity: ctl.account.equity, netIn: ctl.account.netIn };
  const last = h.at(-1)!;
  if (h.length > 1 && at - h.at(-2)!.at < HISTORY_STEP_MS) h[h.length - 1] = point;
  else if (at > last.at) h.push(point);
  if (h.length > HISTORY_KEPT) h.splice(0, h.length - HISTORY_KEPT);
}

export const defaultCtl = (budget: number): LiveCtl => ({ mode: "paper", budgetUsd: budget, managed: {}, log: [] });

export type Action = { type: "subscribe"; lead: string; amount: number; stopLoss: number } | { type: "stop"; lead: string; id: string; reason: string };

const MIN_COPY = 20; // Strike's minimum fixed-ratio copy amount

/**
 * What must change so Strike matches the bot's picks. Pure: no I/O.
 * - stop managed subscriptions whose lead the bot no longer holds
 * - subscribe to held leads with no active subscription
 * Leads are funded in score order; if the budget can't give each at least `minCopyUsd`, fewer are copied.
 * Small copies miss most trades (orders below Hyperliquid's minimum size are skipped), so the floor is
 * well above Strike's $20 minimum: ~$100 is where most good leads become 60%+ copyable.
 */
export function plan(opts: {
  desired: { lead: string; score: number; stopLossPct?: number }[];
  managed: Record<string, string>;
  active: CopySub[];
  budgetUsd: number;
  stopLossPct: number;
  minCopyUsd?: number;
  /** At most this many copies (used while the bold slot is on, so it replaces a copy instead of adding one). */
  maxCopies?: number;
}): Action[] {
  const { desired, managed, active, budgetUsd, stopLossPct } = opts;
  const minCopy = Math.max(MIN_COPY, opts.minCopyUsd ?? MIN_COPY);
  const activeIds = new Set(active.map((s) => s.subscription_id));
  const activeLeads = new Set(active.map((s) => s.lead_account_id.toLowerCase()));
  const slots = Math.max(0, Math.min(desired.length, Math.floor(budgetUsd / minCopy), opts.maxCopies ?? Infinity));
  const funded = [...desired].sort((a, b) => b.score - a.score).slice(0, slots);
  const fundedSet = new Set(funded.map((d) => d.lead.toLowerCase()));
  const amount = slots ? Math.floor((budgetUsd / slots) * 100) / 100 : 0;

  const actions: Action[] = [];
  for (const [lead, id] of Object.entries(managed)) {
    if (!activeIds.has(id)) continue; // already gone (e.g. Strike's stop-loss fired)
    if (!fundedSet.has(lead.toLowerCase())) actions.push({ type: "stop", lead, id, reason: "bot no longer copies this trader" });
  }
  // Copies we keep stay at their own size, so new ones share what's left of the budget
  // (e.g. 4 copies at $175 of $700 leave nothing for a 5th at $140).
  const ourIds = new Set(Object.values(managed));
  const kept = active.filter((s) => ourIds.has(s.subscription_id) && fundedSet.has(s.lead_account_id.toLowerCase()));
  const left = budgetUsd - kept.reduce((t, s) => t + n(s.copy_amount), 0);
  const fresh = funded.filter((d) => !activeLeads.has(d.lead.toLowerCase())); // not already copied (ours or manual)
  let each = fresh.length ? Math.min(amount, Math.floor((left / fresh.length) * 100) / 100) : 0;
  let picks = fresh;
  if (each < minCopy) {
    // Not enough left for every new pick: fund as many as fit at the floor, best score first,
    // and let them use all of what's left (e.g. $175 left for two picks → one $175 copy).
    const fit = Math.min(fresh.length, Math.floor(left / minCopy));
    if (!fit) return actions;
    picks = fresh.slice(0, fit);
    each = Math.floor((left / fit) * 100) / 100;
  }
  for (const d of picks) {
    actions.push({ type: "subscribe", lead: d.lead, amount: each, stopLoss: Math.max(1, Math.round(each * (d.stopLossPct ?? stopLossPct) * 100) / 100) });
  }
  return actions;
}

const log = (ctl: LiveCtl, text: string) => {
  ctl.log.unshift({ at: Date.now(), text });
  ctl.log = ctl.log.slice(0, 80);
};
const n = (v: unknown) => (v === undefined || v === null || v === "" ? 0 : Number(v));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Read the account (copies, profit, balance) and enforce the daily loss limit. No orders,
 * except the kill switch when the limit is hit. Returns Strike's active subscriptions, or
 * null if the kill switch fired.
 */
async function readAccount(ctl: LiveCtl, client: StrikeClient, cfg: { dailyLossPct: number }): Promise<CopySub[] | null> {
  const active = await client.subscriptions("active");
  // Forget managed subs that Strike already stopped (stop-loss, manual stop in the app).
  for (const [lead, id] of Object.entries(ctl.managed)) {
    if (!active.some((s) => s.subscription_id === id)) {
      delete ctl.managed[lead];
      log(ctl, `${short(lead)} copy is no longer active on Strike (stopped there)`);
    }
  }
  const ours = active.filter((s) => Object.values(ctl.managed).includes(s.subscription_id));
  // Profit the way Strike's own screen shows it: realized (after fees) plus the live unrealized
  // profit of each copy's open positions. The subscription's summary `pnl` lags behind.
  const rows: CopyPosition[] | null = await Promise.resolve().then(() => client.copyPositions()).catch(() => null);
  const slices = (id: string) => (rows ?? []).filter((r) => !r.own && r.subscription_id === id);
  const subPnl = (s: CopySub) => (rows ? n(s.realized_pnl) + slices(s.subscription_id).reduce((t, r) => t + n(r.pnl), 0) : n(s.pnl));
  const pnl = ours.reduce((t, s) => t + subPnl(s), 0);
  const allocated = ours.reduce((t, s) => t + n(s.copy_amount), 0);
  // Balance is display-only: a failed read must never block syncing or the loss limit.
  const acct = await Promise.resolve().then(() => client.account()).catch(() => null);
  const equity = acct ? n(acct.margin_balance ?? acct.wallet_balance) : ctl.account?.equity;
  // Net money in (every 5 minutes is plenty: transfers are rare). Display-only, like the balance.
  let { netIn, flowsAt } = ctl.account ?? {};
  if (!flowsAt || Date.now() - flowsAt > 5 * 60_000) {
    const p = await Promise.resolve()
      .then(() => client.request<{ capital_flows?: Record<string, string> }>("GET", "/v2/portfolio"))
      .catch(() => null);
    const f = p?.data.capital_flows;
    if (f) {
      netIn = n(f.all_time_deposits) - n(f.all_time_withdrawals) + n(f.all_time_transfer_in) - n(f.all_time_transfer_out);
      flowsAt = Date.now();
    }
  }
  ctl.account = { subs: ours.length, allocated, pnl, at: Date.now(), equity, netIn, flowsAt };
  ctl.copies = ours.map((s) => ({
    lead: s.lead_account_id,
    amount: n(s.copy_amount),
    pnl: subPnl(s),
    since: s.created_at_ms,
    positions: slices(s.subscription_id).map((r) => ({ market: r.market, long: r.side === "long", entry: n(r.entry_price), mark: n(r.mark_price), pnl: n(r.pnl) })),
  }));
  recordHistory(ctl, ctl.account.at);

  // Daily loss limit on the bot's own copies.
  const day = new Date().toISOString().slice(0, 10);
  if (!ctl.dayStart || ctl.dayStart.day !== day) ctl.dayStart = { day, pnl };
  const lossToday = ctl.dayStart.pnl - pnl;
  if (ctl.mode === "live" && ctl.budgetUsd > 0 && lossToday > ctl.budgetUsd * cfg.dailyLossPct) {
    log(ctl, `Daily loss limit hit (−$${lossToday.toFixed(2)}). Killing all bot copies.`);
    await kill(ctl, client);
    return null;
  }
  return active;
}

/** Quick read-only refresh for the public page (and a faster loss-limit check). Never throws. */
export async function refresh(ctl: LiveCtl, client: StrikeClient | null, cfg: { dailyLossPct: number }): Promise<void> {
  if (ctl.mode === "paper" || !client) return;
  try {
    await readAccount(ctl, client, cfg);
  } catch {
    // A missed read is fine: the next refresh or sync tries again, and sync reports errors.
  }
}

/**
 * Profit lock: when `lead`'s copy is up at least `ctl.lock.pct` of its size, stop it so the profit
 * is banked (stopping a copy closes its positions). The next sync copies the trader again at full
 * size. Returns the amount banked, or null. Never throws.
 */
export async function lockProfit(ctl: LiveCtl, client: StrikeClient | null, lead: string | undefined): Promise<number | null> {
  const lk = ctl.lock;
  if (!lk?.enabled || ctl.mode === "paper" || !client || !lead) return null;
  const l = lead.toLowerCase();
  const c = (ctl.copies ?? []).find((x) => x.lead.toLowerCase() === l);
  const mine = Object.entries(ctl.managed).find(([k]) => k.toLowerCase() === l);
  if (!c || !mine || !(c.amount > 0) || c.pnl < c.amount * lk.pct) return null;
  const what = `profit lock: bank +$${c.pnl.toFixed(2)} from ${short(lead)} (+${((c.pnl / c.amount) * 100).toFixed(1)}%), then copy it again`;
  if (ctl.mode === "dry") {
    log(ctl, `[dry run] would ${what}`);
    return null;
  }
  try {
    await client.stop(mine[1]);
    delete ctl.managed[mine[0]];
    ctl.copies = (ctl.copies ?? []).filter((x) => x !== c);
    lk.banked += c.pnl;
    lk.events = [{ at: Date.now(), lead, amount: c.pnl, copy: c.amount }, ...lk.events].slice(0, 50);
    log(ctl, `[live] ${what}`);
    return c.pnl;
  } catch (e) {
    ctl.lastError = e instanceof Error ? e.message : String(e);
    log(ctl, `Error: ${ctl.lastError}`);
    return null;
  }
}

/** One sync with Strike. Mutates ctl. Never throws: errors are logged on ctl. */
export async function sync(
  ctl: LiveCtl,
  client: StrikeClient | null,
  desired: { lead: string; score: number; stopLossPct?: number }[],
  cfg: { stopLossPct: number; dailyLossPct: number; minCopyUsd?: number; maxCopies?: number },
): Promise<void> {
  if (ctl.mode === "paper") return;
  if (!client) {
    ctl.lastError = "Strike API keys are not set on the worker";
    return;
  }
  try {
    const active = await readAccount(ctl, client, cfg);
    if (!active) return; // kill switch fired

    const actions = plan({ desired, managed: ctl.managed, active, budgetUsd: ctl.budgetUsd, stopLossPct: cfg.stopLossPct, minCopyUsd: cfg.minCopyUsd, maxCopies: cfg.maxCopies });
    for (const a of actions) {
      const what = a.type === "subscribe" ? `copy ${short(a.lead)} with $${a.amount} (Strike stop-loss $${a.stopLoss})` : `stop ${short(a.lead)} (${a.reason})`;
      if (ctl.mode === "dry") {
        log(ctl, `[dry run] would ${what}`);
        continue;
      }
      if (a.type === "subscribe") {
        const sub = await client.subscribe(a.lead, a.amount, a.stopLoss);
        if (sub?.subscription_id) ctl.managed[a.lead] = sub.subscription_id;
      } else {
        await client.stop(a.id);
        delete ctl.managed[a.lead];
      }
      log(ctl, `[live] ${what}`);
    }
    ctl.lastSyncAt = Date.now();
    ctl.lastError = undefined;
  } catch (e) {
    ctl.lastError = e instanceof Error ? e.message : String(e);
    log(ctl, `Error: ${ctl.lastError}`);
  }
}

/** Kill switch: stop every copy the bot created, then fall back to paper mode. */
export async function kill(ctl: LiveCtl, client: StrikeClient | null): Promise<void> {
  const failures: string[] = [];
  if (client) {
    for (const [lead, id] of Object.entries(ctl.managed)) {
      try {
        await client.stop(id);
        delete ctl.managed[lead];
      } catch (e) {
        failures.push(`${short(lead)}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  ctl.mode = "paper";
  ctl.killedAt = Date.now();
  log(ctl, failures.length ? `KILL: stopped copies, ${failures.length} failed (stop them in the Strike app): ${failures.join("; ")}` : "KILL: all bot copies stopped. Back to paper.");
}
