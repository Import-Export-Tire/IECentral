"use client";

import { useState } from "react";
import { useDocHub } from "./DocHubContext";
import { PRIVACY_TIERS, visibilityToTier, formatFileSize, type PrivacyTier, type FolderType } from "./types";
import { Id } from "@/convex/_generated/dataModel";

function FolderTreeItem({ folder, depth = 0, tier }: { folder: FolderType; depth?: number; tier: PrivacyTier }) {
  const { isDark, currentFolderId, navigateToFolder, handleOpenFolder, unlockedFolders, user, sharedFoldersWithMe, setContextMenu } = useDocHub();
  const [expanded, setExpanded] = useState(false);
  const isActive = currentFolderId === folder._id;
  const tierConfig = PRIVACY_TIERS[tier];

  const needsPassword = folder.isProtected && !unlockedFolders.has(folder._id) &&
    !sharedFoldersWithMe?.some(f => f?._id === folder._id) && folder.createdBy !== user?._id;

  const handleClick = async () => {
    await handleOpenFolder(folder);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, folder });
  };

  return (
    <div>
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-all group ${
          isActive
            ? isDark ? tierConfig.bgDark + " " + tierConfig.textDark : tierConfig.bgLight + " " + tierConfig.textLight
            : isDark
              ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
        }`}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        {/* Folder icon */}
        <svg className={`w-4 h-4 flex-shrink-0 ${isActive ? (isDark ? tierConfig.textDark : tierConfig.textLight) : isDark ? "text-slate-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>

        <span className="truncate flex-1 text-left">{folder.name}</span>

        {/* Lock icon */}
        {needsPassword && (
          <svg className={`w-3 h-3 flex-shrink-0 ${isDark ? "text-amber-500/60" : "text-amber-500/60"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        )}

        {/* Count badge */}
        {folder.documentCount > 0 && (
          <span className={`text-xs tabular-nums ${isDark ? "text-slate-600" : "text-gray-400"}`}>
            {folder.documentCount}
          </span>
        )}
      </button>
    </div>
  );
}

function TierSection({ tier, folders }: { tier: PrivacyTier; folders: FolderType[] }) {
  const { isDark } = useDocHub();
  const [collapsed, setCollapsed] = useState(false);
  const config = PRIVACY_TIERS[tier];

  if (folders.length === 0) return null;

  return (
    <div className="mb-1">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
          isDark ? "text-slate-500 hover:text-slate-400" : "text-gray-400 hover:text-gray-600"
        }`}
      >
        {/* Tier color dot */}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isDark ? config.dotDark : config.dotLight}`} />
        <span className="flex-1 text-left">{config.label}</span>
        <svg className={`w-3 h-3 transition-transform ${collapsed ? "-rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!collapsed && (
        <div className="space-y-0.5">
          {folders.map(folder => (
            <FolderTreeItem key={folder._id} folder={folder} tier={tier} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocHubSidebar() {
  const {
    isDark, myFolders, communityFolders, sharedFoldersWithMe,
    navigateToRoot, currentFolderId, setShowFolderModal,
    searchQuery, setSearchQuery, docSidebarCollapsed, setDocSidebarCollapsed,
    expiringDocuments, unsignedDocuments, storageUsage,
  } = useDocHub();

  // Categorize folders by privacy tier
  const categorizedFolders = {
    public: [] as FolderType[],
    internal: [] as FolderType[],
    confidential: [] as FolderType[],
    hipaa: [] as FolderType[],
  };

  // My folders
  myFolders?.forEach(f => {
    const tier = visibilityToTier(f.visibility, f.isProtected);
    categorizedFolders[tier].push(f);
  });

  // Community folders
  communityFolders?.forEach(f => {
    if (!categorizedFolders.public.find(ef => ef._id === f._id)) {
      categorizedFolders.public.push(f);
    }
  });

  // Shared folders
  sharedFoldersWithMe?.forEach(f => {
    if (f) {
      const tier = visibilityToTier(f.visibility, f.isProtected);
      if (!categorizedFolders[tier].find(ef => ef._id === f._id)) {
        categorizedFolders[tier].push(f);
      }
    }
  });

  if (docSidebarCollapsed) {
    return (
      <div className={`w-12 flex-shrink-0 border-r flex flex-col items-center py-4 gap-3 ${
        isDark ? "bg-slate-900/50 border-slate-700/50" : "bg-gray-50/80 border-gray-200"
      }`}>
        <button
          onClick={() => setDocSidebarCollapsed(false)}
          className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}
          title="Expand sidebar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button
          onClick={navigateToRoot}
          className={`p-2 rounded-lg transition-colors ${!currentFolderId ? (isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-50 text-blue-600") : (isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-200 text-gray-500")}`}
          title="All Documents"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className={`w-64 flex-shrink-0 border-r flex flex-col h-full overflow-hidden ${
      isDark ? "bg-slate-900/50 border-slate-700/50" : "bg-gray-50/80 border-gray-200"
    }`}>
      {/* Header */}
      <div className={`p-4 border-b flex items-center justify-between ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
        <h2 className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-gray-800"}`}>
          Documents
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowFolderModal(true)}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800 text-slate-400 hover:text-slate-200" : "hover:bg-gray-200 text-gray-500 hover:text-gray-700"}`}
            title="New Folder"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </button>
          <button
            onClick={() => setDocSidebarCollapsed(true)}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}
            title="Collapse sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <svg className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${isDark ? "text-slate-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border focus:outline-none focus:ring-1 ${
              isDark
                ? "bg-slate-800/50 border-slate-700 text-white placeholder-slate-500 focus:ring-cyan-500/50 focus:border-cyan-500"
                : "bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-blue-500/50 focus:border-blue-500"
            }`}
          />
        </div>
      </div>

      {/* Quick Access */}
      <div className="px-2 pb-2">
        <button
          onClick={navigateToRoot}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
            !currentFolderId
              ? isDark ? "bg-cyan-500/10 text-cyan-400" : "bg-blue-50 text-blue-700"
              : isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
          All Documents
        </button>

        {/* Alerts */}
        {(expiringDocuments && expiringDocuments.length > 0) && (
          <button className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
            isDark ? "text-amber-400 hover:bg-amber-500/10" : "text-amber-600 hover:bg-amber-50"
          }`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Expiring Soon
            <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700"}`}>
              {expiringDocuments.length}
            </span>
          </button>
        )}

        {(unsignedDocuments && unsignedDocuments.length > 0) && (
          <button className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
            isDark ? "text-rose-400 hover:bg-rose-500/10" : "text-rose-600 hover:bg-rose-50"
          }`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Needs Signature
            <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${isDark ? "bg-rose-500/20 text-rose-400" : "bg-rose-100 text-rose-700"}`}>
              {unsignedDocuments.length}
            </span>
          </button>
        )}
      </div>

      {/* Divider */}
      <div className={`mx-3 border-t ${isDark ? "border-slate-700/50" : "border-gray-200"}`} />

      {/* Folder Tree by Privacy Tier */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        <TierSection tier="public" folders={categorizedFolders.public} />
        <TierSection tier="internal" folders={categorizedFolders.internal} />
        <TierSection tier="confidential" folders={categorizedFolders.confidential} />
        <TierSection tier="hipaa" folders={categorizedFolders.hipaa} />

        {/* Empty state */}
        {Object.values(categorizedFolders).every(f => f.length === 0) && (
          <div className={`text-center py-8 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <p className="text-xs">No folders yet</p>
          </div>
        )}
      </div>

      {/* Storage usage */}
      <div className={`p-3 border-t ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
        <div className="flex items-center justify-between">
          <span className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>Storage used</span>
          <span className={`text-xs font-semibold ${isDark ? "text-slate-300" : "text-gray-700"}`}>
            {storageUsage ? formatFileSize(storageUsage.totalBytes) : "…"}
          </span>
        </div>
        {storageUsage && (
          <div className={`text-[11px] mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            {storageUsage.count} {storageUsage.count === 1 ? "file" : "files"}
          </div>
        )}
      </div>
    </div>
  );
}
