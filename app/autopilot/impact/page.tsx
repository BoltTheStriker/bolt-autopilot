import type { Metadata } from "next";
import { AutopilotGate } from "@/components/autopilot/Gate";

export const metadata: Metadata = {
  robots: { index: false }, // beta, like the other Autopilot pages
};

// Bolt × Strike impact: live numbers on what Bolt brings to Strike. Admin-only until Autopilot opens.
export default function ImpactPage() {
  return <AutopilotGate page="impact" />;
}
