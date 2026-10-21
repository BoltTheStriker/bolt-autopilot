"use client";

// Who may go into Autopilot right now: everyone once it's open; before that only a verified admin.
// In teaser mode the landing page is public and its "launch" buttons show "Opening soon" for everyone else.
import { useAutopilotOpen } from "@/lib/autopilotApi";
import { useVerifiedAdmin } from "@/lib/adminPreview";
import { site } from "@/lib/config";

export function useAutopilotAccess(): { locked: boolean } {
  const open = useAutopilotOpen();
  const admin = useVerifiedAdmin();
  return { locked: site.autopilotTeaser && !open && !admin };
}
