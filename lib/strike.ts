// Public Strike Finance data for the team's copy-trade account. No API key: Strike's
// API wallets can trade (they just can't withdraw), so a key never lives on the server.
// Accounts are keyed by the Cardano address that connected to Strike; copy subscriptions
// run in sub-accounts, which the stats leaderboard rolls up under that same address.
import "server-only";
import { fetchT } from "./fetchT";
import { cacheLife } from "next/cache";

const API = "https://api.strikefinance.org";

const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetchT(`${API}${path}`, { headers: { accept: "application/json" } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export type CopySubscription = {
  lead: string; // Strike account id or Hyperliquid 0x address
  leadName: string;
  platform: "strike" | "hyperliquid";
  mode: "fixed_ratio" | "fixed_amount";
  amount: number; // copy amount (fixed ratio) or margin per entry (fixed amount), USD
  status: "active" | "stopped" | "liquidated";
  realizedPnl: number;
  volume: number;
  fills: number;
  since: number; // ms
};

export type CopyTradeSnapshot = {
  /** "strike" = the team's real account; "simulation" = the bot's paper portfolio, shown until then. */
  source: "strike" | "simulation";
  found: boolean; // false until the team wallet has a Strike account
  equity: number; // USD, everything below is USD too
  deposits: number;
  withdrawals: number;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  roiPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  closedCount?: number; // simulation only: how many copies have been closed (win rate needs some)
  volume: number;
  trades: number;
  subscriptions: CopySubscription[];
};

type StatsEntry = Record<string, string | number> & { blockchain_address?: string; vault_id?: string };
type LeaderboardEntry = {
  follower?: { address?: string };
  lead_account_id: string;
  platform: "strike" | "hyperliquid";
  copy_mode: "fixed_ratio" | "fixed_amount";
  copy_amount?: string;
  margin_per_entry_order?: string;
  status: "active" | "stopped" | "liquidated";
  realized_pnl?: string;
  total_volume?: string;
  filled_order_count?: number;
  created_at: number;
};

export async function getCopyTrade(address: string): Promise<CopyTradeSnapshot> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 600, expire: 3600 }); // Strike refreshes these every ~10 min

  const [stats, leads, ...boards] = await Promise.all([
    get<{ entries?: StatsEntry[] }>("/stat/v1/stats/leaderboard"),
    get<{ lead_traders?: { account_id: string; nickname?: string }[] }>("/v2/copy/lead-traders"),
    ...(["active", "stopped", "liquidated"] as const).map((s) => get<{ entries?: LeaderboardEntry[] }>(`/v2/copy/leaderboard?status=${s}`)),
  ]);

  // An address can own a few accounts; vaults it manages are listed separately and aren't ours to count.
  const rows = (stats?.entries ?? []).filter((e) => e.blockchain_address === address && !e.vault_id);
  const sum = (k: string) => rows.reduce((s, e) => s + n(e[k]), 0);
  const main = rows.reduce<StatsEntry | null>((best, e) => (!best || n(e.equity) > n(best.equity) ? e : best), null);
  const names = new Map((leads?.lead_traders ?? []).map((l) => [l.account_id, l.nickname ?? ""]));

  const subscriptions = boards
    .flatMap((b) => b?.entries ?? [])
    .filter((e) => e.follower?.address === address)
    .map<CopySubscription>((e) => ({
      lead: e.lead_account_id,
      leadName: names.get(e.lead_account_id) || shortLead(e.lead_account_id),
      platform: e.platform,
      mode: e.copy_mode,
      amount: n(e.copy_mode === "fixed_ratio" ? e.copy_amount : e.margin_per_entry_order),
      status: e.status,
      realizedPnl: n(e.realized_pnl),
      volume: n(e.total_volume),
      fills: n(e.filled_order_count),
      since: e.created_at,
    }))
    .sort((a, b) => (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1) || b.since - a.since);

  const deposits = sum("deposits");
  return {
    source: "strike",
    found: rows.length > 0,
    equity: sum("equity"),
    deposits,
    withdrawals: sum("withdrawals"),
    totalPnl: sum("total_pnl"),
    realizedPnl: sum("realized_pnl"),
    unrealizedPnl: sum("unrealized_pnl"),
    roiPct: deposits ? (sum("total_pnl") / deposits) * 100 : 0,
    maxDrawdownPct: n(main?.max_drawdown_pct),
    winRatePct: n(main?.win_rate_pct),
    volume: sum("volume"),
    trades: sum("total_trades"),
    subscriptions,
  };
}

function shortLead(id: string) {
  return id.startsWith("0x") ? `${id.slice(0, 6)}…${id.slice(-4)}` : `${id.slice(0, 8)}…`;
}
