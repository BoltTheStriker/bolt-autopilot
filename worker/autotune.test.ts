// node --experimental-strip-types --test worker/autotune.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { defaultRules, type AutoRules } from "./autopilot.ts";
import { aiDecision, applyDecision, autopilotSignals, droppedLeads, effectiveRules, rulesDecision, withinLimits, type AutotuneState, type TraderStats } from "./autotune.ts";

const NOW = Date.UTC(2026, 9, 22, 12);
const H = 3_600_000;
const mine: AutoRules = { ...defaultRules(400, "medium"), goal: "balanced", markets: "all", traders: 2 };
const user = (o: Partial<AutotuneState & { mode: string; rules: AutoRules | null }> = {}) => ({ mode: "autopilot", rules: mine, reviewedAt: NOW - 2 * H, ...o });
const stats = (lead: string, roi7d = 0.02): TraderStats => ({ lead, score: 0.5, dd: 0.05, roi7d, roi30d: 0.2, realWorldShare: 0.3 });

test("withinLimits never lets anything get looser than the user's rules", () => {
  const wild: AutoRules = { budgetUsd: 5_000, risk: "high", goal: "growth", markets: "crypto", traders: 9, maxLeverage: 20, stopLossPct: 0.3, profitLockPct: 0.2, dailyLossPct: 0.25 };
  const r = withinLimits(wild, mine);
  assert.equal(r.budgetUsd, 400);
  assert.equal(r.risk, "medium");
  assert.equal(r.goal, "balanced");
  assert.equal(r.maxLeverage, mine.maxLeverage);
  assert.equal(r.stopLossPct, mine.stopLossPct);
  assert.equal(r.dailyLossPct, mine.dailyLossPct);
  assert.equal(r.traders, 6);
  assert.equal(r.markets, "crypto"); // narrowing "all" is fine
  assert.equal(r.profitLockPct, 0.2); // banking gains is always allowed
  assert.equal(withinLimits({ ...mine, markets: "all" }, { ...mine, markets: "realworld" }).markets, "realworld");
});

test("withinLimits keeps tighter choices as they are", () => {
  const calm: AutoRules = { ...mine, risk: "low", goal: "steady", maxLeverage: 2, stopLossPct: 0.08, dailyLossPct: 0.04, budgetUsd: 200 };
  assert.deepEqual(withinLimits(calm, mine), calm);
});

test("effectiveRules: Autopilot's rules only in autopilot mode", () => {
  const tuned = { rules: { ...mine, risk: "low" as const }, at: NOW, reason: "x" };
  assert.equal(effectiveRules(user({ tuned }))!.risk, "low");
  assert.equal(effectiveRules(user({ tuned, mode: "on" }))!.risk, "medium");
  assert.equal(effectiveRules(user({ rules: null })), null);
});

test("signals: a trader out of the ranking, a copy near its stop, losses near the daily limit, the daily review", () => {
  const copies = [
    { lead: "0xAAA", amount: 150, pnl: -2 },
    { lead: "0xBBB", amount: 150, pnl: -15 }, // 0.6 × 15% × 150 = 13.5
  ];
  const s = autopilotSignals(user(), { now: NOW, copies, ranked: new Set(["0xbbb"]), dayLossUsd: 20 }); // 0.6 × 8% × 400 = 19.2
  assert.deepEqual(s.map((x) => x.kind).sort(), ["losing_copy", "near_daily_limit", "out_of_ranking"]);
  assert.equal(autopilotSignals(user({ reviewedAt: NOW - 25 * H }), { now: NOW, copies: [], ranked: new Set(), dayLossUsd: 0 })[0].kind, "daily");
});

test("signals: paced (an hour apart, half an hour when urgent) and only in autopilot mode", () => {
  const ctx = { now: NOW, copies: [{ lead: "0xAAA", amount: 150, pnl: 0 }], ranked: new Set<string>(), dayLossUsd: 0 };
  assert.equal(autopilotSignals(user({ reviewedAt: NOW - 20 * 60_000 }), ctx).length, 0);
  assert.equal(autopilotSignals(user({ reviewedAt: NOW - 40 * 60_000 }), { ...ctx, dayLossUsd: 25 }).length > 0, true);
  assert.equal(autopilotSignals(user({ mode: "on" }), ctx).length, 0);
  assert.equal(autopilotSignals(user({ reviews: { day: "2026-10-22", n: 8 } }), ctx).length, 0);
});

