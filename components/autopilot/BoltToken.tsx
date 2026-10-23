"use client";

// $BOLT inside Autopilot: the flywheel (how Bolt's trading feeds buybacks and burns), holder access and perks, the Bolt
// Vault that's coming, and the roadmap. Live numbers from the Bolt server, Solada and Cardano; what isn't live yet says so.
import { useEffect, useState } from "react";
import { site } from "@/lib/config";
import { walletBalance } from "@/lib/wallet";
import { SectionHeading } from "../ui";

const BOLT_UNIT = site.token.policyId + site.token.assetNameHex;
const compact = (v: number) => v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
const usd = (v: number) => `$${compact(v)}`;

type Coin = { holders?: number; burned?: number; volumeAda?: number; burns?: { at: number; amount: number }[]; fees?: { total?: number; holders?: number }; copyTrade?: { volume?: number } };
type Impact = { autopilot?: { volumeUsd?: number } };

function useFlywheelNumbers() {
  const [n, setN] = useState<{ coin: Coin | null; autopilotVolume: number | null }>({ coin: null, autopilotVolume: null });
  useEffect(() => {
    let alive = true;
    const get = <T,>(url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);
    void Promise.all([get<Coin>("/api/coin"), get<Impact>(`${site.botApi}/autopilot/impact`)]).then(([coin, impact]) => alive && setN({ coin, autopilotVolume: impact?.autopilot?.volumeUsd ?? null }));
    return () => {
      alive = false;
    };
  }, []);
  return n;
}

/** The $BOLT flywheel: trading $BOLT → half the fees buy STRIKE for holders, half fund the bot on Strike → its profits
 *  buy back and burn $BOLT → and round again. */
