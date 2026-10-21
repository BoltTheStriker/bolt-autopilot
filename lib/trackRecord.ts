import type { Scan } from "@/bot/strategy";

export type TrackRecord = {
  total: number; // combined 30-day return (0.12 = +12%)
  curve: { at: number; value: number }[]; // combined cumulative return, daily
  leads: { lead: string; roi30d: number }[];
};

/**
 * What copying the bot's current traders, in equal slots, would have returned over their
 * last 30 days, using their public PnL curves from Strike and only the share of their
 * trading Strike can mirror (coverage). A historical view, not the bot's own result.
 */
export function combinedTrackRecord(scan: Scan | undefined): TrackRecord | null {
  // Strike's 30-day ROI is the authoritative number (it accounts for deposits/withdrawals);
  // the PnL curve only supplies the shape, so scale it to end exactly at that ROI. If the
  // curve disagrees in sign, fall back to a straight line.
  const tr = (scan?.trackRecord ?? [])
    .filter((t) => t.curve.length > 1)
    .map((t) => {
      const end = t.curve.at(-1)![1];
      const t0 = t.curve[0][0];
      const span = t.curve.at(-1)![0] - t0 || 1;
      const curve: [number, number][] =
        end !== 0 && Math.sign(end) === Math.sign(t.roi30d)
          ? t.curve.map(([ts, r]) => [ts, (r / end) * t.roi30d])
          : t.curve.map(([ts]) => [ts, ((ts - t0) / span) * t.roi30d]);
      return { ...t, curve };
    });
  if (!tr.length) return null;
  const end = Math.max(...tr.map((t) => t.curve.at(-1)![0]));
  const day = 86_400_000;
  const grid = Array.from({ length: 31 }, (_, i) => end - (30 - i) * day);
  // Each lead's return at time t = latest curve point at or before t (0 before their first point).
  const at = (c: [number, number][], t: number) => {
    let v = 0;
    for (const [ts, r] of c) {
      if (ts > t) break;
      v = r;
    }
    return v;
  };
  const curve = grid.map((t) => ({ at: t, value: tr.reduce((s, x) => s + at(x.curve, t) * x.coverage, 0) / tr.length }));
  return { total: curve.at(-1)!.value, curve, leads: tr.map((t) => ({ lead: t.lead, roi30d: t.roi30d })) };
}
