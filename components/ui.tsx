"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { formatters, type FormatKey } from "@/lib/format";
import { InView } from "./motion";

/** Rises and sharpens into place once it scrolls into view. `delay` is in ms (kept for existing callers). */
export function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <InView className={className} delay={delay / 1000}>
      {children}
    </InView>
  );
}

/** Counts up to `value` the first time it's visible. */
export function CountUp({ value, format }: { value: number; format: FormatKey }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / 1400);
        setShown(value * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      setShown(0);
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return <span ref={ref}>{formatters[format](shown)}</span>;
}

export function CopyButton({ text, label, className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {}
      }}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-soft transition hover:bg-white/10 hover:text-white ${className}`}
      aria-label={`Copy ${label ?? text}`}
    >
      {done ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8.5l3 3 7-7" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="5" y="5" width="8.5" height="8.5" rx="2" /><path d="M10.5 5V3.5A1.5 1.5 0 009 2H3.5A1.5 1.5 0 002 3.5V9a1.5 1.5 0 001.5 1.5H5" /></svg>
      )}
      {done ? "Copied" : label ?? "Copy"}
    </button>
  );
}

export function StrikeIcon({ size = 20, className = "" }: { size?: number; className?: string }) {
  return <Image src="/strike-token.png" alt="STRIKE" width={size} height={size} className={`rounded-full ${className}`} />;
}

export function MascotIcon({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-mascot ${className}`} style={{ width: size, height: size }}>
      <Image src="/mascot-512.png" alt="" width={size * 2} height={size * 2} className="mt-[30%] scale-[1.9]" />
    </span>
  );
}

export function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Reveal className="mx-auto max-w-3xl text-center">
      <span className="inline-flex items-center gap-2 rounded-full border border-mint/25 bg-mint/8 px-3 py-1 font-mono text-xs tracking-wider text-mint uppercase">
        <span className="size-1.5 rounded-full bg-mint" />
        {eyebrow}
      </span>
      <h2 className="mt-5 font-display text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-5xl">{title}</h2>
      {children && <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-pretty text-muted">{children}</p>}
    </Reveal>
  );
}

export function Flame({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#f8931a" aria-hidden>
      <path d="M12 2s5 4.5 5 10a5 5 0 01-10 0c0-2 1-3.5 1-3.5s.5 2 2 2.5C10 8 12 2 12 2zm0 20a7 7 0 01-7-7c0-1.4.4-2.7 1-3.8A6.97 6.97 0 0012 22z" />
    </svg>
  );
}

export function TrendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="#4efab0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 14l4.5-4.5 3 3L17 6" /><path d="M12.5 6H17v4.5" />
    </svg>
  );
}
