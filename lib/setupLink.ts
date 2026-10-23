// "Copy my setup" links: the rules a friend can start with. Only the shape of the setup travels (risk, goal, markets,
// traders, limits, boost); never a budget, dollar targets, blocked traders or anything about the account.
import { sharedRules, type AutoRules, type SharedRules } from "../worker/autopilot.ts";

export { sharedRules, type SharedRules };

const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

/** A demo's setup travels in the link itself: "d.<base64url JSON>". A real account's is a share id the server resolves. */
export const encodeDemoSetup = (r: AutoRules) => `d.${b64url(JSON.stringify(sharedRules(r)))}`;

export function decodeDemoSetup(s: string): SharedRules | null {
  if (!s.startsWith("d.")) return null;
  try {
    return JSON.parse(unb64url(s.slice(2))) as SharedRules;
  } catch {
    return null;
  }
}
