"use client";

// Bolt Autopilot, the app (/autopilot/app): setup in four steps, then the dashboard, with the copilot
// docked beside it. Runs on a real Strike account, or as a demo with pretend money.
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAutopilotHref } from "@/lib/autopilotHost";
import { checkAdminKey, readAdminKey } from "@/lib/adminPreview";
import { autopilot, saveSession, savedSession, type AutoMe, type AutoMode, type AutoStatus, type CopilotAction, type Session, type SlpInfo } from "@/lib/autopilotApi";
import { site } from "@/lib/config";
import { DEMO_BALANCE, demoCopies, demoValue, startDemo as startLiveDemo, stepDemo, swapDemoCopy, type DemoLive } from "@/lib/autopilotDemo";
import { nameKey, useTraderNames } from "@/lib/traderNames";
import { rememberAccount, useKnownAccounts } from "@/lib/knownAccounts";
import { useIdleCopies } from "@/lib/useIdleCopies";
import { connectAddress, installedWallets, sameAccount, signAndSubmit, signText, walletBalance, walletUtxos, type InstalledWallet } from "@/lib/wallet";
import { defaultRules, describeRules, MIN_COPY_USD, RISK_LEVELS, sanitizeRules, type AutoRules, type LiveMark, type PreviewTrader, type SharedRules } from "@/worker/autopilot";
import { decodeDemoSetup, encodeDemoSetup } from "@/lib/setupLink";
import { askConfirm, ConfirmHost, type ConfirmOptions } from "../Confirm";
import { askCopilot, CopilotPanel } from "./Copilot";
import { TraderModal } from "./TraderModal";
import { BoltVaultSoon, HolderPerks } from "./BoltToken";
import type { SwapApi } from "./TokenDeposit";
import { OPEN_TRADER } from "./TraderText";
import { Toasts, type Toast } from "./Toasts";

