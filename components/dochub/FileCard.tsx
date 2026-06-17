"use client";

import { useState, useEffect, useRef } from "react";
import { useDocHub } from "./DocHubContext";
import { getFileIcon, getFileColor, formatFileSize, type DocumentType, type FolderType } from "./types";
import { resolveFileType } from "@/lib/fileTypes";

// Google-Drive-style thumbnail: images render directly, PDFs render their first
// page via pdf.js (lazy when the card scrolls into view; skipped for very large
// files), everything else falls back to the file-type icon.
function FileThumb({ doc, isDark }: { doc: DocumentType; isDark: boolean }) {
  const ft = resolveFileType(doc.fileType, doc.fileName).toLowerCase();
  const fn = (doc.fileName || "").toLowerCase();
  const isImage = ft.includes("image");
  const isPdf = ft.includes("pdf") || fn.endsWith(".pdf");
  const proxyUrl = `/api/documents/file?id=${doc._id}`;

  const [pdfThumb, setPdfThumb] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !isPdf || pdfThumb || failed) return;
    if ((doc.fileSize || 0) > 12 * 1024 * 1024) { setFailed(true); return; } // skip huge PDFs
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Serve the worker from our own origin (bundled in /public) instead of a public
        // CDN, so PDF thumbnails don't depend on unpkg being reachable.
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjs.getDocument(proxyUrl).promise;
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 320 / base.width });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no canvas ctx");
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (!cancelled) setPdfThumb(canvas.toDataURL("image/png"));
        pdf.destroy();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, isPdf, proxyUrl, pdfThumb, failed, doc.fileSize]);

  const areaCls = `relative flex items-center justify-center h-36 overflow-hidden rounded-t-xl ${isDark ? "bg-slate-800/60" : "bg-gray-50"}`;

  if (isImage && !failed) {
    return (
      <div ref={ref} className={areaCls}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={proxyUrl} alt={doc.name} loading="lazy" className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
      </div>
    );
  }
  if (isPdf && pdfThumb && !failed) {
    return (
      <div ref={ref} className={`${areaCls} bg-white items-start`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pdfThumb} alt={doc.name} className="w-full object-contain object-top" />
      </div>
    );
  }
  // Fallback icon (also shown while a PDF thumbnail is still rendering).
  return (
    <div ref={ref} className={areaCls}>
      <svg className={`w-12 h-12 ${getFileColor(doc.fileType, isDark)}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d={getFileIcon(doc.fileType)} />
      </svg>
    </div>
  );
}

function ExpirationBadge({ doc }: { doc: DocumentType }) {
  const { isDark } = useDocHub();
  if (!doc.expiresAt) return null;
  const now = Date.now();
  const alertDays = doc.expirationAlertDays ?? 30;
  const alertTime = doc.expiresAt - alertDays * 24 * 60 * 60 * 1000;

  if (now >= doc.expiresAt) {
    return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-600"}`}>Expired</span>;
  }
  if (now >= alertTime) {
    return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-600"}`}>Expiring</span>;
  }
  return null;
}

