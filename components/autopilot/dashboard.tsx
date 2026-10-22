"use client";

// Autopilot after setup: overview, traders, Earn (Strike's SLP vault and RealFi sUSDrf via Borrow & Earn), activity.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { AutoCopy, AutoMe, AutoMode, SlpInfo } from "@/lib/autopilotApi";
import { RealFiFlow, type RealFiActions } from "./RealFi";
import { I, short, signed, Stat, time, usd } from "./steps";

export type Tab = "overview" | "traders" | "earn" | "activity";
export const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "traders", label: "Traders" },
  { id: "earn", label: "Earn" },
  { id: "activity", label: "Activity" },
];

/** What the dashboard shows, for a real account or the demo. */
export type BotView = {
  demo: boolean;
  mode: AutoMode;
  address?: string;
  accountId?: string;
  balance: number | null;
  copies: (AutoCopy & { stopped?: boolean; roi7d?: number })[];
  log: { at: number; text: string }[];
  rulesText: string | null;
  reserve: number; // money not in copies
  parked?: number; // left in ended copies' sub-accounts
  earn: { value: number; pnl: number } | null; // the user's SLP position
  curve?: number[]; // demo: account value since the start
  startedAt?: number; // demo: when it started
  halted?: boolean;
  idle?: string | null; // real: the bot is on but copies nothing yet, and why (null: still looking)
  /** Autopilot mode: its latest action, the rules it runs with when they differ from the user's, its last check. */
  autopilot?: { reason: string | null; rulesText: string | null; at: number | null; checkedAt: number | null };
  syncedAt?: number | null; // real: when the server last read the copies from Strike
};

const STRIKE_VAULTS = "https://app.strikefinance.org/vaults";

export function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <nav className="glass inline-flex max-w-full overflow-x-auto rounded-full p-1 [scrollbar-width:none]" data-tour="tabs">
      {TABS.map((t) => (
        <button key={t.id} onClick={() => onTab(t.id)} className={`relative shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition sm:px-5 ${tab === t.id ? "text-ink" : "text-soft hover:text-white"}`}>
          {tab === t.id && <motion.span layoutId="auto-tab" className="absolute inset-0 rounded-full bg-mint" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
          <span className="relative">
            {t.label}
            {t.id === "earn" && <span className={`ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[9px] ${tab === t.id ? "bg-ink/15" : "bg-mint/15 text-mint"}`}>RealFi</span>}
          </span>
        </button>
      ))}
    </nav>
  );
}

