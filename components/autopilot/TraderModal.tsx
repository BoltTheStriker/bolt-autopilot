"use client";

// The trader window: a trader Bolt follows, opened from their address. A name of your own, Bolt's ranking numbers,
// their 30-day profit, what they hold now and their recent trades (public trading data), and your copy of them.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { autopilot, type TraderCard } from "@/lib/autopilotApi";
import { nameKey, setTraderName, useTraderNames } from "@/lib/traderNames";
import { short, signed, usd } from "./steps";

const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;
const compact = (v: number) => `$${v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })}`;
const ago = (at: number, now: number) => {
  const m = Math.max(1, Math.round((now - at) / 60_000));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
/** A steady colour per trader, for the avatar. */
const hue = (lead: string) => [...lead].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function TraderModal({
  lead,
  copy,
  onClose,
  onSwap,
}: {
  lead: string | null;
  copy?: { amount: number; pnl: number } | null; // the user's copy of this trader, if any
  onClose: () => void;
  onSwap?: (lead: string) => void;
}) {
  const [card, setCard] = useState<{ lead: string; data: TraderCard | null; error: string }>({ lead: "", data: null, error: "" });
  const names = useTraderNames();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [allTrades, setAllTrades] = useState(false);

  useEffect(() => {
    if (!lead) return;
    let alive = true;
    autopilot.trader(lead).then(
      (data) => alive && setCard({ lead, data, error: "" }),
      (e: unknown) => alive && setCard({ lead, data: null, error: e instanceof Error ? e.message : "Couldn't load this trader." }),
    );
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [lead, onClose]);

  const t = card.lead === lead ? card.data : null;
  const error = card.lead === lead ? card.error : "";
  const name = lead ? names[nameKey(lead)] : undefined;
  const save = () => {
    if (lead) setTraderName(lead, draft);
    setEditing(false);
  };

  return (
    <AnimatePresence>
      {lead && (
        <motion.div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-3 backdrop-blur-sm sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Trader"
            initial={{ y: 14, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-[#111413] p-5 shadow-2xl sm:p-7"
          >
            {/* Who */}
            <div className="flex items-start gap-3.5">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl font-display text-lg font-bold text-ink" style={{ background: `linear-gradient(135deg, hsl(${hue(lead)} 80% 70%), hsl(${(hue(lead) + 60) % 360} 70% 55%))` }}>
                {(name ? name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2) || name.slice(0, 2) : lead.slice(2, 4)).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                {editing ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      save();
                    }}
                  >
                    <input
                      autoFocus
                      value={draft}
                      maxLength={32}
                      placeholder="Gold Guy, The Scalper…"
                      onChange={(e) => setDraft(e.target.value)}
                      className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-1.5 font-display text-lg outline-none focus:border-mint/50"
                    />
                    <button className="rounded-full bg-mint px-4 text-sm font-semibold text-ink">Save</button>
                  </form>
                ) : (
                  <button onClick={() => (setDraft(name ?? ""), setEditing(true))} className="group flex items-center gap-2 text-left" title="Give this trader a name">
                    <span className="font-display text-xl font-semibold">{name ?? (lead.length > 14 ? short(lead) : lead)}</span>
                    <span className="text-xs text-muted group-hover:text-mint">{name ? "✎" : "Name this trader ✎"}</span>
                  </button>
                )}
                <p className="mt-0.5 font-mono text-xs text-muted">
                  {name ? `${lead.length > 14 ? short(lead) : lead} · ` : ""}
                  {t?.rank ? `#${t.rank} of ${t.ranked} in Bolt's ranking` : t ? "Not in Bolt's ranking right now" : ""}
                </p>
              </div>
              <button onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full text-soft hover:bg-white/10">
                ✕
              </button>
            </div>

            {error && <p className="mt-6 rounded-2xl bg-neg/10 px-4 py-3 text-sm text-neg">{error}</p>}
            {!t && !error && <div className="mt-6 h-72 animate-pulse rounded-2xl bg-white/[0.04]" />}

            {t && (
              <>
                {/* Numbers */}
                <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Num label="30-day return" value={t.stats ? pct(t.stats.roi30d) : "—"} tone={t.stats ? t.stats.roi30d : 0} sub={t.pnl.month !== null ? `${signed(t.pnl.month)} in 30 days` : undefined} />
                  <Num label="7-day return" value={t.stats ? pct(t.stats.roi7d) : "—"} tone={t.stats ? t.stats.roi7d : 0} sub={t.pnl.week !== null ? `${signed(t.pnl.week)} this week` : undefined} />
                  <Num label="Worst drop (30d)" value={t.stats ? `−${(t.stats.dd * 100).toFixed(1)}%` : "—"} sub="smaller is calmer" />
                  <Num label="Wins (14 days)" value={t.closes14d.count ? `${t.closes14d.wins} of ${t.closes14d.count}` : "—"} sub="closed trades in profit" />
                </div>
                {/* How well a copy can follow them: it only copies new trades, in Strike's markets. */}
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                  {t.trades[0] && <Chip good={t.at - t.trades[0].at < 6 * 3_600_000}>Last trade {ago(t.trades[0].at, t.at)}</Chip>}
                  {t.stats?.activeHours24h !== null && t.stats?.activeHours24h !== undefined && <Chip good={t.stats.activeHours24h >= 4}>Traded in {t.stats.activeHours24h} of the last 24 hours</Chip>}
                  {t.stats?.strikeShare !== null && t.stats?.strikeShare !== undefined && <Chip good={t.stats.strikeShare >= 0.8}>{Math.round(t.stats.strikeShare * 100)}% of their trading is in Strike&apos;s markets</Chip>}
                </div>
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  {t.accountUsd !== null && <span>Account {compact(t.accountUsd)}</span>}
                  {t.volume30d !== null && <span>Traded {compact(t.volume30d)} in 30 days</span>}
                  {t.stats && <span>{t.stats.realWorldShare >= 0.6 ? "Mostly stocks, indices & gold" : t.stats.realWorldShare <= 0.2 ? "Mostly crypto" : "Crypto and real-world markets"}</span>}
                  {t.stats && <span>Bolt score {t.stats.score.toFixed(2)}</span>}
                </p>

                {/* 30-day profit */}
                {t.curve.length > 1 && <ProfitCurve curve={t.curve} />}

                {/* Your copy */}
                {copy && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-mint/25 bg-mint/[0.05] px-4 py-3 text-sm">
                    <span className="text-soft">
                      Your copy: <span className="font-mono text-white">{usd(copy.amount)}</span>, <span className={`font-mono ${copy.pnl >= 0 ? "text-mint" : "text-neg"}`}>{signed(copy.pnl)}</span> so far
                    </span>
                    {onSwap && (
                      <button onClick={() => (onSwap(lead), onClose())} className="ml-auto rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold hover:bg-white/15">
                        Switch trader
                      </button>
                    )}
                  </div>
                )}

                {/* Holding now */}
                <h3 className="mt-6 font-display font-semibold">Open right now</h3>
                {copy && t.positions.length > 0 && <p className="mt-1 text-xs text-muted">Your copy follows the trades they open after it started, so trades already open when it began aren&apos;t copied.</p>}
                {t.positions.length ? (
                  <ul className="mt-2 divide-y divide-white/5 rounded-2xl bg-white/[0.03] px-3">
                    {t.positions.map((p) => (
                      <li key={p.market + p.long} className="flex items-center gap-3 py-2.5 text-sm">
                        <span className="w-20 font-mono">{p.market}</span>
                        <Side long={p.long} />
                        <span className="font-mono text-xs text-muted">{compact(p.valueUsd)}</span>
                        {!p.onStrike && <span className="text-[10px] text-white/35">not on Strike: copies skip it</span>}
                        <span className={`ml-auto font-mono ${p.pnl >= 0 ? "text-mint" : "text-neg"}`}>{signed(p.pnl)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 rounded-2xl bg-white/[0.03] px-4 py-3 text-sm text-muted">No open trades right now. A copy joins their next one.</p>
                )}

                {/* Recent trades */}
                <h3 className="mt-6 font-display font-semibold">Recent trades</h3>
                {t.trades.length ? (
                  <>
                    <ul className="mt-2 divide-y divide-white/5 rounded-2xl bg-white/[0.03] px-3">
                      {(allTrades ? t.trades : t.trades.slice(0, 8)).map((x, i) => (
                        <li key={i} className="flex items-center gap-3 py-2 text-sm">
                          <span className="w-14 font-mono text-[11px] text-white/40">{ago(x.at, t.at)}</span>
                          <span className="w-20 font-mono">{x.market}</span>
                          <span className="text-xs text-soft">{x.dir}</span>
                          <span className="font-mono text-xs text-muted">{compact(x.sizeUsd)}</span>
                          <span className={`ml-auto font-mono ${x.pnl > 0 ? "text-mint" : x.pnl < 0 ? "text-neg" : "text-white/30"}`}>{x.pnl ? signed(x.pnl) : "opened"}</span>
                        </li>
                      ))}
                    </ul>
                    {t.trades.length > 8 && (
                      <button onClick={() => setAllTrades((a) => !a)} className="mt-2 text-xs font-semibold text-mint hover:underline">
                        {allTrades ? "Show fewer" : `Show all ${t.trades.length}`}
                      </button>
                    )}
                  </>
                ) : (
                  <p className="mt-2 rounded-2xl bg-white/[0.03] px-4 py-3 text-sm text-muted">No trades in the last two weeks.</p>
                )}

                <p className="mt-6 text-[11px] leading-relaxed text-white/40">
                  Public trading data from the trader&apos;s own account, refreshed every minute; the ranking is Bolt&apos;s. Past results don&apos;t promise future ones, and a copy can differ (it follows new trades only,
                  sized to your money, inside your limits).
                </p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Num({ label, value, tone, sub }: { label: string; value: string; tone?: number; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`mt-0.5 font-mono text-lg ${tone === undefined ? "text-white" : tone >= 0 ? "text-mint" : "text-neg"}`}>{value}</p>
      {sub && <p className="text-[10px] text-white/40">{sub}</p>}
    </div>
  );
}

function Chip({ good, children }: { good: boolean; children: React.ReactNode }) {
  return <span className={`rounded-full border px-2.5 py-1 ${good ? "border-mint/30 bg-mint/[0.07] text-mint" : "border-gold/30 bg-gold/[0.07] text-gold"}`}>{children}</span>;
}

function Side({ long }: { long: boolean }) {
  return <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${long ? "bg-mint/12 text-mint" : "bg-neg/12 text-neg"}`}>{long ? "Long" : "Short"}</span>;
}

/** Their profit in dollars over 30 days. */
function ProfitCurve({ curve }: { curve: [number, number][] }) {
  const vals = curve.map(([, v]) => v);
  const lo = Math.min(...vals, 0);
  const hi = Math.max(...vals, 0);
  const span = hi - lo || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${38 - ((v - lo) / span) * 34}`).join(" ");
  const up = vals[vals.length - 1] >= 0;
  const zero = 38 - ((0 - lo) / span) * 34;
  return (
    <div className="mt-4 rounded-2xl bg-white/[0.03] p-4">
      <div className="flex justify-between text-[11px] text-muted">
        <span>Profit, last 30 days</span>
        <span className={`font-mono ${up ? "text-mint" : "text-neg"}`}>{signed(vals[vals.length - 1])}</span>
      </div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-2 h-28 w-full" role="img" aria-label="Their profit over the last 30 days">
        <line x1="0" x2="100" y1={zero} y2={zero} stroke="rgba(255,255,255,0.12)" strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />
        <polyline points={pts} fill="none" stroke={up ? "#4efab0" : "#f43f5e"} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