// ============ FILE GRID CARD (draggable) ============
export function FileGridCard({ doc }: { doc: DocumentType }) {
  const { isDark, handlePreview, handleDownload, setContextMenu } = useDocHub();

  const handleClick = () => {
    // Always open the preview modal — it handles unsupported types
    // gracefully with a Download fallback. Silently triggering a
    // download made it look like clicking the file did nothing.
    handlePreview(doc);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, doc });
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/dochub-type", "document");
    e.dataTransfer.setData("application/dochub-id", doc._id);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className={`group relative flex flex-col rounded-xl border cursor-pointer transition-all duration-200 hover:scale-[1.02] ${
        isDark
          ? "bg-slate-800/40 border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/60 hover:shadow-lg hover:shadow-black/20"
          : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-lg hover:shadow-gray-200/60"
      }`}
    >
      {/* Thumbnail (image / PDF first page) or file-type icon */}
      <FileThumb doc={doc} isDark={isDark} />

      {/* Info */}
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <h3 className={`text-[15px] font-semibold tracking-tight truncate flex-1 ${isDark ? "text-white" : "text-gray-900"}`}>
            {doc.name}
          </h3>
          <ExpirationBadge doc={doc} />
        </div>

        {doc.description && (
          <p className={`text-xs mt-1 line-clamp-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            {doc.description}
          </p>
        )}

        <div className={`flex items-center gap-3 mt-auto pt-3 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          <span>{formatFileSize(doc.fileSize)}</span>
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {doc.downloadCount}
          </span>
          {doc.requiresSignature && (
            <svg className={`w-3 h-3 ${isDark ? "text-purple-400" : "text-purple-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          )}
          {doc.isPublic && (
            <svg className={`w-3 h-3 ${isDark ? "text-emerald-400" : "text-emerald-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </div>
      </div>

      {/* Hover action buttons */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); handleDownload(doc); }}
          className={`p-1.5 rounded-lg backdrop-blur-sm transition-colors ${
            isDark ? "bg-slate-700/80 hover:bg-slate-600 text-slate-300" : "bg-white/80 hover:bg-white text-gray-600 shadow-sm"
          }`}
          title="Download"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            setContextMenu({ x: rect.left, y: rect.bottom + 4, doc });
          }}
          className={`p-1.5 rounded-lg backdrop-blur-sm transition-colors ${
            isDark ? "bg-slate-700/80 hover:bg-slate-600 text-slate-300" : "bg-white/80 hover:bg-white text-gray-600 shadow-sm"
          }`}
          title="More options"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ============ FILE LIST ROW (draggable) ============
export function FileListRow({ doc }: { doc: DocumentType }) {
  const { isDark, handlePreview, handleDownload, setContextMenu } = useDocHub();

  const handleClick = () => {
    // Always open the preview modal — it handles unsupported types
    // gracefully with a Download fallback. Silently triggering a
    // download made it look like clicking the file did nothing.
    handlePreview(doc);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, doc });
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/dochub-type", "document");
    e.dataTransfer.setData("application/dochub-id", doc._id);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className={`group flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors border-b last:border-b-0 ${
        isDark ? "hover:bg-slate-800/50 border-slate-700/40" : "hover:bg-gray-50 border-gray-100"
      }`}
    >
      <svg className={`w-5 h-5 flex-shrink-0 ${getFileColor(doc.fileType, isDark)}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={getFileIcon(doc.fileType)} />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-[15px] font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
            {doc.name}
          </span>
          <ExpirationBadge doc={doc} />
          {doc.requiresSignature && (
            <svg className={`w-3.5 h-3.5 flex-shrink-0 ${isDark ? "text-purple-400" : "text-purple-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          )}
          {doc.isPublic && (
            <svg className={`w-3.5 h-3.5 flex-shrink-0 ${isDark ? "text-emerald-400" : "text-emerald-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945" />
            </svg>
          )}
        </div>
        {doc.description && (
          <p className={`text-xs truncate mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            {doc.description}
          </p>
        )}
      </div>
      <span className={`hidden md:block text-xs px-2 py-0.5 rounded-full capitalize ${
        isDark ? "bg-slate-700/50 text-slate-400" : "bg-gray-100 text-gray-500"
      }`}>
        {doc.category}
      </span>
      <span className={`hidden sm:block text-xs tabular-nums w-20 text-right ${isDark ? "text-slate-500" : "text-gray-400"}`}>
        {formatFileSize(doc.fileSize)}
      </span>
      <span className={`hidden lg:block text-xs tabular-nums w-28 text-right ${isDark ? "text-slate-500" : "text-gray-400"}`}>
        {new Date(doc.updatedAt).toLocaleDateString()}
      </span>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); handleDownload(doc); }}
          className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}
          title="Download"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            setContextMenu({ x: rect.left, y: rect.bottom + 4, doc });
          }}
          className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}
          title="More"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ============ FOLDER GRID CARD (drop target + draggable) ============
