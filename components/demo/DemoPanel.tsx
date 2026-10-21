"use client";

import { useEffect, useState } from "react";
import { site } from "@/lib/config";
import { fmtCompact } from "@/lib/format";
import { useAdminKey } from "@/lib/adminPreview";
import { useBotState } from "@/lib/useBotState";
import { connectAddress, installedWallets, type InstalledWallet } from "@/lib/wallet";
import { AreaChart } from "../AreaChart";
import { ShareModal } from "./ShareModal";
import { CupCard } from "./CupCard";
import { StartFresh } from "./StartFresh";

type Settings = { traders: number; style: "steady" | "balanced" | "bold" | "aggressive"; stopLoss: number; trailing: number | null; tp: { mode: "off" | "bank" | "close"; pct: number }; leverage?: number };
type Demo = {
  startedAt: number;
  startBalance: number;
  value: number;
  pnl: number;
  cash: number;
  banked: number;
  settings: Settings;
  positions: { lead: string; cost: number; value: number; pnl?: number; openedAt: number; open?: { market: string; long: boolean; pnl: number }[] | null }[];
  decisions: { at: number; kind: "open" | "close" | "bank" | "settings" | "info"; text: string }[];
  history: { at: number; value: number }[];
  cup?: { cupId: number; joinedAt: number; startValue?: number } | null;
};
type View =
  | { enabled: boolean; preview?: boolean; status: "locked"; held: number; min: number }
  | { enabled: boolean; preview?: boolean; status: "ready"; held: number; min: number; startBalance: number }
  | { enabled: boolean; preview?: boolean; status: "active"; held: number; min: number; demo: Demo; cardId: string; canReset?: boolean };

const ADDRESS_STORE = "bolt-demo-address"; // per-viewer convenience: reopen your demo without reconnecting
const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const since = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", timeZone: "UTC" });

function remembered(): string {
  try {
    return localStorage.getItem(ADDRESS_STORE) ?? "";
  } catch {
    return "";
  }
}
function remember(address: string) {
  try {
    if (address) localStorage.setItem(ADDRESS_STORE, address);
    else localStorage.removeItem(ADDRESS_STORE);
  } catch {}
}

