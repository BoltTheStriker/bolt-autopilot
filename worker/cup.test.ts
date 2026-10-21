// node --experimental-strip-types --test worker/cup.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONTEST, emptyContest, type ContestStore } from "./contest.ts";
import { resetDemo, startDemo, type DemoStore } from "./demo.ts";
import { cupStandings, freshJoinTime, joinCup, joinMessage, resetBlocked, snapshotCup } from "./cup.ts";

const H = 3_600_000;
const T = 1_800_000_000_000; // cup start
const END = T + 7 * 24 * H;
const contest = (): ContestStore => ({ ...emptyContest(), adaUsd: 0.5, config: { ...DEFAULT_CONTEST, kind: "pnl", minHolding: 1_000_000, payoutDelayDays: 1, start: T, end: END } });
// Each account holds one copy of one trader whose index we move.
function demoWith(...players: [string, string][]): DemoStore {
  const d: DemoStore = { enabled: true, accounts: {} };
  for (const [stake, lead] of players) {
    const a = startDemo(d, stake, `addr1${stake}`, T - 48 * H);
    a.portfolio!.cash = 0;
    a.portfolio!.positions = [{ lead, val: 10_000, cost: 10_000, peak: 10_000, openedAt: T - 48 * H, lastIdx: 1 }];
  }
  return d;
}
// After a fresh start, put the whole $10K into one trader at today's index.
function hold(d: DemoStore, stake: string, lead: string, idxNow = 1) {
  const p = d.accounts[stake].portfolio!;
  p.cash = 0;
  p.positions = [{ lead, val: 10_000, cost: 10_000, peak: 10_000, openedAt: T, lastIdx: idxNow }];
}

test("join message and time window", () => {
  assert.equal(joinMessage("addr1x", "2026-10-19T18:00:00.000Z"), "Join the $BOLT Bot Cup\nWallet: addr1x\nTime: 2026-10-19T18:00:00.000Z");
  const now = Date.parse("2026-10-19T18:05:00Z");
  assert.ok(freshJoinTime("2026-10-19T18:00:00.000Z", now));
  assert.ok(!freshJoinTime("2026-10-19T17:50:00.000Z", now)); // too old
  assert.ok(!freshJoinTime("2026-10-19T18:10:00.000Z", now)); // from the future
  assert.ok(!freshJoinTime("yesterday", now));
});

test("everyone starts the cup fresh with $10K, keeping their rules", () => {
  const d = demoWith(["s1", "A"], ["s2", "B"]);
  const c = contest();
  d.accounts.s1.portfolio!.settings = { ...d.accounts.s1.portfolio!.settings, style: "bold", leverage: 2 };
  joinCup(d.accounts.s1, T, END, T - H, { A: 1.2, B: 1 }); // joined early, while already +20%
  joinCup(d.accounts.s2, T, END, T - H, { A: 1.2, B: 1 });
  assert.equal(d.accounts.s1.cup!.startValue, undefined); // nothing happens until the start
  snapshotCup(d, T, END, T, { A: 1.2, B: 1 }); // cup starts: the +20% is wiped, everyone has $10K
  const a = d.accounts.s1;
  assert.deepEqual([a.portfolio!.cash, a.portfolio!.positions.length, a.portfolio!.settings.style, a.cup!.startValue], [10_000, 0, "bold", 10_000]);
  hold(d, "s1", "A", 1.2);
  hold(d, "s2", "B", 1);
  const r = cupStandings(d, c, T + H, { A: 1.32, B: 1.05 }); // A +10% since start (x2 leverage), B +5%
  assert.equal(r.phase, "live");
  assert.deepEqual(r.leaderboard!.map((x) => [x.key, Math.round(x.pct * 1000) / 10, x.rank]), [["s1", 20, 1], ["s2", 5, 2]]);
  assert.equal(r.leaderboard![0].prizeUsd, 100); // 50% of the $200 base
});

test("late joiners start fresh when they join; nobody joins after the end", () => {
  const d = demoWith(["s1", "A"]);
  const e = joinCup(d.accounts.s1, T, END, T + 2 * H, { A: 1.5 }); // was worth $15K
  assert.deepEqual([e.startValue, d.accounts.s1.portfolio!.cash, d.accounts.s1.portfolio!.positions.length], [10_000, 10_000, 0]);
  assert.throws(() => joinCup(demoWith(["s9", "A"]).accounts.s9, T, END, END, { A: 1 }), /ended/);
});

test("end values freeze when the cup ends", () => {
  const d = demoWith(["s1", "A"]);
  joinCup(d.accounts.s1, T, END, T - H, { A: 1 });
  snapshotCup(d, T, END, T, { A: 1 });
  hold(d, "s1", "A", 1);
  snapshotCup(d, T, END, END, { A: 1.1 });
  const r = cupStandings(d, contest(), END + 5 * H, { A: 3 }); // later moves don't count
  assert.equal(r.phase, "checking");
  assert.equal(Math.round(r.leaderboard![0].pct * 100), 10);
});

test("a player who no longer holds 1M $BOLT can't win; only joined players show", () => {
  const d = demoWith(["s1", "A"], ["s2", "B"], ["s3", "A"]);
  const c = contest();
  for (const k of ["s1", "s2"]) joinCup(d.accounts[k], T, END, T - H, { A: 1, B: 1 });
  snapshotCup(d, T, END, T, { A: 1, B: 1 });
  c.holdings = { s1: { held: 400_000, at: T + H }, s2: { held: 2_000_000, at: T + H } };
  const r = cupStandings(d, c, T + 2 * H, { A: 1.5, B: 1.01 });
  assert.deepEqual(r.leaderboard!.map((x) => x.key), ["s2"]);
  assert.match(r.disqualified![0].out!, /less than 1M/);
  assert.equal(r.players, 2); // s3 never joined
});

test("start fresh: $10K again with the same rules; blocked while competing in a running cup", () => {
  const d = demoWith(["s1", "A"]);
  const a = d.accounts.s1;
  a.portfolio!.settings = { ...a.portfolio!.settings, style: "bold", leverage: 2 };
  joinCup(a, T, END, T - H, { A: 1 });
  assert.equal(resetBlocked(a, T, END, T - 1), false); // before the start: fine, keeps the place
  resetDemo(a, T - 1);
  assert.deepEqual([a.portfolio!.cash, a.portfolio!.positions.length, a.portfolio!.settings.style, a.cup?.cupId], [10_000, 0, "bold", T]);
  snapshotCup(d, T, END, T, { A: 1 });
  assert.equal(resetBlocked(a, T, END, T + H), true); // running: no erasing a bad week
  assert.equal(resetBlocked(a, T, END, END + 2 * 24 * H), false); // well after it ends: fine again
  assert.equal(resetBlocked(demoWith(["s2", "A"]).accounts.s2, T, END, T + H), false); // not in the cup
});
