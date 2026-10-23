"use client";

// Bolt's own confirmation dialog, instead of the browser's confirm(): `await askConfirm({...})` resolves true on
// the main button, false on Cancel, Escape or a click outside. Mount <ConfirmHost /> once on the page.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  /** A highlighted line above the body, e.g. live profit: "+$12.40 (+2.1%) right now". */
  note?: { text: string; tone?: "pos" | "neg" | "muted" };
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

const EVENT = "bolt:confirm";
type Ask = ConfirmOptions & { resolve: (ok: boolean) => void };

export function askConfirm(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent<Ask>(EVENT, { detail: { ...o, resolve } })));
}

export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const main = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const on = (e: Event) => {
      // A new question replaces an open one (which counts as cancelled).
      setAsk((prev) => {
        prev?.resolve(false);
        return (e as CustomEvent<Ask>).detail;
      });
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (!ask) return;
    main.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && done(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  function done(ok: boolean) {
    ask?.resolve(ok);
    setAsk(null);
  }
  const tone = ask?.note?.tone === "pos" ? "text-mint" : ask?.note?.tone === "neg" ? "text-neg" : "text-white";
  return (
    <AnimatePresence>
      {ask && (
        <motion.div className="fixed inset-0 z-[110] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => done(false)}>
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="bolt-confirm-title"
            initial={{ y: 12, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#111413] p-6 shadow-2xl"
          >
            <h2 id="bolt-confirm-title" className="font-display text-xl font-semibold">
              {ask.title}
            </h2>
            {ask.note && <p className={`mt-3 rounded-xl bg-white/[0.04] px-3.5 py-2.5 font-mono text-sm ${tone}`}>{ask.note.text}</p>}
            {ask.body && <div className="mt-3 text-sm leading-relaxed text-soft">{ask.body}</div>}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => done(false)} className="glass rounded-full px-5 py-2.5 text-sm font-semibold transition hover:bg-white/10">
                {ask.cancelLabel ?? "Cancel"}
              </button>
              <button
                ref={main}
                onClick={() => done(true)}
                className={`rounded-full px-5 py-2.5 text-sm font-semibold transition active:scale-[0.97] ${ask.danger ? "bg-neg/90 text-white hover:bg-neg hover:shadow-[0_6px_24px_rgba(244,63,94,0.35)]" : "bg-mint text-ink hover:bg-mint-2 hover:shadow-[0_6px_24px_rgba(78,250,176,0.35)]"}`}
              >
                {ask.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
