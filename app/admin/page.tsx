import type { Metadata } from "next";
import { AdminPanel } from "@/components/AdminPanel";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

// Controls for the copy-trade bot. Every action is checked by the worker against ADMIN_KEY;
// this page holds no secrets and does nothing without the key.
export default function AdminPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-32 pb-10 sm:px-6">
      <h1 className="font-display text-4xl font-bold tracking-tight">Bot control</h1>
      <p className="mt-2 text-muted">Switch the copy-trade bot between paper, dry run and live. Every live copy has a Strike-side stop-loss.</p>
      <AdminPanel />
    </main>
  );
}
