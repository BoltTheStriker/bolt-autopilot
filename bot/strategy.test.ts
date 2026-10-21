// node --experimental-strip-types --test bot/strategy.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { bot, bot as base } from "./config.ts";
import { coverageAt, entryRejection, exitReason, initialState, markToMarket, riskAdjusted, scoreLead, smoothness, step, type Lead, type Position } from "./strategy.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 14);

const baseLead = (over: Partial<Lead> & { address: string }) => lead(over);
function lead(over: Partial<Lead> & { address: string }): Lead {
  return {
    platform: "hyperliquid",
    account_value: "100000",
    pnl: { "1d": "0", "7d": "0", "30d": "20000", all: "50000" },
    roi: { "1d": "0", "7d": "0.05", "30d": "0.3", all: "1" },
    volume: { "1d": "0", "7d": "0", "30d": "0", all: "1000000" },
    style: "day",
    copy_score: "70",
    copy_score_breakdown: { drawdown_30d: { raw: "0.1" } },
    copy_amount_coverage: [
      { copy_amount: "100", coverage: "0.5" },
      { copy_amount: "300", coverage: "0.8" },
      { copy_amount: "1000", coverage: "0.95" },
    ],
    recommended_direction: "copy",
    last_traded_at_ms: NOW - 2 * H,
    pnl_curve_30d: Array.from({ length: 30 }, (_, i) => [NOW - (30 - i) * 24 * H, String(i * 1000)] as [number, string]),
    ...over,
  };
}

test("coverage uses the largest tier at or below the amount", () => {
  const l = lead({ address: "0xa" });
  assert.equal(coverageAt(l, 50), 0);
  assert.equal(coverageAt(l, 333), 0.8);
  assert.equal(coverageAt(l, 5000), 0.95);
});

test("smoothness: steady climb ≈ 1, falling = 0", () => {
  assert.ok(smoothness(lead({ address: "0xa" }).pnl_curve_30d) > 0.99);
  assert.equal(smoothness([[1, "5"], [2, "4"], [3, "3"], [4, "2"], [5, "1"]]), 0);
});

test("entry rules reject the obvious cases", () => {
  assert.equal(entryRejection(lead({ address: "0xa" }), bot, 333, NOW), null);
  assert.match(entryRejection(lead({ address: "0xa", style: "market_maker" }), bot, 333, NOW)!, /style/);
  assert.match(entryRejection(lead({ address: "0xa", last_traded_at_ms: NOW - 100 * H }), bot, 333, NOW)!, /recently/);
  assert.match(entryRejection(lead({ address: "0xa", copy_score_breakdown: { drawdown_30d: { raw: "0.4" } } }), bot, 333, NOW)!, /drawdown/);
  assert.match(entryRejection(lead({ address: "0xa" }), bot, 50, NOW)!, /copyable/);
});

test("mark-to-market follows the lead's PnL at our ratio, minus fees", () => {
  const p: Position = {
    lead: "0xa", openedAt: NOW - 48 * H, cost: 1000, value: 1000, peak: 1000, fees: 0, score: 0.8, coverage: 1,
    mark: { pnlAll: 50000, volumeAll: 1_000_000, accountValue: 100000, at: NOW - H },
  };
  // Lead makes $10k on a $100k account (+10%) while trading $200k of volume.
  const m = markToMarket(p, lead({ address: "0xa", pnl: { "1d": "0", "7d": "0", "30d": "0", all: "60000" }, volume: { "1d": "0", "7d": "0", "30d": "0", all: "1200000" } }), bot, NOW);
  // +$100 gross; we mirror 1% of $200k = $2k volume → $1 fee + $1 slippage.
  assert.equal(Math.round(m.value * 100) / 100, 1098);
  assert.equal(m.peak, m.value);
});

