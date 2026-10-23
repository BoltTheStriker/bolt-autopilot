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
  mode?: "off" | "on" | "autopilot" | null; // the bot right now
  sinceStart?: number | null; // profit since the user pressed Start (copies that ended included)
  today?: number | null; // profit today (UTC)
};
/** What the user can do in one tap from a copilot message (the app asks nothing more). */
export type CopilotAction = "start" | "stop" | "autopilot" | "follow_rules";
export type CopilotData = {
  traders: () => unknown; // the bot's ranked traders, as the demo sees them
  earn: () => Promise<unknown>; // SLP vault numbers
};
export type CopilotReply = { reply: string; proposal: AutoRules | null; proposalText: string | null; action?: CopilotAction | null };

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
- Stop targets (optional, in dollars, for the whole bot since the user pressed Start): "stop at profit" stops every copy and switches the bot off once the total profit reaches the amount ("when I'm up $20, stop"); "stop at loss" does the same once the total loss reaches the amount ("if I lose $30 in total, stop everything"). Copies that already ended count toward the total. The server checks about every 2 minutes and stopping closes copies at market, so the final result can land a little above or below the target. The bot stays off until the user starts it again. Autopilot never changes these targets.
- More things the user can ask for, all rules (shown with Apply like any proposal):
  - boost: copy size against the trader's, 1x to 3x (low risk allows 1x, medium up to 2x, high up to 3x). 2x means the copy trades twice the trader's size relative to its money: gains and losses both double, and the stop-loss still caps each copy. This is different from the leverage cap (maxLeverage), which limits the leverage of each copied trade. null keeps the risk level's default.
  - dailyProfitUsd: "when I make $10 a day, stop for the day": once today's profit reaches it, every copy closes and copying picks up again tomorrow (UTC).
  - pauseUntil: "pause until Monday", "pause for 6 hours": an ISO 8601 UTC time (work it out from "Now" in the app state). Copies close now and the bot picks up again by itself at that time. null = not paused (use it to resume early).
  - weekdaysOnly: "don't trade on weekends": copies close for Saturday and Sunday (UTC) and the bot picks up again on Monday.
  - avoid: traders never to copy ("never copy that one again"), as their addresses exactly as the app state shows them. The bot stops any copy of them and picks someone else. Keep the ones already in the list unless the user asks to remove them.
