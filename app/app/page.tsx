import type { Metadata } from "next";
import Link from "next/link";
import { FadeUp, InView } from "@/components/motion";
import { BurnedTile, BurnsTable } from "@/components/dashboard/Burns";
import { CoinPanel } from "@/components/dashboard/CoinPanel";
import { RewardsChecker } from "@/components/dashboard/RewardsChecker";
import { TeamWallet } from "@/components/dashboard/TeamWallet";
import { Flame } from "@/components/ui";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: "App",
  description: `Live $${site.ticker} market, holder rewards from Solada, and every burn with the transaction behind it.`,
};

export default function Dashboard() {
  return (
    <>
      <FadeUp delay={0.1}>
      <header id="overview" className="flex scroll-mt-28 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-mono text-xs tracking-wider text-mint uppercase">
            <span className="size-1.5 animate-pulse rounded-full bg-mint" /> Transparency
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">${site.ticker} App</h1>
          <p className="mt-2 max-w-xl text-muted">
            Market and holder rewards come live from Solada. Every burn is logged with its transaction.
          </p>
        </div>
        {!site.solada.id && (
          <div className="max-w-xs rounded-2xl border border-mint/25 bg-mint/8 px-4 py-3 text-sm text-soft">
            <span className="font-semibold text-mint">Pre-launch.</span> Market data, rewards and burns go live when ${site.ticker} launches.
          </div>
        )}
      </header>
      </FadeUp>

      <FadeUp delay={0.25}>
        <CoinPanel />
      </FadeUp>

      <InView>
      <section id="rewards" className="mt-6 scroll-mt-28">
        <RewardsChecker />
      </section>
      </InView>

      <InView>
      <div id="burn-engine" className="mt-16 flex scroll-mt-28 items-center gap-3">
        <Flame size={22} />
        <h2 className="font-display text-3xl font-bold tracking-tight">Burn engine</h2>
      </div>
      <p className="mt-1 text-muted">The creator half: Solada fees go to the team wallet, then into Strike copy-trade (tracked live from Strike), and the profits are bought back and burned.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <TeamWallet />
        </div>
        <BurnedTile />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.5fr]">
        <Link href="/app/bot" className="card group flex min-w-0 flex-col justify-between rounded-3xl p-5 transition hover:border-mint/40 sm:p-7">
          <div>
            <p className="font-mono text-xs tracking-wider text-mint uppercase">Where the burns come from</p>
            <h2 className="mt-3 font-display text-2xl font-semibold">Copy-trade bot</h2>
            <p className="mt-2 text-sm text-muted">
              The team wallet&apos;s share is copy-traded on Strike by Bolt&apos;s bot. See who it copies, what it&apos;s holding and how it&apos;s doing, live.
            </p>
          </div>
          <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-mint">
            Open the bot <span className="transition group-hover:translate-x-1">→</span>
          </span>
        </Link>

        <section id="burns" className="card min-w-0 scroll-mt-28 rounded-3xl p-5 sm:p-7">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold"><Flame size={20} /> Buybacks & burns</h2>
          <BurnsTable />
        </section>
      </div>
      </InView>
    </>
  );
}
