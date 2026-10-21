"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { EASE } from "./motion";

type Meme = { src: string; name: string };

function Download({ src, className = "" }: { src: string; className?: string }) {
  return (
    <a
      href={src}
      download
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-2 rounded-full bg-mint px-4 py-2 text-sm font-semibold text-ink transition hover:bg-mint-2 ${className}`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
      </svg>
      Download
    </a>
  );
}

export function MemeGrid({ memes }: { memes: Meme[] }) {
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : (i + 1) % memes.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : (i - 1 + memes.length) % memes.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, memes.length]);

  return (
    <>
      <div className="mt-14 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {memes.map((m, i) => (
          <motion.button
            key={m.src}
            onClick={() => setOpen(i)}
            initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
            whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            viewport={{ once: true, margin: "0px 0px -10% 0px" }}
            transition={{ duration: 0.7, delay: (i % 3) * 0.08, ease: EASE }}
            className="group relative aspect-square overflow-hidden rounded-2xl border border-white/8 text-left sm:rounded-3xl"
            aria-label={`Open ${m.name}`}
          >
            <Image src={m.src} alt={m.name} fill sizes="(min-width: 1024px) 380px, 50vw" className="object-cover transition duration-500 group-hover:scale-[1.04]" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
            <div className="absolute right-3 bottom-3 left-3 flex items-center justify-between gap-2 opacity-0 transition group-hover:opacity-100">
              <span className="truncate text-sm font-medium capitalize">{m.name}</span>
              <Download src={m.src} className="hidden sm:inline-flex" />
            </div>
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {open !== null && (
          <motion.div
            className="fixed inset-0 z-[60] grid place-items-center bg-ink/92 p-4 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
          >
            <motion.div
              key={memes[open].src}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="relative w-full max-w-[min(88vh,900px)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative aspect-square overflow-hidden rounded-3xl border border-white/10">
                <Image src={memes[open].src} alt={memes[open].name} fill sizes="900px" className="object-contain" priority />
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-white/50">{open + 1} / {memes.length}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setOpen((open - 1 + memes.length) % memes.length)} className="glass grid size-10 place-items-center rounded-full" aria-label="Previous">‹</button>
                  <button onClick={() => setOpen((open + 1) % memes.length)} className="glass grid size-10 place-items-center rounded-full" aria-label="Next">›</button>
                  <Download src={memes[open].src} />
                  <button onClick={() => setOpen(null)} className="glass grid size-10 place-items-center rounded-full" aria-label="Close">✕</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
