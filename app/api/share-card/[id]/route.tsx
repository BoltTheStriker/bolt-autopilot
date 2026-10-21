import { ImageResponse } from "next/og";
import { site } from "@/lib/config";
import { fetchT } from "@/lib/fetchT";

// PnL card for a holder's demo account, used as the share link's preview image on X
// (and as a downloadable PNG). Numbers come from the bot server, so the link can't fake them.

type Card = { startedAt: number; startBalance: number; value: number; pnl: number; pct: number; traders: number; style?: string; leverage?: number };

const MINT = "#4efab0";
const NEG = "#f43f5e";
const usd = (v: number) => `$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Space Grotesk from Google Fonts (TTF, only the glyphs used); falls back to the default font. */
async function font(weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetchT(`https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@${weight}&text=${encodeURIComponent(text)}`)).text();
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    return url ? await (await fetchT(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{12}$/.test(id)) return new Response("Not found", { status: 404 });
  const res = await fetchT(`${site.botApi}/demo/card/${id}`, { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return new Response("Not found", { status: 404 });
  const c = (await res.json()) as Card;

  const up = c.pnl >= 0;
  const color = up ? MINT : NEG;
  const pct = `${up ? "+" : "−"}${Math.abs(c.pct * 100).toFixed(2)}%`;
  const pnl = `${up ? "+" : "−"}${usd(c.pnl)}`;
  // Leverage is shown on the card, so a 3x result is never passed off as 1x.
  const badge = ["DEMO", c.style?.toUpperCase(), (c.leverage ?? 1) > 1 ? `${c.leverage}X` : null].filter(Boolean).join(" · ");
  const stats = [["Balance", usd(c.value)], ["Traders copied", String(c.traders)]];
  const lines = [`$${site.ticker} COPY-TRADE BOT`, badge, ...stats.flat(), pct, pnl, `on ${usd(c.startBalance)} since ${day(c.startedAt)}`, "Balance", usd(c.value), "Traders copied", String(c.traders), site.url.replace("https://", "") + "/app/try", "Demo · fake money"];
  const text = [...new Set(lines.join(""))].join("");
  const [bold, medium] = await Promise.all([font(700, text), font(500, text)]);
  const fonts = [
    ...(bold ? [{ name: "Space Grotesk", data: bold, weight: 700 as const, style: "normal" as const }] : []),
    ...(medium ? [{ name: "Space Grotesk", data: medium, weight: 500 as const, style: "normal" as const }] : []),
  ];
  const download = new URL(req.url).searchParams.has("download");

  const image = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 64px", background: "#070a09", fontFamily: "Space Grotesk", color: "#fff", position: "relative" }}>
        <div style={{ position: "absolute", left: -120, top: -160, width: 760, height: 560, borderRadius: 9999, background: up ? "rgba(78,250,176,0.18)" : "rgba(244,63,94,0.16)", filter: "blur(90px)", display: "flex" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${site.url}/mascot-512.png`} width={64} height={64} style={{ borderRadius: 9999, background: "#1d6b54" }} alt="" />
            <div style={{ display: "flex", fontSize: 26, fontWeight: 500, letterSpacing: 6, color: MINT }}>{`$${site.ticker} COPY-TRADE BOT`}</div>
          </div>
          <div style={{ display: "flex", padding: "8px 18px", borderRadius: 9999, border: "1px solid rgba(232,190,90,0.45)", color: "#e8be5a", fontSize: 22, fontWeight: 500, letterSpacing: 4 }}>{badge}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 168, fontWeight: 700, letterSpacing: -6, lineHeight: 1, color }}>{pct}</div>
          <div style={{ display: "flex", marginTop: 14, fontSize: 40, fontWeight: 500, color: "rgba(255,255,255,0.85)" }}>
            <span style={{ color }}>{pnl}</span>
            <span style={{ marginLeft: 16, color: "rgba(255,255,255,0.55)" }}>{`on $${Math.round(c.startBalance).toLocaleString("en-US")} since ${day(c.startedAt)}`}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 20 }}>
            {stats.map(([k, v]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", padding: "16px 22px", borderRadius: 20, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ display: "flex", fontSize: 20, color: "rgba(255,255,255,0.5)" }}>{k}</div>
                <div style={{ display: "flex", marginTop: 4, fontSize: 34, fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: MINT }}>{site.url.replace("https://", "") + "/app/try"}</div>
            <div style={{ display: "flex", marginTop: 6, fontSize: 20, color: "rgba(255,255,255,0.4)" }}>Demo · fake money</div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: fonts.length ? fonts : undefined,
    },
  );
  // Send the finished PNG with its size: X's crawler skips images streamed without a Content-Length.
  const png = await image.arrayBuffer();
  return new Response(png, {
    headers: {
      "content-type": "image/png",
      "content-length": String(png.byteLength),
      "cache-control": "public, max-age=300, s-maxage=300",
      ...(download ? { "content-disposition": `attachment; filename="bolt-demo-${id}.png"` } : {}),
    },
  });
}
