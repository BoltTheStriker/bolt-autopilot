// Always-on copy-trade bot worker (Railway). Still SIMULATION ONLY: no keys, no money.
//
//  every TICK_MS  → read each copied lead's new fills + open positions from Hyperliquid,
//                   move our paper copies by our share, append to the live feed, fire
//                   stop-losses straight away
//  every CYCLE_MS → re-rank traders from Strike's public data (same rules as before)
//  GET /state     → the whole state as JSON for the website (CORS open, read-only)
//
//   node --experimental-strip-types worker/index.ts
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { bot } from "../bot/config.ts";
import { defaultCtl, kill, lockProfit, refresh, sync, type LiveCtl, type LiveMode } from "./live.ts";
import { bech32Decode, boltHeld, resetDemo, stakeAddressOf, cardId, DEMO, demoCard, demoView, indexMap, loadDemo, migrateAccounts, saveDemo, startDemo } from "./demo.ts";
import { applySettings, DEFAULT_SETTINGS, describeSettings, indexStep, sanitizeSettings, stepPortfolio, type PoolLead, type Style } from "./demoEngine.ts";
import { StrikeClient } from "./strike-live.ts";
import { CUP_MIN_HOLDING, cupStandings, cupToCheck, freshJoinTime, joinCup, joinMessage, oldJoinMessage, resetBlocked, resetMessage, snapshotCup } from "./cup.ts";
import { verifySignData } from "./cose.ts";
import { advanceMark, BETA_MAX_BUDGET_USD, copySpecs, describeRules, MIN_COPY_USD, pickTraders, RISK_LEVELS, realWorldShareOf, sanitizeRules, weekCurve, type Candidate, type LiveMark, type PreviewTrader } from "./autopilot.ts";
import { checkSession, decrypt, encrypt, loadAutoStore, logUser, newApiKeyPair, newSession, publicUser, saveAutoStore, type AutoUser, type Mode } from "./autopilotStore.ts";
import { parkedOf, syncUser } from "./autopilotEngine.ts";
import Anthropic from "@anthropic-ai/sdk";
import { copilotReply, type ChatTurn } from "./copilot.ts";
import { aiDecision, applyDecision, autopilotSignals, droppedLeads, effectiveRules, rulesDecision, type TraderStats } from "./autotune.ts";
import { addTrades, DEFAULT_CONTEST, loadContest, parseTrade, saveContest, shown, standings, toCheck, type Trade } from "./contest.ts";
import { onStrike, strikeBase, strikeShare } from "../bot/markets.ts";
import { coverageAt, drawdown30d, entryRejection, equityOf, hardStopReason, initialState, returnCurve, scoreLead, short, step, type BotState, type FeedEvent, type Lead } from "../bot/strategy.ts";

const DATA = process.env.DATA_DIR ?? new URL("../data", import.meta.url).pathname;
const STATE = `${DATA}/bot-state.json`;
const SEED = new URL("../data/bot-state.json", import.meta.url).pathname; // repo copy, used on first boot
const TICK_MS = Number(process.env.TICK_MS ?? 15_000);
const CYCLE_MS = Number(process.env.CYCLE_MS ?? 60 * 60_000);
const EQUITY_EVERY_MS = 15 * 60_000; // chart point spacing
const FEED_KEPT = 120;
const STRIKE = "https://api.strikefinance.org";
const HL = "https://api.hyperliquid.xyz/info";

if (bot.mode !== "simulate") throw new Error('Live mode is not implemented. Keep bot.mode = "simulate".');

const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

// ---------- state ----------

function load(): BotState {
  for (const f of [STATE, SEED]) {
    if (existsSync(f)) {
      const raw = readFileSync(f, "utf8").trim();
      if (raw && raw !== "null") return JSON.parse(raw);
    }
  }
  return initialState(bot, Date.now());
}

// ---------- live trading controls (separate file; only a safe summary is public) ----------

const CTL = `${DATA}/live-ctl.json`;
const LIVE = {
  maxBudgetUsd: Number(process.env.LIVE_MAX_BUDGET_USD ?? 500), // hard ceiling on the admin budget
  dailyLossPct: Number(process.env.LIVE_DAILY_LOSS_PCT ?? 0.1), // of budget, then kill
  minCopyUsd: Number(process.env.LIVE_MIN_COPY_USD ?? 100), // smaller copies skip most of a lead's trades
  maxCopies: Number(process.env.LIVE_MAX_COPIES ?? 4), // with the bold slot on: it replaces a copy, never adds one
  syncMs: 5 * 60_000,
  refreshMs: 30_000, // read-only account refresh for the public page
};
const strike =
  process.env.STRIKE_API_PUBLIC_KEY && process.env.STRIKE_API_PRIVATE_KEY
    ? new StrikeClient(process.env.STRIKE_API_PUBLIC_KEY, process.env.STRIKE_API_PRIVATE_KEY, process.env.STRIKE_API_BASE || undefined)
    : null;
const ctl: LiveCtl = existsSync(CTL) ? JSON.parse(readFileSync(CTL, "utf8")) : defaultCtl(Number(process.env.LIVE_BUDGET_USD ?? 100));
const saveCtl = () => {
  writeFileSync(`${CTL}.tmp`, JSON.stringify(ctl));
  renameSync(`${CTL}.tmp`, CTL);
};
const liveSummary = () => ({
  mode: ctl.mode,
  budgetUsd: ctl.budgetUsd,
  keysConfigured: !!strike,
  account: ctl.account,
  copies: Object.keys(ctl.managed).length,
  lastSyncAt: ctl.lastSyncAt,
  lastError: ctl.lastError,
  killedAt: ctl.killedAt,
  log: ctl.log.slice(0, 30),
});
// What the public site may see: mode and totals only. The log, budget and errors stay behind /admin.
const publicLiveStatus = () => ({
  mode: ctl.mode,
  copies: Object.keys(ctl.managed).length,
  account: ctl.account && { allocated: ctl.account.allocated, pnl: ctl.account.pnl, equity: ctl.account.equity, netIn: ctl.account.netIn, at: ctl.account.at },
  budgetUsd: ctl.mode === "live" ? ctl.budgetUsd : undefined,
  liveSince: ctl.liveSince,
  positions: ctl.mode === "live" ? ctl.copies ?? [] : [],
  history: ctl.history ?? [],
  lock: ctl.lock && { enabled: ctl.lock.enabled, pct: ctl.lock.pct, banked: ctl.lock.banked, events: ctl.lock.events.slice(0, 10) },
});
async function liveSync() {
  if (ctl.mode === "paper") return;
  // Bold slot on: it's funded first and replaces a copy (at most LIVE.maxCopies), and copies that
  // are holding trades keep their place, so a flat copy is the one that makes room.
  const boldOn = Boolean(state.bold?.enabled);
  const ours = new Set(Object.keys(ctl.managed).map((k) => k.toLowerCase()));
  const busy = new Set((ctl.copies ?? []).filter((c) => c.positions?.length).map((c) => c.lead.toLowerCase()));
  const desired = state.positions.map((p) => {
    const score = p.scoreNow ?? p.score;
    const l = p.lead.toLowerCase();
    const rank = !boldOn ? score : p.bold ? 1_000 + score : ours.has(l) && busy.has(l) ? 100 + score : score;
    return { lead: p.lead, score: rank, stopLossPct: p.bold ? bot.bold.stopLoss : undefined };
  });
  await sync(ctl, strike, desired, { stopLossPct: bot.exit.stopLoss, dailyLossPct: LIVE.dailyLossPct, minCopyUsd: LIVE.minCopyUsd, maxCopies: boldOn ? LIVE.maxCopies : undefined });
  saveCtl();
}

let state = load();
state.feed ??= [];
state.live ??= {};

function save() {
  // write-then-rename so a crash mid-write never leaves a half file
  writeFileSync(`${STATE}.tmp`, JSON.stringify(state));
  renameSync(`${STATE}.tmp`, STATE);
}

// ---------- data sources ----------

async function json<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

type Fill = { coin: string; px: string; sz: string; dir: string; time: number; closedPnl: string; fee: string; oid: number };
type Clearing = { assetPositions?: { position: { coin: string; szi: string; entryPx: string; positionValue: string; unrealizedPnl: string } }[] };
/** A trader's open positions in the demo's terms (Strike market names). */
const demoOpen = (ps: NonNullable<Clearing["assetPositions"]>) =>
  ps.map(({ position: x }) => ({ coin: strikeBase(x.coin) ?? x.coin, long: n(x.szi) > 0, upnl: n(x.unrealizedPnl) }));

// ---------- markets Strike can copy ----------

// Base assets Strike lists, refreshed every cycle. Null until first read: nothing is filtered then.
let strikeMarkets: Set<string> | null = null;
let strikeSymbols: string[] = []; // e.g. "BTC-USD", for Autopilot's market filters
async function refreshStrikeMarkets() {
  const r = await json<{ markets?: Record<string, { symbol: string; base_asset: string; status: string }> }>(`${STRIKE}/v2/markets`).catch(() => null);
  const trading = Object.values(r?.markets ?? {}).filter((m) => m.status === "trading");
  if (trading.length) {
    strikeMarkets = new Set(trading.map((m) => m.base_asset));
    strikeSymbols = trading.map((m) => m.symbol);
  }
}
/** Paper copies only count what a real Strike copy could trade. */
const copyable = (coin: string) => !strikeMarkets || onStrike(coin, strikeMarkets);

// ---------- live tick ----------

