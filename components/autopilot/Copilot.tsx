"use client";

// The copilot panel, docked beside the app (a bottom sheet on phones). Until the AI chat is
// switched on it offers quick tweaks: real, predictable changes to your rules, each one shown
// before it's applied.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { autopilot, type CopilotContext } from "@/lib/autopilotApi";
import { describeRules, RISK_LEVELS, sanitizeRules, type AutoRules, type Risk } from "@/worker/autopilot";
import { I } from "./steps";

type Tweak = { id: string; label: string; apply: (r: AutoRules) => AutoRules; says: string };

const lower: Record<Risk, Risk> = { high: "medium", medium: "low", low: "low" };
const atRisk = (r: AutoRules, risk: Risk) => ({ ...r, risk, maxLeverage: RISK_LEVELS[risk].maxLeverage, stopLossPct: RISK_LEVELS[risk].stopLossPct, dailyLossPct: RISK_LEVELS[risk].dailyLossPct });

const TWEAKS: Tweak[] = [
  { id: "safer", label: "Make it safer", apply: (r) => ({ ...atRisk(r, lower[r.risk]), goal: "steady" }), says: "Lower risk and the Steady goal: less money working, tighter stops, calmer traders." },
  { id: "upside", label: "More upside", apply: (r) => ({ ...r, goal: "growth" }), says: "Growth goal: good traders with more upside. Expect bigger swings both ways." },
  { id: "realworld", label: "Only stocks & gold", apply: (r) => ({ ...r, markets: "realworld" }), says: "Real-world markets only: S&P 500, Nasdaq, gold, oil and big stocks." },
  { id: "crypto", label: "Crypto only", apply: (r) => ({ ...r, markets: "crypto" }), says: "Crypto only: BTC, ETH, ADA, SOL and the other coins." },
  { id: "spread", label: "Spread it out", apply: (r) => ({ ...r, traders: Math.min(6, r.traders + 2) }), says: "More traders, smaller copies: one bad trader matters less." },
  { id: "lock", label: "Lock in profits", apply: (r) => ({ ...r, profitLockPct: 0.15 }), says: "Bank a copy's gains at +15%, then copy that trader again fresh." },
];

type Msg = { me?: boolean; text: string; pending?: AutoRules };

export function CopilotPanel({
  rules,
  maxBudget,
  chat,
  context,
  onApply,
  onClose,
}: {
  rules: AutoRules | null;
  maxBudget: number;
  chat: boolean; // the AI chat is switched on (server has a Claude key)
  context: CopilotContext;
  onApply: (r: AutoRules) => void;
  onClose?: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([
    { text: chat ? "Hi! Tell me what you want from your bot, in your own words, and I'll set it up. Or pick a quick tweak below." : "Hi! I set up and tune your bot. Pick a quick tweak below, or ask me to explain your setup." },
  ]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const say = (m: Msg[]) => setMsgs((x) => [...x.map((y) => ({ ...y, pending: undefined })), ...m]);
  // Keep the newest message in view.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [msgs, thinking]);

  async function send() {
    const text = draft.trim();
    if (!text || thinking) return;
    setDraft("");
    const history = [...msgs, { me: true, text }];
    say([{ me: true, text }]);
    setThinking(true);
    try {
      const r = await autopilot.copilot(
        history.map((m) => ({ role: m.me ? ("user" as const) : ("assistant" as const), text: m.text })),
        context,
      );
      say([{ text: r.reply, pending: r.proposal ?? undefined }]);
    } catch (e) {
      say([{ text: e instanceof Error ? e.message : "The copilot couldn't answer that. Try again." }]);
    } finally {
      setThinking(false);
    }
  }

  function tweak(t: Tweak) {
    if (!rules) return say([{ me: true, text: t.label }, { text: "Pick your risk and goal first; then I can tune them." }]);
    const next = sanitizeRules(t.apply(rules), maxBudget);
    if (!next || describeRules(next) === describeRules(rules)) return say([{ me: true, text: t.label }, { text: "Your setup already does that." }]);
    say([{ me: true, text: t.label }, { text: t.says, pending: next }]);
  }
  function explain() {
    if (!rules) return say([{ me: true, text: "Explain my setup" }, { text: "You haven't picked rules yet. Start with how much risk you're comfortable with." }]);
    say([{ me: true, text: "Explain my setup" }, { text: describeRules(rules).replace(/; /g, ". ").replace(/^./, (c) => c.toUpperCase()) + "." }]);
  }

  return (
    <div className="card flex h-full flex-col overflow-hidden rounded-3xl border border-mint/20" data-tour="copilot">
      <div className="flex items-center gap-2.5 border-b border-white/10 px-5 py-4">
        <span className="grid size-8 place-items-center rounded-full bg-mint text-ink">{I.spark}</span>
        <div>
          <p className="font-display font-semibold">Bolt Copilot</p>
          <p className="text-[11px] text-muted">Changes nothing without your OK</p>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close the copilot" className="ml-auto grid size-8 place-items-center rounded-full text-soft hover:bg-white/10">
            ✕
          </button>
        )}
      </div>

      <div ref={list} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <AnimatePresence initial={false}>
          {msgs.map((m, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`flex ${m.me ? "justify-end" : ""}`}>
              <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line ${m.me ? "rounded-br-md bg-mint text-ink" : "rounded-bl-md bg-white/[0.06] text-soft"}`}>
                {m.text}
                {m.pending && (
                  <div className="mt-2.5 flex gap-2">
                    <button
                      onClick={() => {
                        onApply(m.pending!);
                        say([{ text: "Done. Your bot uses the new rules from now on." }]);
                      }}
                      className="rounded-full bg-mint px-3.5 py-1.5 text-xs font-semibold text-ink transition hover:bg-mint-2 hover:shadow-[0_6px_24px_rgba(78,250,176,0.35)] active:scale-[0.97]"
                    >
                      Apply
                    </button>
                    <button onClick={() => say([{ text: "OK, nothing changed." }])} className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs">
                      No thanks
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {thinking && (
          <div className="flex gap-1 px-2 py-1" aria-label="Copilot is thinking">
            {[0, 1, 2].map((i) => (
              <motion.span key={i} className="size-1.5 rounded-full bg-mint" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-white/10 p-3">
        <p className="mb-2 px-1 text-[11px] text-muted">Quick tweaks</p>
        <div className="flex flex-wrap gap-1.5">
          {TWEAKS.map((t) => (
            <button key={t.id} onClick={() => tweak(t)} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-soft transition hover:border-mint/40 hover:text-white">
              {t.label}
            </button>
          ))}
          <button onClick={explain} className="rounded-full border border-mint/30 px-3 py-1.5 text-xs text-mint transition hover:bg-mint/10">
            Explain my setup
          </button>
        </div>
        {chat ? (
          <form
            className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.02] py-1.5 pr-1.5 pl-3.5 focus-within:border-mint/40"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 1200))}
              placeholder="Ask anything in your own words…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/35"
            />
            <button disabled={!draft.trim() || thinking} className="rounded-xl bg-mint px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40 transition hover:bg-mint-2 hover:shadow-[0_6px_24px_rgba(78,250,176,0.35)] active:scale-[0.97]">
              Send
            </button>
          </form>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5 text-sm text-white/35">
            Ask anything in your own words…
            <span className="ml-auto rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px]">soon</span>
          </div>
        )}
      </div>
    </div>
  );
}
