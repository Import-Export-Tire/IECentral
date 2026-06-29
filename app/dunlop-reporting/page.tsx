"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { usePermissions } from "@/lib/usePermissions";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const API_BASE = "/api/dunlop";

// Backfill months: Jan 2024 through Feb 2026 (26 months)
const BACKFILL_MONTHS: string[] = [];
for (let y = 2024; y <= 2025; y++) {
  for (let m = 1; m <= 12; m++) {
    BACKFILL_MONTHS.push(`${y}${String(m).padStart(2, "0")}`);
  }
}
BACKFILL_MONTHS.push("202601"); // Jan 2026
BACKFILL_MONTHS.push("202602"); // Feb 2026

function formatMonth(yyyymm: string): string {
  if (yyyymm === "backfill") return "Jan 2024 – Feb 2026";
  const y = yyyymm.slice(0, 4);
  const m = parseInt(yyyymm.slice(4, 6), 10);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[m - 1]} ${y}`;
}

function getDefaultMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface RunLog {
  month: string;
  fileName: string;
  outputFile: string;
  rows: number;
  sftpStatus: "success" | "failed" | "partial";
  env: "dev" | "prod";
  runBy: string;
  timestamp: string;
  errors: string[];
  filterSummary?: {
    totalInput: number;
    afterBrandFilter: number;
    afterLocationFilter: number;
    afterExclusions: number;
    finalOutput: number;
  };
}

type UploadState = "idle" | "uploading" | "processing" | "complete" | "error";

// ─── TABS ────────────────────────────────────────────────────────────────────

const ALL_TABS = ["Run History", "Status", "Settings"] as const;
type AllTabType = (typeof ALL_TABS)[number];

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────

export default function DunlopReportingPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();
  const permissions = usePermissions();

  const [activeTab, setActiveTab] = useState<AllTabType>("Run History");
  const env = "prod" as const;

  const canToggleEnv = false;
  const isSuperAdmin = permissions.tier >= 5;
  const visibleTabs = isSuperAdmin ? ALL_TABS : ALL_TABS.filter(t => t !== "Settings");

  return (
    <Protected>
      <div className="flex h-screen theme-bg-primary">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />
          {/* Header */}
          <header className={`sticky top-0 z-10 border-b px-6 py-4 ${isDark ? "bg-slate-900/95 backdrop-blur border-slate-700" : "bg-white/95 backdrop-blur border-gray-200"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <a href="/reports" className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </a>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? "bg-gradient-to-br from-blue-500/20 to-cyan-600/20" : "bg-gradient-to-br from-blue-100 to-cyan-100"}`}>
                  <svg className={`w-5 h-5 ${isDark ? "text-blue-400" : "text-blue-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div>
                  <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                    Dunlop Sellout Reporter
                  </h1>
                  <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Automated monthly sellout reporting to SRNA — runs 1st of each month
                  </p>
                </div>
              </div>
              {/* Production mode indicator */}
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                PROD
              </span>
            </div>
            {/* Tabs */}
            <div className="flex flex-wrap gap-1 mt-4">
              {visibleTabs.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? isDark ? "bg-blue-500/20 text-blue-400 border border-blue-500/40" : "bg-blue-100 text-blue-700 border border-blue-300"
                      : isDark ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </header>

          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
            {activeTab === "Run History" && (
              <RunHistoryTab isDark={isDark} canDelete={permissions.hasPermission("dunlopReporting.deleteHistory")} canRerun={permissions.hasPermission("dunlopReporting.rerun")} env={env} userName={user?.name ?? "Unknown"} />
            )}
            {activeTab === "Status" && (
              <BackfillTab isDark={isDark} />
            )}
            {activeTab === "Settings" && isSuperAdmin && (
              <SettingsTab isDark={isDark} />
            )}
          </div>
        </main>
      </div>
    </Protected>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1: UPLOAD & RUN
// ═══════════════════════════════════════════════════════════════════════════════

function UploadRunTab({ isDark, env, userName }: { isDark: boolean; env: "dev" | "prod"; userName: string }) {
  const defaultMonth = getDefaultMonth();
  const [selYear, setSelYear] = useState(defaultMonth.slice(0, 4));
  const [selMonth, setSelMonth] = useState(defaultMonth.slice(4, 6));
  const [batchMode, setBatchMode] = useState(false);
  const month = batchMode ? "ALL" : selYear + selMonth;
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [result, setResult] = useState<RunLog | null>(null);
  const [batchResults, setBatchResults] = useState<RunLog[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [submittedMonths, setSubmittedMonths] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const isBatchMode = month === "ALL";
  const canRun = file && month && state === "idle";

  // Fetch submitted months on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/history`);
        if (!res.ok) return;
        const data: RunLog[] = await res.json();
        const done = new Set(data.filter(r => r.sftpStatus === "success").map(r => r.month));
        setSubmittedMonths(done);
      } catch { /* ignore */ }
    })();
  }, []);

  const handleFile = useCallback((f: File | null) => {
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext !== "csv" && ext !== "xlsx") {
      setError("Only .csv and .xlsx files are accepted.");
      return;
    }
    setFile(f);
    setError("");
    setResult(null);
    setBatchResults([]);
    setBatchProgress(null);
    setState("idle");
  }, []);

  const uploadFileToS3 = async (file: File, monthKey: string): Promise<string> => {
    const urlRes = await fetch(`${API_BASE}/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, month: monthKey }),
    });
    if (!urlRes.ok) throw new Error("Failed to get upload URL");
    const { url, key } = await urlRes.json();

    const uploadRes = await fetch(url, {
      method: "PUT",
      body: file,
    });
    if (!uploadRes.ok) throw new Error("Failed to upload file to S3");
    return key;
  };

  const runTransform = async (s3Key: string, monthKey: string): Promise<RunLog> => {
    const runRes = await fetch(`${API_BASE}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ s3_key: s3Key, month: monthKey, env, runBy: userName }),
    });
    if (!runRes.ok) {
      const errBody = await runRes.json().catch(() => ({}));
      throw new Error(errBody.error || "Transform/upload failed");
    }
    return await runRes.json();
  };

  const handleUploadAndRun = async () => {
    if (!file || !month) return;
    setError("");
    setResult(null);
    setBatchResults([]);
    setBatchProgress(null);

    try {
      // Step 1: Upload file to S3 once
      setState("uploading");
      const s3Key = await uploadFileToS3(file, isBatchMode ? "backfill" : month);

      if (isBatchMode) {
        // Batch mode: single combined run with all months in one file
        setState("processing");
        try {
          const runData = await runTransform(s3Key, "backfill");
          setResult(runData);
          if (runData.sftpStatus === "success") {
            setSubmittedMonths(prev => new Set([...prev, ...BACKFILL_MONTHS]));
          }
          setState("complete");
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setError(msg);
          setState("error");
        }
      } else {
        // Single month mode
        setState("processing");
        const runData = await runTransform(s3Key, month);
        setResult(runData);
        if (runData.sftpStatus === "success") {
          setSubmittedMonths(prev => new Set([...prev, month]));
        }
        setState("complete");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setState("error");
    }
  };

  const reset = () => {
    setFile(null);
    setState("idle");
    setResult(null);
    setBatchResults([]);
    setBatchProgress(null);
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  // Year options: 2024 through current year
  const currentYear = new Date().getFullYear();
  const yearOptions: string[] = [];
  for (let y = currentYear; y >= 2024; y--) yearOptions.push(String(y));

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Check if there are pending backfill months
  const pendingBackfillCount = BACKFILL_MONTHS.filter(m => !submittedMonths.has(m)).length;

  return (
    <div className="space-y-6">
      {/* Upload Card */}
      <div className={`rounded-xl border p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
        <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
          Upload JMK Export & Send to Dunlop
        </h2>

        {/* Month + Year picker */}
        <div className="mb-4">
          <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
            Reporting Month
          </label>
          <div className="flex items-center gap-2">
            <select
              value={selMonth}
              onChange={(e) => setSelMonth(e.target.value)}
              className={`px-3 py-2 rounded-lg border text-sm ${
                isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"
              }`}
            >
              {MONTH_NAMES.map((name, i) => {
                const mm = String(i + 1).padStart(2, "0");
                const combo = selYear + mm;
                return (
                  <option key={mm} value={mm}>{name}{submittedMonths.has(combo) ? " \u2714" : ""}</option>
                );
              })}
            </select>
            <select
              value={selYear}
              onChange={(e) => setSelYear(e.target.value)}
              className={`px-3 py-2 rounded-lg border text-sm ${
                isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"
              }`}
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {submittedMonths.has(month) && (
              <span className={`text-xs font-medium px-2 py-1 rounded ${isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"}`}>
                Already submitted
              </span>
            )}
          </div>
          {pendingBackfillCount > 0 && (
            <div className="mt-2">
              {batchMode ? (
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2 py-1 rounded ${isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-700"}`}>
                    Backfill mode: {pendingBackfillCount} months
                  </span>
                  <button
                    onClick={() => setBatchMode(false)}
                    className={`text-xs ${isDark ? "text-slate-400 hover:text-slate-300" : "text-gray-500 hover:text-gray-700"}`}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setBatchMode(true)}
                  className={`text-xs font-medium ${isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-500"}`}
                >
                  Run all pending backfill months ({pendingBackfillCount} remaining)
                </button>
              )}
            </div>
          )}
        </div>

        {/* File drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0] ?? null); }}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            dragOver
              ? isDark ? "border-blue-400 bg-blue-500/10" : "border-blue-400 bg-blue-50"
              : file
                ? isDark ? "border-emerald-500/40 bg-emerald-500/5" : "border-emerald-300 bg-emerald-50"
                : isDark ? "border-slate-600 hover:border-slate-500" : "border-gray-300 hover:border-gray-400"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div>
              <svg className={`w-8 h-8 mx-auto mb-2 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{file.name}</p>
              <p className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                {(file.size / 1024).toFixed(1)} KB — Click to change
              </p>
            </div>
          ) : (
            <div>
              <svg className={`w-8 h-8 mx-auto mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className={`font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                Drop JMK export here, or click to browse
              </p>
              <p className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                Accepts .csv and .xlsx files
              </p>
            </div>
          )}
        </div>

        {/* Action button */}
        <div className="mt-4 flex items-center gap-3">
          {state === "idle" && (
            <button
              onClick={handleUploadAndRun}
              disabled={!canRun}
              className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                canRun
                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                  : isDark ? "bg-slate-700 text-slate-500 cursor-not-allowed" : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }`}
            >
              Upload & Run
            </button>
          )}
          {(state === "uploading" || state === "processing") && (
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className={`text-sm font-medium ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                {state === "uploading" ? "Uploading to S3..." :
                  batchProgress
                    ? `Processing month ${batchProgress.current} of ${batchProgress.total}...`
                    : "Processing & sending to SFTP..."}
              </span>
            </div>
          )}
          {(state === "complete" || state === "error") && (
            <button
              onClick={reset}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                isDark ? "bg-slate-700 hover:bg-slate-600 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"
              }`}
            >
              Run Another
            </button>
          )}
          {env === "prod" && state === "idle" && (
            <span className={`text-xs font-medium px-2 py-1 rounded ${isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-600"}`}>
              PROD
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className={`mt-4 p-4 rounded-lg border ${isDark ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-red-50 border-red-200 text-red-700"}`}>
            <p className="text-sm font-medium">Error</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {/* Success */}
        {result && state === "complete" && (
          <div className={`mt-4 p-4 rounded-lg border ${isDark ? "bg-emerald-500/10 border-emerald-500/30" : "bg-emerald-50 border-emerald-200"}`}>
            <p className={`text-sm font-semibold ${isDark ? "text-emerald-400" : "text-emerald-700"}`}>
              Successfully sent to Dunlop ({env.toUpperCase()})
            </p>
            <div className={`mt-2 grid grid-cols-2 gap-2 text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
              <div>Rows reported: <span className="font-mono font-semibold">{result.rows}</span></div>
              <div>File: <span className="font-mono text-xs">{result.outputFile}</span></div>
              <div>SFTP status: <StatusBadge status={result.sftpStatus} isDark={isDark} /></div>
              <div>Timestamp: {formatTimestamp(result.timestamp)}</div>
            </div>
            {result.filterSummary && (
              <div className={`mt-3 pt-3 border-t text-xs space-y-1 ${isDark ? "border-slate-700 text-slate-400" : "border-gray-200 text-gray-500"}`}>
                <p>Total input rows: {result.filterSummary.totalInput}</p>
                <p>After brand filter (FAL/DUN): {result.filterSummary.afterBrandFilter}</p>
                <p>After location filter (W07/W08/W09/R10): {result.filterSummary.afterLocationFilter}</p>
                <p>After exclusions: {result.filterSummary.afterExclusions}</p>
                <p>Final output: {result.filterSummary.finalOutput}</p>
              </div>
            )}
          </div>
        )}
        {/* Batch results */}
        {batchResults.length > 0 && state === "complete" && (
          <div className={`mt-4 p-4 rounded-lg border ${isDark ? "bg-slate-800/30 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
            <p className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>
              Backfill Results — {batchResults.filter(r => r.sftpStatus === "success").length} of {batchResults.length} months succeeded
            </p>
            <div className="space-y-1">
              {batchResults.map((r, i) => (
                <div key={i} className={`flex items-center justify-between text-sm px-3 py-1.5 rounded ${
                  r.sftpStatus === "success"
                    ? isDark ? "bg-emerald-500/10" : "bg-emerald-50"
                    : isDark ? "bg-red-500/10" : "bg-red-50"
                }`}>
                  <span className={isDark ? "text-slate-300" : "text-gray-700"}>{formatMonth(r.month)}</span>
                  <div className="flex items-center gap-3">
                    <span className={`font-mono text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{r.rows} rows</span>
                    <StatusBadge status={r.sftpStatus} isDark={isDark} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SFTP Info Card */}
      <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-800/30 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
        <div className={`flex items-center gap-4 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
          <div>
            <span className="font-semibold">Static IP (for SFTP whitelist):</span>
            <span className={`ml-2 font-mono font-bold ${isDark ? "text-blue-400" : "text-blue-600"}`}>54.163.176.67</span>
          </div>
          <div className={`border-l pl-4 ${isDark ? "border-slate-600" : "border-gray-300"}`}>
            <span className="font-semibold">SFTP Host:</span>
            <span className="ml-2 font-mono">{env === "prod" ? "landp.srnatire.com" : "landpdev.srnatire.com"}:22</span>
          </div>
          <div className={`border-l pl-4 ${isDark ? "border-slate-600" : "border-gray-300"}`}>
            <span className="font-semibold">Directory:</span>
            <span className="ml-2 font-mono">inbound</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2: RUN HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

function RunHistoryTab({ isDark, canDelete, canRerun, env, userName }: { isDark: boolean; canDelete: boolean; canRerun: boolean; env: "dev" | "prod"; userName: string }) {
  const [history, setHistory] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rerunning, setRerunning] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/history`);
        if (!res.ok) throw new Error("Failed to fetch history");
        const data = await res.json();
        setHistory(data);
      } catch {
        setHistory([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleRerun = async (run: RunLog, idx: number) => {
    setRerunning(idx);
    try {
      // Re-upload the same S3 key and re-run
      const res = await fetch(`${API_BASE}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s3_key: `jmk-uploads/${run.month}/${run.fileName}`, month: run.month, env, runBy: userName }),
      });
      if (res.ok) {
        const newRun: RunLog = await res.json();
        setHistory(prev => [newRun, ...prev]);
      }
    } catch { /* ignore */ } finally {
      setRerunning(null);
    }
  };

  const handleDelete = async (run: RunLog, idx: number) => {
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/history`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: run.month, timestamp: run.timestamp }),
      });
      if (res.ok) {
        setHistory(prev => prev.filter((_, i) => i !== idx));
      }
    } catch { /* ignore */ } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className={`text-center py-16 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
        <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="font-medium">No runs yet</p>
        <p className="text-sm mt-1">Upload a JMK file to get started.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
    <div className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-700" : "border-gray-200"}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className={isDark ? "bg-slate-800/80" : "bg-gray-50"}>
            {["Month", "File Uploaded", "Rows", "SFTP", "Env", "Run By", "Timestamp"].map(h => (
              <th key={h} className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((run, i) => (
            <>
              <tr
                key={i}
                onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                className={`cursor-pointer transition-colors ${
                  isDark ? "hover:bg-slate-800/50 border-t border-slate-700/50" : "hover:bg-gray-50 border-t border-gray-100"
                }`}
              >
                <td className={`px-4 py-3 font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{formatMonth(run.month)}</td>
                <td className={`px-4 py-3 font-mono text-xs ${isDark ? "text-slate-300" : "text-gray-600"}`}>{run.fileName}</td>
                <td className={`px-4 py-3 font-mono ${isDark ? "text-slate-300" : "text-gray-700"}`}>{run.rows}</td>
                <td className="px-4 py-3"><StatusBadge status={run.sftpStatus} isDark={isDark} /></td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                    run.env === "prod"
                      ? isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-600"
                      : isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                  }`}>
                    {run.env.toUpperCase()}
                  </span>
                </td>
                <td className={`px-4 py-3 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{run.runBy}</td>
                <td className={`px-4 py-3 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{formatTimestamp(run.timestamp)}</td>
              </tr>
              {expandedIdx === i && (
                <tr key={`${i}-detail`}>
                  <td colSpan={7} className={`px-6 py-4 ${isDark ? "bg-slate-800/30" : "bg-gray-50"}`}>
                    <div className={`text-xs space-y-2 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                      <p>
                        <span className="font-semibold">Output file:</span>{" "}
                        {run.outputFile && run.rows > 0 ? (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await fetch(`${API_BASE}/upload-url`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "download", filename: run.outputFile }),
                                });
                                if (res.ok) {
                                  const { url } = await res.json();
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download = run.outputFile;
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                }
                              } catch { /* ignore */ }
                            }}
                            className={`underline font-mono ${isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-500"}`}
                          >
                            {run.outputFile}
                          </button>
                        ) : (
                          <span className="font-mono">{run.outputFile}</span>
                        )}
                      </p>
                      {run.filterSummary && (
                        <div>
                          <span className="font-semibold">Filter pipeline:</span>
                          <span className="ml-2">
                            {run.filterSummary.totalInput} total
                            → {run.filterSummary.afterBrandFilter} brand
                            → {run.filterSummary.afterLocationFilter} location
                            → {run.filterSummary.afterExclusions} exclusions
                            → {run.filterSummary.finalOutput} output
                          </span>
                        </div>
                      )}
                      {run.errors.length > 0 && (
                        <div>
                          <span className="font-semibold text-red-400">Errors:</span>
                          <ul className="ml-4 mt-1 list-disc">
                            {run.errors.map((e, j) => <li key={j}>{e}</li>)}
                          </ul>
                        </div>
                      )}
                      {canRerun && (
                        <div className="mt-3 pt-3 border-t border-slate-700/30 flex items-center gap-4">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRerun(run, i); }}
                            disabled={rerunning === i}
                            className={`text-xs font-medium px-3 py-1 rounded ${
                              isDark ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                            } disabled:opacity-50`}
                          >
                            {rerunning === i ? "Re-running..." : "Re-run this month"}
                          </button>
                        </div>
                      )}
                      {canDelete && (
                        <div className={`${canRerun ? "mt-2" : "mt-3 pt-3 border-t border-slate-700/30"}`}>
                          {confirmDelete === i ? (
                            <div className="flex items-center gap-3">
                              <span className={`text-xs font-semibold ${isDark ? "text-red-400" : "text-red-600"}`}>
                                This will delete the run log from S3. The file already sent to Dunlop SFTP cannot be recalled. Delete?
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(run, i); }}
                                disabled={deleting}
                                className="px-3 py-1 rounded text-xs font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                              >
                                {deleting ? "Deleting..." : "Yes, Delete"}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                                className={`px-3 py-1 rounded text-xs font-medium ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-200 text-gray-700"}`}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmDelete(i); }}
                              className={`text-xs font-medium ${isDark ? "text-red-400 hover:text-red-300" : "text-red-500 hover:text-red-600"}`}
                            >
                              Delete this run
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3: BACKFILL STATUS
// ═══════════════════════════════════════════════════════════════════════════════

function BackfillTab({ isDark }: { isDark: boolean }) {
  const [history, setHistory] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/history`);
        if (!res.ok) throw new Error("Failed to fetch history");
        const data = await res.json();
        setHistory(data);
      } catch {
        setHistory([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Full range: Jan 2024 through current month
  const allMonths: string[] = [];
  const now = new Date();
  const cursor = new Date(2024, 0, 1); // Jan 2024
  while (cursor <= now) {
    allMonths.push(`${cursor.getFullYear()}${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // Backlog months (Jan 2024 - Feb 2026) are all complete
  const backlogComplete = new Set<string>();
  const backlogEnd = new Date(2026, 1, 1); // Feb 2026
  const bc = new Date(2024, 0, 1);
  while (bc <= backlogEnd) {
    backlogComplete.add(`${bc.getFullYear()}${String(bc.getMonth() + 1).padStart(2, "0")}`);
    bc.setMonth(bc.getMonth() + 1);
  }

  const runCompleted = new Set(
    history.filter(r => r.sftpStatus === "success").map(r => r.month)
  );

  // Merge: backlog + run history
  const completedMonths = new Set([...backlogComplete, ...runCompleted]);
  const completedCount = allMonths.filter(m => completedMonths.has(m)).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className={`rounded-xl border p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
            Submission Status
          </h2>
          <span className={`text-sm font-mono font-bold ${isDark ? "text-blue-400" : "text-blue-600"}`}>
            {completedCount} / {allMonths.length}
          </span>
        </div>
        <div className={`w-full h-3 rounded-full overflow-hidden ${isDark ? "bg-slate-700" : "bg-gray-200"}`}>
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
            style={{ width: `${(completedCount / allMonths.length) * 100}%` }}
          />
        </div>
        <p className={`text-xs mt-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
          Jan 2024 — Present
        </p>
      </div>

      {/* Month list */}
      <div className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-700" : "border-gray-200"}`}>
        {allMonths.map((m, i) => {
          const done = completedMonths.has(m);
          const run = history.find(r => r.month === m && r.sftpStatus === "success");
          return (
            <div
              key={m}
              className={`flex items-center justify-between px-5 py-3 ${
                i > 0 ? isDark ? "border-t border-slate-700/50" : "border-t border-gray-100" : ""
              } ${isDark ? "bg-slate-800/30" : "bg-white"}`}
              >
              <div className="flex items-center gap-3">
                {done ? (
                  <svg className={`w-5 h-5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <div className={`w-5 h-5 rounded-full border-2 ${isDark ? "border-slate-600" : "border-gray-300"}`} />
                )}
                <span className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{formatMonth(m)}</span>
              </div>
              <div className="flex items-center gap-3">
                {done && run && (
                  <span className={`text-xs font-mono ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    {run.rows} rows — {formatTimestamp(run.timestamp)}
                  </span>
                )}
                {done ? (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"}`}>
                    Submitted
                  </span>
                ) : (
                  <span className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Pending
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4: SETTINGS (super admin only)
// ═══════════════════════════════════════════════════════════════════════════════

interface SftpCreds {
  host: string;
  port: number;
  username: string;
  password: string;
  directory: string;
}

function SettingsTab({ isDark }: { isDark: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [devCreds, setDevCreds] = useState<SftpCreds>({ host: "", port: 22, username: "", password: "", directory: "inbound" });
  const [prodCreds, setProdCreds] = useState<SftpCreds>({ host: "", port: 22, username: "", password: "", directory: "inbound" });
  const [showPasswords, setShowPasswords] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/settings`);
        if (res.ok) {
          const data = await res.json();
          if (data.sftp_dev) setDevCreds(data.sftp_dev);
          if (data.sftp_prod) setProdCreds(data.sftp_prod);
        }
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sftp_dev: devCreds, sftp_prod: prodCreds }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save credentials");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const inputClass = `w-full px-3 py-2 rounded-lg border text-sm font-mono ${
    isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"
  }`;
  const labelClass = `block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>SFTP Credentials</h2>
        <button
          onClick={() => setShowPasswords(!showPasswords)}
          className={`text-xs font-medium ${isDark ? "text-slate-400 hover:text-slate-300" : "text-gray-500 hover:text-gray-700"}`}
        >
          {showPasswords ? "Hide passwords" : "Show passwords"}
        </button>
      </div>

      {[
        { label: "Dev Environment", creds: devCreds, setCreds: setDevCreds },
        { label: "Prod Environment", creds: prodCreds, setCreds: setProdCreds },
      ].map(({ label, creds, setCreds }) => (
        <div key={label} className={`rounded-xl border p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
          <h3 className={`text-sm font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>{label}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Host</label>
              <input className={inputClass} value={creds.host} onChange={(e) => setCreds({ ...creds, host: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Port</label>
              <input className={inputClass} type="number" value={creds.port} onChange={(e) => setCreds({ ...creds, port: parseInt(e.target.value) || 22 })} />
            </div>
            <div>
              <label className={labelClass}>Username</label>
              <input className={inputClass} value={creds.username} onChange={(e) => setCreds({ ...creds, username: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Password</label>
              <input className={inputClass} type={showPasswords ? "text" : "password"} value={creds.password} onChange={(e) => setCreds({ ...creds, password: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Directory</label>
              <input className={inputClass} value={creds.directory} onChange={(e) => setCreds({ ...creds, directory: e.target.value })} />
            </div>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Credentials"}
        </button>
        {saved && (
          <span className={`text-sm font-medium ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>Saved</span>
        )}
        {error && (
          <span className={`text-sm font-medium ${isDark ? "text-red-400" : "text-red-600"}`}>{error}</span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function StatusBadge({ status, isDark }: { status: "success" | "failed" | "partial"; isDark: boolean }) {
  const colors = {
    success: isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700",
    failed: isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-700",
    partial: isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