test("rules version: drops a trader out of the ranking, and one failing with a bad week; steps risk down near the limit", () => {
  const signals = [
    { kind: "out_of_ranking" as const, lead: "0xAAA", detail: "" },
    { kind: "losing_copy" as const, lead: "0xBBB", detail: "" },
    { kind: "near_daily_limit" as const, detail: "" },
  ];
  const d = rulesDecision(user(), signals, (l) => (l === "0xBBB" ? stats(l, -0.04) : undefined));
  assert.deepEqual(d.drop.map((x) => x.lead), ["0xAAA", "0xBBB"]);
  assert.equal(d.rules!.risk, "low");
  assert.ok(d.rules!.maxLeverage <= 3 && d.rules!.stopLossPct <= 0.1);
  assert.equal(d.by, "rules");
});

test("rules version: keeps a losing copy whose week is still good, and goes back to the user's rules on a calm day", () => {
  const keep = rulesDecision(user(), [{ kind: "losing_copy", lead: "0xBBB", detail: "" }], (l) => stats(l, 0.03));
  assert.equal(keep.drop.length, 0);
  assert.equal(keep.rules, null);
  const calm = rulesDecision(user({ tuned: { rules: { ...mine, risk: "low" }, at: NOW - 30 * H, reason: "" } }), [{ kind: "daily", detail: "" }], () => undefined);
  assert.deepEqual(calm.rules, mine);
});

test("applyDecision: drops only traders being copied, keeps at least one, clamps rules, paces reviews", () => {
  const u = user();
  const line = applyDecision(
    u,
    { rules: { ...mine, risk: "high", maxLeverage: 10, goal: "steady" }, drop: [{ lead: "0xAAA", reason: "left" }, { lead: "0xBBB", reason: "weak" }, { lead: "0xZZZ", reason: "not copied" }], summary: "Swapped a trader.", by: "ai" },
    NOW,
    ["0xAAA", "0xBBB"],
  );
  assert.equal(line, "Autopilot: Swapped a trader.");
  assert.deepEqual([...droppedLeads(u, NOW)], ["0xaaa"]); // at most all but one per review
  assert.equal(u.tuned!.rules.risk, "medium"); // "high" pulled back to the user's own
  assert.equal(u.tuned!.rules.goal, "steady");
  assert.equal(u.reviewedAt, NOW);
  assert.deepEqual(u.reviews, { day: "2026-10-22", n: 1 });
  assert.equal(droppedLeads(u, NOW + 25 * H).size, 0); // set aside for a day
});

test("applyDecision: back to the user's own rules clears Autopilot's; no change says so", () => {
  const u = user({ tuned: { rules: { ...mine, risk: "low" }, at: NOW - H, reason: "" } });
  applyDecision(u, { rules: mine, drop: [], summary: "Back to your settings.", by: "rules" }, NOW, ["0xAAA"]);
  assert.equal(u.tuned, undefined);
  assert.equal(applyDecision(user(), { rules: null, drop: [], summary: "no changes needed.", by: "rules" }, NOW, []), "Autopilot checked your setup: no changes needed.");
});

test("aiDecision: reads Claude's forced tool call; rules beyond the limits are clamped when applied", async () => {
  type Req = { tool_choice: { name: string }; messages: { content: string }[] };
  let sent: Req | null = null;
  const fake = {
    beta: {
      messages: {
        create: async (req: Req) => {
          sent = req;
          return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "autopilot_decision", input: { change_rules: true, rules: { ...mine, risk: "high", maxLeverage: 10 }, drop: [{ lead: "0xAAA", reason: "left the ranking" }], summary: "Dropped one trader." } }] };
        },
      },
    },
  } as unknown as Pick<Anthropic, "beta">;
  const u = user();
  const d = await aiDecision(fake, u, { signals: [{ kind: "daily", detail: "daily review" }], copies: [{ lead: "0xAAA", amount: 150, pnl: 1 }, { lead: "0xBBB", amount: 150, pnl: 2 }], dayLossUsd: 0, held: [stats("0xAAA")], candidates: [stats("0xCCC")] });
  assert.equal(sent!.tool_choice.name, "autopilot_decision");
  assert.match(sent!.messages[0].content, /user_limits/);
  assert.equal(d.by, "ai");
  applyDecision(u, d, NOW, ["0xAAA", "0xBBB"]);
  assert.ok(effectiveRules(u)!.maxLeverage <= mine.maxLeverage);
  assert.equal(effectiveRules(u)!.risk, "medium");
  assert.ok(droppedLeads(u, NOW).has("0xaaa"));
});

test("aiDecision: no tool call is an error (the worker then uses the rules version)", async () => {
  const fake = { beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } } as unknown as Pick<Anthropic, "beta">;
  await assert.rejects(aiDecision(fake, user(), { signals: [], copies: [], dayLossUsd: 0, held: [], candidates: [] }));
});