async function tick() {
  const now = Date.now();
  let changed = false;

  for (const p of state.positions) {
    const cur = (state.live![p.lead] ??= { lastFillMs: Math.max(p.openedAt, now - TICK_MS), unrealized: NaN });
    const [allFills, ch] = await Promise.all([
      json<Fill[]>(HL, { type: "userFillsByTime", user: p.lead, startTime: cur.lastFillMs + 1, aggregateByTime: true }),
      json<Clearing>(HL, { type: "clearinghouseState", user: p.lead }),
    ]);
    for (const f of allFills) cur.lastFillMs = Math.max(cur.lastFillMs, f.time);
    // Trades and positions in coins Strike doesn't list are skipped by a real copy, so here too.
    const fills = allFills.filter((f) => copyable(f.coin));
    const positions = (ch.assetPositions ?? []).filter((a) => copyable(a.position.coin));

    // Our copy is sized as (our value ÷ lead account value) of every lead fill, on the
    // share of their trading Strike can mirror (coverage). Account value comes from
    // Strike's profile, refreshed every cycle.
    const ratio = p.mark.accountValue > 0 ? p.value / p.mark.accountValue : 0;
    let realized = 0;
    let volume = 0;
    // Group partial fills of the same order into one feed line.
    const byOrder = new Map<number, Fill[]>();
    for (const f of fills) {
      realized += n(f.closedPnl) - n(f.fee);
      volume += n(f.sz) * n(f.px);
      byOrder.set(f.oid, [...(byOrder.get(f.oid) ?? []), f]);
    }
    const unrealized = positions.reduce((s, a) => s + n(a.position.unrealizedPnl), 0);
    const unrealizedDelta = Number.isNaN(cur.unrealized) ? 0 : unrealized - cur.unrealized;
    cur.unrealized = unrealized;
    // What they're holding right now, for the public "Holding now" panel.
    cur.open = positions.map(({ position: x }) => ({
      coin: x.coin,
      long: n(x.szi) > 0,
      entryPx: n(x.entryPx),
      value: n(x.positionValue),
      leadUpnl: n(x.unrealizedPnl),
      ourUpnl: ratio * p.coverage * n(x.unrealizedPnl),
    }));

    const delta = ratio * p.coverage * (realized + unrealizedDelta) - ratio * p.coverage * volume * (bot.takerFee + bot.slippage);
    // Holder demo: the same marks advance this trader's return index.
    const tr = demo.track?.[p.lead];
    if (tr) {
      tr.idx = Math.max(0.01, tr.idx * (1 + indexStep(realized, unrealizedDelta, volume, tr.accountValue, tr.coverage, bot.takerFee + bot.slippage)));
      tr.lastFillMs = cur.lastFillMs;
      tr.unrealized = cur.unrealized;
      tr.open = demoOpen(positions);
    }
    if (delta !== 0 || fills.length) {
      p.value = Math.max(p.value + delta, 0);
      p.peak = Math.max(p.peak, p.value);
      p.fees += ratio * p.coverage * volume * (bot.takerFee + bot.slippage);
      changed = true;
    }

    for (const group of byOrder.values()) {
      const f0 = group[0];
      const notional = group.reduce((s, f) => s + n(f.sz) * n(f.px), 0);
      const leadPnl = group.reduce((s, f) => s + n(f.closedPnl), 0);
      const ev: FeedEvent = {
        at: Math.max(...group.map((f) => f.time)),
        lead: p.lead,
        coin: f0.coin,
        dir: f0.dir,
        notional,
        leadPnl,
        ourPnl: ratio * p.coverage * leadPnl,
      };
      state.feed!.unshift(ev);
    }
  }

  await tickDemo(now).catch((e) => log("demo tick failed:", e instanceof Error ? e.message : e));

  if (changed) {
    state.feed = state.feed!.sort((a, b) => b.at - a.at).slice(0, FEED_KEPT);
    const lastPoint = state.equity.at(-1);
    if (!lastPoint || now - lastPoint.at >= EQUITY_EVERY_MS) state.equity.push({ at: now, value: equityOf(state) });
    else lastPoint.value = equityOf(state); // keep the newest point live between chart steps
  }
  state.lastTickAt = now;

  // Stops act immediately instead of waiting for the hourly cycle.
  const stopped = state.positions.find((p) => hardStopReason(p, bot));
  if (stopped) {
    log(`stop hit on ${short(stopped.lead)}, running a cycle now`);
    await cycle();
    return;
  }
  save();
}

// ---------- holder demo: shortlist indexes and holders' rules ----------

/** Copy size the demo shortlist is judged at: demo copies are $1K–$10K, so far more traders are copyable than at the bot's paper size. */
const DEMO_SLOT = 1_000;
let demoTicks = 0;
let lastDemoSave = 0;
/** Advance the return index of shortlisted traders the bot doesn't copy (every minute, for
 *  Hyperliquid's rate limits), then run every holder's rules. */
async function tickDemo(now: number) {
  if (!demo.pool?.length) return;
  const botHeld = new Set(state.positions.map((p) => p.lead));
  if (demoTicks++ % 4 === 0) {
    for (const l of demo.pool) {
      const tr = demo.track?.[l.lead];
      if (!tr || botHeld.has(l.lead)) continue; // bot-held traders are marked in the tick itself
      const [allFills, ch] = await Promise.all([
        json<Fill[]>(HL, { type: "userFillsByTime", user: l.lead, startTime: tr.lastFillMs + 1, aggregateByTime: true }).catch(() => null),
        json<Clearing>(HL, { type: "clearinghouseState", user: l.lead }).catch(() => null),
      ]);
      if (!allFills || !ch) continue;
      for (const f of allFills) tr.lastFillMs = Math.max(tr.lastFillMs, f.time);
      const fills = allFills.filter((f) => copyable(f.coin));
      const realized = fills.filter((f) => copyable(f.coin)).reduce((t, f) => t + n(f.closedPnl) - n(f.fee), 0);
      const volume = fills.reduce((t, f) => t + n(f.sz) * n(f.px), 0);
      const open = (ch.assetPositions ?? []).filter((a) => copyable(a.position.coin));
      const unrealized = open.reduce((t, a) => t + n(a.position.unrealizedPnl), 0);
      const ud = Number.isNaN(tr.unrealized) ? 0 : unrealized - tr.unrealized;
      tr.unrealized = unrealized;
      tr.open = demoOpen(open);
      tr.idx = Math.max(0.01, tr.idx * (1 + indexStep(realized, ud, volume, tr.accountValue, tr.coverage, bot.takerFee + bot.slippage)));
    }
  }
  const idx = indexMap(demo);
  for (const a of Object.values(demo.accounts)) if (a.portfolio) stepPortfolio(a.portfolio, demo.pool, idx, now);
  const cup = contest.config?.kind === "pnl" ? contest.config : null;
  if (cup && snapshotCup(demo, cup.start, cup.end, now, idx)) saveDemo(DEMO_FILE, demo);
  if (now - lastDemoSave > 60_000) {
    saveDemo(DEMO_FILE, demo);
    lastDemoSave = now;
  }
}

