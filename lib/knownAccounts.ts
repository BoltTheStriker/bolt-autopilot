"use client";

// Wallet accounts this browser has used Bolt with, so connecting a different account of the same wallet (Eternl, Lace
// and Vespr hold several) doesn't look like a fresh start: the app can point to the account that has the dashboard.
import { useSyncExternalStore } from "react";

const KEY = "bolt-autopilot-accounts";
const EVENT = "bolt:accounts";
export type KnownAccount = { address: string; at: number; setUp: boolean };

let cache = { raw: "", list: [] as KnownAccount[] };
function snapshot(): KnownAccount[] {
  let raw = "[]";
  try {
    raw = localStorage.getItem(KEY) ?? "[]";
  } catch {
    raw = "[]";
  }
  if (raw !== cache.raw) {
    try {
      cache = { raw, list: JSON.parse(raw) as KnownAccount[] };
    } catch {
      cache = { raw, list: [] };
    }
  }
  return cache.list;
}
const EMPTY: KnownAccount[] = [];

export function useKnownAccounts(): KnownAccount[] {
  return useSyncExternalStore(
    (on) => {
      window.addEventListener(EVENT, on);
      return () => window.removeEventListener(EVENT, on);
    },
    snapshot,
    () => EMPTY,
  );
}

/** Note that this browser used Bolt with `address` (setUp: it has rules or has run). */
export function rememberAccount(address: string, setUp: boolean) {
  const list = snapshot();
  const prev = list.find((a) => a.address === address);
  if (prev && prev.setUp === setUp) return;
  const next = [{ address, at: Date.now(), setUp: setUp || !!prev?.setUp }, ...list.filter((a) => a.address !== address)].slice(0, 10);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}
