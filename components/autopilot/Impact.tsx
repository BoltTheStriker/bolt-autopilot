"use client";

// Bolt × Strike impact: what Bolt brings to Strike, live. Every number comes from Strike's API, the Bolt
// worker or Cardano, and says so; a number we can't read yet shows "—", never a guess.
import Link from "next/link";
import { useEffect, useState } from "react";
import { autopilot, type SlpInfo } from "@/lib/autopilotApi";
import { site } from "@/lib/config";
import { InView, FadeUp } from "../motion";
import { SectionHeading } from "../ui";
import { StrikeMark } from "./strike";

type Impact = {
  at: number;
  autopilot: { accounts: number; botsOn: number; copiesRunning: number; volumeUsd: number; orders: number; tradersRanked: number };
  liveBot: { mode: string; since: number | null; copies: number; budgetUsd: number; profitUsd: number | null };
  holders: { demoBots: number; cupPlayers: number };
};
type Coin = {
  holders?: number;
  volumeAda?: number;
  burned?: number;
  fees?: { holders?: number };
  copyTrade?: { source?: string; volume?: number; trades?: number };
};
type Bench = {
  startedAt: number;
  updatedAt: number;
  curve: { at: number; bolt: number; top: number }[];
  bolt: { ret: number; maxDrawdown: number; retPerDrawdown: number | null; traders: number };
  top: { ret: number; maxDrawdown: number; retPerDrawdown: number | null; traders: number };
};
type BotState = { liveStatus?: { mode?: string; liveSince?: number; account?: { equity?: number; netIn?: number; subs?: number } } };

const num = (v: number | null | undefined, digits = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const usd = (v: number | null | undefined, digits = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `$${num(v, digits)}`);
const compact = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v));
const day = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");

