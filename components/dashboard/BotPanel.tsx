"use client";

import type { Scan } from "@/bot/strategy";
import { bot } from "@/bot/config";
import { useEffect, useState } from "react";
import { useBotState } from "@/lib/useBotState";
import { fmtCompact } from "@/lib/format";

// The bot tab's building blocks, all live from the Railway worker (refreshes every 10s).

const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
// Leads are Hyperliquid wallets; their full trade history is public on Hyperliquid's explorer.
const hl = (a: string) => `https://app.hyperliquid.xyz/explorer/address/${a}`;
const agoAt = (now: number | null, ms: number) => {
  if (now === null) return "…"; // prerendered: filled in once the page runs
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
};
const CYCLE_MS = 60 * 60_000;

/** Current time, ticking every 10s, for countdowns. Null until mounted (the page is prerendered). */
function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  return now;
}

/** "5m ago" labels that tick with the clock. */
function useAgo() {
  const now = useNow();
  return (ms: number) => agoAt(now, ms);
}

function LiveDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-mint" />
    </span>
  );
}

type LiveCopy = { lead: string; amount: number; pnl: number; since?: number };
/** Real copies on Strike by lead, while the bot trades live (null otherwise). */
function liveCopies(s: ReturnType<typeof useBotState>): Map<string, LiveCopy> | null {
  const l = s?.liveStatus;
  if (!l || l.mode !== "live") return null;
  return new Map((l.positions ?? []).map((c) => [c.lead.toLowerCase(), c]));
}

/** Card header shared by every block on the tab. */
function Head({ title, sub, right, live }: { title: string; sub?: string; right?: React.ReactNode; live?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          {live && <LiveDot />}
          {title}
        </h2>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {right && <div className="shrink-0 font-mono text-[11px] text-white/40">{right}</div>}
    </div>
  );
}

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <section className={`card min-w-0 rounded-3xl p-5 sm:p-6 ${className}`}>{children}</section>
);

/** Status pills for the page header: watching live, next hourly review. */
export function BotStatus() {
  const s = useBotState();
  const now = useNow();
  const ago = (ms: number) => agoAt(now, ms);
  if (!s) return null;
  const next = s.lastScan && now ? Math.max(0, Math.round((s.lastScan.at + CYCLE_MS - now) / 60_000)) : null;
  const pill = "glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[11px] text-soft";
  return (
    <div className="flex flex-wrap gap-2">
      {s.lastTickAt && (
        <span className={pill}>
          <LiveDot /> Watching live · {ago(s.lastTickAt)}
        </span>
      )}
      {next !== null && <span className={pill}>Next review {next < 1 ? "now" : `in ${next} min`}</span>}
      {s.liveStatus?.mode === "live" ? (
        <span className={pill}>
          {(s.liveStatus.positions ?? []).length} real copies · ${fmtCompact(s.liveStatus.account?.allocated ?? 0)}
        </span>
      ) : (
        <span className={pill}>{s.positions.length} traders copied</span>
      )}
    </div>
  );
}

