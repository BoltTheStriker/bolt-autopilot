// node --experimental-strip-types --test worker/live.test.ts
// Uses a fake Strike client: nothing here talks to the network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultCtl, kill, lockProfit, plan, recordHistory, refresh, sync } from "./live.ts";
import type { CopySub, StrikeClient } from "./strike-live.ts";

const sub = (id: string, lead: string, extra: Partial<CopySub> = {}): CopySub => ({
  subscription_id: id, lead_account_id: lead, lead_platform: "hyperliquid", copy_mode: "fixed_ratio", status: "active", ...extra,
});
const desired = ["0xa", "0xb", "0xc"].map((lead, i) => ({ lead, score: 0.9 - i * 0.1 }));
const cfg = { stopLossPct: 0.15, dailyLossPct: 0.1 };

test("plan: fresh start subscribes to every pick, splitting the budget, with a stop-loss", () => {
  const a = plan({ desired, managed: {}, active: [], budgetUsd: 300, stopLossPct: 0.15 });
  assert.deepEqual(a.map((x) => x.type), ["subscribe", "subscribe", "subscribe"]);
  assert.ok(a.every((x) => x.type === "subscribe" && x.amount === 100 && x.stopLoss === 15));
});

test("plan: small budget funds only the best leads at Strike's $20 minimum", () => {
  const a = plan({ desired, managed: {}, active: [], budgetUsd: 45, stopLossPct: 0.15 });
  assert.deepEqual(a.map((x) => (x.type === "subscribe" ? x.lead : "")), ["0xa", "0xb"]);
  assert.equal(plan({ desired, managed: {}, active: [], budgetUsd: 10, stopLossPct: 0.15 }).length, 0);
});

test("plan: stops a dropped lead, keeps held ones, never touches manual subscriptions", () => {
  const managed = { "0xa": "s1", "0xold": "s2" };
  const active = [sub("s1", "0xa"), sub("s2", "0xold"), sub("manual", "0xb")];
  const a = plan({ desired, managed, active, budgetUsd: 300, stopLossPct: 0.15 });
  assert.deepEqual(a.filter((x) => x.type === "stop").map((x) => x.type === "stop" && x.id), ["s2"]);
  // 0xb is already copied manually → not subscribed again; 0xc gets a new copy.
  assert.deepEqual(a.filter((x) => x.type === "subscribe").map((x) => x.type === "subscribe" && x.lead), ["0xc"]);
  assert.ok(!a.some((x) => x.type === "stop" && x.id === "manual"));
});

test("plan: a copy floor funds fewer, bigger copies", () => {
  const a = plan({ desired, managed: {}, active: [], budgetUsd: 250, stopLossPct: 0.15, minCopyUsd: 100 });
  assert.deepEqual(a.map((x) => (x.type === "subscribe" ? `${x.lead} ${x.amount}` : "")), ["0xa 125", "0xb 125"]);
  assert.equal(plan({ desired, managed: {}, active: [], budgetUsd: 99, stopLossPct: 0.15, minCopyUsd: 100 }).length, 0);
});

test("plan: new copies only get what the kept copies leave of the budget", () => {
  const four = ["0xa", "0xb", "0xc", "0xd"].map((lead, i) => ({ lead, score: 0.9 - i * 0.1 }));
  const managed = { "0xa": "s1", "0xb": "s2", "0xc": "s3", "0xd": "s4" };
  const active = four.map((d, i) => sub(`s${i + 1}`, d.lead, { copy_amount: "175" }));
  const five = [...four, { lead: "0xe", score: 0.4 }];
  // $700 all used by four $175 copies: no 5th copy (it would push us to $840).
  assert.equal(plan({ desired: five, managed, active, budgetUsd: 700, stopLossPct: 0.15, minCopyUsd: 100 }).length, 0);
  // With $850 there's $150 left: the 5th gets that, not the $170 even split.
  const a = plan({ desired: five, managed, active, budgetUsd: 850, stopLossPct: 0.15, minCopyUsd: 100 });
  assert.deepEqual(a.map((x) => (x.type === "subscribe" ? `${x.lead} ${x.amount}` : "")), ["0xe 150"]);
});

