"use client";

import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
import { simulatedCopyTrade } from "./botSnapshot";
import type { CoinSnapshot } from "./solada";
import { useBotState } from "./useBotState";

// One poller shared by every component on the page. Market/reward data refreshes every
// 30s (the API caches it for a minute anyway). While the copy-trade panel shows the bot's
// simulation, those numbers come from the live bot feed instead (every 10s).
const POLL_MS = 30_000;
let current: CoinSnapshot | null = null;
const listeners = new Set<(c: CoinSnapshot | null) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function poll() {
  try {
    const res = await fetch("/api/coin", { cache: "no-store" });
    if (!res.ok) return;
    current = (await res.json()) as CoinSnapshot;
    for (const l of listeners) l(current);
  } catch {}
}

// Server-rendered snapshot, so the first paint already has numbers (polling takes over after).
const SeedContext = createContext<CoinSnapshot | null>(null);
export function CoinSeed({ coin, children }: { coin: CoinSnapshot | null; children: React.ReactNode }) {
  return createElement(SeedContext.Provider, { value: coin }, children);
}

export function useCoin() {
  const seed = useContext(SeedContext);
  const [coin, setCoin] = useState(() => current ?? seed);
  const bot = useBotState();
  useEffect(() => {
    listeners.add(setCoin);
    if (!timer) {
      poll();
      timer = setInterval(poll, POLL_MS);
    }
    return () => {
      listeners.delete(setCoin);
      if (!listeners.size && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return useMemo(() => {
    if (!coin || coin.copyTrade?.source !== "simulation") return coin;
    return { ...coin, copyTrade: simulatedCopyTrade(bot) };
  }, [coin, bot]);
}
