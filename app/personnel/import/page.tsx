"use client";

import { useMemo, useState } from "react";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import { useAuth } from "@/app/auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import * as XLSX from "xlsx";

type FieldKey =
  | "firstName" | "lastName" | "hireDate" | "email" | "phone"
  | "position" | "department" | "employeeType" | "positionType"
  | "hourlyRate" | "status" | "terminationDate" | "terminationReason"
  | "notes" | "locationName";

// Personnel fields the importer can write. Order matters for the column-map UI.
const TARGET_FIELDS: { key: FieldKey; label: string; required?: boolean }[] = [
  { key: "firstName", label: "First Name", required: true },
  { key: "lastName", label: "Last Name", required: true },
  { key: "hireDate", label: "Hire Date (YYYY-MM-DD)", required: true },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "position", label: "Position / Job Title" },
  { key: "department", label: "Department" },
  { key: "employeeType", label: "Employee Type (full_time / part_time / seasonal)" },
  { key: "positionType", label: "Position Type (hourly / salaried / management)" },
  { key: "hourlyRate", label: "Hourly Rate ($)" },
  { key: "status", label: "Status (active / on_leave / terminated)" },
  { key: "terminationDate", label: "Termination Date" },
  { key: "terminationReason", label: "Termination Reason" },
  { key: "notes", label: "Notes" },
  { key: "locationName", label: "Location (by name, e.g. \"R20\")" },
];

// Header → field heuristics. Add common aliases here.
const HEADER_ALIASES: Record<string, FieldKey> = {
  "first name": "firstName", "firstname": "firstName", "given name": "firstName", "fname": "firstName",
  "last name": "lastName", "lastname": "lastName", "surname": "lastName", "lname": "lastName",
  "hire date": "hireDate", "hiredate": "hireDate", "start date": "hireDate", "date hired": "hireDate", "hire": "hireDate",
  "email": "email", "e-mail": "email", "email address": "email",
  "phone": "phone", "phone number": "phone", "mobile": "phone", "cell": "phone",
  "position": "position", "title": "position", "job title": "position", "role": "position",
  "department": "department", "dept": "department",
  "employee type": "employeeType", "type": "employeeType", "ft/pt": "employeeType",
  "position type": "positionType", "pay type": "positionType",
  "hourly rate": "hourlyRate", "rate": "hourlyRate", "wage": "hourlyRate", "pay": "hourlyRate", "pay rate": "hourlyRate",
  "status": "status", "employment status": "status",
  "termination date": "terminationDate", "term date": "terminationDate",
  "termination reason": "terminationReason", "term reason": "terminationReason", "reason": "terminationReason",
  "notes": "notes", "comments": "notes",
  "location": "locationName", "store": "locationName", "loc": "locationName", "branch": "locationName",
};

function autoMapHeader(header: string): FieldKey | "" {
  const norm = header.trim().toLowerCase();
  return HEADER_ALIASES[norm] || "";
}

// Excel serial date → "YYYY-MM-DD"
function excelSerialToISO(serial: number): string {
  // Excel epoch: 1899-12-30 (sheetjs uses 1900 system by default; 1900 leap-year quirk handled)
  const ms = (serial - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function normalizeDate(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return excelSerialToISO(v);
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (!s) return "";
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // MM/DD/YYYY or M/D/YY
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, mo, da, yr] = m;
    let y = parseInt(yr);
    if (y < 100) y += 2000;
    return `${y}-${String(parseInt(mo)).padStart(2, "0")}-${String(parseInt(da)).padStart(2, "0")}`;
  }
  return s;
}

function normalizeNumber(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return isNaN(n) ? undefined : n;
}

