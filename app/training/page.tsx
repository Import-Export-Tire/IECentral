"use client";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { usePermissions } from "@/lib/usePermissions";
import Link from "next/link";
import TrainingLibrary from "@/components/training/TrainingLibrary";

function Content() {
  const permissions = usePermissions();
  if (permissions.isLoading) return <div className="p-8 theme-text-muted">Loading…</div>;
  if (!permissions.menu.training) {
    return <div className="p-8"><p className="theme-text-primary font-medium">You don&apos;t have access to Training.</p><Link href="/" className="text-[#007AFF] text-sm">Back to dashboard</Link></div>;
  }
  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className="sticky top-0 z-10 border-b theme-border-primary theme-bg-card px-6 py-4">
          <h1 className="text-xl font-bold theme-text-primary">Training</h1>
          <p className="text-xs theme-text-muted">TIA training videos · authorized presenters only</p>
        </header>
        <TrainingLibrary />
      </main>
    </div>
  );
}

export default function TrainingPage() {
  return <Protected><Content /></Protected>;
}