/** The demo shortlist: the bot's own copies plus its best-ranked eligible traders (top 12). */
function updateDemoPool(cands: Lead[], s: BotState, slot: number, now: number) {
  const byAddr = new Map(cands.map((c) => [c.address, c]));
  const heldSet = new Set(s.positions.map((p) => p.lead));
  const pool: PoolLead[] = [...byAddr.values()]
    .filter((c) => heldSet.has(c.address) || (!(s.cooldowns[c.address] > now) && entryRejection(c, bot, slot, now) === null))
    .map((c) => ({ lead: c.address, score: scoreLead(c, slot), roi30d: n(c.roi?.["30d"]), roi7d: n(c.roi?.["7d"]), dd: drawdown30d(c) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  demo.pool = pool;
  demo.track ??= {};
  for (const l of pool) {
    const c = byAddr.get(l.lead)!;
    const av = n(c.account_value);
    const coverage = coverageAt(c, 1_000) || 0.8;
    const t = demo.track[l.lead];
    if (t) {
      if (av > 0) t.accountValue = av;
      t.coverage = coverage;
    } else demo.track[l.lead] = { idx: 1, lastFillMs: now, unrealized: NaN, accountValue: av, coverage };
  }
  // Forget traders that left the shortlist and that no holder still copies.
  const heldByUsers = new Set(Object.values(demo.accounts).flatMap((a) => a.portfolio?.positions.map((p) => p.lead) ?? []));
  for (const k of Object.keys(demo.track)) if (!pool.some((l) => l.lead === k) && !heldByUsers.has(k)) delete demo.track[k];
  saveDemo(DEMO_FILE, demo);
}

// ---------- ranking cycle ----------

/** Strike's ranked traders (three pages: the cost filters leave few of the top 100, so look deeper). */
async function discoverLeads(): Promise<Lead[]> {
  const q = new URLSearchParams({
    platform: bot.entry.platform,
    min_copy_score: String(bot.entry.minCopyScore),
    sort: "copy_score",
    order: "desc",
    enriched_only: "true",
    limit: "100",
  });
  const items: Lead[] = [];
  for (let page = 0; page < 3; page++) {
    const r = await json<{ items?: Lead[]; next_cursor?: string }>(`${STRIKE}/v2/copy/discover?${q}`).catch(() => null);
    items.push(...(r?.items ?? []));
    if (!r?.next_cursor) break;
    q.set("cursor", r.next_cursor);
  }
  return items;
}

async function cycle() {
  const now = Date.now();
  await refreshStrikeMarkets();
  const items = await discoverLeads();
  const held = new Map<string, Lead | undefined>();
  for (const p of state.positions) {
    const lead = items.find((c) => c.address === p.lead) ?? (await json<Lead>(`${STRIKE}/v2/copy/discover/${p.lead}`).catch(() => undefined));
    held.set(p.lead, lead);
    if (lead) p.mark.accountValue = n(lead.account_value); // keeps the copy ratio current
  }
  // Steadiness check on Hyperliquid for everyone who could be picked (or is held):
  // in how many of the last 24 hours did they trade?
  const slot = equityOf(state) / bot.maxLeads;
  // The demo judges traders at demo copy size (larger, so more are copyable); check activity for those too.
  const shortlist = [
    ...items.filter((c) => entryRejection(c, bot, Math.max(slot, DEMO_SLOT), now) === null),
    ...[...held.values()].filter((l): l is Lead => !!l),
  ];
  const seen = new Set<string>();
  for (const l of shortlist) {
    if (seen.has(l.address)) continue;
    seen.add(l.address);
    const [fills, ch] = await Promise.all([
      json<Fill[]>(HL, { type: "userFillsByTime", user: l.address, startTime: now - 24 * 3_600_000, aggregateByTime: true }).catch(() => null),
      json<Clearing>(HL, { type: "clearinghouseState", user: l.address }).catch(() => null),
    ]);
    // What they hold right now, so the bot can avoid stacking the same bet across copies.
    if (ch) l.openBets = (ch.assetPositions ?? []).map(({ position: x }) => ({ coin: x.coin, long: n(x.szi) > 0 }));
    // How much of what they trade a Strike copy could actually follow.
    l.strikeShare = strikeShare(fills ?? [], (ch?.assetPositions ?? []).map(({ position: x }) => ({ coin: x.coin, value: n(x.positionValue) })), strikeMarkets);
    if (!fills) continue; // unknown stays neutral
    l.activeHours24h = new Set(fills.map((f) => Math.floor(f.time / 3_600_000))).size;
  }

  const before = new Set(state.positions.map((p) => p.lead));
  const next = step(state, items, held, bot, now, { markFromStrike: false });
  if (next.lastScan) next.lastScan.strikeMarkets = strikeMarkets?.size ?? 0;
  updateDemoPool([...items, ...[...held.values()].filter((l): l is Lead => !!l)], next, Math.max(slot, DEMO_SLOT), now);
  updateAutoPool([...items, ...[...held.values()].filter((l): l is Lead => !!l)], next, now);
  // New copies start tracking from now; closed ones stop.
  for (const p of next.positions) if (!before.has(p.lead)) next.live![p.lead] = { lastFillMs: now, unrealized: NaN };
  for (const k of Object.keys(next.live ?? {})) if (!next.positions.some((p) => p.lead === k)) delete next.live![k];
  state = next;
  save();
  await liveSync(); // mirror the new picks on Strike (no-op in paper mode)
  log(`cycle: ${items.length} traders, holding ${state.positions.length}, equity $${equityOf(state).toFixed(2)}`);
}

// ---------- loop + http ----------

// Ticks and cycles both rewrite state, so they run one at a time. A cycle always waits
// its turn; frequent jobs (tick, live refresh) are dropped if one is already queued,
// since the next one is only seconds away.
let queue = Promise.resolve();
const DROPPABLE = new Set(["tick", "live-refresh"]);
const queued = new Set<string>();
function guarded(fn: () => Promise<void>, name: string) {
  if (DROPPABLE.has(name)) {
    if (queued.has(name)) return;
    queued.add(name);
  }
  queue = queue.then(async () => {
    queued.delete(name);
    try {
      await fn();
    } catch (e) {
      log(`${name} failed:`, e instanceof Error ? e.message : e);
    }
  });
}

// ---------- $BOLT trading contest (off until set up from the admin page) ----------

const CONTEST_FILE = `${DATA}/contest.json`;
const contest = loadContest(CONTEST_FILE);
const SOLADA_ID = process.env.SOLADA_ID ?? "draft-bolt";
/** The project's own wallet can't win; nor can Solada's bonding-curve script (it shows up as a "trader" on curve-era trades). */
const PROJECT_WALLETS = [
  "addr1q9uwmv5vuc36nppyzflhhprlg7tg9dcl22ge2eppcdc0fqhs6a964q4c8uxnuf8hkdthn7yzma2lzm58l9xjnndy2xysxa4jek",
  "addr1vx9qelnrd87h6u54u6z2kttw3a3rnz3mk5lll0nc3mr8qvc6dqa4y",
];
/** A wallet's default ADA Handle (by its stake address), or null if it has none. */
async function handleOf(address: string): Promise<string | null> {
  const stake = stakeAddressOf(address);
  if (!stake) return null;
  const res = await fetch(`https://api.handle.me/holders/${stake}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`handle lookup → ${res.status}`);
  const h = String(((await res.json()) as { default_handle?: string }).default_handle ?? "");
  return /^[a-z0-9_.-]{1,15}$/i.test(h) ? h : null;
}
let contestBusy = false;
let contestChecksAt = 0;

/** Read new trades from Solada's feed (newest first, paged back with `before`), then every
 *  10 minutes the ADA price and the top buyers' balances. Stops once the results are final. */
async function syncContest(now: number) {
  const c = contest.config;
  if (!c || contestBusy) return;
  const s = standings(contest, now);
  const pnl = c.kind === "pnl";
  if (s.phase === "final" || (s.phase === "upcoming" && !pnl)) return;
  contestBusy = true;
  try {
    if (s.phase !== "upcoming" && contest.syncedTo < c.end + 10 * 60_000) {
      const from = Math.max(contest.syncedTo, c.start);
      let before: number | null = null;
      for (let page = 0; page < 60; page++) {
        const url: string = `https://www.solada.fun/api/trades?id=${encodeURIComponent(SOLADA_ID)}${before ? `&before=${before}` : ""}`;
        const r: { trades?: Record<string, unknown>[]; more?: boolean } = await json(url);
        const trades: Trade[] = (r.trades ?? []).map(parseTrade).filter((t): t is Trade => t !== null);
        addTrades(contest, trades);
        const oldest: number | undefined = trades.at(-1)?.atMs;
        if (!r.more || oldest === undefined || oldest <= from) break;
        before = oldest;
      }
    }
    if (now - contestChecksAt > 10 * 60_000) {
      contestChecksAt = now;
      const price = await json<{ cardano?: { usd?: number } }>("https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd").catch(() => null);
      if (price?.cardano?.usd) contest.adaUsd = price.cardano.usd;
      // Who can win: the biggest buyers (buy contest) or the top cup players. Keyed like the board.
      const idx = indexMap(demo);
      const check = pnl ? cupToCheck(demo, contest, now, idx).map((r) => ({ key: r.key, trader: r.address })) : toCheck(contest, now);
      const show = pnl ? cupToCheck(demo, contest, now, idx, 50).map((r) => ({ key: r.key, trader: r.address })) : shown(contest, now);
      for (const e of check) {
        const h = await boltHeld(e.trader).catch(() => null); // a failed read keeps the last result
        if (h) contest.holdings[e.key] = { held: h.held, at: now };
      }
      contest.handles ??= {};
      for (const e of show) {
        const known = contest.handles[e.key];
        if (known && now - known.at < 24 * 3_600_000) continue;
        const handle = await handleOf(e.trader).catch(() => undefined); // a failed lookup tries again next time
        if (handle !== undefined) contest.handles[e.key] = { handle, at: now };
      }
    }
    saveContest(CONTEST_FILE, contest);
  } catch (e) {
    log("contest sync failed:", e instanceof Error ? e.message : e);
  } finally {
    contestBusy = false;
  }
}

// ---------- Autopilot: users' own bots on their own Strike accounts (off until configured) ----------

const AUTO = {
  builderCode: process.env.STRIKE_BUILDER_CODE ?? "",
  base: process.env.STRIKE_BUILDER_BASE ?? "https://api-v2-testnet.strikefinance.org",
  secret: process.env.AUTOPILOT_SECRET ?? "",
  referral: process.env.STRIKE_REFERRAL_CODE ?? "",
  feeBps: Number(process.env.STRIKE_BUILDER_FEE_BPS ?? 0),
  maxBudgetUsd: Math.min(Number(process.env.AUTOPILOT_MAX_BUDGET_USD ?? BETA_MAX_BUDGET_USD), 5_000),
  public: process.env.AUTOPILOT_PUBLIC === "1", // off: private beta, only an admin can connect new accounts
  syncMs: 5 * 60_000,
  slot: 500, // largest copy size the trader list is judged at; each user's picks are checked at their own size
};
const autoOn = () => Boolean(AUTO.builderCode && AUTO.secret.length >= 32);
const autoNetwork = () => (AUTO.base.includes("testnet") ? "testnet" : "mainnet");
const AUTO_FILE = `${DATA}/autopilot.json`;
const autoStore = loadAutoStore(AUTO_FILE);
/** The bot's ranked traders for users' bots (best first), refreshed every cycle. */
let autoPool: Candidate[] = [];
// Autopilot holds copies, so a calm swing trader is fine: one active hour in the last 24 is enough
// (the live bot keeps 2). Being idle for days is still ruled out by maxIdleHours.
const AUTO_RULES = { ...bot, entry: { ...bot.entry, minActiveHours24h: 1 } } as unknown as typeof bot; // bot's config is `as const`
/** The same list for the public demo: short addresses, plus each trader's last week. */
let autoPreview: PreviewTrader[] = [];
function updateAutoPool(cands: Lead[], s: BotState, now: number) {
  const seen = new Set<string>();
  const ranked = cands
    .filter((c) => !seen.has(c.address) && seen.add(c.address) && !(s.cooldowns[c.address] > now) && entryRejection(c, AUTO_RULES, AUTO.slot, now) === null)
    .map((c) => ({
      c,
      cand: {
        lead: c.address,
        score: scoreLead(c, AUTO.slot),
        dd: drawdown30d(c),
        roi30d: n(c.roi?.["30d"]),
        realWorldShare: realWorldShareOf(c.top_assets),
        coverage: (c.copy_amount_coverage ?? []).map((t) => ({ amount: n(t.copy_amount), share: n(t.coverage) })),
      },
    }))
    .sort((a, b) => b.cand.score - a.cand.score)
    .slice(0, 30);
  autoPool = ranked.map((r) => r.cand);
  for (const { c } of ranked) autoAcct.set(short(c.address), n(c.account_value));
  autoPreview = ranked.map(({ c, cand }) => ({ ...cand, lead: short(c.address), roi7d: n(c.roi?.["7d"]), week: weekCurve(returnCurve(c), n(c.roi?.["7d"]), now), open: (c.openBets ?? []).slice(0, 4) }));
}

/** Live marks for the ranked traders (the forward-running demo), from Hyperliquid every minute:
 *  main perps plus the xyz real-world markets. Keyed by the short address the demo knows. */
const autoMarks = new Map<string, LiveMark>();
const autoFull = new Map<string, string>(); // short → full address
const autoAcct = new Map<string, number>(); // short → account value per Strike (the copy-sizing base)
let marksBusy = false;
async function refreshAutoMarks() {
  if (marksBusy) return;
  marksBusy = true;
  try {
    for (const c of autoPool) autoFull.set(short(c.lead), c.lead);
    const want = new Set(autoPool.map((c) => short(c.lead)));
    for (const k of autoMarks.keys()) if (!want.has(k) && Date.now() - autoMarks.get(k)!.at > 6 * 3_600_000) autoMarks.delete(k);
    for (const k of want) {
      const user = autoFull.get(k)!;
      const prev = autoMarks.get(k);
      const at = Date.now();
      const [main, xyz, fills] = await Promise.all([
        json<Clearing>(HL, { type: "clearinghouseState", user }).catch(() => null),
        json<Clearing>(HL, { type: "clearinghouseState", user, dex: "xyz" }).catch(() => null),
        prev ? json<Fill[]>(HL, { type: "userFillsByTime", user, startTime: prev.at + 1, endTime: at, aggregateByTime: true }).catch(() => null) : Promise.resolve([] as Fill[]),
      ]);
      if (!main || !fills) continue; // try again next minute rather than miss a closed trade
      // Only markets Strike lists: a Strike copy skips the rest, so the demo does too.
      const all = [...(main.assetPositions ?? []), ...(xyz?.assetPositions ?? [])].filter(({ position: x }) => copyable(x.coin));
      const positions = all.map(({ position: x }) => ({ coin: x.coin, long: n(x.szi) > 0, pnl: n(x.unrealizedPnl) }));
      const unrealized = all.reduce((t, { position: x }) => t + n(x.unrealizedPnl), 0);
      const realized = fills.reduce((t, f) => t + n(f.closedPnl) - n(f.fee), 0);
      autoMarks.set(k, advanceMark(prev, { unrealized, realized, acct: autoAcct.get(k) ?? 0, at, positions }));
    }
  } finally {
    marksBusy = false;
  }
}

/** Strike's SLP vault (where Borrow & Earn credit goes, incl. RealFi sUSDrf-backed lines): mainnet data, cached. */
const SLP_ID = "3fd3ab0b-318b-4f99-9ad6-66e9e917bea8";
let slpCache: { at: number; data: unknown } | null = null;
async function slpInfo(now: number) {
  if (slpCache && now - slpCache.at < 10 * 60_000) return slpCache.data;
  const r = await fetch("https://api.strikefinance.org/v2/vaults");
  const j = (await r.json()) as { vaults?: Record<string, string | number>[] };
  const v = j.vaults?.find((x) => x.vault_id === SLP_ID) ?? j.vaults?.find((x) => x.type === "protocol");
  if (!v) throw new Error("SLP not found");
  // RealFi's sUSDrf as Borrow & Earn collateral: its own yield (Strike measures RealFi's exchange-rate
  // growth over 28 days) and how much is pledged.
  const ca = (await fetch(`${STRIKE}/v2/credit/collateral-assets`).then((r) => r.json()).catch(() => null)) as { assets?: Record<string, Record<string, unknown>> } | null;
  const s = ca?.assets?.sUSDrf;
  const susdrf = s
    ? { yieldApr: n(s.yield_apr), price: n(s.price), openLines: n(s.open_lines), collateral: n(s.total_collateral_units), debt: n(s.total_debt_usd), referenceLoss: n(s.credit_collateral_reference_loss) }
    : null;
  const data = { name: String(v.name), apr: n(v.apr) / 100, equity: n(v.equity), sharePrice: n(v.share_price), lockupDays: n(v.lockup_days), minDeposit: n(v.min_deposit), depositors: n(v.depositors), feeBps: n(v.leader_commission_bps), susdrf };
  slpCache = { at: now, data };
  return data;
}
const autoClients = new Map<string, StrikeClient>();
function autoClient(u: AutoUser): StrikeClient {
  let c = autoClients.get(u.stake);
  if (!c) autoClients.set(u.stake, (c = new StrikeClient(u.apiPublicKey, decrypt(u.apiPrivateKeyEnc, AUTO.secret), AUTO.base)));
  return c;
}
// Keep the traders already being copied while they're still ranked; skip ones Strike recently refused.
// The copies a user's bot should run: their rules (or Autopilot's, inside them), the ranked traders
// minus ones Strike refused lately and ones Autopilot set aside.
const autoSpecs = (u: AutoUser) => {
  const rules = effectiveRules(u);
  if (!rules || u.mode === "off") return [];
  const now = Date.now();
  const out = u.mode === "autopilot" ? droppedLeads(u, now) : new Set<string>();
  const pool = autoPool.filter((c) => !((u.cooldown?.[c.lead.toLowerCase()] ?? 0) > now) && !out.has(c.lead.toLowerCase()));
  return copySpecs(pickTraders(pool, rules, Object.keys(u.managed).filter((l) => !out.has(l.toLowerCase()))), rules, strikeSymbols);
};
/** A ranked trader's numbers for Autopilot's review (autoPool and autoPreview share their order). */
function traderStats(lead: string): TraderStats | undefined {
  const i = autoPool.findIndex((c) => c.lead.toLowerCase() === lead.toLowerCase());
  if (i < 0) return undefined;
  const c = autoPool[i];
  return { lead: c.lead, score: +c.score.toFixed(3), dd: +c.dd.toFixed(3), roi7d: +(autoPreview[i]?.roi7d ?? 0).toFixed(4), roi30d: +c.roi30d.toFixed(4), realWorldShare: +c.realWorldShare.toFixed(2) };
}
/** Autopilot mode: look at the user's bot when something calls for it, and adjust inside their limits.
 *  Claude decides when the copilot key is set; the plain-rules version otherwise (or if Claude fails).
 *  True when it changed what the bot copies. */
async function autopilotReview(u: AutoUser, now: number): Promise<boolean> {
  const copies = (u.copies ?? []).map((c) => ({ lead: c.lead, amount: c.amount, pnl: c.pnl }));
  const pnl = copies.reduce((t, c) => t + c.pnl, 0);
  const dayLossUsd = Math.max(0, (u.dayStart?.pnl ?? pnl) - pnl);
  const signals = autopilotSignals(u, { now, copies, ranked: new Set(autoPool.map((c) => c.lead.toLowerCase())), dayLossUsd });
  if (!signals.length) return false;
  const held = copies.map((c) => traderStats(c.lead)).filter((x): x is TraderStats => !!x);
  const heldIds = new Set(copies.map((c) => c.lead.toLowerCase()));
  const candidates = autoPool.filter((c) => !heldIds.has(c.lead.toLowerCase())).slice(0, 8).map((c) => traderStats(c.lead)!);
  let decision = rulesDecision(u, signals, traderStats);
  if (copilotOn()) {
    try {
      copilotClient ??= new Anthropic();
      decision = await aiDecision(copilotClient, u, { signals, copies, dayLossUsd, held, candidates });
    } catch (e) {
      log("autopilot review: Claude unavailable, rules version used:", e instanceof Error ? e.message : e);
    }
  }
  const before = JSON.stringify([effectiveRules(u), [...droppedLeads(u, now)]]);
  const line = applyDecision(u, decision, now, copies.map((c) => c.lead));
  if (line) logUser(u, now, line);
  return JSON.stringify([effectiveRules(u), [...droppedLeads(u, now)]]) !== before;
}
/** Why a switched-on bot has nothing to copy, in the user's words (null when copies can start). */
function idleReason(u: AutoUser): string | null {
  const rules = effectiveRules(u);
  if (!rules || u.mode === "off" || Object.keys(u.managed).length) return null;
  if (!autoPool.length) return "Loading Strike's trader rankings. Your copies start in a few minutes.";
  const deployed = rules.budgetUsd * RISK_LEVELS[rules.risk].deploy;
  if (deployed < MIN_COPY_USD)
    return `Your rules put $${deployed.toFixed(2)} to work, under the $${MIN_COPY_USD} a copy needs to follow a trader's orders. Raise the budget or the risk level to start.`;
  if (!autoSpecs(u).length)
    return `No ranked trader fits your rules right now (${autoPool.length} ranked). The bot checks again every few minutes; "Everything" for markets or fewer traders gives it more to pick from.`;
  // There were picks, but Strike took none of them (the reasons are on the activity log just before this).
  if (u.lastSyncAt) return "Strike didn't accept the copies yet (see the reasons below). The bot tries other traders every few minutes.";
  return null;
}

let autoBusy = false;
const autoQueued = new Set<AutoUser>(); // asked for while a sync was running: synced right after it
async function syncAutopilot(only?: AutoUser) {
  if (!autoOn()) return;
  if (autoBusy) {
    if (only) autoQueued.add(only);
    return;
  }
  autoBusy = true;
  try {
    for (const u of only ? [only] : Object.values(autoStore.users)) {
      // Users with the bot off still sync (cheap): that's when parked copy money moves back to their balance.
      if (autoPool.length) {
        await syncUser(u, autoClient(u), autoSpecs(u), Date.now());
        // Autopilot mode: review when something calls for it; a change takes effect right away.
        if (u.mode === "autopilot" && (await autopilotReview(u, Date.now()))) await syncUser(u, autoClient(u), autoSpecs(u), Date.now());
      }
      const idle = idleReason(u);
      if (idle && idle !== u.idle) logUser(u, Date.now(), idle);
      u.idle = idle ?? undefined;
    }
    saveAutoStore(AUTO_FILE, autoStore);
  } catch (e) {
    log("autopilot sync failed:", e instanceof Error ? e.message : e);
  } finally {
    autoBusy = false;
  }
  const next = [...autoQueued];
  autoQueued.clear();
  for (const u of next) await syncAutopilot(u);
}
// Copilot (Claude). Off until ANTHROPIC_API_KEY is set on Railway. Open to demo users too, so it's
// capped: per visitor per hour, and in total per day.
const COPILOT = { perHour: 20, perDay: 600 };
let copilotClient: Anthropic | null = null;
const copilotOn = () => Boolean(process.env.ANTHROPIC_API_KEY);
const copilotHits = new Map<string, number[]>();
let copilotDay = { day: 0, count: 0 };
function copilotAllowed(ip: string, now: number): string | null {
  const day = Math.floor(now / 86_400_000);
  if (copilotDay.day !== day) copilotDay = { day, count: 0 };
  if (copilotDay.count >= COPILOT.perDay) return "The copilot is resting for today. Quick tweaks still work.";
  const recent = (copilotHits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= COPILOT.perHour) return "That's a lot of questions! Give it a few minutes.";
  recent.push(now);
  copilotHits.set(ip, recent);
  if (copilotHits.size > 5_000) for (const [k, v] of copilotHits) if (now - v.at(-1)! > 3_600_000) copilotHits.delete(k);
  copilotDay.count++;
  return null;
}

/** Sign-ins waiting for the user's wallet signature (5 minutes, like Strike's challenge). */
const autoPending = new Map<string, { address: string; publicKey: string; privateKeyEnc: string; at: number }>();

async function autopilotRoute(req: IncomingMessage, url: URL): Promise<{ status: number; data: unknown }> {
  // ready: real accounts work (builder code set); open: also public. In private beta only an admin connects.
  if (url.pathname === "/autopilot/status")
    return { status: 200, data: { open: autoOn() && AUTO.public, ready: autoOn(), network: autoNetwork(), maxBudgetUsd: AUTO.maxBudgetUsd, traders: autoPool.length, copilot: copilotOn() } };
  // Public, also while closed: the demo runs the real picks; Earn shows SLP live.
  if (url.pathname === "/autopilot/preview") return { status: 200, data: { at: Date.now(), traders: autoPreview } };
  if (url.pathname === "/autopilot/earn") return { status: 200, data: { slp: await slpInfo(Date.now()) } };
  if (url.pathname === "/autopilot/impact") return { status: 200, data: impactSummary(Date.now()) };
  if (url.pathname === "/autopilot/marks") return { status: 200, data: { at: Date.now(), marks: Object.fromEntries(autoMarks) } };
  // A shared result card: return on running copies, rules and trader count only (no amounts, no address).
  const cardId = /^\/autopilot\/card\/([0-9a-f]{12})$/.exec(url.pathname)?.[1];
  if (cardId) {
    const u = Object.values(autoStore.users).find((x) => x.shareId === cardId);
    return u?.rules ? { status: 200, data: resultCard(u) } : { status: 404, data: { error: "not found" } };
  }
  if (url.pathname === "/autopilot/copilot" && req.method === "POST") {
    if (!copilotOn()) return { status: 503, data: { error: "The copilot chat isn't switched on yet. Quick tweaks work." } };
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    const block = copilotAllowed(ip, Date.now());
    if (block) return { status: 429, data: { error: block } };
    const body = await readBody(req);
    const history = (Array.isArray(body.messages) ? body.messages : []) as ChatTurn[];
    const c = (body.context ?? {}) as Record<string, unknown>;
    const demoMode = c.demo === true;
    const maxBudgetUsd = demoMode ? 1_000 : AUTO.maxBudgetUsd;
    copilotClient ??= new Anthropic();
    const out = await copilotReply(
      copilotClient,
      history,
      {
        demo: demoMode,
        rules: sanitizeRules(c.rules, maxBudgetUsd),
        maxBudgetUsd,
        balance: typeof c.balance === "number" ? c.balance : null,
        copies: (Array.isArray(c.copies) ? c.copies : []).slice(0, 6).map((x: { lead?: unknown; amount?: unknown; pnl?: unknown }) => ({ lead: String(x.lead ?? "").slice(0, 16), amount: n(x.amount), pnl: n(x.pnl) })),
      },
      {
        traders: () =>
          autoPreview.slice(0, 10).map((t) => ({
            lead: t.lead,
            score: +t.score.toFixed(2),
            drawdown30d: +t.dd.toFixed(3),
            return30d: +t.roi30d.toFixed(3),
            return7d: +t.roi7d.toFixed(3),
            realWorldShare: +t.realWorldShare.toFixed(2),
            open: autoMarks.get(t.lead)?.positions.map((p) => `${p.coin} ${p.long ? "long" : "short"}`) ?? [],
          })),
        earn: () => slpInfo(Date.now()),
      },
    ).catch((e: unknown) => {
      // Users get a friendly line; the details stay in the logs.
      log("copilot failed:", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e instanceof Error ? e.message : e);
      if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) return { error: "The copilot is busy right now. Try again in a minute." };
      if (e instanceof Error && e.message === "Send a message first.") return { error: e.message };
      return { error: "The copilot couldn't answer that. Try again." };
    });
    return "error" in out ? { status: 502, data: out } : { status: 200, data: out };
  }
  if (!autoOn()) return { status: 503, data: { error: "Autopilot isn't open yet." } };
  if (req.method !== "POST") return { status: 405, data: { error: "POST only" } };
  const body = await readBody(req);
  const now = Date.now();

  if (url.pathname === "/autopilot/connect/start") {
    if (!AUTO.public && !authorized(req)) return { status: 403, data: { error: "Autopilot is in private beta. Real accounts open soon; the demo works now." } };
    // Step 1: a fresh trading key (kept on our server, encrypted) and Strike's consent message.
    const address = String(body.address ?? "");
    if (!ADDR.test(address)) return { status: 400, data: { error: "Connect a Cardano wallet (addr1…)." } };
    const k = newApiKeyPair();
    const r = await fetch(`${AUTO.base}/auth/builder/request-signature`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, chain: "cardano", code: AUTO.builderCode, fee_share_bps: AUTO.feeBps, public_key: k.publicKey, ...(AUTO.referral ? { referral_code: AUTO.referral } : {}) }),
    });
    const j = (await r.json().catch(() => ({}))) as { nonce?: string; message_to_sign?: string; error?: string };
    if (!r.ok || !j.nonce || !j.message_to_sign) return { status: 502, data: { error: `Strike: ${j.error ?? r.status}` } };
    for (const [nonce, p] of autoPending) if (now - p.at > 5 * 60_000) autoPending.delete(nonce);
    autoPending.set(j.nonce, { address, publicKey: k.publicKey, privateKeyEnc: encrypt(k.privateKey, AUTO.secret), at: now });
    return { status: 200, data: { nonce: j.nonce, message: j.message_to_sign } };
  }

  if (url.pathname === "/autopilot/connect/finish") {
    // Step 2: the wallet signed Strike's message; Strike creates the account and the API wallet.
    const nonce = String(body.nonce ?? "");
    const p = autoPending.get(nonce);
    if (!p || now - p.at > 5 * 60_000) return { status: 400, data: { error: "That sign-in expired. Start again." } };
    const r = await fetch(`${AUTO.base}/auth/builder/verify-signature`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce, wallet_signature: `${String(body.signature ?? "")}:${String(body.key ?? "")}` }),
    });
    const j = (await r.json().catch(() => ({}))) as { account_id?: string; api_wallet_public_key?: string; error?: string };
    if (!r.ok || !j.account_id) return { status: 403, data: { error: `Strike: ${j.error ?? r.status}` } };
    if (j.api_wallet_public_key && j.api_wallet_public_key.toLowerCase() !== p.publicKey) return { status: 502, data: { error: "Strike returned a different key." } };
    autoPending.delete(nonce);
    const key = stakeAddressOf(p.address) ?? p.address;
    const prev = autoStore.users[key];
    const u: AutoUser = prev ?? { stake: key, address: p.address, accountId: j.account_id, apiPublicKey: "", apiPrivateKeyEnc: "", network: autoNetwork(), createdAt: now, rules: null, mode: "off", managed: {}, log: [], sessions: [] };
    // Strike revokes earlier API wallets for this account on every connect: use the new one.
    Object.assign(u, { address: p.address, accountId: j.account_id, apiPublicKey: p.publicKey, apiPrivateKeyEnc: p.privateKeyEnc });
    autoClients.delete(key);
    autoStore.users[key] = u;
    const token = newSession(u, now);
    logUser(u, now, prev ? "Reconnected your wallet." : "Connected: your Strike account is ready.");
    saveAutoStore(AUTO_FILE, autoStore);
    log(`autopilot: ${short(key)} connected`);
    return { status: 200, data: { token, user: publicUser(u) } };
  }

  // Everything below needs the user's session (from connecting with their wallet).
  const address = String(body.address ?? "");
  const u = autoStore.users[stakeAddressOf(address) ?? address];
  if (!checkSession(u, String(body.token ?? ""), now)) return { status: 401, data: { error: "Connect your wallet again." } };
  const client = autoClient(u!);

  if (url.pathname === "/autopilot/me") {
    const [acct, vaults, credit, transfers, parked] = await Promise.all([
      client.account().catch(() => null),
      client.request<{ positions?: { vault_id: string; current_value: string; total_pnl: string }[] }>("GET", "/v2/vault/positions").catch(() => null),
      client.request<CreditAccount>("GET", "/v2/credit/account").catch(() => null),
      recentTransfers(client),
      Promise.all([client.subscriptions("active", true), client.subAccounts()]).then(([a, s]) => parkedOf(u!, s, a)).catch(() => []),
    ]);
    const slp = vaults?.data.positions?.find((p) => p.vault_id === SLP_ID);
    return {
      status: 200,
      data: {
        user: publicUser(u!),
        // equity: main account incl. copies running from it and their open profit; available: free to withdraw or copy.
        balance: acct ? { wallet: n(acct.wallet_balance), available: n(acct.available_balance), equity: n(acct.margin_balance ?? acct.wallet_balance) } : null,
        earn: slp ? { value: n(slp.current_value), pnl: n(slp.total_pnl) } : null,
        realfi: credit ? realfiSummary(credit.data) : null,
        transfers,
        // Left in older copies' sub-accounts: reused by the next copy, or moved to the main balance on withdraw
        // (the app does that in the user's browser with their own Strike login; we only list where it is).
        parked: parked.reduce((t, p) => t + p.available, 0),
        parkedSubs: parked,
        maxBudgetUsd: AUTO.maxBudgetUsd,
        rulesText: u!.rules ? describeRules(u!.rules) : null,
      },
    };
  }
  if (url.pathname === "/autopilot/share") {
    if (!u!.shareId) {
      u!.shareId = randomBytes(6).toString("hex");
      saveAutoStore(AUTO_FILE, autoStore);
    }
    return { status: 200, data: { id: u!.shareId } };
  }
  if (url.pathname === "/autopilot/rules") {
    const rules = sanitizeRules(body.rules, AUTO.maxBudgetUsd);
    if (!rules) return { status: 400, data: { error: "Those rules don't look right." } };
    u!.rules = rules;
    delete u!.tuned; // new limits: Autopilot starts again from the user's own rules
    logUser(u!, now, `Rules set: ${describeRules(rules)}.`);
    saveAutoStore(AUTO_FILE, autoStore);
    if (u!.mode !== "off") void syncAutopilot(u);
    return { status: 200, data: { user: publicUser(u!), rulesText: describeRules(rules) } };
  }
  if (url.pathname === "/autopilot/mode") {
    const mode = String(body.mode) as Mode;
    if (!["off", "on", "autopilot"].includes(mode)) return { status: 400, data: { error: "mode must be off, on or autopilot" } };
    if (mode !== "off" && !u!.rules) return { status: 400, data: { error: "Set your rules first." } };
    if (mode === "autopilot" && u!.mode !== "autopilot") u!.reviewedAt = 0; // first review on the next sync
    if (mode !== "autopilot") delete u!.tuned; // following the user's own rules again
    u!.mode = mode;
    logUser(
      u!,
      now,
      mode === "off"
        ? "Bot switched off: stopping its copies."
        : mode === "autopilot"
          ? "Autopilot on: it watches your copies and adjusts them inside your limits (swaps weak traders, steps risk down after losses). It never goes beyond your settings."
          : "Bot switched on.",
    );
    saveAutoStore(AUTO_FILE, autoStore);
    void syncAutopilot(u);
    return { status: 200, data: { user: publicUser(u!) } };
  }
  if (url.pathname === "/autopilot/deposit") {
    // ADA (trading balance) or RealFi sUSDrf (Borrow & Earn collateral) from the user's wallet:
    // Strike quotes it and builds the transaction; the wallet signs it.
    const asset = body.asset === "sUSDrf" ? "sUSDrf" : "ADA";
    const amount = Number(body.amount ?? body.ada);
    const min = asset === "ADA" ? 5 : 1;
    if (!(amount >= min)) return { status: 400, data: { error: `Deposit at least ${min} ${asset}.` } };
    const utxos = Array.isArray(body.utxos) ? (body.utxos as unknown[]).map(String) : [];
    const q = await client.request<{ request_id: string; quote?: { usd_value?: string } }>("POST", "/v2/deposit/quote", { blockchain: "cardano", asset_symbol: asset, asset_amount: String(Math.round(amount * 1e6)) });
    const b = await client.request<{ unsigned_tx: string }>("POST", "/v2/deposit/build-tx", { request_id: q.data.request_id, user_address: u!.address, utxos });
    return { status: 200, data: { requestId: q.data.request_id, usd: n(q.data.quote?.usd_value), unsignedTx: b.data.unsigned_tx } };
  }
  if (url.pathname === "/autopilot/deposit/submit") {
    const r = await client.request<{ status: string }>("POST", "/v2/deposit", { request_id: String(body.requestId ?? ""), tx_hash: String(body.txHash ?? "") });
    logUser(u!, now, `Deposit sent (${String(body.txHash ?? "").slice(0, 10)}…): it shows up after Cardano confirms it.`);
    saveAutoStore(AUTO_FILE, autoStore);
    return { status: 200, data: { status: r.data.status } };
  }
  // Withdrawals: always to the user's own registered wallet, and only with their wallet's signature
  // (Strike locks the recipient into the quote; we can't change it or withdraw without them).
  if (url.pathname === "/autopilot/withdraw/limits") {
    const asset = WITHDRAW_ASSETS.has(String(body.asset)) ? String(body.asset) : "ADA";
    const r = await client.request<Record<string, unknown>>("GET", `/v2/withdraw/limits?chain=cardano&asset=${encodeURIComponent(asset)}`);
    return { status: 200, data: r.data };
  }
  if (url.pathname === "/autopilot/withdraw/quote") {
    const collateral = body.mode === "collateral";
    let req: Record<string, string>;
    if (collateral) {
      const amount = Number(body.amount);
      if (!(amount > 0)) return { status: 400, data: { error: "Enter an amount." } };
      req = { blockchain: "cardano", mode: "collateral", asset_symbol: "sUSDrf", asset_amount: String(Math.floor(amount * 1e6)) };
    } else {
      const usd = Number(body.usd);
      if (!(usd >= 1)) return { status: 400, data: { error: "Withdraw at least $1." } };
      const asset = WITHDRAW_ASSETS.has(String(body.asset)) ? String(body.asset) : "ADA";
      req = { blockchain: "cardano", mode: "balance", usd_value: usd.toFixed(2), asset };
    }
    const q = await client.request<{ withdraw_id: string; fee?: string; message_to_sign: string; tx_cbor?: string }>("POST", "/v2/withdraw/quote", req);
    return { status: 200, data: { withdrawId: q.data.withdraw_id, fee: n(q.data.fee), messageToSign: q.data.message_to_sign, txCbor: q.data.tx_cbor ?? null } };
  }
  if (url.pathname === "/autopilot/withdraw/confirm") {
    const r = await client.request<{ request_id?: string; status?: string }>("POST", "/v2/withdraw", {
      withdraw_id: String(body.withdrawId ?? ""),
      wallet_signature: String(body.walletSignature ?? ""),
      ...(body.signedTxCbor ? { signed_tx_cbor: String(body.signedTxCbor) } : {}),
    });
    logUser(u!, now, `Withdrawal sent to your wallet (${r.data.status ?? "pending"}). It arrives after Strike settles it on Cardano.`);
    saveAutoStore(AUTO_FILE, autoStore);
    return { status: 200, data: { id: r.data.request_id ?? String(body.withdrawId), status: r.data.status ?? "pending" } };
  }
  if (url.pathname === "/autopilot/withdraw/status") {
    const r = await client.request<Record<string, unknown>>("GET", `/v2/withdraw/queue-position?chain=cardano&withdrawal_id=${encodeURIComponent(String(body.id ?? ""))}`);
    return { status: 200, data: r.data };
  }
  return { status: 404, data: { error: "Not found" } };
}

