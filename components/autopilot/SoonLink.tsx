"use client";

// A launch button that, while Autopilot is a teaser, keeps its look but says "Opening soon" and points to
// Bolt's X instead of the app.
import Link from "next/link";
import type { ReactNode } from "react";
import { useAutopilotAccess } from "@/lib/autopilotAccess";
import { site } from "@/lib/config";

export function SoonLink({ href, className = "", children, soon = "Opening soon", tip = "above" }: { href: string; className?: string; children: ReactNode; soon?: string; tip?: "above" | "below" }) {
  const { locked } = useAutopilotAccess();
  if (!locked)
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  return (
    <span className="group relative inline-flex">
      <a href={site.socials.x} target="_blank" rel="noreferrer" aria-label={`${soon}: follow @bolthestriker for the launch`} className={`${className} cursor-pointer`}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 018 0v4" />
        </svg>
        {soon}
      </a>
      <span className={`pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 rounded-xl ${tip === "below" ? "top-full mt-2" : "bottom-full mb-2"} border border-white/10 bg-[#111413] px-3 py-2 text-xs whitespace-nowrap text-soft opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-within:opacity-100`}>
        Opening soon · follow <span className="text-mint">@bolthestriker</span> for the launch
      </span>
    </span>
  );
}
