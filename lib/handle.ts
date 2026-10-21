// ADA Handle ($name) → the Cardano address it points to, via the public Handle API.
import "server-only";
import { fetchT } from "./fetchT";

export const HANDLE = /^\$?[a-z0-9_.-]{1,15}$/i;

/** The addr1… address a handle resolves to, or null if it doesn't exist. */
export async function resolveHandle(input: string): Promise<string | null> {
  const name = input.replace(/^\$/, "").toLowerCase();
  if (!HANDLE.test(name)) return null;
  try {
    const res = await fetchT(`https://api.handle.me/handles/${encodeURIComponent(name)}`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as { resolved_addresses?: { ada?: string } };
    const addr = j.resolved_addresses?.ada ?? "";
    return /^addr1[0-9a-z]{50,120}$/.test(addr) ? addr : null;
  } catch {
    return null;
  }
}
