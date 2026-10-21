// Strike Finance's own logo (public/strike/, from strikefinance.org), behind `site.strikeBrand`.
/* eslint-disable @next/next/no-img-element */
import { site } from "@/lib/config";

/** The round Strike mark; text "Strike" when the logo is switched off. */
export function StrikeMark({ size = 18, className = "" }: { size?: number; className?: string }) {
  if (!site.strikeBrand) return null;
  return <img src="/strike/icon.png" alt="" width={size} height={size} className={`inline-block rounded-full ${className}`} />;
}

/** The full Strike Finance wordmark (white). */
export function StrikeWordmark({ height = 22, className = "" }: { height?: number; className?: string }) {
  if (!site.strikeBrand)
    return (
      <span className={`font-display font-bold ${className}`}>
        Strike <span className="text-muted">Finance</span>
      </span>
    );
  return <img src="/strike/logo-white.svg" alt="Strike Finance" style={{ height }} className={`w-auto ${className}`} />;
}

/** Where the money goes, in one line: your wallet ⇄ your own Strike account. Bolt is never in the path. */
export function MoneyPath({ direction = "in", address, className = "" }: { direction?: "in" | "out"; address?: string; className?: string }) {
  const wallet = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1">
      <span className="size-1.5 rounded-full bg-mint" />
      {address ? `Your wallet ${address.slice(0, 7)}…${address.slice(-4)}` : "Your wallet"}
    </span>
  );
  const strike = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1">
      <StrikeMark size={14} />
      Your Strike account
    </span>
  );
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-2.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-soft">
        {direction === "in" ? wallet : strike}
        <span className="text-mint">→</span>
        {direction === "in" ? strike : wallet}
      </div>
      <p className="mt-1.5 text-[11px] text-white/45">
        {direction === "in" ? "Straight to your own account on Strike. Bolt never holds your money." : "Only to your own wallet, and only with its signature. Nobody else can withdraw."}
      </p>
    </div>
  );
}
