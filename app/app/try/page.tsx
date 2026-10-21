import type { Metadata } from "next";
import { FadeUp } from "@/components/motion";
import { DemoPanel } from "@/components/demo/DemoPanel";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: "Try the bot",
  description: `For $${site.ticker} holders: run your own copy-trade bot on Strike with $10,000 of demo money, and compete in the Bot Cup.`,
};

// Holders' own copy-trade bot with demo money (switched on/off from /admin), and the PnL cup.
export default function TryPage() {
  return (
    <>
      <FadeUp delay={0.1}>
        <header>
          <p className="flex items-center gap-2 font-mono text-xs tracking-wider text-mint uppercase">
            <span className="size-1.5 animate-pulse rounded-full bg-mint" /> Live for ${site.ticker} holders
          </p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold tracking-tight sm:text-5xl">Your own copy-trade bot on Strike.</h1>
          <p className="mt-3 max-w-2xl text-muted">
            Hold 1M+ ${site.ticker} and run Bolt&apos;s bot with your own rules and $10,000 of demo money. It picks the traders, sizes the copies and manages
            the risk on Strike. Join the Bot Cup and the best returns win STRIKE.
          </p>
        </header>
      </FadeUp>
      <DemoPanel />
    </>
  );
}
