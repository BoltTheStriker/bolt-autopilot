import { ImageResponse } from "next/og";
import { site } from "@/lib/config";
import { fetchT } from "@/lib/fetchT";
import { ogFont } from "@/lib/ogFont";
import { decodeDemoCard, GOAL_LABEL, MARKETS_LABEL, parseRealCard, RISK_LABEL, type ShareCard } from "@/lib/autopilotShare";

// Bolt Autopilot result card (1200×630): the preview image under a shared link on X, and a downloadable PNG.
// ?d=… is a demo result carried in the link (always labelled demo); ?id=… is a real account's result,
// read from the Bolt server so the link can't fake it.

const MINT = "#4efab0";
const NEG = "#f43f5e";
const GOLD = "#e8be5a";
const HOST = "autopilot.boltstriker.io";
const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

async function load(params: URLSearchParams): Promise<ShareCard | null> {
  const d = params.get("d");
  if (d) return decodeDemoCard(d);
  const id = params.get("id") ?? "";
  if (!/^[0-9a-f]{12}$/.test(id)) return null;
  const res = await fetchT(`${site.botApi}/autopilot/card/${id}`, { cache: "no-store" }).catch(() => null);
  return res?.ok ? parseRealCard(await res.json().catch(() => null)) : null;
}

/** The demo's value line as an SVG path in a w×h box (flat lines get ±0.5% of room so cents don't look like a rally). */
function curvePath(values: number[], w: number, h: number) {
  const pad = Math.abs(values[0]) * 0.005;
  const min = Math.min(...values, values[0] - pad);
  const max = Math.max(...values, values[0] + pad);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 6 - ((v - min) / span) * (h - 12)).toFixed(1)}`);
  return { line: `M${pts.join(" L")}`, fill: `M0,${h} L${pts.join(" L")} L${w},${h} Z` };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const c = await load(url.searchParams);
  if (!c) return new Response("Not found", { status: 404 });

  const up = c.ret >= 0;
  const color = up ? MINT : NEG;
  const pct = `${up ? "+" : "−"}${Math.abs(c.ret * 100).toFixed(2)}%`;
  const demo = c.kind === "demo";
  const sub = demo
    ? `${c.pnl === null ? "" : `${c.pnl >= 0 ? "+" : "−"}$${Math.abs(c.pnl).toFixed(2)} `}on $1,000 since ${day(c.since)}`
    : `on running copies · live since ${day(c.since)}`;
  const badge = demo ? "DEMO · PRETEND MONEY" : "REAL MONEY ON STRIKE";
  const chips = [RISK_LABEL[c.risk], GOAL_LABEL[c.goal], MARKETS_LABEL[c.markets], `${c.traders} trader${c.traders === 1 ? "" : "s"} copied`];
  const foot = demo ? "Try it with demo money" : "Numbers from the Bolt server";
  const curve = demo && c.curve.length > 1 ? curvePath(c.curve, 520, 200) : null;

  const text = [...new Set(["BOLT AUTOPILOT", "Built on Strike", badge, pct, sub, ...chips, HOST, foot].join(""))].join("");
  const [bold, medium] = await Promise.all([ogFont(700, text), ogFont(500, text)]);
  const fonts = [
    ...(bold ? [{ name: "Space Grotesk", data: bold, weight: 700 as const, style: "normal" as const }] : []),
    ...(medium ? [{ name: "Space Grotesk", data: medium, weight: 500 as const, style: "normal" as const }] : []),
  ];

  const image = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "52px 60px", background: "#070a09", fontFamily: "Space Grotesk", color: "#fff", position: "relative" }}>
        <div style={{ position: "absolute", left: -140, top: -180, width: 780, height: 580, borderRadius: 9999, background: up ? "rgba(78,250,176,0.17)" : "rgba(244,63,94,0.15)", filter: "blur(90px)", display: "flex" }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${site.url}/mascot-512.png`} width={60} height={60} style={{ borderRadius: 9999, background: "#1d6b54" }} alt="" />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: 1 }}>BOLT AUTOPILOT</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, fontSize: 20, fontWeight: 500, color: "rgba(255,255,255,0.6)" }}>
                Built on
                {site.strikeBrand && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`${site.url}/strike/icon.png`} width={20} height={20} style={{ borderRadius: 9999 }} alt="" />
                )}
                <span style={{ color: "#fff", fontWeight: 700 }}>Strike</span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", padding: "9px 18px", borderRadius: 9999, border: `1px solid ${demo ? "rgba(232,190,90,0.45)" : "rgba(78,250,176,0.45)"}`, color: demo ? GOLD : MINT, fontSize: 20, fontWeight: 500, letterSpacing: 3 }}>
            {badge}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 150, fontWeight: 700, letterSpacing: -5, lineHeight: 1, color }}>{pct}</div>
            <div style={{ display: "flex", marginTop: 16, fontSize: 32, fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>{sub}</div>
          </div>
          {curve && (
            <svg width={520} height={200} viewBox="0 0 520 200" style={{ display: "flex" }}>
              <defs>
                <linearGradient id="f" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor={color} stopOpacity="0.32" />
                  <stop offset="1" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={curve.fill} fill="url(#f)" />
              <path d={curve.line} fill="none" stroke={color} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, maxWidth: 760 }}>
            {chips.map((t) => (
              <div key={t} style={{ display: "flex", padding: "10px 18px", borderRadius: 16, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", fontSize: 22, fontWeight: 500 }}>
                {t}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: MINT }}>{HOST}</div>
            <div style={{ display: "flex", marginTop: 6, fontSize: 18, color: "rgba(255,255,255,0.45)" }}>{foot}</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts: fonts.length ? fonts : undefined },
  );
  // Send the finished PNG with its size: X's crawler skips images streamed without a Content-Length.
  const png = await image.arrayBuffer();
  return new Response(png, {
    headers: {
      "content-type": "image/png",
      "content-length": String(png.byteLength),
      "cache-control": demo ? "public, max-age=86400, s-maxage=86400, immutable" : "public, max-age=300, s-maxage=300",
      ...(url.searchParams.has("download") ? { "content-disposition": `attachment; filename="bolt-autopilot-${demo ? "demo" : "result"}.png"` } : {}),
    },
  });
}
