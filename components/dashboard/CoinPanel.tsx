"use client";

import { site } from "@/lib/config";
import { fmt, fmtCompact } from "@/lib/format";
import { useCoin } from "@/lib/useCoin";
import { AreaChart } from "../AreaChart";
import { potLabel } from "../HolderPotCard";
import { StrikeIcon } from "../ui";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/** Market + holder-reward numbers, live from Solada. Before launch every figure is an honest "—". */
export function CoinPanel() {
  const coin = useCoin();
  const kpis = [
    { k: "Market cap", v: coin?.marketCapAda != null ? `₳${fmtCompact(coin.marketCapAda)}` : coin?.marketCapUsd != null ? `$${fmtCompact(coin.marketCapUsd)}` : "—" },
    { k: "Holders", v: coin?.launched ? fmt(coin.holders) : "—" },
    {
      k: coin?.volumeAllTime === false ? "Volume (7 days)" : "Total volume",
      v: coin?.volumeAda != null ? `₳${fmtCompact(coin.volumeAda)}` : "—",
      sub: coin?.volume24hAda != null ? `₳${fmtCompact(coin.volume24hAda)} in the last 24h` : coin?.trades != null ? `${fmt(coin.trades)} trades` : undefined,
    },
    { k: coin?.graduated ? "Graduated" : "Curve progress", v: coin?.launched ? (coin.graduated ? "On Minswap" : `${coin.progressPct.toFixed(1)}%`) : "—", bar: coin?.launched && !coin.graduated ? coin.progressPct : undefined },
  ];
  const intraday = (coin?.candleSeconds ?? 3600) < 3600;
  const series = (coin?.candles ?? []).map((c) => {
    const d = new Date(c.time * 1000);
    const hm = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
    const day = d.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return { label: `${day}, ${hm} UTC`, tick: intraday ? hm : `${day} ${d.getUTCHours()}h`, value: c.close };
  });
  const resolution = coin?.candleSeconds === 60 ? "1-minute" : coin?.candleSeconds === 300 ? "5-minute" : "Hourly";

  return (
    <>
      <section className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((x) => (
          <div key={x.k} className="card rounded-2xl p-4 sm:p-5">
            <p className="text-xs text-muted sm:text-sm">{x.k}</p>
            <p className="mt-1.5 font-display text-2xl font-bold tracking-tight sm:text-3xl">{x.v}</p>
            {x.sub && <p className="mt-1 font-mono text-xs text-white/40">{x.sub}</p>}
            {x.bar !== undefined && (
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/8">
                <div className="h-full rounded-full bg-mint" style={{ width: `${Math.min(100, x.bar)}%` }} />
              </div>
            )}
          </div>
        ))}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section className="card rounded-3xl p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl font-semibold">${site.ticker} price</h2>
            <span className="font-mono text-sm text-soft">{coin?.priceAda ? `₳${coin.priceAda.toPrecision(3)}` : ""}</span>
          </div>
          <p className="mb-4 text-sm text-muted">{resolution} closes on the Solada curve, in ADA (UTC)</p>
          {series.length > 1 ? (
            <AreaChart data={series} color="#1fa874" valueName="Price" format="price" height={300} />
          ) : (
            <div className="grid h-60 place-items-center rounded-2xl border border-dashed border-white/10 text-sm text-muted">
              {!coin ? "Loading…" : coin.launched ? "Chart appears after the first trades" : `The chart starts with $${site.ticker}'s first trade`}
            </div>
          )}
        </section>

        <section className="card relative overflow-hidden rounded-3xl p-5 sm:p-7">
          <div className="absolute -top-20 -right-20 h-60 w-60 rounded-full bg-mint/10 blur-[80px]" />
          <div className="relative">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold"><StrikeIcon size={22} /> Holder rewards</h2>
              {coin && !coin.launched && (
                <span className="rounded-full border border-mint/25 bg-mint/8 px-2.5 py-0.5 font-mono text-[11px] tracking-wide text-mint uppercase">At launch</span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">Run by Solada, paid {site.distributionEvery.toLowerCase()} in STRIKE</p>
            <p className="mt-6 text-xs text-muted">In the pot for the next payout</p>
            <p className="mt-1 font-display text-4xl font-bold tracking-tight text-mint">{coin?.launched ? potLabel(coin.pot) : "—"}</p>
            <dl className="mt-6 divide-y divide-white/8 text-sm">
              {[
                ["Earned by holders, all time", coin?.launched ? `${coin.fees.currency === "USDC" ? "$" : "₳"}${fmt(coin.fees.holders)}` : "—"],
                ["Share of fees to holders", coin ? `${coin.holderSharePct}%` : "—"],
                ["Paid in", coin ? (coin.paidInStrike ? "STRIKE" : "ADA") : "—"],
                ["Last payout", when(coin?.lastPayoutAt ?? null)],
                ["Last snapshot", when(coin?.lastSnapshotAt ?? null)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2.5">
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-mono text-white">{v}</dd>
                </div>
              ))}
            </dl>
            <a
              href={site.token.launchpad.url}
              target="_blank"
              rel="noreferrer"
              className="mt-5 block rounded-full bg-mint py-3 text-center font-semibold text-ink transition hover:bg-mint-2"
            >
              Claim on Solada
            </a>
          </div>
        </section>
      </div>
    </>
  );
}
