// node --experimental-strip-types --test worker/demo.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { bech32Decode, bech32Encode, cardId, DEMO, demoCard, demoView, migrateAccounts, startDemo, stakeAddressOf, type DemoStore } from "./demo.ts";

test("stake address from a base address matches the chain (Koios)", () => {
  // A real $BOLT holder; Koios reports this stake address for it.
  const addr = "addr1q846lp04wsngv3fcg6m56cvdxgsmh80c3hafycefhdp3y27pun75v8l0fs48f6jm67upqu9yf0wnrhzupfnqx5ar400suynwkl";
  const want = "stake1u8q7fl2xrlh5c2n5afda0wqswzjyhhf3m3wq5esr2w36hhcw0977k";
  assert.equal(stakeAddressOf(addr), want);
});

test("bech32 round-trips and rejects junk", () => {
  const d = bech32Decode("stake1u8q7fl2xrlh5c2n5afda0wqswzjyhhf3m3wq5esr2w36hhcw0977k")!;
  assert.equal(d.hrp, "stake");
  assert.equal(bech32Encode(d.hrp, d.bytes), "stake1u8q7fl2xrlh5c2n5afda0wqswzjyhhf3m3wq5esr2w36hhcw0977k");
  assert.equal(bech32Decode("stake1u8q7fl2xrlh5c2n5afda0wqswzjyhhf3m3wq5esr2w36hhcw0977x"), null); // bad checksum
  assert.equal(stakeAddressOf("not-an-address"), null);
});

test("holders below the minimum are locked; above it can start once, and keep their account", () => {
  const store: DemoStore = { enabled: true, accounts: {} };
  assert.equal(demoView(store, "stake1x", DEMO.minHolding - 1).status, "locked");
  assert.equal(demoView(store, "stake1x", DEMO.minHolding).status, "ready");
  const a = startDemo(store, "stake1x", "addr1x", 1);
  const again = startDemo(store, "stake1x", "addr1x", 2); // idempotent
  assert.equal(again, a);
  const v = demoView(store, "stake1x", DEMO.minHolding * 2);
  assert.equal(v.status, "active");
  assert.equal(v.status === "active" && v.demo.value, DEMO.startBalance);
});

test("share card: numbers come from the holder's portfolio, found by public id only", () => {
  const store: DemoStore = { enabled: true, accounts: {}, track: { "0xlead": { idx: 1, lastFillMs: 0, unrealized: NaN, accountValue: 1, coverage: 1 } } };
  const a = startDemo(store, "stake1abc", "addr1abc", 5);
  a.portfolio!.cash = 0;
  a.portfolio!.positions.push({ lead: "0xlead", units: 10_000, cost: 10_000, peak: 10_000, openedAt: 5, lastIdx: 1 });
  store.track!["0xlead"].idx = 1.025; // trader up 2.5%
  const id = cardId("stake1abc");
  assert.match(id, /^[0-9a-f]{12}$/);
  const c = demoCard(store, id)!;
  assert.equal(Math.round(c.value), 10_250);
  assert.equal(Number(c.pct.toFixed(3)), 0.025);
  assert.equal(c.traders, 1);
  assert.equal(demoCard(store, "000000000000"), null);
});

test("first-version accounts migrate with their value and default settings", () => {
  const store: DemoStore = { enabled: true, accounts: { s: { stake: "s", address: "a", startedAt: 1, startBalance: 10_000, startIndex: 1000 } } };
  migrateAccounts(store, 1010, 2); // bot equity up 1%
  assert.equal(Math.round(store.accounts.s.portfolio!.cash), 10_100);
  assert.equal(store.accounts.s.portfolio!.settings.traders, 5);
});

test("each copy shows its profit and the trader's open trades at the holder's size", () => {
  const store: DemoStore = { enabled: true, accounts: {}, track: { "0xa": { idx: 1.02, lastFillMs: 0, unrealized: 0, accountValue: 100_000, coverage: 0.5, open: [{ coin: "HYPE", long: false, upnl: 4_000 }] } } };
  const a = startDemo(store, "stake1x", "addr1x", 0);
  a.portfolio!.cash = 0;
  a.portfolio!.positions = [{ lead: "0xa", units: 10_000, cost: 10_000, peak: 10_000, openedAt: 0, lastIdx: 1 }];
  const v = demoView(store, "stake1x", DEMO.minHolding);
  assert.equal(v.status, "active");
  const p = v.status === "active" ? v.demo.positions[0] : null;
  assert.equal(Math.round(p!.pnl), 200); // index 1 → 1.02 on $10K
  // Copy is $10.2K of a $100K account, half of it copyable: 5.1% of their $4K open profit.
  assert.deepEqual(p!.open!.map((o) => [o.market, o.long, Math.round(o.pnl)]), [["HYPE", false, 204]]);
});
