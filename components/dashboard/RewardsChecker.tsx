"use client";

import { useEffect, useState } from "react";
import { site } from "@/lib/config";
import { fmt2, fmtCompact, shortHash } from "@/lib/format";
import type { WalletRewards } from "@/lib/solada";
import { connectAddress, installedWallets, type InstalledWallet } from "@/lib/wallet";
import { StrikeIcon } from "../ui";

function untilLabel(ms: number) {
  const mins = Math.max(0, Math.round((ms - Date.now()) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

export function RewardsChecker() {
  const [wallets, setWallets] = useState<InstalledWallet[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<(WalletRewards & { who: string }) | null>(null);

  // Extensions inject window.cardano shortly after load.
  useEffect(() => {
    const t = setTimeout(() => setWallets(installedWallets()), 300);
    return () => clearTimeout(t);
  }, []);

  async function check(address: string) {
    setError("");
    setResult(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/rewards?address=${encodeURIComponent(address)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't load rewards");
      setResult({ ...json, who: json.handle ? `$${json.handle}` : address });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function connect(key: string) {
    try {
      const address = await connectAddress(key);
      setInput(address);
      await check(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connection was rejected");
    }
  }

  return (
    <div className="card relative overflow-hidden rounded-3xl p-5 sm:p-8">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-mint/10 blur-[90px]" />
      <div className="relative grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">Check your STRIKE rewards</h2>
          <p className="mt-2 text-muted">
            Connect a wallet, or paste your address or $handle, to see what you&apos;re earning from the holder pot right now and when Solada pays it out.
          </p>

          {wallets.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {wallets.map((w) => (
                <button
                  key={w.key}
                  onClick={() => connect(w.key)}
                  className="glass flex items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5 text-sm transition hover:bg-white/10"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.icon} alt="" className="size-6 rounded-full" />
                  {w.name}
                </button>
              ))}
            </div>
          )}

          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              const v = input.trim();
              if (!/^addr1[0-9a-z]{50,120}$/.test(v) && !/^\$?[a-z0-9_.-]{1,15}$/i.test(v)) return setError("Paste a Cardano addr1… address or an ADA Handle ($name).");
              check(v);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="addr1… or $handle"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.06] px-5 py-3 font-mono text-sm outline-none placeholder:text-white/30 focus:border-mint/50"
            />
            <button disabled={busy} className="rounded-full bg-mint px-6 py-3 font-semibold text-ink transition hover:bg-mint-2 disabled:opacity-60">
              {busy ? "Checking…" : "Check"}
            </button>
          </form>
          {error && <p className="mt-3 text-sm text-neg">{error}</p>}
          <p className="mt-3 text-xs text-white/40">Read-only. Rewards are tracked and paid by Solada, so claim on Solada.</p>
        </div>

        <div className="rounded-2xl border border-white/8 bg-ink/40 p-5">
          {result ? (
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-muted">{result.who.startsWith("$") ? result.who : shortHash(result.who, 10)}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Tile label={`Your $${site.ticker}`} value={fmtCompact(result.held)} />
                <Tile label="Next payout in" value={result.nextPayoutAtMs ? untilLabel(result.nextPayoutAtMs) : "—"} />
              </div>
              <div className={`mt-3 rounded-xl p-4 ${result.held > 0 ? "bg-mint/10" : "bg-white/[0.04]"}`}>
                {result.held > 0 ? (
                  <>
                    <p className="text-xs text-muted">Earning this round</p>
                    <p className="mt-1 flex items-center gap-2 font-display text-3xl font-bold">
                      <StrikeIcon size={26} />₳{fmt2(result.earningAda)}
                    </p>
                    <p className="mt-1 text-xs text-muted">worth of {result.paidIn}, paid at the next payout</p>
                  </>
                ) : (
                  <p className="text-sm text-soft">This wallet doesn&apos;t hold ${site.ticker} yet. Buy on Solada to start earning STRIKE.</p>
                )}
              </div>
              {result.strike.claimed + result.strike.unclaimed > 0 && (
                <div className="mt-3 rounded-xl bg-white/[0.04] p-4">
                  <p className="text-xs text-muted">Earned so far</p>
                  <p className="mt-1 flex items-center gap-2 font-display text-2xl font-bold">
                    <StrikeIcon size={22} />
                    {fmt2(result.strike.claimed + result.strike.unclaimed)} STRIKE
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    worth about ₳{fmt2(result.strike.claimedAda + result.strike.unclaimedAda)}: {fmt2(result.strike.claimed)} claimed · {fmt2(result.strike.unclaimed)} ready to claim
                  </p>
                  {result.strike.otherSources.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-white/40">Includes STRIKE rewards from {result.strike.otherSources.join(", ")} (also paid in STRIKE to this wallet).</p>
                  )}
                </div>
              )}
              {result.strike.unclaimed > 0 && (
                <a href={site.token.launchpad.url} target="_blank" rel="noreferrer" className="mt-3 block rounded-xl bg-white/[0.04] p-3 text-sm text-soft hover:text-white">
                  <span className="font-mono text-mint">{fmt2(result.strike.unclaimed)} STRIKE</span> ready to claim on Solada →
                </a>
              )}
            </div>
          ) : (
            <div className="grid h-full min-h-56 place-items-center text-center">
              <div>
                <StrikeIcon size={44} className="mx-auto opacity-80" />
                <p className="mt-3 text-sm text-muted">Your rewards show up here</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] p-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 font-mono text-xl">{value}</p>
    </div>
  );
}