- Actions (call propose_action; the app shows one button, nothing happens until the user taps it): "stop the bot" / "close everything" → stop (every copy closes at market); "start" / "turn it back on" → start; "switch to Autopilot" → autopilot; "back to my own rules" → follow_rules. Use these for switching, not propose_rules.
- "How am I doing?": answer from the app state (profit since Start, today, each copy's profit, the best and the worst), in plain numbers. Never guess numbers that aren't there.
- Two ways to run: "Follow my rules" (the bot copies its best picks for the rules and keeps them while they stay in its ranking) or "Autopilot" (Bolt's AI also looks after the setup: it can stop copying a trader who left the ranking or is failing with a poor week, step risk down after losses near the daily limit, and step back to the user's own settings on a calm day). Autopilot never goes beyond the user's own settings (risk, budget, leverage, stop-loss, daily limit, markets) and never touches withdrawals; every change it makes appears in the activity feed with the reason. Switching back to "Follow my rules" undoes its changes.
- Rule changes apply to new copies. A copy that's already running keeps the settings it started with (its size, boost, stop-loss and leverage) until the bot replaces it, or the user stops and starts the bot. When someone changes those while copies are running, say so in one sentence and that stopping and starting applies it now. Targets, pauses, the schedule and blocked traders apply right away.
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
- Keep everything the user didn't ask to change as it is in their current rules. Only if your proposal changes anything else, or the tool result shows a value was clamped (for example to the risk level's ceiling), say so in one short sentence.
- Talk like a person, not a form: react to what they said in their words (for example "Got it: once you're $20 up, the bot stops and banks it"), then the proposal.
- Use get_traders when the user asks about the traders or why the bot picked them, and get_earn for Earn questions. Quote numbers from the tools, never invent them.
- Be honest about risk: copy trading can lose money, limits cut losses but can't prevent them, and past results don't promise future ones. Never promise or predict returns.
- Keep replies short: 2 to 4 sentences, under about 70 words. Say what you proposed or the answer first, then at most one caveat that matters. Don't repeat rules that didn't change, don't list every copy unless asked, and don't restate numbers the user can already see unless they explain the point.
- Plain text only: no markdown, no bold or asterisks, no headings. Use a short dash list only when the user asked for several items (like "how am I doing").
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
        boost: { type: ["integer", "null"], description: "Copy size against the trader's, 1-3 (capped by risk level), or null for the risk level's default" },
        dailyProfitUsd: { type: ["number", "null"], description: "Stop for the day once today's profit reaches this many dollars, or null for none" },
        pauseUntil: { type: ["string", "null"], description: "Pause copying until this ISO 8601 UTC time, or null for not paused" },
        weekdaysOnly: { type: "boolean", description: "No copies on Saturdays and Sundays (UTC)" },
        avoid: { type: "array", items: { type: "string" }, description: "Trader addresses never to copy, as the app shows them" },
        stopAtProfitUsd: { type: ["number", "null"], description: "Stop the whole bot once its total profit since Start reaches this many dollars, or null for none" },
        stopAtLossUsd: { type: ["number", "null"], description: "Stop the whole bot once its total loss since Start reaches this many dollars, or null for none" },
      },
      required: ["risk", "goal", "markets", "traders", "budgetUsd", "maxLeverage", "stopLossPct", "dailyLossPct", "profitLockPct", "stopAtProfitUsd", "stopAtLossUsd", "boost", "dailyProfitUsd", "pauseUntil", "weekdaysOnly", "avoid"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_action",
    description: "Offer the user a one-tap action on their bot: start it, stop it (every copy closes at market), switch to Autopilot, or back to following their own rules. Shown as a button; nothing happens until they tap it.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { action: { type: "string", enum: ["start", "stop", "autopilot", "follow_rules"] } },
      required: ["action"],
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

const money = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;

function contextNote(c: CopilotContext): string {
  const lines = [
    `Now: ${new Date().toISOString()}.`,
    `Mode: ${c.demo ? "demo ($1,000 of pretend money)" : "real Strike account"}. Budget limit: $${c.maxBudgetUsd}.`,
    c.mode ? `The bot is ${c.mode === "off" ? "off" : c.mode === "autopilot" ? "running in Autopilot" : "running, following the user's rules"}.` : "",
    c.sinceStart !== null && c.sinceStart !== undefined ? `Profit since Start: ${money(c.sinceStart)}.` : "",
    c.today !== null && c.today !== undefined ? `Profit today: ${money(c.today)}.` : "",
    c.rules ? `Current rules: ${describeRules(c.rules)}.` : "No rules set yet.",
    c.rules?.avoid?.length ? `Blocked traders (keep them in avoid): ${c.rules.avoid.join(", ")}.` : "",
  ];
  if (c.balance !== null) lines.push(`Balance: $${c.balance.toFixed(2)}.`);
  if (c.copies.length) lines.push(`Copies: ${c.copies.map((x) => `${x.lead} $${x.amount.toFixed(0)} (${money(x.pnl)})`).join(", ")}.`);
  return lines.filter(Boolean).join(" ");
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
  let action: CopilotAction | null = null;
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
    if (res.stop_reason === "refusal") return { reply: "Sorry, I can't help with that one. Ask me about your rules, the traders, or Earn.", proposal: null, proposalText: null, action: null };

    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      // Plain text in the chat bubble: drop any markdown emphasis the model still adds.
      return { reply: (text || "Done.").replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|\s)\*(\S.*?\S)\*(?=\s|[.,!?]|$)/g, "$1$2"), proposal, proposalText: proposal ? describeRules(proposal) : null, action };
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
          // Values the checks changed (a risk level's ceiling, the budget limit), so the reply can say so.
          const asked = call.input as Record<string, unknown>;
          const clamped = (["budgetUsd", "traders", "maxLeverage", "stopLossPct", "dailyLossPct", "stopAtLossUsd", "boost"] as const)
            .filter((k) => asked[k] !== null && asked[k] !== undefined && Number(asked[k]) !== next[k])
            .map((k) => `${k} ${String(asked[k])} → ${String(next[k])}`);
          const note = clamped.length ? ` Clamped to the limits: ${clamped.join(", ")}.` : "";
          results.push({ type: "tool_result", tool_use_id: call.id, content: `Proposed to the user (not applied until they tap Apply): ${describeRules(next)}.${note}` });
        } else if (call.name === "propose_action") {
          const a = (call.input as { action?: string }).action;
          if (a !== "start" && a !== "stop" && a !== "autopilot" && a !== "follow_rules") throw new Error("Unknown action.");
          action = a;
          results.push({ type: "tool_result", tool_use_id: call.id, content: `Shown to the user as a button (nothing happens until they tap it): ${a}.` });
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
  return { reply: "I need a moment on that one. Could you ask again in fewer words?", proposal, proposalText: proposal ? describeRules(proposal) : null, action };
}