test("plan: leftover too small for every new pick still funds the best ones it can", () => {
  const three = ["0xa", "0xb", "0xc"].map((lead, i) => ({ lead, score: 0.9 - i * 0.1 }));
  const managed = { "0xa": "s1", "0xb": "s2", "0xc": "s3" };
  const active = three.map((d, i) => sub(`s${i + 1}`, d.lead, { copy_amount: "175" }));
  const five = [...three, { lead: "0xd", score: 0.5 }, { lead: "0xe", score: 0.55 }];
  // $175 left for two picks is $87.50 each, under the $100 floor: copy the better one with all $175.
  const a = plan({ desired: five, managed, active, budgetUsd: 700, stopLossPct: 0.15, minCopyUsd: 100 });
  assert.deepEqual(a.map((x) => (x.type === "subscribe" ? `${x.lead} ${x.amount} ${x.stopLoss}` : "")), ["0xe 175 26.25"]);
  // Under the floor even for one: nothing.
  assert.equal(plan({ desired: five, managed, active, budgetUsd: 610, stopLossPct: 0.15, minCopyUsd: 100 }).length, 0);
});

function fakeClient(active: CopySub[]) {
  const calls: string[] = [];
  const client = {
    subscriptions: async () => active.filter((s) => s.status === "active"),
    subscribe: async (lead: string, amount: number) => {
      calls.push(`subscribe ${lead} ${amount}`);
      const s = sub(`new-${lead}`, lead);
      active.push(s);
      return s;
    },
    stop: async (id: string) => {
      calls.push(`stop ${id}`);
      const s = active.find((x) => x.subscription_id === id);
      if (s) s.status = "stopped";
      return { status: 204, data: null };
    },
  } as unknown as StrikeClient;
  return { client, calls };
}

test("sync: paper never calls Strike; dry only logs; live places copies", async () => {
  const { client, calls } = fakeClient([]);
  const ctl = defaultCtl(300);
  await sync(ctl, client, desired, cfg);
  assert.equal(calls.length, 0);

  ctl.mode = "dry";
  await sync(ctl, client, desired, cfg);
  assert.equal(calls.length, 0);
  assert.ok(ctl.log.some((l) => l.text.startsWith("[dry run] would copy")));

  ctl.mode = "live";
  await sync(ctl, client, desired, cfg);
  assert.equal(calls.filter((c) => c.startsWith("subscribe")).length, 3);
  assert.equal(Object.keys(ctl.managed).length, 3);

  // A second sync with nothing changed does nothing (idempotent), and records the real copies.
  await sync(ctl, client, desired, cfg);
  assert.equal(calls.length, 3);
  assert.deepEqual(ctl.copies?.map((c) => c.lead).sort(), ["0xa", "0xb", "0xc"]);
});

test("refresh only reads: updates profit and copies, never places or stops", async () => {
  const { client, calls } = fakeClient([sub("s1", "0xa", { pnl: "3.5", copy_amount: "100" })]);
  const ctl = { ...defaultCtl(300), mode: "live" as const, managed: { "0xa": "s1" } };
  await refresh(ctl, client, cfg);
  assert.equal(calls.length, 0);
  assert.equal(ctl.account?.pnl, 3.5);
  assert.deepEqual(ctl.copies?.map((c) => c.lead), ["0xa"]);
  // Paper mode doesn't touch Strike at all.
  const paper = defaultCtl(300);
  await refresh(paper, client, cfg);
  assert.equal(paper.account, undefined);
});

