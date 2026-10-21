"use client";

// RealFi on Strike, inside Bolt: RealFi's sUSDrf (a yield-bearing dollar) pledged in Strike's Borrow &
// Earn, whose credit goes into SLP, so the same dollars earn sUSDrf's yield and SLP's returns.
// Get sUSDrf (SundaeSwap) → deposit it to Strike (one signature) → pledge & earn → withdraw from Bolt.
import { useState } from "react";
import type { AutoMe, SlpInfo } from "@/lib/autopilotApi";
import type { InstalledWallet } from "@/lib/wallet";
import { usd } from "./steps";

export const SUSDRF_UNIT = "7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae7355534472"; // on-chain name "sUSDr"
const SUNDAE = "https://app.sundae.fi/exchange";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const units = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** What a real (connected) account can do here; null in the demo. */
export type RealFiActions = {
  wallets: InstalledWallet[];
  readWallet: (key: string) => Promise<number>; // sUSDrf in that wallet
  deposit: (key: string, amount: number) => Promise<void>;
  withdraw: () => void;
  busy: boolean;
};

export function RealFiFlow({ slp, realfi, actions }: { slp: SlpInfo | null; realfi: AutoMe["realfi"]; actions: RealFiActions | null }) {
  const s = slp?.susdrf ?? null;
  // The remembered wallet when there is one (a single entry); otherwise the user's pick, or the first.
  const [picked, setKey] = useState<string | null>(null);
  const key = actions?.wallets.length === 1 ? actions.wallets[0].key : (picked ?? actions?.wallets[0]?.key ?? null);
  const [held, setHeld] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState("");

  const check = async () => {
    if (!actions || !key) return;
    setErr("");
    try {
      setHeld(await actions.readWallet(key));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="card relative overflow-hidden rounded-[2rem] border border-mint/20 p-6 sm:p-8" data-tour="realfi">
      <div className="pointer-events-none absolute -top-28 -left-24 h-80 w-80 rounded-full bg-mint/10 blur-[110px]" />
      <div className="relative flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <p className="font-mono text-xs tracking-wider text-mint uppercase">RealFi × Strike, inside Bolt</p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">Two yields, same dollars.</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Pledge RealFi&apos;s sUSDrf in Strike&apos;s Borrow &amp; Earn. The sUSDrf keeps earning its own yield, and the credit it backs goes into SLP. Strike charges no interest on that credit.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Big label="sUSDrf yield" value={s ? pct(s.yieldApr) : "—"} />
          <span className="font-display text-3xl text-white/40">+</span>
          <Big label="SLP APR" value={slp ? pct(slp.apr) : "—"} />
        </div>
      </div>
      {s && (
        <p className="relative mt-4 text-xs text-muted">
          Live from Strike: {s.openLines} open sUSDrf lines, ${(s.debt / 1000).toFixed(0)}K drawn into SLP. sUSDrf&apos;s yield is RealFi&apos;s exchange-rate growth over 28 days.
        </p>
      )}

      <ol className="relative mt-6 grid gap-3 lg:grid-cols-4">
        <Step n={1} title="Get sUSDrf" body="Swap ADA or USDC for sUSDrf on SundaeSwap, RealFi's liquidity partner.">
          <a href={SUNDAE} target="_blank" rel="noreferrer" className="glass inline-flex rounded-full px-4 py-2 text-xs font-semibold hover:bg-white/10">
            Open SundaeSwap ↗
          </a>
          <p className="mt-2 text-[10px] text-white/35">In-app swap coming next.</p>
        </Step>

        <Step n={2} title="Deposit to Strike" body="One signature moves sUSDrf from your wallet to your Strike account.">
          {actions ? (
            <div className="space-y-2">
              {actions.wallets.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {actions.wallets.map((w) => (
                    <button key={w.key} onClick={() => (setKey(w.key), setHeld(null))} className={`rounded-full px-2.5 py-0.5 text-[11px] ${key === w.key ? "bg-white/15 text-white" : "text-muted"}`}>
                      {w.name}
                    </button>
                  ))}
                </div>
              )}
              {held === null ? (
                <button disabled={!key} onClick={() => void check()} className="rounded-full bg-white/10 px-3 py-1.5 text-xs">
                  Check my wallet
                </button>
              ) : (
                <p className="text-xs text-soft">
                  You hold <span className="font-mono text-white">{units(held)}</span> sUSDrf
                </p>
              )}
              {held !== null && held > 0 && (
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    value={amount}
                    placeholder="Amount"
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-24 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5 font-mono text-xs outline-none focus:border-mint/50"
                  />
                  <button
                    disabled={actions.busy || !(Number(amount) >= 1) || Number(amount) > held || !key}
                    onClick={() => key && void actions.deposit(key, Number(amount))}
                    className="rounded-full bg-mint px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40 transition hover:bg-mint-2 hover:shadow-[0_6px_24px_rgba(78,250,176,0.35)] active:scale-[0.97]"
                  >
                    {actions.busy ? "Signing…" : "Deposit"}
                  </button>
                </div>
              )}
              {err && <p className="text-[11px] text-neg">{err}</p>}
            </div>
          ) : (
            <p className="text-[11px] text-white/40">Needs a real account.</p>
          )}
        </Step>

        <Step n={3} title="Pledge & earn" body="One tap: pledge your sUSDrf and its credit goes into SLP.">
          <span className="inline-flex rounded-full border border-gold/40 px-2.5 py-1 text-[11px] text-gold">Soon: waiting on Strike&apos;s go-ahead</span>
        </Step>

        <Step n={4} title="Withdraw anytime" body="Your balance or your sUSDrf back to your wallet, right from Bolt.">
          {actions ? (
            <button onClick={actions.withdraw} className="glass inline-flex rounded-full px-4 py-2 text-xs font-semibold hover:bg-white/10">
              Withdraw
            </button>
          ) : (
            <p className="text-[11px] text-white/40">Needs a real account.</p>
          )}
        </Step>
      </ol>

      {realfi && (realfi.custody > 0 || realfi.pledged > 0) && (
        <div className="relative mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Mini label="sUSDrf on Strike" value={units(realfi.custody)} />
          <Mini label="Pledged" value={units(realfi.pledged)} />
          <Mini label="Credit in SLP" value={usd(realfi.debtUsd)} />
          <Mini label="Room to draw" value={usd(realfi.headroomUsd)} />
        </div>
      )}

      <p className="relative mt-5 text-[11px] leading-relaxed text-white/40">
        Both yields are variable and past returns don&apos;t promise future ones. sUSDrf takes losses first if RealFi&apos;s loans go bad. SLP trades against the market and can lose money; if SLP and your collateral fall
        together (for example SLP down about 20%), Strike can unwind the line by redeeming SLP shares or converting collateral. Bolt isn&apos;t affiliated with Strike or RealFi.
      </p>
    </section>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-mint/25 bg-mint/[0.06] px-4 py-3 text-center">
      <p className="font-mono text-3xl text-mint">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted">{label}</p>
    </div>
  );
}

function Step({ n, title, body, children }: { n: number; title: string; body: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <span className="grid size-7 place-items-center rounded-full bg-mint font-mono text-xs font-semibold text-ink">{n}</span>
      <p className="mt-3 font-display font-semibold">{title}</p>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-muted">{body}</p>
      <div className="mt-3">{children}</div>
    </li>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 font-mono">{value}</p>
    </div>
  );
}

