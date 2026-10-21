import { site } from "@/lib/config";
import { Flame, MascotIcon, Reveal, StrikeIcon } from "../ui";
import { BotPicks } from "./BotPicks";


function Card({ title, body, children, delay = 0 }: { title: string; body: string; children: React.ReactNode; delay?: number }) {
  return (
    <Reveal delay={delay} className="card group flex flex-col overflow-hidden rounded-3xl p-5 transition hover:border-mint/25">
      <div className="relative grid h-48 place-items-center overflow-hidden rounded-2xl border border-white/6 bg-gradient-to-b from-white/[0.04] to-transparent p-4">
        {children}
      </div>
      <h3 className="mt-5 font-display text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </Reveal>
  );
}

/** "Why $TICKER?": six feature cards with small product-flavoured visuals, after strikefinance.org's "Why Strike?". */
export function WhyBento() {
  return (
    <section id="why" className="relative mx-auto max-w-6xl scroll-mt-28 px-4 pt-32 sm:px-6">
      <Reveal className="text-center">
        <h2 className="font-display text-4xl font-bold tracking-tight sm:text-6xl">
          Why <span className="font-light italic">${site.ticker}</span>?
        </h2>
        <p className="mt-4 font-mono text-xs tracking-[0.3em] text-muted uppercase">Built for holders who want real yield</p>
      </Reveal>

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Paid in STRIKE" body={`${site.split.holders}% of every trading fee goes to holders, paid ${site.distributionEvery.toLowerCase()} in STRIKE by Solada. Just hold. No staking, no lockups.`}>
          <div className="w-full max-w-[260px] space-y-2">
            {["Holder pot filling", "Snapshot taken", "Paid out in STRIKE"].map((t, i) => (
              <div key={t} className="flex items-center gap-3 rounded-xl border border-white/8 bg-ink/60 px-3 py-2.5">
                <StrikeIcon size={22} />
                <span className="text-xs text-soft">{t}</span>
                <span className={`ml-auto font-mono text-[10px] ${i === 2 ? "text-mint" : "text-white/40"}`}>{i === 2 ? "claim" : "daily"}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card delay={80} title="Strike copy-trade engine" body="The other half of fees copies top traders on Strike Finance. Its numbers come straight from Strike, live.">
          <svg viewBox="0 0 240 120" className="h-full w-full max-w-[280px]" aria-hidden>
            {[18, 30, 26, 40, 36, 52, 47, 63, 58, 74, 70, 86].map((h, i) => {
              const up = i % 3 !== 2;
              const x = 14 + i * 18;
              const y = 110 - h;
              return (
                <g key={i}>
                  <line x1={x + 4} x2={x + 4} y1={y - 8} y2={y + 22} stroke={up ? "#4efab0" : "#f43f5e"} strokeOpacity="0.6" />
                  <rect x={x} y={y} width="8" height="16" rx="1.5" fill={up ? "#4efab0" : "#f43f5e"} />
                </g>
              );
            })}
            <path d="M10 100 C 70 90, 120 60, 230 18" fill="none" stroke="#4efab0" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="4 6" />
          </svg>
        </Card>

        <Card delay={160} title="Buyback & burn" body={`Copy-trade profits buy $${site.ticker} off the chart and burn it. Supply only goes down, so every holder's share of rewards goes up.`}>
          <div className="w-full max-w-[260px]">
            <div className="flex items-center justify-center gap-2">
              <Flame size={44} />
            </div>
            <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/8">
              <div className="h-full w-[38%] animate-pulse rounded-full bg-gradient-to-r from-gold to-[#ffcf6b]" />
            </div>
            <p className="mt-2 text-center font-mono text-[11px] text-white/45">supply ↓ · your share ↑</p>
          </div>
        </Card>

        <Card title="Copy-trade bot" body="A bot ranks Strike's copyable traders every 4 hours and rotates out anyone who hits a stop-loss. It runs on paper money first, in public.">
          <BotPicks />
        </Card>

        <Card delay={80} title="Fully transparent" body="Holder rewards, the team wallet, the copy-trade and every burn are public, live on the app, and each burn links to its transaction.">
          <div className="w-full max-w-[280px] rounded-xl border border-white/8 bg-ink/80 p-3 font-mono text-[11px] leading-relaxed">
            <div className="mb-2 flex gap-1.5">
              <span className="size-2 rounded-full bg-[#ff5f57]" />
              <span className="size-2 rounded-full bg-[#febc2e]" />
              <span className="size-2 rounded-full bg-[#28c840]" />
            </div>
            <p className="text-white/40">{"// open data, no login"}</p>
            <p>
              <span className="text-mint">GET</span> <span className="text-soft">/api/coin</span>
            </p>
            <p className="text-white/50">{"{ holders, pot, fees,"}</p>
            <p className="text-white/50">{"  copyTrade, teamWallet }"}</p>
          </div>
        </Card>

        <Card delay={160} title={`Fair launch on ${site.token.launchpad.name}`} body={site.tokenomicsBlurb}>
          <svg viewBox="0 0 240 120" className="h-full w-full max-w-[280px]" aria-hidden>
            <defs>
              <linearGradient id="curve-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#4efab0" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#4efab0" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M10 110 Q 120 105, 230 15 L230 110 Z" fill="url(#curve-fill)" />
            <path d="M10 110 Q 120 105, 230 15" fill="none" stroke="#4efab0" strokeWidth="2.5" />
            <circle cx="150" cy="80" r="6" fill="#4efab0" stroke="#0a0a0a" strokeWidth="3" />
            <text x="160" y="72" className="fill-white/60 font-mono text-[10px]">you are here</text>
          </svg>
        </Card>
      </div>

      <div className="mt-6 flex items-center justify-center gap-3 text-sm text-muted">
        <MascotIcon size={22} />
        Everything above is live in the app.
      </div>
    </section>
  );
}
