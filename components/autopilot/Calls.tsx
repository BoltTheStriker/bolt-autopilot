"use client";

// Bolt Calls: the social layer on Strike. Traders post a call (market, long or short, leverage, take-profit, stop-loss, why);
// Strike's live mark prices keep score, close calls at their levels and build each caller's record. "Tail" copies a call onto
// your own Strike account as one bracket order (admins only while it's tested with real money).
import { useCallback, useEffect, useMemo, useState } from "react";
import { calls, savedSession, type BoltCall, type CallLeader, type Session } from "@/lib/autopilotApi";
import { readAdminKey } from "@/lib/adminPreview";

const pct = (r: number | null | undefined, d = 1) => (r === null || r === undefined ? "—" : `${r >= 0 ? "+" : "−"}${Math.abs(r * 100).toFixed(d)}%`);
const price = (p: number | null | undefined) => (p ? p.toLocaleString("en-US", { maximumSignificantDigits: 6 }) : "—");
const ago = (at: number, now: number) => {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const STATUS: Record<BoltCall["status"], string> = { open: "Live", tp: "Hit take-profit", sl: "Hit stop-loss", closed: "Closed" };

export function CallsPage() {
  const [feed, setFeed] = useState<{ at: number; marks: Record<string, number>; calls: BoltCall[]; leaders: CallLeader[] } | null>(null);
  const [session] = useState<Session | null>(() => savedSession());
  const [adminKey] = useState(() => readAdminKey());
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");

  const load = useCallback(() => calls.feed().then(setFeed, () => setErr("Couldn't load the calls. Retrying…")), []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (session) calls.mine(session).then((r) => setMine(new Set(r.ids)), () => {});
  }, [session]);

  const markets = useMemo(() => Object.keys(feed?.marks ?? {}).sort((a, b) => (a === "BTC-USD" ? -1 : b === "BTC-USD" ? 1 : a.localeCompare(b))), [feed]);

  return (
    <main className="mx-auto max-w-6xl px-4 pt-28 pb-20 sm:px-6">
      <p className="font-mono text-xs tracking-[0.3em] text-mint uppercase">Bolt Calls · beta</p>
      <h1 className="mt-3 font-display text-[clamp(2.2rem,5vw,3.4rem)] leading-[1] font-bold tracking-tight">
        Call it. <span className="text-gradient">Strike keeps score.</span>
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-soft">
        Post a trade idea on any Strike market. Its entry is Strike&apos;s live price the moment you post, it closes by itself at your take-profit or stop-loss, and every call builds a
        record anyone can check.
      </p>
      {err && <p className="mt-4 text-sm text-gold">{err}</p>}

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="min-w-0 space-y-3">
          {!feed && <div className="card h-40 animate-pulse rounded-3xl" />}
          {feed && !feed.calls.length && <div className="card rounded-3xl p-6 text-soft">No calls yet. Post the first one.</div>}
          {feed?.calls.map((c) => (
            <CallCard key={c.id} c={c} now={feed.at} mine={mine.has(c.id)} session={session} adminKey={adminKey} onChange={() => void load()} />
          ))}
        </section>

        <aside className="space-y-6">
          <PostCall session={session} markets={markets} marks={feed?.marks ?? {}} onPosted={(id) => (setMine((m) => new Set(m).add(id)), void load())} />
          <div className="card rounded-3xl p-5">
            <p className="font-display text-lg font-semibold">Top callers</p>
            <p className="mt-1 text-xs text-muted">Average result over closed calls, 3 or more each.</p>
            <div className="mt-3 space-y-2">
              {(feed?.leaders ?? []).map((l, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-soft">
                    {i + 1}. {l.name}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {l.wins}/{l.closed} won · <span className={(l.avgReturn ?? 0) >= 0 ? "text-mint" : "text-neg"}>{pct(l.avgReturn)}</span>
                  </span>
                </div>
              ))}
              {feed && !feed.leaders.length && <p className="text-sm text-muted">The board fills as calls close.</p>}
            </div>
          </div>
        </aside>
      </div>
      <p className="mt-12 text-xs text-white/40">Calls are ideas, not advice. Results are on Strike&apos;s mark prices at the call&apos;s leverage, before fees and funding. Copy trading and leverage can lose money.</p>
    </main>
  );
}

