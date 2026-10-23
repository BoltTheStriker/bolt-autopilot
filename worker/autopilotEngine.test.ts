// node --experimental-strip-types --test worker/autopilotEngine.test.ts
// A fake Strike: nothing here talks to the network.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CopySpec } from "./autopilot.ts";
import { defaultRules } from "./autopilot.ts";
import type { AutoUser } from "./autopilotStore.ts";
import { planUser, syncUser } from "./autopilotEngine.ts";
import type { CopySub, StrikeClient } from "./strike-live.ts";

const T = Date.parse("2026-10-21T12:00:00Z");
const spec = (lead: string): CopySpec => ({ lead, amount: 50, stopLossUsd: 7.5, maxLeverage: 5, multiplier: 1, maxMarginPerSymbol: 25, excludedSymbols: [] });
const sub = (id: string, lead: string, extra: Partial<CopySub> = {}): CopySub => ({ subscription_id: id, lead_account_id: lead, lead_platform: "hyperliquid", copy_mode: "fixed_ratio", status: "active", copy_amount: "50", ...extra });
const user = (): AutoUser => ({ stake: "stake1x", address: "addr1x", accountId: "acc-1", apiPublicKey: "", apiPrivateKeyEnc: "", network: "testnet", createdAt: 0, rules: { ...defaultRules(200), dailyLossPct: 0.08 }, mode: "on", managed: {}, log: [], sessions: [] });

/** Fake Strike: isolated copies take `setupCalls` calls to become active. */
function fakeStrike(setupCalls = 2) {
  const active: CopySub[] = [];
  const calls: string[] = [];
  const seen: Record<string, number> = {};
  const pnl: Record<string, number> = {};
  const parkedSubs: { account_id: string; name: string; available_balance: string; margin_used_pct: string }[] = [];
  const refuse = new Set<string>();
  const noLeverage = new Set<string>();
  const funds = { free: null as number | null }; // the main account's free balance (null: Strike doesn't say)
  const client = {
    account: async () => (funds.free === null ? {} : { available_balance: String(funds.free) }),
    subscriptions: async () => active.filter((s) => s.status === "active").map((s) => ({ ...s, realized_pnl: String(pnl[s.subscription_id] ?? 0) })),
    copyPositions: async () => [],
    subAccounts: async () => parkedSubs,
    subscribeShared: async (s: { lead: string; amount: number }, leverage = true) => {
      calls.push(`copy ${s.lead} $${s.amount}${leverage ? "" : " (no leverage)"}`);
      if (refuse.has(s.lead) || (leverage && noLeverage.has(s.lead))) throw new Error('Strike POST /v2/copy/subscribe → 400 {"error":"invalid inputs"}');
      const id = `sub-${s.lead}`;
      active.push(sub(id, s.lead));
      return { subscription_id: id, status: "active" };
    },
    subscribeInto: async (id: string, s: { lead: string; amount: number }) => {
      calls.push(`into ${id} ${s.lead} $${s.amount}`);
      if (refuse.has(s.lead)) throw new Error('Strike POST /v2/copy/subscribe → 400 {"error":"invalid inputs"}');
      const sid = `sub-${s.lead}`;
      active.push(sub(sid, s.lead, { account_id: id }));
      parkedSubs.splice(parkedSubs.findIndex((p) => p.account_id === id), 1);
      return { status: "active", subscription_id: sid };
    },
    subscribeIsolated: async (s: { requestId: string; lead: string; sourceAccountId: string }) => {
      calls.push(`subscribe ${s.lead} from ${s.sourceAccountId}`);
      if (refuse.has(s.lead)) throw new Error('Strike POST /v2/copy/subscribe → 400 {"error":"invalid inputs"}');
      seen[s.requestId] = (seen[s.requestId] ?? 0) + 1;
      if (seen[s.requestId] < setupCalls) return { status: "creating_account" };
      const id = `sub-${s.lead}`;
      if (!active.some((x) => x.subscription_id === id)) active.push(sub(id, s.lead));
      return { status: "active", subscription_id: id };
    },
    stop: async (id: string) => {
      calls.push(`stop ${id}`);
      const s = active.find((x) => x.subscription_id === id);
      if (s) s.status = "stopped";
      return { status: 204, data: null };
    },
  } as unknown as StrikeClient;
  return { client, calls, active, pnl, parkedSubs, refuse, noLeverage, funds };
}

