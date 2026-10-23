"use client";

// Deposit with any Cardano token: pick one from the wallet, SteelSwap swaps it to ADA in the wallet (one signature, their
// fee included), Bolt watches for the ADA to land, then it goes to Strike as a normal ADA deposit (the second signature).
import { useEffect, useState } from "react";
import type { SwapQuote, WalletToken } from "@/lib/autopilotApi";
import { signSubmitTx, walletBalance, walletUtxos } from "@/lib/wallet";

export type SwapApi = {
  tokens: (units: string[]) => Promise<WalletToken[]>;
  quote: (unit: string, amount: string) => Promise<SwapQuote>;
  build: (unit: string, amount: string, utxos: string[], expectedLovelace: number) => Promise<{ txCbor: string; txHash: string }>;
  notify: (txHash: string, txCbor: string) => Promise<unknown>;
};

type Held = WalletToken & { qty: bigint; valueAda: number | null };
type Phase = { kind: "pick" } | { kind: "sign" } | { kind: "waiting"; hash: string; expected: number; before: number; since: number } | { kind: "arrived"; ada: number; hash: string };

const ada = (lovelace: number) => (lovelace / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtQty = (q: bigint, d: number) => (Number(q) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: Math.min(d, 4) });
/** "12.5" in a token with `d` decimals → its smallest units, as a string (no float rounding). */
function toUnits(text: string, d: number): string | null {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const units = BigInt((m[1] || "0") + (m[2] ?? "").slice(0, d).padEnd(d, "0"));
  return units > 0n ? units.toString() : null;
}

