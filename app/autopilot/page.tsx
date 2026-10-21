import type { Metadata } from "next";
import { AutopilotGate } from "@/components/autopilot/Gate";
import { autopilotMeta } from "@/lib/autopilotMeta";
import { site } from "@/lib/config";

export const metadata: Metadata = autopilotMeta({ title: "Bolt Autopilot · Copy trading on Strike, on autopilot", path: "/", index: site.autopilotTeaser });

// Bolt Autopilot's own page: the product story plus the setup itself (#start). Admin-only until it opens.
export default function AutopilotPage() {
  return <AutopilotGate page="landing" />;
}
