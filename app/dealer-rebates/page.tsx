"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { usePermissions } from "@/lib/usePermissions";
import { aggregate, rebateBrand, type RebateDealer, type OutputRow } from "@/lib/dealerRebates/aggregate";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function cleanSku(raw: string): string { return raw.replace(/\[+$/, "").trim(); }

function toCSV(headers: string[], rows: Record<string, string | number>[]): string {
  const esc = (v: string | number) => { const s = String(v ?? ""); return s.includes(",") ? `"${s}"` : s; };
  return [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\r\n");
}

function downloadCSV(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function todayStamp(): string {
  const d = new Date();
  return `${d.getMonth()+1}${String(d.getDate()).padStart(2,"0")}${d.getFullYear()}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── TYPES ──────────────────────────────────────────────────────────────────────────────

interface ProcessResults {
  falkenOut: OutputRow[];
  milestarOut: OutputRow[];
  falkenDealersMatched: number;
  milestarDealersMatched: number;
  totalInputRows: number;
  filteredRows: number;
}

type Dealer = {
  _id: Id<"dealerRebateDealers">;
  jmk: string;
  name: string;
  fanaticId?: number;
  dealerNumber?: string;
  programs: string[];
  primSec?: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
};

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = ["Dealer Management", "Upload History", "Reports", "Stats"] as const;
type TabType = typeof TABS[number];

const UPLOAD_STEPS = ["Upload OEA07V", "Select Programs", "Review & Export"];

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function DealerRebatesPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();
  const permissions = usePermissions();

  const [activeTab, setActiveTab] = useState<TabType>("Dealer Management");

  const canViewStats = permissions.hasPermission("dealerRebates.viewStats");
  const visibleTabs = TABS.filter(tab => tab !== "Stats" || canViewStats);

  return (
    <Protected>
      <div className={`flex h-screen theme-bg-primary`}>
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />
          {/* Header */}
          <header className={`sticky top-0 z-10 border-b px-4 sm:px-6 py-3 sm:py-4 ${isDark ? "bg-slate-900/95 backdrop-blur border-slate-700" : "bg-white/95 backdrop-blur border-gray-200"}`}>
            <div className="flex items-center gap-3">
              <a href="/reports" className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </a>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? "bg-gradient-to-br from-amber-500/20 to-orange-600/20" : "bg-gradient-to-br from-amber-100 to-orange-100"}`}>
                <svg className={`w-5 h-5 ${isDark ? "text-amber-400" : "text-amber-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Dealer Rebate Tool
                </h1>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Associate Dealer Program &mdash; OEA07V to CSV Upload Generator
                </p>
              </div>
            </div>
            {/* Tabs */}
            <div className="flex flex-wrap gap-1 mt-4">
              {visibleTabs.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? isDark ? "bg-orange-500/20 text-orange-400 border border-orange-500/40" : "bg-orange-100 text-orange-700 border border-orange-300"
                      : isDark ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </header>

          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
            {activeTab === "Dealer Management" && <DealerManagementTab isDark={isDark} />}
            {activeTab === "Upload History" && <UploadHistoryTab isDark={isDark} />}
            {activeTab === "Reports" && <MonthlyReportsTab isDark={isDark} />}
            {activeTab === "Stats" && <StatsTab isDark={isDark} />}
          </div>
        </main>
      </div>
    </Protected>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: REPORTS — one consolidated, downloadable submission CSV per program per quarter
// ═══════════════════════════════════════════════════════════════════════════════

type QuarterReport = { program: string; display: string; quarter: string; range: string; label: string; fileName: string; days: number; months: number };

function rptQuarterLabel(q: string): string {
  const [y, qn] = q.split("-Q");
  return `Q${qn} ${y}`;
}

function MonthlyReportsTab({ isDark }: { isDark: boolean }) {
  const [reports, setReports] = useState<QuarterReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dealer-rebates/monthly-report?list=1")
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; if (d.error) setError(d.error); else setReports(d.reports || []); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  const byQuarter = new Map<string, QuarterReport[]>();
  for (const r of reports ?? []) {
    if (!byQuarter.has(r.quarter)) byQuarter.set(r.quarter, []);
    byQuarter.get(r.quarter)!.push(r);
  }
  const quarters = [...byQuarter.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-4">
      <div>
        <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Submission Reports</h2>
        <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
          One consolidated CSV per program per quarter (all dealers, single header), built fresh from current data. Download and submit to the portal.
        </p>
      </div>

      {error && <div className={`p-3 rounded-lg text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-600"}`}>{error}</div>}
      {reports === null && !error && <div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading…</div>}
      {reports !== null && quarters.length === 0 && !error && (
        <div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>No reports available yet.</div>
      )}

      {quarters.map((quarter) => (
        <div key={quarter} className={`rounded-xl border p-4 ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
          <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-slate-200" : "text-gray-800"}`}>
            {rptQuarterLabel(quarter)}
            {byQuarter.get(quarter)![0]?.range && (
              <span className={`ml-2 font-normal text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>({byQuarter.get(quarter)![0].range})</span>
            )}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {byQuarter.get(quarter)!.sort((a, b) => a.program.localeCompare(b.program)).map((r) => (
              <a
                key={r.program}
                href={`/api/dealer-rebates/monthly-report?program=${r.program}&quarter=${r.quarter}`}
                download={r.fileName}
                className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-colors ${isDark ? "border-slate-600 hover:bg-slate-700/50" : "border-gray-200 hover:bg-gray-50"}`}
              >
                <div className="min-w-0">
                  <div className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{r.display}</div>
                  <div className={`text-xs font-mono truncate ${isDark ? "text-slate-400" : "text-gray-500"}`}>{r.fileName} · {r.months} mo · {r.days} days</div>
                </div>
                <span className={`flex items-center gap-1 text-sm font-medium whitespace-nowrap ${isDark ? "text-orange-400" : "text-orange-600"}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Download
                </span>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1: UPLOAD & PROCESS
// ═══════════════════════════════════════════════════════════════════════════════

function UploadTab({ isDark, userId }: { isDark: boolean; userId?: Id<"users"> }) {
  const dealers = useQuery(api.dealerRebates.listDealers, { activeOnly: true });
  const saveUpload = useMutation(api.dealerRebates.saveUpload);

  const [step, setStep] = useState(0);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [filteredRows, setFilteredRows] = useState<string[][]>([]);
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [programs, setPrograms] = useState({ falken: true, milestar: true });
  const [results, setResults] = useState<ProcessResults | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ falken: boolean; milestar: boolean }>({ falken: false, milestar: false });
  const fileRef = useRef<HTMLInputElement>(null);

  const falkenDealers = useMemo(() => dealers?.filter(d => d.programs.includes("falken")) ?? [], [dealers]);
  const milestarDealers = useMemo(() => dealers?.filter(d => d.programs.includes("milestar")) ?? [], [dealers]);

  const handleFile = useCallback((file: File | null) => {
    if (!file) return;
    setFileError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setRawText(text);

      // Parse rows for preview display (step indicator counts)
      const cleaned = text.replace(/^\uFEFF/, "").replace(/\0/g, "");
      const lines = cleaned.trim().split(/\r?\n/);
      const allRows = lines.slice(1).filter((l: string) => l.trim()).map((line: string) => {
        const fields: string[] = [];
        let cur = "", inQ = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') { inQ = !inQ; }
          else if (c === ',' && !inQ) { fields.push(cur); cur = ""; }
          else { cur += c; }
        }
        fields.push(cur);
        return fields;
      });
      if (allRows.length === 0) { setFileError("File is empty or could not be parsed."); return; }

      // Filter to rebate-eligible rows for preview count (FAL/MIL + Dunlop BLUE RESPONSE A/S).
      // Uses rebateBrand() so this stays in sync with the live aggregate().
      const brandRows = allRows.filter((cols: string[]) => rebateBrand(cols) !== null);

      setRawRows(allRows);
      setFilteredRows(brandRows);
      setStep(1);
    };
    reader.readAsText(file);
  }, []);

  const processData = async () => {
    if (!dealers) return;

    const dealerList: RebateDealer[] = (dealers ?? []).map(d => ({
      jmk: d.jmk, name: d.name, fanaticId: d.fanaticId, dealerNumber: d.dealerNumber,
      programs: d.programs, isActive: d.isActive,
    }));
    const result = aggregate(rawText, dealerList);

    // Filter to selected programs
    const falkenOut = programs.falken ? result.falken.outRows : [];
    const milestarOut = programs.milestar ? result.milestar.outRows : [];

    const newResults: ProcessResults = {
      falkenOut,
      milestarOut,
      falkenDealersMatched: programs.falken ? result.falken.dealersMatched : 0,
      milestarDealersMatched: programs.milestar ? result.milestar.dealersMatched : 0,
      totalInputRows: result.totalInputRows,
      filteredRows: result.filteredRows,
    };
    setResults(newResults);
    setStep(2);

    // Auto-save upload history for each program
    if (userId) {
      if (programs.falken && result.falken.outRows.length > 0) {
        const falkenHeaders = ["Falken_Distributor_Account_Number","FANATIC_Dealer_Account_Number","Distributor_Center_Address","Distributor_Center_City","Distributor_Center_State","Distributor_Center_Postal_Code","Invoice_Number","SKU","Date","Quantity","Price_Per_Tire"];
        const falkenCsv = toCSV(falkenHeaders, result.falken.outRows);
        try {
          await saveUpload({
            fileName,
            program: "falken",
            totalInputRows: result.totalInputRows,
            filteredRows: result.filteredRows,
            matchedRows: result.falken.matchedRows,
            matchedQty: result.falken.matchedQty,
            dealersMatched: result.falken.dealersMatched,
            resultData: falkenCsv,
            dealerBreakdown: result.falken.breakdown,
            uploadedBy: userId,
            dateRangeStart: result.dateRangeStart,
            dateRangeEnd: result.dateRangeEnd,
          });
          setSaved(p => ({ ...p, falken: true }));
        } catch (err) {
          console.error("Failed to save Falken upload:", err);
        }
      }

      if (programs.milestar && result.milestar.outRows.length > 0) {
        const milestarHeaders = ["ParentDistributorNumber","DistributorCenterNumber","DealerNumber","InvoiceNumber","InvoiceDate","ProductCode","Quantity","SellPricePerTire"];
        const milestarCsv = toCSV(milestarHeaders, result.milestar.outRows);
        try {
          await saveUpload({
            fileName,
            program: "milestar",
            totalInputRows: result.totalInputRows,
            filteredRows: result.filteredRows,
            matchedRows: result.milestar.matchedRows,
            matchedQty: result.milestar.matchedQty,
            dealersMatched: result.milestar.dealersMatched,
            resultData: milestarCsv,
            dealerBreakdown: result.milestar.breakdown,
            uploadedBy: userId,
            dateRangeStart: result.dateRangeStart,
            dateRangeEnd: result.dateRangeEnd,
          });
          setSaved(p => ({ ...p, milestar: true }));
        } catch (err) {
          console.error("Failed to save Milestar upload:", err);
        }
      }
    }
  };

  const exportFalken = () => {
    if (!results) return;
    const headers = ["Falken_Distributor_Account_Number","FANATIC_Dealer_Account_Number","Distributor_Center_Address","Distributor_Center_City","Distributor_Center_State","Distributor_Center_Postal_Code","Invoice_Number","SKU","Date","Quantity","Price_Per_Tire"];
    downloadCSV(`Falken_Fanatic_${todayStamp()}.csv`, toCSV(headers, results.falkenOut));
  };

  const exportMilestar = () => {
    if (!results) return;
    const headers = ["ParentDistributorNumber","DistributorCenterNumber","DealerNumber","InvoiceNumber","InvoiceDate","ProductCode","Quantity","SellPricePerTire"];
    downloadCSV(`Milestar_Momentum_${todayStamp()}.csv`, toCSV(headers, results.milestarOut));
  };

  const resetAll = () => {
    setStep(0);
    setRawRows([]);
    setFilteredRows([]);
    setRawText("");
    setResults(null);
    setFileName("");
    setFileError("");
    setSaved({ falken: false, milestar: false });
  };

  if (!dealers) {
    return <div className={`text-center py-12 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading dealers...</div>;
  }

  return (
    <div>
      {/* Step Indicator */}
      <div className="flex items-center gap-2 mb-8">
        {UPLOAD_STEPS.map((label, i) => (
          <div key={i} className="flex items-center gap-2 flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-bold flex-shrink-0 transition-all ${
              step > i
                ? "bg-green-500/20 text-green-400 border-2 border-green-500/40"
                : step === i
                  ? isDark ? "bg-orange-500/20 text-orange-400 border-2 border-orange-500/40" : "bg-orange-100 text-orange-600 border-2 border-orange-300"
                  : isDark ? "bg-slate-800 text-slate-500 border-2 border-slate-700" : "bg-gray-100 text-gray-400 border-2 border-gray-200"
            }`}>
              {step > i ? "\u2713" : i + 1}
            </div>
            <span className={`text-xs font-semibold uppercase tracking-wide ${
              step === i
                ? isDark ? "text-white" : "text-gray-900"
                : isDark ? "text-slate-500" : "text-gray-400"
            }`}>
              {label}
            </span>
            {i < UPLOAD_STEPS.length - 1 && (
              <div className={`flex-1 h-px ${isDark ? "bg-slate-700" : "bg-gray-200"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 0: Upload */}
      {step === 0 && (
        <div className={`rounded-xl border p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
          <h2 className={`text-sm font-bold uppercase tracking-wider mb-4 ${isDark ? "text-orange-400" : "text-orange-600"}`}>
            Upload OEA07V Report
          </h2>
          <div
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
              dragOver
                ? isDark ? "border-orange-500 bg-orange-500/10" : "border-orange-400 bg-orange-50"
                : isDark ? "border-slate-600 hover:border-slate-500 bg-slate-800/50" : "border-gray-300 hover:border-gray-400 bg-gray-50"
            }`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current?.click()}
          >
            <svg className={`w-12 h-12 mx-auto mb-3 ${isDark ? "text-slate-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className={`font-semibold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>
              Drop OEA07V CSV here, or click to browse
            </p>
            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Only product types starting with &quot;T&quot; will be processed
            </p>
          </div>
          <input type="file" accept=".csv" ref={fileRef} className="hidden" onChange={e => handleFile(e.target.files?.[0] ?? null)} />
          {fileError && (
            <div className={`mt-4 p-3 rounded-lg text-sm ${isDark ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-red-50 text-red-600 border border-red-200"}`}>
              {fileError}
            </div>
          )}
        </div>
      )}

      {/* Step 1: Select Programs */}
      {step === 1 && (
        <div>
          <div className={`rounded-xl border p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
            <h2 className={`text-sm font-bold uppercase tracking-wider mb-4 ${isDark ? "text-orange-400" : "text-orange-600"}`}>
              Select Programs to Generate
            </h2>
            <div className={`mb-5 p-3 rounded-lg text-sm flex items-center gap-2 ${isDark ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-green-50 text-green-700 border border-green-200"}`}>
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Loaded <strong className="mx-1">{fileName}</strong> &mdash; {rawRows.length} total rows, {filteredRows.length} &quot;T&quot; product rows ready.
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { key: "falken" as const, label: "Falken Fanatic", color: isDark ? "text-amber-400" : "text-amber-600", borderColor: "border-amber-500", bgColor: isDark ? "bg-amber-500/10" : "bg-amber-50", count: falkenDealers.length, fmt: "11-column CSV" },
                { key: "milestar" as const, label: "Milestar Momentum", color: isDark ? "text-blue-400" : "text-blue-600", borderColor: "border-blue-500", bgColor: isDark ? "bg-blue-500/10" : "bg-blue-50", count: milestarDealers.length, fmt: "8-column CSV" },
              ].map(p => (
                <div
                  key={p.key}
                  className={`rounded-xl border-2 p-5 cursor-pointer transition-all ${
                    programs[p.key]
                      ? `${p.borderColor} ${p.bgColor}`
                      : isDark ? "border-slate-700 bg-slate-800/30 hover:border-slate-600" : "border-gray-200 bg-gray-50 hover:border-gray-300"
                  }`}
                  onClick={() => setPrograms({ ...programs, [p.key]: !programs[p.key] })}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold ${
                      programs[p.key]
                        ? "bg-orange-500 text-white"
                        : isDark ? "border-2 border-slate-600" : "border-2 border-gray-300"
                    }`}>
                      {programs[p.key] && "\u2713"}
                    </div>
                    <span className={`font-bold ${p.color}`}>{p.label}</span>
                  </div>
                  <p className={`text-xs ml-8 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    {p.count} enrolled dealers &middot; {p.fmt}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button
              onClick={() => { setStep(0); setRawRows([]); setFilteredRows([]); setFileName(""); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700" : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"}`}
            >
              &larr; Back
            </button>
            <button
              disabled={!programs.falken && !programs.milestar}
              onClick={processData}
              className={`px-5 py-2 rounded-lg text-sm font-bold transition-colors ${
                programs.falken || programs.milestar
                  ? "bg-orange-500 hover:bg-orange-600 text-white"
                  : isDark ? "bg-slate-700 text-slate-500 cursor-not-allowed" : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }`}
            >
              Process & Review &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Review & Export */}
      {step === 2 && results && (
        <div>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
              <div className={`text-3xl font-mono font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{results.totalInputRows}</div>
              <div className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Total Rows</div>
            </div>
            <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
              <div className={`text-3xl font-mono font-bold ${isDark ? "text-orange-400" : "text-orange-600"}`}>{results.filteredRows}</div>
              <div className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>T-Type Rows</div>
            </div>
            {programs.falken && (
              <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
                <div className="text-3xl font-mono font-bold text-green-400">{results.falkenOut.length}</div>
                <div className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Falken &middot; {results.falkenDealersMatched} dealers</div>
              </div>
            )}
            {programs.milestar && (
              <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
                <div className="text-3xl font-mono font-bold text-blue-400">{results.milestarOut.length}</div>
                <div className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Milestar &middot; {results.milestarDealersMatched} dealers</div>
              </div>
            )}
          </div>

          {/* Falken Export */}
          {programs.falken && (
            <div className={`rounded-xl border overflow-hidden mb-4 ${isDark ? "border-slate-700" : "border-gray-200 shadow-sm"}`}>
              <div className={`px-5 py-3 flex items-center justify-between border-b-2 ${isDark ? "bg-amber-500/10 border-amber-500/40" : "bg-amber-50 border-amber-300"}`}>
                <div>
                  <div className={`font-bold ${isDark ? "text-amber-400" : "text-amber-700"}`}>Falken Fanatic</div>
                  <div className={`text-xs ${isDark ? "text-amber-600" : "text-amber-500"}`}>{results.falkenOut.length} rows &middot; Distributor 20118 &middot; M/D/YYYY dates</div>
                </div>
                {results.falkenOut.length > 0 ? (
                  <button onClick={exportFalken} className="px-4 py-1.5 rounded-lg text-sm font-bold bg-green-600 hover:bg-green-700 text-white transition-colors">
                    Download Falken CSV
                  </button>
                ) : (
                  <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>No matching dealers</span>
                )}
              </div>
              <div className={`p-4 ${isDark ? "bg-slate-800/50" : "bg-white"}`}>
                {results.falkenOut.length > 0 ? (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className={isDark ? "text-slate-400" : "text-gray-500"}>
                            <th className="text-left py-2 px-2 font-medium">Fanatic ID</th>
                            <th className="text-left py-2 px-2 font-medium">Invoice</th>
                            <th className="text-left py-2 px-2 font-medium">SKU</th>
                            <th className="text-left py-2 px-2 font-medium">Date</th>
                            <th className="text-left py-2 px-2 font-medium">Qty</th>
                            <th className="text-left py-2 px-2 font-medium">$/Tire</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.falkenOut.slice(0, 8).map((r, i) => (
                            <tr key={i} className={`border-t ${isDark ? "border-slate-700/50 hover:bg-slate-700/30" : "border-gray-100 hover:bg-gray-50"}`}>
                              <td className={`py-1.5 px-2 font-mono ${isDark ? "text-slate-300" : "text-gray-600"}`}>{r.FANATIC_Dealer_Account_Number}</td>
                              <td className={`py-1.5 px-2 font-mono ${isDark ? "text-slate-300" : "text-gray-600"}`}>{r.Invoice_Number}</td>
                              <td className={`py-1.5 px-2 font-mono ${isDark ? "text-slate-300" : "text-gray-600"}`}>{r.SKU}</td>
                              <td className={`py-1.5 px-2 font-mono ${isDark ? "text-slate-300" : "text-gray-600"}`}>{r.Date}</td>
                              <td className={`py-1.5 px-2 font-mono ${isDark ? "text-slate-300" : "text-gray-600"}`}>{r.Quantity}</td>
                              <td className={`py-1.5 px-2 font-mono ${isDark ? "text-slate-300" : "text-gray-600"}`}>{r.Price_Per_Tire}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {results.falkenOut.length > 8 && (
                      <p className={`text-xs mt-2 font-mono ${isDark ? "text-slate-500" : "text-gray-400"}`}>+ {results.falkenOut.length - 8} more rows in download</p>
                    )}
                  </>
                ) : (
                  <div className={`p-3 rounded-lg text-sm ${isDark ? "bg-amber-500/10 text-amber-300 border border-amber-500/20" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                    No Falken Fanatic dealers matched in this OEA07V.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Milestar Export */}
          {programs.milestar && (
            <div className={`rounded-xl border overflow-hidden mb-4 ${isDark ? "border-slate-700" : "border-gray-200 shadow-sm"}`}>
              <div className={`px-5 py-3 flex items-center justify-between border-b-2 ${isDark ? "bg-blue-500/10 border-blue-500/40" : "bg-blue-50 border-blue-300"}`}>
                <div>
                  <div className={`font-bold ${isDark ? "text-blue-400" : "text-blue-700"}`}>Milestar Momentum</div>
                  <div className={`text-xs ${isDark ? "text-blue-600" : "text-blue-500"}`}>{results.milestarOut.length} rows &middot; Parent 119662 &middot; YYMMDD dates</div>
                </div>
                {results.milestarOut.length > 0 ? (
                  <button onClick={exportMilestar} className="px-4 py-1.5 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors">
                    Download Milestar CSV
                  </button>
                ) : (
                  <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>No matching dealers</span>
                )}
              </div>
              <div className={`p-4 ${isDark ? "bg-slate-800/50" : "bg-white"}`}>
                {results.milestarOut.length > 0 ? (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className={isDark ? "text-slate-400" : "text-gray-500"}>
                            <th className="text-left py-2 px-2 font-medium">Dealer #</th>
                            <th className="text-left py-2 px-2 font-medium">Invoice</th>
                            <th className="text-left py-2 px-2 font-medium">SKU</th>
                            <th className="text-left py-2 px-2 font-medium">Date</th>
                            <th className="text-left py-2 px-2 font-medium">Qty</th>
                            <th className="text-left py-2 px-2 font-medium">$/Tire</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.milestarOut.slice(0, 8).map((r, i) => (
                            <tr key={i} className={`border-t ${isDark ? "border-slate-700/50 hover:bg-slate-700/30" : "border-gray-100 hover:bg-gray-50"}`}>
                              <td className={`py-1.5 px-2 font-mono ${isDark ? "text-slate-300" : "text-gray-600"}`}>{r.DealerNumber}</td>
                              <td className={`py-1.5 px-2 font-mono ${isDark ? "text-slate-300" : "text-gray-600"}`}>{r.InvoiceNumber}</td>
                              <td className={`py-1.5 px-2 font-mono ${isDark ? "text-slate-300" : "text-gray-600"}`}>{r.ProductCode}</td>
                              <td className={`py-1.5 px-2 font-mono ${isDark ? "text-slate-300" : "text-gray-600"}`}>{r.InvoiceDate}</td>
                              <td className={`py-1.5 px-2 font-mono ${isDark ? "text-slate-300" : "text-gray-600"}`}>{r.Quantity}</td>
                              <td className={`py-1.5 px-2 font-mono ${isDark ? "text-slate-300" : "text-gray-600"}`}>{r.SellPricePerTire}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {results.milestarOut.length > 8 && (
                      <p className={`text-xs mt-2 font-mono ${isDark ? "text-slate-500" : "text-gray-400"}`}>+ {results.milestarOut.length - 8} more rows in download</p>
                    )}
                  </>
                ) : (
                  <div className={`p-3 rounded-lg text-sm ${isDark ? "bg-blue-500/10 text-blue-300 border border-blue-500/20" : "bg-blue-50 text-blue-700 border border-blue-200"}`}>
                    No Milestar Momentum dealers matched in this OEA07V.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={resetAll}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700" : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"}`}
            >
              Start New Upload
            </button>
            {(saved.falken || saved.milestar) && (
              <span className={`text-xs ${isDark ? "text-green-400" : "text-green-600"}`}>
                Saved to upload history
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2: DEALER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

function DealerManagementTab({ isDark }: { isDark: boolean }) {
  const dealers = useQuery(api.dealerRebates.listDealers, { activeOnly: false });
  const createDealer = useMutation(api.dealerRebates.createDealer);
  const updateDealer = useMutation(api.dealerRebates.updateDealer);
  const deleteDealer = useMutation(api.dealerRebates.deleteDealer);
  const permissions = usePermissions();
  const { user } = useAuth();
  const canDeactivate = permissions.hasPermission("dealerRebates.deactivateDealers");

  const [search, setSearch] = useState("");
  const [programFilter, setProgramFilter] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDealer, setEditingDealer] = useState<Dealer | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<Dealer | null>(null);

  // Form state
  const [formJmk, setFormJmk] = useState("");
  const [formName, setFormName] = useState("");
  const [formFanaticId, setFormFanaticId] = useState("");
  const [formDealerNumber, setFormDealerNumber] = useState("");
  const [formPrograms, setFormPrograms] = useState<string[]>(["falken"]);
  const [formPrimSec, setFormPrimSec] = useState("");
  const [formSaving, setFormSaving] = useState(false);

  const filteredDealers = useMemo(() => {
    if (!dealers) return [];
    let list = dealers;
    if (!showInactive) list = list.filter(d => d.isActive);
    if (programFilter !== "all") list = list.filter(d => d.programs.includes(programFilter));
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(d =>
        d.name.toLowerCase().includes(s) ||
        d.jmk.toLowerCase().includes(s) ||
        (d.fanaticId && String(d.fanaticId).includes(s)) ||
        (d.dealerNumber && d.dealerNumber.includes(s))
      );
    }
    return list;
  }, [dealers, search, programFilter, showInactive]);

  const resetForm = () => {
    setFormJmk("");
    setFormName("");
    setFormFanaticId("");
    setFormDealerNumber("");
    setFormPrograms(["falken"]);
    setFormPrimSec("");
  };

  const openEdit = (d: Dealer) => {
    setFormError("");
    setEditingDealer(d);
    setFormJmk(d.jmk);
    setFormName(d.name);
    setFormFanaticId(d.fanaticId ? String(d.fanaticId) : "");
    setFormDealerNumber(d.dealerNumber ?? "");
    setFormPrograms([...d.programs]);
    setFormPrimSec(d.primSec ? String(d.primSec) : "");
    setShowAddModal(true);
  };

  const [formError, setFormError] = useState("");

  const handleSave = async () => {
    if (!formName.trim()) return;
    setFormSaving(true);
    setFormError("");
    try {
      const data = {
        jmk: formJmk.trim(),
        name: formName.trim(),
        fanaticId: formFanaticId ? Number(formFanaticId) : undefined,
        dealerNumber: formDealerNumber.trim() || undefined,
        programs: formPrograms,
        primSec: formPrimSec ? Number(formPrimSec) : undefined,
      };

      if (!user) { setFormError("Not signed in"); return; }
      let result;
      if (editingDealer) {
        result = await updateDealer({ id: editingDealer._id, ...data, requestingUserId: user._id });
      } else {
        result = await createDealer({ ...data, requestingUserId: user._id });
      }

      if (result && !result.success && result.error) {
        setFormError(result.error);
        return;
      }

      setShowAddModal(false);
      setEditingDealer(null);
      resetForm();
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async (id: Id<"dealerRebateDealers">) => {
    if (!user) return;
    await deleteDealer({ id, requestingUserId: user._id });
  };

  const handleReactivate = async (d: Dealer) => {
    if (!user) return;
    await updateDealer({ id: d._id, isActive: true, requestingUserId: user._id });
  };

  if (!dealers) {
    return <div className={`text-center py-12 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading dealers...</div>;
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by name, JMK, Fanatic ID, or dealer #..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={`flex-1 min-w-[250px] px-3 py-2 rounded-lg text-sm border ${isDark ? "bg-slate-800 border-slate-700 text-white placeholder-slate-500" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"}`}
        />
        <select
          value={programFilter}
          onChange={e => setProgramFilter(e.target.value)}
          className={`px-3 py-2 rounded-lg text-sm border ${isDark ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"}`}
        >
          <option value="all">All Programs</option>
          <option value="falken">Falken</option>
          <option value="milestar">Milestar</option>
        </select>
        <label className={`flex items-center gap-2 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (!dealers) return;
              const rows = filteredDealers.map(d => [
                d.jmk, d.name, d.fanaticId ?? "", d.dealerNumber ?? "",
                d.programs.join(";"), d.primSec ?? "", d.isActive ? "Active" : "Inactive"
              ]);
              const csv = ["JMK,Name,Fanatic ID,Dealer Number,Programs,Prim/Sec,Status",
                ...rows.map(r => r.map(v => String(v).includes(",") ? `"${v}"` : v).join(","))
              ].join("\r\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = `dealers_${programFilter}_${new Date().toISOString().slice(0,10)}.csv`;
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isDark ? "bg-slate-700 hover:bg-slate-600 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"
            }`}
          >
            Export CSV
          </button>
          <button
            onClick={() => { setEditingDealer(null); resetForm(); setFormError(""); setShowAddModal(true); }}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white transition-colors"
          >
            + Add Dealer
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-4 mb-4">
        <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
          {filteredDealers.length} dealer{filteredDealers.length !== 1 ? "s" : ""} shown
        </span>
        <span className={`text-xs ${isDark ? "text-amber-400/70" : "text-amber-600"}`}>
          {dealers.filter(d => d.isActive && d.programs.includes("falken")).length} Falken
        </span>
        <span className={`text-xs ${isDark ? "text-blue-400/70" : "text-blue-600"}`}>
          {dealers.filter(d => d.isActive && d.programs.includes("milestar")).length} Milestar
        </span>
      </div>

      {/* Dealer Table */}
      <div className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-700" : "border-gray-200 shadow-sm"}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={isDark ? "bg-slate-800/80 text-slate-400" : "bg-gray-50 text-gray-500"}>
                <th className="text-left py-3 px-4 font-medium">Name</th>
                <th className="text-left py-3 px-4 font-medium">JMK</th>
                <th className="text-left py-3 px-4 font-medium">Fanatic ID</th>
                <th className="text-left py-3 px-4 font-medium">Momentum #</th>
                <th className="text-left py-3 px-4 font-medium">Programs</th>
                <th className="text-left py-3 px-4 font-medium">Status</th>
                <th className="text-right py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDealers.map(d => (
                <tr key={d._id} className={`border-t ${isDark ? "border-slate-700/50 hover:bg-slate-800/50" : "border-gray-100 hover:bg-gray-50"} ${!d.isActive ? "opacity-50" : ""}`}>
                  <td className={`py-2.5 px-4 font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{d.name}</td>
                  <td className={`py-2.5 px-4 font-mono text-xs ${isDark ? "text-slate-300" : "text-gray-600"}`}>{d.jmk || "—"}</td>
                  <td className={`py-2.5 px-4 font-mono text-xs ${isDark ? "text-slate-300" : "text-gray-600"}`}>{d.fanaticId ?? "—"}</td>
                  <td className={`py-2.5 px-4 font-mono text-xs ${isDark ? "text-slate-300" : "text-gray-600"}`}>{d.dealerNumber ?? "—"}</td>
                  <td className="py-2.5 px-4">
                    <div className="flex gap-1">
                      {d.programs.includes("falken") && (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700"}`}>Falken</span>
                      )}
                      {d.programs.includes("milestar") && (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-700"}`}>Milestar</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    {d.isActive ? (
                      <span className="text-green-500 text-xs font-medium">Active</span>
                    ) : (
                      <span className="text-red-400 text-xs font-medium">Inactive</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(d)}
                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"}`}
                      >
                        Edit
                      </button>
                      {canDeactivate && (
                        d.isActive ? (
                          <button
                            onClick={() => setConfirmDeactivate(d)}
                            className="px-2 py-1 rounded text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => handleReactivate(d)}
                            className="px-2 py-1 rounded text-xs font-medium text-green-400 hover:text-green-300 hover:bg-green-500/10 transition-colors"
                          >
                            Reactivate
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredDealers.length === 0 && (
                <tr>
                  <td colSpan={7} className={`py-8 text-center text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    No dealers found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => { setShowAddModal(false); setEditingDealer(null); }}>
          <div className={`w-full max-w-md rounded-xl border p-6 ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200 shadow-xl"}`} onClick={e => e.stopPropagation()}>
            <h3 className={`text-lg font-bold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
              {editingDealer ? "Edit Dealer" : "Add New Dealer"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>Dealer Name *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className={`w-full mt-1 px-3 py-2 rounded-lg text-sm border ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>JMK Account #</label>
                  <input
                    type="text"
                    value={formJmk}
                    onChange={e => setFormJmk(e.target.value)}
                    className={`w-full mt-1 px-3 py-2 rounded-lg text-sm border ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                  />
                </div>
                <div>
                  <label className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>Prim/Sec</label>
                  <select
                    value={formPrimSec}
                    onChange={e => setFormPrimSec(e.target.value)}
                    className={`w-full mt-1 px-3 py-2 rounded-lg text-sm border ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                  >
                    <option value="">—</option>
                    <option value="1">1 (Primary)</option>
                    <option value="2">2 (Secondary)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>Fanatic ID</label>
                  <input
                    type="number"
                    value={formFanaticId}
                    onChange={e => setFormFanaticId(e.target.value)}
                    className={`w-full mt-1 px-3 py-2 rounded-lg text-sm border ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                  />
                </div>
                <div>
                  <label className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>Momentum #</label>
                  <input
                    type="text"
                    value={formDealerNumber}
                    onChange={e => setFormDealerNumber(e.target.value)}
                    className={`w-full mt-1 px-3 py-2 rounded-lg text-sm border ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                  />
                </div>
              </div>
              <div>
                <label className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>Programs</label>
                <div className="flex gap-3 mt-1">
                  {["falken", "milestar"].map(p => (
                    <label key={p} className={`flex items-center gap-2 text-sm ${isDark ? "text-white" : "text-gray-900"}`}>
                      <input
                        type="checkbox"
                        checked={formPrograms.includes(p)}
                        onChange={e => {
                          if (e.target.checked) setFormPrograms([...formPrograms, p]);
                          else setFormPrograms(formPrograms.filter(x => x !== p));
                        }}
                      />
                      {p === "falken" ? "Falken Fanatic" : "Milestar Momentum"}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            {formError && (
              <div className={`mt-4 p-3 rounded-lg text-sm ${isDark ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-red-50 text-red-600 border border-red-200"}`}>
                {formError}
              </div>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setShowAddModal(false); setEditingDealer(null); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? "text-slate-300 hover:bg-slate-700" : "text-gray-600 hover:bg-gray-100"}`}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!formName.trim() || formPrograms.length === 0 || formSaving}
                className="px-5 py-2 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white transition-colors disabled:opacity-50"
              >
                {formSaving ? "Saving..." : editingDealer ? "Update Dealer" : "Add Dealer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate Confirmation Modal */}
      {confirmDeactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDeactivate(null)}>
          <div className={`w-full max-w-sm rounded-xl border p-6 ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200 shadow-xl"}`} onClick={e => e.stopPropagation()}>
            <h3 className={`text-lg font-bold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
              Deactivate Dealer?
            </h3>
            <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Are you sure you want to deactivate <strong className={isDark ? "text-white" : "text-gray-900"}>{confirmDeactivate.name}</strong> (JMK: {confirmDeactivate.jmk || "N/A"})? They will no longer appear in upload processing.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDeactivate(null)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? "text-slate-300 hover:bg-slate-700" : "text-gray-600 hover:bg-gray-100"}`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await handleDelete(confirmDeactivate._id);
                  setConfirmDeactivate(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                Yes, Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3: UPLOAD HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

function UploadHistoryTab({ isDark }: { isDark: boolean }) {
  const permissions = usePermissions();
  const { user } = useAuth();
  const canDeleteUploads = permissions.hasPermission("dealerRebates.deleteUploads");
  const deleteUploadMut = useMutation(api.dealerRebates.deleteUpload);
  const [confirmDeleteId, setConfirmDeleteId] = useState<Id<"dealerRebateUploads"> | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState("");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [programFilter, setProgramFilter] = useState<string>("all");
  const [s3Reports, setS3Reports] = useState<{ program: string; fileName: string; size: number; date: string; downloadUrl: string; key: string }[]>([]);

  useEffect(() => {
    fetch("/api/dealer-rebates/list")
      .then(r => r.json())
      .then(data => setS3Reports(data.reports || []))
      .catch(() => {});
  }, []);

  // Debounce search
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(val), 300);
  };

  const uploads = useQuery(api.dealerRebates.getUploads, programFilter !== "all" ? { program: programFilter } : {});
  const searchResults = useQuery(
    api.dealerRebates.searchUploadsByDealer,
    debouncedSearch.length >= 2 ? { searchTerm: debouncedSearch } : "skip"
  );
  const [selectedUploadId, setSelectedUploadId] = useState<Id<"dealerRebateUploads"> | null>(null);
  const selectedUpload = useQuery(
    api.dealerRebates.getUploadById,
    selectedUploadId ? { id: selectedUploadId } : "skip"
  );

  const [showIngested, setShowIngested] = useState(false);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  // searchResults now returns { monthly, uploads } — extract just the uploads array for display
  const searchUploads = debouncedSearch.length >= 2 ? (searchResults?.uploads ?? null) : null;
  const searchMonthly = debouncedSearch.length >= 2 ? (searchResults?.monthly ?? null) : null;
  const convexUploads = (searchUploads !== null ? searchUploads : uploads) || [];

  // Daily submission files: group the generated S3 outputs by month → day → {falken, milestar}.
  const dailyByMonth = useMemo(() => {
    const filtered = s3Reports.filter(r => programFilter === "all" || r.program.toLowerCase().includes(programFilter));
    const months = new Map<string, Map<string, { falken?: typeof filtered[number]; milestar?: typeof filtered[number] }>>();
    for (const r of filtered) {
      const m = r.fileName.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!m) continue;
      const day = `${m[1]}-${m[2]}-${m[3]}`;
      const month = `${m[1]}-${m[2]}`;
      if (!months.has(month)) months.set(month, new Map());
      const days = months.get(month)!;
      if (!days.has(day)) days.set(day, {});
      days.get(day)![r.program.includes("Falken") ? "falken" : "milestar"] = r;
    }
    return [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, days]) => ({
      month,
      days: [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, brands]) => ({ day, ...brands })),
    }));
  }, [s3Reports, programFilter]);

  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const reExport = () => {
    if (!selectedUpload?.resultData) return;
    const program = selectedUpload.program === "falken" ? "Falken_Fanatic" : "Milestar_Momentum";
    const date = new Date(selectedUpload.uploadDate);
    const stamp = `${date.getMonth()+1}${String(date.getDate()).padStart(2,"0")}${date.getFullYear()}`;
    downloadCSV(`${program}_${stamp}_reexport.csv`, selectedUpload.resultData);
  };

  // One ingested source-file record (expandable → breakdown + Re-export/Delete).
  const renderSourceCard = (u: any) => (
    <div
      key={u._id}
      className={`rounded-xl border p-4 transition-all cursor-pointer ${
        selectedUploadId === u._id
          ? isDark ? "border-orange-500/40 bg-orange-500/10" : "border-orange-300 bg-orange-50"
          : isDark ? "border-slate-700 bg-slate-800/50 hover:border-slate-600" : "border-gray-200 bg-white hover:border-gray-300 shadow-sm"
      }`}
      onClick={() => setSelectedUploadId(selectedUploadId === u._id ? null : u._id)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${u.program === "falken" ? (isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700") : (isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-700")}`}>{u.program}</span>
          <span className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{u.fileName}</span>
        </div>
        <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{formatDate(u.uploadDate || u.createdAt)}</span>
      </div>
      <div className={`flex gap-4 mt-2 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
        {"matchedRows" in u && u.matchedRows != null ? (
          <><span>{u.matchedRows} rows</span><span>{u.dealersMatched} dealers</span></>
        ) : "matchedDealers" in u && Array.isArray(u.matchedDealers) ? (
          <span>{u.matchedDealers.length} dealer{u.matchedDealers.length !== 1 ? "s" : ""} matched</span>
        ) : null}
        {u.dateRangeStart && (<span className={`font-medium ${isDark ? "text-cyan-400" : "text-blue-600"}`}>{u.dateRangeStart} — {u.dateRangeEnd}</span>)}
      </div>
      {selectedUploadId === u._id && (
        <div className={`mt-4 pt-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          {(("dealerBreakdown" in u && u.dealerBreakdown) || ("matchedDealers" in u && u.matchedDealers)) && (
            <div className="mb-3">
              <div className={`text-xs font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-600"}`}>{"matchedDealers" in u && u.matchedDealers ? "Matching Dealers:" : "Dealer Breakdown:"}</div>
              <div className="grid grid-cols-2 gap-1">
                {((u.matchedDealers ?? u.dealerBreakdown) as any[]).map((d: any, i: number) => (
                  <div key={i} className={`flex justify-between text-xs py-1 px-2 rounded ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}>
                    <span className={isDark ? "text-white" : "text-gray-900"}>{d.name}</span>
                    <span className={`font-mono ${isDark ? "text-slate-400" : "text-gray-500"}`}>{d.qty ?? d.rowCount} {d.qty != null ? "tires" : "rows"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            {selectedUpload?.resultData && (<button onClick={e => { e.stopPropagation(); reExport(); }} className="px-4 py-1.5 rounded-lg text-sm font-bold bg-green-600 hover:bg-green-700 text-white transition-colors">Re-export CSV</button>)}
            {selectedUpload && !selectedUpload.resultData && (<span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Loading export data...</span>)}
            {canDeleteUploads && (<button onClick={e => { e.stopPropagation(); setConfirmDeleteId(u._id); setConfirmDeleteName(u.fileName); }} className="px-4 py-1.5 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-700 text-white transition-colors">Delete</button>)}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by fanatic ID, JMK, dealer name, or dealer #..."
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className={`flex-1 min-w-[250px] px-3 py-2 rounded-lg text-sm border ${isDark ? "bg-slate-800 border-slate-700 text-white placeholder-slate-500" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"}`}
        />
        <select
          value={programFilter}
          onChange={e => setProgramFilter(e.target.value)}
          className={`px-3 py-2 rounded-lg text-sm border ${isDark ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"}`}
        >
          <option value="all">All Programs</option>
          <option value="falken">Falken</option>
          <option value="milestar">Milestar</option>
        </select>
      </div>

      {/* Monthly Totals summary when searching */}
      {debouncedSearch.length >= 2 && searchMonthly && searchMonthly.length > 0 && (
        <div className={`rounded-xl border overflow-hidden mb-6 ${isDark ? "border-slate-700" : "border-gray-200 shadow-sm"}`}>
          <div className={`px-5 py-3 border-b ${isDark ? "bg-slate-800/80 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
            <h3 className={`text-sm font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
              Monthly Totals &mdash; {debouncedSearch}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? "text-slate-400" : "text-gray-500"}>
                  <th className="text-left py-2 px-4 font-medium text-xs">Month</th>
                  <th className="text-right py-2 px-4 font-medium text-xs">Falken</th>
                  <th className="text-right py-2 px-4 font-medium text-xs">Milestar</th>
                  <th className="text-right py-2 px-4 font-medium text-xs">Total</th>
                </tr>
              </thead>
              <tbody>
                {searchMonthly.map((m) => (
                  <tr key={m.month} className={`border-t ${isDark ? "border-slate-700/50" : "border-gray-100"}`}>
                    <td className={`py-2 px-4 font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{m.month}</td>
                    <td className="py-2 px-4 text-right font-mono text-amber-400">{m.falken || "—"}</td>
                    <td className="py-2 px-4 text-right font-mono text-blue-400">{m.milestar || "—"}</td>
                    <td className={`py-2 px-4 text-right font-mono font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{m.total || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Search mode: matching ingested records (monthly totals card shown above) */}
      {debouncedSearch.length >= 2 ? (
        <div className="space-y-3">
          {searchUploads && searchUploads.length > 0
            ? (searchUploads as any[]).map(renderSourceCard)
            : <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-400"}`}>No records matching your search</div>}
        </div>
      ) : (
        <>
          {/* Daily Submission Files — the deliverables to upload to the portal */}
          <div className="mb-3 flex items-end justify-between">
            <h3 className={`text-sm font-bold uppercase tracking-wider ${isDark ? "text-slate-300" : "text-gray-600"}`}>Daily Submission Files</h3>
            <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>one file per brand per day · download to submit</span>
          </div>
          {dailyByMonth.length === 0 ? (
            <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-400"}`}>No submission files yet</div>
          ) : (
            <div className="space-y-4">
              {dailyByMonth.map(({ month, days }) => {
                const open = !collapsedMonths.has(month);
                return (
                  <div key={month} className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-700" : "border-gray-200 shadow-sm"}`}>
                    <button
                      onClick={() => setCollapsedMonths(prev => { const n = new Set(prev); if (n.has(month)) n.delete(month); else n.add(month); return n; })}
                      className={`w-full flex items-center justify-between px-5 py-3 text-left ${isDark ? "bg-slate-800/80 hover:bg-slate-800" : "bg-gray-50 hover:bg-gray-100"}`}
                    >
                      <span className={`text-sm font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{monthLabel(month)}</span>
                      <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{open ? "▾" : "▸"} {days.length} day{days.length !== 1 ? "s" : ""}</span>
                    </button>
                    {open && (
                      <div className={`divide-y ${isDark ? "divide-slate-700/50" : "divide-gray-100"}`}>
                        {days.map(({ day, falken, milestar }) => (
                          <div key={day} className="flex items-center justify-between px-5 py-2.5">
                            <span className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{dayLabel(day)}</span>
                            <div className="flex items-center gap-2">
                              {falken
                                ? <a href={falken.downloadUrl} download={falken.fileName} className={`px-3 py-1 rounded-lg text-xs font-medium ${isDark ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}>Falken ↓</a>
                                : <span className={`px-3 py-1 text-xs ${isDark ? "text-slate-600" : "text-gray-300"}`}>Falken —</span>}
                              {milestar
                                ? <a href={milestar.downloadUrl} download={milestar.fileName} className={`px-3 py-1 rounded-lg text-xs font-medium ${isDark ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" : "bg-blue-100 text-blue-700 hover:bg-blue-200"}`}>Milestar ↓</a>
                                : <span className={`px-3 py-1 text-xs ${isDark ? "text-slate-600" : "text-gray-300"}`}>Milestar —</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Ingested source files — raw records, collapsed by default */}
          <div className="mt-6">
            <button
              onClick={() => setShowIngested(v => !v)}
              className={`text-sm font-medium ${isDark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"}`}
            >
              {showIngested ? "▾" : "▸"} Ingested source files ({convexUploads.length})
            </button>
            {showIngested && (
              <div className="space-y-3 mt-3">
                {convexUploads.length === 0
                  ? <div className={`text-center py-6 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>No ingested files</div>
                  : (convexUploads as any[]).map(renderSourceCard)}
              </div>
            )}
          </div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)}>
          <div className={`w-full max-w-sm rounded-xl border p-6 ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200 shadow-xl"}`} onClick={e => e.stopPropagation()}>
            <h3 className={`text-lg font-bold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
              Delete Upload Record?
            </h3>
            <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Are you sure you want to permanently delete the upload record for <strong className={isDark ? "text-white" : "text-gray-900"}>{confirmDeleteName}</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? "text-slate-300 hover:bg-slate-700" : "text-gray-600 hover:bg-gray-100"}`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!user) return;
                  await deleteUploadMut({ id: confirmDeleteId, requestingUserId: user._id });
                  setConfirmDeleteId(null);
                  setSelectedUploadId(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4: STATS
// ═══════════════════════════════════════════════════════════════════════════════

interface MonthData {
  key: string; // YYYY-MM
  label: string;
  falken: number;
  milestar: number;
  total: number;
}

function StatsTab({ isDark }: { isDark: boolean }) {
  const uploads = useQuery(api.dealerRebates.getUploads, {});
  const dealers = useQuery(api.dealerRebates.listDealers, { activeOnly: true });
  const statsData = useQuery(api.dealerRebates.getStats, {});

  // Task 6: per-dealer monthly totals panel state
  const [dealerSearch, setDealerSearch] = useState("");
  const [debouncedDealerSearch, setDebouncedDealerSearch] = useState("");
  const dealerSearchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleDealerSearch = (val: string) => {
    setDealerSearch(val);
    if (dealerSearchTimeout.current) clearTimeout(dealerSearchTimeout.current);
    dealerSearchTimeout.current = setTimeout(() => setDebouncedDealerSearch(val), 300);
  };
  const dealerMonthly = useQuery(api.dealerRebates.getDealerMonthlyTotals, { search: debouncedDealerSearch || undefined });

  const stats = useMemo(() => {
    if (!statsData) return null;

    const { monthMap, dealers: statsDealers } = statsData;

    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth(); // 0-based

    // Build last 12 months array from activity-month data
    const months: MonthData[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(thisYear, thisMonth - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const data = monthMap[key] || { falken: 0, milestar: 0 };
      months.push({
        key,
        label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        falken: data.falken,
        milestar: data.milestar,
        total: data.falken + data.milestar,
      });
    }

    const maxMonth = Math.max(...months.map(m => m.total), 1);

    // This month / last month
    const currentMonthKey = `${thisYear}-${String(thisMonth + 1).padStart(2, "0")}`;
    const cmData = monthMap[currentMonthKey] || { falken: 0, milestar: 0 };
    const lm = new Date(thisYear, thisMonth - 1, 1);
    const lastMonthKey = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, "0")}`;
    const lmData = monthMap[lastMonthKey] || { falken: 0, milestar: 0 };

    // Current year totals: sum months whose key starts with thisYear
    const cyFalken = months.filter(m => m.key.startsWith(String(thisYear))).reduce((s, m) => s + m.falken, 0);
    const cyMilestar = months.filter(m => m.key.startsWith(String(thisYear))).reduce((s, m) => s + m.milestar, 0);

    // Last year totals: sum ALL monthMap keys starting with (thisYear-1), not limited to the 12-month window
    const lastYearStr = String(thisYear - 1);
    const lyFalken = Object.entries(monthMap)
      .filter(([k]) => k.startsWith(lastYearStr))
      .reduce((s, [, v]) => s + v.falken, 0);
    const lyMilestar = Object.entries(monthMap)
      .filter(([k]) => k.startsWith(lastYearStr))
      .reduce((s, [, v]) => s + v.milestar, 0);

    // YoY to-date: sum monthMap entries for thisYear/lastYear where month number <= (thisMonth+1)
    const thisMonthNum = thisMonth + 1; // 1-based
    const cyToDate = Object.entries(monthMap)
      .filter(([k]) => k.startsWith(String(thisYear)) && parseInt(k.slice(5), 10) <= thisMonthNum)
      .reduce((s, [, v]) => s + v.falken + v.milestar, 0);
    const lyToDate = Object.entries(monthMap)
      .filter(([k]) => k.startsWith(lastYearStr) && parseInt(k.slice(5), 10) <= thisMonthNum)
      .reduce((s, [, v]) => s + v.falken + v.milestar, 0);

    const yoyGrowth = lyToDate > 0 ? ((cyToDate - lyToDate) / lyToDate * 100) : null;

    // Top 10 dealers by total net tires
    const topDealers = [...statsDealers]
      .map(d => ({ ...d, total: d.falken + d.milestar }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    return {
      months,
      maxMonth,
      currentMonth: { falken: cmData.falken, milestar: cmData.milestar, total: cmData.falken + cmData.milestar },
      lastMonth: { falken: lmData.falken, milestar: lmData.milestar, total: lmData.falken + lmData.milestar },
      currentYear: { falken: cyFalken, milestar: cyMilestar, total: cyFalken + cyMilestar },
      lastYear: { falken: lyFalken, milestar: lyMilestar, total: lyFalken + lyMilestar },
      yoyGrowth,
      cyToDate,
      lyToDate,
      topDealers,
      totalUploads: uploads?.length ?? 0,
    };
  }, [statsData, uploads]);

  if (!uploads || !dealers || !statsData) {
    return <div className={`text-center py-12 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading stats...</div>;
  }

  if (!stats) {
    return <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-400"}`}>No upload data yet. Process some OEA07V files to see stats.</div>;
  }

  const growthColor = (val: number | null) => {
    if (val === null) return isDark ? "text-slate-500" : "text-gray-400";
    return val >= 0 ? "text-green-400" : "text-red-400";
  };

  const growthArrow = (val: number | null) => {
    if (val === null) return "—";
    return val >= 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`;
  };

  const monthGrowth = stats.lastMonth.total > 0
    ? ((stats.currentMonth.total - stats.lastMonth.total) / stats.lastMonth.total * 100)
    : null;

  return (
    <div>
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
          <div className={`text-xs font-medium uppercase tracking-wider mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>This Month</div>
          <div className={`text-3xl font-mono font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{stats.currentMonth.total.toLocaleString()}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs font-bold ${growthColor(monthGrowth)}`}>{growthArrow(monthGrowth)}</span>
            <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>vs last month</span>
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
          <div className={`text-xs font-medium uppercase tracking-wider mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Year to Date</div>
          <div className={`text-3xl font-mono font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{stats.currentYear.total.toLocaleString()}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs font-bold ${growthColor(stats.yoyGrowth)}`}>{growthArrow(stats.yoyGrowth)}</span>
            <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>YoY</span>
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
          <div className={`text-xs font-medium uppercase tracking-wider mb-1 ${isDark ? "text-amber-400/70" : "text-amber-600"}`}>Falken YTD</div>
          <div className="text-3xl font-mono font-bold text-amber-400">{stats.currentYear.falken.toLocaleString()}</div>
          <div className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            {stats.lastYear.falken > 0
              ? `${stats.lastYear.falken.toLocaleString()} last year`
              : "No prior year data"}
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
          <div className={`text-xs font-medium uppercase tracking-wider mb-1 ${isDark ? "text-blue-400/70" : "text-blue-600"}`}>Milestar YTD</div>
          <div className="text-3xl font-mono font-bold text-blue-400">{stats.currentYear.milestar.toLocaleString()}</div>
          <div className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            {stats.lastYear.milestar > 0
              ? `${stats.lastYear.milestar.toLocaleString()} last year`
              : "No prior year data"}
          </div>
        </div>
      </div>

      {/* Monthly Chart */}
      <div className={`rounded-xl border p-6 mb-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
        <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 ${isDark ? "text-orange-400" : "text-orange-600"}`}>
          Monthly Volume (Last 12 Months)
        </h3>
        <div className="flex items-end gap-1.5 h-48">
          {stats.months.map(m => {
            const falkenH = stats.maxMonth > 0 ? (m.falken / stats.maxMonth * 100) : 0;
            const milestarH = stats.maxMonth > 0 ? (m.milestar / stats.maxMonth * 100) : 0;
            return (
              <div key={m.key} className="flex-1 flex flex-col items-center gap-1 group relative">
                <div className="w-full flex flex-col justify-end h-40">
                  {m.total > 0 ? (
                    <>
                      <div
                        className="w-full rounded-t bg-amber-500/80 transition-all"
                        style={{ height: `${falkenH}%`, minHeight: falkenH > 0 ? 2 : 0 }}
                      />
                      <div
                        className="w-full rounded-b bg-blue-500/80 transition-all"
                        style={{ height: `${milestarH}%`, minHeight: milestarH > 0 ? 2 : 0 }}
                      />
                    </>
                  ) : (
                    <div className={`w-full h-0.5 rounded ${isDark ? "bg-slate-700" : "bg-gray-200"}`} />
                  )}
                </div>
                <span className={`text-[9px] font-mono ${isDark ? "text-slate-500" : "text-gray-400"}`}>{m.label}</span>
                {/* Tooltip */}
                <div className={`absolute bottom-full mb-2 hidden group-hover:block z-10 px-2 py-1 rounded text-[10px] whitespace-nowrap ${isDark ? "bg-slate-700 text-white" : "bg-gray-800 text-white"}`}>
                  <div className="font-bold">{m.total} tires</div>
                  <div className="text-amber-400">Falken: {m.falken}</div>
                  <div className="text-blue-400">Milestar: {m.milestar}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-amber-500/80" />
            <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Falken</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-blue-500/80" />
            <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Milestar</span>
          </div>
        </div>
      </div>

      {/* Monthly Breakdown Table + Top Dealers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-700" : "border-gray-200 shadow-sm"}`}>
          <div className={`px-5 py-3 border-b ${isDark ? "bg-slate-800/80 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
            <h3 className={`text-sm font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Monthly Breakdown</h3>
          </div>
          <div className="overflow-y-auto max-h-80">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? "text-slate-400" : "text-gray-500"}>
                  <th className="text-left py-2 px-4 font-medium text-xs">Month</th>
                  <th className="text-right py-2 px-4 font-medium text-xs">Falken</th>
                  <th className="text-right py-2 px-4 font-medium text-xs">Milestar</th>
                  <th className="text-right py-2 px-4 font-medium text-xs">Total</th>
                </tr>
              </thead>
              <tbody>
                {[...stats.months].reverse().map(m => (
                  <tr key={m.key} className={`border-t ${isDark ? "border-slate-700/50" : "border-gray-100"}`}>
                    <td className={`py-2 px-4 font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{m.label}</td>
                    <td className="py-2 px-4 text-right font-mono text-amber-400">{m.falken || "—"}</td>
                    <td className="py-2 px-4 text-right font-mono text-blue-400">{m.milestar || "—"}</td>
                    <td className={`py-2 px-4 text-right font-mono font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{m.total || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-700" : "border-gray-200 shadow-sm"}`}>
          <div className={`px-5 py-3 border-b ${isDark ? "bg-slate-800/80 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
            <h3 className={`text-sm font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Top 10 Dealers by Volume</h3>
          </div>
          <div className="overflow-y-auto max-h-80">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? "text-slate-400" : "text-gray-500"}>
                  <th className="text-left py-2 px-4 font-medium text-xs">#</th>
                  <th className="text-left py-2 px-4 font-medium text-xs">Dealer</th>
                  <th className="text-right py-2 px-4 font-medium text-xs">Tires</th>
                </tr>
              </thead>
              <tbody>
                {stats.topDealers.map((d, i) => {
                  const maxVol = stats.topDealers[0]?.total || 1;
                  return (
                    <tr key={d.name} className={`border-t ${isDark ? "border-slate-700/50" : "border-gray-100"}`}>
                      <td className={`py-2 px-4 font-mono text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{i + 1}</td>
                      <td className="py-2 px-4">
                        <div className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}>{d.name}</div>
                        <div className="flex gap-2 mt-0.5">
                          {d.falken > 0 && <span className="text-[10px] text-amber-400">{d.falken} FAL</span>}
                          {d.milestar > 0 && <span className="text-[10px] text-blue-400">{d.milestar} MIL</span>}
                        </div>
                      </td>
                      <td className="py-2 px-4 text-right">
                        <div className={`font-mono font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{d.total}</div>
                        <div className="mt-1 h-1.5 rounded-full overflow-hidden bg-slate-700/30" style={{ width: 60 }}>
                          <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-blue-500" style={{ width: `${(d.total / maxVol * 100)}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {stats.topDealers.length === 0 && (
                  <tr><td colSpan={3} className={`py-8 text-center text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>No dealer data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Per-Dealer Monthly Totals Panel (Task 6) */}
      {(() => {
        // Compute the last 6 activity month keys
        const now = new Date();
        const sixMonthKeys: Array<{ key: string; label: string }> = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
          sixMonthKeys.push({ key, label });
        }

        // Sort dealerMonthly by total tires descending
        const sorted = dealerMonthly
          ? [...dealerMonthly]
              .map(d => {
                const total = Object.values(d.months).reduce((s, m) => s + m.falken + m.milestar, 0);
                return { ...d, _total: total };
              })
              .sort((a, b) => b._total - a._total)
          : null;

        return (
          <div className={`rounded-xl border overflow-hidden mb-6 ${isDark ? "border-slate-700" : "border-gray-200 shadow-sm"}`}>
            <div className={`px-5 py-3 border-b flex items-center gap-3 ${isDark ? "bg-slate-800/80 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
              <h3 className={`text-sm font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Per-Dealer Monthly Totals</h3>
              <input
                type="text"
                placeholder="Search dealer name or JMK…"
                value={dealerSearch}
                onChange={e => handleDealerSearch(e.target.value)}
                className={`flex-1 max-w-xs px-3 py-1.5 rounded-lg text-sm border ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"}`}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={isDark ? "text-slate-400 bg-slate-800/60" : "text-gray-500 bg-gray-50"}>
                    <th className="text-left py-2 px-4 font-medium text-xs whitespace-nowrap">Dealer</th>
                    {sixMonthKeys.map(({ key, label }) => (
                      <th key={key} className="text-right py-2 px-3 font-medium text-xs whitespace-nowrap">{label}</th>
                    ))}
                    <th className="text-right py-2 px-4 font-medium text-xs">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted && sorted.length > 0 ? sorted.map(d => (
                    <tr key={d.name} className={`border-t ${isDark ? "border-slate-700/50 hover:bg-slate-800/40" : "border-gray-100 hover:bg-gray-50"}`}>
                      <td className={`py-2 px-4 font-medium whitespace-nowrap ${isDark ? "text-white" : "text-gray-900"}`}>
                        <div>{d.name}</div>
                        {d.jmk && <div className={`text-[10px] font-mono ${isDark ? "text-slate-500" : "text-gray-400"}`}>{d.jmk}</div>}
                      </td>
                      {sixMonthKeys.map(({ key }) => {
                        const val = (d.months[key]?.falken ?? 0) + (d.months[key]?.milestar ?? 0);
                        return (
                          <td key={key} className={`py-2 px-3 text-right font-mono text-xs ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                            {val > 0 ? val : "—"}
                          </td>
                        );
                      })}
                      <td className={`py-2 px-4 text-right font-mono font-bold text-xs ${isDark ? "text-white" : "text-gray-900"}`}>
                        {d._total}
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={sixMonthKeys.length + 2} className={`py-8 text-center text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        {sorted === null ? "Loading…" : "No data"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* YoY Comparison */}
      <div className={`rounded-xl border p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
        <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 ${isDark ? "text-orange-400" : "text-orange-600"}`}>
          Year-over-Year Comparison
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <div className={`text-xs font-medium mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Combined</div>
            <div className="flex items-end gap-3">
              <div>
                <div className={`text-2xl font-mono font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{stats.cyToDate.toLocaleString()}</div>
                <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{new Date().getFullYear()} YTD</div>
              </div>
              <div>
                <div className={`text-lg font-mono ${isDark ? "text-slate-500" : "text-gray-400"}`}>{stats.lyToDate.toLocaleString()}</div>
                <div className={`text-xs ${isDark ? "text-slate-600" : "text-gray-300"}`}>{new Date().getFullYear() - 1} YTD</div>
              </div>
            </div>
            {stats.yoyGrowth !== null && (
              <div className={`mt-2 text-sm font-bold ${growthColor(stats.yoyGrowth)}`}>
                {growthArrow(stats.yoyGrowth)} YoY
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-medium mb-2 text-amber-400">Falken</div>
            <div className="flex items-end gap-3">
              <div>
                <div className="text-2xl font-mono font-bold text-amber-400">{stats.currentYear.falken.toLocaleString()}</div>
                <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{new Date().getFullYear()}</div>
              </div>
              <div>
                <div className={`text-lg font-mono ${isDark ? "text-slate-500" : "text-gray-400"}`}>{stats.lastYear.falken.toLocaleString()}</div>
                <div className={`text-xs ${isDark ? "text-slate-600" : "text-gray-300"}`}>{new Date().getFullYear() - 1}</div>
              </div>
            </div>
            {stats.lastYear.falken > 0 && (
              <div className={`mt-2 text-sm font-bold ${growthColor(((stats.currentYear.falken - stats.lastYear.falken) / stats.lastYear.falken * 100))}`}>
                {growthArrow(((stats.currentYear.falken - stats.lastYear.falken) / stats.lastYear.falken * 100))} YoY
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-medium mb-2 text-blue-400">Milestar</div>
            <div className="flex items-end gap-3">
              <div>
                <div className="text-2xl font-mono font-bold text-blue-400">{stats.currentYear.milestar.toLocaleString()}</div>
                <div className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{new Date().getFullYear()}</div>
              </div>
              <div>
                <div className={`text-lg font-mono ${isDark ? "text-slate-500" : "text-gray-400"}`}>{stats.lastYear.milestar.toLocaleString()}</div>
                <div className={`text-xs ${isDark ? "text-slate-600" : "text-gray-300"}`}>{new Date().getFullYear() - 1}</div>
              </div>
            </div>
            {stats.lastYear.milestar > 0 && (
              <div className={`mt-2 text-sm font-bold ${growthColor(((stats.currentYear.milestar - stats.lastYear.milestar) / stats.lastYear.milestar * 100))}`}>
                {growthArrow(((stats.currentYear.milestar - stats.lastYear.milestar) / stats.lastYear.milestar * 100))} YoY
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer stats */}
      <div className={`mt-4 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
        Based on {stats.totalUploads} upload{stats.totalUploads !== 1 ? "s" : ""} &middot; {dealers?.filter(d => d.isActive).length ?? 0} active dealers
      </div>
    </div>
  );
}