export function Flywheel({ id = "flywheel" }: { id?: string }) {
  const { coin, autopilotVolume } = useFlywheelNumbers();
  const strikeVolume = (coin?.copyTrade?.volume ?? 0) + (autopilotVolume ?? 0);
  const lastBurn = coin?.burns?.[0];
  const fee = site.boltAccess.feeBps;
  const steps = [
    {
      n: 1,
      title: "People trade $BOLT",
      body: "Every $BOLT trade pays a fee. Half goes to holders, half to the bot that trades on Strike.",
      stat: coin?.volumeAda ? `₳${compact(coin.volumeAda)}` : "—",
      statLabel: coin?.fees?.total ? `$BOLT traded · ₳${compact(coin.fees.total)} in fees` : "$BOLT traded",
      live: true,
    },
    {
      n: 2,
      title: "Half the fees buy STRIKE for holders",
      body: `Paid out in Strike's own token, so every $BOLT trade is buying pressure on STRIKE. Holding ${compact(site.boltAccess.holderMin)} $BOLT also unlocks Autopilot and its perks.`,
      stat: coin?.fees?.holders ? `₳${compact(coin.fees.holders)}` : "—",
      statLabel: `of STRIKE bought for ${coin?.holders ?? "…"} holders`,
      live: true,
    },
    {
      n: 3,
      title: "Half funds the bot on Strike",
      body: `It copy-trades Strike's best traders with real money, alongside every Autopilot user trading through Bolt${fee ? ` (Bolt's fee on their trades: ${(fee / 100).toFixed(2)}%)` : " (a small Bolt fee on their trades joins after the beta)"}.`,
      stat: coin ? usd(strikeVolume) : "—",
      statLabel: "copy-trading volume on Strike through Bolt",
      live: true,
    },
    {
      n: 4,
      title: "Profits buy back and burn $BOLT",
      body: "The bot's profits buy $BOLT on the market and send it to the burn address, on-chain and checkable. Less $BOLT, and round again.",
      stat: coin?.burned ? compact(coin.burned) : "—",
      statLabel: lastBurn ? `$BOLT burned · last on ${new Date(lastBurn.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "$BOLT burned",
      live: true,
    },
  ];
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-28 px-4 pt-24 sm:px-6">
      <SectionHeading eyebrow="The $BOLT flywheel" title={<>Trading $BOLT <span className="text-gradient">buys STRIKE.</span></>}>
        Half of every $BOLT fee buys STRIKE for holders; the other half trades on Strike, and its profits burn $BOLT. Live numbers.
      </SectionHeading>
      <ol className="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.n} className="card relative flex flex-col rounded-3xl p-6">
            <div className="flex items-center justify-between">
              <span className="grid size-8 place-items-center rounded-full bg-mint font-mono text-sm font-bold text-ink">{s.n}</span>
              <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase ${s.live ? "border-mint/35 text-mint" : "border-gold/35 text-gold"}`}>{s.live ? "Live" : "After the beta"}</span>
            </div>
            <h3 className="mt-4 font-display text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-soft">{s.body}</p>
            <p className="mt-4 font-display text-3xl font-bold text-mint">{s.stat}</p>
            <p className="text-xs text-muted">{s.statLabel}</p>
            {s.n < 4 ? (
              <span className="absolute top-1/2 -right-2.5 hidden size-5 -translate-y-1/2 place-items-center rounded-full bg-ink text-mint lg:grid">→</span>
            ) : (
              <span className="absolute -bottom-2.5 left-1/2 hidden -translate-x-1/2 rounded-full bg-ink px-2 font-mono text-[10px] text-mint lg:block">↺ round again</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Holder access and perks on the dashboard: what this wallet holds, and what holding unlocks. */
export function HolderPerks({ walletKey, demo }: { walletKey: string | null; demo: boolean }) {
  const [held, setHeld] = useState<{ key: string; amount: number } | null>(null);
  useEffect(() => {
    if (!walletKey || demo) return;
    let alive = true;
    walletBalance(walletKey).then(
      (b) => alive && setHeld({ key: walletKey, amount: Number(b.assets.get(BOLT_UNIT) ?? 0n) / 10 ** site.token.decimals }),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [walletKey, demo]);
  const { holderMin, holderOnly } = site.boltAccess;
  const amount = held && held.key === walletKey ? held.amount : null;
  const holder = amount !== null && amount >= holderMin;
  const perks = ["Autopilot access", "No Bolt fee on your trades", "Holder badge on your share cards", "First access to new features"];
  return (
    <section className="card relative overflow-hidden rounded-3xl border border-mint/20 p-5 sm:p-6">
      <div className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-mint/10 blur-[90px]" />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] tracking-wider text-mint uppercase">$BOLT holders</p>
          {holder ? (
            <span className="rounded-full bg-mint px-2.5 py-0.5 text-[11px] font-bold text-ink">✓ Holder</span>
          ) : (
            !holderOnly && <span className="rounded-full border border-gold/35 bg-gold/10 px-2.5 py-0.5 text-[11px] font-semibold text-gold">Open to everyone: launch days</span>
          )}
        </div>
        <h3 className="mt-2 font-display text-xl font-semibold">
          {holder ? "Your perks are on." : `Hold ${compact(holderMin)} $BOLT to keep Autopilot`}
        </h3>
        <p className="mt-1.5 text-sm text-soft">
          {demo
            ? `Autopilot is for $BOLT holders: wallets holding ${compact(holderMin)} $BOLT. During the launch days it's open to everyone.`
            : amount === null
              ? "Reading your wallet…"
              : holder
                ? `You hold ${compact(amount)} $BOLT.`
                : `You hold ${compact(amount)} $BOLT. ${holderOnly ? "Autopilot needs" : "After the launch days, Autopilot needs"} ${compact(holderMin)} in this wallet.`}
        </p>
        <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
          {perks.map((p) => (
            <li key={p} className="flex items-center gap-2 text-soft">
              <span className={holder ? "text-mint" : "text-white/35"}>✓</span>
              {p}
            </li>
          ))}
        </ul>
        {!holder && (
          <a href={site.token.launchpad.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-full bg-mint px-4 py-2 text-sm font-semibold text-ink transition hover:bg-mint-2">
            Get $BOLT on {site.token.launchpad.name} ↗
          </a>
        )}
      </div>
    </section>
  );
}

/** The Bolt Vault, coming: Autopilot's engine as a vault on Strike. */
export function BoltVaultSoon() {
  return (
    <section className="card relative overflow-hidden rounded-3xl border border-white/10 p-5 sm:p-6">
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-mint/12 blur-[100px]" />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] tracking-wider text-mint uppercase">Bolt Vault</p>
          <span className="rounded-full bg-gradient-to-r from-mint to-[#7dd3fc] px-2.5 py-0.5 text-[11px] font-bold text-ink">Coming soon</span>
        </div>
        <h3 className="mt-2 font-display text-xl font-semibold">One deposit. Bolt&apos;s whole engine.</h3>
        <p className="mt-1.5 text-sm text-soft">
          A vault on Strike run by Autopilot&apos;s engine: deposit once, Bolt copies the best traders for the whole vault, and its performance fee buys back and burns $BOLT. Holders
          first.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          {["Held on Strike", "Run by Bolt's engine", "Fee → $BOLT burns", "Holders first"].map((t) => (
            <span key={t} className="rounded-full bg-white/[0.06] px-2.5 py-1 text-soft">
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

type Item = { title: string; body: string };
const ROADMAP: { stage: string; tone: string; items: Item[] }[] = [
  {
    stage: "Live now",
    tone: "text-mint border-mint/35",
    items: [
      { title: "Copy trading on autopilot", body: "Your goal becomes rules; Bolt picks Strike's best traders and keeps every copy inside them." },
      { title: "AI copilot and Autopilot decisions", body: "Plain-words instructions, one-tap actions, and every decision explained step by step." },
      { title: "Targets, pauses and schedules", body: "Stop at +$X or −$X, a daily profit target, pause until Monday, weekdays only." },
      { title: "Trader window and smarter picks", body: "Name and study each trader; picks favour active traders already in a trade, spread over different bets." },
      { title: "Share your setup", body: "A link that starts a friend with your rules, with your verified result." },
      { title: "The $BOLT flywheel", body: "Half of every $BOLT fee buys STRIKE for holders; the other half trades on Strike, and its profits burn $BOLT." },
    ],
  },
  {
    stage: "Next",
    tone: "text-gold border-gold/35",
    items: [
      { title: `Holder access: ${compact(site.boltAccess.holderMin)} $BOLT`, body: "After the launch days, Autopilot and its perks are for $BOLT holders." },
      { title: "Bolt fee → buyback and burn", body: "A small fee on Autopilot trades, all of it buying back and burning $BOLT." },
      { title: "Deposit any Cardano token", body: "Fund your bot with SNEK, NIGHT or any token: swapped to ADA, then into Strike (built, in testing)." },
      { title: "Copilot trades with a second opinion", body: "Describe a trade; Bolt checks it against what Strike's top traders hold, the market and your limits." },
      { title: "Alerts on Telegram", body: "Copies started or stopped, targets hit and Autopilot's decisions, where you already are." },
    ],
  },
  {
    stage: "Exploring",
    tone: "text-[#7dd3fc] border-[#7dd3fc]/35",
    items: [
      { title: "Bolt Vault", body: "Autopilot's engine as a vault on Strike, its fee feeding $BOLT burns." },
      { title: "Social copy trading", body: "Traders post their thesis and analysis; follow the reasoning, discuss it, and copy with conviction. A FOMO-style feed for copy trading." },
      { title: "Liquidation check", body: "Before you apply rules: how far a trade can move against you, and where your stop closes it first." },
      { title: "Weekly review", body: "Every week, a plain report: what earned, what didn't, and one suggestion." },
    ],
  },
];

/** What's next for Bolt Autopilot. */
export function Roadmap() {
  return (
    <section id="roadmap" className="mx-auto max-w-6xl scroll-mt-28 px-4 pt-24 sm:px-6">
      <SectionHeading eyebrow="Roadmap" title={<>What&apos;s live, <span className="text-gradient">what&apos;s next.</span></>}>
        Built in the open on Strike. Exploring means an idea we&apos;re working through, not a promise.
      </SectionHeading>
      <div className="mt-10 grid gap-3 lg:grid-cols-3">
        {ROADMAP.map((col) => (
          <div key={col.stage} className="card rounded-3xl p-5 sm:p-6">
            <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] tracking-wider uppercase ${col.tone}`}>{col.stage}</span>
            <ul className="mt-4 space-y-3.5">
              {col.items.map((it) => (
                <li key={it.title}>
                  <p className="font-semibold">{it.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted">{it.body}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
