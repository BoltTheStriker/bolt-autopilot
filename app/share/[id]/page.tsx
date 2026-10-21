import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { site } from "@/lib/config";

// Landing page for a shared demo result. Its preview image is the PnL card, so the
// card shows up under the link on X.

export async function generateMetadata({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }): Promise<Metadata> {
  const { id } = await params;
  // Carry the share's version onto the image URL: X caches images by URL, so each share gets a fresh card.
  const v = (await searchParams).v;
  const image = `/api/share-card/${id}${v && /^\d{1,12}$/.test(v) ? `?v=${v}` : ""}`;
  const title = `My $${site.ticker} copy-trade bot demo`;
  const description = `A $${site.ticker} holder is testing Bolt's copy-trade bot on Strike with demo money. Hold $${site.ticker} to try it.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", site: "@" + site.socials.x.replace("https://x.com/", ""), title, description, images: [image] },
  };
}

async function Card({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection(); // the card is live data
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/share-card/${id}`} alt="Demo result card" width={1200} height={630} className="w-full rounded-3xl border border-white/10" />
  );
}

export default function SharePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto max-w-4xl px-4 pt-28 pb-16 sm:px-6 sm:pt-32">
      <p className="font-mono text-xs tracking-wider text-mint uppercase">Coming soon for ${site.ticker} holders</p>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">Copy-trade on Strike, the easy way.</h1>
      <p className="mt-3 max-w-2xl text-muted">
        This is a ${site.ticker} holder&apos;s demo of Bolt&apos;s copy-trade bot. Hold {(1_000_000).toLocaleString("en-US")}+ ${site.ticker} to try it with $10,000 of demo money.
      </p>
      <div className="mt-8">
        <Suspense fallback={<div className="aspect-[1200/630] w-full animate-pulse rounded-3xl bg-white/5" />}>
          <Card params={params} />
        </Suspense>
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/app/try" className="rounded-full bg-mint px-6 py-3 font-semibold text-ink">Try the bot</Link>
        <a href={site.token.launchpad.url} target="_blank" rel="noreferrer" className="glass rounded-full px-6 py-3 font-semibold">Buy ${site.ticker}</a>
      </div>
      <p className="mt-6 text-xs text-white/35">Demo only: no real money. Results follow Bolt&apos;s bot and aren&apos;t guaranteed. Not financial advice.</p>
    </main>
  );
}
