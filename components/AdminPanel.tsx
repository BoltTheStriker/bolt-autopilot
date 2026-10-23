"use client";

import { useCallback, useState } from "react";
import { site } from "@/lib/config";
import { askConfirm, ConfirmHost } from "./Confirm";

type Status = {
  mode: "paper" | "dry" | "live";
  budgetUsd: number;
  maxBudgetUsd?: number;
  keysConfigured: boolean;
  copies: number;
  account?: { subs: number; allocated: number; pnl: number; at: number };
  lastSyncAt?: number;
  lastError?: string;
  killedAt?: number;
  log: { at: number; text: string }[];
  demo?: { enabled: boolean; accounts: number };
  bold?: { enabled: boolean; copy: string | null };
  lock?: { enabled: boolean; pct: number; banked: number; events: { at: number; amount: number }[] } | null;
};

const KEY_STORE = "bolt-admin-key"; // sessionStorage: cleared when the tab closes
const when = (ms?: number) => (ms ? new Date(ms).toLocaleString() : "—");

const MODES = [
  { id: "paper", label: "Paper", desc: "Simulation only. Strike is never called." },
  { id: "dry", label: "Dry run", desc: "Reads your real Strike account and shows what it would do. No orders." },
  { id: "live", label: "Live", desc: "Places and stops real copies with your budget." },
] as const;

