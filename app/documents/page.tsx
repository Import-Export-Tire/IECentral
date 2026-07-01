"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import {
  DocHubProvider,
  DocHubRail,
  MobileNav,
  FileBrowser,
  ContextMenu,
  PreviewModal,
  UploadModal,
  FolderModal,
  ShareAccessModal,
  GroupsModal,
  ManageDrawer,
} from "@/components/dochub";
import { useDocHub } from "@/components/dochub/DocHubContext";
import { usePermissions } from "@/lib/usePermissions";

// Route guard: redirect users without Doc Hub access back to home.
function DocHubGate({ children }: { children: React.ReactNode }) {
  const permissions = usePermissions();
  const router = useRouter();
  useEffect(() => {
    if (!permissions.isLoading && !permissions.menu.docHub) router.push("/");
  }, [permissions.isLoading, permissions.menu.docHub, router]);
  if (permissions.isLoading) return null;
  if (!permissions.menu.docHub) return null;
  return <>{children}</>;
}

// Global-search deep link: ?doc=<id> opens that document's preview once it's loaded.
function DocDeepLink() {
  const { documents, handlePreview } = useDocHub();
  const doneRef = useRef(false);
  useEffect(() => {
    if (doneRef.current || !documents) return;
    const id = new URLSearchParams(window.location.search).get("doc");
    if (!id) return;
    const doc = documents.find((d) => String(d._id) === id);
    if (doc) { doneRef.current = true; void handlePreview(doc); }
  }, [documents, handlePreview]);
  return null;
}

function DocumentsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden">
        <MobileHeader />

        <DocHubProvider>
          <DocDeepLink />
          <MobileNav />
          <div className="flex-1 flex overflow-hidden">
            {/* Plain-language rail (desktop) */}
            <DocHubRail />

            {/* File Browser — top bar, rail-driven content, cards */}
            <FileBrowser />
          </div>

          {/* Modals & Overlays */}
          <ContextMenu />
          <PreviewModal />
          <UploadModal />
          <FolderModal />
          <ShareAccessModal />
          <GroupsModal />
          <ManageDrawer />
        </DocHubProvider>
      </main>
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Protected>
      <DocHubGate>
        <DocumentsContent />
      </DocHubGate>
    </Protected>
  );
}
