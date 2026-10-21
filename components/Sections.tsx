import Image from "next/image";
import Link from "next/link";
import { site } from "@/lib/config";
import { Faq } from "./Faq";
import { Reveal, SectionHeading } from "./ui";

/* ---------- the 50/50 split flow ---------- */

function Step({ n, title, body, tone }: { n: number; title: string; body: string; tone: "mint" | "fire" }) {
  return (
    <div className="card relative rounded-2xl p-5">
      <span
        className={`absolute -top-3 left-5 grid size-6 place-items-center rounded-full font-mono text-xs font-medium text-ink ${
          tone === "mint" ? "bg-mint" : "bg-gold"
        }`}
      >
        {n}
      </span>
      <h4 className="font-display text-lg font-semibold">{title}</h4>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function Pipe({ tone }: { tone: "mint" | "fire" }) {
  return (
    <svg className="mx-auto block h-8 w-3" viewBox="0 0 12 32" aria-hidden>
      <line x1="6" y1="0" x2="6" y2="32" stroke={tone === "mint" ? "#4efab0" : "#f8931a"} strokeWidth="2" strokeDasharray="4 8" className="animate-dash" />
    </svg>
  );
}

export function Split() {
  return (
    <section id="split" className="relative mx-auto max-w-6xl scroll-mt-28 px-4 pt-28 sm:px-6">
      <SectionHeading eyebrow="The split" title={<>Every fee works twice.</>}>
        Every ${site.ticker} trade on Solada pays a fee, and it gets split down the middle. Solada pays one half to holders in STRIKE
        automatically. The other half goes to the team wallet, which trades it on Strike and burns the profits.
      </SectionHeading>

      <Reveal className="mt-14">
        <div className="card mx-auto flex max-w-md items-center gap-4 rounded-2xl p-5">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/6">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"><path d="M7 7h13l-3-3M17 17H4l3 3" /></svg>
          </span>
          <div>
            <p className="font-display text-lg font-semibold">Every buy and sell</p>
            <p className="text-sm text-muted">Trading fees on {site.token.launchpad.name}&apos;s bonding curve</p>
          </div>
        </div>

        {/* fork */}
        <svg viewBox="0 0 600 90" className="mx-auto hidden h-[90px] w-full max-w-[600px] md:block" aria-hidden>
          <path d="M300 0 V30 Q300 45 285 45 H165 Q150 45 150 60 V90" fill="none" stroke="#4efab0" strokeWidth="2" strokeDasharray="4 8" className="animate-dash" />
          <path d="M300 0 V30 Q300 45 315 45 H435 Q450 45 450 60 V90" fill="none" stroke="#f8931a" strokeWidth="2" strokeDasharray="4 8" className="animate-dash" />
        </svg>
        <div className="md:hidden"><Pipe tone="mint" /></div>

        <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-2 md:gap-10">
          {/* holders branch */}
          <div>
            <div className="mb-4 flex items-end justify-between rounded-2xl border border-mint/30 bg-mint/8 px-5 py-4">
              <div>
                <p className="font-mono text-xs tracking-wider text-mint uppercase">Holders</p>
                <p className="font-display text-2xl font-bold">STRIKE rewards</p>
              </div>
              <span className="font-display text-5xl leading-none font-bold text-mint">{site.split.holders}%</span>
            </div>
            <Step n={1} tone="mint" title="Solada fills the holder pot" body={`${site.split.holders}% of every trading fee goes into the holder pot, which is handled by Solada itself. The team can't touch it.`} />
            <Pipe tone="mint" />
            <Step n={2} tone="mint" title={`${site.distributionEvery} payout in STRIKE`} body={`Solada snapshots holders and pays the pot out in STRIKE, weighted by how much you hold and for how long.`} />
            <Pipe tone="mint" />
            <Step n={3} tone="mint" title="Stack it or stake it" body="Claim on Solada, then keep the STRIKE or stake it on Strike Finance to earn a share of the protocol's own trading revenue on top." />
          </div>

          {/* copy-trade branch */}
          <div>
            <div className="mb-4 flex items-end justify-between rounded-2xl border border-gold/30 bg-gold/8 px-5 py-4">
              <div>
                <p className="font-mono text-xs tracking-wider text-gold uppercase">Burn engine</p>
                <p className="font-display text-2xl font-bold">Strike copy-trade</p>
              </div>
              <span className="font-display text-5xl leading-none font-bold text-gold">{site.split.copyTrade}%</span>
            </div>
            <Step n={1} tone="fire" title="Fund the vault" body={`The creator half is claimed from Solada and deposited into Strike copy-trading, following the top traders the copy-trade bot picks. The wallet and the position are public.`} />
            <Pipe tone="fire" />
            <Step n={2} tone="fire" title="Harvest the profits" body="Gains are taken on a fixed schedule. Principal stays in to keep compounding, and losing weeks are reported the same as winning ones." />
            <Pipe tone="fire" />
            <Step n={3} tone="fire" title="Buy back and burn" body={`Profits market-buy $${site.ticker} off the chart and send it to burn. Supply only goes down, so every holder's share goes up.`} />
          </div>
        </div>

        <div className="mx-auto mt-10 flex max-w-4xl flex-col items-center gap-3 rounded-2xl border border-dashed border-white/12 px-6 py-5 text-center sm:flex-row sm:text-left">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4efab0" strokeWidth="1.8" strokeLinecap="round" className="shrink-0"><path d="M20 12a8 8 0 11-2.3-5.6M20 4v4h-4" /></svg>
          <p className="text-sm leading-relaxed text-soft">
            <span className="font-semibold text-white">The flywheel:</span> burns shrink supply, holders get a bigger slice of every STRIKE
            payout, and more holders bring more volume. More volume means more fees for both sides.
          </p>
        </div>
      </Reveal>
    </section>
  );
}

/* ---------- roadmap ---------- */

export function Roadmap() {
  const phases = [
    { tag: "Phase 01", title: "Launch", items: [`Fair launch on ${site.token.launchpad.name}`, "Team and copy-trade wallets published", "App live from the first trade"], done: false },
    { tag: "Phase 02", title: "First payouts", items: ["First daily STRIKE payouts to holders", "Copy-trade funded on Strike", "Bot results reviewed before going live"], done: false },
    { tag: "Phase 03", title: "Burn season", items: ["First buyback & burn from profits", "Holder rewards checker with history", "Strike community collabs"], done: false },
    { tag: "Phase 04", title: "Flex mode", items: ["Holders vote on the copy-trade strategy", `${site.name} merch & meme kit`, "Automated on-chain distributor"], done: false },
  ];
  return (
    <section id="roadmap" className="relative mx-auto max-w-6xl scroll-mt-28 px-4 pt-32 sm:px-6">
      <SectionHeading eyebrow="Roadmap" title={`Where ${site.name} is headed.`} />
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {phases.map((p, i) => (
          <Reveal key={p.tag} delay={i * 80} className="card group relative overflow-hidden rounded-3xl p-6 transition hover:-translate-y-1 hover:border-mint/30">
            <p className="font-mono text-xs tracking-wider text-mint">{p.tag}</p>
            <h3 className="mt-2 font-display text-2xl font-bold">{p.title}</h3>
            <ul className="mt-4 space-y-2.5 text-sm text-muted">
              {p.items.map((it) => (
                <li key={it} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-mint/60" />{it}</li>
              ))}
            </ul>
            <span className="absolute -right-3 -bottom-6 font-display text-8xl font-bold text-white/[0.03] transition group-hover:text-mint/[0.06]">{i + 1}</span>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------- FAQ + final CTA ---------- */

export function FaqSection() {
  const items = [
    { q: `Who is ${site.fullName}?`, a: `${site.fullName} is the face of $${site.ticker}: a lightning-fast striker who never leaves the trading desk. He holds, copy-trades on Strike and burns the profits, so his holders get paid in STRIKE.` },
    { q: "How do I get STRIKE rewards?", a: `Hold $${site.ticker} in your Cardano wallet. Solada tracks every holder and shares the holder pot ${site.distributionEvery.toLowerCase()}, paid in STRIKE and weighted by how much you hold and for how long. Check what you're earning in the app, and claim on Solada.` },
    { q: "Who runs the holder rewards?", a: `Solada does. ${site.split.holders}% of fees goes into the holder pot at the launchpad level, so the team never holds that money. The other ${site.split.copyTrade}% is the creator share, which funds the copy-trade and burns.` },
    { q: "What is Strike copy-trade?", a: `Strike Finance is an on-chain perpetuals exchange on Cardano. Its copy-trade feature lets a wallet mirror a chosen strategy. The project's ${site.split.copyTrade}% goes into one strategy, and the profits pay for $${site.ticker} buybacks that are burned.` },
    { q: "Who picks the traders to copy?", a: "A bot is being tested to do it. Every 4 hours it ranks Strike's copyable traders by return, drawdown, consistency and how much of their trading can be copied at our size, then rotates out anyone who hits a stop-loss or goes quiet. It is running on paper money first, publicly in the app, and only goes live if its results hold up." },
    { q: "What if the copy-trade loses money?", a: "It can, because trading carries risk. Losing weeks are published in the app like winning ones, burns only happen out of realised profit, and the holder half of fees is never touched by the vault." },
    { q: "Can I check everything myself?", a: "Yes. The app reads the holder pot, holders and creator fees live from Solada, the team wallet balance live from Cardano, and links every burn to its transaction." },
    { q: "Is this an official Strike Finance token?", a: `No. $${site.ticker} is an independent community token. ${site.disclaimer}` },
  ];
  return (
    <section id="faq" className="relative mx-auto max-w-3xl scroll-mt-28 px-4 pt-32 sm:px-6">
      <SectionHeading eyebrow="FAQ" title="Questions, answered." />
      <Reveal className="mt-12"><Faq items={items} /></Reveal>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="relative mx-auto max-w-6xl px-4 pt-32 sm:px-6">
      <Reveal className="relative overflow-hidden rounded-[2rem] bg-mascot px-6 pt-12 text-ink sm:px-12 sm:pt-16 lg:pt-0">
        <div className="bg-grid absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(0,0,0,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.06)_1px,transparent_1px)]" />
        <div className="relative grid items-center gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="lg:py-16">
            <h2 className="font-display text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.95] font-bold tracking-tight">Join the flex.</h2>
            <p className="mt-4 max-w-md text-lg text-ink/75">Hold ${site.ticker}, collect STRIKE every day, and watch the burn engine shrink the supply.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/app" className="rounded-full bg-ink px-7 py-3.5 font-semibold text-white transition hover:-translate-y-0.5">
                Launch App →
              </Link>
              <a href={site.token.launchpad.url} target="_blank" rel="noreferrer" className="rounded-full border-2 border-ink px-7 py-3 font-semibold transition hover:bg-ink hover:text-white">
                Buy ${site.ticker}
              </a>
              <a href={site.socials.x} target="_blank" rel="noreferrer" className="rounded-full border-2 border-ink px-7 py-3 font-semibold transition hover:bg-ink hover:text-white">
                Follow on X
              </a>
            </div>
          </div>
          <div className="mx-auto mb-8 w-[85%] max-w-[420px] rotate-2 overflow-hidden rounded-3xl border-4 border-ink shadow-[12px_12px_0_#0a0a0a] transition hover:rotate-0 lg:my-12">
            <Image src="/mascot-coin.webp" alt={`${site.fullName} holding a STRIKE coin`} width={1200} height={1200} sizes="(min-width: 1024px) 420px, 85vw" className="w-full" />
          </div>
        </div>
      </Reveal>
    </section>
  );
}
