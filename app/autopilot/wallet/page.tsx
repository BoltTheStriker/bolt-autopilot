import type { Metadata } from "next";
import { WalletConceptPage } from "@/components/autopilot/WalletConcept";

// autopilot.boltstriker.io/wallet: the hidden "Autopilot in your wallet" concept, playable with practice money.
export const metadata: Metadata = {
  title: { absolute: "Bolt Autopilot · In your wallet (concept)" },
  description: "Strike perps inside a Cardano wallet: Bolt Autopilot as a Trade tab. A playable concept with practice money.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <WalletConceptPage />;
}