test("copy profit = realized + live unrealized of its positions (like Strike's screen)", async () => {
  const { client, calls } = fakeClient([sub("s1", "0xa", { pnl: "-0.27", realized_pnl: "-0.27", copy_amount: "112.5" })]);
  (client as unknown as { copyPositions: () => Promise<unknown[]> }).copyPositions = async () => [
    { subscription_id: "s1", market: "BTC-USD", side: "long", entry_price: "81916", mark_price: "82306", pnl: "2.14" },
    { own: true, market: "BTC-USD", side: "long", pnl: "99" }, // not a copy
  ];
  const ctl = { ...defaultCtl(300), mode: "live" as const, managed: { "0xa": "s1" } };
  await refresh(ctl, client, cfg);
  assert.equal(calls.length, 0);
  assert.equal(Number(ctl.copies![0].pnl.toFixed(2)), 1.87);
  assert.deepEqual(ctl.copies![0].positions!.map((p) => p.market), ["BTC-USD"]);
});

test("history starts at break-even, keeps a point every 5 minutes and updates the latest", () => {
  const t0 = 1_000_000_000_000, M = 60_000;
  const ctl = { ...defaultCtl(300), mode: "live" as const, liveSince: t0 };
  const read = (at: number, pnl: number) => {
    ctl.account = { subs: 1, allocated: 100, pnl, at };
    recordHistory(ctl, at);
  };
  read(t0 + 1 * M, 1);
  read(t0 + 2 * M, 2); // within 5 min of the previous point: replaces it
  read(t0 + 7 * M, 3); // new step
  assert.deepEqual(ctl.history!.map((h) => h.pnl), [0, 2, 3]);
  assert.equal(ctl.history![0].at, t0);
});

test("sync: without keys it reports an error and does nothing", async () => {
  const ctl = { ...defaultCtl(300), mode: "live" as const };
  await sync(ctl, null, desired, cfg);
  assert.match(ctl.lastError!, /keys/);
});

test("sync: forgets copies Strike already stopped (its stop-loss fired)", async () => {
  const { client } = fakeClient([sub("s1", "0xa", { status: "stopped", stop_reason: "stop_loss" })]);
  const ctl = { ...defaultCtl(300), mode: "dry" as const, managed: { "0xa": "s1" } };
  await sync(ctl, client, desired, cfg);
  assert.deepEqual(ctl.managed, {});
});

test("kill stops every bot copy, leaves manual ones, returns to paper", async () => {
  const { client, calls } = fakeClient([sub("s1", "0xa"), sub("s2", "0xb"), sub("manual", "0xz")]);
  const ctl = { ...defaultCtl(300), mode: "live" as const, managed: { "0xa": "s1", "0xb": "s2" } };
  await kill(ctl, client);
  assert.deepEqual(calls.sort(), ["stop s1", "stop s2"]);
  assert.equal(ctl.mode, "paper");
  assert.deepEqual(ctl.managed, {});
});

test("daily loss limit trips the kill switch", async () => {
  const active = [sub("s1", "0xa", { pnl: "-5" }), sub("s2", "0xb", { pnl: "-5" })];
  const { client, calls } = fakeClient(active);
  const today = new Date().toISOString().slice(0, 10);
  const ctl = { ...defaultCtl(100), mode: "live" as const, managed: { "0xa": "s1", "0xb": "s2" }, dayStart: { day: today, pnl: 5 } };
  await sync(ctl, client, desired, cfg); // lost $15 today > 10% of $100
  assert.equal(ctl.mode, "paper");
  assert.ok(calls.includes("stop s1") && calls.includes("stop s2"));
});

