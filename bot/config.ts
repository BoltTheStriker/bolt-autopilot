// Every knob the copy-trade bot uses. Percentages are fractions (0.15 = 15%).

export const bot = {
  /**
   * "simulate": paper-trades against Strike's public data only, with no keys and no money.
   * Live trading isn't implemented. It needs an API wallet bound to a dedicated sub-account
   * and its own review before anyone flips this.
   */
  mode: "simulate" as "simulate" | "live",

  /** Paper capital the simulation starts with, in USD. */
  startingCapital: 1_000,

  /** How many leads to copy at once; capital is split evenly across slots. More leads = steadier trade flow. */
  maxLeads: 5, // 8 spread $1K too thin: at ~$125 a copy most leads drop below Strike's copyable tiers

  /** Who we're willing to copy. */
  entry: {
    platform: "hyperliquid" as const, // no 10% profit share, unlike Strike leads
    minCopyScore: 55, // Strike's own 0–100 copyability score (30d window)
    minRoi30d: 0.1,
    maxRoi30d: 5, // above +500%/month is usually a tiny lucky or max-leverage account, not repeatable
    maxDrawdown30d: 0.25,
    minCoverage: 0.6, // share of the lead's trades that are copyable at our slot size
    maxIdleHours: 48, // must have traded recently
    minActiveHours24h: 2, // traded in at least this many of the last 24 hours (checked on Hyperliquid); higher shuts out calm swing traders
    maxTradesPerDay: 800, // faster than this, copy delay + fees eat the edge (scalpers copy badly)
    maxDailyTurnover: 3, // daily volume ÷ account; above this our fees + slippage eat the edge (backtest)
    minStrikeShare: 0.7, // share of their recent trading in coins Strike lists (others can't be copied)
    minRoi7d: -0.05, // skip traders already cooling off this week
    requirePositiveAllTime: true, // must be profitable over their whole history, not just lately
    minAccountValue: 10_000,
    excludeStyles: ["market_maker", "inactive"], // MM fills don't mirror well
    requireCopyRecommendation: true, // Strike's recommended_direction === "copy"
  },

  /** When we stop copying someone. */
  exit: {
    stopLoss: 0.15, // our copy is down this much from what we put in
    trailingStop: 0.2, // or this much from its best value
    maxIdleHours: 72,
    minCopyScore: 45, // score decayed below this
    minHoldHours: 24, // soft exits (idle/score/rotation) wait this long; stops never wait
    minStrikeShare: 0.5, // drop a lead now trading mostly coins Strike can't copy (doesn't wait)
  },

  /** Swap a held lead for a clearly better candidate. */
  rotation: {
    scoreMargin: 0.15, // candidate must beat the weakest holding by this much
    minHoldHours: 72,
    maxPerRun: 1,
  },

  /** Don't re-copy a lead we just dropped. */
  cooldownDays: 7,

  /** Strike taker fee: copies are market IOC orders (Tier 0). */
  takerFee: 0.0005,
  /** Extra cost per copied trade: copies land seconds later at a worse price. Applied to mirrored volume. */
  slippage: 0.0005,

  /** At most this many held traders may share the same main market (avoid one big hidden bet). */
  maxPerTopAsset: 2,

  /** Experiment, off unless switched on from /admin: one extra "bold" slot for a higher-return,
   *  higher-risk trader. Picked by 30d return among leads that pass looser rules; own stop-loss. */
  bold: { minRoi30d: 0.3, maxDrawdown30d: 0.4, minCopyScore: 45, stopLoss: 0.1 },

  /** At most this many copies may hold the same open bet (coin + direction) when a new trader is added. */
  maxSameBet: 2,

  /** Copies can drift into the same bet after they start. If more than maxSameBet copies now hold
   *  the same sizable bet (at least minShare of the lead's account), the weakest one is stopped.
   *  It can come back after the cooldown, once the bet is no longer stacked. */
  overlapExit: { minShare: 0.1, cooldownHours: 24 },

  /** Also follow the next-best candidates on paper, to check the bot's picks beat the ones it skipped. */
  shadowSize: 10,

  /** Keep the state file small. */
  maxDecisionsKept: 300,
  maxEquityPointsKept: 2_000,
} as const;

export type BotConfig = typeof bot;