test("a full cycle opens the best leads, then stop-loss closes a loser and refills", () => {
  const bot = { ...base, maxLeads: 3 } as unknown as typeof base;
  const good = [lead({ address: "0xa", copy_score: "80" }), lead({ address: "0xb", copy_score: "75" }), lead({ address: "0xc", copy_score: "70" }), lead({ address: "0xd", copy_score: "65" })];
  let s = step(initialState(bot, NOW), good, new Map(), bot, NOW);
  assert.deepEqual(s.positions.map((p) => p.lead), ["0xa", "0xb", "0xc"]);
  assert.ok(Math.abs(s.cash) < 1e-9);

  // 0xa's lead loses 30% of its account; our copy is down ~30% → stop-loss, 0xd takes the slot.
  const later = NOW + 6 * H;
  const crashed = lead({ address: "0xa", copy_score: "80", pnl: { "1d": "0", "7d": "0", "30d": "0", all: "20000" }, last_traded_at_ms: later });
  const held = new Map<string, Lead | undefined>([["0xa", crashed], ["0xb", good[1]], ["0xc", good[2]]]);
  s = step(s, good.slice(1), held, bot, later);
  assert.deepEqual(s.positions.map((p) => p.lead).sort(), ["0xb", "0xc", "0xd"]);
  assert.match(s.closed[0].reason, /stop-loss/);
  assert.ok(s.cooldowns["0xa"] > later, "dropped lead is on cooldown");
  assert.ok(s.equity.at(-1)!.value < bot.startingCapital);

  // The public "thinking" summary reflects this run.
  assert.equal(s.lastScan?.checked, 3);
  // Copies held through the run report a move; the one opened this run (0xd) has nothing to compare yet.
  assert.deepEqual(s.lastScan!.moves.map((m) => m.lead).sort(), ["0xb", "0xc"]);
});

test("raising maxLeads rebalances the copies and fills the new slots", () => {
  // Copyable enough at a $200 slot (the default fixture is only 50% copyable below $300).
  const coverage = [{ copy_amount: "150", coverage: "0.8" }, { copy_amount: "1000", coverage: "0.95" }];
  const leads = ["0xa", "0xb", "0xc", "0xd", "0xe"].map((a, i) => lead({ address: a, copy_score: String(80 - i), copy_amount_coverage: coverage }));
  const three = { ...bot, maxLeads: 3 } as unknown as typeof bot;
  const five = { ...bot, maxLeads: 5 } as unknown as typeof bot;
  let s = step(initialState(three, NOW), leads, new Map(), three, NOW);
  assert.equal(s.positions.length, 3);
  const later = NOW + H;
  const held = new Map<string, Lead | undefined>(s.positions.map((p) => [p.lead, leads.find((l) => l.address === p.lead)]));
  s = step(s, leads, held, five, later, { markFromStrike: false });
  assert.equal(s.positions.length, 5);
  for (const p of s.positions) assert.ok(Math.abs(p.value - bot.startingCapital / 5) < 1e-6);
  assert.ok(Math.abs(s.cash) < 1e-6);
});

test("outlier returns are rejected", () => {
  assert.match(entryRejection(lead({ address: "0xa", roi: { "1d": "0", "7d": "0", "30d": "42", all: "50" } }), bot, 333, NOW)!, /suspiciously/);
});

test("leads that trade too rarely are rejected", () => {
  assert.match(entryRejection(lead({ address: "0xa", activeHours24h: 1 }), bot, 333, NOW)!, /rarely/);
  assert.equal(entryRejection(lead({ address: "0xa", activeHours24h: 12 }), bot, 333, NOW), null);
});

test("very fast traders are rejected and score lower", () => {
  assert.match(entryRejection(lead({ address: "0xa", fills_window_days: "1.5" }), bot, 333, NOW)!, /too fast/); // ~1,333/day
  assert.equal(entryRejection(lead({ address: "0xa", fills_window_days: "20" }), bot, 333, NOW), null); // 100/day
  const slow = scoreLead(lead({ address: "0xa", fills_window_days: "20" }), 333);
  const fast = scoreLead(lead({ address: "0xa", fills_window_days: "2.5" }), 333); // 800/day
  assert.ok(fast < slow);
});

test("heavy churners are rejected: copy costs scale with their volume", () => {
  const vol = (v30: string) => ({ "1d": "0", "7d": "0", "30d": v30, all: "1000000" });
  // Account value in the fixture is $100k: 15M/30d = $500k a day = 5× the account.
  assert.match(entryRejection(lead({ address: "0xa", volume: vol("15000000") }), bot, 333, NOW)!, /churns/);
  assert.equal(entryRejection(lead({ address: "0xa", volume: vol("6000000") }), bot, 333, NOW), null); // 2×
});

