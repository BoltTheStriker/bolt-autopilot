"use client";

// Add funds from the dashboard: ADA from the user's wallet to their Strike account, one signature.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { walletBalance, type InstalledWallet } from "@/lib/wallet";
import { DepositHint, I } from "./steps";
import { MoneyPath } from "./strike";
import { TokenDeposit, type SwapApi } from "./TokenDeposit";

/** Where a deposit is: Strike builds it, the wallet signs it, it goes to Cardano; then it's on its way. */
export type DepositStage = "prepare" | "sign" | "send" | "done";
const STAGES: {
  id: Exclude<DepositStage, "done">;
  title: string;
  note: string;
}[] = [
  {
    id: "prepare",
    title: "Preparing your deposit",
    note: "Strike builds the transaction to your account.",
  },
  {
    id: "sign",
    title: "Sign in your wallet",
    note: "Check the amount and approve it in your wallet.",
  },
  {
    id: "send",
    title: "Sending to Cardano",
    note: "Submitting it and letting Strike know.",
  },
];

export function DepositModal({
  open,
  wallets,
  busy,
  error,
  onDeposit,
  onClose,
  swapApi,
  adaUsd,
}: {
  open: boolean;
  wallets: InstalledWallet[];
  busy: boolean;
  error: string;
  onDeposit: (key: string, ada: number, onStage: (s: DepositStage) => void) => Promise<string | null>;
  onClose: () => void;
  swapApi?: SwapApi | null; // "Other token": swap a wallet token to ADA through SteelSwap first
  adaUsd?: number | null; // to show each amount in dollars
}) {
  const [ada, setAda] = useState("500");
  const [tab, setTab] = useState<"ada" | "token">("ada");
  // The remembered wallet when there is one (a single entry); otherwise the user's pick, or the first.
  const [picked, setKey] = useState<string | null>(null);
  const key = wallets.length === 1 ? wallets[0].key : (picked ?? wallets[0]?.key ?? null);
  const [held, setHeld] = useState<number | null>(null);
  const [stage, setStage] = useState<DepositStage | null>(null);
  const [sent, setSent] = useState<{ ada: number; hash: string } | null>(null);
  const working = stage !== null && stage !== "done";
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

  const close = () => {
    if (working) return; // mid-deposit: the wallet may be open; let it finish
    setStage(null);
    setSent(null);
    onClose();
  };
  const deposit = async () => {
    if (!key) return;
    const hash = await onDeposit(key, value, setStage);
    if (hash) {
      setSent({ ada: value, hash });
      setStage("done");
    } else setStage(null); // back to the form, which shows the error
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111413] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {stage === "done" && sent ? (
              <Sent ada={sent.ada} hash={sent.hash} onDone={close} />
            ) : working ? (
              <Progress stage={stage} ada={value} />
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-2xl font-semibold">Deposit</h2>
                  <button onClick={close} aria-label="Close" className="grid size-8 place-items-center rounded-full text-soft hover:bg-white/10">
                    ✕
                  </button>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {tab === "ada" ? "Strike turns your ADA into trading balance; it arrives in a few minutes." : "Hold SNEK, NIGHT or another token? Swap it to ADA in your wallet, then deposit."}
                </p>
                {swapApi && (
                  <div className="mt-4 inline-flex rounded-full bg-white/[0.05] p-1 text-sm">
                    {(
                      [
                        ["ada", "ADA"],
                        ["token", "Other token"],
                      ] as const
                    ).map(([id, label]) => (
                      <button key={id} onClick={() => setTab(id)} className={`rounded-full px-4 py-1.5 font-semibold transition ${tab === id ? "bg-mint text-ink" : "text-soft hover:text-white"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {tab === "token" && swapApi ? (
                  <TokenDeposit walletKey={key} api={swapApi} onAdaReady={(n) => (setAda(String(n)), setTab("ada"), setHeld(null))} />
                ) : (
                  <>
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
                      {[250, 500, 1000, 2000].map((v) => (
                        <button
                          key={v}
                          onClick={() => setAda(String(v))}
                          className={`rounded-full px-4 py-2 font-mono text-sm transition ${value === v ? "bg-mint text-ink" : "bg-white/[0.06] text-soft hover:text-white"}`}
                        >
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
                <DepositHint ada={value || 0} adaUsd={adaUsd} />

                    {error && <p className="mt-3 rounded-xl bg-neg/10 px-3 py-2 text-sm text-neg">{error}</p>}
                    <button
                      disabled={!key || !(value >= 5) || (max !== null && value > max) || busy}
                      onClick={() => void deposit()}
                      className="mt-5 w-full rounded-full bg-mint py-3 font-semibold text-ink transition hover:bg-mint-2 disabled:opacity-50"
                    >
                      {busy ? "Working…" : max !== null && value > max ? "More than your wallet has" : `Deposit ${value || 0} ₳`}
                    </button>
                    <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-white/40">
                      <span className="text-mint">{I.shield}</span> Your wallet shows exactly where it goes before you sign.
                    </p>
                  </>
                )}
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Progress({ stage, ada }: { stage: DepositStage; ada: number }) {
  const at = STAGES.findIndex((s) => s.id === stage);
  return (
    <div>
      <h2 className="font-display text-2xl font-semibold">Depositing {ada.toLocaleString("en-US")} ₳</h2>
      <p className="mt-1 text-sm text-muted">Keep this open for a moment.</p>
      <ol className="mt-6 space-y-1">
        {STAGES.map((s, i) => {
          const done = i < at;
          const now = i === at;
          return (
            <li key={s.id} className={`flex gap-3 rounded-2xl px-3 py-3 transition ${now ? "bg-mint/[0.07]" : ""}`}>
              <span
                className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition ${done ? "bg-mint text-ink" : now ? "border-2 border-mint/30 border-t-mint animate-spin" : "border border-white/15 text-white/35"}`}
              >
                {done ? "✓" : now ? "" : i + 1}
              </span>
              <span>
                <span className={`block font-medium ${done || now ? "text-white" : "text-white/40"}`}>{s.title}</span>
                {now && (
                  <motion.span initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} className="mt-0.5 block text-sm text-muted">
                    {s.note}
                  </motion.span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Sent({ ada, hash, onDone }: { ada: number; hash: string; onDone: () => void }) {
  return (
    <div className="text-center">
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 18 }}
        className="mx-auto grid size-14 place-items-center rounded-full bg-mint text-2xl text-ink shadow-[0_0_40px_rgba(78,250,176,0.35)]"
      >
        ✓
      </motion.span>
      <h2 className="mt-4 font-display text-2xl font-semibold">Deposit sent</h2>
      <p className="mt-2 text-sm text-soft">
        {ada.toLocaleString("en-US")} ₳ is on its way to your Strike account. It usually lands in 2 to 10 minutes, and your dashboard shows it as soon as it does.
      </p>
      <a href={`https://cardanoscan.io/transaction/${hash}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-muted underline-offset-2 hover:text-white hover:underline">
        View on Cardanoscan ↗
      </a>
      <button onClick={onDone} className="mt-6 w-full rounded-full bg-mint py-3 font-semibold text-ink transition hover:bg-mint-2 hover:shadow-[0_6px_24px_rgba(78,250,176,0.35)] active:scale-[0.97]">
        Done
      </button>
    </div>
  );
}
