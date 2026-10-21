import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { site } from "@/lib/config";
import { ogFont } from "@/lib/ogFont";

// Link preview (1200×630) for Bolt Autopilot's pages on X, Discord and the like. ?p=impact for the impact page.

const MINT = "#4efab0";
const HOST = "autopilot.boltstriker.io";
const PAGES = {
  landing: { size: 60, title: ["Copy trading on Strike,", "on autopilot."], sub: "Say your goal. Bolt copies the best traders for you, inside your limits, on your own Strike account." },
  impact: { size: 72, title: ["What Bolt brings", "to Strike."], sub: "Users, copy-trading volume and RealFi liquidity on Strike Finance, live." },
} as const;

export async function GET(req: Request) {
  const page = new URL(req.url).searchParams.get("p") === "impact" ? PAGES.impact : PAGES.landing;
  const chips = ["Live demo", "AI copilot", "RealFi Earn", "Non-custodial"];
  const text = [...new Set(["BOLT AUTOPILOT", "Built on Strike", ...page.title, page.sub, ...chips, HOST].join(""))].join("");
  const [bold, medium, bolt] = await Promise.all([
    ogFont(700, text),
    ogFont(500, text),
    readFile(join(process.cwd(), "public/og/bolt.png"), "base64").then((b) => `data:image/png;base64,${b}`, () => null),
  ]);
  const fonts = [
    ...(bold ? [{ name: "Space Grotesk", data: bold, weight: 700 as const, style: "normal" as const }] : []),
    ...(medium ? [{ name: "Space Grotesk", data: medium, weight: 500 as const, style: "normal" as const }] : []),
  ];

  const image = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#070a09", fontFamily: "Space Grotesk", color: "#fff", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -120, top: 40, width: 760, height: 620, borderRadius: 9999, background: "rgba(78,250,176,0.22)", filter: "blur(110px)", display: "flex" }} />
        <div style={{ position: "absolute", left: -200, top: -260, width: 700, height: 520, borderRadius: 9999, background: "rgba(78,250,176,0.08)", filter: "blur(100px)", display: "flex" }} />

        <div style={{ width: 720, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 0 52px 64px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", fontSize: 26, fontWeight: 700, letterSpacing: 4, color: MINT }}>BOLT AUTOPILOT</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 9999, border: "1px solid rgba(78,250,176,0.35)", background: "rgba(78,250,176,0.06)", fontSize: 19, fontWeight: 500, color: "rgba(255,255,255,0.75)" }}>
              Built on
              {site.strikeBrand && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${site.url}/strike/icon.png`} width={19} height={19} style={{ borderRadius: 9999 }} alt="" />
              )}
              <span style={{ color: "#fff", fontWeight: 700 }}>Strike</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: page.size, fontWeight: 700, lineHeight: 1.04, letterSpacing: -2.5 }}>{page.title[0]}</div>
            <div style={{ display: "flex", fontSize: page.size, fontWeight: 700, lineHeight: 1.04, letterSpacing: -2.5, color: MINT }}>{page.title[1]}</div>
            <div style={{ display: "flex", marginTop: 22, fontSize: 27, fontWeight: 500, lineHeight: 1.35, color: "rgba(255,255,255,0.7)", maxWidth: 600 }}>{page.sub}</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", gap: 10 }}>
              {chips.map((c) => (
                <div key={c} style={{ display: "flex", padding: "8px 16px", borderRadius: 14, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", fontSize: 19, fontWeight: 500 }}>
                  {c}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: MINT }}>{HOST}</div>
          </div>
        </div>

        {bolt && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bolt} width={540} height={568} style={{ position: "absolute", right: -10, bottom: -40, width: 540, height: 568 }} alt="" />
        )}
      </div>
    ),
    { width: 1200, height: 630, fonts: fonts.length ? fonts : undefined },
  );
  // Send the finished PNG with its size: X's crawler skips images streamed without a Content-Length.
  const png = await image.arrayBuffer();
  return new Response(png, { headers: { "content-type": "image/png", "content-length": String(png.byteLength), "cache-control": "public, max-age=86400, s-maxage=86400" } });
}
