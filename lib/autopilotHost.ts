"use client";

import { useSyncExternalStore } from "react";

export const AUTOPILOT_HOST = "autopilot.boltstriker.io";
export const MAIN_SITE = "https://www.boltstriker.io";

/** True on autopilot.boltstriker.io (false while rendering on the server, then the real value). */
export function useOnAutopilotHost(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => window.location.hostname === AUTOPILOT_HOST,
    () => false,
  );
}

/** An /autopilot… link as it reads on this host: on autopilot.boltstriker.io "/autopilot#how" is "/#how" and
 *  "/autopilot/app" is "/app" (no redirect hop, which would drop the #section). Unchanged on the main site. */
export function autopilotHref(href: string, onHost: boolean): string {
  if (!onHost || !/^\/autopilot(?=$|[#/?])/.test(href)) return href;
  const rest = href.slice("/autopilot".length);
  return rest === "" ? "/" : rest.startsWith("/") ? rest : `/${rest}`;
}

export function useAutopilotHref(): (href: string) => string {
  const onHost = useOnAutopilotHost();
  return (href) => autopilotHref(href, onHost);
}

/** A click on a #section of the page you're on: scroll there smoothly (true), instead of a navigation that may not scroll. */
export function scrollToSection(href: string): boolean {
  const u = new URL(href, window.location.href);
  if (u.pathname !== window.location.pathname || u.origin !== window.location.origin) return false;
  if (!u.hash) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    history.replaceState(null, "", u.pathname + u.search);
    return true;
  }
  const el = document.getElementById(decodeURIComponent(u.hash.slice(1)));
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", u.hash);
  return true;
}
