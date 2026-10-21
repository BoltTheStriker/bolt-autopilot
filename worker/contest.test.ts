// node --experimental-strip-types --test worker/contest.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { addTrades, DEFAULT_CONTEST, emptyContest, parseTrade, standings, toCheck, type ContestStore, type Trade } from "./contest.ts";

const H = 3_600_000;
const T = 1_800_000_000_000;
const trade = (o: Partial<Trade> & { key: string; side: Trade["side"]; ada: number; at?: number }): Trade => ({
  atMs: o.at ?? T + H,
  side: o.side,
  lovelace: o.ada * 1e6,
  tokens: o.ada * 2_000, // 0.0005 ADA a token
  trader: `addr1${o.key}`,
  key: o.key,
  tx: `${o.key}-${o.side}-${o.ada}-${o.at ?? 0}`,
  dev: o.dev ?? false,
});
const store = (): ContestStore => ({ ...emptyContest(), config: { ...DEFAULT_CONTEST, poolShare: 1, start: T, end: T + 7 * 24 * H, exclude: ["team"] }, adaUsd: 0.5 });

test("parses Solada's trade feed", () => {
  const t = parseTrade({ atMs: 5, side: "buy", lovelace: "69000000", tokens: "181307441841", trader: "addr1x", traderKey: "s3f", tx: "ab", dev: false })!;
  assert.deepEqual([t.side, t.lovelace, Math.round(t.tokens), t.key], ["buy", 69_000_000, 181_307, "s3f"]);
  assert.equal(parseTrade({ side: "swap" }), null);
});

test("ranks by ADA bought; a sell disqualifies; dev and team wallets can't win", () => {
  const s = store();
  addTrades(s, [
    trade({ key: "a", side: "buy", ada: 500 }),
    trade({ key: "a", side: "buy", ada: 300, at: T + 2 * H }), // 800 total
    trade({ key: "b", side: "buy", ada: 1_000 }),
    trade({ key: "b", side: "sell", ada: 100, at: T + 3 * H }), // sold → out
    trade({ key: "c", side: "buy", ada: 200 }),
    trade({ key: "team", side: "buy", ada: 5_000 }),
    trade({ key: "d", side: "buy", ada: 9_000, dev: true }),
    trade({ key: "e", side: "buy", ada: 9_000, at: T - H }), // before the start: not counted
  ]);
  const r = standings(s, T + 4 * H);
  assert.equal(r.phase, "live");
  assert.deepEqual(r.leaderboard!.map((e) => [e.key, e.boughtAda, e.rank]), [["a", 800, 1], ["c", 200, 2]]);
  assert.deepEqual(r.disqualified!.map((e) => [e.key, e.out]), [["b", "sold during the contest"]]);
});

test("the pool grows with every trade in the window (sells too)", () => {
  assert.equal(standings({ ...store(), config: { ...store().config!, poolShare: DEFAULT_CONTEST.poolShare } }, T + H).pool!.sharePct, 0.25); // default: 0.25% of each trade
  const s = store();
  addTrades(s, [trade({ key: "a", side: "buy", ada: 10_000 }), trade({ key: "b", side: "sell", ada: 5_000 })]);
  const r = standings(s, T + 4 * H);
  // 15,000 ADA traded × 2% fee × 50% project share × 100% into the pool = 150 ADA = $75.
  assert.equal(Math.round(r.pool!.addedAda), 150);
  assert.equal(Math.round(r.pool!.totalUsd), 275);
  assert.deepEqual(r.prizes!.map(Math.round), [138, 83, 55]);
  assert.equal(r.leaderboard![0].prizeUsd, r.prizes![0]);
});

test("moving tokens out disqualifies; buying back requalifies; duplicates are ignored", () => {
  const s = store();
  const buy = trade({ key: "a", side: "buy", ada: 500 }); // 1,000,000 tokens
  assert.equal(addTrades(s, [buy, buy]), 1);
  s.holdings.a = { held: 400_000, at: T + 5 * H };
  let r = standings(s, T + 6 * H);
  assert.equal(r.disqualified![0].out, "moved or sold the $BOLT it bought");
  assert.deepEqual(toCheck(s, T + 6 * H).map((e) => e.key), ["a"]); // still re-checked
  s.holdings.a = { held: 1_000_000, at: T + 7 * H };
  r = standings(s, T + 8 * H);
  assert.equal(r.leaderboard![0].rank, 1);
});

test("phases: upcoming, live, checking until the payout date, then final", () => {
  const s = store();
  const end = T + 7 * 24 * H;
  assert.equal(standings(s, T - H).phase, "upcoming");
  assert.equal(standings(s, end + H).phase, "checking");
  assert.equal(standings(s, end + 3 * 24 * H + 1).phase, "final");
  assert.equal(standings(emptyContest(), T).phase, "off");
});

test("the board shows a wallet's ADA Handle when it has one", () => {
  const s = store();
  addTrades(s, [trade({ key: "a", side: "buy", ada: 100 }), trade({ key: "b", side: "buy", ada: 50 })]);
  s.handles = { a: { handle: "red_beast", at: T } };
  const r = standings(s, T + 2 * H);
  assert.deepEqual(r.leaderboard!.map((e) => e.handle), ["red_beast", null]);
});