const WITHDRAW_ASSETS = new Set(["ADA", "USDM"]);

/** Public numbers for the Bolt × Strike impact page: what Bolt brings to Strike. No personal data. */
/** What a user's public result card shows. */
function resultCard(u: AutoUser) {
  const copies = u.copies ?? [];
  const working = copies.reduce((t, c) => t + c.amount, 0);
  const pnl = copies.reduce((t, c) => t + c.pnl, 0);
  const started = u.log.find((l) => /^(Bot switched on|Autopilot on)/.test(l.text))?.at; // newest first: this run's start
  return {
    ret: working > 0 ? Math.round((pnl / working) * 1e5) / 1e5 : 0,
    traders: copies.length,
    since: started ?? u.createdAt,
    risk: u.rules!.risk,
    goal: u.rules!.goal,
    markets: u.rules!.markets,
    mode: u.mode,
    at: u.lastSyncAt ?? null,
  };
}

function impactSummary(now: number) {
  const users = Object.values(autoStore.users);
  const vol = users.flatMap((u) => Object.values(u.volume ?? {}));
  const acct = ctl.account;
  return {
    at: now,
    autopilot: {
      accounts: users.length, // Strike accounts connected through Bolt's builder code
      botsOn: users.filter((u) => u.mode !== "off").length,
      copiesRunning: users.reduce((t, u) => t + Object.keys(u.managed).length, 0),
      volumeUsd: Math.round(vol.reduce((t, v) => t + v.usd, 0) * 100) / 100,
      orders: vol.reduce((t, v) => t + v.orders, 0),
      tradersRanked: autoPool.length,
    },
    liveBot: {
      mode: ctl.mode,
      since: ctl.liveSince ?? null,
      copies: acct?.subs ?? 0,
      budgetUsd: ctl.budgetUsd,
      profitUsd: acct?.equity !== undefined && acct?.netIn ? Math.round((acct.equity - acct.netIn) * 100) / 100 : null,
    },
    holders: {
      demoBots: Object.keys(demo.accounts).length,
      cupPlayers: Object.values(demo.accounts).filter((a) => a.cup).length,
    },
  };
}
type StrikeTx = { type?: string; status?: string; amount?: string; asset?: string; asset_symbol?: string; asset_amount?: string; tx_hash?: string; timestamp?: number };
/** The account's latest deposits and withdrawals with Strike's status, for "on its way" screens. */
async function recentTransfers(client: StrikeClient) {
  const r = await client.request<{ transactions?: StrikeTx[] }>("GET", "/v2/history/transaction?type=deposit,withdraw&limit=8").catch(() => null);
  return (r?.data.transactions ?? []).map((t) => ({
    type: t.type === "withdraw" ? "withdraw" : "deposit",
    status: String(t.status ?? "pending"),
    usd: n(t.amount),
    asset: String(t.asset_symbol ?? t.asset ?? ""),
    assetAmount: n(t.asset_amount),
    txHash: t.tx_hash ?? null,
    at: t.timestamp ? (t.timestamp < 1e12 ? t.timestamp * 1000 : t.timestamp) : null,
  }));
}
type CreditAccount = {
  custody_balances?: Record<string, { available_units?: string; total_units?: string; units?: string } | string>;
  credit_lines?: Record<string, { collateral_asset?: string; collateral_units?: string; debt_usd?: string; health_score?: string; status?: string; vault_shares?: string }>;
  portfolio_summary?: { total_debt_usd?: string; total_draw_headroom_usd?: string };
};
/** The user's RealFi position on Strike: sUSDrf held in custody (not yet pledged) and pledged lines.
 *  The credit account isn't in Strike's public docs (its app uses it), so every field is optional here. */