/** The real copies on Strike, one row per trader. Shown only while the bot trades live. */
export function BotLive() {
  const s = useBotState();
  const now = useNow();
  const live = s?.liveStatus;
  if (!live || live.mode !== "live") return null;
  const copies = live.positions ?? [];
  const ago = (ms: number) => agoAt(now, ms);
  return (
    <section className="rounded-3xl border border-mint/30 bg-mint/[0.04] p-5 sm:p-6">
      <Head
        title="Real copies on Strike"
        sub={`${copies.length} traders · $${fmtCompact(live.account?.allocated ?? 0)} of the $${fmtCompact(live.budgetUsd ?? 0)} budget · updated every 30s`}
        right={live.account?.at ? `read ${ago(live.account.at)}` : undefined}
        live
      />
      {live.lock && (live.lock.enabled || live.lock.banked > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-mint/25 bg-mint/[0.06] px-4 py-2.5 text-sm">
          <span className="font-semibold text-mint">Profit locked in: {signed(live.lock.banked)}</span>
          <span className="text-xs text-muted">
            {live.lock.events.length} time{live.lock.events.length === 1 ? "" : "s"} · the bold slot&apos;s copy banks its profit at +{Math.round(live.lock.pct * 100)}%, then copies the trader again
            {live.lock.events[0] ? ` · last ${ago(live.lock.events[0].at)}` : ""}
          </span>
        </div>
      )}
      {copies.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 font-normal">Trader</th>
                <th className="py-2 text-right font-normal">In</th>
                <th className="py-2 text-right font-normal">Profit</th>
                <th className="hidden py-2 pl-4 font-normal md:table-cell">Holding</th>
                <th className="hidden py-2 text-right font-normal sm:table-cell">Since</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {[...copies].sort((a, b) => b.pnl - a.pnl).map((c) => {
                return (
                  <tr key={c.lead} className="border-t border-white/8">
                    <td className="py-2.5">
                      <a href={hl(c.lead)} target="_blank" rel="noreferrer" className="text-soft hover:text-mint">{short(c.lead)}</a>
                    </td>
                    <td className="py-2.5 text-right">${c.amount.toFixed(2)}</td>
                    <td className={`py-2.5 text-right ${c.pnl >= 0 ? "text-mint" : "text-neg"}`}>
                      {signed(c.pnl)}
                      <span className="block text-[10px] text-white/40">{c.pnl >= 0 ? "+" : "−"}{Math.abs(c.amount ? (c.pnl / c.amount) * 100 : 0).toFixed(2)}%</span>
                    </td>
                    <td className="hidden py-2.5 pl-4 md:table-cell">
                      <span className="flex flex-wrap gap-1">
                        {c.positions?.length
                          ? c.positions.map((o) => (
                              <span
                                key={o.market}
                                title={`Our entry ${o.entry} · now ${o.mark}`}
                                className={`rounded-md px-1.5 py-0.5 text-[10px] ${o.long ? "bg-mint/12 text-mint" : "bg-neg/12 text-neg"}`}
                              >
                                {o.market.replace(/-USD$/, "")} {o.long ? "L" : "S"}
                                <span className={`ml-1 ${o.pnl >= 0 ? "text-white/70" : "text-white/50"}`}>{o.pnl >= 0 ? "+" : "−"}${Math.abs(o.pnl).toFixed(2)}</span>
                              </span>
                            ))
                          : <span className="text-[11px] text-white/35">{c.positions ? "flat, waiting for their next trade" : "…"}</span>}
                      </span>
                    </td>
                    <td className="hidden py-2.5 text-right text-[11px] text-white/45 sm:table-cell">{c.since ? ago(c.since) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-white/[0.04] px-3 py-3 text-xs text-muted">Opening the first copies on Strike…</p>
      )}
      <p className="mt-3 text-[11px] text-white/35">Profit matches Strike: realized after fees plus our open positions at mark. Each copy has a 15% stop-loss on Strike.</p>
    </section>
  );
}

const REASON_LABEL: Record<string, string> = {
  "30d ROI too low": "returns too low",
  "too few trades copyable at our size": "trades too big to copy at our size",
  "not trading recently": "gone quiet",
  "copy score too low": "low copy score",
  "30d drawdown too deep": "drawdowns too deep",
  "account too small": "account too small",
  "Strike doesn't recommend copying": "Strike flags as not copyable",
  "trades too rarely": "trade too rarely",
  "30d ROI suspiciously high": "returns too extreme to trust",
  "trades too fast to copy well": "trade too fast to copy well",
  "cooling off this week": "cooling off this week",
  "not profitable all-time": "not profitable all-time",
  "churns too much (copy costs eat the profit)": "churn so much that fees eat the profit",
  "would stack a bet we already hold": "would stack a bet two copies already hold",
  "trades coins Strike can't copy": "trade coins Strike can't copy",
};

/** The bot's latest check in plain words: what it looked at, how its copies moved, who's next. */
export function BotThinking() {
  const s = useBotState();
  const scan: Scan | undefined = s?.lastScan;
  if (!scan) return null;
  const real = liveCopies(s);
  const reasons = Object.entries(scan.rejections)
    .filter(([r]) => !r.startsWith("style"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const best = scan.nextUp[0];
  const gap = best && scan.weakestHeldScore !== null ? scan.weakestHeldScore + bot.rotation.scoreMargin - best.score : null;
  const lines: { tone: "mint" | "neg" | "soft"; text: string }[] = [
    { tone: "soft", text: `Checked ${scan.checked} traders on Strike. ${scan.eligible} more pass every rule.` },
    ...scan.moves.map((m) => {
      // Live: talk about the real copy (its profit on real money); picks without one are paper only.
      if (real) {
        const c = real.get(m.lead.toLowerCase());
        if (!c) return { tone: "soft" as const, text: `${short(m.lead)}: followed on paper only (not enough budget for a real copy). Holding.` };
        return {
          tone: (Math.abs(c.pnl) < 0.005 ? "soft" : c.pnl > 0 ? "mint" : "neg") as "mint" | "neg" | "soft",
          text: `${short(m.lead)}: ${signed(c.pnl)} on $${c.amount.toFixed(2)} of real money so far. Holding.`,
        };
      }
      return {
        tone: (Math.abs(m.change) < 0.005 ? "soft" : m.change > 0 ? "mint" : "neg") as "mint" | "neg" | "soft",
        text:
          Math.abs(m.change) < 0.005
            ? `${short(m.lead)}: flat since the last check. Holding.`
            : `${short(m.lead)}: ${signed(m.change)} since the last check (now ${money(m.value)}). Holding.`,
      };
    }),
    ...(best
      ? [{
          tone: "soft" as const,
          text:
            gap !== null && gap > 0
              ? `Next in line: ${short(best.lead)} (score ${best.score.toFixed(2)}, 30d ${(best.roi30d * 100).toFixed(0)}%). Not enough better than the weakest copy to swap yet.`
              : `Next in line: ${short(best.lead)} (score ${best.score.toFixed(2)}, 30d ${(best.roi30d * 100).toFixed(0)}%).`,
        }]
      : []),
    ...(reasons.length ? [{ tone: "soft" as const, text: `Passed on the rest: ${reasons.map(([r, n]) => `${n} ${REASON_LABEL[r] ?? r}`).join(", ")}.` }] : []),
  ];
  return (
    <section className="min-w-0 rounded-3xl border border-mint/15 bg-mint/[0.04] p-5 sm:p-6">
      <Head title="What the bot is thinking" sub="Its latest hourly review, in plain words" right={when(scan.at)} live />
      <ul className="mt-4 space-y-2 font-mono text-[12px] leading-relaxed">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-white/25">›</span>
            <span className={l.tone === "mint" ? "text-mint" : l.tone === "neg" ? "text-neg" : "text-soft"}>{l.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Positions the copied traders hold right now, refreshed every 15s. */
export function BotHolding() {
  const s = useBotState();
  const ago = useAgo();
  if (!s) return null;
  const real = liveCopies(s);
  const rows = s.positions
    .filter((p) => !real || real.has(p.lead.toLowerCase()))
    .flatMap((p) => (s.live?.[p.lead]?.open ?? []).map((o) => ({ ...o, lead: p.lead, copyValue: p.value })))
    .sort((a, b) => Math.abs(b.ourUpnl) - Math.abs(a.ourUpnl));
  const sub = real ? `Open positions of the ${real.size} traders copied with real money` : "Open positions of the traders Bolt copies";
  return (
    <Card>
      <Head title="Holding now" sub={sub} right={s.lastTickAt && `updated ${ago(s.lastTickAt)}`} live />
      {rows.length ? (
        <ul className="mt-4 max-h-[360px] space-y-1.5 overflow-y-auto pr-1">
          {rows.map((r) => {
            const pctOfCopy = r.copyValue > 0 ? r.ourUpnl / r.copyValue : 0;
            const tone = r.ourUpnl >= 0 ? "text-mint" : "text-neg";
            const sign = r.ourUpnl >= 0 ? "+" : "−";
            return (
              <li key={`${r.lead}-${r.coin}`} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 text-xs">
                <Side long={r.long} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold text-white">{r.coin.replace(/^xyz:/, "")}</span>
                  <span className="text-white/70"> {r.long ? "long" : "short"} </span>
                  <span className="text-white/45">· ${fmtCompact(r.value)} · </span>
                  <a href={hl(r.lead)} target="_blank" rel="noreferrer" className="font-mono text-soft hover:text-mint">{short(r.lead)}</a>
                </span>
                <span className="shrink-0 text-right font-mono leading-tight">
                  <span className={`block ${tone}`}>{sign}{Math.abs(pctOfCopy * 100).toFixed(2)}%</span>
                  <span className="block text-[10px] text-white/40">{sign}${Math.abs(pctOfCopy * 10_000).toFixed(2)} per $10K</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl bg-white/[0.03] px-3 py-3 text-xs text-muted">The copied traders are flat right now, waiting for their next trade.</p>
      )}
      <p className="mt-3 text-[11px] text-white/35">Each trader&apos;s open profit since they entered, scaled to Bolt&apos;s copy size. It&apos;s booked when they close.</p>
    </Card>
  );
}

const Side = ({ long }: { long: boolean }) => (
  <span className={`grid size-6 shrink-0 place-items-center rounded-md font-mono text-[10px] ${long ? "bg-mint/12 text-mint" : "bg-neg/12 text-neg"}`}>{long ? "L" : "S"}</span>
);

/** Every copy the bot holds: what went in, what it made, and how the bot rated the trader. */
export function BotCopies() {
  const s = useBotState();
  const ago = useAgo();
  if (!s) return null;
  const real = liveCopies(s);
  if (real) return <LiveCopiesTable s={s} real={real} ago={ago} />;
  return (
    <Card>
      <Head title="Copies" sub={`${s.positions.length} active · ${s.closed.length} closed so far`} />
      {s.positions.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 font-normal">Trader</th>
                <th className="py-2 text-right font-normal">In</th>
                <th className="py-2 text-right font-normal">Profit</th>
                <th className="py-2 text-right font-normal">Score</th>
                <th className="hidden py-2 text-right font-normal sm:table-cell">Since</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {[...s.positions].sort((a, b) => b.value - b.cost - (a.value - a.cost)).map((p) => {
                const pnl = p.value - p.cost;
                return (
                  <tr key={p.lead} className="border-t border-white/6">
                    <td className="py-3">
                      <a href={hl(p.lead)} target="_blank" rel="noreferrer" className="text-soft hover:text-mint">{short(p.lead)}</a>
                    </td>
                    <td className="py-3 text-right">${fmtCompact(p.cost)}</td>
                    <td className={`py-3 text-right ${pnl >= 0 ? "text-mint" : "text-neg"}`}>
                      {signed(pnl)}
                      <span className="block text-[10px] text-white/40">{pnl >= 0 ? "+" : "−"}{Math.abs((pnl / p.cost) * 100).toFixed(2)}%</span>
                    </td>
                    <td className="py-3 text-right">
                      <ScoreBar v={p.score} />
                    </td>
                    <td className="hidden py-3 text-right text-[11px] text-white/45 sm:table-cell">{ago(p.openedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">In cash: no trader passes the rules right now.</p>
      )}
    </Card>
  );
}

/** Live mode: the bot's picks with the real money behind each one. */
function LiveCopiesTable({ s, real, ago }: { s: NonNullable<ReturnType<typeof useBotState>>; real: Map<string, LiveCopy>; ago: (ms: number) => string }) {
  const rows = s.positions
    .map((p) => ({ p, c: real.get(p.lead.toLowerCase()) }))
    .sort((a, b) => (b.c ? 1 : 0) - (a.c ? 1 : 0) || (b.c?.pnl ?? 0) - (a.c?.pnl ?? 0) || (b.p.scoreNow ?? b.p.score) - (a.p.scoreNow ?? a.p.score));
  return (
    <Card>
      <Head title="Copies" sub={`${real.size} with real money · ${s.positions.length - real.size} paper only`} />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 font-normal">Trader</th>
              <th className="py-2 text-right font-normal">Real $</th>
              <th className="py-2 text-right font-normal">Profit</th>
              <th className="py-2 text-right font-normal">Score</th>
              <th className="hidden py-2 text-right font-normal sm:table-cell">Since</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map(({ p, c }) => (
              <tr key={p.lead} className={`border-t border-white/6 ${c ? "" : "opacity-55"}`}>
                <td className="py-3">
                  <a href={hl(p.lead)} target="_blank" rel="noreferrer" className="text-soft hover:text-mint">{short(p.lead)}</a>
                  {!c && <span className="ml-2 rounded-md bg-white/8 px-1.5 py-0.5 text-[10px] text-white/50">paper only</span>}
                </td>
                <td className="py-3 text-right">{c ? `$${c.amount.toFixed(2)}` : "—"}</td>
                <td className={`py-3 text-right ${!c ? "text-white/40" : c.pnl >= 0 ? "text-mint" : "text-neg"}`}>
                  {c ? signed(c.pnl) : "—"}
                  {c && <span className="block text-[10px] text-white/40">{c.pnl >= 0 ? "+" : "−"}{Math.abs(c.amount ? (c.pnl / c.amount) * 100 : 0).toFixed(2)}%</span>}
                </td>
                <td className="py-3 text-right">
                  <ScoreBar v={p.scoreNow ?? p.score} />
                </td>
                <td className="hidden py-3 text-right text-[11px] text-white/45 sm:table-cell">{c?.since ? ago(c.since) : ago(p.openedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-white/35">Real money goes to the highest-scoring picks first, $100+ each. The rest are followed on paper.</p>
    </Card>
  );
}

const ScoreBar = ({ v }: { v: number }) => (
  <span className="inline-flex items-center justify-end gap-2">
    <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-white/8 sm:block">
      <span className="block h-full rounded-full bg-mint/70" style={{ width: `${Math.min(v, 1) * 100}%` }} />
    </span>
    <span className="text-white/60">{v.toFixed(2)}</span>
  </span>
);

const ACTION = {
  open: { label: "Copy", dot: "bg-mint", text: "text-mint" },
  close: { label: "Stop", dot: "bg-gold", text: "text-gold" },
  rotate: { label: "Swap", dot: "bg-gold", text: "text-gold" },
  info: { label: "Note", dot: "bg-white/40", text: "text-soft" },
} as const;

/** Latest decisions as a timeline. */
export function BotDecisions() {
  const s = useBotState();
  if (!s) return null;
  const decisions = [...s.decisions].reverse().slice(0, 10);
  return (
    <Card>
      <Head title="Decisions" sub="Who it started and stopped copying, and why" />
      <ol className="relative mt-4 max-h-[420px] space-y-4 overflow-y-auto pr-1 pl-5 before:absolute before:top-1 before:bottom-1 before:left-[5px] before:w-px before:bg-white/10">
        {decisions.map((d, i) => {
          const a = ACTION[d.action];
          return (
            <li key={i} className="relative text-xs leading-relaxed">
              <span className={`absolute top-1 -left-5 size-[11px] rounded-full border-2 border-ink ${a.dot}`} />
              <p className="font-mono text-[11px] text-white/40">
                <span className={`mr-2 font-semibold ${a.text}`}>{a.label}</span>
                {when(d.at)}
              </p>
              <p className="mt-0.5 text-soft">{d.detail}</p>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** Trades the copied traders made since Bolt started copying them. */
export function BotFeed() {
  const s = useBotState();
  const ago = useAgo();
  if (!s) return null;
  const held = (lead: string) => s.positions.find((p) => p.lead === lead);
  const events = (s.feed ?? []).filter((e) => held(e.lead)).slice(0, 40);
  return (
    <Card>
      <Head title="Trade feed" sub="Every trade the copied traders make, as it happens" right={s.lastTickAt && `checked ${ago(s.lastTickAt)}`} live />
      {events.length ? (
        <ul className="mt-4 max-h-[360px] space-y-1.5 overflow-y-auto pr-1">
          {events.map((e, i) => {
            const open = e.dir.startsWith("Open");
            const pctOfCopy = e.ourPnl / (held(e.lead)?.value ?? 1);
            const tone = e.ourPnl > 0 ? "text-mint" : "text-neg";
            const sign = e.ourPnl > 0 ? "+" : "−";
            return (
              <li key={`${e.at}-${i}`} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 text-xs">
                <Side long={e.dir.includes("Long")} />
                <span className="min-w-0 flex-1 truncate">
                  <a href={hl(e.lead)} target="_blank" rel="noreferrer" className="font-mono text-soft hover:text-mint">{short(e.lead)}</a>
                  <span className="text-white/70"> {e.dir.toLowerCase()} </span>
                  <span className="font-semibold text-white">{e.coin.replace(/^xyz:/, "")}</span>
                  <span className="text-white/45"> · ${fmtCompact(e.notional)}</span>
                </span>
                {!open && e.ourPnl !== 0 && (
                  <span className="shrink-0 text-right font-mono leading-tight">
                    <span className={`block ${tone}`}>{sign}{Math.abs(pctOfCopy * 100).toFixed(Math.abs(pctOfCopy) < 0.0001 ? 4 : 2)}%</span>
                    <span className="block text-[10px] text-white/40">{sign}${Math.abs(pctOfCopy * 10_000).toFixed(2)} per $10K</span>
                  </span>
                )}
                <span className="w-14 shrink-0 text-right font-mono text-[10px] text-white/35">{ago(e.at)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl bg-white/[0.03] px-3 py-3 text-xs text-muted">
          No new trades yet from the current copies. These traders hold positions for hours, so trades come in bursts.
        </p>
      )}
      <p className="mt-3 text-[11px] text-white/35">From the copied wallets on Hyperliquid. % is the effect on that copy; &quot;per $10K&quot; is the same move on $10,000.</p>
    </Card>
  );
}

/** The rules in four cards, for first-time visitors. */
export function BotRules() {
  const e = bot.entry, x = bot.exit;
  const rules = [
    { t: "Picks", d: `Every hour it ranks Strike's copyable traders and copies the best ${bot.maxLeads}: profitable, steady, shallow drawdowns, and not churning their account.` },
    { t: "Watches", d: "Every 15 seconds it reads each trader's trades and open positions on Hyperliquid and updates the result." },
    { t: "Exits", d: `It drops a copy that falls ${x.stopLoss * 100}%, or ${x.trailingStop * 100}% off its best, and swaps out traders who go quiet or slip in score.` },
    { t: "Safety", d: `It skips traders above ${(e.maxRoi30d * 100).toFixed(0)}% a month or with drawdowns over ${e.maxDrawdown30d * 100}%. Live copies get a stop-loss on Strike itself.` },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {rules.map((r, i) => (
        <div key={r.t} className="card rounded-2xl p-5">
          <p className="font-mono text-[11px] text-mint">0{i + 1}</p>
          <p className="mt-2 font-display text-lg font-semibold">{r.t}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{r.d}</p>
        </div>
      ))}
    </div>
  );
}

