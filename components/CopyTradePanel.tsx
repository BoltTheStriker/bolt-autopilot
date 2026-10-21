"use client";

import { site } from "@/lib/config";
import { fmt, fmtCompact, fmtDate, fmtPct } from "@/lib/format";
import type { StrikeMark } from "@/lib/ledger";
import { useCoin } from "@/lib/useCoin";
import { simulatedHistory } from "@/lib/botSnapshot";
import { useBotState } from "@/lib/useBotState";
import { AreaChart } from "./AreaChart";
import { MascotIcon } from "./ui";

// Active subscriptions plus the most recent few stopped ones; already sorted active-first, newest-first.
const visibleSubs = <T extends { status: string; fills: number }>(subs: T[]) => {
  const active = subs.filter((s) => s.status === "active");
  const stopped = subs.filter((s) => s.status !== "active" && s.fills > 0);
  return [...active, ...stopped.slice(0, Math.max(0, 6 - active.length))];
};

// Exact cents below $10K so small moves stay visible; compact above.
const amount = (v: number) =>
  Math.abs(v) < 10_000 ? Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmtCompact(Math.abs(v));
const usd = (v: number) => `${v < 0 ? "−" : ""}$${amount(v)}`;
const signedUsd = (v: number) => `${v >= 0 ? "+" : "−"}$${amount(v)}`;

