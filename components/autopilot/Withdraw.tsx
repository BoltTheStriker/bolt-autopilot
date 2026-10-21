"use client";

// Withdraw from the user's Strike account to their own wallet, without leaving Bolt. Strike locks
// the destination to the wallet registered on the account and needs that wallet's signature, so
// the bot (or Bolt) can never withdraw or redirect anything.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { autopilot, type Session, type WithdrawQuote } from "@/lib/autopilotApi";
import { moveBetweenAccounts, strikeApi, strikeLogin } from "@/lib/strikeSession";
import { signHexPayload, signOnly, type InstalledWallet } from "@/lib/wallet";
import { short, usd } from "./steps";
import { MoneyPath } from "./strike";

type Kind = "balance" | "collateral";

export function WithdrawModal({
  open,
  session,
  wallets,
  address,
  available,
  parked,
  parkedSubs,
  accountId,
  network,
  refreshAvailable,
  susdrf,
  onClose,
  onDone,
  onUsedWallet,
}: {
  open: boolean;
  session: Session;
  wallets: InstalledWallet[];
  address: string; // the wallet registered on the Strike account (where money goes)
  available: number; // free trading balance (USD), not in copies
  parked: number; // left in older copies' sub-accounts: moved to the main account first when needed
  parkedSubs: { id: string; available: number }[];
  accountId: string; // the user's main Strike account
  network: "mainnet" | "testnet";
  refreshAvailable: () => Promise<number>; // the main balance after moving money
  susdrf: number; // unpledged sUSDrf held on Strike
  onClose: () => void;
  onDone: () => void;
  onUsedWallet?: (key: string) => void; // remember the wallet that signed
}) {
  const [kind, setKind] = useState<Kind>("balance");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<"ADA" | "USDM">("ADA");
  // The remembered wallet when there is one (a single entry); otherwise the user's pick, or the first.
  const [picked, setWallet] = useState<string | null>(null);
  const wallet = wallets.length === 1 ? wallets[0].key : (picked ?? wallets[0]?.key ?? null);
  const [quote, setQuote] = useState<WithdrawQuote | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ id: string; status: string } | null>(null);
  const [queue, setQueue] = useState<string>("");
  // Everything not in a running copy: the main balance plus money parked in older copies' sub-accounts
  // (moved to the main account, with the user's own Strike login, when the amount needs it).
  const [moved, setMoved] = useState<number | null>(null); // main balance after moving
  // Only count parked money we know how to reach (its sub-accounts are listed).
  const reachable = parkedSubs.reduce((t, p) => t + p.available, 0);
  const balanceTotal = moved ?? available + Math.min(parked, reachable);
  const max = kind === "balance" ? Math.floor(balanceTotal * 100) / 100 : susdrf;
  const value = Number(amount);

  // After sending: show where it is in Strike's withdrawal queue.
  useEffect(() => {
    if (!sent) return;
    let alive = true;
    const tick = () =>
      autopilot.withdrawStatus(session, sent.id).then(
        (r) => alive && setQueue(r.queued ? `Queued: about ${Math.max(1, Math.round((r.wait_seconds ?? 60) / 60))} min to go.` : "Processing on Cardano. It lands in your wallet after a few confirmations."),
        () => {},
      );
    void tick();
    const id = setInterval(tick, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sent, session]);

  const reset = () => {
    setQuote(null);
    setError("");
  };

  async function getQuote() {
    setBusy("quote");
    setError("");
    try {
      if (kind === "balance" && moved === null && value > available + 0.005 && parkedSubs.length) {
        if (!wallet) throw new Error("Connect your wallet to continue.");
        setBusy("move");
        const api = strikeApi(network);
        const token = await strikeLogin(api, wallet, address);
        for (const p of parkedSubs) await moveBetweenAccounts(api, token, p.id, accountId, p.available);
        setMoved(await refreshAvailable());
        setBusy("quote");
      }
      setQuote(await autopilot.withdrawQuote(session, kind === "balance" ? { mode: "balance", usd: value, asset } : { mode: "collateral", amount: value }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { info?: string })?.info ?? e);
      setError(/declin|reject|cancel/i.test(msg) ? "Cancelled in your wallet." : msg);
    } finally {
      setBusy("");
    }
  }

  async function sign() {
    if (!quote || !wallet) return;
    setBusy("sign");
    setError("");
    try {
      const sig = await signHexPayload(wallet, quote.messageToSign);
      if (sig.address !== address) throw new Error(`Sign with the wallet linked to your Strike account (${short(address)}).`);
      // Cardano withdrawals can include a small funding transaction for the validator: sign it too (Strike submits it).
      const signedTx = quote.txCbor ? await signOnly(wallet, quote.txCbor) : null;
      setSent(await autopilot.withdrawConfirm(session, quote.withdrawId, sig.wallet_signature, signedTx));
      onUsedWallet?.(wallet);
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { info?: string })?.info ?? e);
      setError(/declin|reject|cancel/i.test(msg) ? "Cancelled in your wallet." : msg);
    } finally {
      setBusy("");
    }
  }

  const close = () => {
    setMoved(null);
    setSent(null);
    setQuote(null);
    setAmount("");
    setError("");
    setQueue("");
    onClose();
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
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold">Withdraw</h2>
              <button onClick={close} aria-label="Close" className="grid size-8 place-items-center rounded-full text-soft hover:bg-white/10">
                ✕
              </button>
            </div>
            {!sent && <MoneyPath direction="out" address={address} className="mt-4" />}

            {sent ? (
              <div className="mt-6 text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-mint text-2xl text-ink">✓</span>
                <p className="mt-4 font-display text-xl font-semibold">On its way to your wallet</p>
                <p className="mt-2 text-sm text-muted">{queue || "Strike is processing it."}</p>
                <p className="mt-1 font-mono text-[11px] text-white/40">{short(address)}</p>
                <button onClick={close} className="mt-6 w-full rounded-full bg-mint py-3 font-semibold text-ink">
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  {(
                    [
                      ["balance", "Trading balance", usd(balanceTotal)],
                      ["collateral", "RealFi sUSDrf", `${susdrf.toLocaleString("en-US", { maximumFractionDigits: 2 })} sUSDrf`],
                    ] as const
                  ).map(([k, t, v]) => (
                    <button
                      key={k}
                      disabled={k === "collateral" && susdrf <= 0}
                      onClick={() => {
                        setKind(k);
                        setAmount("");
                        reset();
                      }}
                      className={`rounded-2xl border p-3 text-left transition disabled:opacity-40 ${kind === k ? "border-mint/60 bg-mint/[0.08]" : "border-white/10 hover:border-white/25"}`}
                    >
                      <span className="block text-sm font-semibold">{t}</span>
                      <span className="mt-0.5 block font-mono text-xs text-muted">{v}</span>
                    </button>
                  ))}
                </div>

                <label className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 focus-within:border-mint/50">
                  <span className="text-muted">{kind === "balance" ? "$" : ""}</span>
                  <input
                    type="number"
                    min={0}
                    value={amount}
                    placeholder="0.00"
                    onChange={(e) => {
                      setAmount(e.target.value);
                      reset();
                    }}
                    className="w-full bg-transparent font-mono text-lg outline-none"
                  />
                  <button onClick={() => (setAmount(String(max)), reset())} className="rounded-full bg-white/10 px-2.5 py-1 text-xs">
                    Max
                  </button>
                  {kind === "collateral" && <span className="text-xs text-muted">sUSDrf</span>}
                </label>
                {kind === "balance" && parked >= 0.01 && moved === null && (
                  <p className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2.5 text-xs leading-relaxed text-soft">
                    {usd(parked)} of this is in a copy sub-account. If you withdraw more than {usd(available)}, Bolt moves it to your main account first: your wallet signs a free Strike login (no
                    transaction), then the withdrawal as usual.
                  </p>
                )}
                {kind === "balance" && (
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <span className="text-muted">Receive as</span>
                    {(["ADA", "USDM"] as const).map((a) => (
                      <button key={a} onClick={() => (setAsset(a), reset())} className={`rounded-full px-3 py-1 ${asset === a ? "bg-white/15 text-white" : "text-muted hover:text-white"}`}>
                        {a}
                      </button>
                    ))}
                  </div>
                )}
                {kind === "balance" && (
                  <p className="mt-2 text-[11px] text-white/40">
                    Money in running copies comes back to this balance when they stop: stop the bot to withdraw everything.
                  </p>
                )}

                {quote && (
                  <div className="mt-4 space-y-1.5 rounded-2xl bg-white/[0.04] p-4 text-sm">
                    <p className="flex justify-between">
                      <span className="text-muted">Withdraw</span>
                      <span className="font-mono">{kind === "balance" ? `${usd(value)} as ${asset}` : `${value} sUSDrf`}</span>
                    </p>
                    <p className="flex justify-between">
                      <span className="text-muted">Strike fee</span>
                      <span className="font-mono">{usd(quote.fee)}</span>
                    </p>
                    <p className="flex justify-between">
                      <span className="text-muted">To your wallet</span>
                      <span className="font-mono">{short(address)}</span>
                    </p>
                    {quote.txCbor && <p className="pt-1 text-[11px] text-white/45">Your wallet also signs a small Cardano transaction that funds the withdrawal (a little ADA for the network).</p>}
                  </div>
                )}

                {wallets.length > 1 && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {wallets.map((w) => (
                      <button key={w.key} onClick={() => setWallet(w.key)} className={`rounded-full px-3 py-1 ${wallet === w.key ? "bg-white/15 text-white" : "text-muted"}`}>
                        {w.name}
                      </button>
                    ))}
                  </div>
                )}

                {error && <p className="mt-3 rounded-xl bg-neg/10 px-3 py-2 text-sm text-neg">{error}</p>}

                {quote ? (
                  <button disabled={busy === "sign" || !wallet} onClick={() => void sign()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-mint py-3 font-semibold text-ink disabled:opacity-50">
                    {busy === "sign" ? "Check your wallet…" : "Sign & withdraw"}
                  </button>
                ) : (
                  <button disabled={!(value > 0) || value > max || busy === "quote"} onClick={() => void getQuote()} className="mt-5 w-full rounded-full bg-mint py-3 font-semibold text-ink disabled:opacity-50">
                    {busy === "move" ? "Sign in your wallet to move it to your main account…" : busy === "quote" ? "Getting a quote…" : value > max ? "More than you have" : "Review"}
                  </button>
                )}
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
