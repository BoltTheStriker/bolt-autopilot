"use client";

import { site } from "@/lib/config";
import { useCoin } from "@/lib/useCoin";
import { CountUp } from "../ui";

/**
 * Hero numbers row. Before launch it shows facts about the mechanics (true from day one);
 * once the coin is live on Solada it switches to live numbers, like strikefinance.org's
 * volume / traders / transactions row.
 */
export function HeroStats() {
  const coin = useCoin();
  const burned = coin?.burned ?? 0;

  const items = coin?.launched
    ? [
        { k: "Holders earning STRIKE", node: <CountUp value={coin.holders} format="int" /> },
        { k: "Earned by holders", node: <CountUp value={coin.fees.holders} format={coin.fees.currency === "USDC" ? "usd" : "ada"} /> },
        { k: `$${site.ticker} burned`, node: burned ? <CountUp value={burned} format="compact" /> : "Soon" },
      ]
    : [
        { k: "Of fees to holders", node: `${site.split.holders}%` },
        { k: "STRIKE payouts", node: site.distributionEvery },
        { k: "Of copy-trade profit burned", node: "100%" },
      ];

  return (
    <dl className="mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-4 border-t border-white/8 pt-8">
      {items.map((f) => (
        // Label is the <dt> (read first), shown under the number via column-reverse.
        <div key={f.k} className="flex flex-col-reverse">
          <dt className="mt-1 text-xs text-muted sm:text-sm">{f.k}</dt>
          <dd className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{f.node}</dd>
        </div>
      ))}
    </dl>
  );
}
