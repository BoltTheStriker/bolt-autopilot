"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { site } from "@/lib/config";

type Entry = { key: string; trader: string; handle?: string | null; boughtAda: number; buys: number; sells: number; out: string | null; rank: number | null; prizeUsd: number };
type CupRow = { key: string; address: string; handle: string | null; pct: number; value: number; style: string; leverage: number; out: string | null; rank: number | null; prizeUsd: number };
type Pool = { baseUsd: number; addedAda: number; addedUsd: number; totalUsd: number; sharePct: number };
type Cup = {
  kind: "pnl";
  phase: "upcoming" | "live" | "checking" | "final";
  start: number;
  end: number;
  payoutAt: number;
  pool: Pool;
  prizes: number[];
  volumeAda: number;
  players: number;
  minHolding: number;
  leaderboard: CupRow[];
  disqualified: CupRow[];
};
type Standings =
  | { phase: "off" }
  | Cup
  | {
      kind?: "buy";
      phase: "upcoming" | "live" | "checking" | "final";
      start: number;
      end: number;
      payoutAt: number;
      pool: { baseUsd: number; addedAda: number; addedUsd: number; totalUsd: number; sharePct: number };
      prizes: number[];
      volumeAda: number;
      buyers: number;
      leaderboard: Entry[];
      disqualified: Entry[];
      syncedTo: number;
    };

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ada = (v: number) => `₳${Math.round(v).toLocaleString("en-US")}`;
const short = (a: string) => `${a.slice(0, 9)}…${a.slice(-5)}`;
const date = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const PLACE = ["1st", "2nd", "3rd"];
const pctLabel = (f: number) => `${f >= 0 ? "+" : "−"}${Math.abs(f * 100).toFixed(2)}%`;
const STYLE: Record<string, string> = { steady: "Steady", balanced: "Balanced", bold: "Bold", aggressive: "Aggressive" };
/** $handle when the wallet has an ADA Handle, else the short address. */
const who = (e: Entry) => (e.handle ? `$${e.handle}` : short(e.trader));

function useNow(ms: number) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function Countdown({ to, now }: { to: number; now: number | null }) {
  if (now === null) return <span className="font-mono">…</span>;
  const s = Math.max(0, Math.floor((to - now) / 1000));
  const parts = [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60];
  return (
    <span className="inline-flex gap-1.5 font-mono">
      {parts.map((v, i) => (
        <span key={i} className="rounded-lg bg-white/[0.06] px-2 py-1 tabular-nums">
          {String(v).padStart(2, "0")}
          <span className="ml-0.5 text-[10px] text-white/40">{"dhms"[i]}</span>
        </span>
      ))}
    </span>
  );
}

