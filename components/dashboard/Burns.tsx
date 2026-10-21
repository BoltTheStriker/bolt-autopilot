"use client";

import { explorer, site } from "@/lib/config";
import { fmt, fmtCompact, shortHash } from "@/lib/format";
import { useCoin } from "@/lib/useCoin";
import { Flame } from "../ui";

const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Total burned: $BOLT held at the burn address, live from the chain. */
export function BurnedTile() {
  const coin = useCoin();
  const burned = coin?.burned ?? 0;
  const spent = (coin?.burns ?? []).reduce((s, b) => s + (b.ada ?? 0), 0);
  return (
    <div className="card flex flex-col justify-between rounded-3xl p-5 sm:col-span-2 sm:p-6">
      <p className="flex items-center gap-2 text-sm text-muted"><Flame /> ${site.ticker} burned</p>
      <div>
        <p className="mt-6 font-display text-4xl font-bold tracking-tight">{coin ? fmtCompact(burned) : "…"}</p>
        <p className="mt-1 font-mono text-xs text-white/40">
          {((burned / site.token.totalSupply) * 100).toFixed(2)}% of supply{spent > 0 ? ` · ₳${fmt(spent)} of profit spent` : ""} ·{" "}
          <a href={explorer.address(site.burnAddress)} target="_blank" rel="noreferrer" className="text-mint hover:underline">burn address</a>
        </p>
      </div>
    </div>
  );
}

/** Every burn, one row per transaction to the burn address. */
export function BurnsTable() {
  const burns = useCoin()?.burns ?? [];
  if (!burns.length)
    return <div className="mt-4 grid h-40 place-items-center rounded-2xl border border-dashed border-white/10 text-center text-sm text-muted">No burns yet.</div>;
  return (
    <div className="mt-4 max-h-[400px] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[#171717]">
          <tr className="text-left text-xs text-muted">
            <th className="py-2 font-normal">Date</th>
            <th className="py-2 text-right font-normal">${site.ticker}</th>
            <th className="py-2 text-right font-normal">% supply</th>
            <th className="py-2 text-right font-normal">Tx</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {burns.map((b) => (
            <tr key={b.txHash} className="border-t border-white/6">
              <td className="py-2.5 text-soft">{day(b.at)}</td>
              <td className="py-2.5 text-right">{fmtCompact(b.amount)}</td>
              <td className="py-2.5 text-right">{((b.amount / site.token.totalSupply) * 100).toFixed(2)}%</td>
              <td className="py-2.5 text-right">
                <a href={explorer.tx(b.txHash)} target="_blank" rel="noreferrer" className="text-mint hover:underline">{shortHash(b.txHash, 4)}</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Hero float card: latest burn. */
export function BurnFloatValue() {
  const last = useCoin()?.burns?.[0];
  return <>{last ? fmtCompact(last.amount) : "Soon"}</>;
}
