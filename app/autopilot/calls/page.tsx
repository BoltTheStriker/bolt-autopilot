import type { Metadata } from "next";
import { AutopilotGate } from "@/components/autopilot/Gate";

export const metadata: Metadata = {
  title: { absolute: "Bolt Calls · Call it. Strike keeps score." },
  description: "Post a trade idea on any Strike market. Strike's live prices keep score and build each caller's record.",
  robots: { index: false, follow: false }, // beta: not listed yet
};

// autopilot.boltstriker.io/calls: Bolt Calls (beta), the social layer on Strike.
export default function Page() {
  return <AutopilotGate page="calls" />;
}