/** The holder demo: connect, check 1M+ $BOLT, then a $10,000 fake-money account that follows the bot. */
export function DemoPanel() {
  const bot = useBotState();
  const adminKey = useAdminKey();
  const enabled = bot?.demo?.enabled ?? false;
  const [wallets, setWallets] = useState<InstalledWallet[]>([]);
  const [address, setAddress] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** GET status, POST /start, or POST /settings. `quiet` refreshes in the background without spinners. */
  async function load(addr: string, action: "status" | "start" | "settings" = "status", settings?: Settings, quiet = false) {
    if (!quiet) {
      setBusy(true);
      setError("");
    }
    try {
      const post = action !== "status";
      const res = await fetch(`${site.botApi}/demo${post ? `/${action}` : `?address=${encodeURIComponent(addr)}`}`, {
        method: post ? "POST" : "GET",
        headers: { "content-type": "application/json", ...(adminKey ? { "x-admin-key": adminKey } : {}) },
        body: post ? JSON.stringify({ address: addr, settings }) : undefined,
      });
      const json = await res.json();
      if (json.enabled === false && !json.status) throw new Error("The holder preview isn't open yet.");
      if (!res.ok && !json.status) throw new Error(json.error ?? "Something went wrong");
      setView(json as View);
      setAddress(addr);
      remember(addr);
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (!quiet) setBusy(false);
    }
  }

  // Keep an open demo current: the server runs the holder's rules every 15 seconds.
  const active = view?.status === "active";
  useEffect(() => {
    if (!active || !address) return;
    const t = setInterval(() => load(address, "status", undefined, true), 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, address]);

  // Wallet extensions inject window.cardano shortly after load; reopen a remembered demo.
  useEffect(() => {
    const t = setTimeout(() => {
      setWallets(installedWallets());
      const saved = remembered();
      if (saved && (enabled || adminKey)) load(saved);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, adminKey]);

  async function connect(key: string) {
    setError("");
    try {
      await load(await connectAddress(key));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connection was rejected");
    }
  }

  function disconnect() {
    remember("");
    setAddress("");
    setView(null);
  }

  if (!enabled && !adminKey) {
    return (
      <div className="card mt-8 rounded-3xl p-6 text-center sm:p-10">
        <p className="font-mono text-xs tracking-wider text-mint uppercase">Opening soon</p>
        <p className="mt-3 text-muted">The holder preview isn&apos;t open yet. Follow {site.socials.x.replace("https://x.com/", "@")} to hear first.</p>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-4">
      {!enabled && adminKey && (
        <p className="rounded-2xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold">
          Admin preview: the holder demo is switched OFF for the public. Turn it on from /admin when you&apos;re ready.
        </p>
      )}

      {!view || !address ? (
        <div className="card rounded-3xl p-6 sm:p-8">
          <h2 className="font-display text-2xl font-semibold">Connect your wallet</h2>
          <p className="mt-1 text-sm text-muted">
            Hold {fmtCompact(1_000_000)}+ ${site.ticker} to unlock a ${(10_000).toLocaleString("en-US")} demo account. Read-only: nothing to sign, no fees.
          </p>
          {wallets.length ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {wallets.map((w) => (
                <button key={w.key} disabled={busy} onClick={() => connect(w.key)} className="glass flex items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5 text-sm transition hover:bg-white/10 disabled:opacity-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.icon} alt="" className="size-6 rounded-full" />
                  {w.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-5 text-sm text-muted">No Cardano wallet found in this browser. Install Eternl, Lace or Vespr to continue.</p>
          )}
          {busy && <p className="mt-4 text-sm text-soft">Checking your wallet…</p>}
          {error && <p className="mt-4 text-sm text-neg">{error}</p>}
        </div>
      ) : view.status === "locked" ? (
        <div className="card rounded-3xl p-6 sm:p-8">
          <p className="font-mono text-xs text-muted">{short(address)}</p>
          <h2 className="mt-2 font-display text-2xl font-semibold">Almost there</h2>
          <p className="mt-1 text-muted">
            This wallet holds <span className="font-mono text-white">{fmtCompact(view.held)}</span> ${site.ticker}. The preview unlocks at{" "}
            <span className="font-mono text-white">{fmtCompact(view.min)}</span>.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a href={site.token.launchpad.url} target="_blank" rel="noreferrer" className="rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-ink">Buy ${site.ticker}</a>
            <button onClick={() => load(address)} className="glass rounded-full px-5 py-2.5 text-sm">Check again</button>
            <button onClick={disconnect} className="rounded-full px-4 py-2.5 text-sm text-muted hover:text-white">Use another wallet</button>
          </div>
        </div>
      ) : view.status === "ready" ? (
        <div className="card relative overflow-hidden rounded-3xl p-6 sm:p-8">
          <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-mint/15 blur-[100px]" />
          <p className="relative font-mono text-xs text-muted">{short(address)} · {fmtCompact(view.held)} ${site.ticker}</p>
          <h2 className="relative mt-2 font-display text-3xl font-bold">You&apos;re in.</h2>
          <p className="relative mt-1 max-w-xl text-muted">
            Start a demo account with <span className="text-white">{money(view.startBalance)}</span> of fake money. From that moment it follows Bolt&apos;s bot:
            same traders, same trades, your own result.
          </p>
          <button disabled={busy} onClick={() => load(address, "start")} className="relative mt-6 rounded-full bg-mint px-7 py-3 font-semibold text-ink transition hover:bg-mint-2 disabled:opacity-60">
            {busy ? "Starting…" : `Start my ${money(view.startBalance)} demo`}
          </button>
          {error && <p className="relative mt-3 text-sm text-neg">{error}</p>}
        </div>
      ) : (
        <>
        <CupCard address={address} joined={Boolean(view.demo.cup)} onJoined={() => load(address)} />
        <DemoAccountView
          demo={view.demo}
          cardId={view.cardId}
          address={address}
          busy={busy}
          onSave={(next) => load(address, "settings", next)}
          onDisconnect={disconnect}
          onReset={() => load(address)}
          canReset={view.canReset !== false}
        />
        </>
      )}
    </div>
  );
}

const STYLES = [
  { id: "steady", label: "Steady", desc: "Calmest traders first: smallest drawdowns." },
  { id: "balanced", label: "Balanced", desc: "The bot's own ranking." },
  { id: "bold", label: "Bold", desc: "Highest 30-day returns first. Bigger swings." },
  { id: "aggressive", label: "Aggressive", desc: "The bot's top 3 picks only: concentrated, so bigger swings both ways." },
] as const;
const LEVERAGE = [
  { id: "1", label: "1x" },
  { id: "2", label: "2x" },
  { id: "3", label: "3x" },
] as const;
const TP = [
  { id: "off", label: "Off" },
  { id: "bank", label: "Bank & keep" },
  { id: "close", label: "Close" },
] as const;
const pctLabel = (f: number) => `${Math.round(f * 100)}%`;

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: readonly { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-full bg-white/[0.06] p-1">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={value === o.id}
          className={`rounded-full px-3.5 py-1.5 text-sm transition ${value === o.id ? "bg-mint font-semibold text-ink" : "text-soft hover:text-white"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-sm"><span className="text-soft">{label}</span><span className="font-mono text-white">{format(value)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[#4efab0]" />
    </label>
  );
}

/** The holder's rules. Changes apply from now: balance and history are kept. */
function RulesPanel({ settings, busy, onSave }: { settings: Settings; busy: boolean; onSave: (s: Settings) => void }) {
  const [draft, setDraft] = useState(settings);
  const changed = JSON.stringify(draft) !== JSON.stringify(settings);
  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <div className="card rounded-3xl p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Your rules</h2>
          <p className="mt-0.5 text-xs text-muted">The bot picks the traders; you decide how it plays. Changes apply from now.</p>
        </div>
        <button disabled={!changed || busy} onClick={() => onSave(draft)} className="rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-mint-2 disabled:opacity-40">
          {busy ? "Saving…" : "Apply from now"}
        </button>
      </div>
      <div className="mt-6 grid gap-7 lg:grid-cols-2">
        <div className="space-y-6">
          <div>
            <Slider label="Traders to copy" value={draft.traders} min={1} max={10} step={1} format={(v) => String(v)} onChange={(v) => set({ traders: v })} />
            {draft.style === "aggressive" && draft.traders > 3 && <p className="mt-1.5 text-xs text-gold">Aggressive copies at most 3.</p>}
          </div>
          <div>
            <p className="text-sm text-soft">Style</p>
            <div className="mt-2"><Segmented value={draft.style} options={STYLES} onChange={(v) => set({ style: v })} /></div>
            <p className="mt-2 text-xs text-muted">{STYLES.find((x) => x.id === draft.style)!.desc}</p>
          </div>
          <div>
            <p className="text-sm text-soft">Leverage</p>
            <div className="mt-2"><Segmented value={String(draft.leverage ?? 1) as "1" | "2" | "3"} options={LEVERAGE} onChange={(v) => set({ leverage: Number(v) })} /></div>
            <p className="mt-2 text-xs text-muted">
              {(draft.leverage ?? 1) > 1
                ? `Every copy moves ${draft.leverage}× its trader's return: ${draft.leverage}× the profit, and ${draft.leverage}× the loss. Your stop-loss hits ${draft.leverage}× sooner.`
                : "Copies move exactly with their traders."}
            </p>
          </div>
        </div>
        <div className="space-y-6">
          <Slider label="Stop-loss per trader" value={draft.stopLoss} min={0.05} max={0.25} step={0.01} format={pctLabel} onChange={(v) => set({ stopLoss: v })} />
          <div>
            <label className="flex items-center justify-between text-sm">
              <span className="text-soft">Trailing stop</span>
              <input type="checkbox" checked={draft.trailing !== null} onChange={(e) => set({ trailing: e.target.checked ? 0.2 : null })} className="size-4 accent-[#4efab0]" />
            </label>
            {draft.trailing !== null && (
              <div className="mt-2"><Slider label="Off its best" value={draft.trailing} min={0.1} max={0.3} step={0.01} format={pctLabel} onChange={(v) => set({ trailing: v })} /></div>
            )}
          </div>
          <div>
            <p className="text-sm text-soft">Take profit</p>
            <div className="mt-2"><Segmented value={draft.tp.mode} options={TP} onChange={(v) => set({ tp: { ...draft.tp, mode: v } })} /></div>
            {draft.tp.mode !== "off" && (
              <div className="mt-3"><Slider label="When a copy is up" value={draft.tp.pct} min={0.05} max={0.5} step={0.01} format={(v) => `+${pctLabel(v)}`} onChange={(v) => set({ tp: { ...draft.tp, pct: v } })} /></div>
            )}
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {draft.tp.mode === "bank"
                ? "Banks the profit and keeps copying the trader at the original size."
                : draft.tp.mode === "close"
                  ? "Closes the copy and moves to the next trader."
                  : "Let winners run."}{" "}
              In our backtest, closing winning copies early lowered results; banking keeps the trader.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const KIND = { open: "text-mint", bank: "text-mint", close: "text-gold", settings: "text-soft", info: "text-soft" } as const;

function DemoAccountView({ demo, cardId, address, busy, onSave, onDisconnect, onReset, canReset }: { demo: Demo; cardId: string; address: string; busy: boolean; onSave: (s: Settings) => void; onDisconnect: () => void; onReset: () => void; canReset: boolean }) {
  const [share, setShare] = useState<{ image: string; link: string } | null>(null);
  const { value, pnl } = demo;
  const pct = pnl / demo.startBalance;
  const series = demo.history.map((h) => ({
    label: new Date(h.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC",
    tick: day(h.at),
    value: h.value,
    reference: demo.startBalance,
  }));
  // The share link's preview on X is the PnL card. A fresh ?v= per opening so X and the
  // modal show the latest numbers rather than a cached card.
  const openShare = () => {
    const v = Math.floor(Date.now() / 60_000);
    setShare({ image: `/api/share-card/${cardId}?v=${v}`, link: `${site.url}/share/${cardId}?v=${v}` });
  };
  const lev = demo.settings.leverage ?? 1;
  const shareText = `Testing the $${site.ticker} copy-trade bot with $10K of demo money${lev > 1 ? ` at ${lev}x` : ""}: ${pct >= 0 ? "up" : "down"} ${Math.abs(pct * 100).toFixed(2)}% since ${day(demo.startedAt)}.`;

  return (
    <>
      <div className="card relative overflow-hidden rounded-3xl p-5 sm:p-7">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-mint/15 blur-[100px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-muted">{short(address)} · since {day(demo.startedAt)}</p>
            <h2 className="mt-1 font-display text-xl font-semibold">Your demo account</h2>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 font-mono text-[11px] tracking-wide text-gold uppercase">Demo · fake money</span>
        </div>
        <div className="relative mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="col-span-2 rounded-2xl border border-mint/30 bg-mint/[0.08] p-4 lg:col-span-1">
            <p className="text-xs text-muted">Balance</p>
            <p className="mt-1 font-mono text-3xl font-medium">{money(value)}</p>
          </div>
          <div className="rounded-2xl bg-white/[0.05] p-4">
            <p className="text-xs text-muted">Profit</p>
            <p className={`mt-1 font-mono text-2xl ${pnl >= 0 ? "text-mint" : "text-neg"}`}>{signed(pnl)}</p>
          </div>
          <div className="rounded-2xl bg-white/[0.05] p-4">
            <p className="text-xs text-muted">Return</p>
            <p className={`mt-1 font-mono text-2xl ${pct >= 0 ? "text-mint" : "text-neg"}`}>{pct >= 0 ? "+" : "−"}{Math.abs(pct * 100).toFixed(2)}%</p>
          </div>
          <div className="col-span-2 rounded-2xl bg-white/[0.05] p-4 lg:col-span-1">
            <p className="text-xs text-muted">Banked</p>
            <p className="mt-1 font-mono text-2xl">{money(demo.banked)}</p>
          </div>
        </div>
        {series.length > 1 && (
          <div className="relative mt-5">
            <AreaChart data={series} color="#1fa874" valueName="Demo balance" referenceName="Started with" format="usdCents" zeroBased={false} height={200} />
          </div>
        )}
        <div className="relative mt-5 flex flex-wrap gap-2">
          <button onClick={openShare} className="rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-ink">Share my result</button>
          <button onClick={onDisconnect} className="glass rounded-full px-5 py-2.5 text-sm">Disconnect</button>
          {canReset ? (
            <StartFresh address={address} onDone={onReset} />
          ) : (
            <span className="self-center px-2 text-xs text-muted">Start fresh is off while you&apos;re in the Bot Cup.</span>
          )}
        </div>
      </div>

      <RulesPanel key={JSON.stringify(demo.settings)} settings={demo.settings} busy={busy} onSave={onSave} />

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="card min-w-0 rounded-3xl p-5 sm:p-6">
          <h2 className="font-display text-lg font-semibold">Your traders</h2>
          <p className="mt-0.5 text-xs text-muted">What your bot copies right now, with your rules</p>
          {demo.positions.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-2 font-normal">Trader</th>
                    <th className="py-2 text-right font-normal">In</th>
                    <th className="py-2 text-right font-normal">Profit</th>
                    <th className="hidden py-2 text-right font-normal sm:table-cell">Since</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {[...demo.positions].map((p) => ({ ...p, pnl: p.pnl ?? p.value - p.cost })).sort((a, b) => b.pnl - a.pnl).map((p) => (
                    <tr key={p.lead} className="border-t border-white/8 align-top">
                      <td className="py-2.5">
                        <a href={`https://app.hyperliquid.xyz/explorer/address/${p.lead}`} target="_blank" rel="noreferrer" className="text-soft hover:text-mint">{short(p.lead)}</a>
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {p.open?.length
                            ? p.open.map((o) => (
                                <span key={o.market + o.long} className={`rounded-md px-1.5 py-0.5 text-[10px] ${o.long ? "bg-mint/12 text-mint" : "bg-neg/12 text-neg"}`}>
                                  {o.market} {o.long ? "L" : "S"}
                                  <span className={`ml-1 ${o.pnl >= 0 ? "text-white/70" : "text-white/50"}`}>{o.pnl >= 0 ? "+" : "−"}${Math.abs(o.pnl).toFixed(2)}</span>
                                </span>
                              ))
                            : <span className="text-[11px] text-white/35">{p.open ? "flat, waiting for their next trade" : "…"}</span>}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">{money(p.cost)}</td>
                      <td className={`py-2.5 text-right ${p.pnl >= 0 ? "text-mint" : "text-neg"}`}>
                        {signed(p.pnl)}
                        <span className="block text-[10px] text-white/40">{p.pnl >= 0 ? "+" : "−"}{Math.abs(p.cost ? (p.pnl / p.cost) * 100 : 0).toFixed(2)}%</span>
                      </td>
                      <td className="hidden py-2.5 text-right text-[11px] text-white/45 sm:table-cell">{since(p.openedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ul className="mt-3 space-y-1.5">
            {demo.cash >= 1 && (
              <li className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm text-muted">Cash, waiting for a trader<span className="ml-auto font-mono">{money(demo.cash)}</span><span className="w-16" /></li>
            )}
            {demo.banked >= 0.01 && (
              <li className="flex items-center gap-3 rounded-xl bg-mint/[0.06] px-3 py-2.5 text-sm text-soft">Banked profit<span className="ml-auto font-mono text-mint">{money(demo.banked)}</span><span className="w-16" /></li>
            )}
            {!demo.positions.length && demo.cash < 1 && <li className="text-sm text-muted">Picking traders…</li>}
          </ul>
        </div>
        <div className="card min-w-0 rounded-3xl p-5 sm:p-6">
          <h2 className="font-display text-lg font-semibold">Your bot&apos;s decisions</h2>
          <p className="mt-0.5 text-xs text-muted">Everything your rules did, newest first</p>
          <ol className="mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-1">
            {demo.decisions.map((d, i) => (
              <li key={i} className="text-xs leading-relaxed">
                <p className="font-mono text-[11px] text-white/40">{new Date(d.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC</p>
                <p className={`mt-0.5 ${KIND[d.kind]}`}>{d.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <p className="text-center text-[11px] text-white/35">Demo only: no real money, no real trades. Results follow real traders on Strike and aren&apos;t guaranteed.</p>
      {share && <ShareModal image={share.image} link={share.link} text={shareText} filename={`bolt-demo-${cardId}.png`} onClose={() => setShare(null)} />}
    </>
  );
}
