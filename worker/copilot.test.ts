// node --experimental-strip-types --test worker/copilot.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { copilotReply, type CopilotContext } from "./copilot.ts";
import { defaultRules } from "./autopilot.ts";

/** A stand-in for the Claude client that replays scripted responses and records requests. */
function fakeClient(script: Partial<Anthropic.Beta.BetaMessage>[]) {
  const seen: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          seen.push(structuredClone(params));
          const next = script.shift();
          if (!next) throw new Error("script ran out");
          return { stop_reason: "end_turn", content: [], ...next };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, seen };
}
const ctx: CopilotContext = { demo: true, rules: defaultRules(1000), maxBudgetUsd: 1000, balance: 1000, copies: [] };
const data = { traders: () => [{ lead: "0x7a21…d9f4", score: 0.5 }], earn: async () => ({ apr: 0.22 }) };

test("a proposal comes back for the user to apply, clamped to the risk level", async () => {
  const { client, seen } = fakeClient([
    {
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "t1", name: "propose_rules", input: { risk: "low", goal: "steady", markets: "realworld", traders: 3, budgetUsd: 1000, maxLeverage: 9, stopLossPct: 0.1, dailyLossPct: 0.05, profitLockPct: null } },
      ] as Anthropic.Beta.BetaContentBlock[],
    },
    { content: [{ type: "text", text: "I suggested Low risk, Steady, real-world markets. Tap Apply to use it." }] as Anthropic.Beta.BetaContentBlock[] },
  ]);
  const out = await copilotReply(client, [{ role: "user", text: "steady, stocks and gold only" }], ctx, data);
  assert.equal(out.proposal?.risk, "low");
  assert.equal(out.proposal?.maxLeverage, 3); // 9x asked, Low caps at 3x
  assert.match(out.reply, /Apply/);
  // Request shape: Opus 5.5, server-side fallback on, app state as a trailing system note.
  assert.equal(seen[0].model, "claude-opus-5-5");
  assert.equal(seen[0].fallbacks, "default");
  const msgs = seen[0].messages as { role: string }[];
  assert.equal(msgs.at(-1)!.role, "system");
  // Second request: the assistant turn appended unchanged, then the tool result.
  const msgs2 = seen[1].messages as { role: string; content: unknown }[];
  assert.equal(msgs2.at(-2)!.role, "assistant");
  assert.equal((msgs2.at(-1)!.content as { type: string }[])[0].type, "tool_result");
});

test("data tools answer from the app's numbers; a refusal gets a friendly reply", async () => {
  const { client, seen } = fakeClient([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "a", name: "get_earn", input: {} }] as Anthropic.Beta.BetaContentBlock[] },
    { content: [{ type: "text", text: "SLP pays about 22% APR today." }] as Anthropic.Beta.BetaContentBlock[] },
  ]);
  const out = await copilotReply(client, [{ role: "user", text: "what does earn pay?" }], ctx, data);
  assert.equal(out.proposal, null);
  const result = ((seen[1].messages as { content: unknown }[]).at(-1)!.content as { content: string }[])[0].content;
  assert.match(result, /0\.22/);

  const refused = fakeClient([{ stop_reason: "refusal", content: [] }]);
  const r = await copilotReply(refused.client, [{ role: "user", text: "..." }], ctx, data);
  assert.match(r.reply, /can't help/);
});

test("history is trimmed to plain text turns that start with the user", async () => {
  const { client, seen } = fakeClient([{ content: [{ type: "text", text: "Hi!" }] as Anthropic.Beta.BetaContentBlock[] }]);
  await copilotReply(client, [{ role: "assistant", text: "Hi! I set up and tune your bot." }, { role: "user", text: "x".repeat(5000) }], ctx, data);
  const msgs = seen[0].messages as { role: string; content: string }[];
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[0].content.length, 1200);
  await assert.rejects(copilotReply(client, [{ role: "assistant", text: "hello" }], ctx, data), /Send a message first/);
});

test("a Start button on a running bot is refused, so the model proposes the stop target instead", async () => {
  const { client, seen } = fakeClient([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "a", name: "propose_action", input: { action: "start" } }] as Anthropic.Beta.BetaContentBlock[] },
    {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "b", name: "propose_rules", input: { ...defaultRules(1000), stopAtLossUsd: 1.2 } }] as Anthropic.Beta.BetaContentBlock[],
    },
    { content: [{ type: "text", text: "Got it: the bot keeps running and stops itself at −$1.20." }] as Anthropic.Beta.BetaContentBlock[] },
  ]);
  const out = await copilotReply(client, [{ role: "user", text: "when im down 1.2$ can you stop the bot?" }], { ...ctx, mode: "on" }, data);
  assert.equal(out.action, null);
  assert.equal(out.proposal?.stopAtLossUsd, 1.2);
  const refusal = ((seen[1].messages as { content: unknown }[]).at(-1)!.content as { content: string; is_error?: boolean }[])[0];
  assert.equal(refusal.is_error, true);
  assert.match(refusal.content, /already running/);
});
