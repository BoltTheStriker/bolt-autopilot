"use client";

// Text from the bot (activity, decisions, the copilot) with every trader address as a clickable name: it opens the
// trader window. Full addresses, the app's short 0x1234…abcd form and "0x1234...abcd" all count.
import { Fragment } from "react";
import { nameKey, useTraderNames } from "@/lib/traderNames";

const OPEN = "bolt:open-trader";
/** Open the trader window for this address (AutopilotApp listens). */
export const openTrader = (lead: string) => window.dispatchEvent(new CustomEvent<string>(OPEN, { detail: lead }));
export const OPEN_TRADER = OPEN;

const ADDR = /(0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{3,}(?:…|\.\.\.)[0-9a-fA-F]{3,})/g;
const shortOf = (a: string) => (a.length === 42 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a.replace("...", "…"));

/** A trader as the app names them: bold mint, clickable. */
export function TraderLink({ lead, label }: { lead: string; label?: string }) {
  const names = useTraderNames();
  const lead2 = lead.replace("...", "…");
  return (
    <button type="button" onClick={() => openTrader(lead2)} title="See this trader" className="font-semibold text-mint underline-offset-2 transition hover:underline">
      {label ?? names[nameKey(lead2)] ?? shortOf(lead2)}
    </button>
  );
}

export function TraderText({ text }: { text: string }) {
  const parts = text.split(ADDR);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <TraderLink key={i} lead={p} /> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}
