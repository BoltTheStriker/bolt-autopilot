"use client";

// The setup steps of Autopilot: connect, fund, rules, go live (shared by the real app and the demo).
import { useEffect, useMemo, useState } from "react";
import type { AutoMode } from "@/lib/autopilotApi";
import type { InstalledWallet } from "@/lib/wallet";
import { describeRules, MIN_COPY_USD, RISK_LEVELS, sanitizeRules, type AutoRules, type Goal, type Markets, type Risk } from "@/worker/autopilot";
import { MoneyPath } from "./strike";
import { ChoiceCards, Slider, type TourStep } from "./ui";

export const STEPS = [
  { id: "connect", label: "Connect" },
  { id: "fund", label: "Fund" },
  { id: "rules", label: "Your goal" },
  { id: "live", label: "Go live" },
] as const;

export const TOUR: TourStep[] = [
  { target: "steps", title: "Four steps, that's it", body: "Connect your wallet, add funds, tell the bot your goal, switch it on. You can come back and change anything later." },
  { target: "connect", title: "Your money stays yours", body: "Connecting creates your own Strike account. The bot gets a key that can trade but can never withdraw: only your wallet can." },
  { target: "fund", title: "Add funds in one signature", body: "Send ADA from your wallet straight into your Strike account. Your wallet shows exactly where it goes." },
  { target: "rules", title: "Say what you want, not how", body: "Pick your risk and goal. The bot turns them into stop-losses, leverage caps and trader picks, and enforces them on Strike." },
  { target: "preview", title: "See it before it's live", body: "This box always says, in plain words, what your bot will do with your money." },
  { target: "golive", title: "You flip the switch", body: "Nothing trades until you start it, and one button stops it again." },
  { target: "overview", title: "Your bot at a glance", body: "Balance, money in copies, profit and what's in reserve, always up to date." },
  { target: "tabs", title: "Earn: RealFi on Strike", body: "Money the bot isn't using can earn in Strike's SLP vault, including RealFi's sUSDrf through Borrow & Earn." },
  { target: "copilot", title: "Not sure? Ask the copilot", body: "It tunes your rules for you, shows each change first and applies nothing without your OK." },
];

export const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const signed = (v: number) => `${v >= 0 ? "+" : "−"}${usd(Math.abs(v))}`;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const time = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const I = {
  shield: <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /></svg>,
  scale: <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18M5 7h14M7 7l-3 6a3 3 0 006 0zM17 7l-3 6a3 3 0 006 0z" /></svg>,
  rocket: <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 10a2 2 0 110-4 2 2 0 010 4z" /><path d="M9 15l-3-3c2-6 6-9 12-9 0 6-3 10-9 12z" /></svg>,
  leaf: <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20c0-9 6-15 16-16-1 10-7 16-16 16zM4 20l8-8" /></svg>,
  globe: <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></svg>,
  coin: <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9 9h4.5a2 2 0 010 4H9h5a2 2 0 010 4H9M11 7v2M11 17v-2" /></svg>,
  chart: <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19h16M7 15l3-4 3 3 5-7" /></svg>,
  spark: <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" /></svg>,
};

export const RISKS = [
  { id: "low", title: "Low", desc: "Half your budget works, leverage ≤ 3x, each copy stops at −10%.", icon: I.shield },
  { id: "medium", title: "Medium", desc: "75% works, leverage ≤ 5x, stops at −15%. A good default.", icon: I.scale },
  { id: "high", title: "High", desc: "All of it works, up to 10x and 2× sizing, stops at −20%. Big swings.", icon: I.rocket },
] as const;
export const GOALS = [
  { id: "steady", title: "Steady", desc: "The calmest of the good traders. Smaller drops.", icon: I.leaf },
  { id: "balanced", title: "Balanced", desc: "The bot's best picks by return per unit of risk.", icon: I.scale },
  { id: "growth", title: "Growth", desc: "Good traders with more upside. Bigger moves.", icon: I.chart },
] as const;
export const MARKETS = [
  { id: "all", title: "Everything", desc: "Crypto plus stocks, indices, gold and oil.", icon: I.globe },
  { id: "crypto", title: "Crypto", desc: "BTC, ETH, ADA, SOL and the other coins.", icon: I.coin },
  { id: "realworld", title: "Real-world", desc: "S&P 500, Nasdaq, gold, oil, Nvidia, Tesla…", icon: I.chart },
] as const;


