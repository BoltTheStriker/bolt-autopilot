import type { Metadata } from "next";

// Titles, descriptions and the link preview for Bolt Autopilot's pages (autopilot.boltstriker.io).
// Kept out of search engines until Autopilot opens to everyone.
const HOST = "https://autopilot.boltstriker.io";
const DESCRIPTION = "Say your goal and Bolt copies the best traders on Strike Finance for you, inside hard limits you choose, on your own Strike account. Try the live demo.";

export function autopilotMeta(opts: { title: string; path: string; description?: string; image?: "landing" | "impact" }): Metadata {
  const description = opts.description ?? DESCRIPTION;
  const image = { url: `/api/autopilot-og${opts.image === "impact" ? "?p=impact" : ""}`, width: 1200, height: 630, alt: opts.title };
  return {
    title: { absolute: opts.title },
    description,
    alternates: { canonical: `${HOST}${opts.path}` },
    robots: { index: false, follow: false }, // beta: until AUTOPILOT_PUBLIC
    openGraph: { type: "website", siteName: "Bolt Autopilot", url: `${HOST}${opts.path}`, title: opts.title, description, images: [image] },
    twitter: { card: "summary_large_image", site: "@bolthestriker", title: opts.title, description, images: [image.url] },
  };
}
