// The copy-trade bot's paper portfolio (from the worker, see lib/botState.ts), shaped like a real Strike
// account. The site shows it until the team wallet has a live Strike account, so visitors
// see real traders and real results rather than placeholders, labelled as a simulation.
import type { BotState } from "@/bot/strategy";
import type { StrikeMark } from "./ledger";
import type { CopyTradeSnapshot } from "./strike";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function simulatedCopyTrade(s: BotState | null): CopyTradeSnapshot | null {
  if (!s) return null;
  const open = s.positions.reduce((t, p) => t + p.value, 0);
  const equity = s.cash + open;
  const realized = s.closed.reduce((t, c) => t + c.pnlUsd, 0);
  const wins = s.closed.filter((c) => c.pnlUsd > 0).length;

  let peak = -Infinity;
  let maxDd = 0;
  for (const e of s.equity) {
    peak = Math.max(peak, e.value);
    maxDd = Math.max(maxDd, peak > 0 ? 1 - e.value / peak : 0);
  }

  return {
    source: "simulation",
    found: true,
    equity,
    deposits: s.startingCapital,
    withdrawals: 0,
    totalPnl: equity - s.startingCapital,
    realizedPnl: realized,
    unrealizedPnl: s.positions.reduce((t, p) => t + p.value - p.cost, 0),
    roiPct: (equity / s.startingCapital - 1) * 100,
    maxDrawdownPct: maxDd * 100,
    winRatePct: s.closed.length ? (wins / s.closed.length) * 100 : 0,
    closedCount: s.closed.length,
    volume: 0,
    trades: 0,
    subscriptions: [
      ...s.positions.map((p) => ({
        lead: p.lead,
        leadName: short(p.lead),
        platform: "hyperliquid" as const,
        mode: "fixed_ratio" as const,
        amount: p.cost,
        status: "active" as const,
        realizedPnl: p.value - p.cost,
        volume: p.cost, // ranks the headline lead by size; no simulated volume exists
        fills: 1,
        since: p.openedAt,
      })),
      ...[...s.closed].reverse().map((c) => ({
        lead: c.lead,
        leadName: short(c.lead),
        platform: "hyperliquid" as const,
        mode: "fixed_ratio" as const,
        amount: c.cost,
        status: "stopped" as const,
        realizedPnl: c.pnlUsd,
        volume: 0,
        fills: 1,
        since: c.openedAt,
      })),
    ],
  };
}

/** The bot's equity over time, as chart marks (net deposited = the paper capital). */
export function simulatedHistory(s: BotState | null): StrikeMark[] {
  if (!s) return [];
  return s.equity.map((e) => ({
    date: new Date(e.at).toISOString(),
    equity: Math.round(e.value * 100) / 100,
    netDeposited: s.startingCapital,
    pnl: e.value - s.startingCapital,
  }));
}
