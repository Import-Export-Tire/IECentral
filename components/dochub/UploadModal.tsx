"use client";

import { useEffect, useState, useRef } from "react";
import { useDocHub } from "./DocHubContext";
import { CATEGORIES, formatFileSize } from "./types";

export default function UploadModal() {
  const { isDark, showUploadModal, setShowUploadModal, handleUpload, uploading } = useDocHub();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("forms");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [expirationDate, setExpirationDate] = useState("");
  const [expirationAlertDays, setExpirationAlertDays] = useState("30");
  const [requiresSignature, setRequiresSignature] = useState(false);
  const [visibility, setVisibility] = useState("private");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset every time the modal opens. The parent closes the modal directly
  // after a successful upload, bypassing our local `close()` reset, so
  // without this the previous file/name is still here on reopen.
  useEffect(() => {
    if (showUploadModal) {
      setName("");
      setDescription("");
      setCategory("forms");
      setSelectedFile(null);
      setExpirationDate("");
      setExpirationAlertDays("30");
      setRequiresSignature(false);
      setVisibility("private");
      setShowAdvanced(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [showUploadModal]);

  if (!showUploadModal) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!name) setName(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;
    await handleUpload(
      selectedFile, name, description, category,
      expirationDate || undefined,
      expirationAlertDays ? parseInt(expirationAlertDays) : undefined,
      requiresSignature || undefined,
      visibility
    );
    // Only reset if upload succeeded (modal was closed by handleUpload)
    // If it failed, keep form data so user can retry
    if (!showUploadModal) return;
    // Modal still open = upload failed, don't reset
  };

  const close = () => {
    setShowUploadModal(false);
    setName("");
    setDescription("");
    setCategory("forms");
    setSelectedFile(null);
    setVisibility("private");
    setShowAdvanced(false);
  };

  const inputClass = `w-full px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 transition-colors ${
    isDark
      ? "bg-slate-800/50 border-slate-700 text-white placeholder-slate-500 focus:ring-cyan-500/50 focus:border-cyan-500"
      : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-blue-500/50 focus:border-blue-500"
  }`;

  const labelClass = `block text-xs font-medium mb-1.5 ${isDark ? "text-slate-400" : "text-gray-600"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={close}>
      <div className={`absolute inset-0 ${isDark ? "bg-black/70" : "bg-black/40"} backdrop-blur-sm`} />

      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-lg mx-4 rounded-2xl overflow-hidden ${
          isDark ? "bg-slate-900 border border-slate-700" : "bg-white border border-gray-200 shadow-2xl"
        }`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Upload Document</h2>
          <button onClick={close} className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* File Drop Zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
              selectedFile
                ? isDark ? "border-cyan-500/30 bg-cyan-500/5" : "border-blue-300 bg-blue-50"
                : isDark ? "border-slate-700 hover:border-slate-600" : "border-gray-200 hover:border-gray-300"
            }`}
          >
            {selectedFile ? (
              <div className="flex items-center justify-center gap-3">
                <svg className={`w-8 h-8 ${isDark ? "text-cyan-400" : "text-blue-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-left">
                  <p className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{selectedFile.name}</p>
                  <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{formatFileSize(selectedFile.size)}</p>
                </div>
              </div>
            ) : (
              <>
                <svg className={`w-10 h-10 mx-auto mb-2 ${isDark ? "text-slate-600" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Click to browse or drag a file here</p>
                <p className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>PDF, Word, Excel, Images, and more</p>
              </>
            )}
            <input ref={fileInputRef} type="file" onChange={handleFileSelect} className="hidden" />
          </div>

          {/* Name */}
          <div>
            <label className={labelClass}>Document Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter name..." className={inputClass} required />
          </div>

          {/* Description */}
          <div>
            <label className={labelClass}>Description <span className={isDark ? "text-slate-600" : "text-gray-400"}>(optional)</span></label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description..." rows={2} className={inputClass} />
          </div>

          {/* Category */}
          <div>
            <label className={labelClass}>Category</label>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(cat.value)}
                  className={`px-3 py-2 text-xs font-medium rounded-xl border transition-all ${
                    category === cat.value
                      ? isDark ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-400" : "bg-blue-50 border-blue-300 text-blue-700"
                      : isDark ? "border-slate-700 text-slate-400 hover:border-slate-600" : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Visibility */}
          <div>
            <label className={labelClass}>Who can see this?</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setVisibility("private")}
                className={`px-3 py-2 text-xs font-medium rounded-xl border transition-all flex items-center gap-1.5 ${
                  visibility === "private"
                    ? isDark ? "bg-slate-700/80 border-slate-500 text-white" : "bg-gray-100 border-gray-400 text-gray-900"
                    : isDark ? "border-slate-700 text-slate-400 hover:border-slate-600" : "border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Just Me
              </button>
              <button
                type="button"
                onClick={() => setVisibility("internal")}
                className={`px-3 py-2 text-xs font-medium rounded-xl border transition-all flex items-center gap-1.5 ${
                  visibility === "internal"
                    ? isDark ? "bg-blue-500/20 border-blue-500/40 text-blue-400" : "bg-blue-50 border-blue-300 text-blue-700"
                    : isDark ? "border-slate-700 text-slate-400 hover:border-slate-600" : "border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                Team
              </button>
              <button
                type="button"
                onClick={() => setVisibility("community")}
                className={`px-3 py-2 text-xs font-medium rounded-xl border transition-all flex items-center gap-1.5 ${
                  visibility === "community"
                    ? isDark ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" : "bg-emerald-50 border-emerald-300 text-emerald-700"
                    : isDark ? "border-slate-700 text-slate-400 hover:border-slate-600" : "border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064" />
                </svg>
                Everyone
              </button>
            </div>
          </div>

          {/* Advanced options */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`flex items-center gap-1 text-xs font-medium transition-colors ${isDark ? "text-slate-400 hover:text-slate-300" : "text-gray-500 hover:text-gray-600"}`}
          >
            <svg className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            Advanced options
          </button>

          {showAdvanced && (
            <div className={`space-y-3 p-3 rounded-xl ${isDark ? "bg-slate-800/30" : "bg-gray-50"}`}>
              <div>
                <label className={labelClass}>Expiration Date</label>
                <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} className={inputClass} />
              </div>
              {expirationDate && (
                <div>
                  <label className={labelClass}>Alert Days Before</label>
                  <input type="number" value={expirationAlertDays} onChange={(e) => setExpirationAlertDays(e.target.value)} className={inputClass} />
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={requiresSignature} onChange={(e) => setRequiresSignature(e.target.checked)} className="rounded" />
                <span className={`text-xs ${isDark ? "text-slate-300" : "text-gray-700"}`}>Requires e-signature</span>
              </label>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!selectedFile || !name || uploading}
            className={`w-full py-2.5 text-sm font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              isDark
                ? "bg-cyan-500 text-white hover:bg-cyan-600 shadow-lg shadow-cyan-500/20"
                : "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/20"
            }`}
          >
            {uploading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Uploading...
              </span>
            ) : "Upload Document"}
          </button>
        </form>
      </div>
    </div>
  );
}
