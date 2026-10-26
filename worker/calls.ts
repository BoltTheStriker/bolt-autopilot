// Bolt Calls: the social layer on Strike. A trader posts a call (market, long or short, leverage, optional take-profit and
// stop-loss, a short thesis); its entry is Strike's mark price at that moment, so nobody can backdate or fake an entry.
// Every call is then marked live on Strike's prices and closes by itself at its take-profit or stop-loss, which gives each
// caller a track record anyone can check. "Tail" (copying a call onto your own Strike account) is separate: real orders.

export type Side = "long" | "short";
export type CallStatus = "open" | "tp" | "sl" | "closed";
export type Call = {
  id: string;
  author: string; // the caller's stake address (their Bolt account); never sent out
  name?: string; // how the feed shows the caller (their short wallet address)
  symbol: string; // a Strike market, e.g. "BTC-USD"
  side: Side;
  leverage: number;
  entry: number; // Strike's mark price when the call was posted
  tp: number | null; // take-profit price, or none
  sl: number | null; // stop-loss price, or none
  thesis: string;
  at: number;
  status: CallStatus;
  exit?: number; // the mark price it closed at
  closedAt?: number;
  tails: number; // how many people copied it onto their own account
};
export type CallStore = { calls: Call[] };

export const CALL_LIMITS = { maxLeverage: 20, maxOpenPerAuthor: 3, maxPerDay: 10, thesisChars: 280, minMovePct: 0.002, maxMovePct: 0.9 };

/** A new call, checked; its entry is the mark price now. tpPct/slPct are price moves from the entry (0.05 = 5%). */
export function newCall(
  store: CallStore,
  input: { symbol?: unknown; side?: unknown; leverage?: unknown; tpPct?: unknown; slPct?: unknown; thesis?: unknown },
  author: string,
  marks: Record<string, number>,
  now: number,
): Call | { error: string } {
  const symbol = String(input.symbol ?? "").toUpperCase();
  const entry = marks[symbol];
  if (!entry || !(entry > 0)) return { error: "Pick one of Strike's markets." };
  const side = input.side === "short" ? "short" : input.side === "long" ? "long" : null;
  if (!side) return { error: "Choose long or short." };
  const leverage = Math.round(Number(input.leverage ?? 1));
  if (!(leverage >= 1 && leverage <= CALL_LIMITS.maxLeverage)) return { error: `Leverage goes from 1x to ${CALL_LIMITS.maxLeverage}x.` };
  const move = (v: unknown, what: string): number | null | { error: string } => {
    if (v === null || v === undefined || v === "") return null;
    const x = Number(v);
    if (!(x >= CALL_LIMITS.minMovePct && x <= CALL_LIMITS.maxMovePct)) return { error: `The ${what} must be a move between ${CALL_LIMITS.minMovePct * 100}% and ${CALL_LIMITS.maxMovePct * 100}%.` };
    return x;
  };
  const tpPct = move(input.tpPct, "take-profit");
  if (tpPct && typeof tpPct === "object") return tpPct;
  const slPct = move(input.slPct, "stop-loss");
  if (slPct && typeof slPct === "object") return slPct;
  // A stop-loss at or past the liquidation distance would never fire before the position is gone.
  if (typeof slPct === "number" && slPct >= 1 / leverage) return { error: `At ${leverage}x a stop-loss must be under a ${Math.floor(100 / leverage)}% move, or the position is liquidated first.` };
  const thesis = String(input.thesis ?? "").replace(/\s+/g, " ").trim().slice(0, CALL_LIMITS.thesisChars);
  if (thesis.length < 10) return { error: "Say why in a sentence: that's what people tail." };
  const mine = store.calls.filter((c) => c.author === author);
  if (mine.filter((c) => c.status === "open").length >= CALL_LIMITS.maxOpenPerAuthor) return { error: `You have ${CALL_LIMITS.maxOpenPerAuthor} open calls. Close one first.` };
  if (mine.filter((c) => now - c.at < 86_400_000).length >= CALL_LIMITS.maxPerDay) return { error: "That's today's limit of calls. Back tomorrow." };
  const dir = side === "long" ? 1 : -1;
  return {
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    author,
    symbol,
    side,
    leverage,
    entry,
    tp: typeof tpPct === "number" ? round(entry * (1 + dir * tpPct)) : null,
    sl: typeof slPct === "number" ? round(entry * (1 - dir * slPct)) : null,
    thesis,
    at: now,
    status: "open",
    tails: 0,
  };
}

/** The call's return on margin at this price (or at its exit once closed): the price move times leverage. */
export function callReturn(c: Call, mark: number | undefined): number | null {
  const px = c.status === "open" ? mark : c.exit;
  if (!px) return null;
  return (c.side === "long" ? px / c.entry - 1 : 1 - px / c.entry) * c.leverage;
}

/** Closes an open call that crossed its take-profit or stop-loss (checked on mark prices). True when it closed. */
export function settle(c: Call, mark: number | undefined, now: number): boolean {
  if (c.status !== "open" || !mark) return false;
  const long = c.side === "long";
  const hitTp = c.tp !== null && (long ? mark >= c.tp : mark <= c.tp);
  const hitSl = c.sl !== null && (long ? mark <= c.sl : mark >= c.sl);
  if (!hitTp && !hitSl) return false;
  // Settled at its own level, not the later mark: a check every few seconds can land past it either way.
  c.status = hitSl ? "sl" : "tp";
  c.exit = hitSl ? c.sl! : c.tp!;
  c.closedAt = now;
  return true;
}

/** The author closes a call by hand, at the mark price now. */
export function closeCall(c: Call, mark: number | undefined, now: number): boolean {
  if (c.status !== "open" || !mark) return false;
  c.status = "closed";
  c.exit = mark;
  c.closedAt = now;
  return true;
}

/** A caller's track record over their closed calls (open ones don't count until they close). */
export function authorStats(calls: Call[], author: string) {
  const closed = calls.filter((c) => c.author === author && c.status !== "open");
  const rets = closed.map((c) => callReturn(c, undefined) ?? 0);
  const wins = rets.filter((r) => r > 0).length;
  return {
    calls: calls.filter((c) => c.author === author).length,
    closed: closed.length,
    wins,
    winRate: closed.length ? wins / closed.length : null,
    avgReturn: closed.length ? rets.reduce((t, r) => t + r, 0) / closed.length : null,
  };
}

/** Callers ranked by their closed calls: needs a few closed calls before ranking, so one lucky call doesn't top it. */
export function leaders(calls: Call[], minClosed = 3) {
  const authors = [...new Set(calls.map((c) => c.author))];
  return authors
    .map((a) => ({ author: a, ...authorStats(calls, a) }))
    .filter((s) => s.closed >= minClosed)
    .sort((x, y) => (y.avgReturn ?? 0) - (x.avgReturn ?? 0));
}

const round = (x: number) => Number(x.toPrecision(8));
