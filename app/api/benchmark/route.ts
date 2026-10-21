import { NextResponse } from "next/server";
import data from "@/data/benchmark.json";
import { curveStats } from "@/bot/benchmark";

// Bolt vs the leaderboard, for the impact page: both curves (deduplicated, at most ~240 points) and their stats.
// The data is the repo's data/benchmark.json, advanced every 6 hours by .github/workflows/benchmark.yml.
type Point = { at: number; bolt: number; top: number };

export function GET() {
  const raw = (data as { startedAt: number; points: Point[]; bolt: { positions: unknown[] }; top: { positions: unknown[] } });
  const points = raw.points.filter((p, i, a) => i === 0 || p.at !== a[i - 1].at);
  const step = Math.max(1, Math.ceil(points.length / 240));
  const curve = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  return NextResponse.json(
    {
      startedAt: raw.startedAt,
      updatedAt: points.at(-1)?.at ?? raw.startedAt,
      curve,
      bolt: { ...curveStats(points.map((p) => p.bolt)), traders: raw.bolt.positions.length },
      top: { ...curveStats(points.map((p) => p.top)), traders: raw.top.positions.length },
    },
    { headers: { "cache-control": "public, max-age=600, s-maxage=600" } },
  );
}
