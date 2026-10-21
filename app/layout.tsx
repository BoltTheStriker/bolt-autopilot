import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { MotionProvider } from "@/components/motion";
import { site } from "@/lib/config";
import { getCoin } from "@/lib/solada";
import { CoinSeed } from "@/lib/useCoin";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.fullName} ($${site.ticker}) · ${site.tagline}`, template: `%s · $${site.ticker}` },
  description: site.description,
  openGraph: { title: `$${site.ticker}: ${site.tagline}`, description: site.description },
  twitter: { card: "summary_large_image", title: `$${site.ticker}`, description: site.description },
};

export const viewport: Viewport = { themeColor: "#0a0a0a" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Cached (refreshed every ~30s), so pages ship with live numbers instead of empty cards.
  const coin = await getCoin().catch(() => null);
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <MotionProvider>
          <CoinSeed coin={coin}>
            {/* Nav reads the pathname; on routes with unknown params (/share/[id]) it streams in. */}
            <Suspense fallback={null}>
              <Nav />
            </Suspense>
            {children}
            <Footer />
          </CoinSeed>
        </MotionProvider>
      </body>
    </html>
  );
}
