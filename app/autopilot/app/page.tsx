import type { Metadata } from "next";
import { AutopilotGate } from "@/components/autopilot/Gate";
import { autopilotMeta } from "@/lib/autopilotMeta";

export const metadata: Metadata = autopilotMeta({ title: "Bolt Autopilot · App", path: "/app" });

// The Autopilot app itself: setup, dashboard, Earn, copilot. Admin-only until it opens.
export default function AutopilotAppPage() {
  return <AutopilotGate page="app" />;
}
