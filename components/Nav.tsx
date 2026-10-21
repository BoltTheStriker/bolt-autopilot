"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { EASE } from "./motion";
import { site } from "@/lib/config";
import { useVerifiedAdmin } from "@/lib/adminPreview";
import { SoonLink } from "./autopilot/SoonLink";
import { useAutopilotOpen } from "@/lib/autopilotApi";
import { useOnAutopilotHost } from "@/lib/autopilotHost";

// Homepage: marketing sections + Launch App (like strikefinance.org).
const homeLinks = [
  { href: "/#split", label: "How it works" },
  { href: "/#why", label: "Why $" + site.ticker },
  { href: "/#tokenomics", label: "Tokenomics" },
  { href: "/#faq", label: "FAQ" },
  { href: "/memes", label: "Memes" },
  { href: "/contest", label: "Bot Cup" },
];

// App: jump between platform sections (like app.strikefinance.org's top bar).
const appLinks = [
  { href: "/app", label: "Overview" },
  { href: "/app#rewards", label: "Rewards" },
  { href: "/app#burn-engine", label: "Burn engine" },
  { href: "/app/bot", label: "Copy-trade bot" },
  { href: "/contest", label: "Bot Cup" },
];

// Autopilot's own page: jump between its sections.
const autoLinks = [
  { href: "/autopilot#strike", label: "Built on Strike" },
  { href: "/autopilot#how", label: "How it works" },
  { href: "/autopilot#rules", label: "Rules" },
  { href: "/autopilot#earn", label: "Earn" },
  { href: "/autopilot#safety", label: "Safety" },
  { href: "/autopilot#copilot", label: "Copilot" },
  { href: "/autopilot#faq", label: "FAQ" },
  { href: "/autopilot/impact", label: "Impact" },
];
const autoLink = { href: "/autopilot", label: "Autopilot" };
// Inside the Autopilot app: back to the story.
const autoAppLinks = [
  { href: "/autopilot", label: "About Autopilot" },
  { href: "/autopilot/impact", label: "Impact on Strike" },
  { href: "/autopilot#safety", label: "Safety" },
  { href: "/autopilot#faq", label: "FAQ" },
];

export function Nav() {
  const path = usePathname();
  // On autopilot.boltstriker.io the paths are "/" and "/app" (rewritten to /autopilot and /autopilot/app).
  const onAutoHost = useOnAutopilotHost();
  const inAuto = onAutoHost || path.startsWith("/autopilot");
  const inApp = !inAuto && path.startsWith("/app");
  // Autopilot's link shows once it opens (or to an admin previewing it).
  const autoOpen = useAutopilotOpen();
  const admin = useVerifiedAdmin();
  const full = autoOpen || admin; // can go into the app and the impact page
  const showAuto = full || site.autopilotTeaser; // the landing page is public in teaser mode
  const inAutoApp = path.startsWith("/autopilot/app") || (onAutoHost && path.startsWith("/app"));
  const inside = (l: { href: string }) => full || !l.href.startsWith("/autopilot/impact"); // the impact page stays private in teaser mode
  const links = inAuto && showAuto ? (inAutoApp ? autoAppLinks : autoLinks).filter(inside) : [...(inApp ? appLinks : homeLinks), ...(showAuto ? [autoLink] : [])];
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      className="fixed inset-x-0 top-0 z-50 px-4 pt-4"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: EASE }}
    >
      <nav
        className={`glass mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-full py-2 pr-2 pl-2.5 transition-all duration-300 ${
          scrolled ? "bg-ink/95" : ""
        }`}
      >
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <span className="relative grid size-9 place-items-center overflow-hidden rounded-full bg-mascot ring-1 ring-white/20">
            <Image src="/mascot-512.png" alt="" width={56} height={56} className="mt-3 scale-[1.9]" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">${site.ticker}</span>
          {(inApp || inAuto) && (
            <span className="hidden rounded-full bg-mint/12 px-2 py-0.5 font-mono text-[10px] tracking-wider text-mint uppercase sm:inline">{inAuto ? "Autopilot · on Strike" : "App"}</span>
          )}
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="rounded-full px-3.5 py-2 text-sm text-soft transition hover:bg-white/8 hover:text-white">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          {inAutoApp ? null : inAuto ? (
            <SoonLink href="/autopilot/app" tip="below" className="inline-flex items-center gap-1.5 rounded-full bg-mint px-4 py-2 text-sm font-semibold text-ink transition hover:bg-mint-2 sm:px-5">
              Launch app
            </SoonLink>
          ) : inApp ? (
            <a
              href={site.token.launchpad.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-mint px-4 py-2 text-sm font-semibold text-ink transition hover:bg-mint-2 sm:px-5"
            >
              Buy ${site.ticker}
            </a>
          ) : (
            <>
              <a
                href={site.token.launchpad.url}
                target="_blank"
                rel="noreferrer"
                className="hidden rounded-full px-4 py-2 text-sm text-soft transition hover:text-white sm:block"
              >
                Buy
              </a>
              <Link
                href="/app"
                className="group inline-flex items-center gap-1.5 rounded-full bg-mint px-4 py-2 text-sm font-semibold text-ink transition hover:bg-mint-2 sm:px-5"
              >
                Launch App
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="transition group-hover:translate-x-0.5">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </Link>
            </>
          )}
          <button
            className="grid size-10 place-items-center rounded-full text-soft hover:bg-white/8 lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              {open ? <path d="M4 4l10 10M14 4L4 14" /> : <path d="M2 5h14M2 9h14M2 13h14" />}
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div className="mx-auto mt-2 max-w-6xl rounded-3xl border border-white/10 bg-[#141414] p-2 shadow-[0_20px_60px_rgba(0,0,0,0.7)] lg:hidden">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-2xl px-4 py-3 text-soft hover:bg-white/8 hover:text-white"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href={inApp ? "/" : site.token.launchpad.url}
            onClick={() => setOpen(false)}
            className="block rounded-2xl px-4 py-3 text-soft hover:bg-white/8 hover:text-white"
          >
            {inApp ? "← Back to homepage" : `Buy $${site.ticker} on ${site.token.launchpad.name}`}
          </Link>
        </div>
      )}
    </motion.header>
  );
}
