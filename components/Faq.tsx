"use client";

import { useState } from "react";

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-3">
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div key={it.q} className={`card overflow-hidden rounded-2xl transition ${isOpen ? "border-mint/25" : ""}`}>
            <button
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span className="font-display text-lg font-semibold">{it.q}</span>
              <span className={`grid size-8 shrink-0 place-items-center rounded-full bg-white/6 transition ${isOpen ? "rotate-45 bg-mint text-ink" : ""}`}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 2v10M2 7h10" /></svg>
              </span>
            </button>
            <div className={`grid transition-[grid-template-rows] duration-300 ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <div className="overflow-hidden">
                <p className="px-5 pb-5 leading-relaxed text-muted sm:px-6">{it.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
