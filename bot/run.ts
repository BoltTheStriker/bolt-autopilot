// One bot cycle: fetch Strike's public data, decide, save state.
//   node --experimental-strip-types bot/run.ts
// Run every few hours by .github/workflows/copy-bot.yml.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { bot } from "./config.ts";
import { entryRejection, equityOf, initialState, short, step, type BotState, type Lead } from "./strategy.ts";

const STATE = new URL("../data/bot-state.json", import.meta.url);
const API = "https://api.strikefinance.org";

if (bot.mode !== "simulate") {
  // Deliberate hard stop: live copying needs an API wallet scoped to one sub-account,
  // signing code and its own review. None of that exists yet.
  throw new Error("Live mode is not implemented. Keep bot.mode = \"simulate\".");
}

async function get<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API + path, { headers: { accept: "application/json" } }).catch(() => null);
    if (res?.ok) return (await res.json()) as T;
    if (res?.status === 404) return null;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`Strike API unreachable: ${path}`);
}

const now = Date.now();
const state: BotState = existsSync(STATE) && readFileSync(STATE, "utf8").trim() !== "null"
  ? JSON.parse(readFileSync(STATE, "utf8"))
  : initialState(bot, now);

// Candidates: Strike's own copy-score ranking, prefiltered server-side; every rule is re-checked locally.
const q = new URLSearchParams({
  platform: bot.entry.platform,
  min_copy_score: String(bot.entry.minCopyScore),
  sort: "copy_score",
  order: "desc",
  enriched_only: "true",
  limit: "100",
});
const discover = await get<{ items?: Lead[]; data_as_of_ms?: number }>(`/v2/copy/discover?${q}`);
const candidates = discover?.items ?? [];

// Fresh profiles for leads we hold, because they may have dropped out of the top 100.
const held = new Map<string, Lead | undefined>();
for (const p of state.positions) {
  held.set(p.lead, candidates.find((c) => c.address === p.lead) ?? (await get<Lead>(`/v2/copy/discover/${p.lead}`)) ?? undefined);
}

const next = step(state, candidates, held, bot, now);
writeFileSync(STATE, JSON.stringify(next, null, 1) + "\n");

const fresh = next.decisions.filter((d) => d.at === now);
console.log(`Candidates: ${candidates.length} · holding ${next.positions.length}/${bot.maxLeads} · equity $${equityOf(next).toFixed(2)}`);
for (const p of next.positions) console.log(`  ${short(p.lead)}  $${p.cost.toFixed(0)} → $${p.value.toFixed(2)}`);
for (const d of fresh) console.log(`  [${d.action}] ${d.detail}`);

// Why the rest were passed over, so the rules can be tuned from the Action log.
const slot = equityOf(next) / bot.maxLeads;
const why: Record<string, number> = {};
for (const c of candidates) {
  const r = entryRejection(c, bot, slot, now) ?? "eligible";
  why[r] = (why[r] ?? 0) + 1;
}
console.log("Candidate screen:", why);
