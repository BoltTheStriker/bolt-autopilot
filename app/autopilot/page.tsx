import type { Metadata } from "next";
import { AutopilotGate } from "@/components/autopilot/Gate";

// Neutral until launch: the page is admin-only for now. At launch: title "Bolt Autopilot" + a description.
export const metadata: Metadata = {
  robots: { index: false }, // beta
};

// Bolt Autopilot's own page: the product story plus the setup itself (#start). Admin-only until it opens.
export default function AutopilotPage() {
  return <AutopilotGate page="landing" />;
}