test("traders mostly in coins Strike can't copy are skipped, and dropped if held", () => {
  assert.match(entryRejection(lead({ address: "0xa", strikeShare: 0.2 }), bot, 333, NOW)!, /Strike can't copy/);
  assert.equal(entryRejection(lead({ address: "0xa", strikeShare: 0.9 }), bot, 333, NOW), null);
  // Held copy that isn't making money: dropped right away (no minimum hold), since a real copy would never trade.
  const p: Position = { lead: "0xa", openedAt: NOW - H, cost: 100, value: 96, peak: 100, fees: 0, score: 0.7, coverage: 0.9, mark: { pnlAll: 0, volumeAll: 0, accountValue: 100000, at: NOW } };
  assert.match(exitReason(p, lead({ address: "0xa", strikeShare: 0 }), bot, NOW)!, /Strike can't copy/);
  assert.match(exitReason(p, lead({ address: "0xa", strikeShare: 0.38 }), bot, NOW)!, /Strike can't copy/);
  assert.equal(exitReason(p, lead({ address: "0xa", strikeShare: 0.6 }), bot, NOW), null); // between the bars: kept
  // A copy in profit isn't cut by quality rules (they mostly closed winners live); stops still apply.
  const winner = { ...p, value: 110, peak: 110, openedAt: NOW - 48 * H };
  assert.equal(exitReason(winner, lead({ address: "0xa", strikeShare: 0, fills_window_days: "1", copy_score: "10" }), bot, NOW), null);
  assert.match(exitReason({ ...winner, value: 80 }, lead({ address: "0xa" }), bot, NOW)!, /stop-loss/);
  assert.match(exitReason(winner, lead({ address: "0xa", last_traded_at_ms: NOW - 100 * H }), bot, NOW)!, /stopped trading/);
});

test("traders cooling off this week or losing all-time are rejected", () => {
  assert.match(entryRejection(lead({ address: "0xa", roi: { "1d": "0", "7d": "-0.12", "30d": "0.3", all: "1" } }), bot, 333, NOW)!, /cooling/);
  assert.match(entryRejection(lead({ address: "0xa", roi: { "1d": "0", "7d": "0.02", "30d": "0.3", all: "-0.4" } }), bot, 333, NOW)!, /all-time/);
});

test("at most two copies share the same main market", () => {
  const eth = [{ asset: "ETH" }];
  const leads = ["0xa", "0xb", "0xc", "0xd"].map((a, i) => lead({ address: a, copy_score: String(80 - i), top_assets: i < 3 ? eth : [{ asset: "BTC" }] }));
  const s = step(initialState({ ...bot, maxLeads: 3 } as unknown as typeof bot, NOW), leads, new Map(), { ...bot, maxLeads: 3 } as unknown as typeof bot, NOW);
  assert.deepEqual(s.positions.map((p) => p.lead), ["0xa", "0xb", "0xd"]); // 0xc skipped: third ETH trader
});

test("a new trader can't stack a third copy onto the same open bet", () => {
  const cfg = { ...bot, maxLeads: 4 } as unknown as typeof bot;
  const hypeShort = [{ coin: "HYPE", long: false }];
  const copyable = [{ copy_amount: "100", coverage: "0.9" }]; // copyable at a $250 slot
  const lead = (o: Partial<Lead> & { address: string }) => baseLead({ copy_amount_coverage: copyable, ...o });
  // Two copies held, both short HYPE right now (live positions from the worker).
  const held = [lead({ address: "0xa", copy_score: "90" }), lead({ address: "0xb", copy_score: "89" })];
  let s = step(initialState({ ...cfg, maxLeads: 2 } as unknown as typeof bot, NOW), held, new Map(), { ...cfg, maxLeads: 2 } as unknown as typeof bot, NOW);
  s.live = { "0xa": { lastFillMs: NOW, unrealized: 0, open: [{ ...hypeShort[0], entryPx: 1, value: 1, leadUpnl: 0, ourUpnl: 0 }] },
             "0xb": { lastFillMs: NOW, unrealized: 0, open: [{ ...hypeShort[0], entryPx: 1, value: 1, leadUpnl: 0, ourUpnl: 0 }] } };
  const cands = [
    lead({ address: "0xc", copy_score: "88", openBets: hypeShort }), // third HYPE short → skipped
    lead({ address: "0xd", copy_score: "87", openBets: [{ coin: "HYPE", long: true }] }), // opposite side is fine
    lead({ address: "0xe", copy_score: "86", openBets: [{ coin: "BTC", long: false }] }),
  ];
  const heldMap = new Map<string, Lead | undefined>(held.map((l) => [l.address, l]));
  s = step(s, [...held, ...cands], heldMap, cfg, NOW + H, { markFromStrike: false });
  assert.deepEqual(s.positions.map((p) => p.lead).sort(), ["0xa", "0xb", "0xd", "0xe"]);
  assert.equal(s.lastScan!.rejections["would stack a bet we already hold"], 1);
});

test("copies that drift into the same bet: the weakest is stopped, small positions don't count", () => {
  const cfg = { ...bot, maxLeads: 4 } as unknown as typeof bot;
  const copyable = [{ copy_amount: "100", coverage: "0.9" }];
  const leads = ["0xa", "0xb", "0xc", "0xd"].map((a, i) => baseLead({ address: a, copy_score: String(90 - i), copy_amount_coverage: copyable }));
  let s = step(initialState(cfg, NOW), leads, new Map(), cfg, NOW);
  assert.equal(s.positions.length, 4);
  // Accounts are $100k: a $20k HYPE short is sizable, a $2k one is not.
  const pos = (coin: string, long: boolean, value: number) => ({ coin, long, entryPx: 1, value, leadUpnl: 0, ourUpnl: 0 });
  s.live = {
    "0xa": { lastFillMs: NOW, unrealized: 0, open: [pos("HYPE", false, 20_000)] },
    "0xb": { lastFillMs: NOW, unrealized: 0, open: [pos("HYPE", false, 20_000)] },
    "0xc": { lastFillMs: NOW, unrealized: 0, open: [pos("HYPE", false, 20_000), pos("BTC", true, 30_000)] },
    "0xd": { lastFillMs: NOW, unrealized: 0, open: [pos("HYPE", false, 2_000)] },
  };
  const heldMap = new Map<string, Lead | undefined>(leads.map((l) => [l.address, l]));
  s = step(s, leads, heldMap, cfg, NOW + H, { markFromStrike: false });
  assert.deepEqual(s.positions.map((p) => p.lead).sort(), ["0xa", "0xb", "0xd"]); // 0xc: weakest of the three big HYPE shorts
  assert.match(s.closed.at(-1)!.reason, /3 copies held the same HYPE short/);
  assert.equal(s.cooldowns["0xc"], NOW + H + 24 * H); // short cooldown, not the usual week
});

test("shadow test follows skipped candidates and compares them with the picks", () => {
  const two = { ...bot, maxLeads: 2, shadowSize: 2 } as unknown as typeof bot;
  const leads = ["0xa", "0xb", "0xc", "0xd"].map((a, i) => lead({ address: a, copy_score: String(80 - i) }));
  let s = step(initialState(two, NOW), leads, new Map(), two, NOW);
  assert.deepEqual(s.shadow!.map((x) => x.lead), ["0xc", "0xd"]); // best by Strike's copy score among those not copied
  // Picks gain $10k on a $100k account (+10%); skipped ones gain nothing.
  const later = NOW + H;
  const up = (l: Lead) => ({ ...l, pnl: { ...l.pnl, all: "60000" }, last_traded_at_ms: later });
  const next = leads.map((l) => (["0xa", "0xb"].includes(l.address) ? up(l) : { ...l, last_traded_at_ms: later }));
  s = step(s, next, new Map(next.slice(0, 2).map((l) => [l.address, l])), two, later, { markFromStrike: false });
  assert.ok(Math.abs(s.lastScan!.compare!.picks! - 0.1) < 1e-9);
  assert.equal(s.lastScan!.compare!.skipped, 0);
});

test("bold slot: picks the highest 30d return under looser rules, as an extra slot with a 10% stop", () => {
  const cfg = { ...bot, maxLeads: 2 } as unknown as typeof bot;
  const copyable = [{ copy_amount: "100", coverage: "0.9" }];
  const steady = ["0xa", "0xb"].map((a, i) => baseLead({ address: a, copy_score: String(90 - i), copy_amount_coverage: copyable }));
  // Too wild for the normal rules (drawdown 35%), fine for the bold slot; the highest return wins it.
  const wild = baseLead({ address: "0xw", copy_score: "50", roi: { "1d": "0", "7d": "0.1", "30d": "1.8", all: "2" }, copy_score_breakdown: { drawdown_30d: { raw: "0.35" } }, copy_amount_coverage: copyable });
  const warm = baseLead({ address: "0xm", copy_score: "50", roi: { "1d": "0", "7d": "0.1", "30d": "0.6", all: "2" }, copy_score_breakdown: { drawdown_30d: { raw: "0.3" } }, copy_amount_coverage: copyable });
  const all = [...steady, wild, warm];
  let s = step(initialState(cfg, NOW), all, new Map(), cfg, NOW);
  assert.deepEqual(s.positions.map((p) => p.lead), ["0xa", "0xb"]); // off by default
  s.bold = { enabled: true };
  const held = new Map<string, Lead | undefined>(all.map((l) => [l.address, l]));
  s = step(s, all, held, cfg, NOW + H, { markFromStrike: false });
  const b = s.positions.find((p) => p.bold)!;
  assert.equal(b.lead, "0xw");
  assert.equal(s.positions.length, 3); // an extra slot: the two normal copies stay
  assert.ok(Math.abs(b.cost - bot.startingCapital / 3) < 1e-6);
  // 10% stop for the bold copy (a normal copy would need −15%).
  assert.match(exitReason({ ...b, value: b.cost * 0.89 }, wild, cfg, NOW + 2 * H)!, /stop-loss/);
  assert.equal(exitReason({ ...s.positions[0], value: s.positions[0].cost * 0.89 }, steady[0], cfg, NOW + 2 * H), null);
  // Switched off: the bold copy is closed, the normal ones stay.
  s.bold = { enabled: false };
  s = step(s, all, held, cfg, NOW + 2 * H, { markFromStrike: false });
  assert.deepEqual(s.positions.map((p) => p.lead).sort(), ["0xa", "0xb"]);
  assert.match(s.closed.at(-1)!.reason, /bold slot switched off/);
});

test("risk-adjusted score: a steady climber beats a choppy one with the same return; losing = 0", () => {
  const curve = (f: (i: number) => number) => Array.from({ length: 30 }, (_, i) => [NOW - (30 - i) * 24 * H, String(f(i))] as [number, string]);
  // Both end up +$20k on a ~$100k account; the choppy one drops $15k on the way.
  const steady = lead({ address: "0xa", account_value: "120000", pnl_curve_30d: curve((i) => (i * 20000) / 29) });
  const choppy = lead({ address: "0xb", account_value: "120000", pnl_curve_30d: curve((i) => (i < 15 ? (i * 20000) / 14 : i < 22 ? 20000 - ((i - 14) * 15000) / 7 : 5000 + ((i - 21) * 15000) / 8)) });
  const losing = lead({ address: "0xc", account_value: "80000", pnl_curve_30d: curve((i) => -i * 700) });
  assert.ok(riskAdjusted(steady) > riskAdjusted(choppy));
  assert.ok(riskAdjusted(steady) > 0.5 && riskAdjusted(steady) < 1);
  assert.equal(riskAdjusted(losing), 0);
  assert.ok(scoreLead(steady, 333) > scoreLead(choppy, 333));
});

test("rotation swaps out a losing copy for a clearly better trader, never a winning one", () => {
  const cfg = { ...bot, maxLeads: 2 } as unknown as typeof bot;
  const copyable = [{ copy_amount: "100", coverage: "0.9" }];
  const curve = (f: (i: number) => number) => Array.from({ length: 30 }, (_, i) => [NOW - (30 - i) * 24 * H, String(f(i))] as [number, string]);
  const active = NOW + 1000 * H; // still trading throughout the test
  const meh = (address: string) => baseLead({ address, last_traded_at_ms: active, copy_score: "60", copy_amount_coverage: copyable, pnl_curve_30d: curve((i) => (i % 2 ? 8000 : 0) + i * 400) });
  const star = baseLead({ address: "0xstar", last_traded_at_ms: active, copy_score: "90", copy_amount_coverage: copyable, pnl_curve_30d: curve((i) => i * 1000) });
  const held = [meh("0xwin"), meh("0xlose")];
  let s = step(initialState(cfg, NOW), held, new Map(), cfg, NOW);
  const later = NOW + 100 * H; // past the 72h minimum hold
  s.positions.find((p) => p.lead === "0xwin")!.value = s.positions[0].cost * 1.05; // in profit
  s.positions.find((p) => p.lead === "0xlose")!.value = s.positions[0].cost * 0.97; // losing
  const heldMap = new Map<string, Lead | undefined>(held.map((l) => [l.address, l]));
  s = step(s, [...held, star], heldMap, cfg, later, { markFromStrike: false });
  assert.deepEqual(s.positions.map((p) => p.lead).sort(), ["0xstar", "0xwin"]);
  // With only a winner left to swap, nothing rotates.
  s.positions.find((p) => p.lead === "0xstar")!.value = s.positions.find((p) => p.lead === "0xstar")!.cost * 1.01;
  const better = baseLead({ address: "0xbetter", last_traded_at_ms: active, copy_score: "99", copy_amount_coverage: copyable, pnl_curve_30d: curve((i) => i * 1500) });
  s = step(s, [...held, star, better], new Map([...heldMap, ["0xstar", star]]), cfg, later + 200 * H, { markFromStrike: false });
  assert.ok(!s.positions.some((p) => p.lead === "0xbetter"));
});
