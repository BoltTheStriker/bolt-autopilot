// Appends today's copy-trade mark to data/strike-history.json. Run daily by
// .github/workflows/strike-snapshot.yml; Strike has no public per-account history,
// so this file *is* the history behind the equity chart.
//   node --experimental-strip-types scripts/snapshot-strike.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { site } from "../lib/config.ts";

const FILE = new URL("../data/strike-history.json", import.meta.url);
const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const json = async (url) => {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
};

let address = process.env.TEAM_ADDRESS || site.wallets.copyTrade; // env override is handy for testing
if (!address && site.solada.id) {
  const launches = await json("https://www.solada.fun/api/launches");
  address = launches.find((l) => l.id === site.solada.id)?.launcherAddress ?? "";
}
if (!address) {
  console.log("No team wallet configured yet, nothing to snapshot.");
  process.exit(0);
}

const { entries = [] } = await json("https://api.strikefinance.org/stat/v1/stats/leaderboard");
const rows = entries.filter((e) => e.blockchain_address === address && !e.vault_id);
if (!rows.length) {
  console.log(`No Strike account for ${address} yet.`);
  process.exit(0);
}
const sum = (k) => rows.reduce((s, e) => s + n(e[k]), 0);
const round = (v) => Math.round(v * 100) / 100;
const mark = {
  date: new Date().toISOString().slice(0, 10),
  equity: round(sum("equity")),
  netDeposited: round(sum("deposits") - sum("withdrawals")),
  pnl: round(sum("total_pnl")),
};

const history = JSON.parse(readFileSync(FILE, "utf8")).filter((m) => m.date !== mark.date);
history.push(mark);
writeFileSync(FILE, JSON.stringify(history, null, 2) + "\n");
console.log("Recorded", mark);
