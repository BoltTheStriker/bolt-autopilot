"use client";

// In-page notices (not the browser's): when the bot does something new, a Bolt card slides up for a few seconds.
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { I } from "./steps";
import { TraderText } from "./TraderText";

export type Toast = { id: number; text: string };

export function Toasts({ list, onClose }: { list: Toast[]; onClose: (id: number) => void }) {
  // Each card leaves by itself after 9 seconds.
  useEffect(() => {
    if (!list.length) return;
    const t = setTimeout(() => onClose(list[0].id), 9_000);
    return () => clearTimeout(t);
  }, [list, onClose]);
  return (
    <div className="pointer-events-none fixed bottom-20 left-3 z-[95] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2 sm:bottom-5 sm:left-5" aria-live="polite">
      <AnimatePresence initial={false}>
        {list.slice(-3).map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-auto flex gap-3 rounded-2xl border border-mint/35 bg-[#111413]/95 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.55),0_0_30px_rgba(78,250,176,0.12)] backdrop-blur"
          >
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-mint text-ink [&>svg]:size-3.5">{I.spark}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold tracking-wide text-mint uppercase">Your bot · just now</p>
              <p className="mt-0.5 text-sm leading-relaxed text-soft">
                <TraderText text={t.text} />
              </p>
            </div>
            <button onClick={() => onClose(t.id)} aria-label="Dismiss" className="-mt-1 -mr-1 grid size-7 shrink-0 place-items-center rounded-full text-white/40 hover:bg-white/10 hover:text-white">
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
