"use client";

import { useState, useCallback, useRef } from "react";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import { useAuth } from "@/app/auth-context";
import { usePermissions } from "@/lib/usePermissions";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import { computeInventoryReportDate, INVENTORY_SCHEDULE_NOTE } from "@/lib/inventoryReportDate";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";

type UploadState = "idle" | "validating" | "uploading" | "processing" | "complete" | "error";

const REPORT_TYPES = [
  { code: "OEA07V", label: "OEA07V — Daily Sales (CSV)", description: "Daily item-level sales/returns — fuels WTD Commission and Dunlop", accept: ".csv,.xlsx" },
  { code: "oeival", label: "OEAVAL 77 — Inventory Snapshot", description: "Inventory quantities, costs, pricing by warehouse", accept: ".csv,.xlsx" },
];

function getDefaultMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(yyyymm: string): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const y = yyyymm.slice(0, 4);
  const m = parseInt(yyyymm.slice(4, 6), 10);
  return `${names[m - 1]} ${y}`;
}

export default function ReportUploadPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();
  const permissions = usePermissions();

  const canAccess = permissions.menu.reportUpload;

  const uploadHistory = useQuery(api.jmkUploads.listUploadHistory, { limit: 5 });
  const fullHistory = useQuery(api.jmkUploads.listUploadHistory, { limit: 500 });
  const [showFullHistory, setShowFullHistory] = useState(false);
  const recordUpload = useMutation(api.jmkUploads.recordUpload);

  const dataUploads = useQuery(api.reportData.listUploads, {});
  const ftpConnections = useQuery(api.ftpConnections.list);
  const createFtp = useMutation(api.ftpConnections.create);
  const removeFtp = useMutation(api.ftpConnections.remove);

  const [activeTab, setActiveTab] = useState<"upload" | "ftp">("upload");
  const [ftpForm, setFtpForm] = useState({ name: "", host: "", port: "21", username: "", password: "", remotePath: "/", filePattern: "tires-*.csv", sourceType: "tires", frequency: "hourly" });
  const [ftpTesting, setFtpTesting] = useState(false);
  const [ftpTestResult, setFtpTestResult] = useState<{ connected: boolean; message: string; files?: string[] } | null>(null);
  const [savingFtp, setSavingFtp] = useState(false);
  const [editingFtp, setEditingFtp] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ remotePath: "", filePattern: "", name: "", host: "", port: "21", username: "", sourceType: "", frequency: "" });
  const updateFtp = useMutation(api.ftpConnections.update);

  const [reportType, setReportType] = useState("OEA07V");
  const month = getDefaultMonth(); // Auto-detected from current date
  const [files, setFiles] = useState<File[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0); // For multi-file: current index
  const [validation, setValidation] = useState<{ valid: boolean; errors?: string[]; detectedColumns?: number; rowCount?: number; dateRangeStart?: string; dateRangeEnd?: string; dataMonth?: string; isMonthlyData?: boolean } | null>(null);
  const [processingResults, setProcessingResults] = useState<{ trigger: string; status: string; message?: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith(".csv") || f.name.endsWith(".xlsx")
    );
    if (dropped.length > 0) {
      setFiles(dropped);
      setValidation(null);
      setUploadState("idle");
      setErrorMsg("");
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) {
      setFiles(selected);
      setValidation(null);
      setUploadState("idle");
      setErrorMsg("");
    }
  }, []);

  // Convenience alias for single-file operations
  const file = files[0] || null;

  const handleValidate = useCallback(async () => {
    if (!file) return;
    setUploadState("validating");
    setErrorMsg("");

    try {
      // Read enough of the file for validation + date scanning
      const text = await file.text();
      const lines = text.split("\n");
      const headerRow = lines[0]?.split(",").map((h) => h.trim());
      const rowCount = lines.length - 1;

      const res = await fetch("/api/reports/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportType, headerRow, rowCount }),
      });
      const data = await res.json();

      // Scan for date range in OEA07V files (Activity Date format MM/DD/YY)
      let dateRangeStart: string | undefined;
      let dateRangeEnd: string | undefined;
      let dataMonth: string | undefined;
      let isMonthlyData = false;
      let oeaHasNoDate = false;
      if (reportType === "OEA07V" && data.valid) {
        const dates: Date[] = [];
        // Scan each line for MM/DD/YY date patterns (handles quoted CSV fields)
        const datePattern = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;
        for (let i = 1; i < Math.min(lines.length, 50000); i++) {
          const line = lines[i];
          if (!line) continue;
          let m;
          while ((m = datePattern.exec(line)) !== null) {
            const mo = parseInt(m[1]);
            const day = parseInt(m[2]);
            let y = parseInt(m[3]);
            if (mo < 1 || mo > 12 || day < 1 || day > 31) continue;
            if (y < 100) y += 2000;
            const d = new Date(y, mo - 1, day);
            if (!isNaN(d.getTime()) && d.getFullYear() >= 2020 && d.getFullYear() <= 2030) {
              dates.push(d);
              break; // one date per row is enough
            }
          }
          datePattern.lastIndex = 0;
        }
        if (dates.length > 0) {
          dates.sort((a, b) => a.getTime() - b.getTime());
          const first = dates[0];
          const last = dates[dates.length - 1];
          dateRangeStart = first.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          dateRangeEnd = last.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          // Bucket the file under the month most rows fall in, so a monthly upload on
          // the 1st of the next month doesn't land in the wrong S3 prefix.
          const monthCounts = new Map<string, number>();
          for (const d of dates) {
            const key = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
            monthCounts.set(key, (monthCounts.get(key) || 0) + 1);
          }
          dataMonth = [...monthCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
          // "Monthly" if the data sits in one calendar month and spans most of it
          // (first date in the month's first 5 days, last date in the last 5 days).
          // Used to auto-trigger the Dunlop SFTP run after upload.
          const sameMonth = first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth();
          const lastDayOfMonth = new Date(last.getFullYear(), last.getMonth() + 1, 0).getDate();
          isMonthlyData = sameMonth && first.getDate() <= 5 && last.getDate() >= lastDayOfMonth - 4;
        } else {
          oeaHasNoDate = true; // valid headers but no parseable Activity Date → reject
        }
      }

      const effectiveValid = data.valid && !oeaHasNoDate;
      setValidation({ ...data, valid: effectiveValid, dateRangeStart, dateRangeEnd, dataMonth, isMonthlyData });
      setUploadState(effectiveValid ? "idle" : "error");
      if (!effectiveValid) setErrorMsg(oeaHasNoDate
        ? "No rows with a parseable Activity Date — this doesn't look like an OEA07V export."
        : "Validation failed — check column errors below");
    } catch (err) {
      setUploadState("error");
      setErrorMsg(err instanceof Error ? err.message : "Validation failed");
    }
  }, [file, reportType]);

  const isDataSource = ["oeival", "oea07v-sales", "tires"].includes(reportType);
  const currentType = REPORT_TYPES.find((t) => t.code === reportType);

  const handleUpload = useCallback(async () => {
    if (files.length === 0 || !user) return;

    setUploadState("uploading");
    setStatusMsg("Uploading...");
    setErrorMsg("");
    setProcessingResults([]);

    const allResults: { trigger: string; status: string; message?: string }[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const currentFile = files[i];
        const fileLabel = files.length > 1 ? `(${i + 1}/${files.length}) ` : "";
        setUploadProgress(i);

        // Prefer the month most rows fall in (from validation) over today's calendar
        // month — prevents an end-of-month upload from landing in the wrong S3 prefix.
        const effectiveMonth = validation?.dataMonth || month;

        if (isDataSource) {
          const sourceType = reportType === "oea07v-sales" ? "oea07v-sales" : reportType;
          setStatusMsg(`${fileLabel}Getting upload URL for ${currentFile.name}...`);
          const urlRes = await fetch("/api/reports/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportType: sourceType, month: effectiveMonth, filename: currentFile.name }),
          });
          const { url, key } = await urlRes.json();
          if (!url) throw new Error(`Failed to get upload URL for ${currentFile.name}`);

          setStatusMsg(`${fileLabel}Uploading ${currentFile.name} to S3...`);
          const contentType = currentFile.name.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv";
          const uploadRes = await fetch(url, { method: "PUT", body: currentFile, headers: { "Content-Type": contentType } });
          if (!uploadRes.ok) throw new Error(`S3 upload failed for ${currentFile.name}`);

          await recordUpload({
            reportType: sourceType,
            fileName: currentFile.name,
            fileSize: currentFile.size,
            s3Key: key,
            reportingMonth: effectiveMonth,
            reportDate: sourceType === "oeival" ? computeInventoryReportDate() : undefined,
            validationStatus: "valid",
            uploadedBy: user._id,
            uploadedByName: user.name || "Unknown",
          });

          allResults.push({
            trigger: "s3-upload",
            status: "success",
            message: `Uploaded ${currentFile.name} to S3 — available in reports immediately`,
          });
        } else {
          setStatusMsg(`${fileLabel}Getting upload URL for ${currentFile.name}...`);
          const urlRes = await fetch("/api/reports/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportType, month: effectiveMonth, filename: currentFile.name }),
          });
          const { url, key } = await urlRes.json();
          if (!url) throw new Error(`Failed to get upload URL for ${currentFile.name}`);

          setStatusMsg(`${fileLabel}Uploading ${currentFile.name} to S3...`);
          const contentType = currentFile.name.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv";
          const uploadRes = await fetch(url, { method: "PUT", body: currentFile, headers: { "Content-Type": contentType } });
          if (!uploadRes.ok) throw new Error(`S3 upload failed for ${currentFile.name}`);

          setStatusMsg(`${fileLabel}Recording ${currentFile.name}...`);
          const uploadId = await recordUpload({
            reportType,
            fileName: currentFile.name,
            fileSize: currentFile.size,
            s3Key: key,
            reportingMonth: effectiveMonth,
            rowCount: validation?.rowCount,
            dateRangeStart: validation?.dateRangeStart,
            dateRangeEnd: validation?.dateRangeEnd,
            validationStatus: validation?.valid ? "valid" : "warning",
            uploadedBy: user._id,
            uploadedByName: user.name || "Unknown",
          });

          // Only trigger processing on the last file to avoid duplicate runs
          if (i === files.length - 1) {
            setUploadState("processing");
            setStatusMsg(`${fileLabel}Processing...`);

            const processRes = await fetch("/api/reports/process", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ uploadId, reportType, s3Key: key, month: effectiveMonth }),
            });
            const processData = await processRes.json();
            allResults.push(...(processData.results || []));

            // Auto-trigger Dunlop SFTP run when an OEA07V file covers a full month.
            // Saves a manual trip to /dunlop-reporting and prevents the upload from
            // being missed because it landed after the monthly cron fired.
            if (reportType === "OEA07V" && validation?.isMonthlyData) {
              setStatusMsg(`${fileLabel}Sending to Dunlop SFTP...`);
              try {
                const dunlopRes = await fetch("/api/dunlop/run", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    s3_key: key,
                    month: effectiveMonth,
                    env: "prod",
                    runBy: `${user.name || "Unknown"} (auto on upload)`,
                  }),
                });
                const dunlopData = await dunlopRes.json();
                if (dunlopRes.ok && dunlopData.sftpStatus === "success") {
                  allResults.push({
                    trigger: "dunlop-sftp",
                    status: "success",
                    message: `Sent ${dunlopData.rows} rows to Dunlop (${dunlopData.outputFile})`,
                  });
                } else {
                  allResults.push({
                    trigger: "dunlop-sftp",
                    status: "failed",
                    message: dunlopData.error || dunlopData.sftpStatus || "Unknown Dunlop error",
                  });
                }
              } catch (dunlopErr) {
                allResults.push({
                  trigger: "dunlop-sftp",
                  status: "failed",
                  message: dunlopErr instanceof Error ? dunlopErr.message : "Dunlop call failed",
                });
              }
            }
          } else {
            allResults.push({
              trigger: "s3-upload",
              status: "success",
              message: `Uploaded ${currentFile.name} to S3`,
            });
          }
        }

        setProcessingResults([...allResults]);
      }

      setUploadState("complete");
      setStatusMsg(files.length > 1 ? `All ${files.length} files uploaded successfully!` : "Upload and processing complete!");
    } catch (err) {
      setUploadState("error");
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
    }
  }, [files, user, reportType, month, validation, recordUpload, isDataSource]);

  const handleTestFtp = useCallback(async () => {
    setFtpTesting(true);
    setFtpTestResult(null);
    try {
      const res = await fetch("/api/reports/ftp-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: ftpForm.host, port: parseInt(ftpForm.port) || 21, username: ftpForm.username, password: ftpForm.password, remotePath: ftpForm.remotePath }),
      });
      setFtpTestResult(await res.json());
    } catch (err) {
      setFtpTestResult({ connected: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setFtpTesting(false);
    }
  }, [ftpForm]);

  const handleSaveFtp = useCallback(async () => {
    if (!user || !ftpForm.name || !ftpForm.host || !ftpForm.username || !ftpForm.password) return;
    setSavingFtp(true);
    try {
      // Encrypt password before storing
      const encRes = await fetch("/api/reports/encrypt-value", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: ftpForm.password }),
      });
      const { encrypted } = await encRes.json();

      await createFtp({
        name: ftpForm.name,
        host: ftpForm.host,
        port: parseInt(ftpForm.port) || 21,
        username: ftpForm.username,
        password: encrypted,
        remotePath: ftpForm.remotePath,
        filePattern: ftpForm.filePattern,
        sourceType: ftpForm.sourceType,
        frequency: ftpForm.frequency,
        createdBy: user._id,
      });
      setFtpForm({ name: "", host: "", port: "21", username: "", password: "", remotePath: "/", filePattern: "tires-*.csv", sourceType: "tires", frequency: "hourly" });
      setFtpTestResult(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingFtp(false);
    }
  }, [ftpForm, user, createFtp]);

  if (!canAccess) {
    return (
      <Protected>
        <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
          <Sidebar />
          <main className="flex-1 flex items-center justify-center">
            <MobileHeader />
            <div className="text-center p-8 theme-text-secondary">
              <p className="text-lg font-medium">Access Denied</p>
            </div>
          </main>
        </div>
      </Protected>
    );
  }

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
                <Link
                  href="/reports"
                  className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5 flex-shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </Link>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isDark ? "bg-gradient-to-br from-emerald-500/20 to-teal-600/20" : "bg-gradient-to-br from-emerald-100 to-teal-100"}`}>
                  <svg className={`w-5 h-5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold theme-text-primary">Upload JMK Reports</h1>
                  <p className="text-xs mt-0.5 theme-text-tertiary">Upload and process JMK report files</p>
                </div>
              </div>
              <Link
                href="/reports/upload-status"
                className="theme-btn-secondary inline-flex items-center justify-center gap-1.5 rounded-[9px] font-semibold transition-colors px-3.5 py-2 text-[13.5px]"
              >
                Upload Calendar
              </Link>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mt-4">
              {(["upload", "ftp"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab as any)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
                    activeTab === tab
                      ? isDark
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                        : "bg-emerald-100 text-emerald-700 border border-emerald-300"
                      : "theme-text-tertiary hover:theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  {tab === "upload" ? "Manual Upload" : `FTP Connections (${ftpConnections?.length ?? 0})`}
                </button>
              ))}
            </div>
          </header>

          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
            {/* FTP Tab */}
            {activeTab === "ftp" && (
              <div className="space-y-6">
                {/* New FTP Connection Form */}
                <Card>
                  <SectionHeader title="New FTP Connection" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium mb-1 theme-text-tertiary">Connection Name</label>
                      <input
                        type="text"
                        value={ftpForm.name}
                        onChange={(e) => setFtpForm({ ...ftpForm, name: e.target.value })}
                        placeholder="e.g. JMK Tires Catalog"
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1 theme-text-tertiary">Source Type</label>
                      <select
                        value={ftpForm.sourceType}
                        onChange={(e) => setFtpForm({ ...ftpForm, sourceType: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                      >
                        <option value="tires">Tires Catalog</option>
                        <option value="oeival">Inventory (OEAVAL 77)</option>
                        <option value="oea07v">Sales History (OEA07V)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1 theme-text-tertiary">FTP Host</label>
                      <input
                        type="text"
                        value={ftpForm.host}
                        onChange={(e) => setFtpForm({ ...ftpForm, host: e.target.value })}
                        placeholder="ftp.example.com"
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1 theme-text-tertiary">Port</label>
                      <input
                        type="number"
                        value={ftpForm.port}
                        onChange={(e) => setFtpForm({ ...ftpForm, port: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1 theme-text-tertiary">Username</label>
                      <input
                        type="text"
                        value={ftpForm.username}
                        onChange={(e) => setFtpForm({ ...ftpForm, username: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1 theme-text-tertiary">Password</label>
                      <input
                        type="password"
                        value={ftpForm.password}
                        onChange={(e) => setFtpForm({ ...ftpForm, password: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1 theme-text-tertiary">Remote Path</label>
                      <input
                        type="text"
                        value={ftpForm.remotePath}
                        onChange={(e) => setFtpForm({ ...ftpForm, remotePath: e.target.value })}
                        placeholder="/"
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1 theme-text-tertiary">File Pattern</label>
                      <input
                        type="text"
                        value={ftpForm.filePattern}
                        onChange={(e) => setFtpForm({ ...ftpForm, filePattern: e.target.value })}
                        placeholder="tires-*.csv"
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1 theme-text-tertiary">Sync Frequency</label>
                      <select
                        value={ftpForm.frequency}
                        onChange={(e) => setFtpForm({ ...ftpForm, frequency: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                      >
                        <option value="hourly">Hourly</option>
                        <option value="daily">Daily</option>
                        <option value="manual">Manual Only</option>
                      </select>
                    </div>
                  </div>

                  {/* Test result */}
                  {ftpTestResult && (
                    <div className="mt-4">
                      <Card tone={ftpTestResult.connected ? "green" : "red"} padding="sm">
                        <p className="text-sm font-medium theme-text-primary">{ftpTestResult.connected ? "Connected!" : "Connection Failed"}</p>
                        <p className="text-xs mt-1 theme-text-primary">{ftpTestResult.message}</p>
                        {ftpTestResult.files && ftpTestResult.files.length > 0 && (
                          <p className="text-xs mt-1 theme-text-secondary">Files: {ftpTestResult.files.join(", ")}</p>
                        )}
                      </Card>
                    </div>
                  )}

                  <div className="flex gap-3 mt-5">
                    <Button
                      variant="secondary"
                      onClick={handleTestFtp}
                      disabled={ftpTesting || !ftpForm.host || !ftpForm.username}
                    >
                      {ftpTesting ? "Testing..." : "Test Connection"}
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleSaveFtp}
                      disabled={savingFtp || !ftpForm.name || !ftpForm.host || !ftpForm.username || !ftpForm.password}
                    >
                      {savingFtp ? "Saving..." : "Save Connection"}
                    </Button>
                  </div>
                </Card>

                {/* Existing FTP Connections */}
                <div className="theme-card overflow-hidden p-0">
                  <div className="px-4 sm:px-6 py-3 sm:py-4 border-b theme-border-secondary">
                    <h2 className="text-sm font-semibold theme-text-primary">Active Connections</h2>
                  </div>
                  {!ftpConnections || ftpConnections.length === 0 ? (
                    <p className="p-6 text-sm text-center theme-text-tertiary">No FTP connections configured</p>
                  ) : (
                    <div className="divide-y theme-border-secondary">
                      {ftpConnections.map((conn) => (
                        <div key={conn._id}>
                          <div className="px-6 py-4 flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${conn.isActive ? conn.lastSyncStatus === "failed" ? "bg-red-500" : "bg-emerald-500" : "bg-slate-500"}`} />
                                <span className="font-medium text-sm theme-text-primary">{conn.name}</span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono ui-badge ui-badge-gray">{conn.sourceType}</span>
                                <span className="ui-badge ui-badge-blue text-[10px]">{conn.frequency}</span>
                              </div>
                              <div className="text-xs mt-1 theme-text-tertiary">
                                {conn.host} — {conn.remotePath} — {conn.filePattern}
                                {conn.lastSyncAt && <span className="ml-2">Last sync: {new Date(conn.lastSyncAt).toLocaleString()}</span>}
                                {conn.lastSyncRowCount && <span className="ml-1">({conn.lastSyncRowCount} rows)</span>}
                                {conn.lastSyncError && <span className="ml-2 text-red-500 dark:text-red-400">{conn.lastSyncError}</span>}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  const res = await fetch("/api/reports/ftp-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId: conn._id }) });
                                  const data = await res.json();
                                  if (data.error) { alert(`Error: ${data.error}`); return; }
                                  const fileList = (data.files || []).map((f: any) => `${f.type === "dir" ? "📁" : "📄"} ${f.name} (${f.type === "dir" ? "dir" : `${(f.size/1024).toFixed(0)}KB`}) ${f.modified ? new Date(f.modified).toLocaleString() : ""}`).join("\n");
                                  alert(`📂 ${data.path}\n${data.total} items:\n\n${fileList}`);
                                }}
                              >
                                Browse
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingFtp(editingFtp === conn._id ? null : conn._id);
                                  setEditForm({ name: conn.name, host: conn.host, port: String(conn.port), username: conn.username || "", remotePath: conn.remotePath, filePattern: conn.filePattern, sourceType: conn.sourceType, frequency: conn.frequency });
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  const res = await fetch("/api/reports/ftp-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId: conn._id }) });
                                  const data = await res.json();
                                  alert(JSON.stringify(data.results || data, null, 2));
                                }}
                              >
                                Sync
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => { if (confirm("Delete this connection?")) removeFtp({ id: conn._id }); }}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                          {/* Inline Edit Form */}
                          {editingFtp === conn._id && (
                            <div className={`px-6 py-4 border-t theme-border-secondary ${isDark ? "bg-slate-900/50" : "bg-gray-50"}`}>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div>
                                  <label className="block text-[10px] mb-0.5 theme-text-tertiary">Name</label>
                                  <input
                                    value={editForm.name}
                                    onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                                    className="theme-input w-full px-2 py-1.5 text-xs"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] mb-0.5 theme-text-tertiary">Host</label>
                                  <input
                                    value={editForm.host}
                                    onChange={(e) => setEditForm({...editForm, host: e.target.value})}
                                    className="theme-input w-full px-2 py-1.5 text-xs"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] mb-0.5 theme-text-tertiary">Remote Path</label>
                                  <input
                                    value={editForm.remotePath}
                                    onChange={(e) => setEditForm({...editForm, remotePath: e.target.value})}
                                    className="theme-input w-full px-2 py-1.5 text-xs"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] mb-0.5 theme-text-tertiary">File Pattern</label>
                                  <input
                                    value={editForm.filePattern}
                                    onChange={(e) => setEditForm({...editForm, filePattern: e.target.value})}
                                    className="theme-input w-full px-2 py-1.5 text-xs"
                                  />
                                </div>
                              </div>
                              <div className="flex gap-2 mt-3">
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={async () => {
                                    await updateFtp({ id: conn._id as any, name: editForm.name, host: editForm.host, port: parseInt(editForm.port) || 21, remotePath: editForm.remotePath, filePattern: editForm.filePattern, frequency: editForm.frequency });
                                    setEditingFtp(null);
                                  }}
                                >
                                  Save
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingFtp(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Upload Tab */}
            {activeTab === "upload" && (
              <>
                {/* Upload Form */}
                <Card>
                  <SectionHeader title="Upload Report File" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <label className="block text-xs font-medium theme-text-tertiary">Report Type</label>
                        {reportType === "oeival" && (
                          <span
                            title={INVENTORY_SCHEDULE_NOTE}
                            aria-label="Inventory date schedule"
                            className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold cursor-help ${isDark ? "bg-slate-700 text-cyan-400" : "bg-gray-200 text-blue-600"}`}
                          >
                            i
                          </span>
                        )}
                      </div>
                      <select
                        value={reportType}
                        onChange={(e) => { setReportType(e.target.value); setValidation(null); }}
                        className="theme-input w-full px-3 py-2 text-sm"
                      >
                        {REPORT_TYPES.map((t) => (
                          <option key={t.code} value={t.code}>{t.label}</option>
                        ))}
                      </select>
                      {reportType === "oeival" && (
                        <p className="text-[10px] mt-1 theme-text-tertiary">
                          Snapshot date auto-stamped — hover ⓘ for schedule
                        </p>
                      )}
                    </div>
                    {!isDataSource && (
                      <div>
                        <label className="block text-xs font-medium mb-1 theme-text-tertiary">Filing Period</label>
                        <div className="theme-input px-3 py-2 text-sm font-medium theme-text-primary">
                          {formatMonth(month)} — dates auto-detected from file
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Drop zone */}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                    className={`border-2 border-dashed rounded-xl p-4 sm:p-8 text-center transition-colors ${
                      dragOver
                        ? isDark ? "border-cyan-500 bg-cyan-500/10" : "border-blue-400 bg-blue-50"
                        : files.length > 0
                          ? isDark ? "border-emerald-500/50 bg-emerald-500/5" : "border-emerald-300 bg-emerald-50"
                          : isDark ? "border-slate-600 hover:border-slate-500" : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    <input ref={fileInputRef} type="file" accept=".csv,.xlsx" multiple onChange={handleFileSelect} className="hidden" />
                    {files.length > 0 ? (
                      <div>
                        <svg className={`w-8 h-8 mx-auto mb-2 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {files.length === 1 ? (
                          <>
                            <p className="text-sm font-medium theme-text-primary">{files[0].name}</p>
                            <p className="text-xs mt-1 theme-text-tertiary">{(files[0].size / 1024).toFixed(0)} KB</p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-medium theme-text-primary">{files.length} files selected</p>
                            <div className="text-xs mt-1 space-y-0.5 theme-text-tertiary">
                              {files.map((f, i) => (
                                <p key={i}>{f.name} — {(f.size / 1024).toFixed(0)} KB</p>
                              ))}
                            </div>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => { setFiles([]); setValidation(null); setUploadState("idle"); }}
                          className="mt-2 text-xs px-3 py-1 rounded-lg theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          Change files
                        </button>
                      </div>
                    ) : (
                      <div>
                        <svg className="w-8 h-8 mx-auto mb-2 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <p className="text-sm mb-3 theme-text-secondary">Drag and drop files here, or</p>
                        <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                          Browse Files
                        </Button>
                        <p className="text-[10px] mt-2 theme-text-tertiary">.csv or .xlsx — hold Cmd to select multiple</p>
                      </div>
                    )}
                  </div>

                  {/* Validation result */}
                  {validation && (
                    <div className="mt-4">
                      <Card tone={validation.valid ? "green" : "red"} padding="sm">
                        {validation.valid ? (
                          <p className="text-sm theme-text-primary">
                            Valid {reportType} format — {validation.detectedColumns} columns, ~{validation.rowCount} rows
                            {validation.dateRangeStart && validation.dateRangeEnd && (
                              <span className="ml-2 font-medium text-blue-600 dark:text-cyan-400">
                                — Dates: {validation.dateRangeStart} to {validation.dateRangeEnd}
                              </span>
                            )}
                          </p>
                        ) : (
                          <div>
                            <p className="text-sm font-medium mb-1 theme-text-primary">Validation errors:</p>
                            <ul className="list-disc list-inside text-xs space-y-0.5 theme-text-primary">
                              {validation.errors?.map((e, i) => <li key={i}>{e}</li>)}
                            </ul>
                          </div>
                        )}
                      </Card>
                    </div>
                  )}

                  {/* Processing results */}
                  {processingResults.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {processingResults.map((r, i) => (
                        <Card key={i} tone={r.status === "success" ? "green" : "red"} padding="sm">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${r.status === "success" ? "bg-emerald-500" : "bg-red-500"}`} />
                            <span className="text-sm font-medium theme-text-primary">{r.trigger}</span>
                            {r.message && <span className="text-xs theme-text-secondary">— {r.message}</span>}
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}

                  {/* Error */}
                  {errorMsg && uploadState === "error" && (
                    <div className="mt-4">
                      <Card tone="red" padding="sm">
                        <p className="text-sm theme-text-primary">{errorMsg}</p>
                      </Card>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3 mt-5">
                    {files.length === 1 && !validation && uploadState !== "complete" && (
                      <Button
                        variant="primary"
                        onClick={handleValidate}
                        disabled={uploadState === "validating"}
                      >
                        {uploadState === "validating" ? "Validating..." : "Validate & Preview"}
                      </Button>
                    )}
                    {((files.length === 1 && validation?.valid) || files.length > 1) && uploadState !== "complete" && (
                      <Button
                        variant="primary"
                        onClick={handleUpload}
                        disabled={uploadState === "uploading" || uploadState === "processing"}
                      >
                        {uploadState === "uploading"
                          ? `Uploading${files.length > 1 ? ` (${uploadProgress + 1}/${files.length})` : ""}...`
                          : uploadState === "processing"
                            ? "Processing..."
                            : files.length > 1
                              ? `Upload ${files.length} Files`
                              : "Upload & Process"}
                      </Button>
                    )}
                    {uploadState === "complete" && (
                      <Button
                        variant="secondary"
                        onClick={() => { setFiles([]); setValidation(null); setUploadState("idle"); setStatusMsg(""); setProcessingResults([]); setErrorMsg(""); }}
                      >
                        Upload Another
                      </Button>
                    )}
                  </div>

                  {/* Status message */}
                  {statusMsg && uploadState !== "idle" && uploadState !== "error" && (
                    <p className="mt-3 text-xs theme-text-tertiary">{statusMsg}</p>
                  )}
                </Card>

                {/* Upload History */}
                <div className="theme-card overflow-hidden p-0">
                  <div className="px-4 sm:px-6 py-3 sm:py-4 border-b theme-border-secondary flex items-center justify-between">
                    <h2 className="text-sm font-semibold theme-text-primary">
                      {showFullHistory ? "Full Upload History" : "Recent Uploads"}
                    </h2>
                    <div className="flex gap-2">
                      {showFullHistory && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (!fullHistory?.length) return;
                            const headers = ["File", "Type", "Month", "Date Range", "Rows", "Status", "Triggers", "Uploaded", "By"];
                            const csv = [headers.join(","), ...fullHistory.map((u: any) => [
                              `"${u.fileName}"`, u.reportType, u.reportingMonth,
                              u.dateRangeStart ? `"${u.dateRangeStart} - ${u.dateRangeEnd}"` : "",
                              u.rowCount ?? "", u.processingStatus,
                              `"${(u.processingResults || []).map((r: any) => `${r.trigger}: ${r.status}`).join("; ")}"`,
                              new Date(u.createdAt).toLocaleString(), `"${u.uploadedByName}"`
                            ].join(","))].join("\n");
                            const blob = new Blob([csv], { type: "text/csv" });
                            const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
                            link.download = `upload-history-${new Date().toISOString().split("T")[0]}.csv`; link.click();
                          }}
                        >
                          Export CSV
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowFullHistory(!showFullHistory)}
                      >
                        {showFullHistory ? "Show Recent" : `View All (${fullHistory?.length ?? 0})`}
                      </Button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    {(() => {
                      const historyData = showFullHistory ? fullHistory : uploadHistory;
                      if (!historyData || historyData.length === 0) {
                        return <p className="p-6 text-sm text-center theme-text-tertiary">No uploads yet</p>;
                      }
                      return (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className={`border-b theme-border-secondary ${isDark ? "bg-slate-800/80" : "bg-gray-50"}`}>
                              {["File", "Type", "Date Range", "Rows", "Status", "Uploaded", "By"].map((h) => (
                                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider theme-text-tertiary">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {historyData.map((u: any) => (
                              <tr key={u._id} className={`border-b theme-border-secondary ${isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-50"} transition-colors`}>
                                <td className="px-4 py-2.5 font-mono text-xs truncate max-w-[200px] theme-text-primary">{u.fileName}</td>
                                <td className="px-4 py-2.5 theme-text-secondary">{u.reportType}</td>
                                <td className="px-4 py-2.5 theme-text-secondary">
                                  {u.dateRangeStart && u.dateRangeEnd
                                    ? <span className="text-xs">{u.dateRangeStart} — {u.dateRangeEnd}</span>
                                    : formatMonth(u.reportingMonth)}
                                </td>
                                <td className="px-4 py-2.5 theme-text-secondary">{u.rowCount ?? "—"}</td>
                                <td className="px-4 py-2.5">
                                  <div>
                                    <span className={`ui-badge ${
                                      u.processingStatus === "complete" ? "ui-badge-green" :
                                      u.processingStatus === "processing" ? "ui-badge-blue" :
                                      u.processingStatus === "failed" ? "ui-badge-red" :
                                      "ui-badge-gray"
                                    }`}>
                                      {u.processingStatus}
                                    </span>
                                    {u.processingResults && u.processingResults.length > 0 && (
                                      <div className="mt-1 space-y-0.5">
                                        {u.processingResults.map((r: any, i: number) => (
                                          <div key={i} className={`text-[10px] ${r.status === "success" ? "text-emerald-600 dark:text-emerald-500" : "text-red-600 dark:text-red-400"}`}>
                                            {r.trigger}: {r.message || r.status}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-xs whitespace-nowrap theme-text-tertiary">
                                  <div>{new Date(u.createdAt).toLocaleDateString()}</div>
                                  <div className="text-[10px] theme-text-tertiary">
                                    {new Date(u.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-xs theme-text-tertiary">{u.uploadedByName}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </Protected>
  );
}