export function ConnectCard({ wallets, busy, disabled, onConnect, onDemo }: { wallets: InstalledWallet[]; busy: boolean; disabled: boolean; onConnect: (key: string) => void; onDemo: () => void }) {
  return (
    <section className="card relative overflow-hidden rounded-3xl p-6 sm:p-8" data-tour="connect">
      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-mint/15 blur-[100px]" />
      <div className="relative grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h2 className="font-display text-2xl font-semibold">Connect your Cardano wallet</h2>
          <p className="mt-1 text-sm text-muted">
            One signature opens your account on <span className="text-white">Strike Finance</span> (or links the one you have) through Strike&apos;s builder program. No transaction, no fee.
          </p>
          {wallets.length ? (
            <div className="mt-6 flex flex-wrap gap-2">
              {wallets.map((w) => (
                <button key={w.key} disabled={busy || disabled} onClick={() => onConnect(w.key)} className="flex items-center gap-2.5 rounded-full bg-mint py-2 pr-5 pl-2 font-semibold text-ink transition hover:bg-mint-2 disabled:opacity-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.icon} alt="" className="size-7 rounded-full bg-white" />
                  {busy ? "Check your wallet…" : `Connect ${w.name}`}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-6 text-sm text-muted">No Cardano wallet found in this browser. Install Eternl, Lace or Vespr, then come back.</p>
          )}
          {disabled && <p className="mt-4 text-sm text-gold">Real accounts open soon. Until then, try everything with demo money.</p>}
          <button onClick={onDemo} className="group mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm transition hover:border-mint/40">
            <span className="text-mint">{I.spark}</span>
            <span>
              <span className="font-semibold">Try it with demo money</span>
              <span className="block text-xs text-muted">$1,000 of pretend money, the bot&apos;s real picks. No wallet needed.</span>
            </span>
            <span className="ml-2 text-mint transition group-hover:translate-x-0.5">→</span>
          </button>
        </div>
        <ul className="space-y-3 text-sm">
          {[
            ["Your account, your money", "Funds sit in your own Strike account. Withdraw to your wallet any time."],
            ["The bot can only trade", "Its key can open and close copies. It can never withdraw: that always needs your wallet."],
            ["Limits enforced by Strike", "Stop-loss, leverage cap and markets are set on every copy, on Strike itself."],
          ].map(([t, d]) => (
            <li key={t} className="flex gap-3 rounded-2xl bg-white/[0.03] p-3.5">
              <span className="mt-0.5 text-mint">{I.shield}</span>
              <span>
                <span className="font-semibold">{t}</span>
                <span className="mt-0.5 block text-muted">{d}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function FundCard({ walletKey, wallets, busy, onDeposit, onSkip }: { walletKey: string | null; wallets: InstalledWallet[]; busy: string; onDeposit: (key: string, ada: number) => void; onSkip: () => void }) {
  const [ada, setAda] = useState(250);
  const [key, setKey] = useState<string | null>(walletKey ?? wallets[0]?.key ?? null);
  return (
    <section className="card rounded-3xl p-6 sm:p-8" data-tour="fund">
      <h2 className="font-display text-2xl font-semibold">Add funds to your Strike account</h2>
      <p className="mt-1 text-sm text-muted">Send ADA from your wallet. Strike converts it to trading balance. You sign one transaction; your wallet shows exactly where it goes.</p>
      <MoneyPath direction="in" className="mt-4 max-w-md" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="flex flex-wrap gap-2">
            {[100, 250, 500, 1000].map((v) => (
              <button key={v} onClick={() => setAda(v)} className={`rounded-full px-4 py-2 font-mono text-sm transition ${ada === v ? "bg-mint text-ink" : "bg-white/[0.06] text-soft hover:text-white"}`}>
                {v} ₳
              </button>
            ))}
          </div>
          <label className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 focus-within:border-mint/50">
            <span className="text-muted">₳</span>
            <input type="number" min={5} value={ada} onChange={(e) => setAda(Number(e.target.value))} className="w-full bg-transparent font-mono text-lg outline-none" />
            <span className="text-xs text-muted">ADA</span>
          </label>
          {wallets.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {wallets.map((w) => (
                <button key={w.key} onClick={() => setKey(w.key)} className={`rounded-full px-3 py-1 ${key === w.key ? "bg-white/15 text-white" : "text-muted"}`}>
                  {w.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <button disabled={!key || ada < 5 || busy === "deposit"} onClick={() => key && onDeposit(key, ada)} className="rounded-full bg-mint px-7 py-3 font-semibold text-ink transition hover:bg-mint-2 disabled:opacity-50">
            {busy === "deposit" ? "Check your wallet…" : `Deposit ${ada} ₳`}
          </button>
          <button onClick={onSkip} className="rounded-full px-5 py-2.5 text-sm text-muted hover:text-white">I already have funds on Strike</button>
        </div>
      </div>
    </section>
  );
}

/** After a deposit: it's on its way (Cardano confirms it, then Strike credits it). */
export function DepositPending({ amount, asset, txHash, onContinue }: { amount: number; asset: string; txHash: string | null; onContinue: () => void }) {
  const stages = ["Sent from your wallet", "Confirming on Cardano", "Credited to your Strike account"];
  return (
    <section className="card relative overflow-hidden rounded-3xl p-6 sm:p-8" data-tour="fund">
      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-mint/15 blur-[100px]" />
      <div className="relative flex items-center gap-3">
        <span className="relative grid size-11 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-mint/30" />
          <span className="relative size-3 rounded-full bg-mint" />
        </span>
        <div>
          <h2 className="font-display text-2xl font-semibold">
            Your {amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} {asset} is on its way
          </h2>
          <p className="text-sm text-muted">Usually 2 to 10 minutes. This page updates by itself.</p>
        </div>
      </div>
      <ol className="relative mt-6 space-y-3">
        {stages.map((s, i) => (
          <li key={s} className="flex items-center gap-3 text-sm">
            <span className={`grid size-6 place-items-center rounded-full font-mono text-xs ${i === 0 ? "bg-mint text-ink" : i === 1 ? "border border-mint text-mint" : "border border-white/20 text-white/40"}`}>{i === 0 ? "✓" : i + 1}</span>
            <span className={i === 2 ? "text-white/50" : ""}>{s}</span>
            {i === 1 && <span className="size-1.5 animate-pulse rounded-full bg-mint" />}
          </li>
        ))}
      </ol>
      <div className="relative mt-6 flex flex-wrap items-center gap-3">
        <button onClick={onContinue} className="rounded-full bg-mint px-6 py-3 font-semibold text-ink transition hover:bg-mint-2">
          Set up your goal meanwhile →
        </button>
        {txHash && (
          <a href={`https://cardanoscan.io/transaction/${txHash}`} target="_blank" rel="noreferrer" className="text-sm text-muted hover:text-white">
            View on Cardanoscan ↗
          </a>
        )}
      </div>
    </section>
  );
}

export function RulesCard({
  initial,
  maxBudget,
  budgetHint,
  busy,
  preview,
  saveLabel = "Save my rules",
  apr,
  onSave,
  onCancel,
  onAsk,
  onChange,
}: {
  initial: AutoRules;
  maxBudget: number;
  budgetHint?: string;
  busy: boolean;
  preview: boolean;
  saveLabel?: string;
  apr?: number | null; // SLP's APR today, for the reserve line
  onSave: (r: AutoRules) => void;
  onCancel?: () => void;
  onAsk: () => void;
  onChange?: (r: AutoRules) => void; // the draft as it changes (the copilot works from it)
}) {
  const [r, setR] = useState<AutoRules>({ ...initial, budgetUsd: Math.min(initial.budgetUsd, maxBudget) });
  useEffect(() => onChange?.(r), [r, onChange]);
  const [advanced, setAdvanced] = useState(false);
  const level = RISK_LEVELS[r.risk];
  const set = (patch: Partial<AutoRules>) => setR((x) => sanitizeRules({ ...x, ...patch }, maxBudget) ?? x);
  // Changing risk resets the limits to that level's defaults (they can only be tightened from there).
  const setRisk = (risk: Risk) => setR((x) => sanitizeRules({ ...x, risk, maxLeverage: RISK_LEVELS[risk].maxLeverage, stopLossPct: RISK_LEVELS[risk].stopLossPct, dailyLossPct: RISK_LEVELS[risk].dailyLossPct }, maxBudget) ?? x);
  const working = r.budgetUsd * level.deploy;
  const perCopy = r.traders ? working / r.traders : 0;
  const reserve = r.budgetUsd - working;
  const summary = useMemo(() => describeRules(r).split("; "), [r]);

  return (
    <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]" data-tour="rules">
      <div className="card space-y-7 rounded-3xl p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold">What do you want from your bot?</h2>
            <p className="mt-1 text-sm text-muted">Three choices. The bot handles the rest.</p>
          </div>
          <button onClick={onAsk} className="glass flex items-center gap-2 rounded-full px-4 py-2 text-sm text-soft hover:text-white">{I.spark} Help me choose</button>
        </div>
        <div>
          <p className="mb-2.5 text-sm font-semibold">1 · How much risk?</p>
          <ChoiceCards value={r.risk} options={RISKS} onChange={setRisk} />
        </div>
        <div>
          <p className="mb-2.5 text-sm font-semibold">2 · Your goal</p>
          <ChoiceCards value={r.goal} options={GOALS} onChange={(goal: Goal) => set({ goal })} />
        </div>
        <div>
          <p className="mb-2.5 text-sm font-semibold">3 · Markets</p>
          <ChoiceCards value={r.markets} options={MARKETS} onChange={(markets: Markets) => set({ markets })} />
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <Slider label="Budget for the bot" value={r.budgetUsd} min={50} max={maxBudget} step={10} format={(v) => `$${v.toFixed(0)}`} hint={budgetHint ?? `Beta limit $${maxBudget.toFixed(0)}`} onChange={(budgetUsd) => set({ budgetUsd })} />
          <Slider label="Traders to copy" value={r.traders} min={1} max={6} step={1} format={(v) => String(v)} hint="More traders = smoother, smaller copies" onChange={(traders) => set({ traders })} />
        </div>
        <div>
          <button onClick={() => setAdvanced((a) => !a)} className="text-sm text-mint hover:underline">{advanced ? "Hide" : "Show"} advanced limits</button>
          {advanced && (
            <div className="mt-4 grid gap-6 sm:grid-cols-2">
              <Slider label="Leverage cap per trade" value={r.maxLeverage} min={1} max={level.maxLeverage} step={1} format={(v) => `${v}x`} onChange={(maxLeverage) => set({ maxLeverage })} />
              <Slider label="Stop a copy at" value={r.stopLossPct} min={0.05} max={level.stopLossPct} step={0.01} format={(v) => `−${Math.round(v * 100)}%`} onChange={(stopLossPct) => set({ stopLossPct })} />
              <Slider label="Daily loss limit" value={r.dailyLossPct} min={0.03} max={level.dailyLossPct} step={0.01} format={(v) => `−${Math.round(v * 100)}%`} hint="Everything stops until tomorrow" onChange={(dailyLossPct) => set({ dailyLossPct })} />
              <div>
                <label className="flex items-center justify-between text-sm">
                  <span className="text-soft">Lock in profits</span>
                  <input type="checkbox" checked={r.profitLockPct !== null} onChange={(e) => set({ profitLockPct: e.target.checked ? 0.15 : null })} className="size-4 accent-[#4efab0]" />
                </label>
                {r.profitLockPct !== null && (
                  <div className="mt-2">
                    <Slider label="Bank a copy at" value={r.profitLockPct} min={0.05} max={0.5} step={0.01} format={(v) => `+${Math.round(v * 100)}%`} onChange={(profitLockPct) => set({ profitLockPct })} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="card relative h-fit overflow-hidden rounded-3xl border border-mint/25 p-6 xl:sticky xl:top-24" data-tour="preview">
        <div className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-mint/15 blur-[80px]" />
        <p className="relative font-mono text-xs tracking-wider text-mint uppercase">Your bot will</p>
        <div className="relative mt-4 grid grid-cols-2 gap-2">
          <Stat label="Working" value={`$${working.toFixed(0)}`} />
          <Stat label="Per copy" value={`$${perCopy.toFixed(0)}`} />
          <Stat label="Leverage cap" value={`${r.maxLeverage}x`} />
          <Stat label="Stop each copy" value={`−$${(perCopy * r.stopLossPct).toFixed(0)}`} />
        </div>
        <ul className="relative mt-5 space-y-2 text-sm text-soft">
          {summary.map((s) => (
            <li key={s} className="flex gap-2">
              <span className="text-mint">›</span>
              {s[0].toUpperCase() + s.slice(1)}
            </li>
          ))}
        </ul>
        {perCopy < MIN_COPY_USD && (
          <p className="relative mt-4 rounded-xl border border-gold/40 bg-gold/[0.08] px-3 py-2.5 text-xs leading-relaxed text-gold">
            Too small to copy: each copy needs at least ${MIN_COPY_USD}, and this setup puts ${perCopy.toFixed(0)} in each.{" "}
            {working >= MIN_COPY_USD ? "Copy fewer traders." : `Raise the budget, pick a higher risk level, or add funds (${level.deploy < 1 ? `at ${r.risk} risk, ${Math.round(level.deploy * 100)}% of the budget works` : "the whole budget works"}).`}
          </p>
        )}
        {reserve >= 1 && (
          <p className="relative mt-4 rounded-xl border border-mint/20 bg-mint/[0.05] px-3 py-2.5 text-xs leading-relaxed text-soft">
            <span className="font-semibold text-white">${reserve.toFixed(0)} stays in reserve.</span>{" "}
            {apr ? `Put it to work in Earn: Strike's SLP vault pays about ${Math.round(apr * 100)}% APR today (it changes).` : "You can put it to work in Earn (Strike's SLP vault)."}
          </p>
        )}
        <p className="relative mt-4 text-[11px] leading-relaxed text-white/40">Copy trading can lose money. Limits cut losses; they can&apos;t prevent them. Past results don&apos;t promise future ones.</p>
        <div className="relative mt-5 flex gap-2">
          {onCancel && <button onClick={onCancel} className="glass flex-1 rounded-full py-3 text-sm">Cancel</button>}
          <button disabled={busy || preview} onClick={() => onSave(r)} className="flex-1 rounded-full bg-mint py-3 font-semibold text-ink transition hover:bg-mint-2 disabled:opacity-50">
            {preview ? "Connect to save" : busy ? "Saving…" : saveLabel}
          </button>
        </div>
      </aside>
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 font-mono text-lg">{value}</p>
    </div>
  );
}

export function GoLiveCard({ rulesText, busy, demo = false, onEdit, onStart }: { rulesText: string; busy: boolean; demo?: boolean; onEdit: () => void; onStart: (m: AutoMode) => void }) {
  const [ok, setOk] = useState(demo);
  const [mode, setMode] = useState<AutoMode>("on");
  return (
    <section className="card mx-auto max-w-2xl rounded-3xl p-6 text-center sm:p-10" data-tour="golive">
      <p className="font-mono text-xs tracking-wider text-mint uppercase">Last step</p>
      <h2 className="mt-2 font-display text-3xl font-bold">Ready to go live?</h2>
      <ul className="mx-auto mt-5 max-w-md space-y-1.5 text-left text-sm text-soft">
        {rulesText.split("; ").map((s) => (
          <li key={s} className="flex gap-2">
            <span className="text-mint">›</span>
            {s[0].toUpperCase() + s.slice(1)}
          </li>
        ))}
      </ul>
      <div className="mx-auto mt-6 grid max-w-md gap-2 sm:grid-cols-2">
        {(
          [
            ["on", "Follow my rules", "The bot runs exactly the rules you set."],
            ["autopilot", "Autopilot", "The copilot may also fine-tune them, within your limits."],
          ] as const
        ).map(([id, t, d]) => (
          <button key={id} onClick={() => setMode(id)} className={`rounded-2xl border p-3 text-left transition ${mode === id ? "border-mint/60 bg-mint/[0.09]" : "border-white/10 hover:border-white/25"}`}>
            <span className="font-semibold">{t}</span>
            <span className="mt-0.5 block text-xs text-muted">{d}</span>
          </button>
        ))}
      </div>
      {demo ? (
        <p className="mx-auto mt-6 max-w-md text-sm text-muted">Demo: $1,000 of pretend money, nothing touches a wallet. It starts now and moves live with the traders the bot picks for you.</p>
      ) : (
        <label className="mx-auto mt-6 flex max-w-md items-start gap-2.5 text-left text-sm text-soft">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-0.5 size-4 accent-[#4efab0]" />I understand copy trading uses real money and can lose it. I can switch the bot off at any time.
        </label>
      )}
      <div className="mt-6 flex justify-center gap-2">
        <button onClick={onEdit} className="glass rounded-full px-6 py-3 text-sm">Change rules</button>
        <button disabled={!ok || busy} onClick={() => onStart(mode)} className="rounded-full bg-mint px-8 py-3 font-semibold text-ink transition hover:bg-mint-2 disabled:opacity-50">
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
              Starting…
            </span>
          ) : demo ? (
            "Start the demo bot"
          ) : (
            "Start my bot"
          )}
        </button>
      </div>
    </section>
  );
}
