import type { Metadata } from "next";
import { AutopilotGate } from "@/components/autopilot/Gate";
import { autopilotMeta } from "@/lib/autopilotMeta";

export const metadata: Metadata = autopilotMeta({
  title: "Bolt × Strike · What Bolt brings to Strike",
  path: "/impact",
  description: "Live numbers on what Bolt brings to Strike Finance: new Strike accounts opened through Bolt, copy-trading volume, the live bot's result and RealFi liquidity.",
  image: "impact",
});

// Bolt × Strike impact: live numbers on what Bolt brings to Strike. Admin-only until Autopilot opens.
export default function ImpactPage() {
  return <AutopilotGate page="impact" />;
}
