"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useDocHub } from "./DocHubContext";
import { getFileMimeType, formatFileSize } from "./types";

interface PendingFile {
  file: File;
  path: string;        // posix path inside the chosen folder, e.g. "project/sub/x.pdf"
  folderPath: string;  // the subfolder path part, e.g. "project/sub"
  status: "pending" | "uploading" | "done" | "skipped" | "error";
  message?: string;
}

// Filter out OS noise that shouldn't end up in Doc Hub.
function isSystemFile(name: string): boolean {
  if (name.startsWith(".")) return true;
  if (name === "Thumbs.db" || name === "Desktop.ini") return true;
  return false;
}

export default function FolderUploadModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { isDark, user } = useDocHub();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const createDocument = useMutation(api.documents.create);
  const createFolder = useMutation(api.documentFolders.create);

  // Force webkitdirectory + directory attributes onto the input element
  // directly — React strips these from JSX in some setups, and without them
  // the file picker opens in single-file mode (which silently treats a
  // folder selection as a 0-byte file entry).
  useEffect(() => {
    if (!open) return;
    const el = fileInputRef.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
      el.setAttribute("mozdirectory", "");
    }
  }, [open]);

  const [topFolderName, setTopFolderName] = useState<string>("");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState({ uploaded: 0, total: 0 });
  const [error, setError] = useState<string>("");

  const reset = () => {
    setTopFolderName("");
    setPending([]);
    setRunning(false);
    setDone(false);
    setProgress({ uploaded: 0, total: 0 });
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Sanity check: if the picker gave us exactly one file with no
    // webkitRelativePath, the input opened in single-file mode (browser
    // didn't honor webkitdirectory). Bail with a helpful error instead of
    // silently uploading a 0-byte folder representation.
    const firstRel = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || "";
    if (files.length === 1 && !firstRel) {
      setError(
        "Your browser opened this in single-file mode instead of folder mode. " +
        "Close this dialog, hard-refresh the page (⌘+Shift+R), and try again. " +
        "If it still fails, use Chrome — Safari sometimes blocks folder upload."
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    // Determine top folder from the first file's relative path
    // (webkitRelativePath uses forward slashes regardless of OS)
    const firstPath = firstRel || files[0].name;
    const top = firstPath.split("/")[0] || "Uploaded Folder";
    setTopFolderName(top);

    const parsed: PendingFile[] = [];
    for (const f of files) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const parts = rel.split("/");
      const fileName = parts[parts.length - 1];
      if (isSystemFile(fileName)) continue;
      // Skip any file whose ancestor is a hidden directory
      if (parts.slice(0, -1).some(p => p.startsWith("."))) continue;
      const folderPath = parts.slice(0, -1).join("/"); // e.g. "project/sub"
      parsed.push({ file: f, path: rel, folderPath, status: "pending" });
    }
    setPending(parsed);
    setProgress({ uploaded: 0, total: parsed.length });
  }, []);

  // Plan: unique folder paths to create, sorted shallow-first so parents
  // always exist before their children.
  const folderPlan = useMemo(() => {
    const set = new Set<string>();
    for (const p of pending) {
      // Walk every ancestor path
      const parts = p.folderPath.split("/").filter(Boolean);
      for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join("/"));
    }
    return [...set].sort((a, b) => a.split("/").length - b.split("/").length);
  }, [pending]);

  const totalBytes = useMemo(() => pending.reduce((s, p) => s + p.file.size, 0), [pending]);

  const start = async () => {
    if (!user) { setError("Not signed in"); return; }
    if (pending.length === 0) { setError("Nothing to upload"); return; }
    setRunning(true);
    setError("");

    // 1. Create the top-level folder (always new, per Andy's spec)
    let topFolderId: Id<"documentFolders">;
    try {
      // Append a short timestamp to avoid name collisions
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T-]/g, "");
      const finalName = `${topFolderName} (${stamp})`;
      topFolderId = await createFolder({
        name: finalName,
        description: undefined,
        password: undefined,
        visibility: "private",
        parentFolderId: undefined,
        createdBy: user._id,
        createdByName: user.name,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create top folder");
      setRunning(false);
      return;
    }

    // 2. Create every subfolder. Map subfolder-relative-path → folderId.
    // The selected top folder ITSELF maps to topFolderId (path "").
    const folderIdByPath = new Map<string, Id<"documentFolders">>();
    folderIdByPath.set("", topFolderId);

    // folderPlan paths look like "level1", "level1/level2", etc. — relative to
    // the selected root. We strip the leading top-folder segment because
    // that's already created.
    const subPaths = folderPlan.map(p => {
      const parts = p.split("/");
      // Drop the first segment (which IS the top folder, named topFolderName)
      return parts.slice(1).join("/");
    }).filter(Boolean);

    for (const sub of subPaths) {
      const parts = sub.split("/");
      const parentKey = parts.slice(0, -1).join("/");
      const name = parts[parts.length - 1];
      const parentId = folderIdByPath.get(parentKey);
      if (!parentId) {
        setError(`Internal: missing parent for ${sub}`);
        continue;
      }
      try {
        const newId = await createFolder({
          name,
          description: undefined,
          password: undefined,
          visibility: "private",
          parentFolderId: parentId,
          createdBy: user._id,
          createdByName: user.name,
        });
        folderIdByPath.set(sub, newId);
      } catch (e) {
        setError(`Subfolder "${sub}" failed: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }

    // 3. Upload files (concurrency-limited)
    const CONCURRENCY = 4;
    let uploaded = 0;
    const queue = [...pending];
    let active = 0;

    await new Promise<void>((resolve) => {
      const next = () => {
        if (queue.length === 0 && active === 0) { resolve(); return; }
        while (active < CONCURRENCY && queue.length > 0) {
          const item = queue.shift()!;
          active++;
          (async () => {
            // Determine subfolder relative to top
            const parts = item.folderPath.split("/");
            const sub = parts.slice(1).join("/");
            const targetFolderId = folderIdByPath.get(sub) || topFolderId;
            try {
              setPending(prev => prev.map(p => p === item ? { ...p, status: "uploading" } : p));
              const uploadUrl = await generateUploadUrl({ requestingUserId: user._id });
              const mimeType = getFileMimeType(item.file);
              const res = await fetch(uploadUrl, {
                method: "POST",
                headers: { "Content-Type": mimeType },
                body: item.file,
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const { storageId } = await res.json();
              await createDocument({
                name: item.file.name.replace(/\.[^/.]+$/, ""),
                description: undefined,
                category: "other",
                folderId: targetFolderId,
                fileId: storageId,
                fileName: item.file.name,
                fileType: mimeType,
                fileSize: item.file.size,
                uploadedBy: user._id,
                uploadedByName: user.name,
                visibility: "private",
              });
              setPending(prev => prev.map(p => p === item ? { ...p, status: "done" } : p));
              uploaded++;
              setProgress({ uploaded, total: pending.length });
            } catch (e) {
              setPending(prev => prev.map(p => p === item ? { ...p, status: "error", message: e instanceof Error ? e.message : "upload failed" } : p));
            } finally {
              active--;
              next();
            }
          })();
        }
      };
      next();
    });

    setDone(true);
    setRunning(false);
  };

  if (!open) return null;

  const inputClass = `w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 ${
    isDark ? "bg-slate-900 border-slate-700 text-white" : "bg-white border-gray-300 text-gray-900"
  }`;

  const errored = pending.filter(p => p.status === "error");
  const completed = pending.filter(p => p.status === "done");

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className={`w-full max-w-2xl max-h-[95vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden ${isDark ? "bg-slate-900 border border-slate-700" : "bg-white border border-gray-200"}`}>
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <div>
            <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Upload Folder</h2>
            <p className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Pick a local folder — the full subfolder tree is recreated in Doc Hub at root.
            </p>
          </div>
          <button
            onClick={() => { if (!running) { reset(); onClose(); } }}
            disabled={running}
            className={`p-1.5 rounded-full disabled:opacity-50 ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className={`p-3 rounded-xl text-sm ${isDark ? "bg-red-500/10 border border-red-500/20 text-red-400" : "bg-red-50 border border-red-200 text-red-700"}`}>{error}</div>
          )}

          {pending.length === 0 && (
            <label
              htmlFor="folder-input"
              className={`block border-2 border-dashed rounded-xl p-10 text-center cursor-pointer ${
                isDark ? "border-slate-700 hover:border-slate-600" : "border-gray-300 hover:border-gray-400"
              }`}
            >
              <svg className={`w-12 h-12 mx-auto mb-3 ${isDark ? "text-slate-600" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
              <p className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>Pick a folder to upload</p>
              <p className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-500"}`}>Subfolders and files are mirrored exactly. Hidden files (.DS_Store etc.) are skipped.</p>
              <input
                id="folder-input"
                ref={fileInputRef}
                type="file"
                onChange={handlePick}
                multiple
                {...{ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>}
                className="hidden"
              />
            </label>
          )}

          {pending.length > 0 && (
            <>
              {/* Summary */}
              <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className={`text-2xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>{pending.length}</p>
                    <p className={`text-[11px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>files</p>
                  </div>
                  <div>
                    <p className={`text-2xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>{folderPlan.length}</p>
                    <p className={`text-[11px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>folders</p>
                  </div>
                  <div>
                    <p className={`text-2xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>{formatFileSize(totalBytes)}</p>
                    <p className={`text-[11px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>total</p>
                  </div>
                </div>
                <p className={`text-xs mt-3 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                  Will create top folder: <strong className={isDark ? "text-white" : "text-gray-900"}>{topFolderName}</strong> (with timestamp suffix)
                </p>
              </div>

              {/* Progress bar */}
              {(running || done) && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className={isDark ? "text-slate-400" : "text-gray-600"}>
                      {done ? "Complete" : "Uploading…"} {progress.uploaded} / {progress.total}
                    </span>
                    {errored.length > 0 && (
                      <span className="text-red-500">{errored.length} failed</span>
                    )}
                  </div>
                  <div className={`h-2 rounded-full overflow-hidden ${isDark ? "bg-slate-800" : "bg-gray-200"}`}>
                    <div
                      className="h-full bg-[#007AFF] transition-all"
                      style={{ width: `${(progress.uploaded / Math.max(1, progress.total)) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* File list (capped at 200 for sanity) */}
              <div className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <div className="max-h-64 overflow-y-auto">
                  {pending.slice(0, 200).map((p, i) => (
                    <div key={i} className={`px-3 py-1.5 flex items-center gap-2 text-xs border-b last:border-b-0 ${isDark ? "border-slate-800" : "border-gray-100"}`}>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        p.status === "done" ? "bg-green-500" :
                        p.status === "uploading" ? "bg-blue-500 animate-pulse" :
                        p.status === "error" ? "bg-red-500" :
                        p.status === "skipped" ? "bg-gray-400" :
                        isDark ? "bg-slate-600" : "bg-gray-300"
                      }`} />
                      <span className={`flex-1 truncate ${isDark ? "text-slate-300" : "text-gray-700"}`} title={p.path}>{p.path}</span>
                      <span className={`tabular-nums ${isDark ? "text-slate-500" : "text-gray-400"}`}>{formatFileSize(p.file.size)}</span>
                      {p.status === "error" && <span className="text-red-500 max-w-[120px] truncate" title={p.message}>{p.message}</span>}
                    </div>
                  ))}
                </div>
                {pending.length > 200 && (
                  <div className={`px-3 py-1.5 text-[11px] text-center ${isDark ? "text-slate-500 bg-slate-800/50" : "text-gray-400 bg-gray-50"}`}>
                    showing first 200 of {pending.length}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className={`px-6 py-3 border-t flex items-center justify-between gap-2 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            {done && `Done — ${completed.length} uploaded${errored.length > 0 ? `, ${errored.length} failed` : ""}.`}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { if (!running) { reset(); onClose(); } }}
              disabled={running}
              className={`px-4 py-2 text-sm font-medium rounded-full disabled:opacity-50 ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-800"}`}
            >
              {done ? "Close" : "Cancel"}
            </button>
            {!done && pending.length > 0 && (
              <button
                onClick={start}
                disabled={running || pending.length === 0}
                className="px-5 py-2 text-sm font-medium rounded-full bg-[#007AFF] hover:bg-[#0063CC] text-white shadow-sm disabled:opacity-50"
              >
                {running ? "Uploading…" : `Upload ${pending.length} files`}
              </button>
            )}
            {done && (
              <button
                onClick={() => { reset(); }}
                className="px-5 py-2 text-sm font-medium rounded-full bg-[#007AFF] hover:bg-[#0063CC] text-white shadow-sm"
              >
                Upload another folder
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