export function StatusCard({
  v,
  busy,
  onMode,
  onEdit,
  onLeave,
  onRestart,
  onWithdraw,
  onDeposit,
  onShare,
}: {
  v: BotView;
  busy: boolean;
  onMode: (m: AutoMode) => void;
  onEdit: () => void;
  onLeave: () => void;
  onRestart?: () => void;
  onWithdraw?: () => void;
  onDeposit?: () => void;
  onShare?: () => void;
}) {
  // The demo's profit is its balance against the $1,000 start (no rounding drift between the two).
  const profit = v.demo && v.balance !== null ? v.balance - 1_000 : v.copies.reduce((t, c) => t + c.pnl, 0);
  const working = v.copies.reduce((t, c) => t + c.amount, 0);
  // The same profit as a share: of the $1,000 in the demo, of the money in the copies for a real account.
  const profitPct = v.demo ? profit / 1_000 : working > 0 ? profit / working : null;
  const title = v.mode === "off" ? "Bot is off" : v.halted ? "Paused for today (daily limit)" : v.demo ? "Demo bot is running" : v.copies.length === 0 && !v.idle ? "Your bot is starting" : v.mode === "autopilot" ? "Autopilot is running" : "Your bot is running";
  return (
    <section className="card relative overflow-hidden rounded-3xl p-6 sm:p-7" data-tour="overview">
      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-mint/15 blur-[100px]" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-muted">
            {v.demo ? (
              `Demo · $1,000 pretend money · started ${v.startedAt ? time(v.startedAt) : ""}`
            ) : (
              <>
                {short(v.address ?? "")} ·{" "}
                <a href="https://app.strikefinance.org/portfolio" target="_blank" rel="noreferrer" className="text-soft underline-offset-2 hover:text-mint hover:underline">
                  Your Strike account ↗
                </a>
              </>
            )}
          </p>
          <h2 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold">
            <span className={`size-2.5 rounded-full ${v.mode === "off" ? "bg-white/30" : v.halted ? "bg-gold" : "animate-pulse bg-mint"}`} />
            {title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onDeposit && (
            <button onClick={onDeposit} className="rounded-full border border-mint/20 bg-mint/15 px-4 py-2 text-sm text-mint transition hover:border-mint/45 hover:bg-mint/25 active:scale-[0.97]">
              Deposit
            </button>
          )}
          {onWithdraw && (
            <button onClick={onWithdraw} className="glass rounded-full px-4 py-2 text-sm">
              Withdraw
            </button>
          )}
          <button onClick={onEdit} className="glass rounded-full px-4 py-2 text-sm">Edit rules</button>
          {v.demo ? (
            <MoreMenu
              items={[
                ...(onRestart ? [{ label: "Restart from $1,000", onClick: () => confirm("Restart the demo from $1,000 with fresh picks?") && onRestart(), disabled: busy }] : []),
                { label: "Leave demo", onClick: onLeave },
              ]}
            />
          ) : v.mode === "off" ? (
            <button
              disabled={busy}
              onClick={() => onMode("on")}
              className="rounded-full bg-mint px-5 py-2 text-sm font-semibold text-ink transition hover:bg-mint-2 hover:shadow-[0_6px_24px_rgba(78,250,176,0.35)] active:scale-[0.97] disabled:opacity-50"
            >
              {busy ? <Spinning label="Starting…" /> : "Start"}
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => confirm("Stop the bot? Its copies are closed at market.") && onMode("off")}
              className="rounded-full bg-neg/90 px-5 py-2 text-sm font-semibold text-white transition hover:bg-neg hover:shadow-[0_6px_24px_rgba(244,63,94,0.35)] active:scale-[0.97] disabled:opacity-50"
            >
              {busy ? <Spinning label="Stopping…" /> : "Stop the bot"}
            </button>
          )}
        </div>
      </div>
      <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={v.demo ? "Demo balance" : "Total on Strike"} value={v.balance === null ? "—" : usd(v.balance)} />
        <Stat label="Working in copies" value={usd(working)} />
        <div className={`group relative rounded-xl border border-mint/25 bg-mint/[0.06] px-3 py-2.5 transition ${onShare ? "hover:border-mint/50 hover:bg-mint/[0.1]" : ""}`}>
          <p className="pr-8 text-[11px] text-muted">{v.demo ? "Profit since start" : "Profit on copies"}</p>
          <p className={`mt-0.5 font-mono text-lg ${profit >= 0 ? "text-mint" : "text-neg"}`}>
            {signed(profit)}
            {profitPct !== null && <span className="ml-1.5 text-sm opacity-80">{`${profitPct >= 0 ? "+" : "−"}${Math.abs(profitPct * 100).toFixed(2)}%`}</span>}
          </p>
          {onShare && (
            <button
              onClick={onShare}
              aria-label="Share your result"
              title="Share your result"
              className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-mint/15 text-mint transition group-hover:bg-mint group-hover:text-ink hover:shadow-[0_4px_18px_rgba(78,250,176,0.4)] active:scale-[0.94]"
            >
              {SHARE_ICON}
            </button>
          )}
        </div>
        <Stat label={v.earn ? "In Earn (SLP)" : "Reserve"} value={usd(v.earn ? v.earn.value : v.reserve)} />
      </div>
      {v.mode !== "off" && (
        <div className="relative mt-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full bg-white/[0.05] p-1 text-xs">
            {(
              [
                ["on", "Follow my rules"],
                ["autopilot", "Autopilot"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                disabled={busy || v.mode === m}
                onClick={() => onMode(m)}
                className={`rounded-full px-3 py-1.5 font-semibold transition ${v.mode === m ? "bg-mint text-ink" : "text-soft hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-muted">{v.mode === "autopilot" ? "Bolt's AI looks after your setup, never beyond your limits." : "The bot runs exactly your rules."}</span>
        </div>
      )}
      {v.mode === "autopilot" && v.autopilot && (
        <div className="relative mt-3 flex gap-3 rounded-2xl border border-mint/25 bg-mint/[0.05] px-4 py-3.5">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-mint text-ink [&>svg]:size-3.5">{I.spark}</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-white">{v.autopilot.reason ? "Autopilot's latest change" : "Autopilot is watching"}</p>
            <p className="mt-0.5 text-sm text-soft">
              {v.autopilot.reason ?? "It checks your copies and adjusts inside your limits when something calls for it: a trader leaving the ranking, a copy near its stop-loss, losses near your daily limit."}
            </p>
            {v.autopilot.rulesText && <p className="mt-1.5 text-xs text-muted">Running with: {v.autopilot.rulesText[0].toUpperCase() + v.autopilot.rulesText.slice(1)}.</p>}
            {(v.autopilot.at || v.autopilot.checkedAt) && (
              <p className="mt-1 font-mono text-[10px] text-white/35">{v.autopilot.at ? `Changed ${time(v.autopilot.at)}` : ""}{v.autopilot.at && v.autopilot.checkedAt ? " · " : ""}{v.autopilot.checkedAt ? `Checked ${time(v.autopilot.checkedAt)}` : ""}</p>
            )}
          </div>
        </div>
      )}
      {!v.demo && v.mode !== "off" && v.copies.length === 0 && (
        <div className={`relative mt-4 flex flex-wrap items-start gap-3 rounded-2xl border px-4 py-3.5 ${v.idle ? "border-gold/30 bg-gold/[0.06]" : "border-mint/25 bg-mint/[0.05]"}`}>
          {v.idle ? (
            <>
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-gold/20 text-xs font-bold text-gold">!</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-white">Not copying yet</p>
                <p className="mt-0.5 text-sm text-soft">{v.idle}</p>
              </div>
              <button onClick={onEdit} className="glass shrink-0 rounded-full px-4 py-1.5 text-sm">
                Edit rules
              </button>
            </>
          ) : (
            <>
              <span className="mt-0.5 size-6 shrink-0 animate-spin rounded-full border-2 border-mint/25 border-t-mint" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-white">Finding traders for you…</p>
                <p className="mt-0.5 text-sm text-soft">Your bot is matching Strike&apos;s top traders to your rules and starting the copies. This usually takes a minute or two; this page updates by itself.</p>
              </div>
            </>
          )}
        </div>
      )}
      {v.curve && v.curve.length > 1 ? (
        <Curve values={v.curve} from={v.startedAt ? `${v.demo ? "Started" : "Since"} ${time(v.startedAt)}` : "Start"} />
      ) : !v.demo && v.mode !== "off" && v.copies.length ? (
        <p className="relative mt-5 rounded-xl bg-white/[0.03] px-3 py-3 text-xs text-muted">The profit chart fills in from here, with each update from Strike.</p>
      ) : v.demo ? (
        <p className="relative mt-5 rounded-xl bg-white/[0.03] px-3 py-3 text-xs text-muted">Live from now: the chart fills in as your traders trade (updates about every minute).</p>
      ) : null}
      {(v.parked ?? 0) >= 0.01 && (
        <p className="relative mt-4 rounded-xl bg-white/[0.04] px-3 py-2.5 text-xs text-soft">
          {usd(v.parked!)} sits in a copy sub-account from the bot&apos;s first version: {v.mode === "off" ? "start the bot to reuse it, or move it to your main account in Strike's app to withdraw it." : "your next copy reuses it."}
        </p>
      )}
      {!v.demo && v.syncedAt ? <p className="relative mt-3 font-mono text-[10px] text-white/35">Updated from Strike at {time(v.syncedAt)} · refreshes by itself</p> : null}
      {v.rulesText && (
        <p className="relative mt-4 text-xs text-muted">
          {v.mode === "autopilot" && v.autopilot?.rulesText ? "Your limits: " : ""}
          {v.rulesText[0].toUpperCase() + v.rulesText.slice(1)}.
        </p>
      )}
    </section>
  );
}

function Spinning({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="size-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
      {label}
    </span>
  );
}

const SHARE_ICON = (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13" />
  </svg>
);

/** A "⋯" button with a small menu: the demo's less-used actions. */
function MoreMenu({ items }: { items: { label: string; onClick: () => void; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="More" aria-expanded={open} className="glass grid size-9 place-items-center rounded-full text-soft">
        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#141816] p-1 shadow-2xl"
          >
            {items.map((it) => (
              <button
                key={it.label}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
                className="block w-full rounded-xl px-3 py-2.5 text-left text-sm text-soft transition hover:bg-white/[0.07] hover:text-white disabled:opacity-50"
              >
                {it.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Curve({ values, from }: { values: number[]; from: string }) {
  // At least ±0.5% of the starting value, so a few cents don't look like a rally.
  const pad = Math.abs(values[0]) * 0.005;
  const min = Math.min(...values, values[0] - pad);
  const max = Math.max(...values, values[0] + pad);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${36 - ((v - min) / span) * 32}`);
  const up = values.at(-1)! >= values[0];
  const color = up ? "#4efab0" : "#f43f5e";
  return (
    <div className="relative mt-5">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-28 w-full">
        <defs>
          <linearGradient id="demo-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.3" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`M0,40 L${pts.join(" L")} L100,40 Z`} fill="url(#demo-fill)" />
        {/* A plain fade-in: a drawn-in path (pathLength) breaks into dashes with non-scaling strokes. */}
        <motion.polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-white/35">
        <span>{from}</span>
        <span>now</span>
      </div>
    </div>
  );
}

/** Where the money is: copy trading, Earn, free reserve. */
export function Allocation({ v, apr }: { v: BotView; apr: number | null }) {
  const working = v.copies.reduce((t, c) => t + c.amount, 0);
  const earn = v.earn?.value ?? 0;
  const parts = [
    { label: "Copy trading", value: working, cls: "bg-mint" },
    { label: "Earn (SLP)", value: earn, cls: "bg-[#2bc485]/60" },
    { label: "Reserve", value: Math.max(0, v.reserve), cls: "bg-white/20" },
  ].filter((p) => p.value > 0);
  const total = parts.reduce((t, p) => t + p.value, 0) || 1;
  return (
    <section className="card rounded-3xl p-5 sm:p-6">
      <h3 className="font-display text-lg font-semibold">Where your money is</h3>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-white/[0.05]">
        {parts.map((p) => (
          <motion.span key={p.label} className={p.cls} initial={{ width: 0 }} animate={{ width: `${(p.value / total) * 100}%` }} transition={{ duration: 0.8 }} />
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2 whitespace-nowrap">
            <span className={`size-2.5 rounded-full ${p.cls}`} />
            <span className="text-muted">{p.label}</span>
            <span className="font-mono">{usd(p.value)}</span>
          </li>
        ))}
      </ul>
      {!earn && v.reserve >= 1 && apr ? (
        <p className="mt-4 rounded-xl bg-white/[0.03] px-3 py-2.5 text-xs leading-relaxed text-muted">
          Your {usd(v.reserve)} reserve is sitting still. In Earn it could make about <span className="text-mint">{usd((v.reserve * apr) / 12)} a month</span> at SLP&apos;s APR today.
        </p>
      ) : null}
    </section>
  );
}

export function TradersList({ v, limit }: { v: BotView; limit?: number }) {
  const list = limit ? v.copies.slice(0, limit) : v.copies;
  return (
    <section className="card rounded-3xl p-5 sm:p-6">
      <h3 className="font-display text-lg font-semibold">Traders your bot copies</h3>
      {list.length ? (
        <ul className="mt-4 space-y-2">
          {list.map((c) => (
            <li key={c.lead} className="rounded-2xl bg-white/[0.03] p-3.5">
              <div className="flex items-center gap-3 font-mono text-sm">
                <span className="text-soft">{c.lead.length > 14 ? short(c.lead) : c.lead}</span>
                {c.stopped && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] text-gold">stopped</span>}
                <span className="ml-auto text-white/60">{usd(c.amount)}</span>
                <span className={`w-24 text-right ${c.pnl >= 0 ? "text-mint" : "text-neg"}`}>{signed(c.pnl)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {c.positions.length ? (
                  c.positions.map((p) => (
                    <span key={p.market + p.long} className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${p.long ? "bg-mint/12 text-mint" : "bg-neg/12 text-neg"}`}>
                      {p.market.replace(/^xyz:/, "").replace(/-USD$/, "")} {p.long ? "L" : "S"}
                      {p.pnl !== undefined && <span className="text-white/60"> {signed(p.pnl)}</span>}
                    </span>
                  ))
                ) : v.demo ? null : (
                  <span className="text-[11px] text-white/35">No open trades right now</span>
                )}
                {c.roi7d !== undefined && <span className="ml-auto text-[11px] text-white/40">trader&apos;s last 7 days: {c.roi7d >= 0 ? "+" : "−"}{Math.abs(c.roi7d * 100).toFixed(1)}%</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted">{v.mode === "off" ? "Start the bot to begin copying." : "Setting up your copies on Strike: this takes a minute or two."}</p>
      )}
    </section>
  );
}

export function Activity({ v, limit }: { v: BotView; limit?: number }) {
  const list = limit ? v.log.slice(0, limit) : v.log;
  return (
    <section className="card rounded-3xl p-5 sm:p-6">
      <h3 className="font-display text-lg font-semibold">What your bot did</h3>
      <ol className="mt-4 space-y-3">
        {list.map((l, i) => (
          <li key={i} className="border-l border-white/10 pl-3 text-xs leading-relaxed">
            <p className="font-mono text-[11px] text-white/40">{time(l.at)}</p>
            <p className="mt-0.5 text-soft">{l.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Earn: Strike's SLP vault, and RealFi's sUSDrf through Strike's Borrow & Earn. Deposits happen on Strike
 *  (its API has no vault deposits); Bolt shows the numbers and tracks your SLP position. */
export function EarnPanel({ v, slp, realfi, actions }: { v: BotView; slp: SlpInfo | null; realfi?: AutoMe["realfi"]; actions?: RealFiActions | null }) {
  const month = slp ? (Math.max(0, v.reserve) * slp.apr) / 12 : 0;
  return (
    <div className="space-y-4" data-tour="earn">
      <section className="card relative overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="pointer-events-none absolute -top-28 -right-24 h-80 w-80 rounded-full bg-mint/12 blur-[110px]" />
        <div className="relative grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="font-mono text-xs tracking-wider text-mint uppercase">Earn on Strike</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">Money that isn&apos;t trading can still earn.</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              The bot keeps part of your budget in reserve. Strike&apos;s own vault, SLP, puts dollars to work by making markets on Strike, and it&apos;s where Borrow &amp; Earn sends credit backed by
              RealFi&apos;s sUSDrf.
            </p>
          </div>
          <div className="rounded-2xl border border-mint/25 bg-mint/[0.05] p-5">
            <p className="text-xs text-muted">{slp?.name ?? "Strike Liquidity Provider (SLP)"}</p>
            <p className="mt-1 font-mono text-5xl text-mint">{slp ? `${(slp.apr * 100).toFixed(1)}%` : "—"}</p>
            <p className="text-xs text-muted">APR today, from Strike&apos;s API</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-white/[0.04] py-2">
                <p className="font-mono text-sm text-white">{slp ? `$${(slp.equity / 1e6).toFixed(2)}M` : "—"}</p>
                <p className="text-muted">in vault</p>
              </div>
              <div className="rounded-xl bg-white/[0.04] py-2">
                <p className="font-mono text-sm text-white">{slp ? `${slp.lockupDays} day` : "—"}</p>
                <p className="text-muted">lockup</p>
              </div>
              <div className="rounded-xl bg-white/[0.04] py-2">
                <p className="font-mono text-sm text-white">{slp ? `${slp.feeBps / 100}%` : "—"}</p>
                <p className="text-muted">vault fee</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <RealFiFlow slp={slp} realfi={realfi ?? null} actions={actions ?? null} />

      <div className="grid gap-4">
        <section className="card rounded-3xl p-6">
          <span className="grid size-10 place-items-center rounded-2xl bg-mint text-ink">{I.coin}</span>
          <h3 className="mt-4 font-display text-xl font-semibold">Your reserve in SLP</h3>
          {v.earn ? (
            <p className="mt-2 text-sm text-muted">
              You have <span className="font-mono text-white">{usd(v.earn.value)}</span> in SLP, <span className={v.earn.pnl >= 0 ? "text-mint" : "text-neg"}>{signed(v.earn.pnl)}</span> so far.
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">
              {v.reserve >= 1 ? (
                <>
                  Your <span className="font-mono text-white">{usd(v.reserve)}</span> reserve{slp ? <> could earn about <span className="text-mint">{usd(month)} a month</span> at today&apos;s APR</> : " could earn here"}. Minimum deposit ${slp?.minDeposit ?? 100}.
                </>
              ) : (
                "Your whole budget is in copies right now. Anything you keep aside can go here."
              )}
            </p>
          )}
          <a href={STRIKE_VAULTS} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-mint-2">
            Deposit in SLP on Strike ↗
          </a>
        </section>

      </div>

      <p className="px-1 text-[11px] leading-relaxed text-white/40">
        APR is variable and past returns don&apos;t promise future ones. SLP trades against the market and can lose money. Putting your trading balance straight into SLP
        happens on Strike for now; once you&apos;re connected, Bolt tracks your SLP position here. Bolt isn&apos;t affiliated with Strike or RealFi.
      </p>
    </div>
  );
}

const TRANSFER_STATUS: Record<string, string> = { pending: "On its way", pending_settlement: "Credited", settled: "Done", completed: "Done", failed: "Failed", cancelled: "Cancelled" };

/** Deposits and withdrawals on the user's Strike account, with Strike's status. */
export function Transfers({ list }: { list: NonNullable<AutoMe["transfers"]> }) {
  if (!list.length) return null;
  return (
    <section className="card rounded-3xl p-5 sm:p-6">
      <h3 className="font-display text-lg font-semibold">Deposits &amp; withdrawals</h3>
      <ul className="mt-4 divide-y divide-white/5">
        {list.map((t, i) => {
          const label = TRANSFER_STATUS[t.status] ?? t.status;
          const tone = /failed|cancelled/.test(t.status) ? "text-neg" : t.status === "pending" ? "text-gold" : "text-mint";
          const units = t.assetAmount ? (t.assetAmount / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "";
          return (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
              <span className="w-20 text-muted">{t.type === "deposit" ? "Deposit" : "Withdraw"}</span>
              <span className="font-mono">{units ? `${units} ${t.asset}` : usd(t.usd)}</span>
              {units && <span className="font-mono text-xs text-white/40">≈ {usd(t.usd)}</span>}
              <span className={`ml-auto text-xs ${tone}`}>{label}</span>
              {t.at && <span className="w-28 text-right font-mono text-[11px] text-white/35">{time(t.at)}</span>}
              {t.txHash && (
                <a href={`https://cardanoscan.io/transaction/${t.txHash}`} target="_blank" rel="noreferrer" className="text-[11px] text-muted hover:text-white">
                  ↗
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
