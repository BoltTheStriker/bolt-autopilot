import { redirect } from "next/navigation";

// Autopilot moved to its own page.
export default function OldAutopilotPage() {
  redirect("/autopilot/app");
}
