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
