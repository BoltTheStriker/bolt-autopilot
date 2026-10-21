import Image from "next/image";
import Link from "next/link";
import { site } from "@/lib/config";
import { CopyTradeCard } from "../CopyTradeCard";
import { HolderPotCard } from "../HolderPotCard";
import { Reveal } from "../ui";

/** "Trade Anywhere"-style split: copy on the left, the mascot at his desk with live cards on the right. */
export function DeskSection() {
  return (
    <section className="relative mx-auto max-w-6xl px-4 pt-32 sm:px-6">
      <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.1fr]">
        <Reveal>
          <h2 className="font-display text-4xl font-bold tracking-tight sm:text-6xl">
            Earn <span className="font-light italic">while you sleep</span>
          </h2>
          <p className="mt-4 font-mono text-xs tracking-[0.3em] text-muted uppercase">Real yield. Real burns.</p>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-soft">
            {site.fullName} runs the desk around the clock: collecting fees, copying Strike&apos;s best traders and burning the profits. You just
            hold ${site.ticker} in any Cardano wallet.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/app#rewards" className="glass rounded-2xl px-4 py-3 text-sm transition hover:bg-white/10">
              <span className="block text-[11px] text-muted">Check your</span>
              <span className="font-semibold">STRIKE rewards</span>
            </Link>
            <Link href="/app/bot" className="glass rounded-2xl px-4 py-3 text-sm transition hover:bg-white/10">
              <span className="block text-[11px] text-muted">Watch the</span>
              <span className="font-semibold">Copy-trade bot</span>
            </Link>
            <Link href="/app#burn-engine" className="glass rounded-2xl px-4 py-3 text-sm transition hover:bg-white/10">
              <span className="block text-[11px] text-muted">Follow the</span>
              <span className="font-semibold">Burn engine</span>
            </Link>
          </div>
        </Reveal>

        <Reveal delay={120} className="relative">
          <div className="overflow-hidden rounded-[2rem] border border-white/10 shadow-[0_40px_120px_-30px_rgba(78,250,176,0.35)]">
            <Image src="/mascot-desk.webp" alt={`${site.fullName} at the trading desk`} width={1200} height={1200} sizes="(min-width: 1024px) 560px, 92vw" className="aspect-square w-full object-cover" />
          </div>
          <HolderPotCard className="-top-5 -left-3 animate-float sm:-left-10" />
          <CopyTradeCard className="-right-3 -bottom-5 animate-float [animation-delay:-3s] sm:-right-8" />
        </Reveal>
      </div>
    </section>
  );
}
