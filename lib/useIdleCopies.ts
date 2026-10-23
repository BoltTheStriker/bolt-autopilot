"use client";

// Copies whose trader isn't in a trade: a copy only follows new trades, so its money waits until the trader opens one.
// Right after Start every copy is like that, so a copy counts as idle once it's had no open trade for a while
// (30 minutes; 2 in the demo). When each copy went quiet is kept per browser, so a reload doesn't reset it.
import { useEffect, useState } from "react";

const KEY = "bolt-autopilot-idle";
const OK_KEY = "bolt-autopilot-idle-ok"; // "Keep waiting": lowercased lead → when (asked again after a day)
const DAY = 86_400_000;

/** "Keep waiting" on a quiet trader: don't ask about them again for a day. */
export function keepWaiting(lead: string) {
  try {
    const ok = JSON.parse(localStorage.getItem(OK_KEY) ?? "{}") as Record<string, number>;
    ok[lead.toLowerCase()] = Date.now();
    localStorage.setItem(OK_KEY, JSON.stringify(ok));
  } catch {
    // private mode: it may ask again after a reload
  }
}

type Since = Record<string, number>; // lowercased lead → first seen with no open trade

function load(): Since {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Since;
  } catch {
    return {};
  }
}

export function useIdleCopies(copies: { lead: string; positions: unknown[]; stopped?: boolean }[], running: boolean, demo: boolean): string[] {
  const [due, setDue] = useState<string[]>([]);
  const quiet = running ? copies.filter((c) => !c.stopped && c.positions.length === 0).map((c) => c.lead) : [];
  const quietKey = quiet.join(",");
  useEffect(() => {
    const leads = quietKey ? quietKey.split(",") : [];
    const wait = demo ? 2 * 60_000 : 30 * 60_000;
    const tick = () => {
      // Not loaded or not running: leave the saved timers alone (pruning now would restart them on every reload).
      if (!running) return setDue((d) => (d.length ? [] : d));
      const now = Date.now();
      const prev = load();
      const next: Since = {};
      for (const l of leads) next[l.toLowerCase()] = prev[l.toLowerCase()] ?? now;
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // private mode: the timing just starts over on reload
      }
      let ok: Record<string, number> = {};
      try {
        ok = JSON.parse(localStorage.getItem(OK_KEY) ?? "{}") as Record<string, number>;
      } catch {
        ok = {};
      }
      const ready = leads.filter((l) => now - next[l.toLowerCase()] >= wait && !(now - (ok[l.toLowerCase()] ?? 0) < DAY));
      setDue((d) => (d.join(",") === ready.join(",") ? d : ready));
    };
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [quietKey, demo, running]);
  return due;
}
