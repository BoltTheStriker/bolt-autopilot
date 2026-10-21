import Image from "next/image";
import Link from "next/link";
import { site } from "@/lib/config";

export function Footer() {
  return (
    <footer className="relative mt-24 border-t border-white/8 bg-ink-2">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <Image src="/mascot-512.png" alt="" width={44} height={44} className="rounded-xl bg-mascot" />
            <span className="font-display text-2xl font-bold">${site.ticker}</span>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">{site.description}</p>
        </div>
        <div>
          <h4 className="font-display text-sm font-semibold tracking-wider text-white/60 uppercase">Platform</h4>
          <ul className="mt-4 space-y-2.5 text-sm text-soft">
            <li><Link href="/app" className="hover:text-mint">Launch App</Link></li>
            <li><Link href="/memes" className="hover:text-mint">Memes</Link></li>
            <li><Link href="/app#rewards" className="hover:text-mint">Check my rewards</Link></li>
            <li><a href={site.token.launchpad.url} target="_blank" rel="noreferrer" className="hover:text-mint">Buy on {site.token.launchpad.name}</a></li>
          </ul>
        </div>
        <div>
          <h4 className="font-display text-sm font-semibold tracking-wider text-white/60 uppercase">Follow</h4>
          <ul className="mt-4 space-y-2.5 text-sm text-soft">
            <li><a href={site.socials.x} target="_blank" rel="noreferrer" className="hover:text-mint">X (@bolthestriker)</a></li>
            <li><a href={site.token.launchpad.url} target="_blank" rel="noreferrer" className="hover:text-mint">{site.token.launchpad.name}</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/8">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-white/40 sm:px-6">
          © ${site.ticker}. {site.disclaimer}
        </p>
      </div>
      {/* Big outlined wordmark, after strikefinance.org's footer */}
      <div className="overflow-hidden" aria-hidden>
        <p className="wordmark-outline -mb-[0.22em] text-center font-display text-[clamp(5rem,22vw,18rem)] leading-none font-bold tracking-tighter italic select-none">
          ${site.ticker}
        </p>
      </div>
    </footer>
  );
}
