"use client";

import { useDocHub } from "./DocHubContext";
import { formatFileSize, isOfficeDocument } from "./types";

export default function PreviewModal() {
  const { isDark, previewDocument, previewUrl, loadingPreview, closePreview, handleDownload } = useDocHub();

  if (!previewDocument) return null;

  const doc = previewDocument;
  const ft = doc.fileType.toLowerCase();
  const fn = doc.fileName.toLowerCase();
  const isImage = ft.includes("image");
  const isPdf = ft.includes("pdf");
  const isVideo = ft.startsWith("video/");
  const isAudio = ft.startsWith("audio/");
  const isText =
    ft.startsWith("text/") ||
    ft.includes("json") ||
    ft.includes("csv") ||
    /\.(txt|csv|md|json|log|xml|html?)$/.test(fn);
  const isOffice = isOfficeDocument(ft);
  const officeViewerUrl = isOffice && previewUrl
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewUrl)}`
    : null;

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
        <div className="flex-1 overflow-auto flex items-center justify-center p-4">
          {loadingPreview ? (
            <div className={`w-8 h-8 border-2 border-t-transparent rounded-full animate-spin ${isDark ? "border-cyan-500" : "border-blue-500"}`} />
          ) : !previewUrl ? (
            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Unable to load preview</p>
          ) : isImage ? (
            <img
              src={previewUrl}
              alt={doc.name}
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          ) : isVideo ? (
            <video src={previewUrl} controls className="max-w-full max-h-full rounded-lg" />
          ) : isAudio ? (
            <audio src={previewUrl} controls className="w-full" />
          ) : officeViewerUrl ? (
            <iframe src={officeViewerUrl} className="w-full h-full rounded-lg" title={doc.name} />
          ) : isPdf || isText ? (
            <iframe src={previewUrl} className="w-full h-full rounded-lg" title={doc.name} />
          ) : (
            // Unsupported preview — show a friendly message with a clear
            // Download CTA instead of an iframe that may render garbage.
            <div className="text-center max-w-sm px-6">
              <div className={`mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center ${isDark ? "bg-slate-800 text-slate-400" : "bg-gray-100 text-gray-500"}`}>
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                Preview not available for this file type
              </p>
              <p className={`text-xs mt-1 mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                {doc.fileType || "Unknown type"} &middot; {formatFileSize(doc.fileSize)}
              </p>
              <button
                onClick={() => handleDownload(doc)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: "#007AFF" }}
              >
                Download {doc.fileName}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