test("plan: stop copies the rules dropped, start missing ones, leave manual copies alone", () => {
  const a = planUser({ "0xa": "s1", "0xold": "s2" }, [spec("0xa"), spec("0xb")], [sub("s1", "0xa"), sub("s2", "0xold"), sub("m", "0xmanual")]);
  assert.deepEqual(a.map((x) => (x.type === "stop" ? `stop ${x.id}` : `start ${x.spec.lead}`)), ["stop s2", "start 0xb"]);
});

test("copies start from the main account right away, with the user's limits", async () => {
  const { client, calls } = fakeStrike();
  const u = user();
  await syncUser(u, client, [spec("0xa")], T);
  assert.deepEqual(u.managed, { "0xa": "sub-0xa" });
  assert.deepEqual(calls, ["copy 0xa $50"]);
  assert.match(u.log[0].text, /Copying 0xa…0xa with \$50\.00 \(leverage 5x, stop at −\$7\.50\)/);
});

test("if Strike won't take the leverage setting, the copy starts without it and says so", async () => {
  const { client, calls, noLeverage } = fakeStrike();
  noLeverage.add("0xa");
  const u = user();
  await syncUser(u, client, [spec("0xa")], T);
  assert.deepEqual(calls, ["copy 0xa $50", "copy 0xa $50 (no leverage)"]);
  assert.deepEqual(u.managed, { "0xa": "sub-0xa" });
  assert.match(u.log[0].text, /Strike's default leverage/);
});

test("switching off stops every copy; a copy Strike ended is forgotten", async () => {
  const { client, calls, active } = fakeStrike(1);
  const u = user();
  await syncUser(u, client, [spec("0xa"), spec("0xb")], T);
  assert.equal(Object.keys(u.managed).length, 2);
  active[0].status = "stopped"; // Strike's stop-loss ended 0xa
  u.mode = "off";
  await syncUser(u, client, [spec("0xa"), spec("0xb")], T + 60_000);
  assert.deepEqual(u.managed, {});
  assert.ok(calls.includes("stop sub-0xb"));
  assert.ok(u.log.some((l) => /ended on Strike/.test(l.text)));
});

test("the daily loss limit stops everything until the next day", async () => {
  const { client, pnl } = fakeStrike(1);
  const u = user(); // budget $200, daily limit 8% = $16
  await syncUser(u, client, [spec("0xa")], T);
  pnl["sub-0xa"] = -20; // down $20 today
  await syncUser(u, client, [spec("0xa")], T + 3_600_000);
  assert.deepEqual(u.managed, {});
  assert.match(u.log.find((l) => /Daily loss limit/.test(l.text))!.text, /−\$20\.00/);
  await syncUser(u, client, [spec("0xa")], T + 2 * 3_600_000); // same day: stays stopped
  assert.deepEqual(u.managed, {});
  await syncUser(u, client, [spec("0xa")], T + 24 * 3_600_000); // next day: back on
  assert.ok(u.managed["0xa"]);
});

test("money an ended copy left in its sub-account starts the next copy (adopting older copies by name)", async () => {
  const { client, calls, parkedSubs } = fakeStrike(1);
  const u = user();
  u.log.unshift({ at: T - 60_000, text: "Copying 0x3b3d…b464 with $50.00 (leverage ≤ 10x, stop at −$10.00)." });
  parkedSubs.push({ account_id: "copy-sub-1", name: "Copy · 0x3b3d9…5b464", available_balance: "50.09", margin_used_pct: "0" });
  parkedSubs.push({ account_id: "someone-else", name: "BOLT COPY TRADE BOT", available_balance: "700", margin_used_pct: "12" });
  await syncUser(u, client, [spec("0xnew")], T);
  assert.deepEqual(calls, ["into copy-sub-1 0xnew $50"]); // reused, not a fresh $50 from the main balance
  assert.deepEqual(u.managed, { "0xnew": "sub-0xnew" });
  assert.match(u.log[0].text, /reusing money from an earlier copy/);
  assert.ok(!u.subs!.includes("someone-else")); // never touches sub-accounts it didn't start
});

test("a copy Strike refuses is logged once, then skipped for a while", async () => {
  const { client, calls, refuse } = fakeStrike(1);
  refuse.add("0xbad");
  const u = user();
  await syncUser(u, client, [spec("0xbad")], T);
  assert.match(u.log[0].text, /Couldn.t start a copy of 0xbad…xbad: 400 \{"error":"invalid inputs"\}\. Trying other traders\./);
  assert.ok(u.cooldown!["0xbad"] > T);
  assert.equal(u.pending!["0xbad"], undefined);
  assert.equal(u.lastError, undefined); // the sync itself didn't fail
  assert.deepEqual(calls, ["copy 0xbad $50", "copy 0xbad $50 (no leverage)"]); // tried once with, once without leverage
});

test("profit target: at +$X since Start the bot stops every copy and switches off", async () => {
  const { client, pnl, calls } = fakeStrike(1);
  const u = user();
  u.rules = { ...u.rules!, dailyLossPct: 0.12, stopAtProfitUsd: 20 };
  await syncUser(u, client, [spec("0xa"), spec("0xb")], T);
  pnl["sub-0xa"] = 12;
  pnl["sub-0xb"] = 5; // +$17: not yet
  await syncUser(u, client, [spec("0xa"), spec("0xb")], T + 60_000);
  assert.equal(u.mode, "on");
  pnl["sub-0xb"] = 9; // +$21
  await syncUser(u, client, [spec("0xa"), spec("0xb")], T + 120_000);
  assert.equal(u.mode, "off");
  assert.deepEqual(u.managed, {});
  assert.ok(calls.includes("stop sub-0xa") && calls.includes("stop sub-0xb"));
  assert.match(u.log.find((l) => /Profit target reached/.test(l.text))!.text, /\+\$21\.00 since Start \(your target was \+\$20\.00\)/);
  assert.equal(u.run, undefined); // the run is over
});

test("loss stop counts copies that already ended (Strike's stop-loss) toward the total", async () => {
  const { client, pnl, active } = fakeStrike(1);
  const u = user();
  u.rules = { ...u.rules!, dailyLossPct: 0.25, stopAtLossUsd: 25 };
  await syncUser(u, client, [spec("0xa"), spec("0xb")], T);
  pnl["sub-0xa"] = -15;
  await syncUser(u, client, [spec("0xa"), spec("0xb")], T + 60_000);
  active.find((s) => s.subscription_id === "sub-0xa")!.status = "stopped"; // Strike's stop-loss ended it at −$15
  await syncUser(u, client, [spec("0xb")], T + 120_000);
  assert.equal(u.run!.closed, -15);
  assert.equal(u.mode, "on");
  pnl["sub-0xb"] = -11; // −$15 − $11 = −$26
  await syncUser(u, client, [spec("0xb")], T + 180_000);
  assert.equal(u.mode, "off");
  assert.match(u.log.find((l) => /Loss limit reached/.test(l.text))!.text, /−\$26\.00 since Start/);
});

test("daily profit target: at +$X today every copy closes until tomorrow", async () => {
  const { client, pnl } = fakeStrike(1);
  const u = user();
  u.rules = { ...u.rules!, dailyProfitUsd: 10 };
  await syncUser(u, client, [spec("0xa")], T);
  pnl["sub-0xa"] = 11;
  await syncUser(u, client, [spec("0xa")], T + 60_000);
  assert.deepEqual(u.managed, {});
  assert.equal(u.mode, "on"); // only for today
  assert.ok(u.log.some((l) => /^Daily profit target reached \(\+\$11\.00 today/.test(l.text)));
  await syncUser(u, client, [spec("0xa")], T + 24 * 3_600_000);
  assert.ok(u.managed["0xa"]); // next day: back on
});

test("a timed pause closes the copies and the bot picks up again by itself; weekends too", async () => {
  const { client } = fakeStrike(1);
  const u = user();
  await syncUser(u, client, [spec("0xa")], T);
  u.rules = { ...u.rules!, pauseUntil: T + 6 * 3_600_000 };
  await syncUser(u, client, [spec("0xa")], T + 60_000);
  assert.deepEqual(u.managed, {});
  assert.ok(u.log.some((l) => /^Paused until .* UTC, as you asked: closing every copy\.$/.test(l.text)));
  await syncUser(u, client, [spec("0xa")], T + 7 * 3_600_000);
  assert.ok(u.managed["0xa"]);
  u.rules = { ...u.rules!, pauseUntil: null, weekdaysOnly: true };
  const saturday = Date.parse("2026-10-24T12:00:00Z");
  await syncUser(u, client, [spec("0xa")], saturday);
  assert.deepEqual(u.managed, {});
  assert.ok(u.log.some((l) => /^Weekend break/.test(l.text)));
});

test("orders Strike couldn't copy show up once in the activity feed, with the reason", async () => {
  const { client } = fakeStrike(1);
  const u = user();
  await syncUser(u, client, [spec("0xa")], T);
  const fail = { id: "o1", subscription_id: "sub-0xa", lead_account_id: "0xa", symbol: "BTC-USD", error_message: "max_margin_per_symbol", created_at_ms: T + 30_000 };
  (client as unknown as { request: () => Promise<unknown> }).request = async () => ({ status: 200, data: { orders: [fail] } });
  await syncUser(u, client, [spec("0xa")], T + 60_000);
  await syncUser(u, client, [spec("0xa")], T + 120_000);
  const lines = u.log.filter((l) => /Couldn't copy a BTC trade/.test(l.text));
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /more of this copy on one coin than its limit allows/);
});

test("less free balance than the rules ask for: the last copy uses what's free, and under $50 it waits (said once)", async () => {
  const { client, calls, funds } = fakeStrike();
  const big = (lead: string): CopySpec => ({ ...spec(lead), amount: 100, stopLossUsd: 15, maxMarginPerSymbol: 50 });
  funds.free = 171; // a deposit is still partly on its way
  const u = user();
  await syncUser(u, client, [big("0xa"), big("0xb"), big("0xc")], T);
  assert.deepEqual(calls, ["copy 0xa $100", "copy 0xb $70"]); // $71 free after the first, $1 kept for fees
  assert.match(u.log.find((l) => /0xb/.test(l.text))!.text, /with \$70\.00, all that's free on Strike right now \(your rules ask for \$100\.00\).*stop at −\$10\.50/);
  assert.match(u.log[0].text, /Not enough free balance on Strike for another copy: \$1\.00 free, a copy needs at least \$50/);
  assert.equal(u.cooldown?.["0xc"], undefined);
  await syncUser(u, client, [big("0xa"), big("0xb"), big("0xc")], T + 120_000); // still short: no repeat
  assert.equal(u.log.filter((l) => /Not enough free balance/.test(l.text)).length, 1);
  funds.free = 120; // the rest landed
  await syncUser(u, client, [big("0xa"), big("0xb"), big("0xc")], T + 240_000);
  assert.ok(u.managed["0xc"]);
});

test("a copy Strike ends at a loss (its stop-loss) sets that trader aside for a day; one ended in profit doesn't", async () => {
  const { client, active, pnl } = fakeStrike();
  const u = user();
  await syncUser(u, client, [spec("0xa"), spec("0xb")], T);
  pnl["sub-0xa"] = -7.6; // at its stop
  pnl["sub-0xb"] = 3.2;
  await syncUser(u, client, [spec("0xa"), spec("0xb")], T + 60_000);
  for (const s of active) s.status = "stopped"; // Strike ended both: 0xa at its stop-loss, 0xb by hand in Strike's app
  await syncUser(u, client, [], T + 120_000);
  assert.deepEqual(Object.keys(u.drops ?? {}), ["0xa"]);
  assert.equal(u.drops!["0xa"].until, T + 120_000 + 24 * 3_600_000);
  assert.ok(u.log.some((l) => /0xa…0xa ended on Strike at −\$7\.60 \(its stop-loss\)\. That trader sits out for a day/.test(l.text)));
  assert.ok(u.log.some((l) => /0xb…0xb ended on Strike \(stopped in Strike's app\)/.test(l.text)));
});
