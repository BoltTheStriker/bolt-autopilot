"use client";

import { useEffect, useState } from "react";
import { site } from "@/lib/config";

// The admin page keeps its key in sessionStorage. While the holder demo is switched off,
// that key lets the admin preview it; everyone else sees nothing.
export const ADMIN_KEY_STORE = "bolt-admin-key";

export function readAdminKey(): string {
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORE) ?? "";
  } catch {
    return "";
  }
}

/** The admin key if this browser unlocked /admin (read after mount: the page is prerendered). */
export function useAdminKey(): string {
  const [key, setKey] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setKey(readAdminKey()), 0);
    return () => clearTimeout(t);
  }, []);
  return key;
}

// The stored key, confirmed by the bot server (anyone can type something into sessionStorage).
let verified: Promise<boolean> | null = null;
export function checkAdminKey(): Promise<boolean> {
  const key = readAdminKey();
  if (!key) return Promise.resolve(false);
  verified ??= fetch(`${site.botApi}/admin`, { method: "POST", headers: { "content-type": "application/json", "x-admin-key": key }, body: JSON.stringify({ action: "status" }) }).then(
    (r) => r.ok,
    () => false,
  );
  return verified;
}

/** True only once the server has accepted this browser's admin key. */
export function useVerifiedAdmin(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    checkAdminKey().then(setOk);
  }, []);
  return ok;
}
