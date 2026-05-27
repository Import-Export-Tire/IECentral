"use client";

import { useCallback, useRef, useState } from "react";
import { useDocHub } from "./DocHubContext";
import Breadcrumbs from "./Breadcrumbs";
import HelpModal from "./HelpModal";
import FolderUploadModal from "./FolderUploadModal";
import { FileGridCard, FileListRow, FolderGridCard, FolderListRow } from "./FileCard";
import { CATEGORIES } from "./types";

function DropZoneOverlay() {
  const { isDark } = useDocHub();
  return (
    <div className={`absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed transition-all ${
      isDark ? "bg-cyan-500/5 border-cyan-500/40" : "bg-blue-500/5 border-blue-500/40"
    }`}>
      <div className="text-center">
        <svg className={`w-12 h-12 mx-auto mb-3 ${isDark ? "text-cyan-400" : "text-blue-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className={`text-sm font-medium ${isDark ? "text-cyan-300" : "text-blue-600"}`}>Drop files to upload</p>
        <p className={`text-xs mt-1 ${isDark ? "text-cyan-400/60" : "text-blue-500/60"}`}>Files will be added to current folder</p>
      </div>
    </div>
  );
}

function EmptyState() {
  const { isDark, setShowUploadModal, currentFolderId, showArchived } = useDocHub();

  if (showArchived) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <svg className={`w-16 h-16 mb-4 ${isDark ? "text-slate-700" : "text-gray-200"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
        <p className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>No archived documents</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className={`p-6 rounded-2xl mb-4 ${isDark ? "bg-slate-800/40" : "bg-gray-50"}`}>
        <svg className={`w-16 h-16 ${isDark ? "text-slate-600" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      </div>
      <p className={`text-base font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
        {currentFolderId ? "This folder is empty" : "No documents yet"}
      </p>
      <p className={`text-sm mb-4 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
        Drag and drop files here or click upload
      </p>
      <button
        onClick={() => setShowUploadModal(true)}
        className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
          isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        Upload Document
      </button>
    </div>
  );
}

function ListHeader() {
  const { isDark } = useDocHub();
  return (
    <div className={`flex items-center gap-4 px-4 py-2 text-xs font-medium uppercase tracking-wider border-b ${
      isDark ? "text-slate-500 border-slate-700/50" : "text-gray-400 border-gray-100"
    }`}>
      <span className="w-5" /> {/* icon space */}
      <span className="flex-1">Name</span>
      <span className="hidden md:block w-20">Category</span>
      <span className="hidden sm:block w-20 text-right">Size</span>
      <span className="hidden lg:block w-28 text-right">Modified</span>
      <span className="w-16" /> {/* actions space */}
    </div>
  );
}

export default function FileBrowser() {
  const {
    isDark, viewMode, setViewMode, filteredDocuments, myFolders, communityFolders,
    showArchived, setShowArchived, setShowUploadModal, setShowFolderModal,
    selectedCategory, setSelectedCategory, isAdmin, archivedDocuments,
    isDraggingOver, setIsDraggingOver, handleUpload, currentFolderId,
    loadingFolderDocs, error, setError, searchQuery, folderSearchResults,
  } = useDocHub();

  const dropRef = useRef<HTMLDivElement>(null);
  const [showFolderUpload, setShowFolderUpload] = useState(false);
  const isSearching = !!searchQuery.trim();

  // All folders to display at current level (or search results)
  const allFolders = isSearching
    ? (folderSearchResults || [])
    : [
        ...(myFolders || []),
        ...(communityFolders || []).filter(cf => !myFolders?.find(mf => mf._id === cf._id)),
      ];

  // Drag and drop file upload handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingOver(true);
    }
  }, [setIsDraggingOver]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropRef.current && !dropRef.current.contains(e.relatedTarget as Node)) {
      setIsDraggingOver(false);
    }
  }, [setIsDraggingOver]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    // Only handle external file drops (from OS), not internal doc/folder drags
    if (e.dataTransfer.getData("application/dochub-type")) return;

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const name = file.name.replace(/\.[^/.]+$/, "");
      await handleUpload(file, name, "", "other");
    }
  }, [setIsDraggingOver, handleUpload]);

  return (
    <div
      ref={dropRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex-1 flex flex-col h-full overflow-hidden relative"
    >
      {isDraggingOver && <DropZoneOverlay />}

      {/* Toolbar */}
      <div className={`flex-shrink-0 flex items-center justify-between px-6 py-3 border-b ${
        isDark ? "border-slate-700/50" : "border-gray-200"
      }`}>
        <Breadcrumbs />

        <div className="flex items-center gap-2">
          {/* Category filter pills */}
          <div className="hidden md:flex items-center gap-1 mr-2">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                !selectedCategory
                  ? isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-700"
                  : isDark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              All
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat.value}
                onClick={() => setSelectedCategory(selectedCategory === cat.value ? null : cat.value)}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                  selectedCategory === cat.value
                    ? isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-700"
                    : isDark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* View mode toggle */}
          <div className={`flex rounded-lg border ${isDark ? "border-slate-700" : "border-gray-200"}`}>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-l-lg transition-colors ${
                viewMode === "grid"
                  ? isDark ? "bg-slate-700 text-white" : "bg-gray-100 text-gray-900"
                  : isDark ? "text-slate-400 hover:text-slate-200" : "text-gray-400 hover:text-gray-600"
              }`}
              title="Grid view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-r-lg transition-colors ${
                viewMode === "list"
                  ? isDark ? "bg-slate-700 text-white" : "bg-gray-100 text-gray-900"
                  : isDark ? "text-slate-400 hover:text-slate-200" : "text-gray-400 hover:text-gray-600"
              }`}
              title="List view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </button>
          </div>

          {/* Archived toggle */}
          {isAdmin && !currentFolderId && (
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`p-1.5 rounded-lg transition-colors ${
                showArchived
                  ? isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-600"
                  : isDark ? "text-slate-400 hover:bg-slate-800" : "text-gray-400 hover:bg-gray-100"
              }`}
              title={showArchived ? "View active" : "View archived"}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </button>
          )}

          {/* Help */}
          <HelpModal />

          {/* Upload folder button */}
          <button
            onClick={() => setShowFolderUpload(true)}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-xl transition-all ${
              isDark
                ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                : "bg-gray-100 text-gray-800 hover:bg-gray-200"
            }`}
            title="Upload a folder with all its subfolders"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
            <span className="hidden sm:inline">Upload Folder</span>
          </button>

          {/* Upload button */}
          <button
            onClick={() => setShowUploadModal(true)}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-xl transition-all ${
              isDark
                ? "bg-cyan-500 text-white hover:bg-cyan-600 shadow-lg shadow-cyan-500/20"
                : "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/20"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Upload</span>
          </button>
        </div>
      </div>

      <FolderUploadModal open={showFolderUpload} onClose={() => setShowFolderUpload(false)} />

      {/* Error */}
      {error && (
        <div className={`mx-6 mt-4 flex items-center gap-3 px-4 py-3 rounded-xl text-sm ${
          isDark ? "bg-red-500/10 border border-red-500/20 text-red-400" : "bg-red-50 border border-red-200 text-red-600"
        }`}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")} className="text-xs font-medium hover:underline">Dismiss</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loadingFolderDocs ? (
          <div className="flex items-center justify-center py-20">
            <div className={`w-8 h-8 border-2 border-t-transparent rounded-full animate-spin ${isDark ? "border-cyan-500" : "border-blue-500"}`} />
          </div>
        ) : (
          <div className="p-6">
            {/* Folders */}
            {!showArchived && allFolders.length > 0 && (
              <div className="mb-6">
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  {isSearching ? "Matching Folders" : "Folders"}
                </h3>
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {allFolders.map(folder => (
                      <FolderGridCard key={folder._id} folder={folder} />
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-xl border ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
                    {allFolders.map((folder, i) => (
                      <div key={folder._id}>
                        {i > 0 && <div className={`border-t ${isDark ? "border-slate-700/30" : "border-gray-100"}`} />}
                        <FolderListRow folder={folder} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Documents */}
            {filteredDocuments && filteredDocuments.length > 0 ? (
              <div>
                {allFolders.length > 0 && (
                  <h3 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    {isSearching ? "Matching Files" : "Files"}
                  </h3>
                )}
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                    {filteredDocuments.map(doc => (
                      <FileGridCard key={doc._id} doc={doc} />
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
                    <ListHeader />
                    {filteredDocuments.map((doc, i) => (
                      <div key={doc._id}>
                        {i > 0 && <div className={`border-t ${isDark ? "border-slate-700/30" : "border-gray-100"}`} />}
                        <FileListRow doc={doc} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              !allFolders.length && <EmptyState />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