export function TokenDeposit({ walletKey, api, onAdaReady }: { walletKey: string | null; api: SwapApi; onAdaReady: (ada: number) => void }) {
  const [list, setList] = useState<Held[] | null>(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState<Held | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<{ key: string; q: SwapQuote } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });

  // What the wallet holds, with names and ADA value (tokens worth under ₳5 are left out: fees would eat them).
  useEffect(() => {
    if (!walletKey) return;
    let alive = true;
    (async () => {
      const bal = await walletBalance(walletKey);
      const held = [...bal.assets.entries()].filter(([, q]) => q > 0n);
      if (!held.length) return alive && setList([]);
      const info = await api.tokens(held.map(([u]) => u));
      const byUnit = new Map(info.map((t) => [t.unit, t]));
      const rows: Held[] = held.flatMap(([unit, qty]) => {
        const t = byUnit.get(unit);
        if (!t) return [];
        const valueAda = t.priceAda !== null ? (Number(qty) / 10 ** t.decimals) * t.priceAda : null;
        return [{ ...t, qty, valueAda }];
      });
      if (alive) setList(rows.filter((r) => (r.valueAda ?? 0) >= 5).sort((a, b) => (b.valueAda ?? 0) - (a.valueAda ?? 0)));
    })().catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : "Couldn't read your wallet's tokens."));
    return () => {
      alive = false;
    };
  }, [walletKey, api]);

  // While the swap fills (DEX orders take a block or a few), watch the wallet for the ADA.
  useEffect(() => {
    if (phase.kind !== "waiting" || !walletKey) return;
    const t = setInterval(() => {
      walletBalance(walletKey).then(
        (b) => {
          const now = Number(b.lovelace);
          if (now >= phase.before + phase.expected * 0.7) setPhase({ kind: "arrived", ada: Math.max(0, Math.floor((now - phase.before) / 1e6)), hash: phase.hash });
        },
        () => {},
      );
    }, 15_000);
    return () => clearInterval(t);
  }, [phase, walletKey]);

  const units = pick ? toUnits(amount, pick.decimals) : null;
  const tooMuch = !!pick && !!units && BigInt(units) > pick.qty;
  const qKey = pick && units ? `${pick.unit}:${units}` : "";
  const q = quote && quote.key === qKey ? quote.q : null;

  async function getQuote() {
    if (!pick || !units || tooMuch) return;
    setErr("");
    setQuoting(true);
    try {
      setQuote({ key: `${pick.unit}:${units}`, q: await api.quote(pick.unit, units) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No route for this token right now.");
    } finally {
      setQuoting(false);
    }
  }

  async function swap() {
    if (!walletKey || !pick || !units || !q) return;
    setErr("");
    setPhase({ kind: "sign" });
    try {
      const before = Number((await walletBalance(walletKey)).lovelace);
      const built = await api.build(pick.unit, units, await walletUtxos(walletKey), q.outputLovelace);
      const { hash, tx } = await signSubmitTx(walletKey, built.txCbor);
      void api.notify(hash, tx).catch(() => {});
      setPhase({ kind: "waiting", hash, expected: q.outputLovelace, before, since: Date.now() });
    } catch (e) {
      setPhase({ kind: "pick" });
      setErr(e instanceof Error ? (/declin|reject|cancel/i.test(e.message) ? "You cancelled the swap in your wallet." : e.message) : "The swap didn't go through.");
    }
  }

  if (phase.kind === "waiting" || phase.kind === "arrived")
    return (
      <div className="mt-5 text-center">
        <span className={`mx-auto grid size-14 place-items-center rounded-full text-2xl ${phase.kind === "arrived" ? "bg-mint text-ink" : "border-2 border-mint/30 border-t-mint animate-spin"}`}>{phase.kind === "arrived" ? "✓" : ""}</span>
        <h3 className="mt-4 font-display text-xl font-semibold">{phase.kind === "arrived" ? `₳${phase.ada} arrived in your wallet` : "Swapping to ADA…"}</h3>
        <p className="mt-2 text-sm text-soft">
          {phase.kind === "arrived"
            ? "Now send it to your Strike account: one more signature."
            : `The DEX fills your order in a block or a few (usually 1 to 5 minutes). About ₳${ada(phase.expected)} is on its way to your wallet; this updates by itself.`}
        </p>
        <a href={`https://cardanoscan.io/transaction/${phase.hash}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-muted hover:text-white">
          View the swap on Cardanoscan ↗
        </a>
        {phase.kind === "arrived" && (
          <button onClick={() => onAdaReady(Math.max(5, phase.ada - 3))} className="mt-5 w-full rounded-full bg-mint py-3 font-semibold text-ink transition hover:bg-mint-2">
            Deposit ₳{Math.max(5, phase.ada - 3)} to Strike
          </button>
        )}
      </div>
    );

  return (
    <div className="mt-4">
      {!list && !err && <div className="h-32 animate-pulse rounded-2xl bg-white/[0.04]" />}
      {list && !list.length && <p className="rounded-2xl bg-white/[0.03] px-4 py-4 text-sm text-muted">No tokens worth ₳5 or more in this wallet. Deposit ADA instead.</p>}
      {list && list.length > 0 && (
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {list.map((t) => (
            <li key={t.unit}>
              <button
                onClick={() => (setPick(t), setAmount(""), setQuote(null))}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${pick?.unit === t.unit ? "bg-mint/10 ring-1 ring-mint/40" : "hover:bg-white/[0.05]"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.logoUrl ? <img src={t.logoUrl} alt="" className="size-7 rounded-full bg-white/10" /> : <span className="size-7 rounded-full bg-white/10" />}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{t.ticker ?? t.name ?? "Token"}</span>
                  <span className="block font-mono text-[11px] text-muted">{fmtQty(t.qty, t.decimals)}</span>
                </span>
                <span className="font-mono text-xs text-soft">{t.valueAda !== null ? `≈ ₳${t.valueAda.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {pick && (
        <>
          <label className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 focus-within:border-mint/50">
            <input
              inputMode="decimal"
              value={amount}
              placeholder={`Amount of ${pick.ticker ?? "the token"}`}
              onChange={(e) => (setAmount(e.target.value), setQuote(null))}
              onBlur={() => void getQuote()}
              className="w-full bg-transparent font-mono text-lg outline-none placeholder:text-white/30"
            />
            <button onClick={() => (setAmount((Number(pick.qty) / 10 ** pick.decimals).toString()), setQuote(null))} className="rounded-full bg-white/10 px-2.5 py-1 text-xs">
              Max
            </button>
          </label>
          {tooMuch && <p className="mt-2 text-xs text-neg">More than your wallet has.</p>}
          {q ? (
            <div className="mt-3 rounded-2xl bg-white/[0.03] px-4 py-3 text-sm">
              <p className="flex justify-between">
                <span className="text-soft">You get about</span>
                <span className="font-mono text-mint">₳{ada(q.outputLovelace)}</span>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                Through {q.venue}. SteelSwap fee ₳{ada(q.serviceLovelace)} · DEX batcher ₳{ada(q.batcherLovelace)} · ₳{ada(q.depositLovelace)} order deposit that comes back · at most 1% price slippage.
              </p>
            </div>
          ) : (
            units &&
            !tooMuch && (
              <button onClick={() => void getQuote()} disabled={quoting} className="mt-3 text-xs font-semibold text-mint hover:underline disabled:opacity-50">
                {quoting ? "Getting the best price…" : "See how much ADA you get"}
              </button>
            )
          )}
        </>
      )}

      {err && <p className="mt-3 rounded-xl bg-neg/10 px-3 py-2 text-sm text-neg">{err}</p>}
      <button
        disabled={!q || phase.kind === "sign" || tooMuch}
        onClick={() => void swap()}
        className="mt-5 w-full rounded-full bg-mint py-3 font-semibold text-ink transition hover:bg-mint-2 disabled:opacity-50"
      >
        {phase.kind === "sign" ? "Check your wallet…" : q ? `Swap to ₳${ada(q.outputLovelace)}` : "Swap to ADA"}
      </button>
      <p className="mt-3 text-center text-[11px] text-white/40">Step 1 of 2: swap to ADA in your wallet (SteelSwap). Step 2: deposit the ADA to Strike.</p>
    </div>
  );
}