test("plan with the bold slot: it's funded first with its own stop-loss and replaces the flat copy", () => {
  const managed = { "0xa": "s1", "0xb": "s2", "0xc": "s3", "0xd": "s4" };
  const active = Object.entries(managed).map(([lead, id]) => sub(id, lead, { copy_amount: "175" }));
  // Ranks as liveSync builds them: bold 1000+, copies holding trades 100+, the flat 0xd plain.
  const desired = [
    { lead: "0xa", score: 100.64 }, { lead: "0xb", score: 100.6 }, { lead: "0xc", score: 100.53 },
    { lead: "0xd", score: 0.56 }, { lead: "0xe", score: 0.58 }, { lead: "0xbold", score: 1000.4, stopLossPct: 0.1 },
  ];
  const a = plan({ desired, managed, active, budgetUsd: 700, stopLossPct: 0.15, minCopyUsd: 100, maxCopies: 4 });
  assert.deepEqual(a.map((x) => (x.type === "stop" ? `stop ${x.lead}` : `copy ${x.lead} ${x.amount} sl ${x.stopLoss}`)), ["stop 0xd", "copy 0xbold 175 sl 17.5"]);
});

test("profit lock: banks the bold copy at +6%, not before; dry run only logs; the trader is copied again", async () => {
  const active = [sub("s1", "0xbold", { copy_amount: "175" }), sub("s2", "0xa", { copy_amount: "175" })];
  const { client, calls } = fakeClient(active);
  const ctl = defaultCtl(350);
  ctl.mode = "live";
  ctl.managed = { "0xbold": "s1", "0xa": "s2" };
  ctl.lock = { enabled: true, pct: 0.06, banked: 0, events: [] };
  ctl.copies = [{ lead: "0xbold", amount: 175, pnl: 9.9 }, { lead: "0xa", amount: 175, pnl: 30 }];
  assert.equal(await lockProfit(ctl, client, "0xbold"), null); // +5.7%: not yet (0xa is up more, but isn't the locked copy)
  ctl.copies[0].pnl = 10.5; // +6%
  ctl.mode = "dry";
  assert.equal(await lockProfit(ctl, client, "0xbold"), null);
  assert.match(ctl.log[0].text, /\[dry run\] would profit lock: bank \+\$10\.50/);
  ctl.mode = "live";
  assert.equal(await lockProfit(ctl, client, "0xbold"), 10.5);
  assert.deepEqual(calls, ["stop s1"]);
  assert.deepEqual([ctl.lock.banked, ctl.lock.events.length, ctl.managed["0xbold"]], [10.5, 1, undefined]);
  // The next sync copies the bold trader again with the freed $175.
  await sync(ctl, client, [{ lead: "0xbold", score: 1000 }, { lead: "0xa", score: 100 }], { ...cfg, minCopyUsd: 100 });
  assert.deepEqual(calls.slice(1), ["subscribe 0xbold 175"]);
  ctl.lock.enabled = false;
  ctl.copies = [{ lead: "0xbold", amount: 175, pnl: 50 }];
  assert.equal(await lockProfit(ctl, client, "0xbold"), null); // off
});

test("sync: a budget above what the account holds sizes the new copy to the free balance, not past it", async () => {
  const kept = [sub("s1", "0xa", { copy_amount: "175" }), sub("s2", "0xb", { copy_amount: "175" })];
  const { client, calls } = fakeClient(kept);
  (client as unknown as { account: () => Promise<Record<string, string>> }).account = async () => ({ available_balance: "171.49", margin_balance: "521.49" });
  const ctl = { ...defaultCtl(533), mode: "live" as const, managed: { "0xa": "s1", "0xb": "s2" } };
  await sync(ctl, client, desired, { ...cfg, minCopyUsd: 100 });
  // $533 − $350 kept would ask for $183, more than the $171.49 free (Strike refuses it): it uses what's free, a dollar kept.
  assert.deepEqual(calls, ["subscribe 0xc 170.49"]);
});

test("sync: the same error every few minutes is logged once", async () => {
  const { client } = fakeClient([]);
  (client as unknown as { subscribe: () => Promise<never> }).subscribe = async () => {
    throw new Error('Strike POST /v2/copy/subscribe → 400 {"error":"invalid inputs"}');
  };
  const ctl = { ...defaultCtl(300), mode: "live" as const };
  for (let i = 0; i < 3; i++) await sync(ctl, client, desired, cfg);
  assert.equal(ctl.log.filter((l) => l.text.startsWith("Error:")).length, 1);
});
