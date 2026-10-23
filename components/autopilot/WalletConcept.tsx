"use client";

// A playable concept: Bolt Autopilot as a "Trade" tab inside a Cardano wallet. A generic wallet (no real wallet's
// branding) in the look of the concept video: one signature, then the copilot (Claude) turns a goal into rules, and the
// real demo engine runs them on Bolt's live picks with $1,000 of practice money.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { autopilot } from "@/lib/autopilotApi";
import { DEMO_BALANCE, demoCopies, demoValue, startDemo, stepDemo, type DemoLive } from "@/lib/autopilotDemo";
import { site } from "@/lib/config";
import { defaultRules, describeRules, sanitizeRules, type AutoRules, type LiveMark, type PreviewTrader } from "@/worker/autopilot";

type Tab = "home" | "trade" | "activity";
type Stage = "intro" | "sign" | "chat" | "running";
type Msg = { me?: boolean; text: string; rules?: AutoRules };

const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;
const SUGGEST = ["Steady growth, stocks and gold, never lose more than 10%", "Balanced: crypto and stocks", "Go for growth, I can take swings"];

// When the copilot can't answer (busy, or off), a plain reading of the same asks.
function fallback(text: string): Msg {
  const t = text.toLowerCase();
  const risk = /never lose|safe|steady|calm/.test(t) ? "low" : /growth|swing|aggressive|more/.test(t) ? "high" : "medium";
  const r: AutoRules = {
    ...defaultRules(DEMO_BALANCE, risk),
    goal: risk === "low" ? "steady" : risk === "high" ? "growth" : "balanced",
    markets: /stock|gold/.test(t) && !/crypto/.test(t) ? "realworld" : "all",
    traders: 3,
  };
  return { text: "Here's a setup for that. Nothing starts until you tap Apply.", rules: r };
}