function realfiSummary(c: CreditAccount) {
  const custody = c.custody_balances?.sUSDrf;
  const free = typeof custody === "string" ? n(custody) : n(custody?.available_units ?? custody?.units ?? custody?.total_units);
  const lines = Object.values(c.credit_lines ?? {}).filter((l) => l.collateral_asset === "sUSDrf");
  return {
    custody: free, // credit "units" are whole tokens (e.g. "248573.29"), unlike deposit/withdraw raw amounts
    pledged: lines.reduce((t, l) => t + n(l.collateral_units), 0),
    debtUsd: n(c.portfolio_summary?.total_debt_usd),
    headroomUsd: n(c.portfolio_summary?.total_draw_headroom_usd),
    health: lines.length ? Math.min(...lines.map((l) => n(l.health_score) || Infinity)) : null,
  };
}

// ---------- holder demo (off until switched on from the admin page) ----------

const DEMO_FILE = `${DATA}/demo.json`;
const demo = loadDemo(DEMO_FILE);
migrateAccounts(demo, equityOf(state), Date.now());
const demoPublic = () => ({ enabled: demo.enabled, accounts: Object.keys(demo.accounts).length });
const ADDR = /^addr1[0-9a-z]{50,120}$/;
// Wallet balances are cached briefly so repeat visits don't hammer Koios.
const heldCache = new Map<string, { at: number; stake: string | null; held: number }>();
async function holding(address: string) {
  const hit = heldCache.get(address);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  const fresh = { at: Date.now(), ...(await boltHeld(address)) };
  heldCache.set(address, fresh);
  if (heldCache.size > 5_000) heldCache.clear();
  return fresh;
}

