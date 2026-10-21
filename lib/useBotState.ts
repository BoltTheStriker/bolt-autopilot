"use client";

import { useEffect, useState } from "react";
import seed from "@/data/bot-state.json";
import type { BotState } from "@/bot/strategy";
import { site } from "./config";

// One poller shared by every component on the page. Starts from the repo snapshot so the
// first paint is never empty, then follows the Railway worker live.
const POLL_MS = 10_000;
let current = seed as unknown as BotState | null;
const listeners = new Set<(s: BotState | null) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function poll() {
  try {
    const res = await fetch(`${site.botApi}/state`, { cache: "no-store" });
    if (!res.ok) return;
    current = (await res.json()) as BotState;
    for (const l of listeners) l(current);
  } catch {}
}

export function useBotState() {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    if (!timer) {
      poll();
      timer = setInterval(poll, POLL_MS);
    }
    return () => {
      listeners.delete(setState);
      if (!listeners.size && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return state;
}
