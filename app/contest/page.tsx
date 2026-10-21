import type { Metadata } from "next";
import { ContestBoard } from "@/components/ContestBoard";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: "Bot Cup",
  description: `The biggest $${site.ticker} buyers win STRIKE. The prize pool grows with every trade.`,
};

// The $BOLT trading contest: live leaderboard and prize pool, read from the bot server.
export default function ContestPage() {
  return (
    <main className="relative mx-auto max-w-5xl px-4 pt-32 pb-20 sm:px-6 sm:pt-40">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 overflow-hidden">
        <div className="absolute top-0 left-1/2 h-96 w-[900px] -translate-x-1/2 rounded-full bg-mint/10 blur-[140px]" />
      </div>
      <ContestBoard />
    </main>
  );
}
