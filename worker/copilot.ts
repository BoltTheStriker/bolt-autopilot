// Bolt Copilot: Claude helps a user pick and tune their Autopilot rules. It can look at the
// bot's current trader list and the Earn (SLP) numbers, and propose rules - but it never
// changes anything itself: a proposal comes back to the app, where the user taps Apply.
import Anthropic from "@anthropic-ai/sdk";
import { describeRules, RISK_LEVELS, sanitizeRules, type AutoRules } from "./autopilot.ts";

export const COPILOT_MODEL = "claude-opus-5-5";
const MAX_STEPS = 5; // tool round-trips per reply
const MAX_HISTORY = 16; // messages of chat history sent back
const MAX_CHARS = 1_200; // per message

export type ChatTurn = { role: "user" | "assistant"; text: string };
export type CopilotContext = {
  demo: boolean;
  rules: AutoRules | null;
  maxBudgetUsd: number;
  balance: number | null;
  copies: { lead: string; amount: number; pnl: number }[];
};
export type CopilotData = {
  traders: () => unknown; // the bot's ranked traders, as the demo sees them
  earn: () => Promise<unknown>; // SLP vault numbers
};
export type CopilotReply = { reply: string; proposal: AutoRules | null; proposalText: string | null };

const levels = Object.entries(RISK_LEVELS)
  .map(([k, v]) => `${k}: ${Math.round(v.deploy * 100)}% of the budget working, leverage cap up to ${v.maxLeverage}x, stop-loss per copy up to −${Math.round(v.stopLossPct * 100)}%, daily loss limit up to −${Math.round(v.dailyLossPct * 100)}%, ${v.multiplier}× sizing`)
  .join("\n");

