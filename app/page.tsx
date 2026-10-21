import { DeskSection } from "@/components/home/DeskSection";
import { HomeHero } from "@/components/home/HomeHero";
import { TokenomicsHome } from "@/components/home/TokenomicsHome";
import { WhyBento } from "@/components/home/WhyBento";
import { Marquee } from "@/components/Marquee";
import { InView } from "@/components/motion";
import { TrackRecord } from "@/components/TrackRecord";
import { FaqSection, FinalCta, Roadmap, Split } from "@/components/Sections";

// Marketing homepage (like strikefinance.org). The platform itself lives at /app.
export default function Home() {
  return (
    <main>
      <HomeHero />
      <Marquee />
      <section className="relative mx-auto max-w-6xl px-4 pt-24 sm:px-6">
        <InView>
          <TrackRecord />
        </InView>
      </section>
      <Split />
      <DeskSection />
      <WhyBento />
      <TokenomicsHome />
      <Roadmap />
      <FaqSection />
      <FinalCta />
    </main>
  );
}