export function AdminPanel() {
  // Read the remembered key once on mount (sessionStorage throws in some private modes).
  const [key, setKey] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return sessionStorage.getItem(KEY_STORE) ?? "";
    } catch {
      return "";
    }
  });
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState("");

  const call = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError("");
      try {
        const res = await fetch(`${site.botApi}/admin`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-admin-key": key },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
        setStatus(data);
        try {
          sessionStorage.setItem(KEY_STORE, key);
        } catch {}
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        setBusy(false);
      }
    },
    [key],
  );

  const setMode = async (mode: Status["mode"]) => {
    if (mode === "live" && !(await askConfirm({ title: "Go live with real money?", body: `Budget $${status?.budgetUsd}. Each copy gets a 15% stop-loss on Strike.`, confirmLabel: "Go live", danger: true }))) return;
    call({ action: "mode", mode });
  };

  if (!status)
    return (
      <form
        className="card mt-8 rounded-3xl p-6"
        onSubmit={(e) => {
          e.preventDefault();
          call({ action: "status" });
        }}
      >
        <label className="text-sm text-muted" htmlFor="k">Admin key</label>
        <div className="mt-2 flex gap-2">
          <input id="k" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off"
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.06] px-5 py-3 font-mono text-sm outline-none focus:border-mint/50" />
          <button disabled={busy || !key} className="rounded-full bg-mint px-6 py-3 font-semibold text-ink disabled:opacity-50">Unlock</button>
        </div>
        {error && <p className="mt-3 text-sm text-neg">{error}</p>}
      </form>
    );

  const live = status.mode === "live";
  return (
    <div className="mt-8 space-y-4">
      <div className={`card rounded-3xl p-6 ${live ? "border-neg/40" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">Current mode</p>
          <span className={`rounded-full px-3 py-1 font-mono text-xs uppercase ${live ? "bg-neg/15 text-neg" : status.mode === "dry" ? "bg-gold/15 text-gold" : "bg-mint/10 text-mint"}`}>
            {live ? "Live · real money" : status.mode === "dry" ? "Dry run" : "Paper"}
          </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <button key={m.id} disabled={busy || status.mode === m.id || (m.id !== "paper" && !status.keysConfigured)} onClick={() => setMode(m.id)}
              className={`rounded-2xl border p-4 text-left transition disabled:opacity-40 ${status.mode === m.id ? "border-mint/60 bg-mint/10" : "border-white/10 hover:bg-white/5"}`}>
              <p className="font-semibold">{m.label}</p>
              <p className="mt-1 text-xs text-muted">{m.desc}</p>
            </button>
          ))}
        </div>
        {!status.keysConfigured && <p className="mt-3 text-sm text-gold">Strike API keys are not set on Railway yet, so only Paper is available.</p>}
        <button disabled={busy || status.copies === 0 && status.mode === "paper"} onClick={() => void askConfirm({ title: "Stop every bot copy?", body: "Every copy the bot opened closes, and the bot goes back to Paper.", confirmLabel: "Stop all copies", danger: true }).then((ok) => void (ok && call({ action: "kill" })))}
          className="mt-4 w-full rounded-2xl bg-neg/90 py-3 font-semibold text-white transition hover:bg-neg disabled:opacity-40">
          Kill switch: stop all bot copies
        </button>
      </div>

      <div className="card rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-semibold">Bold slot (experiment)</p>
            <p className="mt-1 text-xs text-muted">
              {status.bold?.enabled
                ? `ON: one copy goes to a higher-return, higher-risk trader with a 10% stop-loss. It replaces a copy that holds no trades.${status.bold.copy ? ` Copying ${status.bold.copy.slice(0, 6)}…${status.bold.copy.slice(-4)}.` : " No trader qualifies yet."}`
                : "OFF: every copy follows the normal rules."}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={!!status.bold?.enabled}
            disabled={busy}
            onClick={async () => {
              const on = !status.bold?.enabled;
              if (on && !(await askConfirm({ title: "Turn on the bold slot?", body: "One real copy goes to a riskier trader, with a 10% stop-loss.", confirmLabel: "Turn on" }))) return;
              call({ action: "bold", enabled: on });
            }}
            className={`relative h-8 w-14 shrink-0 rounded-full transition disabled:opacity-50 ${status.bold?.enabled ? "bg-gold" : "bg-white/15"}`}
          >
            <span className={`absolute top-1 size-6 rounded-full bg-white shadow transition-all ${status.bold?.enabled ? "left-7" : "left-1"}`} />
          </button>
        </div>
      </div>

      <div className="card rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-semibold">Profit lock (bold slot)</p>
            <p className="mt-1 text-xs text-muted">
              {status.lock?.enabled
                ? `ON: when the bold copy is up +${Math.round(status.lock.pct * 100)}%, it's closed to bank the profit and the trader is copied again.`
                : "OFF: the bold copy runs until the bot's normal rules close it."}
              {status.lock ? ` Banked so far: $${status.lock.banked.toFixed(2)} (${status.lock.events.length}×).` : ""}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={!!status.lock?.enabled}
            disabled={busy}
            onClick={async () => {
              const on = !status.lock?.enabled;
              if (on && !(await askConfirm({ title: "Turn on the profit lock?", body: `The bold copy closes at +${Math.round((status.lock?.pct ?? 0.15) * 100)}% to bank the profit, then copies the trader again.`, confirmLabel: "Turn on" }))) return;
              call({ action: "lock", enabled: on });
            }}
            className={`relative h-8 w-14 shrink-0 rounded-full transition disabled:opacity-50 ${status.lock?.enabled ? "bg-mint" : "bg-white/15"}`}
          >
            <span className={`absolute top-1 size-6 rounded-full bg-white shadow transition-all ${status.lock?.enabled ? "left-7" : "left-1"}`} />
          </button>
        </div>
      </div>

      <div className="card rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-semibold">Holder demo (Try the bot)</p>
            <p className="mt-1 text-xs text-muted">
              {status.demo?.enabled ? "ON: the tab is public and 1M+ holders can start a $10,000 demo." : "OFF: hidden from the public. You can still preview it at /app/try in this browser."}
              {status.demo ? ` ${status.demo.accounts} demo account${status.demo.accounts === 1 ? "" : "s"}.` : ""}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={!!status.demo?.enabled}
            disabled={busy}
            onClick={async () => {
              const on = !status.demo?.enabled;
              if (on && !(await askConfirm({ title: "Open the holder demo to the public?", confirmLabel: "Open it" }))) return;
              call({ action: "demo", enabled: on });
            }}
            className={`relative h-8 w-14 shrink-0 rounded-full transition disabled:opacity-50 ${status.demo?.enabled ? "bg-mint" : "bg-white/15"}`}
          >
            <span className={`absolute top-1 size-6 rounded-full bg-white shadow transition-all ${status.demo?.enabled ? "left-7" : "left-1"}`} />
          </button>
        </div>
        <a href="/app/try" className="mt-3 inline-block text-sm text-mint hover:underline">Open the demo page →</a>
      </div>

      <div className="card rounded-3xl p-6">
        <p className="text-sm text-muted">Budget (total across all copies, max ${status.maxBudgetUsd ?? "—"})</p>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); call({ action: "budget", budgetUsd: Number(budget) }); }}>
          <input inputMode="decimal" placeholder={`$${status.budgetUsd}`} value={budget} onChange={(e) => setBudget(e.target.value)}
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.06] px-5 py-3 font-mono text-sm outline-none focus:border-mint/50" />
          <button disabled={busy || !budget} className="rounded-full bg-mint px-6 py-3 font-semibold text-ink disabled:opacity-50">Set</button>
        </form>
        <p className="mt-2 text-xs text-muted">Split evenly between the bot&apos;s best picks, at least $100 each (smaller copies miss most trades): $100 copies 1 trader, $500 copies 5. Changes apply to new copies.</p>
      </div>

      <div className="card rounded-3xl p-6">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div><p className="text-muted">Bot copies</p><p className="mt-1 font-mono text-xl">{status.copies}</p></div>
          <div><p className="text-muted">Allocated</p><p className="mt-1 font-mono text-xl">${(status.account?.allocated ?? 0).toFixed(2)}</p></div>
          <div><p className="text-muted">PnL</p><p className={`mt-1 font-mono text-xl ${(status.account?.pnl ?? 0) >= 0 ? "text-mint" : "text-neg"}`}>${(status.account?.pnl ?? 0).toFixed(2)}</p></div>
        </div>
        <p className="mt-3 text-xs text-muted">Last sync {when(status.lastSyncAt)}</p>
        {status.lastError && <p className="mt-2 text-sm text-neg">{status.lastError}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => call({ action: "sync" })} className="glass rounded-full px-4 py-2 text-sm">Refresh</button>
          <button disabled={busy} onClick={() => call({ action: "review" })} className="glass rounded-full px-4 py-2 text-sm">Run review now</button>
        </div>
        <ul className="mt-4 max-h-72 space-y-1.5 overflow-auto font-mono text-xs">
          {status.log.map((l, i) => (
            <li key={i} className="text-soft"><span className="text-white/35">{new Date(l.at).toLocaleTimeString()}</span> {l.text}</li>
          ))}
        </ul>
      </div>
      {error && <p className="text-sm text-neg">{error}</p>}
      <ConfirmHost />
    </div>
  );
}