/** Live Strike copy-trade account: stats from Strike's public API, chart from our daily snapshots. */
export function CopyTradePanel({
  history,
  showSubscriptions = false,
}: {
  history: StrikeMark[]; // daily snapshots of the real Strike account
  showSubscriptions?: boolean;
}) {
  const bot = useBotState(); // the bot's paper equity, used while the real account doesn't exist yet
  const simHistory = simulatedHistory(bot);
  const coin = useCoin();
  const strikeCt = coin?.copyTrade;
  // While live, the bot reads the real account every 30s; Strike's public stats lag behind,
  // so account value, profit and return come from the bot's latest reading.
  // Profit = the bot account's equity minus the money moved into it (net of anything moved out), so
  // deposits, withdrawals or transfers elsewhere on the wallet (e.g. Autopilot) don't count as trading.
  const liveAcct = bot?.liveStatus?.mode === "live" ? bot.liveStatus.account : undefined;
  const netIn = liveAcct?.netIn && liveAcct.netIn > 0 ? liveAcct.netIn : (strikeCt?.deposits ?? 0);
  const ct =
    strikeCt && strikeCt.source !== "simulation" && liveAcct?.equity !== undefined && netIn > 0
      ? {
          ...strikeCt,
          equity: liveAcct.equity,
          deposits: netIn,
          totalPnl: liveAcct.equity - netIn,
          roiPct: ((liveAcct.equity - netIn) / netIn) * 100,
        }
      : strikeCt;
  // Headline: one lead by name, several as a count led by the biggest by volume.
  const actives = (ct?.subscriptions ?? []).filter((s) => s.status === "active").sort((a, b) => b.volume - a.volume);
  const active = actives[0];
  const platforms = [...new Set(actives.map((s) => (s.platform === "hyperliquid" ? "Hyperliquid" : "Strike")))].join(" & ");
  const team = coin?.teamWallet.address;
  const sim = ct?.source === "simulation";
  // While real money runs, this card is the paper record of the same picks.
  const paperBeside = sim && bot?.liveStatus?.mode === "live";
  // Real account: daily snapshots, then the bot's 30-second readings since it went live, so the
  // chart draws from the first minute and follows profit and loss as it happens.
  const liveHist = bot?.liveStatus?.history ?? [];
  const lastDaily = history.length ? Date.parse(history.at(-1)!.date) : 0;
  const deposited = ct?.deposits ?? 0;
  // Readings without a balance (the break-even start) are placed relative to one that has it.
  const known = liveHist.find((h) => h.equity !== undefined);
  const base = known ? known.equity! - known.pnl : deposited;
  const realPoints = [
    ...history.map((m) => ({ at: Date.parse(m.date), equity: m.equity, ref: m.netDeposited, daily: true })),
    ...liveHist.filter((h) => h.at > lastDaily).map((h) => ({ at: h.at, equity: h.equity ?? base + h.pnl, ref: h.netIn ?? (h.equity !== undefined ? h.equity - h.pnl : deposited), daily: false })), // older readings: their own trading P&L
  ];
  // Too few points yet: draw a flat line from going live to the latest reading.
  const lastRead = bot?.liveStatus?.account?.at;
  const wentLive = bot?.liveStatus?.liveSince;
  if (!sim && ct?.found && realPoints.length < 2 && lastRead && wentLive && lastRead > wentLive) {
    realPoints.splice(0, realPoints.length, { at: wentLive, equity: ct.equity, ref: deposited, daily: false }, { at: lastRead, equity: ct.equity, ref: deposited, daily: false });
  }
  const intraday = realPoints.length > 1 && realPoints.at(-1)!.at - realPoints[0].at < 36 * 3600e3;
  const utc = (at: number, o: Intl.DateTimeFormatOptions) => new Date(at).toLocaleString("en-US", { ...o, timeZone: "UTC" });
  const series = sim
    ? simHistory.map((m) => ({
        label: new Date(m.date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", timeZone: "UTC" }) + " UTC",
        tick: fmtDate(m.date.slice(0, 10)),
        value: m.equity,
        reference: m.netDeposited,
      }))
    : realPoints.map((m) => ({
        label: m.daily ? fmtDate(new Date(m.at).toISOString().slice(0, 10)) : utc(m.at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " UTC",
        tick: intraday ? utc(m.at, { hour: "2-digit", minute: "2-digit", hour12: false }) : fmtDate(new Date(m.at).toISOString().slice(0, 10)),
        value: m.equity,
        reference: m.ref,
      }));

  return (
    <div className="card relative overflow-hidden rounded-3xl p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <MascotIcon size={44} className="ring-1 ring-white/15" />
          <div>
            <p className="font-display text-xl font-semibold">
              {paperBeside ? "Paper simulation" : actives.length > 1 ? `Copying ${actives.length} traders` : active ? `Copying ${active.leadName}` : site.strategy.name}
            </p>
            <p className="text-sm text-muted">
              {paperBeside
                ? `All ${actives.length} picks on $${fmt(ct?.deposits ?? 0)} of paper money`
                : actives.length > 1
                ? `${platforms} leads · biggest: ${active.leadName}`
                : active
                  ? `${platforms} lead · since ${new Date(active.since).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                  : "Strike copy-trade"}
              {/* The team account is named only when this is its real Strike data, not the paper simulation. */}
              {team && !sim && <span className="font-mono text-white/40"> · account {team.slice(0, 9)}…{team.slice(-4)}</span>}
            </p>
          </div>
        </div>
        {sim ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 font-mono text-[11px] tracking-wide text-gold uppercase">
            Bot simulation · paper money
          </span>
        ) : ct?.found ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mint/10 px-2.5 py-1 text-xs text-mint">
            <span className="size-1.5 animate-pulse rounded-full bg-mint" /> Live from Strike
          </span>
        ) : null}
      </div>

      {coin && !ct?.found ? (
        <div className="mt-6 grid h-60 place-items-center rounded-2xl border border-dashed border-white/10 px-6 text-center text-sm text-muted">
          The copy-trade account appears here automatically once the team wallet makes its first Strike deposit.
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-3 gap-3">
            {[
              { k: "Account value", v: ct ? usd(ct.equity) : "…" },
              { k: "Total PnL", v: ct ? signedUsd(ct.totalPnl) : "…", c: ct && (ct.totalPnl >= 0 ? "text-mint" : "text-neg") },
              { k: "Return on deposits", v: ct ? fmtPct(ct.roiPct) : "…", c: ct && (ct.roiPct >= 0 ? "text-mint" : "text-neg") },
            ].map((s) => (
              <div key={s.k} className="rounded-2xl bg-white/[0.04] p-3 sm:p-4">
                <p className="text-[11px] text-muted sm:text-xs">{s.k}</p>
                <p className={`mt-1 font-mono text-base font-medium sm:text-xl ${s.c ?? ""}`}>{s.v}</p>
              </div>
            ))}
          </div>
          {ct && (
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-white/45">
              {sim && <span>Real traders, simulated money: ${fmt(ct.deposits)} paper capital</span>}
              {(!sim || (ct.closedCount ?? 0) > 0) && <span>Win rate {ct.winRatePct.toFixed(0)}%</span>}
              <span>Max drawdown {ct.maxDrawdownPct.toFixed(1)}%</span>
              {ct.trades > 0 && <span>{fmt(ct.trades)} trades</span>}
              {ct.volume > 0 && !sim && <span>${fmtCompact(ct.volume)} volume</span>}
            </p>
          )}

          <div className="mt-6">
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-soft">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-series-vault" />{sim ? "Paper equity (USD)" : "Account value (USD)"}</span>
              <span className="flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-white/60" />{sim ? "Starting capital" : "Net deposited"}</span>
            </div>
            {series.length > 1 ? (
              <AreaChart
                data={series}
                color="#c96a0e"
                valueName={sim ? "Paper equity" : "Account value"}
                referenceName={sim ? "Starting capital" : "Net deposited"}
                format={sim ? "usdWhole" : "usdCents"}
                zeroBased={false}
                height={240}
              />
            ) : (
              <div className="grid h-48 place-items-center rounded-2xl border border-dashed border-white/10 px-6 text-center text-sm text-muted">
                {sim ? "The chart fills in as the bot runs." : "The history chart fills in from daily snapshots, starting the day after the first deposit."}
              </div>
            )}
          </div>
        </>
      )}

      {showSubscriptions && ct && ct.subscriptions.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 font-normal">Lead</th>
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 text-right font-normal">Allocated</th>
                <th className="py-2 text-right font-normal">{sim ? "PnL" : "Realized PnL"}</th>
                {!sim && <th className="py-2 text-right font-normal">Volume</th>}
              </tr>
            </thead>
            <tbody className="font-mono">
              {visibleSubs(ct.subscriptions).map((s) => (
                <tr key={s.lead + s.since} className="border-t border-white/6">
                  <td className="py-2.5 text-soft">
                    {s.platform === "hyperliquid" ? (
                      <a href={`https://app.hyperliquid.xyz/explorer/address/${s.lead}`} target="_blank" rel="noreferrer" className="hover:text-mint">
                        {s.leadName}
                      </a>
                    ) : (
                      s.leadName
                    )}
                  </td>
                  <td className="py-2.5"><span className={s.status === "active" ? "text-mint" : "text-white/40"}>{s.status}</span></td>
                  <td className="py-2.5 text-right">{usd(s.amount)}{s.mode === "fixed_amount" ? "/trade" : ""}</td>
                  <td className={`py-2.5 text-right ${s.realizedPnl >= 0 ? "text-mint" : "text-neg"}`}>{signedUsd(s.realizedPnl)}</td>
                  {!sim && <td className="py-2.5 text-right">${fmtCompact(s.volume)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
