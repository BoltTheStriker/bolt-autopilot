import type { Metadata } from "next";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { FadeUp } from "@/components/motion";
import { MemeGrid } from "@/components/MemeGrid";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: "Memes",
  description: `Bolt The Striker memes and art. Download, post, spread the $${site.ticker} word.`,
};

// Every image dropped into public/memes shows up here, newest number first.
// Name files like 10-something.png; the number sets the order.
function memes() {
  return readdirSync(join(process.cwd(), "public/memes"))
    .filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((f) => ({ src: `/memes/${f}`, name: f.replace(/^\d+-/, "").replace(/\.\w+$/, "").replace(/-/g, " ") }));
}

export default function MemesPage() {
  const list = memes();
  return (
    <main className="relative mx-auto max-w-6xl px-4 pt-32 sm:px-6 sm:pt-40">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 overflow-hidden">
        <div className="absolute top-0 left-1/2 h-96 w-[900px] -translate-x-1/2 rounded-full bg-mint/10 blur-[140px]" />
      </div>
      <FadeUp className="text-center">
        <p className="font-mono text-xs tracking-[0.3em] text-mint uppercase">${site.ticker} · Meme vault</p>
        <h1 className="mt-4 font-display text-5xl font-bold tracking-tight sm:text-7xl">
          <span className="font-light italic">Bolt</span> <span className="text-gradient">memes</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted">Grab one, post it, tag us. {list.length} and counting.</p>
      </FadeUp>
      <MemeGrid memes={list} />
    </main>
  );
}
