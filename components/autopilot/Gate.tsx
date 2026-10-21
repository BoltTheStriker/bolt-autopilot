"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { checkAdminKey } from "@/lib/adminPreview";
import { autopilot } from "@/lib/autopilotApi";
import { site } from "@/lib/config";
import { WalletEgg } from "./WalletEgg";

// Loaded only after the check passes, so their content isn't in the HTML or sent to everyone else.
const AutopilotLanding = dynamic(() => import("./Landing").then((m) => m.AutopilotLanding), { ssr: false });
const AutopilotApp = dynamic(() => import("./AutopilotApp").then((m) => m.AutopilotApp), { ssr: false });
const ImpactPage = dynamic(() => import("./Impact").then((m) => m.ImpactPage), { ssr: false });

/** Until Autopilot opens, only a verified admin can see its pages. In teaser mode the landing page is public
 *  and the app and impact page send everyone else to it; otherwise they go to the homepage. */
export function AutopilotGate({ page }: { page: "landing" | "app" | "impact" }) {
  const router = useRouter();
  const teaserLanding = site.autopilotTeaser && page === "landing";
  const [ok, setOk] = useState(teaserLanding);
  useEffect(() => {
    if (teaserLanding) return;
    let alive = true;
    Promise.all([autopilot.status().then((s) => s.open, () => false), checkAdminKey()]).then(([open, admin]) => {
      if (!alive) return;
      const onHost = window.location.hostname === "autopilot.boltstriker.io";
      if (open || admin) setOk(true);
      else if (site.autopilotTeaser) router.replace(onHost ? "/" : "/autopilot");
      else if (onHost) window.location.replace("https://www.boltstriker.io/");
      else router.replace("/");
    });
    return () => {
      alive = false;
    };
  }, [router, teaserLanding]);
  if (!ok) return <main className="min-h-screen" />;
  return (
    <>
      {page === "app" ? <AutopilotApp /> : page === "impact" ? <ImpactPage /> : <AutopilotLanding />}
      <WalletEgg />
    </>
  );
}
