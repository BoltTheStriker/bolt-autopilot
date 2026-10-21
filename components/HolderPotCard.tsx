"use client";

import { fmt2 } from "@/lib/format";
import { useCoin } from "@/lib/useCoin";
import { FloatCard } from "./FloatCard";
import { StrikeIcon } from "./ui";

/** Live size of the Solada holder pot that's paid out next in STRIKE. */
export function HolderPotCard({ className }: { className: string }) {
  const coin = useCoin();
  return (
    <FloatCard
      className={className}
      icon={<StrikeIcon size={22} />}
      sub={coin?.launched ? `Holder pot · ${coin.holders} holders` : "Holder rewards"}
      title="Paid out in STRIKE"
      value={!coin ? "…" : coin.launched ? potLabel(coin.pot) : "At launch"}
    />
  );
}

/** Cardano-curve coins fill the pot in ADA, Pump-side coins in USDC. */
export function potLabel(pot: { ada: number; usdc: number }) {
  if (pot.usdc && !pot.ada) return `$${fmt2(pot.usdc)}`;
  return `₳${fmt2(pot.ada)}${pot.usdc ? ` + $${fmt2(pot.usdc)}` : ""}`;
}
