"use client";

// Bolt Autopilot, the app (/autopilot/app): setup in four steps, then the dashboard, with the copilot
// docked beside it. Runs on a real Strike account, or as a demo with pretend money.
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { checkAdminKey, readAdminKey } from "@/lib/adminPreview";
import { autopilot, saveSession, savedSession, type AutoMe, type AutoMode, type AutoStatus, type Session, type SlpInfo } from "@/lib/autopilotApi";
import { DEMO_BALANCE, demoCopies, demoValue, startDemo as startLiveDemo, stepDemo, type DemoLive } from "@/lib/autopilotDemo";
import { connectAddress, installedWallets, signAndSubmit, signText, walletBalance, walletUtxos, type InstalledWallet } from "@/lib/wallet";
import { defaultRules, describeRules, MIN_COPY_USD, RISK_LEVELS, type AutoRules, type LiveMark } from "@/worker/autopilot";
import { CopilotPanel } from "./Copilot";
import { SUSDRF_UNIT, type RealFiActions } from "./RealFi";
import { DepositModal } from "./Deposit";
import { StrikeMark } from "./strike";
import { WithdrawModal } from "./Withdraw";
import { Activity, Allocation, EarnPanel, StatusCard, TabBar, TradersList, Transfers, type BotView, type Tab } from "./dashboard";
import { ConnectCard, DepositPending, FundCard, GoLiveCard, I, RulesCard, STEPS, TOUR } from "./steps";
import { Stepper, Tour, tourSeen } from "./ui";

const DEMO_KEY = "bolt-autopilot-demo"; // per-viewer convenience: the demo's rules and state
const VIEW_KEY = "bolt-autopilot-view"; // which side this viewer last used: "demo" or "real"
const lastView = () => {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
};
const rememberView = (v: "demo" | "real") => {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {}
};

type Demo = { rules: AutoRules | null; mode: AutoMode; live: DemoLive | null };
const NO_DEMO: Demo = { rules: null, mode: "off", live: null };
function loadDemo(): Demo {
  try {
    const d = JSON.parse(localStorage.getItem(DEMO_KEY) ?? "null");
    if (!d || typeof d !== "object") return NO_DEMO;
    const live = d.live && Array.isArray(d.live.copies) ? (d.live as DemoLive) : null;
    return { rules: d.rules ?? null, mode: live && (d.mode === "on" || d.mode === "autopilot") ? d.mode : "off", live };
  } catch {
    return NO_DEMO;
  }
}
function saveDemo(d: Demo | null) {
  try {
    if (d) localStorage.setItem(DEMO_KEY, JSON.stringify(d));
    else localStorage.removeItem(DEMO_KEY);
  } catch {}
}

/** Default rules for a budget, with no more traders than the budget can give $50+ copies. */
function fittingDefaults(budget: number): AutoRules {
  const r = defaultRules(budget);
  const fit = Math.floor((budget * RISK_LEVELS[r.risk].deploy) / MIN_COPY_USD);
  return { ...r, traders: Math.max(1, Math.min(r.traders, fit)) };
}

