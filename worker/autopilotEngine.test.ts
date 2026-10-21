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
  const client = {
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
  return { client, calls, active, pnl, parkedSubs, refuse, noLeverage };
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
