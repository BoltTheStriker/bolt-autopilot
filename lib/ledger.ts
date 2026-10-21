import raw from "@/data/ledger.json";
import history from "@/data/strike-history.json";

/** A buyback-and-burn paid for by copy-trade profits. */
export type Burn = {
  date: string;
  txHash: string;
  amount: number; // tokens burned
  ada: number; // copy-trade profit ADA spent on the buyback
};

/** Daily mark of the Strike copy-trade account, written by scripts/snapshot-strike.mjs. USD. */
export type StrikeMark = { date: string; equity: number; netDeposited: number; pnl: number };

export type Ledger = { burns: Burn[]; history: StrikeMark[] };

export function getLedger(): Ledger {
  return { burns: (raw as { burns: Burn[] }).burns, history: history as StrikeMark[] };
}

export function totals(l: Ledger) {
  return {
    burned: l.burns.reduce((s, b) => s + b.amount, 0),
    burnedAda: l.burns.reduce((s, b) => s + b.ada, 0),
  };
}
