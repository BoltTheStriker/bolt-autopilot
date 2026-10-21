"use client";

// Easter egg: "Bolt Autopilot in your wallet", a concept video for wallet teams. Opens when someone types
// "wallet" anywhere (not in a text field) or clicks the Bolt logo 5 times quickly. The video only loads then.
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { site } from "@/lib/config";

const EVENT = "bolt:wallet-egg";
const WORD = "wallet";

export const openWalletEgg = () => window.dispatchEvent(new Event(EVENT));

/** A click handler that opens the egg on the 5th click within 2.5 seconds. */
export function useEggTaps() {
  const taps = useRef<number[]>([]);
  return useCallback(() => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2_500), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      openWalletEgg();
    }
  }, []);
}

export function WalletEgg() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let typed = "";
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.key === "Escape") return setOpen(false);
      if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
      typed = (typed + e.key.toLowerCase()).slice(-WORD.length);
      if (typed === WORD) setOpen(true);
    };
    const onEgg = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(EVENT, onEgg);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(EVENT, onEgg);
    };
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] grid place-items-center bg-black/85 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Bolt Autopilot in your wallet"
        >
          <motion.div initial={{ y: 24, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 16, opacity: 0 }} className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="font-mono text-xs tracking-[0.3em] text-mint uppercase">You found it</p>
              <button onClick={() => setOpen(false)} aria-label="Close" className="glass grid size-9 place-items-center rounded-full text-soft">
                ✕
              </button>
            </div>
            <video src="/eggs/wallet.mp4" poster="/eggs/wallet-poster.jpg" autoPlay muted playsInline controls loop className="aspect-video w-full rounded-3xl border border-white/10 bg-black shadow-2xl" />
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-display text-2xl font-bold">Coming to a wallet near you.</p>
                <p className="mt-1 text-sm text-muted">Strike copy trading, one tap from your wallet&apos;s home screen, set up by the AI copilot. A concept; example figures.</p>
              </div>
              <a
                href={site.socials.x}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-mint px-6 py-3 font-semibold text-ink transition hover:bg-mint-2 hover:shadow-[0_6px_24px_rgba(78,250,176,0.35)] active:scale-[0.97]"
              >
                Wallet teams: let&apos;s talk →
              </a>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
