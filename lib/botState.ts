import "server-only";
import { cacheLife } from "next/cache";
import seed from "@/data/bot-state.json";
import type { BotState } from "@/bot/strategy";
import { site } from "./config";

/** Latest bot state from the Railway worker, falling back to the repo snapshot if it's unreachable. */
export async function getBotState(): Promise<BotState | null> {
  "use cache";
  cacheLife("seconds");
  try {
    const res = await fetch(`${site.botApi}/state`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return (await res.json()) as BotState;
  } catch {}
  return seed as unknown as BotState | null;
}