export function AutopilotApp() {
  const [status, setStatus] = useState<AutoStatus | null>(null);
  const [slp, setSlp] = useState<SlpInfo | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<AutoMe | null>(null);
  const [wallets, setWallets] = useState<InstalledWallet[]>([]);
  const [walletKey, setWalletKey] = useState<string | null>(null);
  const [skipFund, setSkipFund] = useState(false);
  const [demoOn, setDemoOn] = useState(false);
  const [demo, setDemo] = useState<Demo>(NO_DEMO);
  const [marks, setMarks] = useState<Record<string, LiveMark>>({});
  const [draft, setDraft] = useState<AutoRules | null>(null);
  const [draftKey, setDraftKey] = useState(0); // remounts the rules form when the copilot changes the draft
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [tour, setTour] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  // The deposit this browser just sent (until Strike credits it), so the page can say it's on its way.
  const [sentDeposit, setSentDeposit] = useState<{ amount: number; asset: string; txHash: string; at: number; before: number } | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  // Real accounts: open to everyone, or (private beta) to a verified admin once the builder code is set.
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    checkAdminKey().then(setAdmin);
  }, []);
  const closed = status !== null && !status.open && !(status.ready && admin);
  const [hasSavedDemo, setHasSavedDemo] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHasSavedDemo(!!loadDemo().live), 0);
    return () => clearTimeout(t);
  }, [demoOn]);

  const refresh = useCallback(async (s: Session | null) => {
    if (!s) return;
    try {
      setMe(await autopilot.me(s));
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        saveSession(null);
        setSession(null);
        setMe(null);
      }
    }
  }, []);

  useEffect(() => {
    let alive = true;
    autopilot.status().then((s) => alive && setStatus(s), () => alive && setStatus({ open: false, network: "testnet", maxBudgetUsd: 500, traders: 0 }));
    autopilot.earn().then((r) => alive && setSlp(r.slp), () => {});
    const t = setTimeout(() => {
      if (!alive) return;
      setWallets(installedWallets()); // wallet extensions inject a moment after load
      const s = savedSession();
      if (s) {
        setSession(s);
        if (s.wallet && installedWallets().some((w) => w.key === s.wallet)) setWalletKey(s.wallet);
        void refresh(s);
      } else if (new URLSearchParams(window.location.search).has("demo") || (loadDemo().rules && lastView() !== "real")) {
        setDemoOn(true);
        setDemo(loadDemo());
      }
    }, 300);
    // First visit: the tour starts once the screen has settled (session or demo loaded, animations done).
    const tt = setTimeout(() => alive && !tourSeen() && setTour(true), 1400);
    return () => {
      alive = false;
      clearTimeout(t);
      clearTimeout(tt);
    };
  }, [refresh]);

  // A running demo moves with the traders' live marks (the worker refreshes them every minute).
  const demoRunning = demoOn && demo.mode !== "off" && !!demo.live && !!demo.rules;
  useEffect(() => {
    if (!demoRunning) return;
    let alive = true;
    const tick = () =>
      autopilot.marks().then(
        (r) => {
          if (!alive) return;
          setMarks(r.marks);
          setDemo((d) => {
            if (!d.live || !d.rules) return d;
            const next = { ...d, live: stepDemo(d.live, r.marks, d.rules, Date.now()) };
            saveDemo(next);
            return next;
          });
        },
        () => {},
      );
    void tick();
    const id = setInterval(tick, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [demoRunning]);

  // Keep a running bot's numbers fresh, and check often while a deposit is on its way.
  const waitingDeposit = !!sentDeposit;
  useEffect(() => {
    if (!session || (me?.user.mode === "off" && !waitingDeposit)) return;
    const id = setInterval(() => void refresh(session), waitingDeposit ? 15_000 : 30_000);
    return () => clearInterval(id);
  }, [session, me?.user.mode, waitingDeposit, refresh]);
  useEffect(() => {
    if (!sentDeposit) return;
    // Credited (the balance went up): back to the normal flow. Not credited after 30 minutes: stop waiting (Strike's list still shows it).
    const credited = (me?.balance?.wallet ?? 0) >= Math.max(5, sentDeposit.before + 1);
    const t = setTimeout(() => setSentDeposit(null), credited ? 0 : Math.max(0, sentDeposit.at + 30 * 60_000 - Date.now()));
    return () => clearTimeout(t);
  }, [sentDeposit, me?.balance?.wallet]);

  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await f();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { info?: string })?.info ?? e);
      setError(/declin|reject|cancel/i.test(msg) ? "Cancelled in your wallet." : msg);
    } finally {
      setBusy("");
    }
  };

  async function connect(key: string) {
    await run("connect", async () => {
      const address = await connectAddress(key);
      const { nonce, message } = await autopilot.connectStart(address, readAdminKey() || undefined);
      const sig = await signText(key, message);
      if (sig.address !== address) throw new Error("Sign with the same wallet you connected.");
      const r = await autopilot.connectFinish(nonce, sig.signature, sig.key);
      const s = { address, token: r.token, wallet: key };
      saveSession(s);
      setSession(s);
      setWalletKey(key);
      setDemoOn(false);
      await refresh(s);
    });
  }

  const setDemoState = (d: Demo) => {
    setDemo(d);
    saveDemo(d);
  };
  // Switching sides keeps the demo saved: you can go back to it any time.
  const startDemo = () => {
    rememberView("demo");
    setDemoOn(true);
    setDemo(loadDemo());
    setTab("overview");
  };
  const goReal = () => {
    rememberView("real");
    setDemoOn(false);
    setTab("overview");
  };
  const leaveDemo = () => {
    saveDemo(null);
    setDemoOn(false);
    setDemo(NO_DEMO);
    setTab("overview");
  };
  /** Start (or restart) the live demo: the engine's current picks for these rules, from now. */
  async function runDemo(rules: AutoRules, mode: AutoMode, note?: string) {
    await run("mode", async () => {
      const [p, m] = await Promise.all([autopilot.preview(), autopilot.marks()]);
      const live = startLiveDemo(p.traders, m.marks, rules, Date.now());
      if (!live.copies.length) {
        // Say what's actually in the way: no live data yet, or no trader fits these rules right now.
        const withData = p.traders.filter((t) => (m.marks[t.lead]?.acct ?? 0) > 0).length;
        if (!withData) throw new Error("The live trader data is still warming up. Try again in a minute.");
        const perCopy = (rules.budgetUsd * RISK_LEVELS[rules.risk].deploy) / Math.max(1, rules.traders);
        const hints = [
          rules.markets !== "all" && `choose "Everything" for markets (${rules.markets === "realworld" ? "few top traders trade mostly stocks and gold right now" : "most top traders mix crypto with other markets"})`,
          perCopy < MIN_COPY_USD && `put at least $${MIN_COPY_USD} in each copy (now $${perCopy.toFixed(0)}): raise the budget or copy fewer traders`,
        ].filter(Boolean);
        throw new Error(`No trader fits these rules right now (${withData} ranked at the moment). ${hints.length ? `Try to ${hints.join(", or ")}.` : "Try other rules, or again a bit later."}`);
      }
      if (note) live.log.unshift({ at: Date.now(), text: note });
      setMarks(m.marks);
      setDemoState({ rules, mode, live });
      setTab("overview");
    });
  }

  const balance = demoOn ? DEMO_BALANCE : (me?.balance?.wallet ?? 0);
  // A deposit Strike hasn't credited yet: one it lists as pending, or the one we just sent (for up to 30 min).
  const strikePending = me?.transfers?.find((t) => t.type === "deposit" && t.status === "pending");
  const pendingDeposit = strikePending
    ? { amount: strikePending.assetAmount / 1e6 || strikePending.usd, asset: strikePending.asset || "ADA", txHash: strikePending.txHash }
    : sentDeposit
      ? { amount: sentDeposit.amount, asset: sentDeposit.asset, txHash: sentDeposit.txHash }
      : null;
  const user = me?.user;
  const savedRules = demoOn ? demo.rules : (user?.rules ?? null);
  // Once the bot has run, stopping it keeps the dashboard (money, history, Start); "Go live" is only for the first start.
  const hasStarted = !!user && (user.log.some((l) => /^(Bot switched on|Autopilot on)/.test(l.text)) || user.copies.length > 0 || (me?.parked ?? 0) > 0);
  const step = demoOn
    ? !demo.rules
      ? 2
      : !demo.live
        ? 3
        : 4
    : !user
      ? 0
      : balance < 5 && !skipFund && !hasStarted
        ? 1
        : !user.rules
          ? 2
          : user.mode === "off" && !hasStarted
            ? 3
            : 4;
  const maxBudget = demoOn ? DEMO_BALANCE : Math.max(50, Math.min(status?.maxBudgetUsd ?? 500, balance || status?.maxBudgetUsd || 500));

  const view: BotView | null = useMemo(() => {
    if (demoOn) {
      if (!demo.rules || !demo.live) return null;
      const sl = demo.rules.stopLossPct;
      const copies = demoCopies(demo.live, marks, sl);
      return {
        demo: true,
        mode: demo.mode,
        balance: demoValue(demo.live, sl),
        copies,
        log: demo.live.log,
        rulesText: describeRules(demo.rules),
        reserve: DEMO_BALANCE - copies.reduce((t, c) => t + c.amount, 0),
        earn: null,
        curve: demo.live.curve.map(([, v]) => v),
        startedAt: demo.live.startedAt,
        halted: demo.live.haltedDay !== null && demo.live.haltedDay === demo.live.dayStart,
      };
    }
    if (!me) return null;
    return {
      demo: false,
      mode: me.user.mode,
      address: me.user.address,
      accountId: me.user.accountId,
      // Everything the user owns on Strike: the main account (its balance already holds the copies that run
      // from it, plus their open profit) + first-version copies in their own sub-accounts + money parked there.
      balance: me.balance
        ? (me.balance.equity ?? me.balance.wallet) + me.user.copies.filter((c) => c.isolated).reduce((t, c) => t + c.amount + c.pnl, 0) + (me.parked ?? 0)
        : null,
      copies: me.user.copies,
      log: me.user.log,
      rulesText: me.rulesText,
      reserve: Math.max(0, me.balance?.available ?? 0), // free on the main account (not reserved by copies)
      parked: me.parked ?? 0,
      earn: me.earn ?? null,
      halted: me.user.log.some((l) => /Daily loss limit/.test(l.text) && (me.user.lastSyncAt ?? 0) - l.at < 86_400_000),
    };
  }, [demoOn, demo, marks, me]);

  async function saveRules(rules: AutoRules) {
    if (demoOn) {
      setEditing(false);
      // A running demo restarts with the new rules (new picks, fresh $1,000).
      if (demo.live && demo.mode !== "off") return runDemo(rules, demo.mode, "Rules changed: the demo restarted with fresh picks for your new rules.");
      setDemoState({ ...demo, rules });
      return;
    }
    await run("rules", async () => {
      await autopilot.rules(session!, rules);
      await refresh(session);
      setEditing(false);
    });
  }
  async function setMode(m: AutoMode) {
    if (demoOn) {
      if (m === "off") return setDemoState({ ...demo, mode: "off" });
      return runDemo(demo.rules!, m);
    }
    await run("mode", async () => {
      await autopilot.mode(session!, m);
      await refresh(session);
    });
  }
  // The copilot tweaks the form while you're editing, otherwise your saved rules.
  function applyFromCopilot(r: AutoRules) {
    if (step === 2 || editing) {
      setDraft(r);
      setDraftKey((k) => k + 1);
    } else void saveRules(r);
  }
  const onDraft = useCallback((r: AutoRules) => setDraft(r), []);
  const copilotRules = step === 2 || editing ? draft : savedRules;
  const chatOn = !!status?.copilot;
  const copilotContext = useMemo(
    () => ({ demo: demoOn, rules: copilotRules, balance: view?.balance ?? null, copies: (view?.copies ?? []).map((c) => ({ lead: c.lead, amount: c.amount, pnl: c.pnl })) }),
    [demoOn, copilotRules, view],
  );

  // The wallet this account was connected with: used for every signature (no picker). Sessions from
  // before we remembered it ask once, then keep the choice.
  const rememberWallet = (key: string) => {
    if (!session || walletKey === key) return;
    setWalletKey(key);
    const s = { ...session, wallet: key };
    setSession(s);
    saveSession(s);
  };
  const myWallets = useMemo(() => (walletKey ? wallets.filter((w) => w.key === walletKey) : wallets), [walletKey, wallets]);
  const disconnect = () => {
    saveSession(null);
    setSession(null);
    setMe(null);
    setWalletKey(null);
    setTab("overview");
  };

  /** ADA from the wallet to the Strike account (setup's Fund step and the dashboard's Deposit). True when sent. */
  async function depositAda(key: string, ada: number): Promise<boolean> {
    let ok = false;
    await run("deposit", async () => {
      const utxos = await walletUtxos(key);
      const d = await autopilot.deposit(session!, ada, utxos, "ADA");
      const hash = await signAndSubmit(key, d.unsignedTx);
      rememberWallet(key);
      setSentDeposit({ amount: ada, asset: "ADA", txHash: hash, at: Date.now(), before: me?.balance?.wallet ?? 0 });
      await autopilot.depositSubmit(session!, d.requestId, hash);
      await refresh(session);
      ok = true;
    });
    return ok;
  }

  // RealFi actions for a real, connected account (the demo shows the numbers only).
  const realfiActions: RealFiActions | null =
    !demoOn && session
      ? {
          wallets: myWallets,
          readWallet: async (key) => Number((await walletBalance(key)).assets.get(SUSDRF_UNIT) ?? 0n) / 1e6,
          deposit: (key, amount) =>
            run("deposit-susdrf", async () => {
              const utxos = await walletUtxos(key);
              const d = await autopilot.deposit(session, amount, utxos, "sUSDrf");
              const hash = await signAndSubmit(key, d.unsignedTx);
              rememberWallet(key);
              await autopilot.depositSubmit(session, d.requestId, hash);
              await refresh(session);
            }),
          withdraw: () => setWithdrawOpen(true),
          busy: busy === "deposit-susdrf",
        }
      : null;

  const network = demoOn ? "Demo" : status?.network === "mainnet" ? "Mainnet beta" : "Testnet";
  const showRules = step === 2 || editing;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-24 pb-24 sm:px-6 sm:pt-28 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6 lg:pb-12">
      <div className="min-w-0 space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-mint text-ink [&>svg]:size-5">{I.spark}</span>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">Bolt Autopilot</h1>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <a href="https://strikefinance.org" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white">
                  Built on <StrikeMark size={13} /> <span className="font-semibold text-white">Strike</span>
                </a>
                <span className="text-white/20">·</span>
                <span className={`size-1.5 rounded-full ${demoOn ? "bg-gold" : "bg-mint"}`} />
                {network}
                {status?.traders ? ` · ${status.traders} traders ranked` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!demoOn && session && <WalletChip address={session.address} wallet={wallets.find((w) => w.key === walletKey) ?? null} onDisconnect={disconnect} />}
            {demoOn ? (
              <button onClick={goReal} className="glass rounded-full px-4 py-2 text-sm text-soft hover:text-white">
                Real account
              </button>
            ) : (
              !session && (
                <button onClick={startDemo} className="glass rounded-full px-4 py-2 text-sm text-soft hover:text-white">
                  {demo.rules || hasSavedDemo ? "Back to my demo" : "Demo"}
                </button>
              )
            )}
            <button onClick={() => setTour(true)} className="glass flex items-center gap-2 rounded-full px-4 py-2 text-sm text-soft transition hover:text-white">
              {I.spark} Tour
            </button>
          </div>
        </header>

        {demoOn && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-gold/30 bg-gold/[0.07] px-4 py-3 text-sm text-gold">
            <span className="font-semibold">Demo mode.</span>
            <span className="text-gold/80">$1,000 of pretend money and the bot&apos;s real, current picks. Nothing touches a wallet.</span>
          </div>
        )}

        {step < 4 && !editing && <Stepper steps={STEPS} current={step} />}

        {error && <p className="rounded-2xl border border-neg/30 bg-neg/10 px-4 py-3 text-sm text-neg">{error}</p>}

        <AnimatePresence mode="wait">
          <motion.div key={showRules ? "rules" : step === 4 ? `dash-${tab}` : step} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="space-y-4">
            {step === 0 && <ConnectCard wallets={wallets} busy={busy === "connect"} disabled={closed} onConnect={connect} onDemo={startDemo} />}
            {step === 1 && session && pendingDeposit && <DepositPending {...pendingDeposit} onContinue={() => setSkipFund(true)} />}
            {step === 1 && session && !pendingDeposit && (
              <FundCard
                walletKey={walletKey}
                wallets={myWallets}
                busy={busy}
                onDeposit={(key, ada) => void depositAda(key, ada)}
                onSkip={() => setSkipFund(true)}
              />
            )}
            {showRules && (
              <RulesCard
                key={draftKey}
                initial={draftKey && draft ? draft : (savedRules ?? fittingDefaults(demoOn ? DEMO_BALANCE : Math.min(Math.max(balance, 100), maxBudget)))}
                maxBudget={maxBudget}
                budgetHint={demoOn ? "Out of your $1,000 demo balance" : undefined}
                busy={busy === "rules"}
                preview={!demoOn && !session}
                saveLabel={demoOn ? "Use these rules" : undefined}
                apr={slp?.apr}
                onAsk={() => setSheet(true)}
                onChange={onDraft}
                onSave={(r) => void saveRules(r)}
                onCancel={editing ? () => setEditing(false) : undefined}
              />
            )}
            {step === 3 && !editing && savedRules && (
              <GoLiveCard rulesText={describeRules(savedRules)} busy={busy === "mode"} demo={demoOn} onEdit={() => setEditing(true)} onStart={(m) => void setMode(m)} />
            )}
            {step === 4 && !editing && view && (
              <>
                <TabBar tab={tab} onTab={setTab} />
                {tab === "overview" && (
                  <>
                    {pendingDeposit && (
                      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-mint/25 bg-mint/[0.06] px-4 py-3 text-sm">
                        <span className="size-2 animate-pulse rounded-full bg-mint" />
                        <span>
                          Your {pendingDeposit.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} {pendingDeposit.asset} deposit is on its way: usually 2 to 10 minutes.
                        </span>
                        {pendingDeposit.txHash && (
                          <a href={`https://cardanoscan.io/transaction/${pendingDeposit.txHash}`} target="_blank" rel="noreferrer" className="ml-auto text-xs text-muted hover:text-white">
                            Cardanoscan ↗
                          </a>
                        )}
                      </div>
                    )}
                    <StatusCard
                      v={view}
                      busy={busy === "mode"}
                      onMode={(m) => void setMode(m)}
                      onEdit={() => setEditing(true)}
                      onLeave={leaveDemo}
                      onRestart={() => void runDemo(demo.rules!, demo.mode === "off" ? "on" : demo.mode, "Demo restarted.")}
                      onWithdraw={!demoOn && session ? () => setWithdrawOpen(true) : undefined}
                      onDeposit={!demoOn && session ? () => (setError(""), setDepositOpen(true)) : undefined}
                    />
                    <div className="grid gap-4 xl:grid-cols-2">
                      <TradersList v={view} limit={3} />
                      <div className="space-y-4">
                        <Allocation v={view} apr={slp?.apr ?? null} />
                        <Activity v={view} limit={4} />
                      </div>
                    </div>
                  </>
                )}
                {tab === "traders" && <TradersList v={view} />}
                {tab === "earn" && <EarnPanel v={view} slp={slp} realfi={me?.realfi} actions={realfiActions} />}
                {tab === "activity" && (
                  <>
                    {!demoOn && me?.transfers && <Transfers list={me.transfers} />}
                    <Activity v={view} />
                  </>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {demoOn && step === 4 && (
          <p className="text-[11px] leading-relaxed text-white/40">
            Demo numbers are an estimate on pretend money: each copy follows its trader&apos;s live trading profit since you pressed Start, sized the way Strike sizes copies, with your stop-loss, profit lock
            and daily limit. Updates about every minute. Real copies also pay fees and can fill differently.
          </p>
        )}
        <p className="pt-2 text-xs text-muted">
          <Link href="/autopilot" className="hover:text-white">
            ← About Autopilot
          </Link>
        </p>
      </div>

      {/* Copilot: docked on desktop, a sheet on phones. */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 h-[calc(100vh-7.5rem)]">
          <CopilotPanel key={String(chatOn)} rules={copilotRules} maxBudget={maxBudget} chat={chatOn} context={copilotContext} onApply={applyFromCopilot} />
        </div>
      </aside>
      <div className="lg:hidden">
        <AnimatePresence>
          {sheet && (
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 300, damping: 34 }} className="fixed inset-x-2 bottom-2 z-[60] h-[75vh]">
              <CopilotPanel key={String(chatOn)} rules={copilotRules} maxBudget={maxBudget} chat={chatOn} context={copilotContext} onApply={applyFromCopilot} onClose={() => setSheet(false)} />
            </motion.div>
          )}
        </AnimatePresence>
        {!sheet && (
          <button data-tour="copilot" onClick={() => setSheet(true)} className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-full bg-mint px-5 py-3 font-semibold text-ink shadow-[0_10px_40px_rgba(78,250,176,0.35)]">
            {I.spark} Copilot
          </button>
        )}
      </div>

      <Tour steps={TOUR} open={tour} onClose={() => setTour(false)} />
      {session && me && <DepositModal open={depositOpen} wallets={myWallets} busy={busy === "deposit"} error={depositOpen ? error : ""} onDeposit={depositAda} onClose={() => (setDepositOpen(false), setError(""))} />}
      {session && me && (
        <WithdrawModal
          open={withdrawOpen}
          session={session}
          wallets={myWallets}
          onUsedWallet={rememberWallet}
          address={me.user.address}
          available={me.balance?.available ?? 0}
          parked={me.parked ?? 0}
          parkedSubs={me.parkedSubs ?? []}
          accountId={me.user.accountId}
          network={me.user.network}
          refreshAvailable={async () => {
            await new Promise((r) => setTimeout(r, 1500)); // let Strike settle the move
            const fresh = await autopilot.me(session);
            setMe(fresh);
            return fresh.balance?.available ?? 0;
          }}
          susdrf={me.realfi?.custody ?? 0}
          onClose={() => setWithdrawOpen(false)}
          onDone={() => void refresh(session)}
        />
      )}
    </div>
  );
}

/** The connected wallet, top right: icon, name and address, with Disconnect. */
function WalletChip({ address, wallet, onDisconnect }: { address: string; wallet: InstalledWallet | null; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="glass flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5 text-sm hover:bg-white/10">
        {wallet ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={wallet.icon} alt="" className="size-6 rounded-full bg-white" />
        ) : (
          <span className="size-6 rounded-full bg-mint/30" />
        )}
        <span className="font-mono text-xs">
          {address.slice(0, 7)}…{address.slice(-4)}
        </span>
        <span className="text-[10px] text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-2xl border border-white/10 bg-[#111413] p-2 shadow-2xl">
          <p className="px-3 pt-1 pb-2 text-xs text-muted">
            Connected{wallet ? ` with ${wallet.name}` : ""}
            <span className="mt-0.5 block font-mono text-[11px] text-white/50">
              {address.slice(0, 12)}…{address.slice(-6)}
            </span>
          </p>
          <button
            onClick={() => {
              setOpen(false);
              onDisconnect();
            }}
            className="w-full rounded-xl px-3 py-2 text-left text-sm text-neg hover:bg-white/5"
          >
            Disconnect
          </button>
          <p className="px-3 pt-1 pb-1 text-[10px] leading-relaxed text-white/35">Your bot keeps running on Strike. Connect again anytime to see it.</p>
        </div>
      )}
    </div>
  );
}
