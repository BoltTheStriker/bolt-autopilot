import { site } from "@/lib/config";

const words = ["Hold", `Earn ${site.strike.ticker}`, "Copy-trade on Strike", "Buy back", "Burn", `$${site.ticker}`];

export function Marquee() {
  const row = [...words, ...words, ...words];
  return (
    <div className="overflow-hidden py-3" aria-hidden>
      <div className="relative -mx-4 -rotate-1 border-y border-ink bg-mint py-3.5 text-ink">
        <div className="flex w-max animate-marquee">
          {[0, 1].map((k) => (
            <div key={k} className="flex shrink-0 items-center">
              {row.map((w, i) => (
                <span key={i} className="flex items-center font-display text-xl font-bold tracking-tight uppercase sm:text-2xl">
                  <span className="px-6">{w}</span>
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M11 1L3 12h6l-1 7 8-11h-6l1-7z" /></svg>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
