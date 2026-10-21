import { AppTabs } from "@/components/dashboard/AppTabs";

// Shared frame for the app: the background glow and the $BOLT / Copy-trade bot tabs.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative mx-auto max-w-6xl px-4 pt-28 sm:px-6 sm:pt-32">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 overflow-hidden">
        <div className="absolute top-0 left-1/2 h-96 w-[900px] -translate-x-1/2 rounded-full bg-mint/8 blur-[140px]" />
      </div>
      <AppTabs />
      <div className="mt-8">{children}</div>
    </main>
  );
}