function normalizeString(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

interface ParsedRow {
  raw: Record<string, unknown>;     // raw cell values keyed by original header
  mapped: Record<string, unknown>;  // normalized values keyed by FieldKey
  matchKey: string;                 // for matching against existing personnel
  diagnostics: string[];            // per-row warnings (e.g. missing required field)
}

function PersonnelImportContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();

  const existingPersonnel = useQuery(api.personnel.list, {});
  const locations = useQuery(api.locations.list) || [];
  const bulkUpsert = useMutation(api.personnel.bulkUpsert);

  const [step, setStep] = useState<"upload" | "map" | "preview" | "done">("upload");
  const [fileName, setFileName] = useState<string>("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [workbookRaw, setWorkbookRaw] = useState<XLSX.WorkBook | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, FieldKey | "">>({});
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [result, setResult] = useState<{ inserted: number; updated: number; errors: { row: number; reason: string }[]; unknownLocations: string[] } | null>(null);

  // Existing personnel keyed for match lookup
  const existingByKey = useMemo(() => {
    const map = new Map<string, { firstName: string; lastName: string; hireDate: string; email: string }>();
    for (const p of existingPersonnel || []) {
      const k = `${p.firstName.trim().toLowerCase()}|${p.lastName.trim().toLowerCase()}|${p.hireDate.trim()}`;
      map.set(k, { firstName: p.firstName, lastName: p.lastName, hireDate: p.hireDate, email: p.email });
    }
    return map;
  }, [existingPersonnel]);

  const locationNamesLower = useMemo(
    () => new Set((locations || []).map(l => l.name.toLowerCase().trim())),
    [locations]
  );

  const handleFile = async (file: File) => {
    setError("");
    setResult(null);
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      setWorkbookRaw(wb);
      setFileName(file.name);
      setSheetNames(wb.SheetNames);
      setActiveSheet(wb.SheetNames[0] || "");
      loadSheet(wb, wb.SheetNames[0] || "");
      setStep("map");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read XLSX");
    } finally {
      setBusy(false);
    }
  };

  const loadSheet = (wb: XLSX.WorkBook, sheetName: string) => {
    if (!sheetName) return;
    const ws = wb.Sheets[sheetName];
    if (!ws) return;
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
    if (json.length === 0) {
      setHeaders([]);
      setRawRows([]);
      setColumnMap({});
      return;
    }
    // Collect headers from the first non-empty row, preserving original order.
    const hdrSet = new Set<string>();
    for (const row of json) {
      for (const k of Object.keys(row)) hdrSet.add(k);
    }
    const hdrs = [...hdrSet];
    setHeaders(hdrs);
    setRawRows(json);
    const initial: Record<string, FieldKey | ""> = {};
    for (const h of hdrs) initial[h] = autoMapHeader(h);
    setColumnMap(initial);
  };

  const parsedRows: ParsedRow[] = useMemo(() => {
    if (rawRows.length === 0) return [];
    const inverse: Partial<Record<FieldKey, string>> = {};
    for (const [header, field] of Object.entries(columnMap)) {
      if (field) inverse[field] = header;
    }
    return rawRows.map(raw => {
      const mapped: Record<string, unknown> = {};
      const diagnostics: string[] = [];
      for (const f of TARGET_FIELDS) {
        const header = inverse[f.key];
        if (!header) continue;
        const cell = raw[header];
        if (f.key === "hireDate" || f.key === "terminationDate") {
          const v = normalizeDate(cell);
          if (v) mapped[f.key] = v;
        } else if (f.key === "hourlyRate") {
          const n = normalizeNumber(cell);
          if (n !== undefined) mapped[f.key] = n;
        } else {
          const s = normalizeString(cell);
          if (s !== undefined) mapped[f.key] = s;
        }
      }
      for (const f of TARGET_FIELDS) {
        if (f.required && !mapped[f.key]) diagnostics.push(`Missing ${f.label}`);
      }
      if (mapped.locationName && !locationNamesLower.has(String(mapped.locationName).toLowerCase().trim())) {
        diagnostics.push(`Unknown location "${mapped.locationName}"`);
      }
      const matchKey = mapped.firstName && mapped.lastName && mapped.hireDate
        ? `${String(mapped.firstName).trim().toLowerCase()}|${String(mapped.lastName).trim().toLowerCase()}|${String(mapped.hireDate).trim()}`
        : "";
      return { raw, mapped, matchKey, diagnostics };
    });
  }, [rawRows, columnMap, locationNamesLower]);

  const stats = useMemo(() => {
    let willInsert = 0;
    let willUpdate = 0;
    let invalid = 0;
    for (const r of parsedRows) {
      if (r.diagnostics.length > 0 && r.diagnostics.some(d => d.startsWith("Missing"))) {
        invalid++;
      } else if (existingByKey.has(r.matchKey)) {
        willUpdate++;
      } else {
        willInsert++;
      }
    }
    return { willInsert, willUpdate, invalid, total: parsedRows.length };
  }, [parsedRows, existingByKey]);

  const submit = async () => {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const payload = parsedRows
        .filter(r => !r.diagnostics.some(d => d.startsWith("Missing")))
        .map(r => {
          const m = r.mapped;
          return {
            firstName: String(m.firstName),
            lastName: String(m.lastName),
            hireDate: String(m.hireDate),
            email: m.email !== undefined ? String(m.email) : undefined,
            phone: m.phone !== undefined ? String(m.phone) : undefined,
            position: m.position !== undefined ? String(m.position) : undefined,
            department: m.department !== undefined ? String(m.department) : undefined,
            employeeType: m.employeeType !== undefined ? String(m.employeeType) : undefined,
            positionType: m.positionType !== undefined ? String(m.positionType) : undefined,
            hourlyRate: typeof m.hourlyRate === "number" ? m.hourlyRate : undefined,
            status: m.status !== undefined ? String(m.status) : undefined,
            terminationDate: m.terminationDate !== undefined ? String(m.terminationDate) : undefined,
            terminationReason: m.terminationReason !== undefined ? String(m.terminationReason) : undefined,
            notes: m.notes !== undefined ? String(m.notes) : undefined,
            locationName: m.locationName !== undefined ? String(m.locationName) : undefined,
          };
        });
      const res = await bulkUpsert({
        requestingUserId: user._id as Id<"users">,
        employees: payload,
      });
      setResult(res);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upsert failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setFileName("");
    setSheetNames([]);
    setActiveSheet("");
    setWorkbookRaw(null);
    setHeaders([]);
    setColumnMap({});
    setRawRows([]);
    setError("");
    setResult(null);
  };

  const cardClass = `rounded-2xl border p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"} shadow-sm`;

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className={`sticky top-0 z-10 backdrop-blur-md border-b px-6 sm:px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/85 border-gray-200"}`}>
          <div className="flex items-center gap-3">
            <Link href="/personnel" className={`p-2 rounded-lg ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-semibold theme-text-primary tracking-tight">Personnel Import</h1>
              <p className="text-xs theme-text-tertiary">Upload an XLSX to sync personnel records. Matches by first + last name + hire date.</p>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-5">
          {error && <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-3">{error}</div>}

          {/* Step indicator */}
          <div className="flex items-center gap-1.5 text-xs">
            {["upload","map","preview","done"].map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className={`px-2.5 py-1 rounded-full font-medium ${step === s ? "bg-[#007AFF] text-white" : "theme-bg-secondary theme-text-tertiary"}`}>
                  {i + 1}. {s === "upload" ? "Upload" : s === "map" ? "Map columns" : s === "preview" ? "Preview" : "Done"}
                </span>
                {i < 3 && <span className="theme-text-muted">›</span>}
              </div>
            ))}
          </div>

          {step === "upload" && (
            <div className={cardClass}>
              <label
                htmlFor="xlsx-input"
                className={`block border-2 border-dashed rounded-xl p-12 text-center cursor-pointer ${
                  isDark ? "border-slate-700 hover:border-slate-600" : "border-gray-300 hover:border-gray-400"
                }`}
              >
                <svg className={`w-12 h-12 mx-auto mb-3 ${isDark ? "text-slate-600" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm theme-text-primary font-medium">Drop an XLSX file here, or click to choose</p>
                <p className="text-xs theme-text-muted mt-1">First row = column headers. Required columns: First Name, Last Name, Hire Date.</p>
                <input id="xlsx-input" type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </label>
              <div className={`mt-4 text-[11px] ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                <p>Tip: column headers like &ldquo;First Name&rdquo;, &ldquo;Hire Date&rdquo;, &ldquo;Position&rdquo;, &ldquo;Email&rdquo;, &ldquo;Location&rdquo; auto-map. You can override the mapping in the next step.</p>
              </div>
            </div>
          )}

          {step === "map" && workbookRaw && (
            <>
              <div className={cardClass}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm theme-text-primary font-medium">{fileName}</p>
                    <p className="text-xs theme-text-muted">{rawRows.length} rows · {headers.length} columns</p>
                  </div>
                  {sheetNames.length > 1 && (
                    <select
                      value={activeSheet}
                      onChange={(e) => { setActiveSheet(e.target.value); loadSheet(workbookRaw, e.target.value); }}
                      className={`px-3 py-1.5 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}
                    >
                      {sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                  <div className="flex gap-2">
                    <button onClick={reset} className="px-3 py-1.5 text-xs font-medium rounded-full theme-bg-secondary theme-text-secondary theme-bg-hover">
                      Choose different file
                    </button>
                    <button onClick={() => setStep("preview")} disabled={stats.willInsert + stats.willUpdate === 0}
                      className="px-4 py-1.5 text-xs font-medium rounded-full bg-[#007AFF] hover:bg-[#0063CC] text-white shadow-sm disabled:opacity-50">
                      Continue to preview →
                    </button>
                  </div>
                </div>

                <h3 className="text-xs font-semibold theme-text-tertiary uppercase tracking-wider mb-2">Column mapping</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {headers.map(h => (
                    <div key={h} className="flex items-center gap-2 p-2 theme-bg-secondary rounded-lg">
                      <span className="text-xs theme-text-primary font-medium min-w-0 flex-1 truncate" title={h}>{h}</span>
                      <span className="theme-text-muted text-xs">→</span>
                      <select
                        value={columnMap[h] || ""}
                        onChange={(e) => setColumnMap({ ...columnMap, [h]: e.target.value as FieldKey | "" })}
                        className={`text-xs px-2 py-1 rounded border ${isDark ? "bg-slate-900 border-slate-700 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                      >
                        <option value="">— ignore —</option>
                        {TARGET_FIELDS.map(f => (
                          <option key={f.key} value={f.key}>{f.label}{f.required ? " *" : ""}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] theme-text-muted mt-2">Required fields (*) must be mapped before previewing.</p>
              </div>

              <div className={cardClass}>
                <p className="text-xs font-semibold theme-text-tertiary uppercase tracking-wider mb-2">Status after mapping</p>
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div><p className="text-2xl font-semibold text-green-600">{stats.willInsert}</p><p className="text-xs theme-text-muted">to insert</p></div>
                  <div><p className="text-2xl font-semibold text-[#007AFF]">{stats.willUpdate}</p><p className="text-xs theme-text-muted">to update</p></div>
                  <div><p className="text-2xl font-semibold text-red-600">{stats.invalid}</p><p className="text-xs theme-text-muted">missing required</p></div>
                  <div><p className="text-2xl font-semibold theme-text-primary">{stats.total}</p><p className="text-xs theme-text-muted">total rows</p></div>
                </div>
              </div>
            </>
          )}

          {step === "preview" && (
            <>
              <div className={cardClass}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-sm font-semibold theme-text-primary">Preview</h2>
                    <p className="text-xs theme-text-muted">Review what will change. {stats.willInsert} insert · {stats.willUpdate} update · {stats.invalid} dropped (missing required fields)</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setStep("map")} className="px-3 py-1.5 text-xs font-medium rounded-full theme-bg-secondary theme-text-secondary theme-bg-hover">
                      ← Back
                    </button>
                    <button onClick={submit} disabled={busy || (stats.willInsert + stats.willUpdate === 0)}
                      className="px-5 py-1.5 text-xs font-medium rounded-full bg-[#007AFF] hover:bg-[#0063CC] text-white shadow-sm disabled:opacity-50">
                      {busy ? "Applying…" : `Apply ${stats.willInsert + stats.willUpdate} changes`}
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className={isDark ? "text-slate-400" : "text-gray-600"}>
                      <tr className="border-b theme-border-secondary">
                        <th className="text-left py-1.5 px-2">Action</th>
                        <th className="text-left py-1.5 px-2">Name</th>
                        <th className="text-left py-1.5 px-2">Hire date</th>
                        <th className="text-left py-1.5 px-2">Email</th>
                        <th className="text-left py-1.5 px-2">Position</th>
                        <th className="text-left py-1.5 px-2">Dept</th>
                        <th className="text-left py-1.5 px-2">Location</th>
                        <th className="text-left py-1.5 px-2">Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.slice(0, 200).map((r, i) => {
                        const missing = r.diagnostics.some(d => d.startsWith("Missing"));
                        const exists = existingByKey.has(r.matchKey);
                        const action = missing ? "dropped" : exists ? "update" : "insert";
                        const actionColor = missing ? "text-red-600 bg-red-50" : exists ? "text-[#007AFF] bg-[#007AFF]/10" : "text-green-700 bg-green-50";
                        return (
                          <tr key={i} className="border-b theme-border-secondary">
                            <td className="py-1.5 px-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${actionColor}`}>{action}</span></td>
                            <td className="py-1.5 px-2 theme-text-primary">{String(r.mapped.firstName || "")} {String(r.mapped.lastName || "")}</td>
                            <td className="py-1.5 px-2 theme-text-secondary">{String(r.mapped.hireDate || "")}</td>
                            <td className="py-1.5 px-2 theme-text-secondary truncate max-w-[160px]" title={String(r.mapped.email || "")}>{String(r.mapped.email || "")}</td>
                            <td className="py-1.5 px-2 theme-text-secondary">{String(r.mapped.position || "")}</td>
                            <td className="py-1.5 px-2 theme-text-secondary">{String(r.mapped.department || "")}</td>
                            <td className="py-1.5 px-2 theme-text-secondary">{String(r.mapped.locationName || "")}</td>
                            <td className="py-1.5 px-2 text-amber-600 text-[11px]">{r.diagnostics.join("; ")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {parsedRows.length > 200 && (
                    <p className="text-[11px] theme-text-muted text-center py-2">Showing first 200 of {parsedRows.length} rows.</p>
                  )}
                </div>
              </div>
            </>
          )}

          {step === "done" && result && (
            <div className={cardClass}>
              <div className="text-center py-6">
                <div className="w-14 h-14 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-3">
                  <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold theme-text-primary">Import complete</h2>
                <p className="text-sm theme-text-secondary mt-1">
                  <strong>{result.inserted}</strong> inserted · <strong>{result.updated}</strong> updated
                </p>
              </div>
              {result.errors.length > 0 && (
                <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                  <p className="font-semibold mb-1">Server errors ({result.errors.length}):</p>
                  <ul className="list-disc pl-5">{result.errors.slice(0, 20).map((e, i) => <li key={i}>Row {e.row + 1}: {e.reason}</li>)}</ul>
                </div>
              )}
              {result.unknownLocations.length > 0 && (
                <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                  <p className="font-semibold mb-1">Unknown locations (left as null):</p>
                  <ul className="list-disc pl-5">{result.unknownLocations.map(l => <li key={l}>{l}</li>)}</ul>
                </div>
              )}
              <div className="flex justify-center gap-2 mt-5">
                <button onClick={reset} className="px-4 py-2 text-sm font-medium rounded-full theme-bg-secondary theme-text-primary theme-bg-hover">
                  Upload another
                </button>
                <Link href="/personnel" className="px-5 py-2 text-sm font-medium rounded-full bg-[#007AFF] hover:bg-[#0063CC] text-white shadow-sm">
                  Back to personnel
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function PersonnelImportPage() {
  return (
    <Protected minTier={4}>
      <PersonnelImportContent />
    </Protected>
  );
}
