import type { Metadata } from "next";
import { AutopilotGate } from "@/components/autopilot/Gate";

export const metadata: Metadata = {
  robots: { index: false }, // beta; neutral until launch like /autopilot
};

// The Autopilot app itself: setup, dashboard, Earn, copilot. Admin-only until it opens.
export default function AutopilotAppPage() {
  return <AutopilotGate page="app" />;
}