/** GET /demo?address= (status) and POST /demo/start {address}. Admins can use it while it's off, to preview. */
async function demoRoute(req: IncomingMessage, url: URL): Promise<{ status: number; data: unknown }> {
  // Share cards are public: they only show a demo's numbers, never the wallet.
  const card = url.pathname.match(/^\/demo\/card\/([0-9a-f]{12})$/);
  if (card) {
    const c = demoCard(demo, card[1]);
    return c ? { status: 200, data: c } : { status: 404, data: { error: "No such demo" } };
  }
  const allowed = demo.enabled || authorized(req);
  if (!allowed) return { status: 200, data: { enabled: false } };
  const body = req.method === "POST" ? await readBody(req) : {};
  const address = req.method === "POST" ? String(body.address ?? "") : url.searchParams.get("address") ?? "";
  if (!ADDR.test(address)) return { status: 400, data: { error: "Connect a Cardano wallet (addr1…)." } };
  const h = await holding(address).catch(() => null);
  if (!h) return { status: 502, data: { error: "Couldn't read the wallet right now. Try again in a minute." } };
  const key = h.stake ?? address;
  if (req.method === "POST" && url.pathname === "/demo/start") {
    const view = demoView(demo, key, h.held);
    if (view.status === "locked") return { status: 403, data: view };
    const a = startDemo(demo, key, address, Date.now());
    stepPortfolio(a.portfolio!, demo.pool ?? [], indexMap(demo), Date.now());
    saveDemo(DEMO_FILE, demo);
  }
  if (req.method === "POST" && url.pathname === "/demo/reset") {
    // Start over: signed with the wallet, so nobody can wipe someone else's demo.
    const a = demo.accounts[key];
    if (!a?.portfolio) return { status: 404, data: { error: "No demo to start over." } };
    const c = contest.config?.kind === "pnl" ? contest.config : null;
    if (resetBlocked(a, c?.start ?? null, c?.end ?? null, Date.now())) return { status: 403, data: { error: "You're in the Bot Cup: starting over is off until it ends." } };
    const time = String(body.time ?? "");
    if (!freshJoinTime(time, Date.now())) return { status: 400, data: { error: "That signature is too old. Try again." } };
    const bytes = bech32Decode(address)?.bytes;
    try {
      if (!bytes) throw new Error("bad address");
      verifySignData(String(body.signature ?? ""), String(body.key ?? ""), bytes, resetMessage(address, time));
    } catch (e) {
      return { status: 403, data: { error: `Couldn't verify your wallet: ${e instanceof Error ? e.message : e}.` } };
    }
    resetDemo(a, Date.now());
    stepPortfolio(a.portfolio!, demo.pool ?? [], indexMap(demo), Date.now());
    saveDemo(DEMO_FILE, demo);
    log(`demo reset by ${short(key)}`);
  }
  if (req.method === "POST" && url.pathname === "/demo/cup/join") {
    // Join the PnL cup: the holder signs a message with their wallet (free, no transaction),
    // which proves they own the address. Only joined players appear on the public board.
    const c = contest.config;
    if (c?.kind !== "pnl" || Date.now() >= c.end) return { status: 400, data: { error: "There's no cup to join right now." } };
    if (h.held < (c.minHolding ?? CUP_MIN_HOLDING)) return { status: 403, data: { error: "You need 1M+ $BOLT to join the cup." } };
    const time = String(body.time ?? "");
    if (!freshJoinTime(time, Date.now())) return { status: 400, data: { error: "That signature is too old. Try again." } };
    const bytes = bech32Decode(address)?.bytes;
    if (!bytes) return { status: 400, data: { error: "That address doesn't look right." } };
    const signature = String(body.signature ?? ""), signer = String(body.key ?? "");
    try {
      try {
        verifySignData(signature, signer, bytes, joinMessage(address, time));
      } catch {
        verifySignData(signature, signer, bytes, oldJoinMessage(address, time)); // a page loaded before the rename
      }
    } catch (e) {
      return { status: 403, data: { error: `Couldn't verify your wallet: ${e instanceof Error ? e.message : e}.` } };
    }
    const a = startDemo(demo, key, address, Date.now());
    if (!a.portfolio?.positions.length) stepPortfolio(a.portfolio!, demo.pool ?? [], indexMap(demo), Date.now());
    joinCup(a, c.start, c.end, Date.now(), indexMap(demo));
    saveDemo(DEMO_FILE, demo);
    log(`cup: ${short(key)} joined`);
  }
  if (req.method === "POST" && url.pathname === "/demo/settings") {
    const a = demo.accounts[key];
    if (!a?.portfolio || h.held < DEMO.minHolding) return { status: 403, data: { error: "Start a demo first (1M+ $BOLT)." } };
    const settings = sanitizeSettings(body.settings);
    if (!settings) return { status: 400, data: { error: "Those settings don't look right." } };
    applySettings(a.portfolio, settings, Date.now());
    stepPortfolio(a.portfolio, demo.pool ?? [], indexMap(demo), Date.now());
    saveDemo(DEMO_FILE, demo);
    log(`demo settings for ${short(key)}: ${describeSettings(settings)}`);
  }
  // Cup players can't start over mid-cup (it would erase a losing run): the page hides the button.
  const cup = contest.config?.kind === "pnl" ? contest.config : null;
  const a = demo.accounts[key];
  const canReset = !a || !resetBlocked(a, cup?.start ?? null, cup?.end ?? null, Date.now());
  return { status: 200, data: { ...demoView(demo, key, h.held), preview: !demo.enabled, canReset } };
}