export function ContestBoard() {
  const [s, setS] = useState<Standings | null>(null);
  const [failed, setFailed] = useState(false);
  const now = useNow(1000);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${site.botApi}/contest`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: Standings) => alive && (setS(j), setFailed(false)))
        .catch(() => alive && setFailed(true));
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!s) return <p className="text-center text-muted">{failed ? "Couldn't load the contest. Try again in a minute." : "Loading the contest…"}</p>;
  if (s.phase === "off")
    return (
      <div className="text-center">
        <p className="font-mono text-xs tracking-[0.3em] text-mint uppercase">${site.ticker} Bot Cup</p>
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">No contest running right now.</h1>
        <p className="mt-3 text-muted">Follow us on X for the next one.</p>
      </div>
    );

  if ("kind" in s && s.kind === "pnl") return <PnlCup s={s} now={now} />;

  const status =
    s.phase === "upcoming" ? { label: "Starts in", to: s.start } : s.phase === "live" ? { label: "Ends in", to: s.end } : s.phase === "checking" ? { label: "Winners confirmed in", to: s.payoutAt } : null;

  return (
    <div className="space-y-6">
      <header className="text-center">
        <p className="flex items-center justify-center gap-2 font-mono text-xs tracking-[0.3em] text-mint uppercase">
          {s.phase === "live" && <span className="size-1.5 animate-pulse rounded-full bg-mint" />}
          ${site.ticker} Bot Cup · {s.phase === "upcoming" ? "starting soon" : s.phase === "live" ? "live" : s.phase === "checking" ? "ended" : "final results"}
        </p>
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-6xl">
          Biggest buyers win <span className="text-gradient">STRIKE</span>.
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted">
          Top 3 buyers of ${site.ticker} between {date(s.start)} and {date(s.end)} split the prize pool. It grows with every trade.
        </p>
        {status && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm text-soft">
            {status.label} <Countdown to={status.to} now={now} />
          </div>
        )}
      </header>

      <section className="card relative overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-mint/15 blur-[100px]" />
        <div className="relative grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-center">
          <div>
            <p className="text-sm text-muted">Prize pool, paid in STRIKE</p>
            <p className="mt-1 font-display text-6xl font-bold tracking-tight text-mint sm:text-7xl">{usd(s.pool.totalUsd)}</p>
            <p className="mt-2 text-sm text-soft">
              Started at {usd(s.pool.baseUsd)} · <span className="text-mint">+{usd(s.pool.addedUsd)}</span> from trading fees so far
            </p>
            <p className="mt-1 text-xs text-muted">
              {s.pool.sharePct.toFixed(1)}% of every ${site.ticker} trade during the contest goes into the pool · {ada(s.volumeAda)} traded · {s.buyers} buyers
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {s.prizes.map((p, i) => (
              <div key={i} className={`rounded-2xl p-3 text-center ${i === 0 ? "border border-mint/40 bg-mint/[0.08]" : "bg-white/[0.04]"}`}>
                <p className="text-xs text-muted">{PLACE[i]}</p>
                <p className={`mt-1 font-mono text-lg font-medium ${i === 0 ? "text-mint" : ""}`}>{usd(p)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card rounded-3xl p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-semibold">Leaderboard</h2>
            <p className="mt-0.5 text-xs text-muted">ADA spent buying ${site.ticker} during the contest · updates every minute</p>
          </div>
          <a href={site.token.launchpad.url} target="_blank" rel="noreferrer" className="rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-mint-2">
            Buy ${site.ticker}
          </a>
        </div>
        {s.leaderboard.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2 font-normal">#</th>
                  <th className="py-2 font-normal">Wallet</th>
                  <th className="py-2 text-right font-normal">Bought</th>
                  <th className="hidden py-2 text-right font-normal sm:table-cell">Buys</th>
                  <th className="py-2 text-right font-normal">Prize now</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {s.leaderboard.slice(0, 25).map((e) => (
                  <tr key={e.key} className={`border-t border-white/8 ${e.rank! <= 3 ? "text-white" : "text-soft"}`}>
                    <td className={`py-2.5 ${e.rank === 1 ? "text-mint" : ""}`}>{e.rank}</td>
                    <td className="py-2.5">
                      <a href={`https://cardanoscan.io/address/${e.trader}`} target="_blank" rel="noreferrer" title={e.trader} className={`hover:text-mint ${e.handle ? "text-mint/90" : ""}`}>{who(e)}</a>
                    </td>
                    <td className="py-2.5 text-right">{ada(e.boughtAda)}</td>
                    <td className="hidden py-2.5 text-right text-white/50 sm:table-cell">{e.buys}</td>
                    <td className={`py-2.5 text-right ${e.prizeUsd ? "text-mint" : "text-white/30"}`}>{e.prizeUsd ? usd(e.prizeUsd) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">{s.phase === "upcoming" ? "The board opens when the contest starts." : "No buys yet. The first one takes the lead."}</p>
        )}
        {s.disqualified.length > 0 && (
          <details className="mt-4 text-xs text-muted">
            <summary className="cursor-pointer">Out of the running ({s.disqualified.length})</summary>
            <ul className="mt-2 space-y-1 font-mono">
              {s.disqualified.map((e) => (
                <li key={e.key}>
                  {who(e)} · {ada(e.boughtAda)} · <span className="text-neg">{e.out}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card rounded-3xl p-5 sm:p-7">
        <h2 className="font-display text-xl font-semibold">Rules</h2>
        <ul className="mt-3 space-y-2 text-sm text-soft">
          <li>Ranked by ADA spent buying ${site.ticker} between {date(s.start)} and {date(s.end)}. Buys from all your addresses in one wallet count together.</li>
          <li>Sell any ${site.ticker} during the contest and that wallet is out. Moving the ${site.ticker} you bought to another wallet counts as selling.</li>
          <li>Top 3 split the pool 50% / 30% / 20%. The pool starts at {usd(s.pool.baseUsd)} and grows with {s.pool.sharePct.toFixed(1)}% of every trade, buys and sells.</li>
          <li>Prizes are paid in STRIKE on {date(s.payoutAt)}, to winners still holding everything they bought.</li>
          <li>The project&apos;s own wallets can&apos;t win. Everything is read from the chain and can be checked on Cardanoscan.</li>
        </ul>
        <p className="mt-4 text-[11px] text-white/35">Not financial advice. Buy only what you&apos;re fine holding.</p>
      </section>
    </div>
  );
}

function PrizePool({ pool, prizes, note }: { pool: Pool; prizes: number[]; note: string }) {
  return (
    <section className="card relative overflow-hidden rounded-3xl p-6 sm:p-8">
      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-mint/15 blur-[100px]" />
      <div className="relative grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div>
          <p className="text-sm text-muted">Prize pool, paid in STRIKE</p>
          <p className="mt-1 font-display text-6xl font-bold tracking-tight text-mint sm:text-7xl">{usd(pool.totalUsd)}</p>
          <p className="mt-2 text-sm text-soft">
            Started at {usd(pool.baseUsd)} · <span className="text-mint">+{usd(pool.addedUsd)}</span> from ${site.ticker} trading fees so far
          </p>
          <p className="mt-1 text-xs text-muted">{note}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {prizes.map((p, i) => (
            <div key={i} className={`rounded-2xl p-3 text-center ${i === 0 ? "border border-mint/40 bg-mint/[0.08]" : "bg-white/[0.04]"}`}>
              <p className="text-xs text-muted">{PLACE[i]}</p>
              <p className={`mt-1 font-mono text-lg font-medium ${i === 0 ? "text-mint" : ""}`}>{usd(p)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The PnL cup: best demo-bot return during the week wins. */
function PnlCup({ s, now }: { s: Cup; now: number | null }) {
  const status =
    s.phase === "upcoming" ? { label: "Starts in", to: s.start } : s.phase === "live" ? { label: "Ends in", to: s.end } : s.phase === "checking" ? { label: "Winners confirmed in", to: s.payoutAt } : null;
  const who = (r: CupRow) => (r.handle ? `$${r.handle}` : short(r.address));
  const min = `${(s.minHolding / 1e6).toLocaleString("en-US")}M`;
  return (
    <div className="space-y-6">
      <header className="text-center">
        <p className="flex items-center justify-center gap-2 font-mono text-xs tracking-[0.3em] text-mint uppercase">
          {s.phase === "live" && <span className="size-1.5 animate-pulse rounded-full bg-mint" />}
          ${site.ticker} Bot Cup · {s.phase === "upcoming" ? "starting soon" : s.phase === "live" ? "live" : s.phase === "checking" ? "ended" : "final results"}
        </p>
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-6xl">
          Best bot return wins <span className="text-gradient">STRIKE</span>.
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted">
          ${site.ticker} holders run their own copy-trade bot on Strike with $10,000 of demo money. The top 3 returns between {date(s.start)} and {date(s.end)} split the prize pool.
        </p>
        {status && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm text-soft">
            {status.label} <Countdown to={status.to} now={now} />
          </div>
        )}
      </header>

      <PrizePool pool={s.pool} prizes={s.prizes} note={`${s.pool.sharePct.toFixed(1)}% of every $${site.ticker} trade during the cup goes into the pool · ${s.players} players`} />

      <section className="card rounded-3xl p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-semibold">Leaderboard</h2>
            <p className="mt-0.5 text-xs text-muted">Demo return since the cup started · updates every minute</p>
          </div>
          {(s.phase === "upcoming" || s.phase === "live") && (
            <Link href="/app/try" className="rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-mint-2">Join the cup</Link>
          )}
        </div>
        {s.leaderboard.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2 font-normal">#</th>
                  <th className="py-2 font-normal">Player</th>
                  <th className="py-2 text-right font-normal">Return</th>
                  <th className="hidden py-2 text-right font-normal sm:table-cell">Balance</th>
                  <th className="hidden py-2 pl-4 font-normal md:table-cell">Rules</th>
                  <th className="py-2 text-right font-normal">Prize now</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {s.leaderboard.slice(0, 50).map((r) => (
                  <tr key={r.key} className={`border-t border-white/8 ${r.rank! <= 3 ? "text-white" : "text-soft"}`}>
                    <td className={`py-2.5 ${r.rank === 1 ? "text-mint" : ""}`}>{r.rank}</td>
                    <td className="py-2.5">
                      <a href={`https://cardanoscan.io/address/${r.address}`} target="_blank" rel="noreferrer" title={r.address} className={`hover:text-mint ${r.handle ? "text-mint/90" : ""}`}>{who(r)}</a>
                    </td>
                    <td className={`py-2.5 text-right ${s.phase === "upcoming" ? "text-white/40" : r.pct >= 0 ? "text-mint" : "text-neg"}`}>{s.phase === "upcoming" ? "—" : pctLabel(r.pct)}</td>
                    <td className="hidden py-2.5 text-right sm:table-cell">{usd(r.value)}</td>
                    <td className="hidden py-2.5 pl-4 text-xs text-white/50 md:table-cell">{STYLE[r.style] ?? r.style} · {r.leverage}x</td>
                    <td className={`py-2.5 text-right ${r.prizeUsd ? "text-mint" : "text-white/30"}`}>{r.prizeUsd ? usd(r.prizeUsd) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">No players yet. Join from your demo on the Try page.</p>
        )}
        {s.disqualified.length > 0 && (
          <details className="mt-4 text-xs text-muted">
            <summary className="cursor-pointer">Out of the running ({s.disqualified.length})</summary>
            <ul className="mt-2 space-y-1 font-mono">
              {s.disqualified.map((r) => (
                <li key={r.key}>
                  {who(r)} · {pctLabel(r.pct)} · <span className="text-neg">{r.out}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card rounded-3xl p-5 sm:p-7">
        <h2 className="font-display text-xl font-semibold">Rules</h2>
        <ul className="mt-3 space-y-2 text-sm text-soft">
          <li>Hold {min}+ ${site.ticker}, open your demo on the Try page and join the cup by signing with your wallet (free, no transaction). It proves the wallet is yours.</li>
          <li>Your bot copies real traders on Strike with $10,000 of demo money, using your rules: traders, style, leverage, stop-loss, take profit. Change them any time.</li>
          <li>To be fair, every demo starts fresh with $10,000 when the cup opens on {date(s.start)} (your rules stay). Join late and it starts fresh when you join. Ranked by return until {date(s.end)}.</li>
          <li>Top 3 split the pool 50% / 30% / 20%. It starts at {usd(s.pool.baseUsd)} and grows with {s.pool.sharePct.toFixed(1)}% of every ${site.ticker} trade during the cup.</li>
          <li>You must still hold {min}+ ${site.ticker} at the end. Prizes are paid in STRIKE on {date(s.payoutAt)}. One entry per wallet.</li>
        </ul>
        <p className="mt-4 text-[11px] text-white/35">Demo money only: no real trades. Real results aren&apos;t guaranteed. Not financial advice.</p>
      </section>
    </div>
  );
}
