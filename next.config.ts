import type { NextConfig } from "next";

// Bolt Autopilot's own address: autopilot.boltstriker.io/ is the landing page, /app the app.
const AUTOPILOT_HOST = [{ type: "host" as const, value: "autopilot.boltstriker.io" }];
const AUTOPILOT = "https://autopilot.boltstriker.io";
// The main site forwards its old Autopilot addresses there (only on the real domains, not locally).
const MAIN_HOSTS = ["www.boltstriker.io", "boltstriker.io"].map((value) => [{ type: "host" as const, value }]);

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The result card reads Bolt's meme pictures from disk: ship them with that route.
  outputFileTracingIncludes: { "/api/autopilot-card": ["./public/memes/card/*.jpg"], "/api/autopilot-og": ["./public/og/bolt.png"] },
  partialPrefetching: true,
  // The platform moved from /dashboard to /app when the marketing homepage was split out.
  async redirects() {
    return [
      { source: "/dashboard", destination: "/app", permanent: true },
      // On the Autopilot host, old /autopilot links go to the clean addresses.
      { source: "/autopilot", has: AUTOPILOT_HOST, destination: "/", permanent: false },
      { source: "/autopilot/:path*", has: AUTOPILOT_HOST, destination: "/:path*", permanent: false },
      { source: "/app/autopilot", has: AUTOPILOT_HOST, destination: "/app", permanent: false },
      ...MAIN_HOSTS.flatMap((has) => [
        { source: "/autopilot", has, destination: `${AUTOPILOT}/`, permanent: false },
        { source: "/autopilot/:path*", has, destination: `${AUTOPILOT}/:path*`, permanent: false },
        { source: "/app/autopilot", has, destination: `${AUTOPILOT}/app`, permanent: false },
      ]),
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", has: AUTOPILOT_HOST, destination: "/autopilot" },
        { source: "/app", has: AUTOPILOT_HOST, destination: "/autopilot/app" },
        { source: "/impact", has: AUTOPILOT_HOST, destination: "/autopilot/impact" },
        { source: "/share", has: AUTOPILOT_HOST, destination: "/autopilot/share" },
        { source: "/wallet", has: AUTOPILOT_HOST, destination: "/autopilot/wallet" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  turbopack: {
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
