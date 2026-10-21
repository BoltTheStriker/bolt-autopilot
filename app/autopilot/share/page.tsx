import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { site } from "@/lib/config";

// Landing page for a shared Bolt Autopilot result (autopilot.boltstriker.io/share). Its preview image is the
// result card, so the card shows under the link on X. ?d=… is a demo result, ?id=… a real account's.

type Search = Promise<{ d?: string; id?: string }>;

function cardQuery(s: { d?: string; id?: string }): string | null {
  if (s.id && /^[0-9a-f]{12}$/.test(s.id)) return `id=${s.id}`;
  if (s.d && /^[A-Za-z0-9_-]{1,2000}$/.test(s.d)) return `d=${s.d}`;
  return null;
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const q = cardQuery(await searchParams);
  const real = q?.startsWith("id=");
  const title = real ? "My Bolt Autopilot on Strike" : "My Bolt Autopilot demo";
  const description = "Bolt Autopilot copies the best traders on Strike Finance for you, inside limits you choose, on your own Strike account.";
  const images = q ? [{ url: `/api/autopilot-card?${q}`, width: 1200, height: 630 }] : [];
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, images },
    twitter: { card: "summary_large_image", site: "@" + site.socials.x.replace("https://x.com/", ""), title, description, images: images.map((i) => i.url) },
  };
}

async function Card({ searchParams }: { searchParams: Search }) {
  const q = cardQuery(await searchParams);
  if (!q) return <p className="rounded-3xl border border-white/10 p-8 text-muted">This result link isn&apos;t complete. Ask for a fresh one, or try the demo yourself.</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/autopilot-card?${q}`} alt="Bolt Autopilot result card" width={1200} height={630} className="w-full rounded-3xl border border-white/10" />;
}

export default function SharePage({ searchParams }: { searchParams: Search }) {
  return (
    <main className="mx-auto max-w-4xl px-4 pt-28 pb-16 sm:px-6 sm:pt-32">
      <p className="font-mono text-xs tracking-wider text-mint uppercase">Bolt Autopilot · built on Strike</p>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">Copy trading on Strike, on autopilot.</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Say your goal and Bolt copies the best traders on Strike Finance for you, inside hard limits you choose, on your own Strike account. Try it with $1,000 of demo money, no wallet needed.
      </p>
      <div className="mt-8">
        <Suspense fallback={<div className="aspect-[1200/630] w-full animate-pulse rounded-3xl bg-white/5" />}>
          <Card searchParams={searchParams} />
        </Suspense>
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/autopilot/app?demo=1" className="rounded-full bg-mint px-6 py-3 font-semibold text-ink">Try the demo</Link>
        <Link href="/autopilot" className="glass rounded-full px-6 py-3 font-semibold">How it works</Link>
      </div>
      <p className="mt-6 text-xs text-white/35">
        Demo results use pretend money. Past results don&apos;t promise future ones, and copy trading can lose money. Bolt is a community project built on Strike; it is not made or endorsed by Strike Finance.
      </p>
    </main>
  );
}