export function WalletConcept() {
  const [tab, setTab] = useState<Tab>("home");
  const [stage, setStage] = useState<Stage>("intro");
  const [traders, setTraders] = useState<PreviewTrader[]>([]);
  const [marks, setMarks] = useState<Record<string, LiveMark>>({});
  const [live, setLive] = useState<{ d: DemoLive; rules: AutoRules } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([{ text: "Hi, I'm Bolt Copilot. What do you want from your money? Say it in your own words." }]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [err, setErr] = useState("");
  const list = useRef<HTMLDivElement>(null);

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
  // Keep the newest chat message in view.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [msgs, thinking]);

  async function ask(text: string) {
    if (!text.trim() || thinking) return;
    setDraft("");
    const history = [...msgs, { me: true, text }];
    setMsgs(history);
    setThinking(true);
    try {
      const r = await autopilot.copilot(
        history.map((m) => ({ role: m.me ? ("user" as const) : ("assistant" as const), text: m.text })),
        { demo: true, rules: null, balance: DEMO_BALANCE, copies: [] },
      );
      const rules = r.proposal ? sanitizeRules({ ...r.proposal, budgetUsd: DEMO_BALANCE }, DEMO_BALANCE) : null;
      setMsgs((m) => [...m, { text: r.reply, rules: rules ?? undefined }]);
    } catch {
      setMsgs((m) => [...m, fallback(text)]);
    } finally {
      setThinking(false);
    }
  }
  /** now: the tap's time (from the event), so nothing reads the clock while rendering. */
  async function start(rules: AutoRules, now: number) {
    try {
      const d = startDemo(traders, marks, rules, now);
      if (!d.copies.length) throw new Error("No trader fits these rules right now; try another goal.");
      setLive({ d, rules });
      setStage("running");
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start; try again in a moment.");
    }
  }
  const value = live ? demoValue(live.d, live.rules.stopLossPct) : DEMO_BALANCE;
  const copies = live ? demoCopies(live.d, marks, live.rules.stopLossPct) : [];
  const ready = traders.length > 0 && Object.keys(marks).length > 0;

  return (
    <div className="relative mx-auto w-[360px] max-w-full">
      {/* The phone: its height follows the window (never taller than the screen), fixed so nothing jumps on a tap. */}
      <div className="relative rounded-[56px] bg-[#1a1f27] p-3.5 shadow-[0_50px_120px_rgba(0,0,0,0.65),inset_0_0_0_2px_rgba(255,255,255,0.09)]">
        <div className="relative flex flex-col overflow-hidden rounded-[44px] bg-[#0b0d11] text-[13.5px]" style={{ height: "min(760px, max(560px, calc(100dvh - 190px)))" }}>
          <div className="absolute top-2.5 left-1/2 z-50 h-7 w-28 -translate-x-1/2 rounded-full bg-black" />
          <div className="flex shrink-0 items-center justify-between px-5 pt-14">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-[10px] bg-[#1d2530] text-xs font-bold text-mint">W</span>
              <div>
                <p className="text-sm font-semibold">My wallet</p>
                <p className="font-mono text-[10px] text-[#8a96a8]">addr1q9…demo</p>
              </div>
            </div>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-[#8a96a8]">Mainnet</span>
          </div>

          <div ref={list} className="relative min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-4 [scrollbar-width:none]">
            {tab === "home" && <Home value={value} running={!!live} onTrade={() => setTab("trade")} />}
            {tab === "activity" && <Activity log={live?.d.log ?? []} />}
            {tab === "trade" && stage === "intro" && (
              <div>
                <p className="font-mono text-[10px] tracking-wider text-mint uppercase">Trade · Strike perps</p>
                <h2 className="mt-2 font-display text-[22px] leading-tight font-bold">Copy Strike&apos;s best traders, on autopilot.</h2>
                <p className="mt-2 text-[12.5px] leading-relaxed text-[#8a96a8]">
                  Tell the copilot your goal; Bolt picks the traders and keeps every copy inside your limits. Your own Strike account, opened with one signature.
                </p>
                <div className="mt-4 space-y-2">
                  {["One signature, no fee", "The bot can trade, never withdraw", "Stop-loss on every copy", "Withdraw back to this wallet any time"].map((t) => (
                    <div key={t} className="flex items-center gap-2.5 rounded-2xl border border-white/[0.07] bg-[#121722] px-3.5 py-2.5 text-[12.5px]">
                      <span className="text-mint">✓</span>
                      {t}
                    </div>
                  ))}
                </div>
                <button onClick={() => setStage("sign")} className="mt-5 w-full rounded-[14px] bg-mint py-3.5 font-semibold text-ink">
                  Open my Strike account
                </button>
                <p className="mt-2 text-center text-[11px] text-[#8a96a8]">Concept: practice money, nothing is signed.</p>
              </div>
            )}
            {tab === "trade" && (stage === "chat" || stage === "sign") && (
              <div>
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="grid size-7 place-items-center rounded-full bg-mint text-[11px] font-bold text-ink">✦</span>
                  <div>
                    <p className="text-sm font-semibold">Bolt Copilot</p>
                    <p className="text-[10.5px] text-[#8a96a8]">Changes nothing without your OK</p>
                  </div>
                </div>
                <div className="space-y-2.5">
                  {msgs.map((m, i) => (
                    <div key={i} className={`flex ${m.me ? "justify-end" : ""}`}>
                      <div className={`max-w-[85%] rounded-[20px] px-3.5 py-2.5 leading-snug whitespace-pre-line ${m.me ? "rounded-br-md bg-mint text-ink" : "rounded-bl-md bg-[#121722] text-[#dfe6ef]"}`}>
                        {m.text}
                        {m.rules && (
                          <div className="mt-2.5 rounded-2xl border border-mint/40 bg-gradient-to-br from-[#10302a] to-[#0c1714] p-3 text-[12px]">
                            <p className="font-mono text-[9.5px] tracking-wider text-mint uppercase">Proposed rules</p>
                            <p className="mt-1 text-[#dfe6ef]">{describeRules(m.rules).replace(/^./, (c) => c.toUpperCase())}.</p>
                            <button
                              disabled={!ready}
                              onClick={(e) => void start(m.rules!, Math.round(performance.timeOrigin + e.timeStamp))}
                              className="mt-2.5 w-full rounded-xl bg-mint py-2.5 text-[13px] font-semibold text-ink disabled:opacity-50"
                            >
                              {ready ? "Apply & start with $1,000 practice money" : "Loading Bolt's picks…"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {thinking && (
                    <div className="flex gap-1 px-2 py-1">
                      {[0, 1, 2].map((i) => (
                        <motion.span key={i} className="size-1.5 rounded-full bg-mint" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }} />
                      ))}
                    </div>
                  )}
                </div>
                {err && <p className="mt-2 text-[11px] text-neg">{err}</p>}
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
                <div className="mt-3 rounded-[22px] border border-mint/45 bg-gradient-to-br from-[#10302a] to-[#0c1714] p-4">
                  <p className="text-[11.5px] text-[#8a96a8]">Balance</p>
                  <p className="font-display text-3xl font-bold">{money(value)}</p>
                  <p className={`font-mono text-[12.5px] ${value >= DEMO_BALANCE ? "text-mint" : "text-neg"}`}>{signed(value - DEMO_BALANCE)} since you started</p>
                </div>
                <p className="mt-4 text-[12px] font-semibold text-[#dfe6ef]">Copying</p>
                <div className="mt-2 space-y-2">
                  {copies.map((c) => (
                    <div key={c.lead} className="rounded-[18px] border border-white/[0.07] bg-[#121722] px-3.5 py-2.5">
                      <div className="flex items-center justify-between font-mono text-[12px]">
                        <span className="font-semibold text-mint">{c.lead}</span>
                        <span className={c.pnl >= 0 ? "text-mint" : "text-neg"}>{signed(c.pnl)}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-[#8a96a8]">
                        {c.positions.length ? c.positions.map((p) => `${p.market.replace(/^xyz:/, "")} ${p.long ? "long" : "short"}`).join(" · ") : "Waiting for their next trade"}
                      </p>
                    </div>
                  ))}
                </div>
                <button onClick={() => (setLive(null), setStage("chat"))} className="mt-4 w-full rounded-[14px] bg-white/[0.08] py-3 text-[13px] font-semibold">
                  Stop the bot
                </button>
              </div>
            )}
          </div>

          {/* The chat's input, above the tab bar */}
          {tab === "trade" && stage === "chat" && (
            <div className="shrink-0 border-t border-white/[0.07] px-4 pt-2.5 pb-2">
              {msgs.length < 3 && (
                <div className="mb-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                  {SUGGEST.map((s) => (
                    <button key={s} onClick={() => void ask(s)} className="shrink-0 rounded-[11px] bg-white/[0.07] px-3 py-1.5 text-[11.5px] text-[#dbe2ec]">
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(draft);
                }}
                className="flex items-center gap-2 rounded-[16px] bg-[#121722] py-1.5 pr-1.5 pl-3.5"
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, 300))}
                  placeholder="Your goal, in your words…"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#8a96a8]"
                />
                <button disabled={!draft.trim() || thinking} className="rounded-[11px] bg-mint px-3 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-40">
                  Send
                </button>
              </form>
            </div>
          )}

          {/* Tab bar */}
          <nav className="grid shrink-0 grid-cols-3 border-t border-white/[0.07] bg-[#0b0d11]/95 pt-2.5 pb-6 text-[10.5px]">
            {(
              [
                ["home", "Home"],
                ["trade", "Trade"],
                ["activity", "Activity"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`relative flex flex-col items-center gap-1 ${tab === id ? "text-white" : "text-[#8a96a8]"}`}>
                <i className={`block size-[22px] rounded-[7px] ${tab === id ? "bg-mint" : "bg-white/[0.12]"}`} />
                {label}
                {id === "trade" && <span className="absolute -top-1.5 left-1/2 ml-2 rounded-full bg-mint px-1.5 text-[8px] font-bold text-ink">NEW</span>}
              </button>
            ))}
          </nav>

          {/* The signature sheet */}
          <AnimatePresence>
            {tab === "trade" && stage === "sign" && (
              <motion.div className="absolute inset-0 z-40 flex items-end bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <motion.div
                  initial={{ y: 360 }}
                  animate={{ y: 0 }}
                  exit={{ y: 360 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="w-full rounded-t-[30px] border-t border-white/[0.07] bg-[#121722] px-5 pt-3.5 pb-8"
                >
                  <div className="mx-auto mb-4 h-[5px] w-11 rounded-full bg-white/20" />
                  <p className="text-center text-[15px] font-semibold">Signature request</p>
                  <p className="mt-1 text-center text-[11.5px] text-[#8a96a8]">Strike Finance · via Bolt Autopilot</p>
                  <div className="mt-4 rounded-2xl bg-white/[0.04] p-3.5 text-[12.5px] leading-relaxed text-[#dfe6ef]">
                    Open your Strike account and start your bot. <span className="text-white">No transaction, no fee.</span> The bot can trade but never withdraw.
                  </div>
                  <button onClick={() => setStage("chat")} className="mt-4 w-full rounded-[14px] bg-mint py-3.5 font-semibold text-ink">
                    Sign · Face ID
                  </button>
                  <button onClick={() => setStage("intro")} className="mt-1 w-full py-2.5 text-[13px] text-[#8a96a8]">
                    Cancel
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <p className="mt-4 text-center text-[11px] text-white/40">A concept with practice money: no wallet, no signature, nothing leaves this page.</p>
    </div>
  );
}

function Home({ value, running, onTrade }: { value: number; running: boolean; onTrade: () => void }) {
  return (
    <div>
      <p className="text-[12px] text-[#8a96a8]">Total balance</p>
      <p className="font-display text-[34px] leading-tight font-bold">₳4,812.20</p>
      <div className="mt-3.5 grid grid-cols-3 gap-2 text-center text-[12px]">
        {["Send", "Receive", "Swap"].map((a) => (
          <span key={a} className="rounded-[14px] border border-white/[0.07] bg-[#121722] py-2.5 text-[#dfe6ef]">
            {a}
          </span>
        ))}
      </div>
      <button onClick={onTrade} className="mt-4 w-full rounded-[22px] border border-mint/45 bg-gradient-to-br from-[#10302a] to-[#0c1714] p-4 text-left">
        <p className="font-mono text-[10px] tracking-wider text-mint uppercase">{running ? "Your Autopilot" : "New · Trade"}</p>
        <p className="mt-1 text-[15px] font-semibold">{running ? `${money(value)} · ${signed(value - DEMO_BALANCE)}` : "Copy Strike's best traders, on autopilot"}</p>
        <p className="mt-0.5 text-[12px] text-[#8a96a8]">{running ? "Practice money, live traders" : "Your goal, your limits, one signature →"}</p>
      </button>
      <p className="mt-5 text-[12px] font-semibold">Tokens</p>
      <div className="mt-2 space-y-2">
        {[
          ["ADA", "Cardano", "3,960.00"],
          ["STRIKE", "Strike Finance", "412.50"],
          ["BOLT", "Bolt The Striker", "1,250,000"],
        ].map(([t, n, q]) => (
          <div key={t} className="flex items-center justify-between rounded-[18px] border border-white/[0.07] bg-[#121722] px-3.5 py-2.5">
            <span>
              <span className="font-semibold">{t}</span> <span className="text-[11.5px] text-[#8a96a8]">{n}</span>
            </span>
            <span className="font-mono text-[12px] text-[#dfe6ef]">{q}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Activity({ log }: { log: { at: number; text: string }[] }) {
  return (
    <div>
      <p className="font-display text-xl font-bold">Activity</p>
      {log.length ? (
        <div className="mt-3 space-y-2.5">
          {log.slice(0, 12).map((l, i) => (
            <p key={i} className="border-l border-mint/30 pl-3 text-[12px] leading-relaxed text-[#dfe6ef]">
              <span className="block font-mono text-[10px] text-[#8a96a8]">{new Date(l.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
              {l.text}
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] text-[#8a96a8]">Start Autopilot in the Trade tab: what it does shows up here.</p>
      )}
    </div>
  );
}

/** The page around the phone: what this is, for whom. */
export function WalletConceptPage() {
  return (
    <main className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-28 pb-16 sm:px-6 lg:grid-cols-[1fr_auto]">
      <div>
        <p className="font-mono text-xs tracking-[0.3em] text-mint uppercase">You found it · concept</p>
        <h1 className="mt-4 font-display text-[clamp(2.2rem,4.5vw,3.6rem)] leading-[1] font-bold tracking-tight">
          Strike perps, <span className="text-gradient">inside your wallet.</span>
        </h1>
        <p className="mt-5 max-w-lg text-lg text-soft">
          Bolt Autopilot as a Trade tab in any Cardano wallet: one signature opens the user&apos;s own Strike account, the copilot turns their goal into rules, and the bot copies Strike&apos;s best
          traders inside them. Try it on the phone: the real copilot, Bolt&apos;s real picks, practice money.
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
