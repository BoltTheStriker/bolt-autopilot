import type { MetadataRoute } from "next";
import { site } from "@/lib/config";

// Crawlers (and link previews like X's Twitterbot) may read everything public.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/admin"] }], sitemap: undefined, host: site.url };
}