export function ImpactPage() {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [coin, setCoin] = useState<Coin | null>(null);
  const [bot, setBot] = useState<BotState | null>(null);
  const [slp, setSlp] = useState<SlpInfo | null>(null);
  const [bench, setBench] = useState<Bench | null>(null);
  const [at, setAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const get = <T,>(url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);
      const [i, c, b, e, bm] = await Promise.all([
        get<Impact>(`${site.botApi}/autopilot/impact`),
        get<Coin>("/api/coin"),
        get<BotState>(`${site.botApi}/state`),
        autopilot.earn().catch(() => null),
        get<Bench>("/api/benchmark"),
      ]);
      if (!alive) return;
      // A failed refresh keeps the last good numbers; a zero-filled coin answer means its sources failed.
      if (i) setImpact(i);
      if (c?.holders) setCoin(c);
      if (b) setBot(b);
      if (e?.slp) setSlp(e.slp);
      if (bm) setBench(bm);
      setAt(Date.now());
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const live = bot?.liveStatus;
  const liveProfit = impact?.liveBot.profitUsd ?? (live?.account?.equity !== undefined && live.account.netIn ? live.account.equity - live.account.netIn : null);
  const liveSince = impact?.liveBot.since ?? live?.liveSince ?? null;
  const strikeVolume = coin?.copyTrade?.source === "strike" ? coin.copyTrade.volume : null;
  const strikeTrades = coin?.copyTrade?.source === "strike" ? coin.copyTrade.trades : null;

  return (
    <main className="pb-24">
      <section className="relative overflow-hidden pt-36 sm:pt-40">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-[radial-gradient(ellipse_at_top,rgba(78,250,176,0.16),transparent_70%)]" />
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <FadeUp>
            <span className="inline-flex items-center gap-2 rounded-full border border-mint/30 bg-mint/[0.06] px-3.5 py-1.5 text-sm text-soft">
              Bolt × <StrikeMark size={16} /> <span className="font-display font-bold text-white">Strike</span>
            </span>
            <h1 className="mt-6 font-display text-[clamp(2.6rem,6vw,4.5rem)] leading-[1] font-bold tracking-tight">
              What Bolt brings <span className="text-gradient">to Strike.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-soft">
              Users, volume and liquidity that land on Strike Finance through Bolt. Live numbers from Strike&apos;s API, the Bolt server and Cardano, refreshed every minute.
            </p>
            <p className="mt-3 font-mono text-xs text-muted">{at ? `Updated ${new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "Loading…"}</p>
          </FadeUp>

          <div className="mt-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi value={usd(strikeVolume)} label="Copy-trading volume on Strike" source="Strike" />
            <Kpi value={num(strikeTrades)} label="Copy trades executed on Strike" source="Strike" />
            <Kpi value={num(coin?.holders)} label="$BOLT holders" source="Cardano" />
            <Kpi value={`₳${compact(coin?.fees?.holders)}`} label="Fees paid to holders, in STRIKE" source="Solada" />
          </div>
        </div>
      </section>

      <Block id="users" eyebrow="Users" title={<>New Strike users, <span className="text-gradient">through Bolt.</span></>} intro="Every Autopilot user opens (or links) a Strike account through Bolt's builder code, and their copies run on Strike.">
        <Stat value={num(impact?.autopilot.accounts)} label="Strike accounts connected through Bolt" note="builder code bolt_dev" />
        <Stat value={num(impact?.autopilot.botsOn)} label="Autopilot bots switched on" />
        <Stat value={num(impact?.autopilot.copiesRunning)} label="Autopilot copies running now" />
        <Stat value={num(impact?.holders.demoBots)} label="Demo bots run by $BOLT holders" note="on live Strike traders" />
        <Stat value={num(impact?.holders.cupPlayers)} label="Bot Cup players" />
        <Stat value={num(impact?.autopilot.tradersRanked)} label="Strike traders ranked right now" />
      </Block>

      <Block id="volume" eyebrow="Volume" title={<>Trading volume <span className="text-gradient">on Strike.</span></>} intro="Copy trades placed through Strike's engine by the live $BOLT bot and Autopilot users.">
        <Stat value={usd(strikeVolume)} label="Live $BOLT bot account, all copies" note={`${num(strikeTrades)} trades · Strike stats`} />
        <Stat value={usd(impact?.autopilot.volumeUsd)} label="Autopilot users' copies" note={`${num(impact?.autopilot.orders)} filled orders`} />
        <Stat value={`₳${compact(coin?.volumeAda)}`} label="$BOLT token trading volume" note="the community behind the bot" />
      </Block>

      <section id="benchmark" className="mx-auto max-w-6xl scroll-mt-28 px-4 pt-24 sm:px-6">
        <SectionHeading eyebrow="Proof, in public" title={<>Bolt vs <span className="text-gradient">the leaderboard.</span></>}>
          Two $1,000 paper portfolios on Strike&apos;s live data, tracked forward from the day we started: Bolt&apos;s picks against copying the top 10 traders by 30-day return, the way most
          people copy by hand.
        </SectionHeading>
        <Benchmark bench={bench} />
      </section>

      <Block id="bot" eyebrow="The live bot" title={<>Real money, <span className="text-gradient">running on Strike.</span></>} intro="The same engine as Autopilot, copy-trading on Strike with the $BOLT team's own money.">
        <Stat value={day(liveSince)} label="Live with real money since" />
        <Stat value={num(impact?.liveBot.copies ?? live?.account?.subs)} label="Copies running now" />
        <Stat value={liveProfit === null ? "—" : `${liveProfit >= 0 ? "+" : "−"}${usd(Math.abs(liveProfit), 2)}`} label="Profit so far" note="equity minus money moved in, from Strike" />
      </Block>

      <Block id="realfi" eyebrow="Liquidity · RealFi" title={<>RealFi liquidity <span className="text-gradient">on Strike.</span></>} intro="Bolt brings RealFi's sUSDrf into Strike's Borrow & Earn; one-tap pledging arrives with Strike's RealFi API.">
        <Stat value={slp?.susdrf ? `${(slp.susdrf.yieldApr * 100).toFixed(1)}%` : "—"} label="sUSDrf yield (Strike-wide)" note="RealFi's 28-day exchange-rate growth" />
        <Stat value={slp ? `${(slp.apr * 100).toFixed(1)}%` : "—"} label="SLP APR today (Strike-wide)" />
        <Stat value={slp?.susdrf ? usd(slp.susdrf.debt) : "—"} label="Drawn into SLP against sUSDrf (Strike-wide)" note={slp?.susdrf ? `${slp.susdrf.openLines} open lines` : undefined} />
      </Block>

      <Block id="community" eyebrow="Community" title={<>A community that <span className="text-gradient">grows Strike.</span></>} intro="$BOLT pays half of its fees to holders in STRIKE, and the bot's profits buy back and burn $BOLT.">
        <Stat value={num(coin?.holders)} label="$BOLT holders" />
        <Stat value={`₳${compact(coin?.fees?.holders)}`} label="Fees paid to holders in STRIKE" />
        <Stat value={compact(coin?.burned)} label="$BOLT burned" />
      </Block>

      <section className="mx-auto max-w-6xl px-4 pt-20 sm:px-6">
        <div className="card flex flex-wrap items-center justify-between gap-4 rounded-3xl p-6 sm:p-8">
          <p className="max-w-xl text-soft">Every Bolt user is a Strike user. Try Autopilot with demo money in a minute, or connect your wallet.</p>
          <Link href="/autopilot/app?demo=1" className="rounded-full bg-mint px-7 py-3 font-semibold text-ink transition hover:bg-mint-2">
            Try the demo →
          </Link>
        </div>
        <p className="mt-6 text-xs leading-relaxed text-white/40">
          Sources: Strike Finance public API (copy-trading stats, Earn and Borrow & Earn data), the Bolt worker (Autopilot accounts, copies and volume; no personal data shown), Solada and Cardano (holders, fees,
          burns). Bolt is a community project built on Strike; it is not made or endorsed by Strike Finance or RealFi.
        </p>
      </section>
    </main>
  );
}

function Benchmark({ bench }: { bench: Bench | null }) {
  if (!bench) return <div className="mt-10 h-72 animate-pulse rounded-3xl bg-white/[0.04]" />;
  const started = new Date(bench.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const young = bench.updatedAt - bench.startedAt < 24 * 3_600_000 || bench.curve.length < 4;
  const pts = (k: "bolt" | "top") => {
    const vals = bench.curve.flatMap((p) => [p.bolt, p.top]);
    const lo = Math.min(...vals, 990), hi = Math.max(...vals, 1010);
    return bench.curve.map((p, i) => `${(i / Math.max(1, bench.curve.length - 1)) * 100},${38 - ((p[k] - lo) / (hi - lo)) * 34}`).join(" ");
  };
  const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;
  const side = (name: string, s: Bench["bolt"], mint: boolean, how: string) => (
    <div className={`card rounded-3xl p-6 ${mint ? "border border-mint/30" : ""}`}>
      <p className={`font-mono text-xs tracking-wider uppercase ${mint ? "text-mint" : "text-muted"}`}>{name}</p>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div><p className="text-xs text-muted">Return</p><p className={`mt-1 font-display text-2xl font-bold ${s.ret >= 0 ? "text-white" : "text-neg"}`}>{young ? "—" : pct(s.ret)}</p></div>
        <div><p className="text-xs text-muted">Worst drop</p><p className="mt-1 font-display text-2xl font-bold">{young ? "—" : `−${(s.maxDrawdown * 100).toFixed(1)}%`}</p></div>
        <div><p className="text-xs text-muted">Return per drop</p><p className="mt-1 font-display text-2xl font-bold">{young || s.retPerDrawdown === null ? "—" : s.retPerDrawdown.toFixed(2)}</p></div>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted">{how} · holding {s.traders} now</p>
    </div>
  );
  return (
    <div className="mt-10 space-y-3">
      <div className="card rounded-3xl p-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <span className="flex items-center gap-2"><span className="h-0.5 w-5 rounded bg-mint" />Bolt&apos;s picks</span>
          <span className="flex items-center gap-2"><span className="h-0.5 w-5 rounded bg-white/45" />Top 10 by 30-day return</span>
          <span className="ml-auto font-mono text-muted">Since {started} · updated every 6 hours</span>
        </div>
        {young ? (
          <p className="mt-6 rounded-2xl bg-white/[0.03] px-4 py-6 text-center text-sm text-soft">
            Just started on {started}. Both portfolios hold their first picks; the first numbers show after a full day, and the comparison means more every week.
          </p>
        ) : (
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-4 h-56 w-full" role="img" aria-label="Bolt's picks and the top 10 over time">
            <polyline points={pts("top")} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
            <polyline points={pts("bolt")} fill="none" stroke="#4efab0" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {side("Bolt's picks", bench.bolt, true, "Bolt's engine: its entry rules, a stop-loss per copy, rotation")}
        {side("Top 10 by 30-day return", bench.top, false, "Equal parts, re-picked daily, no stop-loss")}
      </div>
      <p className="text-xs leading-relaxed text-white/40">
        Paper portfolios on Strike&apos;s public data: each copy follows its trader&apos;s profit as a share of their account, the way Strike sizes copies, and both pay the same taker fee and slippage on
        every mirrored trade. Not real trades; past results don&apos;t promise future ones.
      </p>
    </div>
  );
}

function Kpi({ value, label, source }: { value: string; label: string; source: string }) {
  return (
    <InView className="card rounded-3xl border border-mint/20 p-5 sm:p-6">
      <p className="font-display text-3xl font-bold text-mint sm:text-4xl">{value}</p>
      <p className="mt-2 text-sm text-soft">{label}</p>
      <p className="mt-1 font-mono text-[10px] tracking-wider text-white/35 uppercase">{source}</p>
    </InView>
  );
}

function Block({ id, eyebrow, title, intro, children }: { id: string; eyebrow: string; title: React.ReactNode; intro: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-28 px-4 pt-24 sm:px-6">
      <SectionHeading eyebrow={eyebrow} title={title}>
        {intro}
      </SectionHeading>
      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <InView className="card rounded-3xl p-6">
      <p className="font-display text-4xl font-bold text-white">{value}</p>
      <p className="mt-2 text-sm text-soft">{label}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </InView>
  );
}
