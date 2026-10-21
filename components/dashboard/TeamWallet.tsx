"use client";

import { explorer, site } from "@/lib/config";
import { fmt2, shortHash } from "@/lib/format";
import { useCoin } from "@/lib/useCoin";
import { CopyButton } from "../ui";

/** Creator-fee side: what Solada has paid the deployer, and what the team wallet holds now. */
export function TeamWallet() {
  const coin = useCoin();
  const address = coin?.teamWallet.address ?? "";
  const ada = coin?.teamWallet.ada;

  const money = (v: number) => (coin?.fees.currency === "USDC" ? `$${fmt2(v)}` : `₳${fmt2(v)}`);

  return (
    <div className="card flex flex-col rounded-3xl p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-gold" />
        <h3 className="font-display text-lg font-semibold">Team wallet</h3>
      </div>
      <p className="mt-1 text-sm text-muted">Receives the {site.split.copyTrade}% creator share from Solada and funds the Strike copy-trade</p>
      <div className="mt-5 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-white/[0.04] p-3">
          <p className="text-[11px] text-muted">Creator fees earned</p>
          <p className="mt-0.5 truncate font-mono text-base">{coin?.launched ? money(coin.fees.creator) : "—"}</p>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-3">
          <p className="text-[11px] text-muted">Claimed from Solada</p>
          <p className="mt-0.5 truncate font-mono text-base">{coin?.launched ? `₳${fmt2(coin.creator.claimedAda)}` : "—"}</p>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-3">
          <p className="text-[11px] text-muted">Wallet balance</p>
          <p className="mt-0.5 truncate font-mono text-base">{!coin ? "…" : !address || ada == null ? "—" : `₳${fmt2(ada)}`}</p>
        </div>
      </div>
      {address ? (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-white/[0.04] py-1 pr-1 pl-3">
          <a href={explorer.address(address)} target="_blank" rel="noreferrer" className="truncate font-mono text-xs text-soft hover:text-mint">
            {shortHash(address, 10)}
          </a>
          <CopyButton text={address} label="Copy" />
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-3 text-center text-xs text-muted">Address shown once the coin is live</p>
      )}
    </div>
  );
}
