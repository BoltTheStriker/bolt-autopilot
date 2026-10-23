"use client";

// The Earn tab's parts: where the user's money is (in copies, idle, earning), the ways to earn on Strike
// (its SLP vault, RealFi's sUSDrf through Borrow & Earn, STRIKE staking), and $BOLT's holder rewards.
// Every number is live (Strike's public API, the Bolt server, Solada); deposits happen on Strike's own pages.
import { useEffect, useState } from "react";
import type { SlpInfo } from "@/lib/autopilotApi";
import { site } from "@/lib/config";
import type { CoinSnapshot, WalletRewards } from "@/lib/solada";
import { usd } from "./steps";

export const STRIKE_PAGES = {
  vault: `${site.strike.app}/vaults`,
  myVault: `${site.strike.app}/vaults/my-vault`,
  borrowEarn: `${site.strike.app}/borrow-to-earn`,
  staking: `${site.strike.app}/staking`,
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const compact = (v: number) => v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });

/** STRIKE staking, from Strike's public summary: fees shared with stakers about every two weeks. */
type Staking = { apr: number; stakedUsd: number; stakers: number; paidUsd: number };

function useStaking() {
  const [s, setS] = useState<Staking | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("https://api.strikefinance.org/v2/liquid-staking/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return;
        const n = (x: unknown) => Number(x) || 0;
        setS({ apr: n(j.apr_30d), stakedUsd: n(j.current_staked_usd), stakers: n(j.active_staked_count), paidUsd: n(j.all_time_distributed_usd) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

/** In copies, idle on the account, earning (SLP + pledged sUSDrf); and what the idle part could make in SLP. */
export function MoneyStrip({ demo, working, idle, earning, slp }: { demo: boolean; working: number; idle: number; earning: number; slp: SlpInfo | null }) {
  const month = slp ? (idle * slp.apr) / 12 : 0;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-xs text-muted">{demo ? "Your demo money" : "Your money on Strike"}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[
          ["In copies", working, "text-white"],
          ["Idle", idle, idle >= 1 ? "text-gold" : "text-white"],
          ["Earning", earning, earning > 0 ? "text-mint" : "text-white"],
        ].map(([label, value, tone]) => (
          <div key={label as string} className="rounded-xl bg-white/[0.04] py-2.5">
            <p className={`font-mono text-sm ${tone}`}>{usd(value as number)}</p>
            <p className="text-[11px] text-muted">{label}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-soft">
        {idle >= 1 && slp ? (
          <>
            {usd(idle)} isn&apos;t doing anything. In Strike&apos;s vault it would earn about <span className="text-mint">{usd(month)} a month</span> at today&apos;s rate.
          </>
        ) : idle >= 1 ? (
          `${usd(idle)} isn't doing anything right now.`
        ) : (
          "Everything is at work."
        )}
      </p>
    </div>
  );
}

export function EarnOptions({ slp, hasSlp }: { slp: SlpInfo | null; hasSlp: boolean }) {
  const staking = useStaking();
  const s = slp?.susdrf ?? null;
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <h3 className="font-display text-xl font-semibold">Ways to earn on Strike</h3>
        <p className="font-mono text-[11px] text-white/40">Live rates from Strike&apos;s API · deposits happen on Strike</p>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Option
          tag="Simplest"
          title="Strike Vault (SLP)"
          rate={slp ? pct(slp.apr) : "—"}
          rateLabel="APR today"
          body="Dollars on your Strike account go into Strike's market-making vault and earn from trading on Strike."
          facts={slp ? [`$${(slp.equity / 1e6).toFixed(2)}M in vault`, `${slp.lockupDays}-day lockup`, `min $${slp.minDeposit}`] : []}
          href={hasSlp ? STRIKE_PAGES.myVault : STRIKE_PAGES.vault}
          cta={hasSlp ? "Manage on Strike ↗" : "Deposit on Strike ↗"}
          risk="The vault takes the other side of trades, so it can lose."
          primary
        />
        <Option
          tag="RealFi"
          title="Pledge & earn"
          rate={s && slp ? `${pct(s.yieldApr)} + ${pct(slp.apr)}` : "—"}
          rateLabel="sUSDrf yield + SLP"
          body="Pledge RealFi's sUSDrf in Strike's Borrow & Earn: it keeps its own yield, and the credit it backs earns in SLP."
          facts={s ? [`${s.openLines} open lines`, `$${(s.debt / 1000).toFixed(0)}K drawn into SLP`] : []}
          href={STRIKE_PAGES.borrowEarn}
          cta="Open Borrow & Earn ↗"
          risk="Two layers of risk: RealFi's loans and the SLP vault."
          more={{ href: "#realfi", label: "How it works ↓" }}
        />
        <Option
          tag="STRIKE holders"
          title="Stake STRIKE"
          rate={staking ? pct(staking.apr) : "—"}
          rateLabel="APR, last 30 days"
          body="Strike shares its trading fees with STRIKE stakers about every two weeks."
          facts={staking ? [`$${compact(staking.stakedUsd)} staked`, `${staking.stakers.toLocaleString("en-US")} stakers`, `$${compact(staking.paidUsd)} paid out`] : []}
          href={STRIKE_PAGES.staking}
          cta="Stake on Strike ↗"
          risk="The rate is on STRIKE's value, which moves."
        />
      </div>
    </section>
  );
}

function Option(o: { tag: string; title: string; rate: string; rateLabel: string; body: string; facts: string[]; href: string; cta: string; risk: string; primary?: boolean; more?: { href: string; label: string } }) {
  return (
    <div className={`card flex flex-col rounded-3xl p-6 ${o.primary ? "border border-mint/30" : ""}`}>
      <p className="font-mono text-[10px] tracking-wider text-white/40 uppercase">{o.tag}</p>
      <h4 className="mt-1 font-display text-lg font-semibold">{o.title}</h4>
      <p className={`mt-3 font-mono whitespace-nowrap text-mint ${o.rate.length > 8 ? "text-2xl leading-9" : "text-3xl"}`}>{o.rate}</p>
      <p className="text-[11px] text-muted">{o.rateLabel}</p>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-soft">{o.body}</p>
      {o.facts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {o.facts.map((f) => (
            <span key={f} className="rounded-full bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] text-soft">
              {f}
            </span>
          ))}
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <a
          href={o.href}
          target="_blank"
          rel="noreferrer"
          className={`rounded-full px-5 py-2.5 text-sm font-semibold transition active:scale-[0.97] ${o.primary ? "bg-mint text-ink hover:bg-mint-2 hover:shadow-[0_6px_24px_rgba(78,250,176,0.35)]" : "glass hover:bg-white/10"}`}
        >
          {o.cta}
        </a>
        {o.more && (
          <a href={o.more.href} className="text-xs font-semibold text-mint underline-offset-2 hover:underline">
            {o.more.label}
          </a>
        )}
      </div>
      <p className="mt-3 text-[11px] text-white/40">{o.risk}</p>
    </div>
  );
}

/** $BOLT's holder rewards (half of every $BOLT trading fee, paid in STRIKE by Solada): the user's own when they hold some. */
export function BoltRewards({ address }: { address?: string }) {
  const [coin, setCoin] = useState<CoinSnapshot | null>(null);
  const [mine, setMine] = useState<WalletRewards | null>(null);
  useEffect(() => {
    let alive = true;
    const get = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);
    void get<CoinSnapshot>("/api/coin").then((c) => alive && setCoin(c));
    if (address) void get<WalletRewards>(`/api/rewards?address=${encodeURIComponent(address)}`).then((r) => alive && setMine(r));
    return () => {
      alive = false;
    };
  }, [address]);
  if (!coin?.launched) return null;
  const holds = (mine?.held ?? 0) > 0;
  return (
    <section className="card flex flex-wrap items-center justify-between gap-4 rounded-3xl p-5 sm:p-6">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] tracking-wider text-white/40 uppercase">Community rewards</p>
        <h4 className="mt-1 font-display text-lg font-semibold">${site.ticker} holder rewards, paid in STRIKE</h4>
        {holds && mine ? (
          <p className="mt-1.5 text-sm text-soft">
            You hold <span className="font-mono text-white">{compact(mine.held)}</span> ${site.ticker}: earning <span className="font-mono text-mint">₳{mine.earningAda.toFixed(2)}</span> this round
            {mine.strike.unclaimed > 0 && (
              <>
                , and <span className="font-mono text-mint">{compact(mine.strike.unclaimed)} STRIKE</span> ready to claim
              </>
            )}
            .
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-soft">
            ${site.ticker} holders share half of every ${site.ticker} trading fee, paid in Strike&apos;s token: ₳{compact(coin.fees.holders)} to {coin.holders} holders so far.
          </p>
        )}
      </div>
      <a href={holds ? site.token.launchpad.url : site.url} target="_blank" rel="noreferrer" className="glass shrink-0 rounded-full px-5 py-2.5 text-sm font-semibold transition hover:bg-white/10 active:scale-[0.97]">
        {holds ? `Claim on ${site.token.launchpad.name} ↗` : `About $${site.ticker} ↗`}
      </a>
    </section>
  );
}
