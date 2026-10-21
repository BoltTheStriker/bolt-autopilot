import Image from "next/image";
import Link from "next/link";
import { site, tokenUnit } from "@/lib/config";
import { CopyTradeCard } from "../CopyTradeCard";
import { FloatCard } from "../FloatCard";
import { HolderPotCard } from "../HolderPotCard";
import { CopyButton, Flame, MascotIcon } from "../ui";
import { FadeUp, PopIn, SplitWords } from "../motion";
import { HeroStats } from "./HeroStats";
import { BurnFloatValue } from "../dashboard/Burns";

export function HomeHero() {
  return (
    <section className="relative overflow-hidden pt-36 sm:pt-44">
      {/* light streaks */}
      <FadeUp className="pointer-events-none absolute inset-0" aria-hidden y={0} blur={0} duration={1.8}>
        <div className="streak top-[8%] -left-[20%] h-40 w-[90%]" style={{ ["--r" as string]: "-18deg" }} />
        <div className="streak top-[22%] -right-[25%] h-56 w-[85%] [animation-delay:-6s]" style={{ ["--r" as string]: "24deg" }} />
        <div className="streak top-[48%] left-[5%] h-32 w-[70%] opacity-35 [animation-delay:-11s]" style={{ ["--r" as string]: "-8deg" }} />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,#0a0a0a_75%)]" />
        <div className="bg-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_top,#000_20%,transparent_70%)]" />
      </FadeUp>

      <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
        <FadeUp delay={0.15} y={16}>
          <span className="glass mb-7 inline-flex items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5 text-sm text-soft">
            <MascotIcon size={24} />
            Meet <span className="font-semibold text-white">{site.fullName}</span>
          </span>
        </FadeUp>
        <h1 className="font-display text-[clamp(3rem,9vw,6.5rem)] leading-[0.95] font-bold tracking-[-0.035em]">
          <SplitWords pieces={[["Hold the", "font-light italic"], ["Mascot", "text-gradient"]]} delay={0.3} stagger={0.1} />
        </h1>
        <FadeUp delay={0.65}>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-soft sm:text-xl">
          Half of every trading fee is paid to holders in STRIKE. The other half runs a Strike copy-trade, and its profits buy back
          ${site.ticker} and burn it.
        </p>
        </FadeUp>
        <FadeUp delay={0.8} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/app"
            className="group mint-glow inline-flex w-full items-center justify-center gap-2 rounded-full bg-mint px-8 py-3.5 font-semibold text-ink transition hover:-translate-y-0.5 hover:bg-mint-2 sm:w-auto"
          >
            Launch App
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="transition group-hover:translate-x-0.5">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </Link>
          <a
            href={site.token.launchpad.url}
            target="_blank"
            rel="noreferrer"
            className="glass w-full rounded-full px-8 py-3.5 text-center font-semibold transition hover:-translate-y-0.5 hover:bg-white/10 sm:w-auto"
          >
            Buy on {site.token.launchpad.name}
          </a>
        </FadeUp>

        {tokenUnit.length > 56 && (
          <FadeUp delay={0.9} className="mt-6 flex justify-center">
            <span className="glass inline-flex max-w-full items-center gap-2 rounded-full py-1 pr-1 pl-4 font-mono text-xs text-muted">
              <span className="text-white/50">CA</span>
              <span className="truncate text-soft">{tokenUnit.slice(0, 10)}…{tokenUnit.slice(-8)}</span>
              <CopyButton text={tokenUnit} label="Copy" />
            </span>
          </FadeUp>
        )}

        <FadeUp delay={0.95}>
          <HeroStats />
        </FadeUp>
      </div>

      {/* mascot stage */}
      <div className="relative mx-auto mt-10 max-w-5xl px-4 sm:px-6">
        <div className="relative mx-auto aspect-[4/3] max-w-[640px]">
          <div className="absolute inset-x-[12%] top-[10%] bottom-0 rounded-full bg-mascot/20 blur-3xl" />
          <FadeUp delay={0.5} y={70} blur={16} duration={1.2} className="relative z-10 h-full">
          <Image
            src="/mascot.png"
            alt={`${site.fullName} flexing`}
            width={1161}
            height={1220}
            priority
            sizes="(min-width: 768px) 640px, 92vw"
            className="fade-bottom relative z-10 mx-auto h-full w-auto animate-float-slow object-contain object-bottom drop-shadow-[0_30px_60px_rgba(78,250,176,0.25)]"
          />
          </FadeUp>
          <PopIn delay={1.2} className="pointer-events-none absolute inset-0 z-20 [&>*]:pointer-events-auto">
            <HolderPotCard className="top-[6%] -left-2 animate-float sm:-left-24" />
          </PopIn>
          <PopIn delay={1.4} className="pointer-events-none absolute inset-0 z-20 [&>*]:pointer-events-auto">
            <CopyTradeCard className="top-[38%] -right-2 hidden animate-float [animation-delay:-2s] sm:flex sm:-right-28" />
          </PopIn>
          <PopIn delay={1.6} className="pointer-events-none absolute inset-0 z-20 [&>*]:pointer-events-auto">
          <FloatCard
            className="bottom-[14%] left-0 hidden animate-float [animation-delay:-4s] sm:-left-16 md:flex"
            icon={<Flame size={20} />}
            sub="Buyback & burn"
            title={`$${site.ticker} burned`}
            value={<BurnFloatValue />}
            valueClass="text-gold"
          />
          </PopIn>
        </div>
      </div>
    </section>
  );
}
