"use client";

import Link from "next/link";
import { combinedTrackRecord } from "@/lib/trackRecord";
import { useBotState } from "@/lib/useBotState";
import { AreaChart } from "./AreaChart";

const pct = (f: number) => `${f >= 0 ? "+" : "−"}${Math.abs(f * 100).toFixed(1)}%`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** "What copying Bolt's traders returned over the last 30 days": real, public, past data. */
export function TrackRecord({ compact = false, botLink = !compact }: { compact?: boolean; botLink?: boolean }) {
  const bot = useBotState();
  const tr = combinedTrackRecord(bot?.lastScan);
  if (!tr) return null;
  const tenK = 10_000 * (1 + tr.total);
  const series = tr.curve.map((p) => ({
    label: new Date(p.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    value: 10_000 * (1 + p.value),
    reference: 10_000,
  }));

  return (
    <div className={`card relative overflow-hidden rounded-3xl ${compact ? "p-5 sm:p-6" : "p-6 sm:p-9"}`}>
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-mint/15 blur-[100px]" />
      <div className={`relative grid gap-8 ${compact ? "" : "lg:grid-cols-[0.9fr_1.1fr] lg:items-center"}`}>
        <div>
          <p className="font-mono text-xs tracking-[0.25em] text-mint uppercase">Track record · last 30 days</p>
          <p className={`mt-3 font-display font-bold tracking-tight ${tr.total >= 0 ? "text-gradient" : "text-neg"} ${compact ? "text-5xl" : "text-[clamp(3.5rem,9vw,6rem)] leading-none"}`}>
            {pct(tr.total)}
          </p>
          <p className="mt-3 max-w-md text-lg leading-relaxed text-soft">
            What copying the {tr.leads.length} traders Bolt follows returned over their last 30 days.
          </p>
          <p className="mt-4 font-mono text-sm text-white/70">
            $10,000 → <span className={tr.total >= 0 ? "text-mint" : "text-neg"}>${tenK.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {tr.leads.map((l) => (
              <a
                key={l.lead}
                href={`https://app.hyperliquid.xyz/explorer/address/${l.lead}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[11px] text-soft transition hover:border-mint/40 hover:text-white"
              >
                {short(l.lead)} <span className={l.roi30d >= 0 ? "text-mint" : "text-neg"}>{pct(l.roi30d)}</span>
              </a>
            ))}
          </div>
        </div>
        <div>
          <AreaChart data={series} color="#1fa874" valueName="$10,000 copied" referenceName="Start" format="usdWhole" zeroBased={false} height={compact ? 200 : 260} />
          <p className="mt-3 text-[11px] leading-relaxed text-white/40">
            Built from each trader&apos;s public 30-day results on Strike, counting only the trades Strike can copy at Bolt&apos;s size. It&apos;s the
            traders&apos; past performance, not a guarantee and not the bot&apos;s own live result.{" "}
            {botLink && (
              <Link href="/app/bot" className="text-mint hover:underline">
                See the live bot →
              </Link>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
