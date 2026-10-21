import Link from "next/link";
import { site } from "@/lib/config";
import { Reveal } from "../ui";

/** Tokenomics after strikefinance.org's: a facts row, the fee-split donut and a big headline card. */
export function TokenomicsHome() {
  const h = site.split.holders;
  // Donut: holders vs burn engine, with a small surface gap between the arcs.
  const r = 42;
  const c = 2 * Math.PI * r;
  const gap = 1.2;

  return (
    <section id="tokenomics" className="relative mx-auto max-w-6xl scroll-mt-28 px-4 pt-32 sm:px-6">
      <Reveal className="text-center">
        <h2 className="font-display text-4xl font-bold tracking-tight sm:text-6xl">
          <span className="font-light italic">Tokenomics</span>
        </h2>
        <p className="mt-4 font-mono text-xs tracking-[0.3em] text-muted uppercase">Fair launch. Real yield. Real burns.</p>
        <p className="mt-6 inline-flex flex-wrap justify-center gap-x-3 gap-y-1 rounded-full border border-white/8 px-4 py-2 font-mono text-xs text-soft">
          <span>${site.ticker}</span>
          <span className="text-white/25">·</span>
          <span>{site.token.totalSupply.toLocaleString("en-US")} supply</span>
          <span className="text-white/25">·</span>
          <span>Cardano</span>
          <span className="text-white/25">·</span>
          <span>{site.token.launchpad.name} bonding curve</span>
        </p>
      </Reveal>

      <div className="mt-14 grid items-center gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal className="mx-auto flex items-center gap-6">
          <div className="relative size-44 shrink-0">
            <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={`${h}% to holders, ${100 - h}% to the burn engine`}>
              <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
              <circle cx="50" cy="50" r={r} fill="none" stroke="#1fa874" strokeWidth="12" strokeDasharray={`${((h - gap) / 100) * c} ${c}`} strokeDashoffset={-(gap / 2 / 100) * c} />
              <circle cx="50" cy="50" r={r} fill="none" stroke="#c96a0e" strokeWidth="12" strokeDasharray={`${((100 - h - gap) / 100) * c} ${c}`} strokeDashoffset={-((h + gap / 2) / 100) * c} />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="font-display text-2xl font-bold">Fees</p>
                <p className="font-mono text-[10px] text-muted uppercase">split</p>
              </div>
            </div>
          </div>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-series-holders" /><span className="font-semibold">{h}%</span> <span className="text-muted">holders, in STRIKE</span></li>
            <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-series-vault" /><span className="font-semibold">{100 - h}%</span> <span className="text-muted">copy-trade → burn</span></li>
          </ul>
        </Reveal>

        <Reveal delay={120} className="relative overflow-hidden rounded-[2rem] border border-mint/15 bg-gradient-to-br from-mint/12 via-ink-2 to-ink-2 p-7 sm:p-10">
          <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-mint/20 blur-[100px]" />
          <div className="relative grid gap-8 sm:grid-cols-[auto_1fr] sm:items-center">
            <div>
              <p className="font-display text-[clamp(4.5rem,12vw,7.5rem)] leading-none font-bold tracking-tight text-gradient">{h}%</p>
              <p className="mt-2 font-mono text-[11px] tracking-[0.25em] text-muted uppercase">Of every fee to holders</p>
              <Link href="/app" className="mt-6 inline-flex rounded-full bg-mint px-6 py-3 text-sm font-semibold text-ink transition hover:bg-mint-2">
                Launch App
              </Link>
            </div>
            <ul className="space-y-4 text-sm leading-relaxed text-soft">
              <li><span className="font-semibold text-white">Paid in STRIKE</span>: real yield in a real DeFi token, not more of our own.</li>
              <li><span className="font-semibold text-white">Run by {site.token.launchpad.name}</span>: the holder pot never touches a team wallet.</li>
              <li><span className="font-semibold text-white">Burns from profit only</span>: copy-trade gains buy back and burn ${site.ticker}.</li>
              <li><span className="font-semibold text-white">Everything public</span>: live numbers, wallets and burn transactions in the app.</li>
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
