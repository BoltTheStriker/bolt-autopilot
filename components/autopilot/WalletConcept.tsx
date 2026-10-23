"use client";

// A playable concept: Bolt Autopilot as a "Trade" tab inside a Cardano wallet. A generic wallet (no real wallet's
// branding), running the real demo engine: Bolt's live picks, the traders' live moves, $1,000 of practice money.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { autopilot } from "@/lib/autopilotApi";
import { DEMO_BALANCE, demoCopies, demoValue, startDemo, stepDemo, type DemoLive } from "@/lib/autopilotDemo";
import { site } from "@/lib/config";
import { defaultRules, describeRules, type AutoRules, type Goal, type LiveMark, type PreviewTrader, type Risk } from "@/worker/autopilot";

type Tab = "home" | "trade" | "activity";
type Stage = "intro" | "sign" | "goal" | "running";

const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;

export function WalletConcept() {
  const [tab, setTab] = useState<Tab>("home");
  const [stage, setStage] = useState<Stage>("intro");
  const [risk, setRisk] = useState<Risk>("medium");
  const [goal, setGoal] = useState<Goal>("balanced");
  const [traders, setTraders] = useState<PreviewTrader[]>([]);
  const [marks, setMarks] = useState<Record<string, LiveMark>>({});
  const [live, setLive] = useState<{ d: DemoLive; rules: AutoRules } | null>(null);
  const [err, setErr] = useState("");

  // Bolt's live picks, and the traders' live moves every 15 seconds.
  useEffect(() => {
    let alive = true;
    autopilot.preview().then((r) => alive && setTraders(r.traders), () => {});
    const tick = () => autopilot.marks().then((r) => alive && setMarks(r.marks), () => {});
    void tick();
    const t = setInterval(tick, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  // The running bot follows them.
  useEffect(() => {
    if (!Object.keys(marks).length) return;
    const t = setTimeout(() => setLive((l) => (l ? { ...l, d: stepDemo(l.d, marks, l.rules, Date.now(), { autopilot: true }) } : l)), 0);
    return () => clearTimeout(t);
  }, [marks]);

  const rules: AutoRules = { ...defaultRules(DEMO_BALANCE, risk), goal, traders: 3 };
  /** now: the click's time (from the event), so nothing reads the clock while rendering. */
  async function start(now: number) {
    try {
      const d = startDemo(traders, marks, rules, now);
      if (!d.copies.length) throw new Error("No trader fits right now; try another goal.");
      setLive({ d, rules });
      setStage("running");
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start; try again in a moment.");
    }
  }
  const value = live ? demoValue(live.d, live.rules.stopLossPct) : DEMO_BALANCE;
  const copies = live ? demoCopies(live.d, marks, live.rules.stopLossPct) : [];

  return (
    <div className="relative mx-auto w-[min(390px,100%)]">
      {/* The phone */}
      <div className="relative overflow-hidden rounded-[3rem] border-[10px] border-[#1d2220] bg-[#0b0d0c] shadow-[0_40px_120px_rgba(0,0,0,0.7),0_0_80px_rgba(78,250,176,0.12)]">
        <div className="absolute top-2 left-1/2 z-20 h-6 w-28 -translate-x-1/2 rounded-full bg-black" />
        <div className="flex h-[720px] flex-col pt-10">
          {/* Wallet header */}
          <div className="flex items-center justify-between px-5">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-[#7dd3fc] to-mint text-xs font-bold text-ink">W</span>
              <div>
                <p className="text-sm font-semibold">My wallet</p>
                <p className="font-mono text-[10px] text-white/40">addr1q9…demo · Cardano</p>
              </div>
            </div>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] text-soft">Mainnet</span>
          </div>

          <div className="relative flex-1 overflow-y-auto px-5 pt-5 pb-4 [scrollbar-width:none]">
            <AnimatePresence mode="wait">
              <motion.div key={tab + stage} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                {tab === "home" && <Home value={value} running={!!live} onTrade={() => setTab("trade")} />}
                {tab === "activity" && <Activity log={live?.d.log ?? []} />}
                {tab === "trade" && stage === "intro" && (
                  <div>
                    <p className="font-mono text-[10px] tracking-wider text-mint uppercase">Trade · Strike perps</p>
                    <h2 className="mt-2 font-display text-2xl leading-tight font-bold">Copy Strike&apos;s best traders, on autopilot.</h2>
                    <p className="mt-2 text-sm text-soft">Say your goal; Bolt picks the traders and keeps every copy inside your limits. Your own Strike account, opened with one signature.</p>
                    <ul className="mt-4 space-y-2 text-sm">
                      {["One signature, no fee", "The bot can trade, never withdraw", "Stop-loss on every copy", "Withdraw back to this wallet any time"].map((t) => (
                        <li key={t} className="flex gap-2 text-soft">
                          <span className="text-mint">✓</span>
                          {t}
                        </li>
                      ))}
                    </ul>
                    <button onClick={() => setStage("sign")} className="mt-6 w-full rounded-2xl bg-mint py-3.5 font-semibold text-ink">
                      Open my Strike account
                    </button>
                    <p className="mt-2 text-center text-[11px] text-white/40">Concept: practice money only, nothing is signed.</p>
                  </div>
                )}
                {tab === "trade" && stage === "goal" && (
                  <div>
                    <p className="font-mono text-[10px] tracking-wider text-mint uppercase">Your goal</p>
                    <h2 className="mt-2 font-display text-xl font-bold">How much risk?</h2>
                    <Chips value={risk} onChange={setRisk} options={[["low", "Low"], ["medium", "Medium"], ["high", "High"]]} />
                    <h2 className="mt-5 font-display text-xl font-bold">What for?</h2>
                    <Chips value={goal} onChange={setGoal} options={[["steady", "Steady"], ["balanced", "Balanced"], ["growth", "Growth"]]} />
                    <div className="mt-5 rounded-2xl border border-mint/20 bg-mint/[0.05] p-3.5 text-xs leading-relaxed text-soft">
                      <p className="mb-1 font-semibold text-mint">Your bot will</p>
                      {describeRules(rules).replace(/^./, (c) => c.toUpperCase())}.
                    </div>
                    {err && <p className="mt-3 text-xs text-neg">{err}</p>}
                    <button disabled={!traders.length || !Object.keys(marks).length} onClick={(e) => void start(Math.round(performance.timeOrigin + e.timeStamp))} className="mt-5 w-full rounded-2xl bg-mint py-3.5 font-semibold text-ink disabled:opacity-50">
                      {traders.length ? "Start with $1,000 practice money" : "Loading Bolt's picks…"}
                    </button>
                  </div>
                )}
                {tab === "trade" && stage === "running" && live && (
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        <span className="size-2 animate-pulse rounded-full bg-mint" />
                        Autopilot is running
                      </p>
                      <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] text-gold">Practice</span>
                    </div>
                    <p className="mt-3 text-xs text-muted">Balance</p>
                    <p className="font-display text-4xl font-bold">{money(value)}</p>
                    <p className={`font-mono text-sm ${value >= DEMO_BALANCE ? "text-mint" : "text-neg"}`}>{signed(value - DEMO_BALANCE)} since you started</p>
                    <p className="mt-5 text-xs font-semibold text-soft">Copying</p>
                    <ul className="mt-2 space-y-2">
                      {copies.map((c) => (
                        <li key={c.lead} className="rounded-2xl bg-white/[0.04] px-3.5 py-2.5">
                          <div className="flex items-center justify-between font-mono text-xs">
                            <span className="font-semibold text-mint">{c.lead}</span>
                            <span className={c.pnl >= 0 ? "text-mint" : "text-neg"}>{signed(c.pnl)}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-white/45">{c.positions.length ? c.positions.map((p) => `${p.market.replace(/^xyz:/, "")} ${p.long ? "long" : "short"}`).join(" · ") : "Waiting for their next trade"}</p>
                        </li>
                      ))}
                    </ul>
                    <button onClick={() => (setLive(null), setStage("goal"))} className="mt-5 w-full rounded-2xl bg-white/[0.07] py-3 text-sm font-semibold text-soft">
                      Stop the bot
                    </button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Tab bar */}
          <nav className="grid grid-cols-3 border-t border-white/[0.06] bg-[#0f1211] px-3 pt-2 pb-6 text-[11px]">
            {(
              [
                ["home", "Home"],
                ["trade", "Trade"],
                ["activity", "Activity"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`relative flex flex-col items-center gap-1 py-1 ${tab === id ? "text-mint" : "text-white/45"}`}>
                <span className={`size-1.5 rounded-full ${tab === id ? "bg-mint" : "bg-transparent"}`} />
                {label}
                {id === "trade" && <span className="absolute -top-1.5 right-6 rounded-full bg-mint px-1.5 text-[8px] font-bold text-ink">NEW</span>}
              </button>
            ))}
          </nav>
        </div>

        {/* The signature sheet */}
        <AnimatePresence>
          {tab === "trade" && stage === "sign" && (
            <motion.div className="absolute inset-0 z-30 flex items-end bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.div initial={{ y: 320 }} animate={{ y: 0 }} exit={{ y: 320 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="w-full rounded-t-3xl border-t border-white/10 bg-[#141816] p-5 pb-8">
                <p className="text-center font-semibold">Signature request</p>
                <p className="mt-1 text-center text-xs text-muted">Strike Finance · via Bolt Autopilot</p>
                <div className="mt-4 rounded-2xl bg-white/[0.04] p-3.5 text-xs leading-relaxed text-soft">
                  Open your Strike account and start your bot. <span className="text-white">No transaction, no fee.</span> The bot can trade but never withdraw.
                </div>
                <button onClick={() => setStage("goal")} className="mt-4 w-full rounded-2xl bg-mint py-3.5 font-semibold text-ink">
                  Sign · Face ID
                </button>
                <button onClick={() => setStage("intro")} className="mt-2 w-full py-2 text-sm text-muted">
                  Cancel
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <p className="mt-4 text-center text-xs text-white/40">A concept with practice money: no wallet, no signature, nothing leaves this page.</p>
    </div>
  );
}

function Home({ value, running, onTrade }: { value: number; running: boolean; onTrade: () => void }) {
  return (
    <div>
      <p className="text-xs text-muted">Total balance</p>
      <p className="font-display text-4xl font-bold">₳4,812.20</p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        {["Send", "Receive", "Swap"].map((a) => (
          <span key={a} className="rounded-2xl bg-white/[0.05] py-2.5 text-soft">
            {a}
          </span>
        ))}
      </div>
      <button onClick={onTrade} className="mt-4 w-full rounded-2xl border border-mint/30 bg-gradient-to-br from-mint/15 to-transparent p-4 text-left">
        <p className="font-mono text-[10px] tracking-wider text-mint uppercase">{running ? "Your Autopilot" : "New · Trade"}</p>
        <p className="mt-1 font-semibold">{running ? `${money(value)} · ${signed(value - DEMO_BALANCE)}` : "Copy Strike's best traders, on autopilot"}</p>
        <p className="mt-0.5 text-xs text-muted">{running ? "Practice money, live traders" : "Your goal, your limits, one signature →"}</p>
      </button>
      <p className="mt-5 text-xs font-semibold text-soft">Tokens</p>
      <ul className="mt-2 divide-y divide-white/[0.05]">
        {[
          ["ADA", "Cardano", "3,960.00"],
          ["STRIKE", "Strike Finance", "412.50"],
          ["BOLT", "Bolt The Striker", "1,250,000"],
        ].map(([t, n, q]) => (
          <li key={t} className="flex items-center justify-between py-2.5 text-sm">
            <span>
              <span className="font-semibold">{t}</span> <span className="text-xs text-muted">{n}</span>
            </span>
            <span className="font-mono text-xs text-soft">{q}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Activity({ log }: { log: { at: number; text: string }[] }) {
  return (
    <div>
      <p className="font-display text-xl font-bold">Activity</p>
      {log.length ? (
        <ol className="mt-3 space-y-2.5">
          {log.slice(0, 12).map((l, i) => (
            <li key={i} className="border-l border-mint/30 pl-3 text-xs leading-relaxed text-soft">
              <span className="block font-mono text-[10px] text-white/35">{new Date(l.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
              {l.text}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-muted">Start Autopilot in the Trade tab: what it does shows up here.</p>
      )}
    </div>
  );
}

function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={`rounded-2xl py-2.5 text-sm font-semibold transition ${value === v ? "bg-mint text-ink" : "bg-white/[0.05] text-soft"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** The page around the phone: what this is, for whom. */
export function WalletConceptPage() {
  return (
    <main className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-32 pb-24 sm:px-6 lg:grid-cols-[1fr_auto]">
      <div>
        <p className="font-mono text-xs tracking-[0.3em] text-mint uppercase">You found it · concept</p>
        <h1 className="mt-4 font-display text-[clamp(2.4rem,5vw,4rem)] leading-[1] font-bold tracking-tight">
          Strike perps, <span className="text-gradient">inside your wallet.</span>
        </h1>
        <p className="mt-5 max-w-lg text-lg text-soft">
          Bolt Autopilot as a Trade tab in any Cardano wallet: one signature opens the user&apos;s own Strike account, they say their goal, and the bot copies Strike&apos;s best traders inside their
          limits. Try it: it runs Bolt&apos;s real picks and the traders&apos; live moves, with practice money.
        </p>
        <ul className="mt-6 space-y-2 text-soft">
          {["Self-custody stays: the wallet signs, the bot can never withdraw", "Every trade on Strike, through the wallet's own builder code", "Wallets earn a share of Strike's builder fee"].map((t) => (
            <li key={t} className="flex gap-2">
              <span className="text-mint">✓</span>
              {t}
            </li>
          ))}
        </ul>
        <a href={site.socials.x} target="_blank" rel="noreferrer" className="mt-8 inline-flex rounded-full bg-mint px-6 py-3 font-semibold text-ink transition hover:bg-mint-2">
          Wallet teams: let&apos;s talk →
        </a>
      </div>
      <WalletConcept />
    </main>
  );
}
