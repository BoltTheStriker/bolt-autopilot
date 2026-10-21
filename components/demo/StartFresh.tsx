"use client";

import { useState } from "react";
import { site } from "@/lib/config";
import { installedWallets, signMessage, type InstalledWallet } from "@/lib/wallet";

// Must match resetMessage() in worker/cup.ts exactly: it's what the wallet signs.
const resetMessage = (address: string, time: string) => `Start my $BOLT demo over\nWallet: ${address}\nTime: ${time}`;

/** "Start fresh": back to $10,000 with the same rules. Signed with the wallet so nobody else can wipe a demo. */
export function StartFresh({ address, onDone }: { address: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<InstalledWallet[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reset(walletKey: string) {
    setBusy(true);
    setError("");
    try {
      const time = new Date().toISOString();
      const signed = await signMessage(walletKey, (addr) => resetMessage(addr, time));
      if (signed.address !== address) throw new Error("Sign with the same wallet this demo belongs to.");
      const res = await fetch(`${site.botApi}/demo/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, signature: signed.signature, key: signed.key, time }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Couldn't start over right now.");
      setOpen(false);
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Signing was cancelled.";
      setError(/declin|reject|cancel/i.test(msg) ? "Signing was cancelled." : msg);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button
        onClick={() => {
          setWallets(installedWallets());
          setOpen(true);
        }}
        className="rounded-full px-4 py-2.5 text-sm text-muted transition hover:text-white"
      >
        Start fresh
      </button>
    );

  return (
    <div className="w-full rounded-2xl border border-gold/30 bg-gold/[0.06] p-4 text-sm">
      <p className="text-soft">
        Start over with $10,000? Your balance, traders and history are wiped; your rules stay. Sign with your wallet to confirm (free, no transaction).
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {wallets.map((w) => (
          <button key={w.key} disabled={busy} onClick={() => reset(w.key)} className="glass flex items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5 transition hover:bg-white/10 disabled:opacity-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={w.icon} alt="" className="size-6 rounded-full" />
            {busy ? "Check your wallet…" : `Sign with ${w.name}`}
          </button>
        ))}
        {!wallets.length && <span className="text-muted">Open this page in a browser with your Cardano wallet.</span>}
        <button disabled={busy} onClick={() => setOpen(false)} className="rounded-full px-4 py-1.5 text-muted hover:text-white">Cancel</button>
      </div>
      {error && <p className="mt-2 text-neg">{error}</p>}
    </div>
  );
}
