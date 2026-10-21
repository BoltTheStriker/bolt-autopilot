"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";

/** Big tappable choice cards (risk, goal, markets): easier to read than small pills. */
export function ChoiceCards<T extends string>({ value, options, onChange, columns = 3 }: { value: T; options: readonly { id: T; title: string; desc: string; icon?: ReactNode }[]; onChange: (v: T) => void; columns?: 2 | 3 }) {
  return (
    <div className={`grid gap-2.5 ${columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`} role="radiogroup">
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={`group relative rounded-2xl border p-4 text-left transition ${on ? "border-mint/60 bg-mint/[0.09] shadow-[0_0_0_1px_rgba(78,250,176,0.25)]" : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.05]"}`}
          >
            <span className="flex items-center gap-2">
              {o.icon && <span className={`grid size-7 place-items-center rounded-lg ${on ? "bg-mint text-ink" : "bg-white/[0.06] text-soft"}`}>{o.icon}</span>}
              <span className="font-display font-semibold">{o.title}</span>
              <span className={`ml-auto size-4 shrink-0 rounded-full border-2 transition ${on ? "border-mint bg-mint shadow-[inset_0_0_0_3px_#0a0a0a]" : "border-white/25"}`} />
            </span>
            <span className="mt-1.5 block text-xs leading-relaxed text-muted">{o.desc}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Slider({ label, hint, value, min, max, step, format, onChange }: { label: string; hint?: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-soft">{label}</span>
        <span className="font-mono text-base text-white">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full accent-[#4efab0]"
        style={{ background: `linear-gradient(90deg, #4efab0 ${pct}%, rgba(255,255,255,0.1) ${pct}%)` }}
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** The four setup steps, with where you are. */
export function Stepper({ steps, current, onPick }: { steps: readonly { id: string; label: string }[]; current: number; onPick?: (i: number) => void }) {
  return (
    <ol className="flex gap-2" data-tour="steps">
      {steps.map((s, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <li key={s.id} className={`min-w-0 sm:flex-1 ${on ? "flex-1" : ""}`}>
            <button
              type="button"
              disabled={!onPick || i > current}
              onClick={() => onPick?.(i)}
              className={`w-full rounded-2xl border px-3 py-2.5 text-left transition disabled:cursor-default ${on ? "border-mint/50 bg-mint/[0.08]" : done ? "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]" : "border-white/5 bg-transparent opacity-60"}`}
            >
              <span className="flex items-center gap-2">
                <span className={`grid size-6 shrink-0 place-items-center rounded-full font-mono text-xs ${done ? "bg-mint text-ink" : on ? "border border-mint text-mint" : "border border-white/20 text-white/50"}`}>{done ? "✓" : i + 1}</span>
                <span className={`truncate text-sm font-semibold ${on ? "text-white" : "hidden text-soft sm:inline"}`}>{s.label}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export type TourStep = { target: string; title: string; body: string };
/** The on-screen element for a tour target (skips hidden ones, e.g. the desktop panel on a phone). */
const findTarget = (target: string) => Array.from(document.querySelectorAll(`[data-tour="${target}"]`)).find((el) => el.getClientRects().length > 0) ?? null;
const TOUR_DONE = "bolt-autopilot-tour"; // per-viewer convenience

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_DONE) === "1";
  } catch {
    return true; // can't remember: don't nag
  }
}
function markTourSeen() {
  try {
    localStorage.setItem(TOUR_DONE, "1");
  } catch {}
}

/**
 * A short guided tour: dims the page, spotlights one part at a time (`[data-tour="…"]`) with a
 * one-line explanation. Next / Back / Skip; closing it remembers not to open it again.
 */
export function Tour({ steps, open, onClose }: { steps: TourStep[]; open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Re-check which targets exist when the page changes underneath (e.g. a screen animating out).
  const [, setDomTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const mo = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => setDomTick((n) => n + 1), 120);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      clearTimeout(t);
    };
  }, [open]);
  // Steps whose target isn't on screen right now are skipped.
  const live = steps.filter((s) => typeof document !== "undefined" && findTarget(s.target));
  const step = live[Math.min(i, live.length - 1)];

  const measure = useCallback(() => {
    const el = step && findTarget(step.target);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    if (!open || !step) return;
    const el = findTarget(step.target);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = setTimeout(measure, 350);
    return () => clearTimeout(t);
  }, [open, step, measure]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("keydown", esc);
    };
  });

  function close() {
    markTourSeen();
    setI(0);
    onClose();
  }

  if (!open || !step) return null;
  const pad = 8;
  const below = rect ? rect.bottom + 180 < window.innerHeight : true;
  const cardTop = rect ? (below ? rect.bottom + pad + 10 : Math.max(12, rect.top - pad - 10 - 170)) : window.innerHeight / 2 - 90;
  const cardLeft = rect ? Math.min(Math.max(12, rect.left), window.innerWidth - 352) : window.innerWidth / 2 - 170;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100]" aria-live="polite">
        {/* Spotlight: a hole in a dark layer around the highlighted element. */}
        <motion.div
          className="pointer-events-none absolute rounded-2xl"
          initial={false}
          animate={rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : { top: "50%", left: "50%", width: 0, height: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          style={{ boxShadow: "0 0 0 9999px rgba(5,8,7,0.72), 0 0 0 2px rgba(78,250,176,0.7), 0 0 40px rgba(78,250,176,0.35)" }}
        />
        <button aria-label="Close the tour" className="absolute inset-0 cursor-default" onClick={close} />
        <motion.div
          key={step.target}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute w-[340px] max-w-[calc(100vw-24px)] rounded-2xl border border-mint/30 bg-[#0e1311] p-4 shadow-2xl"
          style={{ top: cardTop, left: cardLeft }}
        >
          <p className="font-mono text-[11px] tracking-wider text-mint uppercase">
            Step {Math.min(i, live.length - 1) + 1} of {live.length}
          </p>
          <p className="mt-1 font-display text-lg font-semibold">{step.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-soft">{step.body}</p>
          <div className="mt-4 flex items-center gap-2">
            <button onClick={close} className="text-sm text-muted hover:text-white">Skip tour</button>
            <span className="ml-auto" />
            {i > 0 && <button onClick={() => setI(i - 1)} className="glass rounded-full px-4 py-1.5 text-sm">Back</button>}
            <button onClick={() => (i + 1 >= live.length ? close() : setI(i + 1))} className="rounded-full bg-mint px-4 py-1.5 text-sm font-semibold text-ink transition hover:bg-mint-2 hover:shadow-[0_6px_24px_rgba(78,250,176,0.35)] active:scale-[0.97]">
              {i + 1 >= live.length ? "Got it" : "Next"}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
