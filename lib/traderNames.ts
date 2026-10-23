"use client";

// Names users give the traders their bot copies ("Gold Guy"), kept in this browser. Keyed by the short 0x1234…abcd
// form, so the same trader matches in the demo (short addresses) and on a real account (full ones).
import { useSyncExternalStore } from "react";

const KEY = "bolt-trader-names";
const EVENT = "bolt:trader-names";

export const nameKey = (lead: string) => (lead.includes("…") ? lead : `${lead.slice(0, 6)}…${lead.slice(-4)}`).toLowerCase();

let cache = { raw: "", names: {} as Record<string, string> };
function snapshot(): Record<string, string> {
  let raw = "{}";
  try {
    raw = localStorage.getItem(KEY) ?? "{}";
  } catch {
    raw = "{}";
  }
  if (raw !== cache.raw) {
    try {
      cache = { raw, names: JSON.parse(raw) as Record<string, string> };
    } catch {
      cache = { raw, names: {} };
    }
  }
  return cache.names;
}
const EMPTY: Record<string, string> = {};

export function useTraderNames(): Record<string, string> {
  return useSyncExternalStore(
    (on) => {
      window.addEventListener(EVENT, on);
      window.addEventListener("storage", on);
      return () => {
        window.removeEventListener(EVENT, on);
        window.removeEventListener("storage", on);
      };
    },
    snapshot,
    () => EMPTY,
  );
}

/** Save (or with an empty name, clear) the name of a trader. */
export function setTraderName(lead: string, name: string) {
  const names = { ...snapshot() };
  const clean = name.trim().slice(0, 32);
  if (clean) names[nameKey(lead)] = clean;
  else delete names[nameKey(lead)];
  try {
    localStorage.setItem(KEY, JSON.stringify(names));
  } catch {
    // private mode: the name lasts until the page closes
  }
  window.dispatchEvent(new Event(EVENT));
}
