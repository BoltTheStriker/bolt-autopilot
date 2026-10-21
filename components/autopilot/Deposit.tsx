"use client";

// Add funds from the dashboard: ADA from the user's wallet to their Strike account, one signature.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { walletBalance, type InstalledWallet } from "@/lib/wallet";
import { I } from "./steps";
import { MoneyPath } from "./strike";

export function DepositModal({
  open,
  wallets,
  busy,
  error,
  onDeposit,
  onClose,
}: {
  open: boolean;
  wallets: InstalledWallet[];
  busy: boolean;
  error: string;
  onDeposit: (key: string, ada: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const [ada, setAda] = useState("250");
  // The remembered wallet when there is one (a single entry); otherwise the user's pick, or the first.
  const [picked, setKey] = useState<string | null>(null);
  const key = wallets.length === 1 ? wallets[0].key : (picked ?? wallets[0]?.key ?? null);
  const [held, setHeld] = useState<number | null>(null);
  const value = Number(ada);
  const max = held !== null ? Math.max(0, Math.floor(held - 3)) : null; // keep a little ADA for fees and the returned change

  // Show what the chosen wallet holds.
  useEffect(() => {
    if (!open || !key) return;
    let alive = true;
    walletBalance(key).then(
      (v) => alive && setHeld(Number(v.lovelace) / 1e6),
      () => alive && setHeld(null),
    );
    return () => {
      alive = false;
    };
  }, [open, key]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111413] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold">Deposit</h2>
              <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full text-soft hover:bg-white/10">
                ✕
              </button>
            </div>
            <p className="mt-1 text-sm text-muted">Strike turns your ADA into trading balance; it arrives in a few minutes.</p>
            <MoneyPath direction="in" className="mt-4" />

            {wallets.length > 1 && (
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {wallets.map((w) => (
                  <button key={w.key} onClick={() => (setKey(w.key), setHeld(null))} className={`rounded-full px-3 py-1 ${key === w.key ? "bg-white/15 text-white" : "text-muted"}`}>
                    {w.name}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {[100, 250, 500, 1000].map((v) => (
                <button key={v} onClick={() => setAda(String(v))} className={`rounded-full px-4 py-2 font-mono text-sm transition ${value === v ? "bg-mint text-ink" : "bg-white/[0.06] text-soft hover:text-white"}`}>
                  {v} ₳
                </button>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 focus-within:border-mint/50">
              <span className="text-muted">₳</span>
              <input type="number" min={5} value={ada} onChange={(e) => setAda(e.target.value)} className="w-full bg-transparent font-mono text-lg outline-none" />
              {max !== null && (
                <button onClick={() => setAda(String(max))} className="rounded-full bg-white/10 px-2.5 py-1 text-xs">
                  Max
                </button>
              )}
            </label>
            <p className="mt-2 text-xs text-muted">{held === null ? "Reading your wallet…" : `In your wallet: ${held.toLocaleString("en-US", { maximumFractionDigits: 2 })} ₳`}</p>

            {error && <p className="mt-3 rounded-xl bg-neg/10 px-3 py-2 text-sm text-neg">{error}</p>}
            <button
              disabled={!key || !(value >= 5) || (max !== null && value > max) || busy}
              onClick={async () => {
                if (key && (await onDeposit(key, value))) onClose();
              }}
              className="mt-5 w-full rounded-full bg-mint py-3 font-semibold text-ink transition hover:bg-mint-2 disabled:opacity-50"
            >
              {busy ? "Check your wallet…" : max !== null && value > max ? "More than your wallet has" : `Deposit ${value || 0} ₳`}
            </button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-white/40">
              <span className="text-mint">{I.shield}</span> Your wallet shows exactly where it goes before you sign.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
