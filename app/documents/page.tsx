"use client";

import { useEffect, useRef } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import {
  DocHubProvider,
  DocHubSidebar,
  FileBrowser,
  ContextMenu,
  PreviewModal,
  UploadModal,
  FolderModal,
  ShareAccessModal,
  GroupsModal,
} from "@/components/dochub";
import { useDocHub } from "@/components/dochub/DocHubContext";

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
          <div className="flex-1 flex overflow-hidden">
            {/* Doc Hub Sidebar — folder tree, privacy tiers, storage meter */}
            <DocHubSidebar />

            {/* File Browser — breadcrumbs, grid/list, file cards */}
            <FileBrowser />
          </div>

          {/* Modals & Overlays */}
          <ContextMenu />
          <PreviewModal />
          <UploadModal />
          <FolderModal />
          <ShareAccessModal />
          <GroupsModal />
        </DocHubProvider>
      </main>
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Protected>
      <DocumentsContent />
    </Protected>
  );
}