// Stable across requests (cached): who the copilot is and the facts it may rely on.
const SYSTEM = `You are Bolt Copilot, the assistant inside Bolt Autopilot. Autopilot copies top traders on Strike Finance (a perpetuals exchange on Cardano) for the user, inside rules the user sets. You help people choose and tune those rules, and you explain what the bot does in plain words.

How Autopilot works:
- The user picks risk (low, medium, high), a goal (steady: the calmest of the good traders; balanced: the best return for each unit of risk; growth: good traders with more upside, bigger swings), markets (all; crypto only; real-world only: stocks, indices, gold, oil), a budget and how many traders to copy (1-6).
- Risk levels set the ceilings for the limits:
${levels}
- Each copy runs from the user's own Strike account, with its stop-loss and leverage cap set on Strike. If the whole bot loses its daily limit in a day, copying pauses until the next day. Profit lock (optional) banks a copy's gain at a set percentage and then copies that trader again.
- Two ways to run: "Follow my rules" (the bot copies its best picks for the rules and keeps them while they stay in its ranking) or "Autopilot" (Bolt's AI also looks after the setup: it can stop copying a trader who left the ranking or is failing with a poor week, step risk down after losses near the daily limit, and step back to the user's own settings on a calm day). Autopilot never goes beyond the user's own settings (risk, budget, leverage, stop-loss, daily limit, markets) and never touches withdrawals; every change it makes appears in the activity feed with the reason. Switching back to "Follow my rules" undoes its changes.
- Money stays in the user's own Strike account. The bot's key can trade but never withdraw.
- Earn: money the bot isn't using can sit in Strike's SLP vault (Strike's market-making vault; APR is variable and SLP can lose money). Strike's Borrow & Earn accepts RealFi's sUSDrf (a yield-bearing dollar) as collateral and puts the credit into SLP, so the same dollars earn sUSDrf's yield plus SLP's returns. sUSDrf takes losses first if RealFi's loans go bad, and moving USDrf into sUSDrf has a 7-day cooldown. With Borrow & Earn the debt is in USD and Strike can redeem SLP shares or convert collateral if the line becomes unhealthy. Vault deposits happen on Strike's own site.
- Bolt is a community project built on Strike's public tools; it is not made or endorsed by Strike or RealFi.

Getting started and your money (answer these plainly):
- No Cardano wallet yet: install one as a browser extension (Eternl, Lace or Vespr are popular), create it, keep the recovery phrase safe and offline, add some ADA, then come back and connect. You can try the demo with no wallet at all.
- Connecting: one free signature (no transaction, no fee) opens the user's own account on Strike Finance through Strike's builder program, or links the Strike account they already have. They can see it on Strike's own site too.
- Depositing: ADA from their wallet goes straight into their own Strike account in one transaction; Strike converts it to trading balance, usually within 2 to 10 minutes (the app shows it as "on its way"). Bolt never holds the money.
- Withdrawing: from the dashboard, only to the wallet registered on the account and only with that wallet's signature; nobody else can withdraw. Money in running copies comes back to the balance when they stop.
- Sizes: each copy needs at least $50, and a copy can only follow a trader's trades well when it's big enough; about $100 is a sensible start, and $300 to $500 with two traders gives a better choice of traders.
- Fees: Strike's normal trading fees apply; Bolt adds no fee during the beta.
- The demo uses $1,000 of pretend money and the bot's real, current picks, moving with those traders' live trading from the moment it starts.
- Disconnect (the wallet menu, top right) signs out of this browser only; the bot keeps running on Strike until the user stops it.

How to help:
- When the user wants a change, or describes a goal you can turn into rules, call propose_rules with the complete rule set. The app shows your proposal with an Apply button; nothing changes until the user taps it. Say what you proposed in a sentence or two; don't claim it's already applied.
- Use get_traders when the user asks about the traders or why the bot picked them, and get_earn for Earn questions. Quote numbers from the tools, never invent them.
- Be honest about risk: copy trading can lose money, limits cut losses but can't prevent them, and past results don't promise future ones. Never promise or predict returns.
- Keep replies short (under about 120 words), friendly and concrete. Plain text: no markdown headings or tables; a short dash list is fine.
- If someone asks for something outside Autopilot, Earn or how they work, say briefly what you can help with.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "propose_rules",
    description:
      "Propose a complete rule set for the user's bot. It is shown to the user with an Apply button and changes nothing by itself. Values above the risk level's ceilings, or the beta budget limit, are clamped; the result tells you what was proposed.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        risk: { type: "string", enum: ["low", "medium", "high"] },
        goal: { type: "string", enum: ["steady", "balanced", "growth"] },
        markets: { type: "string", enum: ["all", "crypto", "realworld"] },
        traders: { type: "integer", description: "How many traders to copy, 1-6" },
        budgetUsd: { type: "number", description: "Budget in USD for the bot" },
        maxLeverage: { type: "integer", description: "Leverage cap per trade" },
        stopLossPct: { type: "number", description: "Stop each copy at this loss, as a fraction (0.1 = −10%)" },
        dailyLossPct: { type: "number", description: "Pause for the day at this total loss, as a fraction" },
        profitLockPct: { type: ["number", "null"], description: "Bank a copy's gain at this fraction (0.15 = +15%), or null for no profit lock" },
      },
      required: ["risk", "goal", "markets", "traders", "budgetUsd", "maxLeverage", "stopLossPct", "dailyLossPct", "profitLockPct"],
      additionalProperties: false,
    },
  },
  {
    name: "get_traders",
    description: "The bot's current ranked traders: score (risk-adjusted, 0-1), 30-day drawdown and return, 7-day return, share of real-world markets, and what they hold right now.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "get_earn",
    description: "Live numbers for Strike's SLP vault (Earn): APR today, money in the vault, lockup, minimum deposit, fee.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

function contextNote(c: CopilotContext): string {
  const lines = [
    `Mode: ${c.demo ? "demo ($1,000 of pretend money)" : "real Strike account"}. Budget limit: $${c.maxBudgetUsd}.`,
    c.rules ? `Current rules: ${describeRules(c.rules)}.` : "No rules set yet.",
  ];
  if (c.balance !== null) lines.push(`Balance: $${c.balance.toFixed(2)}.`);
  if (c.copies.length) lines.push(`Copies: ${c.copies.map((x) => `${x.lead} $${x.amount.toFixed(0)} (${x.pnl >= 0 ? "+" : "−"}$${Math.abs(x.pnl).toFixed(2)})`).join(", ")}.`);
  return lines.join(" ");
}

/** One copilot reply: runs Claude with the tools until it answers (bounded). */
export async function copilotReply(client: Anthropic, history: ChatTurn[], ctx: CopilotContext, data: CopilotData): Promise<CopilotReply> {
  const turns = history
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.trim())
    .slice(-MAX_HISTORY)
    .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_CHARS) }));
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns.at(-1)!.role !== "user") throw new Error("Send a message first.");

  // Earlier turns go back as plain text; the app's state rides along as a system note at the end.
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...turns.map((t) => ({ role: t.role, content: t.text })),
    { role: "system", content: `App state right now: ${contextNote(ctx)}` },
  ];

  let proposal: AutoRules | null = null;
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.beta.messages.create({
      model: COPILOT_MODEL,
      max_tokens: 4_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // a declined request is retried server-side on Anthropic's recommended model
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    if (res.stop_reason === "refusal") return { reply: "Sorry, I can't help with that one. Ask me about your rules, the traders, or Earn.", proposal: null, proposalText: null };

    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      return { reply: text || "Done.", proposal, proposalText: proposal ? describeRules(proposal) : null };
    }

    // Append the turn unchanged (thinking blocks included), then all tool results in one message.
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      try {
        if (call.name === "propose_rules") {
          const next = sanitizeRules(call.input, ctx.maxBudgetUsd);
          if (!next) throw new Error("Those rules aren't valid. Check the values and try again.");
          proposal = next;
          results.push({ type: "tool_result", tool_use_id: call.id, content: `Proposed to the user (not applied until they tap Apply): ${describeRules(next)}.` });
        } else if (call.name === "get_traders") {
          results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(data.traders()) });
        } else if (call.name === "get_earn") {
          results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(await data.earn()) });
        } else {
          throw new Error(`Unknown tool ${call.name}`);
        }
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: call.id, content: e instanceof Error ? e.message : String(e), is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: "I need a moment on that one. Could you ask again in fewer words?", proposal, proposalText: proposal ? describeRules(proposal) : null };
}
