// Bolt Autopilot result cards: what a shared card shows, for the demo (carried in the link, since the
// demo runs in the browser) and for real accounts (read from the Bolt server by share id, so it can't be faked).
import type { Goal, Markets, Risk } from "@/worker/autopilot";

export type ShareCard = {
  kind: "demo" | "real";
  ret: number; // return as a fraction (0.034 = +3.4%): demo on its $1,000; real since the account started (basis "all") or on its running copies
  pnl: number | null; // demo only: dollars on pretend money (real cards never show amounts)
  traders: number;
  since: number; // ms
  risk: Risk;
  goal: Goal;
  markets: Markets;
  curve: number[]; // demo: account value since the start, downsampled; real: []
  basis?: "all" | "copies"; // real cards: what `ret` measures
};

const RISKS: Risk[] = ["low", "medium", "high"];
const GOALS: Goal[] = ["steady", "balanced", "growth"];
const MARKETS: Markets[] = ["all", "crypto", "realworld"];
const CURVE_POINTS = 40;

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

/** Up to 40 evenly spaced points (first and last kept), rounded to cents. */
export function downsample(values: number[], n = CURVE_POINTS): number[] {
  if (values.length <= n) return values.map((v) => Math.round(v * 100) / 100);
  return Array.from({ length: n }, (_, i) => Math.round(values[Math.round((i * (values.length - 1)) / (n - 1))] * 100) / 100);
}

/** The demo card, packed into a link-safe string. */
export function encodeDemoCard(c: Omit<ShareCard, "kind">): string {
  return b64url(JSON.stringify({ r: Math.round(c.ret * 1e5) / 1e5, p: c.pnl === null ? null : Math.round(c.pnl * 100) / 100, t: c.traders, s: c.since, k: c.risk, g: c.goal, m: c.markets, c: downsample(c.curve) }));
}

/** A demo card from a link, or null if anything is off (bad links show nothing rather than nonsense). */
export function decodeDemoCard(d: string): ShareCard | null {
  try {
    if (d.length > 2000) return null;
    const j = JSON.parse(unb64url(d));
    const ret = Number(j.r);
    const pnl = j.p === null ? null : Number(j.p);
    const traders = Number(j.t);
    const since = Number(j.s);
    const curve: unknown = j.c;
    if (!Number.isFinite(ret) || ret < -1 || ret > 10) return null;
    if (pnl !== null && (!Number.isFinite(pnl) || Math.abs(pnl) > 10_000)) return null;
    if (!Number.isInteger(traders) || traders < 0 || traders > 10) return null;
    if (!Number.isFinite(since) || since < Date.UTC(2026, 0, 1) || since > Date.now() + 86_400_000) return null;
    if (!RISKS.includes(j.k) || !GOALS.includes(j.g) || !MARKETS.includes(j.m)) return null;
    if (!Array.isArray(curve) || curve.length > CURVE_POINTS || !curve.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 100_000)) return null;
    return { kind: "demo", ret, pnl, traders, since, risk: j.k, goal: j.g, markets: j.m, curve: curve as number[] };
  } catch {
    return null;
  }
}

/** A real account's card as the Bolt server returns it, checked the same way. */
export function parseRealCard(j: unknown): ShareCard | null {
  const o = j as Record<string, unknown> | null;
  if (!o) return null;
  const ret = Number(o.ret);
  const traders = Number(o.traders);
  const since = Number(o.since);
  if (!Number.isFinite(ret) || !Number.isInteger(traders) || !Number.isFinite(since)) return null;
  if (!RISKS.includes(o.risk as Risk) || !GOALS.includes(o.goal as Goal) || !MARKETS.includes(o.markets as Markets)) return null;
  return { kind: "real", ret, pnl: null, traders, since, risk: o.risk as Risk, goal: o.goal as Goal, markets: o.markets as Markets, curve: [], basis: o.basis === "all" ? "all" : "copies" };
}

export const RISK_LABEL: Record<Risk, string> = { low: "Low risk", medium: "Medium risk", high: "High risk" };
export const GOAL_LABEL: Record<Goal, string> = { steady: "Steady", balanced: "Balanced", growth: "Growth" };
export const MARKETS_LABEL: Record<Markets, string> = { all: "All markets", crypto: "Crypto", realworld: "Real-world markets" };

/** Bolt's mood on the card: a meme picture and caption by result (no gloating, no despair). */
export function cardMood(ret: number): { img: string; caption: string } {
  if (ret >= 0.05) return { img: "04-strike", caption: "Strike mode: on." };
  if (ret >= 0.01) return { img: "03-strike-coin", caption: "Stacking gains." };
  if (ret >= 0) return { img: "09-copy-trade-desk", caption: "Copying the best. Easy." };
  if (ret > -0.01) return { img: "02-trading-desk", caption: "Just a scratch. Coffee first." };
  if (ret > -0.05) return { img: "07-rooftop", caption: "Stop-loss on. Holding the line." };
  return { img: "06-gym", caption: "Red day. Back to the gym." };
}
