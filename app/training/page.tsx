"use client";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { usePermissions } from "@/lib/usePermissions";
import Link from "next/link";
import TrainingLibrary from "@/components/training/TrainingLibrary";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/app/auth-context";
import EmployeeTraining from "@/components/training/EmployeeTraining";

function Content() {
  const permissions = usePermissions();
  const { user } = useAuth();
  const myTraining = useQuery(api.training.myAssignedTraining, user ? { userId: user._id } : "skip");
  if (permissions.isLoading) return <div className="p-8 theme-text-muted">Loading…</div>;
  if (!permissions.menu.training) {
    if (myTraining && myTraining.length > 0) {
      return (
        <div className="flex h-screen theme-bg-primary"><Sidebar /><main className="flex-1 overflow-y-auto"><MobileHeader />
          <header className="sticky top-0 z-10 border-b theme-border-primary theme-bg-card px-6 py-4"><h1 className="text-xl font-bold theme-text-primary">My Training</h1><p className="text-xs theme-text-muted">Videos assigned to you</p></header>
          <EmployeeTraining /></main></div>
      );
    }
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
