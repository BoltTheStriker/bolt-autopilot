"use client";

import { fmtPct } from "@/lib/format";
import { combinedTrackRecord } from "@/lib/trackRecord";
import { useBotState } from "@/lib/useBotState";
import { useCoin } from "@/lib/useCoin";
import { FloatCard } from "./FloatCard";

/** Hero float card: the real account's return once live; before that, the copied traders' 30-day record. */
export function CopyTradeCard({ className }: { className: string }) {
  const ct = useCoin()?.copyTrade;
  const tr = combinedTrackRecord(useBotState()?.lastScan);
  const real = ct?.source === "strike" && ct.found;
  const value = real ? ct.roiPct : tr ? tr.total * 100 : null;
  return (
    <FloatCard
      className={className}
      icon={
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#4efab0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 14l4.5-4.5 3 3L17 6" /><path d="M12.5 6H17v4.5" />
        </svg>
      }
      sub={real ? "Strike copy-trade · total return" : "Traders Bolt copies · last 30d"}
      title={real ? "Copy-trade account" : `Copying ${tr?.leads.length ?? 5} traders`}
      value={value === null ? "…" : fmtPct(value)}
      valueClass={value !== null && value < 0 ? "text-neg" : "text-mint"}
    />
  );
}
