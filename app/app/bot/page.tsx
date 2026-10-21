import type { Metadata } from "next";
import { CopyTradePanel } from "@/components/CopyTradePanel";
import { FadeUp, InView } from "@/components/motion";
import { TrackRecord } from "@/components/TrackRecord";
import { BotCopies, BotDecisions, BotFeed, BotHolding, BotLive, BotRules, BotStatus, BotThinking } from "@/components/dashboard/BotPanel";
import { site } from "@/lib/config";
import { getLedger } from "@/lib/ledger";

export const metadata: Metadata = {
  title: "Copy-trade bot",
  description: `The $${site.ticker} copy-trade bot: who it copies on Strike, what they're holding, and how it's doing, live.`,
};

const Label = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-14 mb-4 font-mono text-xs tracking-[0.25em] text-white/40 uppercase">{children}</p>
);

// Order: headline result → what's happening now → who and why → background.
export default function BotPage() {
  const ledger = getLedger();

  return (
    <>
      <FadeUp delay={0.1}>
        <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="flex items-center gap-2 font-mono text-xs tracking-wider text-mint uppercase">
              <span className="size-1.5 animate-pulse rounded-full bg-mint" /> Copy-trade engine
            </p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">Copy-trade bot</h1>
            <p className="mt-2 max-w-2xl text-muted">
              Bolt&apos;s bot picks traders on Strike, copies them and swaps out the weak ones. Profits buy back and burn ${site.ticker}.
            </p>
          </div>
          <BotStatus />
        </header>
      </FadeUp>

      <FadeUp delay={0.2}>
        <div className="mt-8 grid gap-4">
          <CopyTradePanel history={ledger.history} />
          <BotLive />
        </div>
      </FadeUp>

      <InView>
        <Label>Right now</Label>
        <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <BotHolding />
          <BotThinking />
        </div>
      </InView>

      <InView>
        <Label>Who it copies</Label>
        <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <div className="grid min-w-0 content-start gap-4">
            <BotCopies />
            <BotFeed />
          </div>
          <BotDecisions />
        </div>
      </InView>

      <InView>
        <Label>Their track record</Label>
        <TrackRecord botLink={false} />
      </InView>

      <InView>
        <Label>How it works</Label>
        <BotRules />
      </InView>
    </>
  );
}
