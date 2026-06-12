"use client";

import { useState, useEffect } from "react";
import { useDocHub } from "./DocHubContext";
import { formatFileSize, isOfficeDocument } from "./types";

export default function PreviewModal() {
  const {
    isDark,
    previewDocument,
    previewUrl,
    previewStorageUrl,
    loadingPreview,
    closePreview,
    handleDownload,
  } = useDocHub();

  // Track whether the embedded preview failed to render so we can show a
  // clear fallback (Download + Open in new tab) instead of a silent blank.
  const [embedFailed, setEmbedFailed] = useState(false);
  // Office docs are converted to PDF on first open; show a "converting" state
  // until the rendition loads.
  const [converting, setConverting] = useState(false);

  const docId = previewDocument?._id;
  const ft0 = previewDocument?.fileType.toLowerCase() ?? "";
  const isOffice0 = isOfficeDocument(ft0);
  // Reset transient state whenever a different document is opened.
  useEffect(() => {
    setEmbedFailed(false);
    setConverting(isOffice0);
  }, [docId, isOffice0]);

  if (!previewDocument) return null;

  const doc = previewDocument;
  const ft = doc.fileType.toLowerCase();
  const fn = doc.fileName.toLowerCase();
  const isImage = ft.includes("image");
  const isPdf = ft.includes("pdf") || fn.endsWith(".pdf");
  const isVideo = ft.startsWith("video/");
  const isAudio = ft.startsWith("audio/");
  const isText =
    ft.startsWith("text/") ||
    ft.includes("json") ||
    ft.includes("csv") ||
    /\.(txt|csv|md|json|log|xml|html?)$/.test(fn);
  const isOffice = isOfficeDocument(ft);
  // Office docs (Word/Excel/PowerPoint) are converted to PDF in-house and served
  // by /api/documents/office-pdf, then treated exactly like a native PDF — no
  // third-party viewer, and printable inline.
  const officePdfUrl = isOffice ? `/api/documents/office-pdf?id=${doc._id}` : null;

  // For "Open in new tab" use the raw storage URL — blob URLs only work in
  // the originating window.
  const externalOpenUrl = previewStorageUrl || previewUrl;

  // What we hand to the print iframe: the PDF rendition for Office docs,
  // otherwise the file itself. Video/audio aren't printable.
  const printUrl = officePdfUrl || previewUrl;
  const canPrint = !!printUrl && (isPdf || isImage || isText || isOffice);

  const handlePrint = () => {
    if (!printUrl) return;
    const iframe = document.createElement("iframe");
    Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
    iframe.src = printUrl;
    iframe.onload = () => {
      // small delay lets the PDF/image viewer initialize before printing
      setTimeout(() => { try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* ignore */ } }, 350);
    };
    document.body.appendChild(iframe);
    setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* ignore */ } }, 60000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={closePreview}>
      {/* Backdrop */}
      <div className={`absolute inset-0 ${isDark ? "bg-black/80" : "bg-black/60"} backdrop-blur-sm`} />

      {/* Modal */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-5xl h-[85vh] mx-4 rounded-2xl overflow-hidden flex flex-col ${
          isDark ? "bg-slate-900 border border-slate-700" : "bg-white border border-gray-200 shadow-2xl"
        }`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <div className="flex-1 min-w-0">
            <h2 className={`text-lg font-semibold truncate ${isDark ? "text-white" : "text-gray-900"}`}>
              {doc.name}
            </h2>
            <p className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              {doc.fileName} &middot; {formatFileSize(doc.fileSize)}
            </p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            {externalOpenUrl && (
              <a
                href={externalOpenUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Open in new tab
              </a>
            )}
            {canPrint && (
              <button
                onClick={handlePrint}
                className="px-3 py-1.5 text-sm font-medium rounded-lg text-white transition-colors"
                style={{ backgroundColor: "#007AFF" }}
                title="Print this file (no download needed)"
              >
                Print
              </button>
            )}
            <button
              onClick={() => handleDownload(doc)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Download
            </button>
            <button
              onClick={closePreview}
              className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-gray-50 dark:bg-slate-950">
          {loadingPreview ? (
            <div className={`w-8 h-8 border-2 border-t-transparent rounded-full animate-spin ${isDark ? "border-cyan-500" : "border-blue-500"}`} />
          ) : !previewUrl ? (
            <FallbackPanel
              isDark={isDark}
              doc={doc}
              externalOpenUrl={externalOpenUrl}
              onDownload={() => handleDownload(doc)}
              message="Unable to load preview"
            />
          ) : isImage ? (
            <img
              src={previewUrl}
              alt={doc.name}
              className="max-w-full max-h-full object-contain rounded-lg"
              onError={() => setEmbedFailed(true)}
            />
          ) : isVideo ? (
            <video src={previewUrl} controls className="max-w-full max-h-full rounded-lg" onError={() => setEmbedFailed(true)} />
          ) : isAudio ? (
            <audio src={previewUrl} controls className="w-full" onError={() => setEmbedFailed(true)} />
          ) : officePdfUrl ? (
            // Office doc converted to PDF in-house (nothing leaves our infra).
            // An iframe gives us onLoad to clear the "converting" overlay.
            <>
              <iframe
                src={officePdfUrl}
                className="w-full h-full rounded-lg bg-white"
                title={doc.name}
                onLoad={() => setConverting(false)}
                onError={() => { setConverting(false); setEmbedFailed(true); }}
              />
              {converting && (
                <div className={`absolute inset-0 flex flex-col items-center justify-center gap-3 ${isDark ? "bg-slate-950/80" : "bg-gray-50/90"}`}>
                  <div className={`w-8 h-8 border-2 border-t-transparent rounded-full animate-spin ${isDark ? "border-cyan-500" : "border-blue-500"}`} />
                  <p className={`text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>Converting to PDF…</p>
                  <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>First open of an Office file can take a few seconds.</p>
                </div>
              )}
            </>
          ) : isPdf ? (
            // <embed> renders PDFs more reliably than <iframe> across
            // browsers (it asks the browser's native PDF plugin directly).
            <embed
              src={previewUrl}
              type="application/pdf"
              className="w-full h-full rounded-lg bg-white"
            />
          ) : isText ? (
            <iframe src={previewUrl} className="w-full h-full rounded-lg bg-white" title={doc.name} />
          ) : (
            <FallbackPanel
              isDark={isDark}
              doc={doc}
              externalOpenUrl={externalOpenUrl}
              onDownload={() => handleDownload(doc)}
              message="Preview not available for this file type"
            />
          )}
          {embedFailed && (
            <div className="absolute inset-x-4 bottom-4 z-10">
              <FallbackPanel
                isDark={isDark}
                doc={doc}
                externalOpenUrl={externalOpenUrl}
                onDownload={() => handleDownload(doc)}
                message="Preview failed to load — use the buttons below to open the file directly."
                compact
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FallbackPanel({
  isDark,
  doc,
  externalOpenUrl,
  onDownload,
  message,
  compact = false,
}: {
  isDark: boolean;
  doc: { name: string; fileName: string; fileType: string; fileSize: number };
  externalOpenUrl: string | null;
  onDownload: () => void;
  message: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`text-center max-w-md px-6 ${compact ? "py-3" : "py-8"} rounded-2xl ${
        isDark ? "bg-slate-900/95 border border-slate-700" : "bg-white border border-gray-200"
      } shadow-lg`}
    >
      {!compact && (
        <div className={`mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center ${isDark ? "bg-slate-800 text-slate-400" : "bg-gray-100 text-gray-500"}`}>
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
      )}
      <p className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
        {message}
      </p>
      {!compact && (
        <p className={`text-xs mt-1 mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
          {doc.fileType || "Unknown type"} &middot; {formatFileSize(doc.fileSize)}
        </p>
      )}
      <div className={`flex gap-2 justify-center ${compact ? "mt-2" : "mt-3"}`}>
        {externalOpenUrl && (
          <a
            href={externalOpenUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`px-4 py-2 rounded-xl text-sm font-semibold ${
              isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-100 text-gray-800 hover:bg-gray-200"
            }`}
          >
            Open in new tab
          </a>
        )}
        <button
          onClick={onDownload}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ backgroundColor: "#007AFF" }}
        >
          Download {doc.fileName}
        </button>
      </div>
    </div>
  );
}