// ---------- admin API (needs ADMIN_KEY; disabled when it isn't set) ----------

function authorized(req: IncomingMessage) {
  const want = process.env.ADMIN_KEY ?? "";
  const got = String(req.headers["x-admin-key"] ?? "");
  if (want.length < 16 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
const readBody = (req: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let d = "";
    req.on("data", (c) => (d.length < 10_000 ? (d += c) : null));
    req.on("end", () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch {
        resolve({});
      }
    });
  });

async function admin(body: Record<string, unknown>): Promise<{ status: number; data: unknown }> {
  const action = body.action;
  if (action === "mode") {
    const mode = body.mode as LiveMode;
    if (!["paper", "dry", "live"].includes(mode)) return { status: 400, data: { error: "mode must be paper, dry or live" } };
    if (mode !== "paper" && !strike) return { status: 400, data: { error: "Add STRIKE_API_PUBLIC_KEY and STRIKE_API_PRIVATE_KEY on Railway first." } };
    if (mode === "live" && ctl.budgetUsd < LIVE.minCopyUsd) return { status: 400, data: { error: `Set a budget of at least $${LIVE.minCopyUsd} first.` } };
    ctl.mode = mode;
    if (mode === "live") ctl.liveSince ??= Date.now();
    ctl.log.unshift({ at: Date.now(), text: `Mode set to ${mode.toUpperCase()} from the admin page` });
    saveCtl();
    await liveSync();
  } else if (action === "budget") {
    const b = Number(body.budgetUsd);
    if (!(b >= 0) || b > LIVE.maxBudgetUsd) return { status: 400, data: { error: `Budget must be between $0 and $${LIVE.maxBudgetUsd}.` } };
    ctl.budgetUsd = Math.floor(b * 100) / 100;
    ctl.log.unshift({ at: Date.now(), text: `Budget set to $${ctl.budgetUsd}` });
    saveCtl();
    await liveSync();
  } else if (action === "kill") {
    await kill(ctl, strike);
    saveCtl();
  } else if (action === "sync") {
    await liveSync();
  } else if (action === "demo") {
    demo.enabled = Boolean(body.enabled);
    saveDemo(DEMO_FILE, demo);
    ctl.log.unshift({ at: Date.now(), text: `Holder demo turned ${demo.enabled ? "ON" : "OFF"} from the admin page` });
    saveCtl();
  } else if (action === "demo-style") {
    // Switch every holder's demo to one style (their other rules stay as they are).
    const style = String(body.style);
    let switched = 0;
    for (const a of Object.values(demo.accounts)) {
      const pf = a.portfolio;
      const next = pf && sanitizeSettings({ ...pf.settings, style });
      if (!pf || !next || pf.settings.style === style) continue;
      applySettings(pf, next, Date.now());
      pf.decisions[0].text = `Switched to ${style[0].toUpperCase() + style.slice(1)} by the Bolt team: ${describeSettings(next)}. Change it any time in your rules.`;
      switched++;
    }
    saveDemo(DEMO_FILE, demo);
    ctl.log.unshift({ at: Date.now(), text: `Holder demos switched to ${style} (${switched} accounts) from the admin page` });
    saveCtl();
  } else if (action === "demo-reset") {
    // Start one holder's demo over (by address or stake), at their request.
    const who = String(body.address ?? "");
    const key = who.startsWith("stake1") ? who : stakeAddressOf(who) ?? who;
    const a = demo.accounts[key];
    if (!a?.portfolio) return { status: 404, data: { error: "No demo for that wallet." } };
    const cup = contest.config?.kind === "pnl" ? contest.config : null;
    if (resetBlocked(a, cup?.start ?? null, cup?.end ?? null, Date.now()) && !body.force)
      return { status: 409, data: { error: "That wallet is in the running Bot Cup: a reset would wipe its cup run. Send force: true only if that's really intended." } };
    resetDemo(a, Date.now(), "Started fresh by the Bolt team");
    stepPortfolio(a.portfolio, demo.pool ?? [], indexMap(demo), Date.now());
    saveDemo(DEMO_FILE, demo);
    ctl.log.unshift({ at: Date.now(), text: `Demo reset for ${short(key)} from the admin page` });
    saveCtl();
  } else if (action === "demo-style-undo") {
    // Undo "demo-style": put each holder back on the style they had before the team switch,
    // read from their decision log. Holders who changed their rules since keep their own.
    const restored: Record<string, number> = {};
    for (const a of Object.values(demo.accounts)) {
      const pf = a.portfolio;
      const settingsLog = pf?.decisions.filter((d) => d.kind === "settings") ?? [];
      if (!pf || !settingsLog[0]?.text.includes("by the Bolt team")) continue;
      const before = settingsLog.slice(1).find((d) => !d.text.includes("by the Bolt team"));
      const found = before?.text.match(/traders?, (steady|balanced|bold|aggressive),/)?.[1] as Style | undefined;
      const style = found ?? DEFAULT_SETTINGS.style;
      const next = sanitizeSettings({ ...pf.settings, style });
      if (!next) continue;
      applySettings(pf, next, Date.now());
      pf.decisions[0].text = `Back to ${style[0].toUpperCase() + style.slice(1)}, your rules from before: ${describeSettings(next)}.`;
      const k = `${style}${found ? "" : " (default)"}`;
      restored[k] = (restored[k] ?? 0) + 1;
    }
    saveDemo(DEMO_FILE, demo);
    ctl.log.unshift({ at: Date.now(), text: `Holder demos put back on their previous style: ${Object.entries(restored).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}` });
    saveCtl();
  } else if (action === "contest") {
    // Set up (or clear) the contest. Times are ISO dates or ms. Changing it re-reads the trades.
    if (body.clear) contest.config = null;
    else {
      const start = new Date(body.start as string | number).getTime();
      const end = new Date(body.end as string | number).getTime();
      if (!(start > 0) || !(end > start)) return { status: 400, data: { error: "Give a start and an end (end after start)." } };
      const baseUsd = body.baseUsd === undefined ? DEFAULT_CONTEST.baseUsd : Number(body.baseUsd);
      const poolShare = body.poolShare === undefined ? DEFAULT_CONTEST.poolShare : Number(body.poolShare);
      if (!(baseUsd >= 0) || !(poolShare >= 0 && poolShare <= 1)) return { status: 400, data: { error: "baseUsd ≥ 0 and poolShare between 0 and 1." } };
      const kind = body.kind === "pnl" ? "pnl" : "buy";
      const payoutDelayDays = body.payoutDelayDays === undefined ? (kind === "pnl" ? 1 : DEFAULT_CONTEST.payoutDelayDays) : Number(body.payoutDelayDays);
      if (!(payoutDelayDays >= 0)) return { status: 400, data: { error: "payoutDelayDays ≥ 0." } };
      contest.config = { ...DEFAULT_CONTEST, kind, minHolding: CUP_MIN_HOLDING, start, end, baseUsd, poolShare, payoutDelayDays, exclude: PROJECT_WALLETS };
    }
    contest.trades = {};
    contest.syncedTo = 0;
    contest.holdings = {};
    contest.handles = {};
    contestChecksAt = 0;
    saveContest(CONTEST_FILE, contest);
    ctl.log.unshift({ at: Date.now(), text: contest.config ? `Contest (${contest.config.kind}) set: ${new Date(contest.config.start).toISOString()} → ${new Date(contest.config.end).toISOString()}, $${contest.config.baseUsd} + ${contest.config.poolShare * 100}% of the project's fees` : "Contest cleared" });
    saveCtl();
    void syncContest(Date.now());
  } else if (action === "lock") {
    // Profit lock on the bold slot's copy (see lockProfit).
    const pct = body.pct === undefined ? ctl.lock?.pct ?? 0.15 : Number(body.pct);
    if (!(pct >= 0.02 && pct <= 0.5)) return { status: 400, data: { error: "pct must be between 0.02 and 0.5." } };
    ctl.lock = { enabled: Boolean(body.enabled), pct, banked: ctl.lock?.banked ?? 0, events: ctl.lock?.events ?? [] };
    ctl.log.unshift({ at: Date.now(), text: `Profit lock ${ctl.lock.enabled ? `ON at +${(pct * 100).toFixed(0)}%` : "OFF"} (bold slot) from the admin page` });
    saveCtl();
  } else if (action === "bold") {
    // Experimental bold slot: one higher-return, higher-risk trader with a tighter stop-loss.
    state.bold = { enabled: Boolean(body.enabled) };
    ctl.log.unshift({ at: Date.now(), text: `Bold slot turned ${state.bold.enabled ? "ON" : "OFF"} from the admin page` });
    saveCtl();
    await cycle(); // pick (or drop) the bold trader now, and sync live copies
  } else if (action === "autopilot-users") {
    // Support view: each Autopilot account's balance, latest transfers and log (no keys).
    const users = await Promise.all(
      Object.values(autoStore.users).map(async (u) => {
        const c = autoClient(u);
        const acct = await c.account().catch(() => null);
        return {
          stake: short(u.stake),
          address: short(u.address),
          accountId: u.accountId,
          mode: u.mode,
          rules: u.rules ? describeRules(u.rules) : null,
          copies: u.copies?.length ?? 0,
          balance: acct ? { wallet: n(acct.wallet_balance), available: n(acct.available_balance) } : null,
          transfers: await recentTransfers(c),
          lastError: u.lastError ?? null,
          log: u.log.slice(0, 6),
        };
      }),
    );
    return { status: 200, data: { users } };
  } else if (action === "autopilot-debug") {
    // Read-only: what Strike shows for each Autopilot account (sub-accounts, active copies) and the bot's own bookkeeping.
    const out = await Promise.all(
      Object.values(autoStore.users).map(async (u) => {
        const c = autoClient(u);
        const [subs, subAccounts] = await Promise.all([
          c.subscriptions("active").catch((e: unknown) => String(e)),
          c.request<unknown>("GET", "/v2/sub-accounts").then((r) => r.data, (e: unknown) => String(e)),
        ]);
        return { stake: short(u.stake), mode: u.mode, pending: u.pending ?? {}, managed: u.managed, lastSyncAt: u.lastSyncAt ?? null, specs: autoSpecs(u), subs, subAccounts };
      }),
    );
    return { status: 200, data: { now: Date.now(), users: out } };
  } else if (action === "review") {
    ctl.log.unshift({ at: Date.now(), text: "Review run from the admin page" });
    await cycle(); // re-rank now (also syncs live copies)
  } else if (action !== "status") {
    return { status: 400, data: { error: "unknown action" } };
  }
  // Admins also see each demo's public card id (for checking share previews).
  const cards = Object.values(demo.accounts).map((a) => ({ cardId: cardId(a.stake), startedAt: a.startedAt }));
  return { status: 200, data: { ...liveSummary(), maxBudgetUsd: LIVE.maxBudgetUsd, lock: ctl.lock ?? null, bold: { enabled: Boolean(state.bold?.enabled), copy: state.positions.find((p) => p.bold)?.lead ?? null }, demo: { ...demoPublic(), cards, shortlist: (demo.pool ?? []).map((l) => ({ lead: short(l.lead), score: +l.score.toFixed(2), roi30d: +l.roi30d.toFixed(2), dd: +l.dd.toFixed(2) })) } } };
}

createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, x-admin-key");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("cache-control", "no-store");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
  } else if (req.url === "/admin" && req.method === "POST") {
    res.setHeader("content-type", "application/json");
    if (!authorized(req)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Wrong or missing admin key" }));
      return;
    }
    const body = await readBody(req);
    // Admin actions share the queue with ticks and cycles so they never interleave.
    let out: { status: number; data: unknown } = { status: 500, data: { error: "failed" } };
    await new Promise<void>((done) => guarded(async () => {
      try {
        out = await admin(body);
      } catch (e) {
        out = { status: 500, data: { error: e instanceof Error ? e.message : String(e) } };
      } finally {
        done();
      }
    }, "admin"));
    res.statusCode = out.status;
    res.end(JSON.stringify(out.data));
  } else if (req.url?.startsWith("/autopilot")) {
    res.setHeader("content-type", "application/json");
    const url = new URL(req.url, "http://worker");
    const out = await autopilotRoute(req, url).catch((e) => ({ status: 502, data: { error: e instanceof Error ? e.message : String(e) } }));
    res.statusCode = out.status;
    res.end(JSON.stringify(out.data));
  } else if (req.url?.startsWith("/demo")) {
    res.setHeader("content-type", "application/json");
    const url = new URL(req.url, "http://worker");
    const out = await demoRoute(req, url).catch((e) => ({ status: 500, data: { error: e instanceof Error ? e.message : String(e) } }));
    res.statusCode = out.status;
    res.end(JSON.stringify(out.data));
  } else if (req.url === "/contest") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(contest.config?.kind === "pnl" ? cupStandings(demo, contest, Date.now(), indexMap(demo)) : standings(contest, Date.now())));
  } else if (req.url?.startsWith("/state")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ...state, liveStatus: publicLiveStatus(), demo: demoPublic() }));
  } else if (req.url === "/health") {
    const stale = !state.lastTickAt || Date.now() - state.lastTickAt > TICK_MS * 8;
    res.statusCode = stale ? 503 : 200;
    res.end(stale ? "stale" : "ok");
  } else {
    res.statusCode = 404;
    res.end();
  }
}).listen(Number(process.env.PORT ?? 8080), () => log(`worker up, tick ${TICK_MS / 1000}s, cycle ${CYCLE_MS / 60_000}m`));

// Autopilot's trader list (and the public demo) shouldn't sit empty until the first cycle after a
// deploy: rank once now, without trading. The next cycle refines it with Hyperliquid activity.
void refreshStrikeMarkets()
  .then(() => discoverLeads())
  .then((items) => {
    if (!autoPool.length) updateAutoPool(items, state, Date.now());
    log(`autopilot: ${autoPool.length} traders ranked at start`);
    void refreshAutoMarks();
  })
  .catch(() => {});
setInterval(() => void refreshAutoMarks().catch(() => {}), 60_000); // the live demo's marks

// First boot: show each lead's recent trades in the feed. Display only, because their
// effect on our paper value was already counted by the earlier Strike-based marks.
async function backfillFeed() {
  if (state.feed!.length) return;
  for (const p of state.positions) {
    const fills = await json<Fill[]>(HL, { type: "userFillsByTime", user: p.lead, startTime: p.openedAt, aggregateByTime: true });
    const ratio = p.mark.accountValue > 0 ? p.value / p.mark.accountValue : 0;
    const byOrder = new Map<number, Fill[]>();
    for (const f of fills) byOrder.set(f.oid, [...(byOrder.get(f.oid) ?? []), f]);
    for (const g of byOrder.values()) {
      const leadPnl = g.reduce((s, f) => s + n(f.closedPnl), 0);
      state.feed!.push({
        at: Math.max(...g.map((f) => f.time)),
        lead: p.lead,
        coin: g[0].coin,
        dir: g[0].dir,
        notional: g.reduce((s, f) => s + n(f.sz) * n(f.px), 0),
        leadPnl,
        ourPnl: ratio * p.coverage * leadPnl,
      });
    }
    state.live![p.lead] = { lastFillMs: Math.max(Date.now() - TICK_MS, ...fills.map((f) => f.time)), unrealized: NaN };
  }
  state.feed = state.feed!.sort((a, b) => b.at - a.at).slice(0, FEED_KEPT);
  save();
  log(`backfilled ${state.feed.length} feed events`);
}
guarded(backfillFeed, "backfill");
await refreshStrikeMarkets();
for (const cur of Object.values(state.live ?? {})) cur.unrealized = NaN; // re-baseline open profit on boot

const sinceCycle = state.lastRunAt ? Date.now() - state.lastRunAt : Infinity;
// Run now if a cycle is due or there are empty slots (e.g. maxLeads was just raised).
const dueNow =
  sinceCycle >= CYCLE_MS ||
  state.positions.length < bot.maxLeads ||
  !state.lastScan?.trackRecord ||
  !state.shadow ||
  state.lastScan?.strikeMarkets === undefined ||
  !demo.pool?.length;
setTimeout(() => guarded(cycle, "cycle"), dueNow ? 0 : CYCLE_MS - sinceCycle);
setInterval(() => guarded(cycle, "cycle"), CYCLE_MS);
setInterval(() => guarded(liveSync, "live"), LIVE.syncMs); // place/stop copies to match the picks
setInterval(() => guarded(async () => {
  if (ctl.mode === "paper") return;
  await refresh(ctl, strike, { dailyLossPct: LIVE.dailyLossPct });
  // Profit lock on the bold slot's copy: bank it at +X%, then copy the trader again right away.
  if (await lockProfit(ctl, strike, state.positions.find((p) => p.bold)?.lead)) await liveSync();
  saveCtl();
}, "live-refresh"), LIVE.refreshMs); // account, profit and loss limit every 30s
setInterval(() => guarded(tick, "tick"), TICK_MS);
setInterval(() => void syncContest(Date.now()), 60_000); // contest trades, every minute
setInterval(() => void syncAutopilot(), AUTO.syncMs); // users' own bots
void syncContest(Date.now());