function CallCard({ c, now, mine, session, adminKey, onChange }: { c: BoltCall; now: number; mine: boolean; session: Session | null; adminKey: string; onChange: () => void }) {
  const [tailOpen, setTailOpen] = useState(false);
  const [usd, setUsd] = useState("20");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const up = (c.ret ?? 0) >= 0;
  const open = c.status === "open";

  async function close() {
    if (!session) return;
    setBusy(true);
    try {
      await calls.close(session, c.id);
      onChange();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't close it.");
    } finally {
      setBusy(false);
    }
  }
  async function tail() {
    if (!session) return;
    setBusy(true);
    setNote("");
    try {
      const r = await calls.tail(session, c.id, Number(usd), adminKey);
      setNote(`Done: ${r.size} ${c.symbol.replace("-USD", "")} (about $${r.notional.toFixed(0)} of position) on your Strike account.`);
      setTailOpen(false);
      onChange();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Strike didn't take the order.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card rounded-3xl p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-soft">{c.name}</span>
        <span className="text-muted">· {ago(c.at, now)}</span>
        <span className={`ml-auto rounded-full px-2.5 py-1 font-semibold ${open ? "bg-mint/15 text-mint" : c.status === "tp" ? "bg-mint text-ink" : c.status === "sl" ? "bg-neg/20 text-neg" : "bg-white/10 text-soft"}`}>{STATUS[c.status]}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-display text-2xl font-bold">{c.symbol.replace("-USD", "")}</span>
        <span className={`rounded-md px-2 py-0.5 text-sm font-bold ${c.side === "long" ? "bg-mint/15 text-mint" : "bg-neg/15 text-neg"}`}>
          {c.side.toUpperCase()} {c.leverage}x
        </span>
        <span className={`ml-auto font-display text-3xl font-bold ${up ? "text-mint" : "text-neg"}`}>{pct(c.ret)}</span>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed text-white/90">{c.thesis}</p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-muted">
        <span>Entry {price(c.entry)}</span>
        <span>{open ? `Now ${price(c.mark)}` : `Exit ${price(c.exit)}`}</span>
        {c.tp && <span className="text-mint/80">TP {price(c.tp)}</span>}
        {c.sl && <span className="text-neg/80">SL {price(c.sl)}</span>}
        {c.tails > 0 && <span>{c.tails} tailed</span>}
      </div>
      {open && (mine || (adminKey && session)) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {adminKey && session && !tailOpen && (
            <button onClick={() => setTailOpen(true)} className="rounded-full bg-mint px-4 py-2 text-sm font-semibold text-ink hover:bg-mint-2">
              Tail this call
            </button>
          )}
          {tailOpen && (
            <span className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 font-mono text-sm">
                $<input id={`tail-${c.id}`} value={usd} onChange={(e) => setUsd(e.target.value)} inputMode="decimal" className="w-16 bg-transparent outline-none" aria-label="Margin in dollars" />
              </label>
              <span className="text-xs text-muted">margin · {c.leverage}x · same TP/SL</span>
              <button disabled={busy} onClick={() => void tail()} className="rounded-full bg-mint px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">
                {busy ? "Placing…" : "Place on Strike"}
              </button>
              <button onClick={() => setTailOpen(false)} className="text-sm text-muted hover:text-white">
                Cancel
              </button>
            </span>
          )}
          {mine && (
            <button disabled={busy} onClick={() => void close()} className="rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-50">
              Close my call
            </button>
          )}
        </div>
      )}
      {note && <p className="mt-3 text-sm text-soft">{note}</p>}
    </article>
  );
}

