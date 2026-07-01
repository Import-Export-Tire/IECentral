"use client";

import { useCallback, useRef } from "react";
import { useDocHub } from "./DocHubContext";
import Breadcrumbs from "./Breadcrumbs";
import HelpModal from "./HelpModal";
import { FileGridCard, FileListRow, FolderGridCard, FolderListRow } from "./FileCard";
import type { DocumentType, FolderType } from "./types";

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
      </div>
    </div>
  );
}

// Friendly, action-oriented empty state per rail section.
function EmptyState({ section }: { section: string }) {
  const { isDark, setShowUploadModal, currentFolderId } = useDocHub();
  const canUpload = section === "mine" || section === "recent" || !!currentFolderId;
  const message = currentFolderId
    ? "This folder is empty."
    : section === "shared"
      ? "Nothing's been shared with you yet."
      : section === "company"
        ? "No company documents yet."
        : "No documents yet.";
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className={`p-6 rounded-2xl mb-4 ${isDark ? "bg-slate-800/40" : "bg-gray-50"}`}>
        <svg className={`w-14 h-14 ${isDark ? "text-slate-600" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      </div>
      <p className={`text-base font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{message}</p>
      {canUpload && (
        <>
          <p className={`text-sm mb-4 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Drop a file here, or click to add your first one.</p>
          <button
            onClick={() => setShowUploadModal(true)}
            className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
          >
            Upload a document
          </button>
        </>
      )}
    </div>
  );
}

function ListHeader() {
  const { isDark } = useDocHub();
  return (
    <div className={`flex items-center gap-4 px-4 py-2 text-xs font-medium uppercase tracking-wider border-b ${isDark ? "text-slate-500 border-slate-700/50" : "text-gray-400 border-gray-100"}`}>
      <span className="w-5" />
      <span className="flex-1">Name</span>
      <span className="hidden md:block w-20">Category</span>
      <span className="hidden sm:block w-20 text-right">Size</span>
      <span className="hidden lg:block w-28 text-right">Modified</span>
      <span className="w-16" />
    </div>
  );
}

export default function FileBrowser() {
  const {
    isDark, viewMode, filteredDocuments, recentDocuments, railSelection,
    myFolders, communityFolders, sharedFoldersWithMe, showArchived,
    setShowUploadModal, setShowFolderModal, isDraggingOver, setIsDraggingOver,
    handleUpload, currentFolderId, loadingFolderDocs, error, setError,
    searchQuery, setSearchQuery, folderSearchResults,
  } = useDocHub();

  const dropRef = useRef<HTMLDivElement>(null);
  const isSearching = !!searchQuery.trim();
  const atRoot = !currentFolderId;

  // Which folders to show. At root, follow the rail selection. Inside a folder,
  // show that folder's children (any visibility), matching the server queries which
  // are already scoped by parentFolderId.
  const rootFolders: FolderType[] =
    railSelection === "mine" ? (myFolders || [])
    : railSelection === "shared" ? ((sharedFoldersWithMe || []).filter(Boolean) as FolderType[])
    : railSelection === "company" ? (communityFolders || [])
    : []; // recent → no folders

  const inFolderFolders: FolderType[] = [
    ...(myFolders || []),
    ...(communityFolders || []).filter(cf => !myFolders?.find(mf => mf._id === cf._id)),
    ...((sharedFoldersWithMe || []).filter(
      sf => sf && !myFolders?.find(mf => mf._id === sf._id) && !communityFolders?.find(cf => cf._id === sf._id)
    ) as FolderType[]),
  ];

  const allFolders: FolderType[] = isSearching
    ? (folderSearchResults || [])
    : showArchived ? []
    : atRoot ? rootFolders : inFolderFolders;

  // Which documents to show. At root, only "mine" and "recent" carry loose documents;
  // "shared"/"company" are folder-oriented at the root level.
  const docsToShow: DocumentType[] | undefined =
    isSearching || showArchived || !atRoot
      ? filteredDocuments
      : railSelection === "recent"
        ? recentDocuments
        : railSelection === "mine"
          ? filteredDocuments
          : []; // shared/company root

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setIsDraggingOver(true);
  }, [setIsDraggingOver]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (dropRef.current && !dropRef.current.contains(e.relatedTarget as Node)) setIsDraggingOver(false);
  }, [setIsDraggingOver]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setIsDraggingOver(false);
    if (e.dataTransfer.getData("application/dochub-type")) return; // internal drag
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const name = file.name.replace(/\.[^/.]+$/, "");
      await handleUpload(file, name, "", "other");
    }
  }, [setIsDraggingOver, handleUpload]);

  const showEmpty = !loadingFolderDocs && allFolders.length === 0 && (!docsToShow || docsToShow.length === 0);

  return (
    <div
      ref={dropRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex-1 flex flex-col h-full overflow-hidden relative"
    >
      {isDraggingOver && <DropZoneOverlay />}

      {/* Top bar */}
      <div className={`flex-shrink-0 border-b ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
        <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3">
          <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Documents</h1>
          <div className="relative flex-1 min-w-[180px] max-w-md order-3 sm:order-2 w-full sm:w-auto">
            <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search documents…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full text-sm pl-9 pr-3 py-2 rounded-xl border focus:outline-none focus:ring-2 ${
                isDark ? "bg-slate-800/50 border-slate-700 text-white placeholder-slate-500 focus:ring-cyan-500/50" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-blue-500/40"
              }`}
            />
          </div>
          <div className="flex items-center gap-2 ml-auto order-2 sm:order-3">
            <HelpModal />
            <button
              onClick={() => setShowFolderModal(true)}
              className={`hidden sm:flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl transition-colors ${isDark ? "bg-slate-700 text-slate-200 hover:bg-slate-600" : "bg-gray-100 text-gray-800 hover:bg-gray-200"}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
              New folder
            </button>
            <button
              onClick={() => setShowUploadModal(true)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Upload</span>
            </button>
          </div>
        </div>
        {/* Breadcrumb only when inside a folder */}
        {!atRoot && (
          <div className="px-4 sm:px-6 pb-3">
            <Breadcrumbs />
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className={`mx-4 sm:mx-6 mt-4 flex items-center gap-3 px-4 py-3 rounded-xl text-sm ${isDark ? "bg-red-500/10 border border-red-500/20 text-red-400" : "bg-red-50 border border-red-200 text-red-600"}`}>
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
        ) : showEmpty ? (
          <EmptyState section={railSelection} />
        ) : (
          <div className="p-4 sm:p-6">
            {/* Folders */}
            {allFolders.length > 0 && (
              <div className="mb-6">
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  {isSearching ? "Matching folders" : "Folders"}
                </h3>
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {allFolders.map(folder => <FolderGridCard key={folder._id} folder={folder} />)}
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

            {/* Files */}
            {docsToShow && docsToShow.length > 0 && (
              <div>
                {allFolders.length > 0 && (
                  <h3 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    {isSearching ? "Matching files" : "Files"}
                  </h3>
                )}
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                    {docsToShow.map(doc => <FileGridCard key={doc._id} doc={doc} />)}
                  </div>
                ) : (
                  <div className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
                    <ListHeader />
                    {docsToShow.map((doc, i) => (
                      <div key={doc._id}>
                        {i > 0 && <div className={`border-t ${isDark ? "border-slate-700/30" : "border-gray-100"}`} />}
                        <FileListRow doc={doc} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Inline drop-zone hint (desktop only; keeps "store" obvious) */}
            {atRoot && !isSearching && (railSelection === "mine" || railSelection === "recent") && (
              <button
                onClick={() => setShowUploadModal(true)}
                className={`hidden md:flex mt-6 w-full items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed text-sm transition-colors ${isDark ? "border-slate-700 text-slate-500 hover:border-cyan-500/40 hover:text-cyan-400" : "border-gray-200 text-gray-400 hover:border-blue-400 hover:text-blue-500"}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Drop files here to upload — or click to choose
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
