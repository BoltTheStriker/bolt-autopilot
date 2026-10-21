"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { useAutopilotOpen } from "@/lib/autopilotApi";
import { site } from "@/lib/config";
import { useAdminKey, useVerifiedAdmin } from "@/lib/adminPreview";
import { useBotState } from "@/lib/useBotState";

const tabs = [
  { href: "/app", label: `$${site.ticker}`, sub: "Market, rewards & burns" },
  { href: "/app/bot", label: "Copy-trade bot", sub: "Live picks & results" },
];
// Shown once the holder demo is switched on (or to an admin previewing it).
const tryTab = { href: "/app/try", label: "Try the bot", sub: "Holders · demo" };
// Shown once Autopilot opens (or to an admin previewing it).
const autoTab = { href: "/autopilot", label: "Autopilot", sub: "Real money · beta" };

/** Switch between the token side and the bot side of the app. */
export function AppTabs() {
  const path = usePathname();
  const router = useRouter();
  const demoOn = useBotState()?.demo?.enabled ?? false;
  const admin = useAdminKey();
  const autoOpen = useAutopilotOpen();
  const verifiedAdmin = useVerifiedAdmin();
  // While a feature is off, only an admin sees its tab (to preview it).
  const visible = [
    ...tabs,
    ...(demoOn || admin || path === tryTab.href ? [tryTab] : []),
    ...(autoOpen || verifiedAdmin ? [autoTab] : []),
  ];

  // On phones the tabs scroll sideways: bring the active one into view. Only the tab bar moves
  // (scrollIntoView would also scroll the page back up to it).
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav.current && el) nav.current.scrollLeft = el.offsetLeft - (nav.current.clientWidth - el.clientWidth) / 2;
  }, [path, visible.length]);

  // Old links pointed at /app#bot; send them to the bot tab.
  useEffect(() => {
    if (path === "/app" && window.location.hash === "#bot") router.replace("/app/bot");
  }, [path, router]);

  return (
    <nav ref={nav} aria-label="App sections" className="glass inline-flex max-w-full overflow-x-auto rounded-full p-1 [scrollbar-width:none]">
      {visible.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`relative shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition sm:px-6 sm:py-2.5 ${active ? "text-ink" : "text-soft hover:text-white"}`}
          >
            {active && (
              <motion.span layoutId="app-tab" className="absolute inset-0 rounded-full bg-mint" transition={{ type: "spring", stiffness: 400, damping: 34 }} />
            )}
            <span className="relative">{t.label}</span>
            <span className={`relative hidden text-[11px] font-normal sm:ml-2 sm:inline ${active ? "text-ink/60" : "text-white/40"}`}>{t.sub}</span>
          </Link>
        );
      })}
    </nav>
  );
}
