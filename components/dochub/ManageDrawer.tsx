"use client";

import { useState } from "react";
import { useDocHub } from "./DocHubContext";
import { CATEGORIES, formatFileSize } from "./types";
import FolderUploadModal from "./FolderUploadModal";

export default function ManageDrawer() {
  const {
    isDark, isAdmin, showManageDrawer, setShowManageDrawer,
    storageUsage, expiringDocuments, unsignedDocuments,
    selectedCategory, setSelectedCategory, viewMode, setViewMode,
    showArchived, setShowArchived, setShowGroupsModal, currentFolderId,
  } = useDocHub();

  const [showFolderUpload, setShowFolderUpload] = useState(false);

  if (!isAdmin || !showManageDrawer) return null;

  const close = () => setShowManageDrawer(false);
  const sectionTitle = `text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`;
  const card = `rounded-xl p-3 ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`;

  return (
    <>
    <div className="fixed inset-0 z-50 flex justify-end" onClick={close}>
      <div className={`absolute inset-0 ${isDark ? "bg-black/60" : "bg-black/30"} backdrop-blur-sm`} />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-sm h-full overflow-y-auto shadow-2xl ${isDark ? "bg-slate-900 border-l border-slate-700" : "bg-white border-l border-gray-200"}`}
      >
        {/* Header */}
        <div className={`sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b ${isDark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-200"}`}>
          <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Manage</h2>
          <button onClick={close} className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Storage */}
          <div>
            <h3 className={sectionTitle}>Storage</h3>
            <div className={card}>
              <div className="flex items-center justify-between">
                <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>Used</span>
                <span className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  {storageUsage ? formatFileSize(storageUsage.totalBytes) : "…"}
                </span>
              </div>
              {storageUsage && (
                <p className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  {storageUsage.count} {storageUsage.count === 1 ? "file" : "files"}
                </p>
              )}
            </div>
          </div>

          {/* Attention */}
          <div>
            <h3 className={sectionTitle}>Needs attention</h3>
            <div className="space-y-2">
              <div className={`flex items-center justify-between ${card}`}>
                <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>Expiring soon</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700"}`}>
                  {expiringDocuments?.length ?? 0}
                </span>
              </div>
              <div className={`flex items-center justify-between ${card}`}>
                <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>Needs signature</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isDark ? "bg-rose-500/20 text-rose-400" : "bg-rose-100 text-rose-700"}`}>
                  {unsignedDocuments?.length ?? 0}
                </span>
              </div>
            </div>
          </div>

          {/* View */}
          <div>
            <h3 className={sectionTitle}>View</h3>
            <div className={`flex rounded-lg border w-max ${isDark ? "border-slate-700" : "border-gray-200"}`}>
              <button
                onClick={() => setViewMode("grid")}
                className={`px-3 py-1.5 text-sm rounded-l-lg transition-colors ${viewMode === "grid" ? (isDark ? "bg-slate-700 text-white" : "bg-gray-100 text-gray-900") : (isDark ? "text-slate-400" : "text-gray-400")}`}
              >Grid</button>
              <button
                onClick={() => setViewMode("list")}
                className={`px-3 py-1.5 text-sm rounded-r-lg transition-colors ${viewMode === "list" ? (isDark ? "bg-slate-700 text-white" : "bg-gray-100 text-gray-900") : (isDark ? "text-slate-400" : "text-gray-400")}`}
              >List</button>
            </div>
          </div>

          {/* Category filter */}
          <div>
            <h3 className={sectionTitle}>Filter by category</h3>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${!selectedCategory ? (isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-700") : (isDark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100")}`}
              >All</button>
              {CATEGORIES.map(cat => (
                <button
                  key={cat.value}
                  onClick={() => setSelectedCategory(selectedCategory === cat.value ? null : cat.value)}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors ${selectedCategory === cat.value ? (isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-700") : (isDark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100")}`}
                >{cat.label}</button>
              ))}
            </div>
          </div>

          {/* Groups + archived */}
          <div>
            <h3 className={sectionTitle}>Advanced</h3>
            <div className="space-y-2">
              <button
                onClick={() => { setShowGroupsModal(true); close(); }}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? "bg-slate-800/50 text-slate-200 hover:bg-slate-800" : "bg-gray-50 text-gray-800 hover:bg-gray-100"}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2-5.24M5 8a3 3 0 002 5.24" />
                </svg>
                Manage groups
              </button>
              <button
                onClick={() => setShowFolderUpload(true)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? "bg-slate-800/50 text-slate-200 hover:bg-slate-800" : "bg-gray-50 text-gray-800 hover:bg-gray-100"}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
                Upload a folder
              </button>
              {!currentFolderId && (
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${showArchived ? (isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700") : (isDark ? "bg-slate-800/50 text-slate-200 hover:bg-slate-800" : "bg-gray-50 text-gray-800 hover:bg-gray-100")}`}
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                    {showArchived ? "Viewing archived" : "Show archived"}
                  </span>
                </button>
              )}
            </div>
            <p className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Privacy levels and password protection are set per folder from its Share panel.
            </p>
          </div>
        </div>
      </div>
    </div>
    <FolderUploadModal open={showFolderUpload} onClose={() => setShowFolderUpload(false)} />
    </>
  );
}
