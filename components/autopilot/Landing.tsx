"use client";

// The Autopilot product page: what it does, how your money stays safe, the copilot, and the setup itself (#start).
import Image from "next/image";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { autopilot, type AutoStatus, type SlpInfo } from "@/lib/autopilotApi";
import { site } from "@/lib/config";
import { describeRules, defaultRules, RISK_LEVELS, type Goal, type Risk } from "@/worker/autopilot";
import { Faq } from "../Faq";
import { EASE, FadeUp, InView } from "../motion";
import { SectionHeading } from "../ui";
import { StrikeMark, StrikeWordmark } from "./strike";
import { SoonLink } from "./SoonLink";
import { useEggTaps } from "./WalletEgg";

const ic = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);
const I = {
  wallet: ic(<path d="M3 7a2 2 0 012-2h13v4M3 7v10a2 2 0 002 2h15V9H5a2 2 0 01-2-2zM16 14h.01" />),
  coin: ic(<><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9 9.5h4.5a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3H15" /></>),
  target: ic(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>),
  bolt: ic(<path d="M13 2L4 14h7l-1 8 9-12h-7z" />),
  shield: ic(<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />),
  key: ic(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></>),
  boxes: ic(<path d="M3 8l4-2 4 2v5l-4 2-4-2zM13 8l4-2 4 2v5l-4 2-4-2zM8 15l4-2 4 2v5l-4 2-4-2z" />),
  stop: ic(<><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" /><path d="M9 9h6v6H9z" /></>),
  calendar: ic(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4" /></>),
  power: ic(<path d="M12 3v9M6.3 6.3a8 8 0 1011.4 0" />),
  spark: ic(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />),
  arrow: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="transition group-hover:translate-x-0.5"><path d="M3 8h10M9 4l4 4-4 4" /></svg>,
};

export function AutopilotLanding() {
  const [status, setStatus] = useState<AutoStatus | null>(null);
  const [slp, setSlp] = useState<SlpInfo | null>(null);
  useEffect(() => {
    autopilot.status().then(setStatus, () => {});
    autopilot.earn().then((r) => setSlp(r.slp), () => {});
  }, []);
  return (
    <main>
      <Hero status={status} />
      <Strip status={status} slp={slp} />
      <BoltOnStrike />
      <How />
      <GoalToRules />
      <Earn slp={slp} />
      <Safety />
      <Copilot />
      <AutoFaq />
      <Final />
    </main>
  );
}

/* ---------------------------------------------------------------- hero */

function Hero({ status }: { status: AutoStatus | null }) {
  const eggTap = useEggTaps(); // 5 quick clicks on the logo: a hidden concept video
  return (
    <section className="relative overflow-hidden pt-32 pb-12 sm:pt-40">
      <FadeUp className="pointer-events-none absolute inset-0" aria-hidden y={0} blur={0} duration={1.8}>
        <div className="streak top-[6%] -left-[20%] h-40 w-[90%]" style={{ ["--r" as string]: "-14deg" }} />
        <div className="streak top-[30%] -right-[25%] h-56 w-[80%] [animation-delay:-7s]" style={{ ["--r" as string]: "20deg" }} />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,#0a0a0a_75%)]" />
        <div className="bg-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_top,#000_20%,transparent_70%)]" />
      </FadeUp>

      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <FadeUp delay={0.1} y={16} className="flex flex-wrap items-center gap-2">
            <span className="glass inline-flex items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5 text-sm text-soft">
              <button type="button" onClick={eggTap} aria-label="Bolt Autopilot" className="grid size-6 place-items-center rounded-full bg-mint text-ink">
                {I.bolt}
              </button>
              Bolt Autopilot
              <span className="rounded-full border border-gold/40 px-2 py-0.5 font-mono text-[10px] tracking-wider text-gold uppercase">
                Beta{status?.network === "testnet" ? " · testnet" : ""}
              </span>
            </span>
            <StrikeBadge />
          </FadeUp>
          <FadeUp delay={0.2}>
            <h1 className="mt-6 font-display text-[clamp(2.6rem,5.2vw,4.25rem)] leading-[0.98] font-bold tracking-[-0.03em]">
              Say your goal.
              <br />
              <span className="text-gradient">The bot trades it.</span>
            </h1>
          </FadeUp>
          <FadeUp delay={0.35}>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-pretty text-soft">
              Copy trading on <span className="font-semibold text-white">Strike Finance</span>, Cardano&apos;s perps exchange, on autopilot. Bolt picks the best traders for you and
              keeps every copy inside rules you choose in plain words. Your money stays in your own Strike account, and the bot can never withdraw it.
            </p>
          </FadeUp>
          <FadeUp delay={0.5} className="mt-9 flex flex-col gap-3 sm:flex-row">
            <SoonLink href="/autopilot/app" className="group mint-glow inline-flex items-center justify-center gap-2 rounded-full bg-mint px-8 py-3.5 font-semibold text-ink transition hover:-translate-y-0.5 hover:bg-mint-2">
              Launch Autopilot {I.arrow}
            </SoonLink>
            <SoonLink href="/autopilot/app?demo=1" soon="Demo opening soon" className="glass inline-flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-center font-semibold transition hover:-translate-y-0.5 hover:bg-white/10">
              Try with demo money
            </SoonLink>
          </FadeUp>
          <FadeUp delay={0.6}>
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              {["Non-custodial", "Stop-loss on every copy", "Stop anytime"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <span className="text-mint [&>svg]:size-4">{I.shield}</span>
                  {t}
                </li>
              ))}
            </ul>
          </FadeUp>
        </div>
        <FadeUp delay={0.4} y={40} blur={14} duration={1.1}>
          <HeroMock />
        </FadeUp>
      </div>
    </section>
  );
}

// An illustration of the dashboard (made-up traders and numbers), gently animated.
const MOCK = [
  { lead: "0x7a21…d9f4", amount: 75, pnl: 6.42, chips: [["BTC", true], ["GOLD", true]] },
  { lead: "0x3fd0…0e58", amount: 75, pnl: -1.87, chips: [["ETH", false]] },
  { lead: "0xb95e…d917", amount: 75, pnl: 2.15, chips: [["SPX", true], ["NVDA", true]] },
] as const;

function HeroMock() {
  const line = "M0 52 C 20 50, 30 44, 48 46 S 78 36, 96 38 S 128 26, 146 30 S 178 18, 200 14";
  return (
    <div className="relative mx-auto max-w-[480px]">
      <div className="absolute -inset-8 rounded-full bg-mint/10 blur-3xl" />
      <div className="card relative rounded-[1.75rem] border border-white/10 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.6)] sm:p-6">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 font-display font-semibold">
            <span className="size-2 animate-pulse rounded-full bg-mint" /> Your bot is running
          </p>
          <span className="rounded-full bg-white/[0.06] px-2.5 py-1 font-mono text-[10px] text-muted">Medium · Balanced</span>
        </div>
        <div className="mt-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs text-muted">Profit on copies</p>
            <p className="font-mono text-4xl text-mint">+$6.70</p>
          </div>
          <svg viewBox="0 0 200 60" className="h-14 w-40">
            <defs>
              <linearGradient id="ap-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#4efab0" stopOpacity="0.35" />
                <stop offset="1" stopColor="#4efab0" stopOpacity="0" />
              </linearGradient>
            </defs>
            <motion.path d={`${line} L200 60 L0 60 Z`} fill="url(#ap-fill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4, duration: 0.8 }} />
            <motion.path d={line} fill="none" stroke="#4efab0" strokeWidth="2.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.7, duration: 1.4, ease: EASE }} />
          </svg>
        </div>
        <ul className="mt-5 space-y-2">
          {MOCK.map((c, i) => (
            <motion.li key={c.lead} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.9 + i * 0.15, duration: 0.5, ease: EASE }} className="rounded-2xl bg-white/[0.04] p-3">
              <div className="flex items-center gap-3 font-mono text-sm">
                <span className="text-soft">{c.lead}</span>
                <span className="ml-auto text-white/50">${c.amount}</span>
                <span className={`w-16 text-right ${c.pnl >= 0 ? "text-mint" : "text-neg"}`}>
                  {c.pnl >= 0 ? "+" : "−"}${Math.abs(c.pnl).toFixed(2)}
                </span>
              </div>
              <div className="mt-1.5 flex gap-1">
                {c.chips.map(([m, long]) => (
                  <span key={m} className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${long ? "bg-mint/12 text-mint" : "bg-neg/12 text-neg"}`}>
                    {m} {long ? "L" : "S"}
                  </span>
                ))}
              </div>
            </motion.li>
          ))}
        </ul>
        <p className="mt-4 text-center text-[10px] tracking-wide text-white/30 uppercase">Illustration</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: [0, -6, 0] }}
        transition={{ opacity: { delay: 1.6 }, y: { delay: 1.6, duration: 5, repeat: Infinity, ease: "easeInOut" } }}
        className="absolute -bottom-8 left-3 max-w-[230px] sm:-left-10 rounded-2xl border border-white/10 bg-[#121614] p-3 text-xs shadow-2xl sm:-left-10"
      >
        <p className="flex items-center gap-1.5 font-semibold text-gold [&>svg]:size-3.5">{I.stop} Stop-loss hit</p>
        <p className="mt-1 text-muted">
          Copy of 0x5c8e…a3b1 closed at <span className="whitespace-nowrap">−$11</span>. The rest kept running.
        </p>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: [0, 6, 0] }}
        transition={{ opacity: { delay: 2 }, y: { delay: 2, duration: 6, repeat: Infinity, ease: "easeInOut" } }}
        className="absolute -top-16 -right-8 hidden max-w-[220px] rounded-2xl border border-mint/30 bg-[#0f1714] p-3 text-xs shadow-2xl sm:block"
      >
        <p className="flex items-center gap-1.5 font-semibold text-mint [&>svg]:size-3.5">{I.spark} Copilot</p>
        <p className="mt-1 text-soft">&ldquo;Switched you to Steady: smaller drops, same budget.&rdquo;</p>
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- facts strip */

function Strip({ status, slp }: { status: AutoStatus | null; slp: SlpInfo | null }) {
  const items = [
    status?.traders ? { v: String(status.traders), l: "traders ranked right now" } : { v: "24/7", l: "watching the traders for you" },
    { v: "31", l: "markets: crypto, stocks, gold, oil" },
    slp ? { v: `${(slp.apr * 100).toFixed(0)}%`, l: "SLP APR today, for your reserve" } : { v: "1", l: "signature to get started" },
    { v: "0", l: "ways for the bot to withdraw" },
  ];
  return (
    <section className="relative mx-auto max-w-6xl px-4 pt-24 sm:px-6">
      <InView className="glass grid grid-cols-2 gap-y-6 rounded-3xl px-4 py-6 lg:grid-cols-4">
        {items.map((it, i) => (
          <div key={it.l} className={`px-3 text-center ${i ? "lg:border-l lg:border-white/10" : ""}`}>
            <p className="font-display text-4xl font-bold text-white">{it.v}</p>
            <p className="mt-1 text-sm text-muted">{it.l}</p>
          </div>
        ))}
      </InView>
    </section>
  );
}

/* ---------------------------------------------------------------- built on Strike */

/** "Built on Strike" pill: Bolt runs on Strike Finance through its builder program (text only: no Strike logo without their OK). */
export function StrikeBadge({ className = "" }: { className?: string }) {
  return (
    <a
      href="https://strikefinance.org"
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1.5 rounded-full border border-mint/30 bg-mint/[0.06] px-3.5 py-1.5 text-sm text-soft transition hover:border-mint/60 hover:text-white ${className}`}
    >
      Built on <StrikeMark size={18} />
      <span className="font-display font-bold tracking-tight text-white">Strike</span>
      <span className="text-xs text-mint">↗</span>
    </a>
  );
}

const ROLES = [
  { who: "You", what: ["Connect your Cardano wallet", "Say your goal: risk, style, markets", "Stop, change or withdraw anytime"], tone: "border-white/10" },
  { who: "Bolt Autopilot", what: ["Ranks Strike's top traders every hour", "Turns your goal into hard limits", "Copilot and RealFi Earn"], tone: "border-mint/40 bg-mint/[0.05]" },
  { who: "Strike Finance", what: ["Your account and your money", "The copy-trading engine and stop-losses", "31 markets: crypto, stocks, gold, oil", "Withdrawals to your wallet"], tone: "border-white/10" },
];

function BoltOnStrike() {
  return (
    <section id="strike" className="relative mx-auto max-w-6xl scroll-mt-28 px-4 pt-32 sm:px-6">
      <SectionHeading eyebrow="Built on Strike" title={<>Bolt is the autopilot. <span className="text-gradient">Strike is the engine.</span></>}>
        Everything runs on Strike Finance through its builder program: your account, your money, every copy and every limit. Bolt adds the brains on top.
      </SectionHeading>
      <div className="mt-12 grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1.15fr_auto_1fr]">
        {ROLES.map((r, i) => (
          <div key={r.who} className="contents">
            {i > 0 && (
              <div className="flex items-center justify-center text-2xl text-mint/70" aria-hidden>
                <span className="hidden lg:block">→</span>
                <span className="lg:hidden">↓</span>
              </div>
            )}
            <InView delay={i * 0.1} className={`card rounded-3xl border p-6 ${r.tone}`}>
              <div className="flex h-7 items-center font-display text-xl font-bold">{r.who === "Strike Finance" ? <StrikeWordmark height={20} /> : r.who}</div>
              <ul className="mt-4 space-y-2 text-sm text-soft">
                {r.what.map((w) => (
                  <li key={w} className="flex gap-2">
                    <span className="text-mint">›</span>
                    {w}
                  </li>
                ))}
              </ul>
            </InView>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-muted">
        Every Bolt user is a Strike user: new accounts, copy-trading volume and RealFi liquidity land on Strike. Bolt is a community project, not made by Strike.{" "}
        <SoonLink href="/autopilot/impact" soon="Live numbers soon" className="inline-flex items-center gap-1 text-mint hover:underline">
          See the live numbers →
        </SoonLink>
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- how it works */

const STEPS = [
  { icon: I.wallet, t: "Connect", d: "Sign once with your Cardano wallet. It opens your own Strike account and links it to Bolt. No transaction, no fee." },
  { icon: I.coin, t: "Fund", d: "Send ADA from your wallet into your Strike account in one transaction. Already funded on Strike? Skip it." },
  { icon: I.target, t: "Set your goal", d: "Pick your risk, your goal and the markets you like. The bot turns them into stop-losses, leverage caps and trader picks." },
  { icon: I.bolt, t: "Go live", d: "Switch it on. The bot copies the best-fitting traders, swaps out the ones that fade, and reports everything it does." },
];

function How() {
  return (
    <section id="how" className="relative mx-auto max-w-6xl scroll-mt-28 px-4 pt-32 sm:px-6">
      <SectionHeading eyebrow="How it works" title={<>Four steps. <span className="text-gradient">About two minutes.</span></>}>
        No exchange account to set up, no strategy to code. If you can use a Cardano wallet, you can run a trading bot.
      </SectionHeading>
      <div className="relative mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="pointer-events-none absolute top-11 right-[12%] left-[12%] hidden h-px bg-gradient-to-r from-mint/0 via-mint/40 to-mint/0 lg:block" />
        {STEPS.map((s, i) => (
          <InView key={s.t} delay={i * 0.1} className="card relative rounded-3xl p-6">
            <div className="flex items-center gap-3">
              <span className="relative grid size-11 place-items-center rounded-2xl bg-mint text-ink shadow-[0_0_30px_rgba(78,250,176,0.35)]">{s.icon}</span>
              <span className="font-mono text-xs text-muted">0{i + 1}</span>
            </div>
            <h3 className="mt-5 font-display text-xl font-semibold">{s.t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
          </InView>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- goal → rules */

const RISK_NAMES: Record<Risk, string> = { low: "Low", medium: "Medium", high: "High" };
const GOAL_NAMES: Record<Goal, string> = { steady: "Steady", balanced: "Balanced", growth: "Growth" };

function GoalToRules() {
  const [risk, setRisk] = useState<Risk>("medium");
  const [goal, setGoal] = useState<Goal>("balanced");
  const lv = RISK_LEVELS[risk];
  const rules = { ...defaultRules(300, risk), goal };
  const facts = [
    { v: `${Math.round(lv.deploy * 100)}%`, l: "of your budget working" },
    { v: `${lv.maxLeverage}x`, l: "leverage cap on every trade" },
    { v: `−${Math.round(lv.stopLossPct * 100)}%`, l: "each copy stops at" },
    { v: `−${Math.round(lv.dailyLossPct * 100)}%`, l: "in a day pauses everything" },
  ];
  const pill = (on: boolean) => `rounded-full px-4 py-2 text-sm font-semibold transition ${on ? "bg-mint text-ink" : "text-soft hover:text-white"}`;
  return (
    <section id="rules" className="relative mx-auto max-w-6xl scroll-mt-28 px-4 pt-32 sm:px-6">
      <SectionHeading eyebrow="Goal-based rules" title={<>You pick the goal. <span className="text-gradient">It writes the rules.</span></>}>
        Every choice becomes hard limits the bot sets on Strike, on every copy. Try it:
      </SectionHeading>
      <InView className="card relative mt-12 overflow-hidden rounded-[2rem] p-6 sm:p-10">
        <div className="pointer-events-none absolute -top-32 -right-24 h-80 w-80 rounded-full bg-mint/12 blur-[110px]" />
        <div className="relative grid gap-10 lg:grid-cols-[1fr_1.3fr] lg:items-center">
          <div className="space-y-6">
            <div>
              <p className="mb-2 text-sm text-muted">How much risk?</p>
              <div className="glass inline-flex rounded-full p-1">
                {(Object.keys(RISK_NAMES) as Risk[]).map((r) => (
                  <button key={r} onClick={() => setRisk(r)} className={pill(risk === r)}>
                    {RISK_NAMES[r]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm text-muted">Your goal</p>
              <div className="glass inline-flex rounded-full p-1">
                {(Object.keys(GOAL_NAMES) as Goal[]).map((g) => (
                  <button key={g} onClick={() => setGoal(g)} className={pill(goal === g)}>
                    {GOAL_NAMES[g]}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-sm leading-relaxed text-muted">
              {goal === "steady" && "Steady favours the calmest of the good traders: the ones with the smallest drops."}
              {goal === "balanced" && "Balanced takes the bot's best picks by return for every unit of risk, the same score Bolt's own live bot uses."}
              {goal === "growth" && "Growth leans toward good traders with more upside, and accepts bigger swings for it."}
            </p>
          </div>
          <div>
            <p className="font-mono text-xs tracking-wider text-mint uppercase">Your bot will</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {facts.map((f) => (
                <div key={f.l} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <motion.p key={f.v} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="font-mono text-3xl text-white">
                    {f.v}
                  </motion.p>
                  <p className="mt-1 text-xs text-muted">{f.l}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-white/40">Example with a $300 budget: {describeRules(rules)}.</p>
          </div>
        </div>
      </InView>
    </section>
  );
}

/* ---------------------------------------------------------------- earn (RealFi) */

function Earn({ slp }: { slp: SlpInfo | null }) {
  const apr = slp ? `${(slp.apr * 100).toFixed(1)}%` : "—";
  return (
    <section id="earn" className="relative mx-auto max-w-6xl scroll-mt-28 px-4 pt-32 sm:px-6">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <InView>
          <span className="inline-flex items-center gap-2 rounded-full border border-mint/25 bg-mint/8 px-3 py-1 font-mono text-xs tracking-wider text-mint uppercase">
            <span className="size-1.5 rounded-full bg-mint" />
            Earn · RealFi on Strike
          </span>
          <h2 className="mt-5 font-display text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl">
            Trading money trades. <span className="text-gradient">Spare money earns.</span>
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            Your bot never puts all of your budget to work. The reserve can earn in Strike&apos;s own vault, SLP, and with Borrow &amp; Earn, RealFi&apos;s sUSDrf earns twice: its own yield, plus SLP&apos;s.
          </p>
          <ul className="mt-7 space-y-4">
            {[
              ["One view of your money", "Copies, reserve and SLP position side by side in the app."],
              ["Live rates", "SLP's APR comes straight from Strike, refreshed through the day."],
              ["RealFi in a few taps", "Deposit sUSDrf from your wallet and pledge it in Borrow & Earn from Bolt, then withdraw back to your wallet from Bolt too."],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-mint text-ink [&>svg]:size-3.5">{I.coin}</span>
                <span>
                  <span className="font-semibold">{t}</span>
                  <span className="mt-0.5 block text-sm text-muted">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </InView>
        <InView delay={0.1} className="card relative overflow-hidden rounded-[1.75rem] border border-mint/20 p-6 sm:p-7">
          <div className="pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full bg-mint/15 blur-[90px]" />
          <p className="relative text-xs text-muted">Example: Low risk, $1,000 budget</p>
          <div className="relative mt-4 flex h-4 overflow-hidden rounded-full">
            <motion.span className="bg-mint" initial={{ width: 0 }} whileInView={{ width: "50%" }} viewport={{ once: true }} transition={{ duration: 0.9 }} />
            <motion.span className="bg-[#2bc485]/60" initial={{ width: 0 }} whileInView={{ width: "50%" }} viewport={{ once: true }} transition={{ duration: 0.9, delay: 0.3 }} />
          </div>
          <div className="relative mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <p className="flex items-center gap-2 text-xs text-muted">
                <span className="size-2 rounded-full bg-mint" /> Copy trading
              </p>
              <p className="mt-1 font-mono text-2xl">$500</p>
              <p className="text-[11px] text-muted">3 traders, stops at −10%</p>
            </div>
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <p className="flex items-center gap-2 text-xs text-muted">
                <span className="size-2 rounded-full bg-[#2bc485]/60" /> Earn in SLP
              </p>
              <p className="mt-1 font-mono text-2xl">$500</p>
              <p className="text-[11px] text-muted">at {apr} APR today</p>
            </div>
          </div>
          <div className="relative mt-4 rounded-2xl border border-mint/25 bg-mint/[0.05] p-4">
            <p className="text-xs text-muted">SLP · Strike&apos;s market-making vault</p>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-mono text-4xl text-mint">{apr}</span>
              <span className="text-xs text-muted">APR today{slp ? ` · $${(slp.equity / 1e6).toFixed(2)}M in vault · ${slp.lockupDays}-day lockup` : ""}</span>
            </div>
          </div>
          {slp?.susdrf && (
            <div className="relative mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs text-muted">RealFi sUSDrf pledged in Borrow &amp; Earn</p>
              <div className="mt-1 flex items-baseline gap-2 font-mono">
                <span className="text-2xl text-mint">{(slp.susdrf.yieldApr * 100).toFixed(1)}%</span>
                <span className="text-white/40">+</span>
                <span className="text-2xl text-mint">{apr}</span>
                <span className="font-sans text-xs text-muted">same dollars, no interest on the credit</span>
              </div>
            </div>
          )}
          <p className="relative mt-3 text-[11px] text-white/40">Live from Strike&apos;s API. Variable; SLP can lose money and sUSDrf takes losses first if RealFi&apos;s loans go bad.</p>
        </InView>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- safety */

const SAFETY = [
  { icon: I.wallet, t: "Your account, your money", d: "Funds sit in your own Strike account, not with Bolt. Withdraw to your wallet whenever you like." },
  { icon: I.key, t: "A key that can only trade", d: "The bot's key can open and close copies. Withdrawals always need your wallet's signature. Its key is stored encrypted." },
  { icon: I.boxes, t: "Every copy in its own box", d: "Each copied trader runs in an isolated sub-account on Strike, so one bad trader can't drag down the rest." },
  { icon: I.stop, t: "Stop-loss on every copy", d: "Set on Strike itself when the copy starts. If a trader goes wrong, the copy closes at your limit." },
  { icon: I.calendar, t: "A daily loss limit", d: "If the whole bot is down more than your daily limit, it stops copying until the next day." },
  { icon: I.power, t: "One button to stop", d: "Switch the bot off anytime: its copies close at market and your balance is yours to withdraw." },
];

function Safety() {
  return (
    <section id="safety" className="relative mx-auto max-w-6xl scroll-mt-28 px-4 pt-32 sm:px-6">
      <SectionHeading eyebrow="Built for bad days" title={<>So a bad trade <span className="text-gradient">stays small.</span></>}>
        Copy trading can lose money. Autopilot is designed so that when it does, the damage is capped by limits you chose.
      </SectionHeading>
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SAFETY.map((s, i) => (
          <InView key={s.t} delay={(i % 3) * 0.08} className="card group rounded-3xl p-6 transition hover:border-mint/25">
            <span className="grid size-11 place-items-center rounded-2xl bg-mint/10 text-mint transition group-hover:bg-mint group-hover:text-ink">{s.icon}</span>
            <h3 className="mt-5 font-display text-lg font-semibold">{s.t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
          </InView>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- copilot */

const CHAT: { me?: boolean; text: ReactNode }[] = [
  { me: true, text: "I want steady growth. I can't stomach more than a 10% drop." },
  {
    text: (
      <>
        Then I&apos;d go <b className="text-white">Low risk</b> with the <b className="text-white">Steady</b> goal: half your budget working, leverage capped at 3x, and
        every copy stops at −10%. If the whole bot loses 5% in a day, it pauses until tomorrow.
      </>
    ),
  },
  { me: true, text: "Only stocks and gold, no meme coins." },
  { text: <>Done: real-world markets only, so S&amp;P 500, Nasdaq, gold, oil and big stocks. Want me to apply it?</> },
];

function Copilot() {
  return (
    <section id="copilot" className="relative mx-auto max-w-6xl scroll-mt-28 px-4 pt-32 sm:px-6">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <InView>
          <span className="inline-flex items-center gap-2 rounded-full border border-mint/25 bg-mint/8 px-3 py-1 font-mono text-xs tracking-wider text-mint uppercase">
            <span className="size-1.5 rounded-full bg-mint" />
            AI copilot
          </span>
          <h2 className="mt-5 font-display text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl">
            Not sure what to pick? <span className="text-gradient">Just ask.</span>
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted">Tell the copilot what you want in your own words. It suggests rules for your goal, explains every choice and changes nothing without your OK.</p>
          <ul className="mt-7 space-y-4">
            {[
              ["Rules from a sentence", "“Steady, no more than 10% down, stocks only” becomes a full setup."],
              ["Explains its picks", "Ask why a trader was chosen or what a limit does, and get a straight answer."],
              ["Autopilot mode", "Let it fine-tune your setup as markets change, always inside the limits you set and never above them."],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-mint text-ink [&>svg]:size-3.5">{I.spark}</span>
                <span>
                  <span className="font-semibold">{t}</span>
                  <span className="mt-0.5 block text-sm text-muted">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </InView>
        <InView delay={0.1} className="card relative rounded-[1.75rem] border border-mint/20 p-5 sm:p-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <p className="flex items-center gap-2 font-display font-semibold">
              <span className="grid size-8 place-items-center rounded-full bg-mint text-ink [&>svg]:size-4">{I.spark}</span> Bolt Copilot
            </p>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 font-mono text-[10px] text-muted uppercase">Preview</span>
          </div>
          <div className="mt-5 space-y-3">
            {CHAT.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + i * 0.45, duration: 0.4, ease: EASE }}
                className={`flex ${m.me ? "justify-end" : ""}`}
              >
                <p className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.me ? "rounded-br-md bg-mint text-ink" : "rounded-bl-md bg-white/[0.06] text-soft"}`}>{m.text}</p>
              </motion.div>
            ))}
            <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 2.2 }} className="flex gap-2 pt-1">
              <span className="rounded-full bg-mint px-4 py-2 text-sm font-semibold text-ink">Apply these rules</span>
              <span className="glass rounded-full px-4 py-2 text-sm text-soft">Explain more</span>
            </motion.div>
          </div>
        </InView>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- faq + cta */

const FAQ = [
  { q: "What is Bolt Autopilot?", a: "A copy-trading bot for Strike that you set up with goals instead of settings. It ranks Strike's traders, copies the ones that fit your goal on your own Strike account, swaps out traders that fade and keeps every copy inside the limits you chose." },
  { q: "Do I need a Strike account?", a: "No. Connecting your Cardano wallet opens your account on Strike Finance for you (or links the one you already have), through Strike's builder program. One free signature, no transaction. Your deposits go into that account, and you can see it on Strike's own site too." },
  { q: "Who holds my money?", a: "You do. Your funds sit in your own Strike account, opened with your Cardano wallet. The bot gets a key that can trade but can't withdraw: withdrawals always need your wallet's signature." },
  { q: "Can I lose money?", a: "Yes. Copy trading uses real money, and traders who did well before can do badly next. Stop-losses, leverage caps and the daily loss limit cut losses short, but they can't prevent them. Only use money you can afford to lose." },
  { q: "How does it pick traders?", a: "With the same engine that runs Bolt's own live bot: it scores traders on return for every unit of drawdown, how consistent they've been and how actively they trade, then filters for your goal and markets." },
  { q: "What does it cost?", a: "You pay Strike's normal trading fees. During the beta, Bolt adds no fee of its own." },
  { q: "What's the RealFi part?", a: "Strike's Borrow & Earn accepts RealFi's sUSDrf, a yield-bearing dollar, as collateral, and sends the credit into SLP, Strike's own vault. Autopilot shows SLP's live rate, how much of your money is idle, and walks you through it. Deposits into vaults happen on Strike itself, because Strike's API doesn't let apps move money into vaults." },
  { q: "How do I stop?", a: "Press Stop the bot. Its copies close at market, and your balance stays in your Strike account for you to withdraw or use as you like." },
  { q: "Are there limits during the beta?", a: "Yes: budgets are capped at $500 per user while we watch it closely. Limits will rise as it proves itself." },
  { q: "Is this made by Strike?", a: "No. Autopilot is built by the $BOLT community on top of Strike's public builder tools. It isn't issued, endorsed or managed by Strike Finance." },
];

function AutoFaq() {
  return (
    <section id="faq" className="relative mx-auto max-w-3xl scroll-mt-28 px-4 pt-32 sm:px-6">
      <SectionHeading eyebrow="FAQ" title="Good questions." />
      <div className="mt-10">
        <Faq items={FAQ} />
      </div>
    </section>
  );
}

function Final() {
  return (
    <section className="relative mx-auto max-w-6xl px-4 pt-32 sm:px-6">
      <InView className="relative overflow-hidden rounded-[2rem] bg-mascot px-6 py-12 text-ink sm:px-12 sm:py-16">
        <div className="bg-grid absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(0,0,0,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.06)_1px,transparent_1px)]" />
        <div className="relative grid items-center gap-8 md:grid-cols-[1.4fr_1fr]">
          <div>
            <h2 className="font-display text-[clamp(2.4rem,5.5vw,4rem)] leading-[0.95] font-bold tracking-tight">Let the bot do the watching.</h2>
            <p className="mt-4 max-w-md text-lg text-ink/75">Set your goal once. Autopilot follows the best traders on Strike and keeps every copy inside your limits.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <SoonLink href="/autopilot/app" className="inline-flex items-center gap-2 rounded-full bg-ink px-7 py-3.5 font-semibold text-white transition hover:-translate-y-0.5">
                Launch Autopilot →
              </SoonLink>
              <SoonLink href="/autopilot/app?demo=1" soon="Demo opening soon" className="inline-flex items-center gap-2 rounded-full border-2 border-ink px-7 py-3 font-semibold transition hover:bg-ink hover:text-white">
                Try the demo
              </SoonLink>
            </div>
          </div>
          <div className="mx-auto w-48 rotate-3 overflow-hidden rounded-3xl border-4 border-ink shadow-[10px_10px_0_#0a0a0a] transition hover:rotate-0 sm:w-56">
            <Image src="/mascot-coin.webp" alt={`${site.fullName}`} width={600} height={600} className="w-full" />
          </div>
        </div>
      </InView>
    </section>
  );
}
