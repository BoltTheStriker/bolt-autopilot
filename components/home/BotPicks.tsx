"use client";

import { useBotState } from "@/lib/useBotState";

/** The bot's current three picks, live from the worker. */
export function BotPicks() {
  const picks = (useBotState()?.positions ?? []).slice(0, 3);
  return (
    <div className="w-full max-w-[270px] space-y-2">
      {(picks.length ? picks : [null, null, null]).map((p, i) => (
        <div key={p?.lead ?? i} className="flex items-center gap-3 rounded-xl border border-white/8 bg-ink/60 px-3 py-2">
          <span className="grid size-6 place-items-center rounded-full bg-mint/12 font-mono text-[10px] text-mint">{i + 1}</span>
          <span className="font-mono text-xs text-soft">{p ? `${p.lead.slice(0, 6)}…${p.lead.slice(-4)}` : "ranking…"}</span>
          <span className="ml-auto h-1.5 w-16 overflow-hidden rounded-full bg-white/8">
            <span className="block h-full rounded-full bg-mint" style={{ width: `${Math.round((p?.score ?? 0.5) * 100)}%` }} />
          </span>
        </div>
      ))}
      <p className="pt-1 text-center font-mono text-[10px] text-gold/80 uppercase">live picks · simulation</p>
    </div>
  );
}
