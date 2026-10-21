"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { site } from "@/lib/config";
import { installedWallets, signMessage, type InstalledWallet } from "@/lib/wallet";

// The PnL cup, inside a holder's demo: join by signing with the wallet (free, no transaction),
// then see your place on the board. Hidden when no cup is running.

type Row = { address: string; rank: number | null; pct: number; prizeUsd: number };
type Cup = {
  kind?: "pnl" | "buy";
  phase: "off" | "upcoming" | "live" | "checking" | "final";
  start?: number;
  end?: number;
  pool?: { totalUsd: number };
  players?: number;
  leaderboard?: Row[];
  disqualified?: (Row & { out: string })[];
};

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const pctLabel = (f: number) => `${f >= 0 ? "+" : "−"}${Math.abs(f * 100).toFixed(2)}%`;
// Must match joinMessage() in worker/cup.ts exactly: it's what the wallet signs.
const joinMessage = (address: string, time: string) => `Join the $BOLT Bot Cup\nWallet: ${address}\nTime: ${time}`;

export function CupCard({ address, joined, onJoined }: { address: string; joined: boolean; onJoined: () => void }) {
  const [cup, setCup] = useState<Cup | null>(null);
  const [wallets, setWallets] = useState<InstalledWallet[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${site.botApi}/contest`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: Cup) => {
          if (!alive) return;
          setCup(j);
          setWallets(installedWallets()); // extensions inject window.cardano after page load
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [joined]);

  if (!cup || cup.kind !== "pnl" || !cup.start || !cup.end) return null;
  const open = cup.phase === "upcoming" || cup.phase === "live";
  if (!joined && !open) return null;

  async function join(walletKey: string) {
    setBusy(true);
    setError("");
    try {
      const time = new Date().toISOString();
      const signed = await signMessage(walletKey, (addr) => joinMessage(addr, time));
      if (signed.address !== address) throw new Error("That wallet isn't the one this demo belongs to. Sign with the same wallet you connected.");
      const res = await fetch(`${site.botApi}/demo/cup/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, signature: signed.signature, key: signed.key, time }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Couldn't join right now.");
      onJoined();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { info?: string })?.info ?? "Signing was cancelled.");
      setError(/declin|reject|cancel/i.test(msg) ? "Signing was cancelled." : msg);
    } finally {
      setBusy(false);
    }
  }

  const me = [...(cup.leaderboard ?? []), ...(cup.disqualified ?? [])].find((r) => r.address === address);

  return (
    <div className="card relative overflow-hidden rounded-3xl border border-mint/30 p-5 sm:p-7">
      <div className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-mint/15 blur-[90px]" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="font-mono text-xs tracking-[0.25em] text-mint uppercase">${site.ticker} Bot Cup</p>
          {joined ? (
            <>
              <h2 className="mt-2 font-display text-2xl font-semibold">You&apos;re in the cup.</h2>
              <p className="mt-1 text-sm text-muted">
                {cup.phase === "upcoming"
                  ? `It starts ${date(cup.start)}. Your demo starts fresh with $10,000 then, like everyone's.`
                  : me?.rank
                    ? `You're #${me.rank} of ${cup.players} with ${pctLabel(me.pct)} since the start.`
                    : me && "out" in me
                      ? `Out of the running: ${me.out}.`
                      : "Your place updates every few minutes."}
              </p>
            </>
          ) : (
            <>
              <h2 className="mt-2 font-display text-2xl font-semibold">Best bot return wins STRIKE.</h2>
              <p className="mt-1 text-sm text-muted">
                From {date(cup.start)} to {date(cup.end)}, the top 3 demo returns split a prize pool of {usd(cup.pool?.totalUsd ?? 0)} and growing. Tune your rules, then
                sign with your wallet to join: free, no transaction.
              </p>
            </>
          )}
        </div>
        {joined ? (
          <Link href="/contest" className="rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-mint-2">See the leaderboard</Link>
        ) : (
          <div className="flex flex-wrap gap-2">
            {wallets.map((w) => (
              <button key={w.key} disabled={busy} onClick={() => join(w.key)} className="flex items-center gap-2 rounded-full bg-mint py-1.5 pr-4 pl-1.5 text-sm font-semibold text-ink transition hover:bg-mint-2 disabled:opacity-60">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.icon} alt="" className="size-6 rounded-full bg-white" />
                {busy ? "Check your wallet…" : `Join with ${w.name}`}
              </button>
            ))}
            {!wallets.length && <p className="text-sm text-muted">Open this page in a browser with your Cardano wallet to join.</p>}
          </div>
        )}
      </div>
      {error && <p className="relative mt-3 text-sm text-neg">{error}</p>}
    </div>
  );
}
