"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatters, type FormatKey } from "@/lib/format";

/** `label` shows in the tooltip; `tick` (shorter, optional) on the x-axis. */
type Point = { label: string; tick?: string; value: number; reference?: number };

/**
 * Single-series area chart with an optional dashed reference line (e.g. "deposited"),
 * a crosshair + tooltip on hover/touch, and a screen-reader table.
 */
export function AreaChart({
  data,
  color,
  valueName,
  referenceName,
  format,
  height = 260,
  zeroBased = true,
}: {
  data: Point[];
  color: string;
  valueName: string;
  referenceName?: string;
  format: FormatKey;
  height?: number;
  /** false zooms the y-axis to the data range, for series that move a little around a large value. */
  zeroBased?: boolean;
}) {
  const fmt = formatters[format];
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real pixel width so axis text stays legible on phones.
  const [W, setW] = useState(800);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 500 ? Math.round(height * 0.8) : height;

  const { pad, xs, y, ticks, path, area, refPath } = useMemo(() => {
    const vals = data.flatMap((d) => [d.value, d.reference ?? d.value]);
    const max = Math.max(...vals) || 1;
    const min = zeroBased ? 0 : Math.min(...vals);
    // Flat (or nearly flat) series still get a readable band instead of repeating one label.
    const spread = max - min > Math.abs(max) * 0.002 ? max - min : Math.abs(max) * 0.02 || 1;
    const step = niceStep(spread / 4);
    const bottom = zeroBased ? 0 : Math.floor((min - spread * 0.1) / step) * step;
    const top = Math.ceil((zeroBased ? max : max + spread * 0.1) / step) * step;
    const ticks = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, i) => bottom + i * step);
    // Left gutter sized to the widest y label (tiny prices make long ones), ~7px per mono char.
    const widest = Math.max(...ticks.map((t) => fmt(t).length));
    const pad = { t: 16, r: 12, b: 28, l: Math.max(44, widest * 7 + 14) };
    const xs = data.map((_, i) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, data.length - 1));
    const y = (v: number) => pad.t + (1 - (v - bottom) / (top - bottom)) * (H - pad.t - pad.b);
    const line = (get: (d: Point) => number) => data.map((d, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${y(get(d)).toFixed(1)}`).join("");
    const path = line((d) => d.value);
    const area = `${path}L${xs.at(-1)},${y(bottom)}L${xs[0]},${y(bottom)}Z`;
    const refPath = data.some((d) => d.reference !== undefined) ? line((d) => d.reference ?? 0) : null;
    return { pad, xs, y, ticks, path, area, refPath };
  }, [data, H, W, fmt, zeroBased]);

  // Greedy left-to-right x labels that never overlap (~6.6px per 11px mono char); the last date always shows.
  const xTicks: number[] = [];
  {
    const width = (i: number) => (data[i].tick ?? data[i].label).length * 6.6 + 16;
    const extent = (i: number): [number, number] =>
      i === 0 ? [xs[0], xs[0] + width(0)] : i === data.length - 1 ? [xs[i] - width(i), xs[i]] : [xs[i] - width(i) / 2, xs[i] + width(i) / 2];
    for (let i = 0; i < data.length; i++) {
      const prev = xTicks.at(-1);
      const label = (k: number) => data[k].tick ?? data[k].label;
      if (prev === undefined || (extent(i)[0] >= extent(prev)[1] && label(i) !== label(prev))) xTicks.push(i);
    }
    const last = data.length - 1;
    const same = (k: number) => (data[k].tick ?? data[k].label) === (data[last].tick ?? data[last].label);
    while (xTicks.length && xTicks.at(-1) !== last && (extent(last)[0] < extent(xTicks.at(-1)!)[1] || same(xTicks.at(-1)!))) xTicks.pop();
    if (xTicks.at(-1) !== last) xTicks.push(last);
  }

  if (!data.length) return null;

  const pick = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    setHover(best);
  };

  const h = hover !== null ? data[hover] : null;
  const hx = hover !== null ? xs[hover] : 0;

  return (
    <div className="relative">
      <div
        ref={wrap}
        className="relative touch-pan-y"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${valueName} over time`}>
          <defs>
            <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
              <text x={pad.l - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-white/40 font-mono text-[11px]">
                {fmt(t)}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} x={xs[i]} y={H - 8} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} className="fill-white/40 font-mono text-[11px]">
              {data[i].tick ?? data[i].label}
            </text>
          ))}
          <path d={area} fill={`url(#g${id})`} />
          {refPath && <path d={refPath} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" strokeDasharray="5 5" />}
          <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          {h && (
            <g>
              <line x1={hx} x2={hx} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.25)" />
              {h.reference !== undefined && <circle cx={hx} cy={y(h.reference)} r="4" fill="#d0d0d0" stroke="#121212" strokeWidth="2" />}
              <circle cx={hx} cy={y(h.value)} r="5" fill={color} stroke="#121212" strokeWidth="2" />
            </g>
          )}
        </svg>

        {h && (
          <div
            className="card pointer-events-none absolute top-2 z-10 min-w-40 rounded-xl px-3 py-2 text-xs"
            style={{ left: `${(hx / W) * 100}%`, transform: `translateX(${hx > W * 0.6 ? "calc(-100% - 12px)" : "12px"})` }}
          >
            <p className="font-mono text-white/50">{h.label}</p>
            <p className="mt-1 flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-soft">
                <span className="size-2 rounded-full" style={{ background: color }} />
                {valueName}
              </span>
              <span className="font-mono text-white">{fmt(h.value)}</span>
            </p>
            {h.reference !== undefined && referenceName && (
              <p className="mt-0.5 flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-soft">
                  <span className="h-0 w-2.5 border-t border-dashed border-white/60" />
                  {referenceName}
                </span>
                <span className="font-mono text-white">{fmt(h.reference)}</span>
              </p>
            )}
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>{valueName}</caption>
        <thead>
          <tr><th>Date</th><th>{valueName}</th>{referenceName && <th>{referenceName}</th>}</tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}><td>{d.label}</td><td>{fmt(d.value)}</td>{referenceName && <td>{fmt(d.reference ?? 0)}</td>}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