/** Bot activity worth a card on the page (decisions, switches, stops, targets, problems), not every mirrored trade. */
const NOTABLE = /^(?!Autopilot checked)(Autopilot|Switch|Stopped|Copying|Copy of|Profit target|Loss limit|Daily|Paused|Weekend|Couldn't|Bot switched|Stop-loss|Profit locked|Error)/;
import { SUSDRF_UNIT, type RealFiActions } from "./RealFi";
import { encodeDemoCard, GOAL_LABEL, RISK_LABEL } from "@/lib/autopilotShare";
import { DepositModal, type DepositStage } from "./Deposit";
import { ShareModal, type ShareSource } from "./Share";
import { useEggTaps } from "./WalletEgg";
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
  const hrefFor = useAutopilotHref(); // /autopilot… links as this host reads them
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
  const [share, setShare] = useState<ShareSource | null>(null); // the result card, as it was when Share was tapped
  const eggTap = useEggTaps(); // 5 quick clicks on the logo: a hidden concept video
  const [ranked, setRanked] = useState<PreviewTrader[] | null>(null); // the bot's traders now, for the rules preview
  useEffect(() => {
    let alive = true;
    const load = () => autopilot.preview().then((p) => alive && setRanked(p.traders), () => alive && setRanked((x) => x ?? []));
    void load();
    const id = setInterval(load, 10 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
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

  // Profit history for the real dashboard's chart: the server keeps it (newer workers); this browser also
  // records each update, so the chart works with an older worker too.
  const [localHist, setLocalHist] = useState<{ at: number; pnl: number; working: number }[]>([]);
  const refresh = useCallback(async (s: Session | null) => {
    if (!s) return;
    try {
      const m = await autopilot.me(s);
      setMe(m);
      rememberAccount(s.address, !!m.user.rules || m.user.mode !== "off" || m.user.copies.length > 0);
      if (m.user.mode !== "off" || m.user.copies.length) {
        const key = `bolt-autopilot-history-${m.user.accountId}`;
        let hist: { at: number; pnl: number; working: number }[] = [];
        try {
          hist = JSON.parse(localStorage.getItem(key) ?? "[]");
        } catch {}
        // A point at every refresh (30 s): the chart shows within a minute; it moves as fresh numbers arrive from Strike.
        const at = Date.now();
        if (!hist.length || at - hist[hist.length - 1].at >= 25_000) {
          hist = [...hist, { at, pnl: Math.round(m.user.copies.reduce((t, c) => t + c.pnl, 0) * 100) / 100, working: m.user.copies.reduce((t, c) => t + c.amount, 0) }].slice(-1_000);
          try {
            localStorage.setItem(key, JSON.stringify(hist));
          } catch {}
        }
        setLocalHist(hist);
      }
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
            const live = stepDemo(d.live, r.marks, d.rules, Date.now(), { autopilot: d.mode === "autopilot" });
            // A stop target ended the run: the demo bot switches off, like a real one.
            const next = { ...d, live, mode: live.done && !d.live.done ? ("off" as const) : d.mode };
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

  // Keep a running bot's numbers fresh; check often while a deposit is on its way, and every few
  // seconds while a just-started bot is finding its first traders.
  const waitingDeposit = !!sentDeposit;
  // Started, no copies yet, and no sync since the start (after one, the dashboard says why instead).
  const startedAt = me?.user.log.find((l) => /^(Bot switched on|Autopilot on)/.test(l.text))?.at ?? 0;
  const syncedSinceStart = (me?.user.lastSyncAt ?? 0) > startedAt;
  const finding = !!me && me.user.mode !== "off" && me.user.copies.length === 0 && !me.user.idle && !syncedSinceStart;
  useEffect(() => {
    if (!session || (me?.user.mode === "off" && !waitingDeposit)) return;
    const id = setInterval(() => void refresh(session), finding ? 5_000 : waitingDeposit ? 15_000 : 30_000);
    return () => clearInterval(id);
  }, [session, me?.user.mode, waitingDeposit, finding, refresh]);
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
  // A new screen (a setup step, or the rules form opening or closing) starts at the top, not wherever the last one
  // was scrolled to.
  const screen = `${step}:${editing}`;
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [screen]);
  // Connected a wallet account Bolt hasn't set up, while this browser knows one that has a dashboard: point to it.
  const known = useKnownAccounts();
  const [newAccountOk, setNewAccountOk] = useState<string | null>(null);
  const otherAccount =
    !demoOn && session && user && !user.rules && !hasStarted && newAccountOk !== session.address ? (known.find((a) => a.setUp && a.address !== session.address) ?? null) : null;
  const otherShort = (a: string) => `${a.slice(0, 10)}…${a.slice(-6)}`;
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
        autopilot:
          demo.mode === "autopilot"
            ? { reason: demo.live.autoNote?.text.replace(/^Autopilot: /, "") ?? null, rulesText: null, at: demo.live.autoNote?.at ?? null, checkedAt: demo.live.decisions?.[0]?.at ?? null, decisions: demo.live.decisions ?? [] }
            : undefined,
        stopLossPct: demo.rules.stopLossPct,
        targets: { profit: demo.rules.stopAtProfitUsd ?? null, loss: demo.rules.stopAtLossUsd ?? null, run: demoValue(demo.live, sl) - DEMO_BALANCE },
        today: demoValue(demo.live, sl) - demo.live.dayStartValue,
      };
    }
    if (!me) return null;
    // Everything the user owns on Strike: the main account (its balance already holds the copies that run
    // from it, plus their open profit) + first-version copies in their own sub-accounts + money parked there.
    const total = me.balance
      ? (me.balance.equity ?? me.balance.wallet) + me.user.copies.filter((c) => c.isolated).reduce((t, c) => t + c.amount + c.pnl, 0) + (me.parked ?? 0)
      : null;
    return {
      demo: false,
      mode: me.user.mode,
      address: me.user.address,
      accountId: me.user.accountId,
      balance: total,
      // Profit since the account started: what's there minus what was put in (deposits and withdrawals don't count).
      allTime: total !== null && me.user.netIn ? { pnl: total - me.user.netIn, base: me.user.netIn } : null,
      copies: me.user.copies,
      log: me.user.log,
      rulesText: me.rulesText,
      reserve: Math.max(0, me.balance?.available ?? 0), // free on the main account (not reserved by copies)
      parked: me.parked ?? 0,
      earn: me.earn ?? null,
      halted: me.user.log.some((l) => /Daily loss limit|Daily profit target/.test(l.text) && (me.user.lastSyncAt ?? 0) - l.at < 86_400_000),
      // The profit chart: the server's history when it has one, else what this browser recorded.
      ...(() => {
        const h = (me.user.history?.length ?? 0) >= 2 ? me.user.history! : localHist;
        return h.length >= 2 ? { curve: h.map((p) => p.pnl), startedAt: h[0].at } : {};
      })(),
      syncedAt: me.user.liveAt ?? me.user.lastSyncAt ?? null,
      live: !!me.user.liveAt,
      stopLossPct: me.user.rules?.stopLossPct,
      note: me.user.note ?? null,
      // Today's profit: now against the first point recorded today (UTC).
      today: (() => {
        const day = new Date().toISOString().slice(0, 10);
        const first = (me.user.history ?? []).find((p) => new Date(p.at).toISOString().slice(0, 10) === day);
        return first ? me.user.copies.reduce((t, c) => t + c.pnl, 0) - first.pnl : null;
      })(),
      targets: {
        profit: me.user.rules?.stopAtProfitUsd ?? null,
        loss: me.user.rules?.stopAtLossUsd ?? null,
        run: (me.user.run?.closed ?? 0) + me.user.copies.reduce((t, c) => t + c.pnl, 0),
      },
      autopilot:
        me.user.mode === "autopilot"
          ? { reason: me.user.autopilot?.reason ?? null, rulesText: me.user.autopilot?.rulesText ?? null, at: me.user.autopilot?.at ?? null, checkedAt: me.user.reviewedAt ?? null, decisions: me.user.decisions ?? [] }
          : undefined,
      idle:
        me.user.mode !== "off" && me.user.copies.length === 0
          ? (me.user.idle ?? (syncedSinceStart ? "The bot checked and hasn't started a copy yet. What it tried is under Activity; it tries again every few minutes." : null))
          : null,
    };
  }, [demoOn, demo, marks, me, syncedSinceStart, localHist]);

  // A snapshot of the result for its share card: the demo against its $1,000, a real account on its running copies.
  const shareNow = (): ShareSource | null => {
    if (!view) return null;
    const pct = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r * 100).toFixed(2)}%`;
    const n = view.copies.length;
    if (view.demo && demo.rules && demo.live && view.balance !== null) {
      const pnl = view.balance - DEMO_BALANCE;
      const ret = pnl / DEMO_BALANCE;
      const since = new Date(demo.live.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return {
        kind: "demo",
        d: encodeDemoCard({ ret, pnl, traders: n, since: demo.live.startedAt, risk: demo.rules.risk, goal: demo.rules.goal, markets: demo.rules.markets, curve: view.curve ?? [] }),
        setup: encodeDemoSetup(demo.rules),
        text: `My Bolt Autopilot demo: ${pct(ret)} since ${since}, copying ${n} trader${n === 1 ? "" : "s"} on Strike. Try it with demo money:`,
      };
    }
    if (!view.demo && session && user?.rules && n > 0) {
      const working = view.copies.reduce((t, c) => t + c.amount, 0);
      const ret = working > 0 ? view.copies.reduce((t, c) => t + c.pnl, 0) / working : 0;
      const s = session;
      return {
        kind: "real",
        getId: () => autopilot.share(s).then((r) => r.id),
        text: `My Bolt Autopilot on Strike: ${pct(ret)} on my running copies, ${n} trader${n === 1 ? "" : "s"}, ${RISK_LABEL[user.rules.risk].toLowerCase()}, ${GOAL_LABEL[user.rules.goal].toLowerCase()}.`,
      };
    }
    return null;
  };

  // Before stopping a real bot: the profit right now, live from Strike, so nobody stops on a stale number.
  async function stopWithLiveCheck() {
    let note: ConfirmOptions["note"];
    try {
      const l = await autopilot.live(session!);
      const pct = l.working > 0 ? ` (${l.pnl >= 0 ? "+" : "−"}${Math.abs((l.pnl / l.working) * 100).toFixed(2)}%)` : "";
      note = { text: `${l.pnl >= 0 ? "+" : "−"}$${Math.abs(l.pnl).toFixed(2)}${pct} right now, live from Strike`, tone: l.pnl >= 0 ? "pos" : "neg" };
    } catch {
      note = undefined; // couldn't read it: the plain question still works
    }
    const ok = await askConfirm({
      title: "Stop the bot?",
      note,
      body: "Every copy closes at market price, so the final result can differ a little from this number. Your money stays in your Strike account.",
      confirmLabel: "Stop the bot",
      danger: true,
    });
    if (ok) void setMode("off");
  }

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
      // Running already: switching between "Follow my rules" and Autopilot doesn't restart it.
      if (demo.live && demo.mode !== "off") return setDemoState({ ...demo, mode: m });
      return runDemo(demo.rules!, m);
    }
    await run("mode", async () => {
      await autopilot.mode(session!, m);
      await refresh(session);
    });
  }
  // "Switch trader": stop that copy and let the bot pick the next best fit (skipped for a day; the demo moves its money).
  async function swapTrader(lead: string) {
    if (demoOn) {
      const live = demo.live && swapDemoCopy(demo.live, lead, marks, Date.now());
      if (live) setDemoState({ ...demo, live });
      else setError("No other trader fits your rules with a live feed right now.");
      return;
    }
    // "Switching…" until the old copy is gone (the server stops it on its next sync, seconds later).
    setSwapping(lead);
    setTimeout(() => setSwapping((s) => (s === lead ? null : s)), 120_000);
    await run("swap", async () => {
      await autopilot.swap(session!, lead);
      await refresh(session);
    });
    setTimeout(() => void refresh(session), 8_000);
  }
  const [swapping, setSwapping] = useState<string | null>(null);
  const swappingLead = swapping && view?.copies.some((c) => c.lead === swapping) ? swapping : null;

  // Something new from the bot: a card slides up on the page, and the new activity glows. On first load (or another
  // account) nothing pops up: only what arrives while the page is open. Routine trade lines stay in the feed only.
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fresh, setFresh] = useState<number | null>(null);
  const [seen, setSeen] = useState<{ key: string; at: number } | null>(null);
  const logKey = demoOn ? "demo" : (me?.user.accountId ?? "");
  const newest = view?.log[0]?.at ?? 0;
  if (view && seen?.key !== logKey) setSeen({ key: logKey, at: newest });
  else if (view && seen && newest > seen.at) {
    const added = view.log.filter((l) => l.at > seen.at && NOTABLE.test(l.text)).slice(0, 3).reverse();
    setSeen({ key: logKey, at: newest });
    setFresh(seen.at);
    if (added.length) setToasts((t) => [...t, ...added.map((l, i) => ({ id: l.at * 10 + i, text: l.text }))]);
  }
  useEffect(() => {
    if (fresh === null) return;
    const t = setTimeout(() => setFresh(null), 20_000);
    return () => clearTimeout(t);
  }, [fresh]);
  const closeToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  // Any trader link in the app opens the trader window.
  useEffect(() => {
    const on = (e: Event) => setTraderOpen((e as CustomEvent<string>).detail);
    window.addEventListener(OPEN_TRADER, on);
    return () => window.removeEventListener(OPEN_TRADER, on);
  }, []);
  const [traderOpen, setTraderOpen] = useState<string | null>(null); // the trader window
  const closeTrader = useCallback(() => setTraderOpen(null), []);
  const traderNames = useTraderNames();
  const idleLeads = useIdleCopies(view?.copies ?? [], !!view && view.mode !== "off", demoOn);
  // "Start with my setup" links (?setup=…): a friend's rules, shown as a card the user can take or leave.
  const [incoming, setIncoming] = useState<{ rules: SharedRules; card: { ret: number; since: number; traders: number } | null } | null>(null);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("setup");
    if (!s) return;
    const demoRules = decodeDemoSetup(s);
    const found = demoRules ? Promise.resolve({ rules: demoRules, card: null }) : /^[0-9a-f]{12}$/.test(s) ? autopilot.setup(s) : Promise.reject(new Error("bad link"));
    found.then(
      (x) => setIncoming({ rules: x.rules, card: x.card ?? null }),
      () => setError("That setup link isn't valid any more."),
    );
  }, []);
  const myBudget = savedRules?.budgetUsd ?? draft?.budgetUsd ?? (demoOn ? DEMO_BALANCE : Math.min(Math.max(balance, 100), maxBudget));
  const incomingRules = incoming ? sanitizeRules({ ...defaultRules(myBudget, incoming.rules.risk), ...incoming.rules, budgetUsd: myBudget }, maxBudget) : null;
  const dropIncoming = () => {
    setIncoming(null);
    const u = new URL(window.location.href);
    u.searchParams.delete("setup");
    window.history.replaceState(null, "", u.pathname + u.search + u.hash);
  };
  async function takeIncoming() {
    if (!incomingRules) return dropIncoming();
    if (savedRules && step >= 3 && !editing) {
      const ok = await askConfirm({ title: "Use this setup?", body: `Your rules switch to: ${describeRules(incomingRules)}. Your budget stays $${myBudget.toFixed(0)}.`, confirmLabel: "Use it" });
      if (!ok) return;
      await saveRules(incomingRules);
    } else {
      // Not running yet: it fills the rules form (now, or when the user gets there).
      setDraft(incomingRules);
      setDraftKey((k) => k + 1);
      if (step < 2) setToasts((t) => [...t, { id: Date.now(), text: "Setup saved: it fills in your rules once you connect a wallet or try the demo." }]);
    }
    dropIncoming();
  }
  // The copilot's one-tap actions (the tap is the confirmation): only once there are rules to run.
  const copilotActs = step >= 3 && !!savedRules;
  function actFromCopilot(a: CopilotAction) {
    void setMode(a === "stop" ? "off" : a === "autopilot" ? "autopilot" : "on");
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
    () => ({
      demo: demoOn,
      rules: copilotRules,
      balance: view?.balance ?? null,
      copies: (view?.copies ?? []).map((c) => ({ lead: c.lead, amount: c.amount, pnl: c.pnl, ...(traderNames[nameKey(c.lead)] ? { name: traderNames[nameKey(c.lead)] } : {}) })),
      mode: view?.mode ?? null,
      sinceStart: view?.targets?.run ?? null,
      today: view?.today ?? null,
    }),
    [demoOn, copilotRules, view, traderNames],
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

  /** ADA from the wallet to the Strike account (setup's Fund step and the dashboard's Deposit). The tx hash when sent. */
  async function depositAda(key: string, ada: number, onStage?: (s: DepositStage) => void): Promise<string | null> {
    let sent: string | null = null;
    await run("deposit", async () => {
      onStage?.("prepare");
      if (!(await sameAccount(key, session!.address)))
        throw new Error("Your wallet has a different account selected than the one connected to Autopilot. Switch back to that account in your wallet (or connect this one), then try again.");
      const utxos = await walletUtxos(key, (ada + 3) * 1e6); // the amount plus room for fees and change
      const d = await autopilot.deposit(session!, ada, utxos, "ADA").catch((e: Error) => {
        // Strike couldn't put the transaction together from these coins: say what usually causes it.
        if (/build-tx/.test(e.message))
          throw new Error(
            "Strike couldn't build the deposit from your wallet's coins. Usually a recent transaction from this wallet isn't confirmed yet (wait a minute or two), or the amount leaves too little for fees (try a little less). Then try again.",
          );
        throw e;
      });
      onStage?.("sign");
      const hash = await signAndSubmit(key, d.unsignedTx, () => onStage?.("send"));
      rememberWallet(key);
      setSentDeposit({ amount: ada, asset: "ADA", txHash: hash, at: Date.now(), before: me?.balance?.wallet ?? 0 });
      await autopilot.depositSubmit(session!, d.requestId, hash);
      sent = hash;
      void refresh(session); // the pending deposit shows on the dashboard; no need to wait for it here
    });
    return sent;
  }

  // "Other token" deposits: SteelSwap swaps a wallet token to ADA first (the server holds the key).
  const swapApi = useMemo<SwapApi | null>(
    () =>
      session && (site.tokenDeposits === true || (site.tokenDeposits === "admin" && admin))
        ? {
            tokens: (units) => autopilot.swapTokens(session, units).then((r) => r.tokens),
            quote: (unit, amount) => autopilot.swapQuote(session, unit, amount),
            build: (unit, amount, utxos, expected) => autopilot.swapBuild(session, unit, amount, utxos, expected),
            notify: (hash, tx) => autopilot.swapNotify(session, hash, tx),
          }
        : null,
    [session, admin],
  );

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
            <button type="button" onClick={eggTap} aria-label="Bolt Autopilot" className="grid size-10 place-items-center rounded-2xl bg-mint text-ink [&>svg]:size-5">
              {I.spark}
            </button>
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

        {incoming && (
          <section className="card rounded-3xl border border-mint/30 p-5 sm:p-6">
            <p className="font-mono text-[11px] tracking-wider text-mint uppercase">A friend shared their setup</p>
            {incoming.card ? (
              <p className="mt-1.5 font-display text-xl font-semibold">
                <span className={incoming.card.ret >= 0 ? "text-mint" : "text-neg"}>{`${incoming.card.ret >= 0 ? "+" : "−"}${Math.abs(incoming.card.ret * 100).toFixed(2)}%`}</span> on their real Strike account
                <span className="text-base font-normal text-muted">
                  {" "}
                  since {new Date(incoming.card.since).toLocaleDateString("en-US", { month: "short", day: "numeric" })}, {incoming.card.traders} trader{incoming.card.traders === 1 ? "" : "s"}
                </span>
              </p>
            ) : (
              <p className="mt-1.5 font-display text-xl font-semibold">A setup from the demo (pretend money)</p>
            )}
            <p className="mt-2 text-sm text-soft">With your budget: {incomingRules ? describeRules(incomingRules).replace(/^./, (c) => c.toUpperCase()) : ""}.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => void takeIncoming()} className="rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-mint-2 hover:shadow-[0_6px_24px_rgba(78,250,176,0.35)] active:scale-[0.97]">
                Use this setup
              </button>
              <button onClick={dropIncoming} className="glass rounded-full px-5 py-2.5 text-sm">
                No thanks
              </button>
            </div>
            <p className="mt-3 text-[11px] text-white/40">Only the shape of their rules travels; you choose your own budget. Past results don&apos;t promise future ones.</p>
          </section>
        )}

        {otherAccount && (
          <section className="card rounded-3xl border border-gold/35 p-5 sm:p-6">
            <p className="font-mono text-[11px] tracking-wider text-gold uppercase">A different wallet account</p>
            <p className="mt-1.5 font-display text-xl font-semibold">This wallet account is new to Bolt.</p>
            <p className="mt-2 text-sm text-soft">
              You connected <span className="font-mono text-white">{otherShort(session!.address)}</span>. Your dashboard is on{" "}
              <span className="font-mono text-mint">{otherShort(otherAccount.address)}</span>. Wallets like Eternl, Lace and Vespr hold several accounts: switch to that one in your
              wallet, then reconnect.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={disconnect} className="rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-mint-2">
                Reconnect
              </button>
              <button onClick={() => setNewAccountOk(session!.address)} className="glass rounded-full px-5 py-2.5 text-sm">
                Set up this one
              </button>
            </div>
          </section>
        )}

        {step < 4 && !editing && <Stepper steps={STEPS} current={step} />}

        {error && <p className="rounded-2xl border border-neg/30 bg-neg/10 px-4 py-3 text-sm text-neg">{error}</p>}

        <AnimatePresence mode="wait">
          <motion.div key={showRules ? "rules" : step === 4 ? "dash" : step} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="space-y-4">
            {step === 0 && <ConnectCard wallets={wallets} busy={busy === "connect"} disabled={closed} onConnect={connect} onDemo={startDemo} />}
            {step === 1 && session && pendingDeposit && <DepositPending {...pendingDeposit} onContinue={() => setSkipFund(true)} />}
            {step === 1 && session && !pendingDeposit && (
              <FundCard
                adaUsd={status?.adaUsd ?? null}
                walletKey={walletKey}
                wallets={myWallets}
                busy={busy}
                onDeposit={(key, ada) => void depositAda(key, ada)}
                onSkip={() => setSkipFund(true)}
                swapApi={swapApi}
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
                traders={ranked}
                onAsk={() => (setSheet(true), askCopilot())}
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
                {/* Switching tabs: the tab bar stays put and only the content fades in, quickly (no slide, no wait). */}
                <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, ease: "easeOut" }} className="space-y-4">
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
                        onStop={!demoOn && session ? () => void stopWithLiveCheck() : undefined}
                        onEdit={() => setEditing(true)}
                        onLeave={leaveDemo}
                        onRestart={() => void runDemo(demo.rules!, demo.mode === "off" ? "on" : demo.mode, "Demo restarted.")}
                        onWithdraw={!demoOn && session ? () => setWithdrawOpen(true) : undefined}
                        onDeposit={!demoOn && session ? () => (setError(""), setDepositOpen(true)) : undefined}
                        onShare={view.copies.length > 0 ? () => setShare(shareNow()) : undefined}
                      />
                      <div className="grid gap-4 xl:grid-cols-2">
                        <TradersList v={view} limit={3} onSwap={(l) => void swapTrader(l)} swapping={swappingLead} />
                        <div className="space-y-4">
                          <Allocation v={view} apr={slp?.apr ?? null} />
                          <Activity v={view} limit={4} fresh={fresh} />
                        </div>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <HolderPerks walletKey={walletKey} demo={demoOn} />
                        <BoltVaultSoon />
                      </div>
                    </>
                  )}
                  {tab === "traders" && <TradersList v={view} onSwap={(l) => void swapTrader(l)} swapping={swappingLead} />}
                  {tab === "earn" && <EarnPanel v={view} slp={slp} realfi={me?.realfi} actions={realfiActions} />}
                  {tab === "activity" && (
                    <>
                      {!demoOn && me?.transfers && <Transfers list={me.transfers} />}
                      <Activity v={view} fresh={fresh} />
                    </>
                  )}
                </motion.div>
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
          <Link href={hrefFor("/autopilot")} className="hover:text-white">
            ← About Autopilot
          </Link>
        </p>
      </div>

      {/* Copilot: docked on desktop, a sheet on phones. */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 h-[calc(100vh-7.5rem)]">
          <CopilotPanel key={String(chatOn)} rules={copilotRules} maxBudget={maxBudget} chat={chatOn} context={copilotContext} onApply={applyFromCopilot} onAction={copilotActs ? actFromCopilot : undefined} idle={idleLeads} onSwap={(l) => void swapTrader(l)} />
        </div>
      </aside>
      <div className="lg:hidden">
        <AnimatePresence>
          {sheet && (
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 300, damping: 34 }} className="fixed inset-x-2 bottom-2 z-[60] h-[75vh]">
              <CopilotPanel key={String(chatOn)} rules={copilotRules} maxBudget={maxBudget} chat={chatOn} context={copilotContext} onApply={applyFromCopilot} onAction={copilotActs ? actFromCopilot : undefined} idle={idleLeads} onSwap={(l) => void swapTrader(l)} onClose={() => setSheet(false)} />
            </motion.div>
          )}
        </AnimatePresence>
        {!sheet && (
          <button data-tour="copilot" onClick={() => setSheet(true)} className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-full bg-mint px-5 py-3 font-semibold text-ink shadow-[0_10px_40px_rgba(78,250,176,0.35)] transition hover:bg-mint-2 hover:shadow-[0_6px_24px_rgba(78,250,176,0.35)] active:scale-[0.97]">
            {I.spark} Copilot
          </button>
        )}
      </div>

      <Tour steps={TOUR} open={tour} onClose={() => setTour(false)} />
      <ShareModal open={!!share} source={share} onClose={() => setShare(null)} />
      <ConfirmHost />
      <TraderModal lead={traderOpen} copy={view?.copies.find((c) => c.lead === traderOpen || nameKey(c.lead) === nameKey(traderOpen ?? "")) ?? null} onClose={closeTrader} onSwap={(l) => void swapTrader(l)} />
      <Toasts list={toasts} onClose={closeToast} />
      {session && me && (
        <DepositModal
          open={depositOpen}
          wallets={myWallets}
          busy={busy === "deposit"}
          error={depositOpen ? error : ""}
          onDeposit={depositAda}
          onClose={() => (setDepositOpen(false), setError(""))}
          swapApi={swapApi}
          adaUsd={status?.adaUsd ?? null}
        />
      )}
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