function PostCall({ session, markets, marks, onPosted }: { session: Session | null; markets: string[]; marks: Record<string, number>; onPosted: (id: string) => void }) {
  const [symbol, setSymbol] = useState("BTC-USD");
  const [side, setSide] = useState<"long" | "short">("long");
  const [leverage, setLeverage] = useState(5);
  const [tp, setTp] = useState("10");
  const [sl, setSl] = useState("5");
  const [thesis, setThesis] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!session)
    return (
      <div className="card rounded-3xl p-5">
        <p className="font-display text-lg font-semibold">Post a call</p>
        <p className="mt-2 text-sm text-soft">Connect your wallet in Autopilot first: calls are signed by your Bolt account, so your record is yours.</p>
        <a href="/app" className="mt-4 inline-flex rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-ink">
          Connect in Autopilot →
        </a>
      </div>
    );

  async function post() {
    setBusy(true);
    setErr("");
    try {
      const r = await calls.post(session!, { symbol, side, leverage, tpPct: tp ? Number(tp) / 100 : null, slPct: sl ? Number(sl) / 100 : null, thesis });
      setThesis("");
      onPosted(r.call.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't post it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4 rounded-3xl p-5">
      <p className="font-display text-lg font-semibold">Post a call</p>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <select id="call-market" value={symbol} onChange={(e) => setSymbol(e.target.value)} className="rounded-xl border border-white/10 bg-ink/60 px-3 py-2 text-sm" aria-label="Market">
          {markets.map((m) => (
            <option key={m} value={m}>
              {m.replace("-USD", "")} · {price(marks[m])}
            </option>
          ))}
        </select>
        <div className="inline-flex rounded-xl bg-white/[0.05] p-1 text-sm">
          {(["long", "short"] as const).map((s) => (
            <button key={s} onClick={() => setSide(s)} className={`rounded-lg px-3 py-1 font-semibold ${side === s ? (s === "long" ? "bg-mint text-ink" : "bg-neg text-white") : "text-soft"}`}>
              {s === "long" ? "Long" : "Short"}
            </button>
          ))}
        </div>
      </div>
      <label className="block text-sm">
        <span className="flex justify-between text-soft">
          Leverage <span className="font-mono text-white">{leverage}x</span>
        </span>
        <input id="call-leverage" type="range" min={1} max={20} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} className="mt-2 w-full accent-[#4efab0]" />
      </label>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="rounded-xl border border-white/10 px-3 py-2">
          <span className="block text-xs text-muted">Take-profit, % move</span>
          <input id="call-tp" value={tp} onChange={(e) => setTp(e.target.value)} inputMode="decimal" placeholder="none" className="w-full bg-transparent font-mono outline-none" />
        </label>
        <label className="rounded-xl border border-white/10 px-3 py-2">
          <span className="block text-xs text-muted">Stop-loss, % move</span>
          <input id="call-sl" value={sl} onChange={(e) => setSl(e.target.value)} inputMode="decimal" placeholder="none" className="w-full bg-transparent font-mono outline-none" />
        </label>
      </div>
      <label className="block">
        <textarea id="call-thesis" value={thesis} onChange={(e) => setThesis(e.target.value.slice(0, 280))} rows={3} placeholder="Why? One or two sentences people can judge." className="w-full rounded-xl border border-white/10 bg-ink/60 px-3 py-2 text-sm outline-none focus:border-mint/50" />
        <span className="block text-right font-mono text-[11px] text-muted">{thesis.length}/280</span>
      </label>
      {err && <p className="text-sm text-neg">{err}</p>}
      <button disabled={busy || thesis.trim().length < 10} onClick={() => void post()} className="w-full rounded-full bg-mint py-3 font-semibold text-ink hover:bg-mint-2 disabled:opacity-50">
        {busy ? "Posting…" : `Post: ${side} ${symbol.replace("-USD", "")} ${leverage}x at ${price(marks[symbol])}`}
      </button>
      <p className="text-[11px] text-white/40">Entry is Strike&apos;s mark price when you post. Up to 3 open calls.</p>
    </div>
  );
}
