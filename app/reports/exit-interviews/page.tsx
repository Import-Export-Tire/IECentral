"use client";

import { useMemo, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { buildExecutivePdf, type Quote, type ExecutiveBrief } from "./executivePdf";
import { Id } from "@/convex/_generated/dataModel";
import Protected from "@/app/protected";
import { useAuth } from "@/app/auth-context";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";

interface InterviewRow {
  _id: Id<"exitInterviews">;
  personnelId: Id<"personnel">;
  personnelName: string;
  department?: string;
  position?: string;
  hireDate?: string;
  terminationDate: string;
  terminationReason?: string;
  status: string;
  leavingCategory?: string;
  responses?: {
    satisfactionRating?: number;
    managementRating?: number;
    workLifeBalanceRating?: number;
    compensationRating?: number;
    growthOpportunityRating?: number;
    wouldReturn?: string;
    wouldRecommend?: string;
    whatLikedMost?: string;
    whatCouldImprove?: string;
    additionalComments?: string;
    primaryReason?: string;
  };
  rehireEligible?: boolean;
  severancePaid?: boolean;
  finalPaycheckDate?: string;
  conductedByName?: string;
  completedAt?: number;
  hrNotes?: string;
  interviewerNotes?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  voluntary_quit:    "Voluntary quit",
  no_call_no_show:   "No-call no-show",
  attendance:        "Attendance",
  performance:       "Performance",
  involuntary:       "Involuntary (other)",
  layoff:            "Layoff / reorg",
  other:             "Other",
};

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoMonthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function tenureDays(hire?: string, term?: string): number | null {
  if (!hire || !term) return null;
  const h = new Date(hire + "T00:00:00").getTime();
  const t = new Date(term + "T00:00:00").getTime();
  if (isNaN(h) || isNaN(t)) return null;
  return Math.floor((t - h) / 86400000);
}
function tenureStr(days: number | null): string {
  if (days == null) return "—";
  if (days < 90) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365.25).toFixed(1)}yr`;
}
function avg(arr: (number | undefined)[]): number | null {
  const nums = arr.filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function ExitInterviewsReportContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();

  const generateExecutiveBrief = useAction(api.exitInterviews.generateExecutiveBrief);

  const interviewsRaw = useQuery(api.exitInterviews.list, {}) as InterviewRow[] | undefined;
  const personnel = useQuery(api.personnel.listAll, {});
  const locations = useQuery(api.locations.list);

  const [startDate, setStartDate] = useState<string>(isoMonthsAgo(6));
  const [endDate, setEndDate] = useState<string>(isoToday());
  const [locationId, setLocationId] = useState<string>("");
  const [personId, setPersonId] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [briefStatus, setBriefStatus] = useState<string | null>(null);

  const locById = useMemo(() => new Map((locations || []).map(l => [l._id, l.name])), [locations]);
  const locOfPersonnel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of personnel || []) m.set(p._id, p.locationId ? (locById.get(p.locationId) || "—") : "—");
    return m;
  }, [personnel, locById]);

  const rows = useMemo(() => {
    const list = interviewsRaw || [];
    return list
      .filter(i => i.status !== "reversed")
      .filter(i => i.terminationDate >= startDate && i.terminationDate <= endDate)
      .filter(i => !locationId || locOfPersonnel.get(i.personnelId) === locById.get(locationId as Id<"locations">))
      .filter(i => !personId || i.personnelId === personId)
      .sort((a, b) => b.terminationDate.localeCompare(a.terminationDate));
  }, [interviewsRaw, startDate, endDate, locationId, personId, locOfPersonnel, locById]);

  const stats = useMemo(() => {
    const total = rows.length;
    const completed = rows.filter(r => r.status === "completed").length;
    const conductRate = total > 0 ? (completed / total) * 100 : 0;
    const avgSat = avg(rows.map(r => r.responses?.satisfactionRating));
    const avgMgr = avg(rows.map(r => r.responses?.managementRating));
    const avgComp = avg(rows.map(r => r.responses?.compensationRating));
    const avgWlb = avg(rows.map(r => r.responses?.workLifeBalanceRating));
    const avgGrowth = avg(rows.map(r => r.responses?.growthOpportunityRating));
    const earlyExit = rows.filter(r => {
      const d = tenureDays(r.hireDate, r.terminationDate);
      return d != null && d < 90;
    }).length;
    return { total, completed, conductRate, avgSat, avgMgr, avgComp, avgWlb, avgGrowth, earlyExit };
  }, [rows]);

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const cat = r.leavingCategory || "(uncategorized)";
      m.set(cat, (m.get(cat) || 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const byLocation = useMemo(() => {
    const m = new Map<string, { count: number; satSum: number; satN: number; mgrSum: number; mgrN: number }>();
    for (const r of rows) {
      const loc = locOfPersonnel.get(r.personnelId) || "—";
      const cur = m.get(loc) || { count: 0, satSum: 0, satN: 0, mgrSum: 0, mgrN: 0 };
      cur.count++;
      if (typeof r.responses?.satisfactionRating === "number") { cur.satSum += r.responses.satisfactionRating; cur.satN++; }
      if (typeof r.responses?.managementRating === "number") { cur.mgrSum += r.responses.managementRating; cur.mgrN++; }
      m.set(loc, cur);
    }
    return [...m]
      .map(([loc, v]) => ({ loc, count: v.count, avgSat: v.satN ? v.satSum / v.satN : null, avgMgr: v.mgrN ? v.mgrSum / v.mgrN : null }))
      .sort((a, b) => b.count - a.count);
  }, [rows, locOfPersonnel]);

  // Roll up the fine-grained survey answer, falling back to the coarse category
  // when the employee never filled the survey out. Without the fallback the
  // chart silently under-counts exactly the people who didn't respond.
  const byReason = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const raw = r.responses?.primaryReason?.trim();
      const label = raw || CATEGORY_LABELS[r.leavingCategory || ""] || r.leavingCategory || "Not recorded";
      m.set(label, (m.get(label) || 0) + 1);
    }
    return [...m]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const ym = r.terminationDate.slice(0, 7);
      m.set(ym, (m.get(ym) || 0) + 1);
    }
    return [...m]
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [rows]);

  // Equal-length window immediately before startDate. Reads interviewsRaw, not
  // rows — rows is already filtered to the selected range.
  const priorPeriodCount = useMemo(() => {
    const start = new Date(startDate + "T00:00:00").getTime();
    const end = new Date(endDate + "T00:00:00").getTime();
    if (isNaN(start) || isNaN(end) || end < start) return 0;
    const span = end - start;
    const priorStart = new Date(start - span - 86400000);
    const priorEnd = new Date(start - 86400000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const lo = iso(priorStart);
    const hi = iso(priorEnd);
    return (interviewsRaw || [])
      .filter(i => i.status !== "reversed")
      .filter(i => !locationId || locOfPersonnel.get(i.personnelId) === locById.get(locationId as Id<"locations">))
      .filter(i => i.terminationDate >= lo && i.terminationDate <= hi)
      .length;
  }, [interviewsRaw, startDate, endDate, locationId, locOfPersonnel, locById]);

  const handleExecutivePdf = async () => {
    if (rows.length === 0 || !user) return;
    setGenerating(true);
    setBriefStatus("Writing summary…");
    try {
      let brief: ExecutiveBrief | null = null;
      try {
        const result = await generateExecutiveBrief({
          requestingUserId: user._id as Id<"users">,
          startDate,
          endDate,
        });
        if (result.ok) {
          brief = {
            narrative: result.narrative,
            themes: result.themes,
            actions: result.actions,
            sentiment: result.sentiment,
          };
        } else {
          console.warn("Executive brief unavailable:", result.reason);
        }
      } catch (err) {
        // Never let the AI path take the PDF down with it.
        console.warn("Executive brief call failed:", err);
      }

      setBriefStatus("Building PDF…");

      const quotes: Quote[] = rows
        .filter(r => (r.responses?.whatCouldImprove || "").trim().length > 0)
        .slice(0, 8)
        .map(r => ({
          department: r.department || "—",
          tenure: tenureStr(tenureDays(r.hireDate, r.terminationDate)),
          text: r.responses!.whatCouldImprove!,
        }));

      await buildExecutivePdf({
        startDate,
        endDate,
        locLabel: locationId ? (locById.get(locationId as Id<"locations">) || "Location") : "All locations",
        stats: {
          total: stats.total,
          completed: stats.completed,
          earlyExit: stats.earlyExit,
          avgSat: stats.avgSat,
        },
        byMonth,
        priorPeriodCount,
        byReason,
        byLocation: byLocation.map(l => ({ loc: l.loc, count: l.count })),
        brief,
        quotes,
      });
    } finally {
      setGenerating(false);
      setBriefStatus(null);
    }
  };

  const handlePeriodPdf = async () => {
    if (rows.length === 0) return;
    setGenerating(true);
    try {
      const { jsPDF } = await import("jspdf");
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = (autoTableModule.default || autoTableModule) as typeof import("jspdf-autotable").default;

      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const now = new Date();
      const ranStr = now.toLocaleString();

      const locLabel = locationId ? (locById.get(locationId as Id<"locations">) || "Location") : "All locations";

      doc.setFontSize(14); doc.setFont("helvetica", "bold");
      doc.text("Exit Interview Summary", pageWidth / 2, 40, { align: "center" });
      doc.setFontSize(9); doc.setFont("helvetica", "normal");
      doc.text(`${startDate} → ${endDate}  ·  ${locLabel}  ·  ${rows.length} interviews  ·  Generated ${ranStr}`, pageWidth / 2, 58, { align: "center" });

      // Summary block
      doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text("Summary", 36, 84);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      let y = 100;
      const summaryLines = [
        `Total interviews: ${stats.total}    Completed: ${stats.completed} (${stats.conductRate.toFixed(0)}%)`,
        `Early exits (<90d): ${stats.earlyExit}`,
        `Avg ratings (1-5): satisfaction=${stats.avgSat?.toFixed(1) ?? "—"}, mgmt=${stats.avgMgr?.toFixed(1) ?? "—"}, comp=${stats.avgComp?.toFixed(1) ?? "—"}, work/life=${stats.avgWlb?.toFixed(1) ?? "—"}, growth=${stats.avgGrowth?.toFixed(1) ?? "—"}`,
      ];
      for (const line of summaryLines) { doc.text(line, 36, y); y += 14; }

      // Reasons block
      doc.setFont("helvetica", "bold"); doc.text("Top reasons", 36, y + 8); y += 22;
      doc.setFont("helvetica", "normal");
      for (const [cat, n] of byCategory.slice(0, 6)) {
        doc.text(`${(CATEGORY_LABELS[cat] || cat).padEnd(22, " ")}  ${n}`, 36, y);
        y += 14;
      }

      // By location
      autoTable(doc, {
        startY: y + 10,
        head: [["Location", "Interviews", "Avg satisfaction", "Avg mgmt"]],
        body: byLocation.map(l => [l.loc, String(l.count), l.avgSat?.toFixed(1) ?? "—", l.avgMgr?.toFixed(1) ?? "—"]),
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "left" },
        margin: { left: 36, right: 36 },
      });

      // Per-interview detail table
      const afterY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 60;
      autoTable(doc, {
        startY: afterY + 16,
        head: [["Name", "Termed", "Tenure", "Reason", "Category", "Sat", "Mgmt"]],
        body: rows.map(r => [
          r.personnelName,
          r.terminationDate,
          tenureStr(tenureDays(r.hireDate, r.terminationDate)),
          (r.terminationReason || "").slice(0, 40),
          CATEGORY_LABELS[r.leavingCategory || ""] || r.leavingCategory || "—",
          r.responses?.satisfactionRating?.toFixed(0) ?? "—",
          r.responses?.managementRating?.toFixed(0) ?? "—",
        ]),
        styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "left" },
        margin: { left: 36, right: 36, bottom: 50 },
        columnStyles: { 0: { cellWidth: 100, fontStyle: "bold" }, 1: { cellWidth: 56 }, 2: { cellWidth: 40 }, 3: { cellWidth: 130 }, 4: { cellWidth: 70 }, 5: { cellWidth: 28 }, 6: { cellWidth: 28 } },
      });

      const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 36, pageHeight - 24, { align: "right" });
      }
      doc.save(`exit_interviews_${startDate}_to_${endDate}.pdf`);
    } finally {
      setGenerating(false);
    }
  };

  const handlePersonPdf = async () => {
    const r = rows.find(x => x.personnelId === personId);
    if (!r) return;
    setGenerating(true);
    try {
      const { jsPDF } = await import("jspdf");
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = (autoTableModule.default || autoTableModule) as typeof import("jspdf-autotable").default;
      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      doc.setFontSize(15); doc.setFont("helvetica", "bold");
      doc.text("Exit Interview", pageWidth / 2, 40, { align: "center" });
      doc.setFontSize(11); doc.setFont("helvetica", "normal");
      doc.text(r.personnelName, pageWidth / 2, 60, { align: "center" });

      let y = 96;
      const writeRow = (label: string, value: string) => {
        doc.setFont("helvetica", "bold"); doc.text(label + ":", 36, y);
        doc.setFont("helvetica", "normal");
        const wrapped = doc.splitTextToSize(value || "—", pageWidth - 36 - 150);
        doc.text(wrapped, 150, y);
        y += Math.max(14, wrapped.length * 12) + 4;
      };
      writeRow("Position", r.position || "—");
      writeRow("Department", r.department || "—");
      writeRow("Location", locOfPersonnel.get(r.personnelId) || "—");
      writeRow("Hire date", r.hireDate || "—");
      writeRow("Termination date", r.terminationDate);
      writeRow("Tenure", tenureStr(tenureDays(r.hireDate, r.terminationDate)));
      writeRow("Termination reason", r.terminationReason || "—");
      writeRow("Category", CATEGORY_LABELS[r.leavingCategory || ""] || r.leavingCategory || "—");
      writeRow("Rehire eligible", r.rehireEligible == null ? "—" : r.rehireEligible ? "Yes" : "No");
      writeRow("Severance paid", r.severancePaid == null ? "—" : r.severancePaid ? "Yes" : "No");
      writeRow("Final paycheck", r.finalPaycheckDate || "—");

      y += 6;
      doc.setFont("helvetica", "bold"); doc.text("Ratings", 36, y); y += 16;
      doc.setFont("helvetica", "normal");
      autoTable(doc, {
        startY: y,
        head: [["Question", "Rating (1-5)"]],
        body: [
          ["Job satisfaction", r.responses?.satisfactionRating?.toString() ?? "—"],
          ["Management", r.responses?.managementRating?.toString() ?? "—"],
          ["Work / life balance", r.responses?.workLifeBalanceRating?.toString() ?? "—"],
          ["Compensation / benefits", r.responses?.compensationRating?.toString() ?? "—"],
          ["Growth opportunity", r.responses?.growthOpportunityRating?.toString() ?? "—"],
          ["Would return?", r.responses?.wouldReturn || "—"],
          ["Would recommend us?", r.responses?.wouldRecommend || "—"],
        ],
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold" },
        margin: { left: 36, right: 36 },
      });

      const afterY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
      let yy = afterY + 18;
      doc.setFont("helvetica", "bold"); doc.text("Open feedback", 36, yy); yy += 14;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      const writePara = (label: string, body: string) => {
        doc.setFont("helvetica", "bold"); doc.text(label, 36, yy); yy += 12;
        doc.setFont("helvetica", "normal");
        const wrapped = doc.splitTextToSize(body || "—", pageWidth - 72);
        doc.text(wrapped, 36, yy);
        yy += wrapped.length * 11 + 8;
      };
      writePara("What worked / liked", r.responses?.whatLikedMost || "—");
      writePara("What didn't work / improve", r.responses?.whatCouldImprove || "—");
      writePara("Suggestions / comments", r.responses?.additionalComments || "—");

      yy += 8;
      writePara("Interviewer notes", r.interviewerNotes || "—");
      writePara("HR notes (internal)", r.hrNotes || "—");

      doc.setFontSize(8);
      doc.text(`Generated ${new Date().toLocaleString()}  ·  Conducted by ${r.conductedByName || "—"}`, pageWidth - 36, pageHeight - 24, { align: "right" });
      doc.save(`exit_interview_${r.personnelName.replace(/\s+/g, "_")}_${r.terminationDate}.pdf`);
    } finally {
      setGenerating(false);
    }
  };

  const inputClass = `w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 ${
    isDark ? "bg-slate-900 border-slate-700 text-white" : "bg-white border-gray-300 text-gray-900"
  }`;
  const labelClass = `block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`;
  const cardClass = `rounded-2xl border p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"} shadow-sm`;

  const eligiblePersonnelForFilter = (personnel || [])
    .filter(p => p.status === "terminated")
    .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className={`sticky top-0 z-10 backdrop-blur-md border-b px-6 sm:px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/85 border-gray-200"}`}>
          <div className="flex items-center gap-3">
            <Link href="/reports" className={`p-2 rounded-lg ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <div>
              <h1 className="text-xl font-semibold theme-text-primary tracking-tight">Exit Interview Report</h1>
              <p className="text-xs theme-text-tertiary">Trends, ratings, and PDF export for sharing with leadership</p>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-5">
          {/* Filters */}
          <div className={cardClass}>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className={labelClass}>Start date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>End date</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Location</label>
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputClass}>
                  <option value="">All locations</option>
                  {(locations || []).map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Specific person</label>
                <select value={personId} onChange={(e) => setPersonId(e.target.value)} className={inputClass}>
                  <option value="">All people</option>
                  {eligiblePersonnelForFilter.map(p => (
                    <option key={p._id} value={p._id}>{p.lastName}, {p.firstName}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs theme-text-tertiary">
                {rows.length} interviews match · {stats.completed} completed ({stats.conductRate.toFixed(0)}% conduct rate)
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleExecutivePdf}
                  disabled={generating || rows.length === 0 || !user}
                  className="px-4 py-2 rounded-full text-xs font-semibold text-white bg-[#007AFF] hover:bg-[#0063CC] shadow-sm disabled:opacity-50"
                >
                  {generating && briefStatus ? briefStatus : "Executive PDF"}
                </button>
                <button
                  onClick={handlePeriodPdf}
                  disabled={generating || rows.length === 0}
                  className={`px-4 py-2 rounded-full text-xs font-semibold border shadow-sm disabled:opacity-50 ${
                    isDark
                      ? "border-slate-600 text-slate-200 hover:bg-slate-700"
                      : "border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {generating ? "Generating…" : "Period summary PDF"}
                </button>
                <button
                  onClick={handlePersonPdf}
                  disabled={generating || !personId || rows.length === 0}
                  className="px-4 py-2 rounded-full text-xs font-semibold text-[#007AFF] bg-[#007AFF]/10 hover:bg-[#007AFF]/20 disabled:opacity-50"
                  title={!personId ? "Pick a specific person to enable" : ""}
                >
                  Per-person PDF
                </button>
              </div>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className={cardClass}><p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Total exits</p><p className="text-2xl font-semibold theme-text-primary mt-1">{stats.total}</p></div>
            <div className={cardClass}><p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Early (&lt;90d)</p><p className="text-2xl font-semibold theme-text-primary mt-1">{stats.earlyExit}</p></div>
            <div className={cardClass}><p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Avg satisfaction</p><p className="text-2xl font-semibold theme-text-primary mt-1">{stats.avgSat?.toFixed(1) ?? "—"}</p></div>
            <div className={cardClass}><p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Avg management</p><p className="text-2xl font-semibold theme-text-primary mt-1">{stats.avgMgr?.toFixed(1) ?? "—"}</p></div>
            <div className={cardClass}><p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Conduct rate</p><p className="text-2xl font-semibold theme-text-primary mt-1">{stats.conductRate.toFixed(0)}%</p></div>
          </div>

          {/* Trends */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className={cardClass}>
              <h3 className="text-xs font-semibold theme-text-tertiary uppercase tracking-wider mb-3">Top reasons</h3>
              {byCategory.length === 0 ? <p className="text-sm theme-text-muted">No data</p> : (
                <div className="space-y-1.5">
                  {byCategory.slice(0, 8).map(([cat, n]) => {
                    const pct = (n / stats.total) * 100;
                    return (
                      <div key={cat}>
                        <div className="flex justify-between text-xs theme-text-secondary">
                          <span>{CATEGORY_LABELS[cat] || cat}</span>
                          <span className="tabular-nums">{n} · {pct.toFixed(0)}%</span>
                        </div>
                        <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? "bg-slate-700" : "bg-gray-200"}`}>
                          <div className="h-full bg-[#007AFF]" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className={cardClass}>
              <h3 className="text-xs font-semibold theme-text-tertiary uppercase tracking-wider mb-3">By location</h3>
              {byLocation.length === 0 ? <p className="text-sm theme-text-muted">No data</p> : (
                <table className="w-full text-sm">
                  <thead className={isDark ? "text-slate-400" : "text-gray-600"}>
                    <tr className="border-b theme-border-secondary">
                      <th className="text-left py-1.5 font-medium">Location</th>
                      <th className="text-right py-1.5 font-medium">Exits</th>
                      <th className="text-right py-1.5 font-medium">Sat avg</th>
                      <th className="text-right py-1.5 font-medium">Mgmt avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byLocation.map(l => (
                      <tr key={l.loc} className="border-b theme-border-secondary">
                        <td className="py-1.5 theme-text-primary">{l.loc}</td>
                        <td className="py-1.5 text-right theme-text-primary tabular-nums">{l.count}</td>
                        <td className="py-1.5 text-right theme-text-secondary tabular-nums">{l.avgSat?.toFixed(1) ?? "—"}</td>
                        <td className="py-1.5 text-right theme-text-secondary tabular-nums">{l.avgMgr?.toFixed(1) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Detail table */}
          <div className={cardClass}>
            <h2 className="text-sm font-semibold theme-text-primary mb-3">Interviews in period</h2>
            {rows.length === 0 ? (
              <p className="text-sm theme-text-muted py-6 text-center">No interviews match these filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={isDark ? "text-slate-400" : "text-gray-600"}>
                    <tr className="border-b theme-border-secondary">
                      <th className="text-left py-2 px-1 font-medium">Name</th>
                      <th className="text-left py-2 px-1 font-medium">Location</th>
                      <th className="text-left py-2 px-1 font-medium">Termed</th>
                      <th className="text-left py-2 px-1 font-medium">Tenure</th>
                      <th className="text-left py-2 px-1 font-medium">Category</th>
                      <th className="text-right py-2 px-1 font-medium">Sat</th>
                      <th className="text-right py-2 px-1 font-medium">Mgmt</th>
                      <th className="text-left py-2 px-1 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r._id} className="border-b theme-border-secondary">
                        <td className="py-1.5 px-1 theme-text-primary font-medium">{r.personnelName}</td>
                        <td className="py-1.5 px-1 theme-text-secondary">{locOfPersonnel.get(r.personnelId) || "—"}</td>
                        <td className="py-1.5 px-1 theme-text-tertiary tabular-nums">{r.terminationDate}</td>
                        <td className="py-1.5 px-1 theme-text-tertiary tabular-nums">{tenureStr(tenureDays(r.hireDate, r.terminationDate))}</td>
                        <td className="py-1.5 px-1 theme-text-secondary">{CATEGORY_LABELS[r.leavingCategory || ""] || r.leavingCategory || "—"}</td>
                        <td className="py-1.5 px-1 text-right theme-text-secondary tabular-nums">{r.responses?.satisfactionRating ?? "—"}</td>
                        <td className="py-1.5 px-1 text-right theme-text-secondary tabular-nums">{r.responses?.managementRating ?? "—"}</td>
                        <td className="py-1.5 px-1">
                          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${
                            r.status === "completed" ? "bg-green-100 text-green-700" :
                            r.status === "scheduled" ? "bg-blue-100 text-blue-700" :
                            "bg-amber-100 text-amber-700"
                          }`}>{r.status.replace(/_/g, " ")}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ExitInterviewsReportPage() {
  return (
    <Protected minTier={5}>
      <ExitInterviewsReportContent />
    </Protected>
  );
}
