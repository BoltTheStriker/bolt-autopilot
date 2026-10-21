"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { checkAdminKey } from "@/lib/adminPreview";
import { autopilot } from "@/lib/autopilotApi";

// Loaded only after the check passes, so their content isn't in the HTML or sent to everyone else.
const AutopilotLanding = dynamic(() => import("./Landing").then((m) => m.AutopilotLanding), { ssr: false });
const AutopilotApp = dynamic(() => import("./AutopilotApp").then((m) => m.AutopilotApp), { ssr: false });
const ImpactPage = dynamic(() => import("./Impact").then((m) => m.ImpactPage), { ssr: false });

/** Until Autopilot opens, only a verified admin can see its pages; everyone else goes to the homepage. */
export function AutopilotGate({ page }: { page: "landing" | "app" | "impact" }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([autopilot.status().then((s) => s.open, () => false), checkAdminKey()]).then(([open, admin]) => {
      if (!alive) return;
      if (open || admin) setOk(true);
      else if (window.location.hostname === "autopilot.boltstriker.io") window.location.replace("https://www.boltstriker.io/");
      else router.replace("/");
    });
    return () => {
      alive = false;
    };
  }, [router]);
  if (!ok) return <main className="min-h-screen" />;
  return page === "app" ? <AutopilotApp /> : page === "impact" ? <ImpactPage /> : <AutopilotLanding />;
}
