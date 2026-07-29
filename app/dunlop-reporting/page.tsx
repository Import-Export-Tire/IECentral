"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { usePermissions } from "@/lib/usePermissions";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";

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
      <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />

          {/* Sticky iOS-style page header */}
          <header className={`sticky top-0 z-10 border-b px-4 sm:px-6 py-3 sm:py-4 backdrop-blur-sm ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <a
                  href="/reports"
                  className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5 flex-shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </a>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isDark ? "bg-gradient-to-br from-blue-500/20 to-cyan-600/20" : "bg-gradient-to-br from-blue-100 to-cyan-100"}`}>
                  <svg className={`w-5 h-5 ${isDark ? "text-blue-400" : "text-blue-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold theme-text-primary">Dunlop Sellout Reporter</h1>
                  <p className="text-xs mt-0.5 theme-text-tertiary">
                    Automated monthly sellout reporting to SRNA — runs 1st of each month
                  </p>
                </div>
              </div>
              {/* Production mode indicator */}
              <span className="ui-badge ui-badge-green font-bold">PROD</span>
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap gap-1 mt-4">
              {visibleTabs.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? isDark
                        ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                        : "bg-blue-100 text-blue-700 border border-blue-300"
                      : "theme-text-tertiary hover:theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </header>

          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
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
    <div className="space-y-4">
      {/* Upload Card */}
      <Card>
        <SectionHeader title="Upload JMK Export & Send to Dunlop" />

        {/* Month + Year picker */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 theme-text-secondary">
            Reporting Month
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selMonth}
              onChange={(e) => setSelMonth(e.target.value)}
              className="theme-input px-3 py-2 text-sm"
            >
              {MONTH_NAMES.map((name, i) => {
                const mm = String(i + 1).padStart(2, "0");
                const combo = selYear + mm;
                return (
                  <option key={mm} value={mm}>{name}{submittedMonths.has(combo) ? " ✔" : ""}</option>
                );
              })}
            </select>
            <select
              value={selYear}
              onChange={(e) => setSelYear(e.target.value)}
              className="theme-input px-3 py-2 text-sm"
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {submittedMonths.has(month) && (
              <span className="ui-badge ui-badge-green">Already submitted</span>
            )}
          </div>
          {pendingBackfillCount > 0 && (
            <div className="mt-2">
              {batchMode ? (
                <div className="flex items-center gap-2">
                  <span className="ui-badge ui-badge-blue">
                    Backfill mode: {pendingBackfillCount} months
                  </span>
                  <button
                    onClick={() => setBatchMode(false)}
                    className="text-xs theme-text-tertiary hover:theme-text-secondary"
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
              <p className="font-medium theme-text-primary">{file.name}</p>
              <p className="text-xs mt-1 theme-text-tertiary">
                {(file.size / 1024).toFixed(1)} KB — Click to change
              </p>
            </div>
          ) : (
            <div>
              <svg className="w-8 h-8 mx-auto mb-2 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="font-medium theme-text-secondary">
                Drop JMK export here, or click to browse
              </p>
              <p className="text-xs mt-1 theme-text-tertiary">
                Accepts .csv and .xlsx files
              </p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-4 flex items-center gap-3">
          {state === "idle" && (
            <Button
              variant="primary"
              onClick={handleUploadAndRun}
              disabled={!canRun}
            >
              Upload &amp; Run
            </Button>
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
            <Button variant="ghost" onClick={reset}>
              Run Another
            </Button>
          )}
          {env === "prod" && state === "idle" && (
            <span className="ui-badge ui-badge-red font-bold">PROD</span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4">
            <Card tone="red" padding="sm">
              <p className="text-sm font-medium theme-text-primary">Error</p>
              <p className="text-sm mt-1 theme-text-primary">{error}</p>
            </Card>
          </div>
        )}

        {/* Success */}
        {result && state === "complete" && (
          <div className="mt-4">
            <Card tone="green" padding="sm">
              <p className="text-sm font-semibold theme-text-primary">
                Successfully sent to Dunlop ({env.toUpperCase()})
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm theme-text-secondary">
                <div>Rows reported: <span className="font-mono font-semibold theme-text-primary">{result.rows}</span></div>
                <div>File: <span className="font-mono text-xs theme-text-primary">{result.outputFile}</span></div>
                <div>SFTP status: <SftpStatusBadge status={result.sftpStatus} /></div>
                <div>Timestamp: {formatTimestamp(result.timestamp)}</div>
              </div>
              {result.filterSummary && (
                <div className="mt-3 pt-3 border-t theme-border-secondary text-xs space-y-1 theme-text-tertiary">
                  <p>Total input rows: {result.filterSummary.totalInput}</p>
                  <p>After brand filter (FAL/DUN): {result.filterSummary.afterBrandFilter}</p>
                  <p>After location filter (W07/W08/W09/R10): {result.filterSummary.afterLocationFilter}</p>
                  <p>After exclusions: {result.filterSummary.afterExclusions}</p>
                  <p>Final output: {result.filterSummary.finalOutput}</p>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Batch results */}
        {batchResults.length > 0 && state === "complete" && (
          <div className="mt-4">
            <Card padding="sm">
              <p className="text-sm font-semibold mb-3 theme-text-primary">
                Backfill Results — {batchResults.filter(r => r.sftpStatus === "success").length} of {batchResults.length} months succeeded
              </p>
              <div className="space-y-1">
                {batchResults.map((r, i) => (
                  <div key={i} className={`flex items-center justify-between text-sm px-3 py-1.5 rounded-lg ${
                    r.sftpStatus === "success"
                      ? isDark ? "bg-emerald-500/10" : "bg-emerald-50"
                      : isDark ? "bg-red-500/10" : "bg-red-50"
                  }`}>
                    <span className="theme-text-secondary">{formatMonth(r.month)}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs theme-text-tertiary">{r.rows} rows</span>
                      <SftpStatusBadge status={r.sftpStatus} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </Card>

      {/* SFTP Info Card */}
      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-4 text-xs theme-text-tertiary">
          <div>
            <span className="font-semibold theme-text-secondary">Static IP (for SFTP whitelist):</span>
            <span className={`ml-2 font-mono font-bold ${isDark ? "text-blue-400" : "text-blue-600"}`}>54.163.176.67</span>
          </div>
          <div className="border-l pl-4 theme-border-secondary">
            <span className="font-semibold theme-text-secondary">SFTP Host:</span>
            <span className="ml-2 font-mono">{env === "prod" ? "landp.srnatire.com" : "landpdev.srnatire.com"}:22</span>
          </div>
          <div className="border-l pl-4 theme-border-secondary">
            <span className="font-semibold theme-text-secondary">Directory:</span>
            <span className="ml-2 font-mono">inbound</span>
          </div>
        </div>
      </Card>
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
      <div className="text-center py-16 theme-text-tertiary">
        <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="font-medium">No runs yet</p>
        <p className="text-sm mt-1">Upload a JMK file to get started.</p>
      </div>
    );
  }

  return (
    <div className="theme-card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={`border-b theme-border-secondary ${isDark ? "bg-slate-800/80" : "bg-gray-50"}`}>
              {["Month", "File Uploaded", "Rows", "SFTP", "Env", "Run By", "Timestamp"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider theme-text-tertiary">
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
                  className={`cursor-pointer transition-colors border-t theme-border-secondary ${isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-50"}`}
                >
                  <td className="px-4 py-3 font-medium theme-text-primary">{formatMonth(run.month)}</td>
                  <td className="px-4 py-3 font-mono text-xs theme-text-secondary">{run.fileName}</td>
                  <td className="px-4 py-3 font-mono theme-text-secondary">{run.rows}</td>
                  <td className="px-4 py-3"><SftpStatusBadge status={run.sftpStatus} /></td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      run.env === "prod"
                        ? isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-600"
                        : isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                    }`}>
                      {run.env.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 theme-text-secondary">{run.runBy}</td>
                  <td className="px-4 py-3 text-xs theme-text-tertiary">{formatTimestamp(run.timestamp)}</td>
                </tr>
                {expandedIdx === i && (
                  <tr key={`${i}-detail`}>
                    <td colSpan={7} className={`px-6 py-4 ${isDark ? "bg-slate-800/30" : "bg-gray-50"}`}>
                      <div className="text-xs space-y-2 theme-text-secondary">
                        <p>
                          <span className="font-semibold theme-text-primary">Output file:</span>{" "}
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
                            <span className="font-semibold theme-text-primary">Filter pipeline:</span>
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
                          <div className="mt-3 pt-3 border-t theme-border-secondary flex items-center gap-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleRerun(run, i); }}
                              disabled={rerunning === i}
                            >
                              {rerunning === i ? "Re-running..." : "Re-run this month"}
                            </Button>
                          </div>
                        )}
                        {canDelete && (
                          <div className={`${canRerun ? "mt-2" : "mt-3 pt-3 border-t theme-border-secondary"}`}>
                            {confirmDelete === i ? (
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-semibold theme-text-primary">
                                  This will delete the run log from S3. The file already sent to Dunlop SFTP cannot be recalled. Delete?
                                </span>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={(e) => { e.stopPropagation(); handleDelete(run, i); }}
                                  disabled={deleting}
                                >
                                  {deleting ? "Deleting..." : "Yes, Delete"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDelete(i); }}
                                className="text-xs font-medium text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
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
    <div className="space-y-4">
      {/* Progress */}
      <Card>
        <SectionHeader
          title="Submission Status"
          actions={
            <span className={`text-sm font-mono font-bold ${isDark ? "text-blue-400" : "text-blue-600"}`}>
              {completedCount} / {allMonths.length}
            </span>
          }
        />
        <div className={`w-full h-3 rounded-full overflow-hidden ${isDark ? "bg-slate-700" : "bg-gray-200"}`}>
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
            style={{ width: `${(completedCount / allMonths.length) * 100}%` }}
          />
        </div>
        <p className="text-xs mt-2 theme-text-tertiary">
          Jan 2024 — Present
        </p>
      </Card>

      {/* Month list */}
      <div className="theme-card overflow-hidden p-0">
        {allMonths.map((m, i) => {
          const done = completedMonths.has(m);
          const run = history.find(r => r.month === m && r.sftpStatus === "success");
          return (
            <div
              key={m}
              className={`flex items-center justify-between px-5 py-3 ${
                i > 0 ? "border-t theme-border-secondary" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                {done ? (
                  <svg className={`w-5 h-5 flex-shrink-0 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 ${isDark ? "border-slate-600" : "border-gray-300"}`} />
                )}
                <span className="text-sm font-medium theme-text-primary">{formatMonth(m)}</span>
              </div>
              <div className="flex items-center gap-3">
                {done && run && (
                  <span className="text-xs font-mono theme-text-tertiary">
                    {run.rows} rows — {formatTimestamp(run.timestamp)}
                  </span>
                )}
                {done ? (
                  <span className="ui-badge ui-badge-green">Submitted</span>
                ) : (
                  <span className="text-xs font-medium theme-text-tertiary">Pending</span>
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

const EMPTY_CREDS: SftpCreds = { host: "", port: 22, username: "", password: "", directory: "inbound" };

interface SftpTestResult {
  env: string;
  host: string;
  port: number;
  username: string;
  directory: string;
  ok: boolean;
  stage: string | null;
  error: string | null;
  elapsedMs: number | null;
  fileCount: number | null;
}

function SettingsTab({ isDark }: { isDark: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [devCreds, setDevCreds] = useState<SftpCreds>(EMPTY_CREDS);
  const [prodCreds, setProdCreds] = useState<SftpCreds>(EMPTY_CREDS);
  const [showPasswords, setShowPasswords] = useState(false);

  // Snapshot of what's actually stored in Secrets Manager. The connection
  // test runs against the *saved* credentials, so we compare against this
  // to stop anyone testing while the form has unsaved edits — that would
  // silently exercise the old password and report a misleading result.
  const [savedSnapshot, setSavedSnapshot] = useState<{ dev: SftpCreds; prod: SftpCreds }>({ dev: EMPTY_CREDS, prod: EMPTY_CREDS });

  const [testing, setTesting] = useState<"dev" | "prod" | null>(null);
  const [testResults, setTestResults] = useState<Record<string, SftpTestResult | { error: string }>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/settings`);
        if (res.ok) {
          const data = await res.json();
          if (data.sftp_dev) setDevCreds(data.sftp_dev);
          if (data.sftp_prod) setProdCreds(data.sftp_prod);
          setSavedSnapshot({ dev: data.sftp_dev ?? EMPTY_CREDS, prod: data.sftp_prod ?? EMPTY_CREDS });
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
      // A successful save makes the form the new baseline, which re-enables
      // the test buttons.
      setSavedSnapshot({ dev: devCreds, prod: prodCreds });
      setTestResults({});
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save credentials");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (env: "dev" | "prod") => {
    setTesting(env);
    setTestResults((prev) => ({ ...prev, [env]: undefined as never }));
    try {
      const res = await fetch(`${API_BASE}/settings/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env }),
      });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [env]: res.ok ? data : { error: data?.error || `Test failed (HTTP ${res.status})` },
      }));
    } catch {
      setTestResults((prev) => ({ ...prev, [env]: { error: "Could not reach the test endpoint" } }));
    } finally {
      setTesting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="SFTP Credentials"
        actions={
          <button
            onClick={() => setShowPasswords(!showPasswords)}
            className="text-xs font-medium theme-text-tertiary hover:theme-text-secondary"
          >
            {showPasswords ? "Hide passwords" : "Show passwords"}
          </button>
        }
      />

      {([
        { label: "Dev Environment", env: "dev" as const, creds: devCreds, setCreds: setDevCreds },
        { label: "Prod Environment", env: "prod" as const, creds: prodCreds, setCreds: setProdCreds },
      ]).map(({ label, env, creds, setCreds }) => {
        const dirty = JSON.stringify(creds) !== JSON.stringify(savedSnapshot[env]);
        const result = testResults[env];
        return (
        <Card key={label}>
          <div className="flex items-center justify-between mb-3">
            <div className="ui-section-label">{label}</div>
            <div className="flex items-center gap-2">
              {dirty && (
                <span className="text-[11px] theme-text-tertiary">Save to test</span>
              )}
              <button
                onClick={() => handleTest(env)}
                disabled={testing !== null || dirty}
                title={dirty
                  ? "You have unsaved changes. The test uses the saved credentials, so save first."
                  : "Connect, authenticate, and list the drop directory. No file is sent."}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 bg-blue-500/20 text-blue-700 dark:text-blue-400 hover:bg-blue-500/30 transition-colors"
              >
                {testing === env ? "Testing…" : "Test connection"}
              </button>
            </div>
          </div>

          {result && (
            <div
              className={`mb-3 rounded-lg px-3 py-2 text-xs ${
                "ok" in result && result.ok
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-red-500/10 text-red-700 dark:text-red-400"
              }`}
            >
              {"ok" in result && result.ok ? (
                <>
                  <span className="font-semibold">Connected.</span>{" "}
                  Authenticated as <span className="font-mono">{result.username}</span> and read{" "}
                  <span className="font-mono">{result.directory}</span>
                  {result.fileCount !== null ? ` (${result.fileCount} file${result.fileCount === 1 ? "" : "s"})` : ""}
                  {result.elapsedMs !== null ? ` in ${result.elapsedMs}ms` : ""}. No file was sent.
                </>
              ) : (
                <>
                  <span className="font-semibold">
                    Failed{"stage" in result && result.stage ? ` at ${result.stage}` : ""}.
                  </span>{" "}
                  {"error" in result ? result.error : "Unknown error"}
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1 theme-text-tertiary">Host</label>
              <input className="theme-input w-full px-3 py-2 text-sm font-mono" value={creds.host} onChange={(e) => setCreds({ ...creds, host: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 theme-text-tertiary">Port</label>
              <input className="theme-input w-full px-3 py-2 text-sm font-mono" type="number" value={creds.port} onChange={(e) => setCreds({ ...creds, port: parseInt(e.target.value) || 22 })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 theme-text-tertiary">Username</label>
              <input className="theme-input w-full px-3 py-2 text-sm font-mono" value={creds.username} onChange={(e) => setCreds({ ...creds, username: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 theme-text-tertiary">Password</label>
              <input className="theme-input w-full px-3 py-2 text-sm font-mono" type={showPasswords ? "text" : "password"} value={creds.password} onChange={(e) => setCreds({ ...creds, password: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 theme-text-tertiary">Directory</label>
              <input className="theme-input w-full px-3 py-2 text-sm font-mono" value={creds.directory} onChange={(e) => setCreds({ ...creds, directory: e.target.value })} />
            </div>
          </div>
        </Card>
        );
      })}

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save Credentials"}
        </Button>
        {saved && (
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Saved</span>
        )}
        {error && (
          <span className="text-sm font-medium text-red-600 dark:text-red-400">{error}</span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function SftpStatusBadge({ status }: { status: "success" | "failed" | "partial" }) {
  const colorMap = {
    success: "ui-badge-green",
    failed: "ui-badge-red",
    partial: "ui-badge-amber",
  };
  return (
    <span className={`ui-badge ${colorMap[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