export function FolderGridCard({ folder }: { folder: FolderType }) {
  const { isDark, handleOpenFolder, handleMoveDocument, handleMoveFolder, setContextMenu } = useDocHub();
  const [isDropTarget, setIsDropTarget] = useState(false);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, folder });
  };

  // Make folder draggable (for nesting folders)
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/dochub-type", "folder");
    e.dataTransfer.setData("application/dochub-id", folder._id);
    e.dataTransfer.effectAllowed = "move";
  };

  // Drop target handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const type = e.dataTransfer.types.includes("application/dochub-type");
    if (type) {
      e.dataTransfer.dropEffect = "move";
      setIsDropTarget(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);

    const itemType = e.dataTransfer.getData("application/dochub-type");
    const itemId = e.dataTransfer.getData("application/dochub-id");

    if (!itemType || !itemId) return;

    if (itemType === "document") {
      await handleMoveDocument(itemId as any, folder._id);
    } else if (itemType === "folder" && itemId !== folder._id) {
      await handleMoveFolder(itemId as any, folder._id);
    }
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => handleOpenFolder(folder)}
      onContextMenu={handleContextMenu}
      className={`group flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
        isDropTarget
          ? isDark
            ? "bg-cyan-500/10 border-cyan-500/50 scale-[1.02] shadow-lg shadow-cyan-500/10"
            : "bg-blue-50 border-blue-400 scale-[1.02] shadow-lg shadow-blue-200/50"
          : isDark
            ? "bg-slate-800/40 border-slate-700/50 hover:border-cyan-500/30 hover:bg-slate-800/60 hover:scale-[1.01]"
            : "bg-white border-gray-200 hover:border-blue-300 hover:shadow-md hover:scale-[1.01]"
      }`}
    >
      <div className={`p-2.5 rounded-xl transition-colors ${
        isDropTarget
          ? isDark ? "bg-cyan-500/20" : "bg-blue-100"
          : isDark ? "bg-slate-700/60" : "bg-blue-50"
      }`}>
        <svg className={`w-6 h-6 ${isDropTarget ? (isDark ? "text-cyan-300" : "text-blue-600") : (isDark ? "text-cyan-400" : "text-blue-500")}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className={`text-sm font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
            {folder.name}
          </h3>
          {folder.isProtected && (
            <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          )}
        </div>
        <p className={`text-xs mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          {isDropTarget ? "Drop here to move" : `${folder.documentCount} ${folder.documentCount === 1 ? "file" : "files"}`}
        </p>
      </div>
    </div>
  );
}

// ============ FOLDER LIST ROW (drop target + draggable) ============
export function FolderListRow({ folder }: { folder: FolderType }) {
  const { isDark, handleOpenFolder, handleMoveDocument, handleMoveFolder, setContextMenu } = useDocHub();
  const [isDropTarget, setIsDropTarget] = useState(false);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, folder });
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/dochub-type", "folder");
    e.dataTransfer.setData("application/dochub-id", folder._id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("application/dochub-type")) {
      e.dataTransfer.dropEffect = "move";
      setIsDropTarget(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);

    const itemType = e.dataTransfer.getData("application/dochub-type");
    const itemId = e.dataTransfer.getData("application/dochub-id");

    if (!itemType || !itemId) return;

    if (itemType === "document") {
      await handleMoveDocument(itemId as any, folder._id);
    } else if (itemType === "folder" && itemId !== folder._id) {
      await handleMoveFolder(itemId as any, folder._id);
    }
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => handleOpenFolder(folder)}
      onContextMenu={handleContextMenu}
      className={`group flex items-center gap-4 px-4 py-3 cursor-pointer transition-all ${
        isDropTarget
          ? isDark
            ? "bg-cyan-500/10 outline outline-2 outline-cyan-500/50"
            : "bg-blue-50 outline outline-2 outline-blue-400"
          : isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-50"
      }`}
    >
      <svg className={`w-5 h-5 flex-shrink-0 ${isDropTarget ? (isDark ? "text-cyan-300" : "text-blue-600") : (isDark ? "text-cyan-400" : "text-blue-500")}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
            {folder.name}
          </span>
          {folder.isProtected && (
            <svg className="w-3 h-3 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          )}
        </div>
      </div>
      <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
        {isDropTarget ? "Drop here" : `${folder.documentCount} files`}
      </span>
      <span className={`hidden lg:block text-xs w-28 text-right ${isDark ? "text-slate-500" : "text-gray-400"}`}>
        {new Date(folder.updatedAt).toLocaleDateString()}
      </span>
    </div>
  );
}
