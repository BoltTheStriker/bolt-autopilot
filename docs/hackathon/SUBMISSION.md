# Bolt Autopilot · Strike Hackathon submission

**Copy trading on Strike, on autopilot.**
Live: https://autopilot.boltstriker.io (private beta on Strike mainnet; anyone can run the demo)
Builder code: `bolt_dev` · Team: the $BOLT community (X: @bolthestriker)

## One line

Say your goal and Bolt Autopilot copies the best traders on Strike Finance for you, inside hard limits you choose, on your own Strike account: Bolt never holds your money.

## The problem

Strike's copy trading is powerful, but doing it well is hard. Hundreds of traders and their scores change every hour, sizing and limits (leverage, stop-losses, markets) are easy to get wrong, and copies need watching around the clock.

## What we built

1. **One-signature onboarding (Builder Connect).** A Cardano wallet signs once; Strike opens the user's account (or links an existing one) through Strike's builder program. The API key Bolt receives can trade but never withdraw.
2. **Goals become rules.** Users pick a risk level (Low / Medium / High), a goal (Steady / Balanced / Growth) and markets (all, crypto, or real-world: stocks, indices, gold, oil). That sets the budget at work, the leverage cap, a stop-loss on every copy and a daily loss limit, all enforced on Strike.
3. **A ranked engine.** Every hour it ranks Strike's top traders by return per unit of drawdown × consistency, keeps only traders a copy can follow at the user's size, who are active and trade markets Strike lists, and it holds what works (no churn when rankings reshuffle). A walk-forward backtest on 877 traders picked this score: median return ÷ drawdown 44.6, versus 7.7 for picking top returners. Backtests don't promise future results.
4. **AI copilot (Claude).** Users describe what they want in their own words; the copilot reads the bot's current traders and Strike's live Earn rates and proposes a full rule set. It never applies anything itself: every proposal has an Apply button.
5. **Earn with RealFi on Strike.** Money the bot isn't using can earn. Bolt shows RealFi's sUSDrf yield (≈11.9%, measured by Strike) next to SLP's APR (≈21%), reads the user's sUSDrf balance, deposits sUSDrf to their Strike account in one signature, and tracks the position. One-tap Pledge & earn is next, on the RealFi API Strike is adding.
6. **Deposit and withdraw inside Bolt.** ADA in with one signature; withdrawals only to the wallet registered on the account, only with its signature. Money in running copies returns to the balance when they stop.
7. **A live demo for anyone.** $1,000 of pretend money that starts when you press Start and moves with the picked traders' live trading (stop-losses included), so judges can try it without a wallet.

## Why it matters for Strike

Every Bolt user is a Strike user: new accounts through our builder code, copy-trading volume on Strike's engine, and RealFi liquidity in Strike's Borrow & Earn. Bolt is the intelligence layer; Strike stays the engine, the custody and the source of truth.

We track it in public: **https://autopilot.boltstriker.io/impact** shows, live from Strike's API, the Bolt server and Cardano, the Strike accounts opened through `bolt_dev`, copy-trading volume, the live bot's real result and RealFi liquidity.

## Traction

- The same engine has run the $BOLT bot on Strike with **real money since Oct 16** (four copies from a Strike sub-account).
- **$13.3K copy-trading volume** and 160 copy trades on Strike in its first five days (Strike API, Oct 21).
- **₳1M+ $BOLT token trading volume**, and a Bot Cup where holders run demo bots on live Strike traders.

## How it works

```mermaid
flowchart LR
  U["User\n(Cardano wallet)"] -->|"1 signature: Builder Connect"| S["Strike Finance\nuser's own account"]
  U -->|"goal, rules, chat"| B["Bolt Autopilot\napp + engine"]
  B -->|"ranks traders hourly"| L["Strike copy-trading\nleaderboard (Hyperliquid leads)"]
  B -->|"trade-only API key:\ncopies with stop-loss,\ncaps, markets"| S
  B -->|"Claude: propose rules"| C["AI copilot"]
  S -->|"Borrow & Earn"| R["RealFi sUSDrf → SLP"]
  S -->|"withdraw: only to the\nuser's wallet, with its signature"| U
```

- **Site:** Next.js 16 on Vercel (autopilot.boltstriker.io). Wallets via CIP-30; Cardano transactions are signed in the wallet and witnesses merged without re-encoding the body.
- **Worker:** Node 22 on Railway. Strike API with Ed25519 API-wallet signing; per-user keys stored encrypted (AES-256-GCM). Syncs each user's copies every 5 minutes; reads copies across sub-accounts.
- **Engine:** shared with the live $BOLT bot (`bot/strategy.ts`), with Autopilot rules in `worker/autopilot.ts`; 100+ unit tests.
- **Copilot:** Anthropic's Claude via the official SDK, strict tools (propose rules, read traders, read Earn rates), rate-limited, proposal-only.

## Safety

Non-custodial accounts, a trade-only key, withdrawals only to the user's own wallet, a stop-loss and caps on every copy, a daily loss limit, one button to stop, encrypted keys, and a $500 per-user cap during the beta.

## What's next

Public beta; one-tap RealFi Pledge & earn on Strike's new API; and, with the Strike team, a **Bolt Autopilot Vault**: a Strike vault run by the engine, so anyone can join with a deposit on Strike itself.

*Bolt is a community project built on Strike's public tools; it is not made or endorsed by Strike Finance or RealFi. Copy trading can lose money.*
