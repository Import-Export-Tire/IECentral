"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceArea,
} from "recharts";

interface PersonnelRow {
  _id: string;
  firstName: string;
  lastName: string;
  hireDate?: string;
  terminationDate?: string;
  terminationReason?: string;
  status: string;
  locationId?: string;
  department?: string;
}

interface ExitInterviewRow {
  _id: string;
  personnelId: string;
  leavingCategory?: string;
  status: string;
}

const MS_PER_DAY = 86400_000;

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoMonthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return iso(d);
}
function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}
function monthRange(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}
// The `n` month keys (YYYY-MM) ending at and including `endMonthKey`.
function lastNMonthKeys(endMonthKey: string, n: number): string[] {
  const out: string[] = [];
  let [y, m] = endMonthKey.split("-").map(Number);
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m--;
    if (m < 1) { m = 12; y--; }
  }
  return out.reverse();
}
// Lexicographic upper bound for "any real date within month k" — used to test
// active headcount as of a month-end without per-month day-count math.
function monthEndBound(monthKey: string): string {
  return `${monthKey}-31`;
}
function tenureDays(hire?: string, term?: string): number | null {
  if (!hire || !term) return null;
  const h = new Date(hire + "T00:00:00").getTime();
  const t = new Date(term + "T00:00:00").getTime();
  if (isNaN(h) || isNaN(t)) return null;
  return Math.floor((t - h) / MS_PER_DAY);
}

const CATEGORY_LABELS: Record<string, string> = {
  voluntary_quit:   "Voluntary quit",
  no_call_no_show:  "No-call no-show",
  attendance:       "Attendance",
  performance:      "Performance",
  involuntary:      "Involuntary (other)",
  layoff:           "Layoff / reorg",
  other:            "Other",
};
const PALETTE = ["#007AFF","#34C759","#FF9500","#AF52DE","#FF3B30","#5AC8FA","#FFCC00","#FF2D55","#5856D6","#A2845E"];

function TurnoverDashboardContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const personnel = useQuery(api.personnel.listAll, {}) as PersonnelRow[] | undefined;
  const locations = useQuery(api.locations.list);
  const interviews = useQuery(api.exitInterviews.list, {}) as ExitInterviewRow[] | undefined;

  const [startDate, setStartDate] = useState<string>(isoMonthsAgo(11));
  const [endDate, setEndDate] = useState<string>(iso(new Date()));
  const [locationId, setLocationId] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  // "Hiring manager since" marker + rolling-turnover window (months).
  const [hmSince, setHmSince] = useState<string>("");
  const [rollWindow, setRollWindow] = useState<3 | 6 | 12>(3);

  const locById = useMemo(() => new Map<string, string>((locations || []).map(l => [String(l._id), l.name])), [locations]);

  // Cohort filter: by location if selected
  const filteredPersonnel = useMemo(() => {
    if (!personnel) return [];
    if (!locationId) return personnel;
    return personnel.filter(p => p.locationId === locationId);
  }, [personnel, locationId]);

  // ──── Aggregates within the selected date range ───────────────────────
  const inRange = (d?: string) => !!d && d >= startDate && d <= endDate;

  const hiresInRange = filteredPersonnel.filter(p => inRange(p.hireDate));
  const termsInRange = filteredPersonnel.filter(p => p.status === "terminated" && inRange(p.terminationDate));

  // Tenure buckets at termination
  const tenureBuckets = useMemo(() => {
    const b = { lt30: 0, lt90: 0, lt365: 0, lt3y: 0, ge3y: 0 };
    for (const t of termsInRange) {
      const d = tenureDays(t.hireDate, t.terminationDate);
      if (d == null) continue;
      if (d < 30)       b.lt30++;
      else if (d < 90)  b.lt90++;
      else if (d < 365) b.lt365++;
      else if (d < 1095) b.lt3y++;
      else b.ge3y++;
    }
    return b;
  }, [termsInRange]);

  // Hires-vs-terms by month line
  const months = monthRange(startDate.slice(0, 7), endDate.slice(0, 7));
  const monthlyHvT = useMemo(() => {
    const hireByMonth = new Map<string, number>();
    const termByMonth = new Map<string, number>();
    for (const p of hiresInRange) {
      const k = monthKey(p.hireDate!);
      hireByMonth.set(k, (hireByMonth.get(k) || 0) + 1);
    }
    for (const p of termsInRange) {
      const k = monthKey(p.terminationDate!);
      termByMonth.set(k, (termByMonth.get(k) || 0) + 1);
    }
    return months.map(m => ({
      month: m,
      label: `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m.split("-")[1]) - 1]} '${m.slice(2,4)}`,
      hires: hireByMonth.get(m) || 0,
      terms: termByMonth.get(m) || 0,
      net: (hireByMonth.get(m) || 0) - (termByMonth.get(m) || 0),
    }));
  }, [hiresInRange, termsInRange, months]);

  // ──── Rolling annualized turnover trend (the "under my tenure" story) ────
  // For each month M: terminations in the trailing `rollWindow` months ÷ average
  // active headcount over that window, annualized. Headcount at each month-end is
  // reconstructed from hire/termination dates (no schema change / backend query).
  const rollingTurnover = useMemo(() => {
    const annualMult = 12 / rollWindow;
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const activeAt = (k: string) => {
      const bound = monthEndBound(k);
      let n = 0;
      for (const p of filteredPersonnel) {
        if (p.hireDate && p.hireDate <= bound && (!p.terminationDate || p.terminationDate > bound)) n++;
      }
      return n;
    };
    return months.map(m => {
      const winKeys = lastNMonthKeys(m, rollWindow);
      const winSet = new Set(winKeys);
      let terms = 0;
      for (const p of filteredPersonnel) {
        if (p.status === "terminated" && p.terminationDate && winSet.has(monthKey(p.terminationDate))) terms++;
      }
      const heads = winKeys.map(activeAt);
      const avgHead = heads.reduce((a, b) => a + b, 0) / heads.length;
      const rate = avgHead > 0 ? (terms / avgHead) * annualMult * 100 : null;
      return {
        month: m,
        label: `${MONTHS[parseInt(m.split("-")[1]) - 1]} '${m.slice(2, 4)}`,
        rate: rate == null ? null : Math.round(rate * 10) / 10,
      };
    });
  }, [filteredPersonnel, months, rollWindow]);

  // Month the tenure marker falls in, and its chart label (for the reference line).
  const tenurePivot = hmSince ? monthKey(hmSince) : null;
  const tenureLabel = useMemo(() => {
    if (!tenurePivot) return null;
    return rollingTurnover.find(r => r.month === tenurePivot)?.label ?? null;
  }, [rollingTurnover, tenurePivot]);
  const lastRollLabel = rollingTurnover.length ? rollingTurnover[rollingTurnover.length - 1].label : null;

  // Average rolling turnover before vs after the tenure start.
  const beforeAfter = useMemo(() => {
    if (!tenurePivot) return null;
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const before = rollingTurnover.filter(r => r.month < tenurePivot && r.rate != null).map(r => r.rate as number);
    const after = rollingTurnover.filter(r => r.month >= tenurePivot && r.rate != null).map(r => r.rate as number);
    if (before.length === 0 || after.length === 0) return null;
    const b = avg(before), a = avg(after);
    return { before: b, after: a, delta: a - b };
  }, [rollingTurnover, tenurePivot]);

  // Per-location terms in period + avg leaver tenure + term rate
  const byLocation = useMemo(() => {
    const map = new Map<string, { active: number; terms: number; tenureSum: number; tenureN: number }>();
    for (const p of personnel || []) {
      if (locationId && p.locationId !== locationId) continue;
      const loc = p.locationId ? (locById.get(p.locationId) || "Unknown") : "(none)";
      const cur = map.get(loc) || { active: 0, terms: 0, tenureSum: 0, tenureN: 0 };
      if (p.status === "active") cur.active++;
      if (p.status === "terminated" && inRange(p.terminationDate)) {
        cur.terms++;
        const d = tenureDays(p.hireDate, p.terminationDate);
        if (d != null) { cur.tenureSum += d; cur.tenureN++; }
      }
      map.set(loc, cur);
    }
    return [...map].map(([loc, v]) => ({
      loc,
      active: v.active,
      terms: v.terms,
      total: v.active + v.terms,
      termRate: (v.active + v.terms) > 0 ? (v.terms / (v.active + v.terms)) * 100 : 0,
      avgTenureDays: v.tenureN > 0 ? v.tenureSum / v.tenureN : null,
    })).sort((a, b) => b.terms - a.terms);
  }, [personnel, locById, locationId, startDate, endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reasons (from exit interviews, joined by personnelId)
  const reasonCounts = useMemo(() => {
    if (!interviews) return [] as { category: string; label: string; count: number }[];
    const personnelIdsInScope = new Set(termsInRange.map(t => t._id));
    const ivs = interviews.filter(i => personnelIdsInScope.has(i.personnelId));
    const map = new Map<string, number>();
    for (const i of ivs) {
      const cat = i.leavingCategory || "(uncategorized)";
      map.set(cat, (map.get(cat) || 0) + 1);
    }
    return [...map]
      .map(([category, count]) => ({ category, label: CATEGORY_LABELS[category] || category, count }))
      .sort((a, b) => b.count - a.count);
  }, [interviews, termsInRange]);

  // Annualized turnover rate over the selected window
  const periodDays = Math.max(1, Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / MS_PER_DAY));
  const annualizedTurnover = useMemo(() => {
    const currentActive = (personnel || []).filter(p =>
      p.status === "active" && (!locationId || p.locationId === locationId)
    ).length;
    if (currentActive === 0) return 0;
    const terms = termsInRange.length;
    // Scale to 365 days
    return (terms / currentActive) * (365 / periodDays) * 100;
  }, [personnel, locationId, termsInRange.length, periodDays]);

  const avgLeaverTenureYears = useMemo(() => {
    const days = termsInRange
      .map(t => tenureDays(t.hireDate, t.terminationDate))
      .filter((d): d is number => d != null);
    if (days.length === 0) return null;
    return (days.reduce((s, v) => s + v, 0) / days.length) / 365.25;
  }, [termsInRange]);

  const earlyExitRate = useMemo(() => {
    if (termsInRange.length === 0) return 0;
    const early = termsInRange.filter(t => {
      const d = tenureDays(t.hireDate, t.terminationDate);
      return d != null && d < 90;
    }).length;
    return (early / termsInRange.length) * 100;
  }, [termsInRange]);

  const totalHires = hiresInRange.length;
  const totalTerms = termsInRange.length;
  const netChange = totalHires - totalTerms;

  const handlePdf = async () => {
    setGenerating(true);
    try {
      const { jsPDF } = await import("jspdf");
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = (autoTableModule.default || autoTableModule) as typeof import("jspdf-autotable").default;
      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const now = new Date();
      const locLabel = locationId ? (locById.get(locationId) || "Location") : "All locations";

      doc.setFontSize(14); doc.setFont("helvetica", "bold");
      doc.text("Turnover Report", pageWidth / 2, 40, { align: "center" });
      doc.setFontSize(9); doc.setFont("helvetica", "normal");
      doc.text(`${startDate} → ${endDate}   ·   ${locLabel}   ·   Generated ${now.toLocaleString()}`, pageWidth / 2, 58, { align: "center" });

      let y = 84;
      doc.setFont("helvetica", "bold"); doc.text("Headline", 36, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); y += 16;
      const headline = [
        `Hires: ${totalHires}    Terminations: ${totalTerms}    Net change: ${netChange >= 0 ? "+" : ""}${netChange}`,
        `Annualized turnover (vs current active): ${annualizedTurnover.toFixed(1)}%`,
        `Avg tenure of leavers: ${avgLeaverTenureYears != null ? avgLeaverTenureYears.toFixed(1) + " yr" : "—"}`,
        `Early exits (<90 days): ${earlyExitRate.toFixed(0)}% of terminations`,
      ];
      if (hmSince && beforeAfter) {
        headline.push(
          `Rolling ${rollWindow}-mo turnover under your tenure: ${beforeAfter.before.toFixed(1)}% → ${beforeAfter.after.toFixed(1)}% (${beforeAfter.delta <= 0 ? "down" : "up"} ${Math.abs(beforeAfter.delta).toFixed(1)} pts) since ${hmSince}`,
        );
      }
      for (const line of headline) { doc.text(line, 36, y); y += 14; }

      autoTable(doc, {
        startY: y + 10,
        head: [["Location", "Active", "Terms", "Total", "Term %", "Avg leaver tenure"]],
        body: byLocation.map(l => [
          l.loc,
          String(l.active),
          String(l.terms),
          String(l.total),
          `${l.termRate.toFixed(0)}%`,
          l.avgTenureDays != null ? `${(l.avgTenureDays / 365.25).toFixed(1)} yr` : "—",
        ]),
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold" },
        margin: { left: 36, right: 36 },
      });
      const afterY1 = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 60;

      autoTable(doc, {
        startY: afterY1 + 12,
        head: [["Tenure at termination", "Count"]],
        body: [
          ["Under 30 days", String(tenureBuckets.lt30)],
          ["30 – 90 days", String(tenureBuckets.lt90)],
          ["90 days – 1 yr", String(tenureBuckets.lt365)],
          ["1 – 3 yr", String(tenureBuckets.lt3y)],
          ["3 yr+", String(tenureBuckets.ge3y)],
        ],
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold" },
        margin: { left: 36, right: 36 },
      });
      const afterY2 = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? afterY1 + 60;

      if (reasonCounts.length > 0) {
        autoTable(doc, {
          startY: afterY2 + 12,
          head: [["Reason category", "Count", "% of period"]],
          body: reasonCounts.map(r => [r.label, String(r.count), `${((r.count / totalTerms) * 100).toFixed(0)}%`]),
          styles: { fontSize: 9, cellPadding: 4 },
          headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold" },
          margin: { left: 36, right: 36 },
        });
      }

      const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 36, pageHeight - 24, { align: "right" });
      }
      doc.save(`turnover_${startDate}_to_${endDate}.pdf`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className="sticky top-0 z-10 border-b px-4 sm:px-6 py-3 sm:py-4 backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/reports" className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5 flex-shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </Link>
              <div className="min-w-0">
                <h1 className="text-xl font-bold theme-text-primary">Turnover Dashboard</h1>
                <p className="text-xs mt-0.5 theme-text-tertiary">Hires vs terms, tenure curves, by-location term rates, reasons</p>
              </div>
            </div>
            <Button
              variant="primary"
              onClick={handlePdf}
              disabled={generating || totalTerms === 0}
            >
              {generating ? "Generating…" : "Period summary PDF"}
            </Button>
          </div>
        </header>

        <div className="px-4 sm:px-6 py-5 max-w-7xl mx-auto space-y-4">
          {/* Filters */}
          <Card>
            <SectionHeader label="Filters" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block ui-section-label mb-1">Start date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="theme-input w-full px-3 py-2" />
              </div>
              <div>
                <label className="block ui-section-label mb-1">End date</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="theme-input w-full px-3 py-2" />
              </div>
              <div>
                <label className="block ui-section-label mb-1">Location</label>
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="theme-input w-full px-3 py-2">
                  <option value="">All locations</option>
                  {(locations || []).map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block ui-section-label mb-1">Hiring manager since</label>
                <div className="flex gap-1.5">
                  <input type="date" value={hmSince} onChange={(e) => setHmSince(e.target.value)} className="theme-input w-full px-3 py-2" />
                  {hmSince && (
                    <Button variant="ghost" size="sm" onClick={() => setHmSince("")} title="Clear marker">Clear</Button>
                  )}
                </div>
                <p className="text-[11px] theme-text-tertiary mt-1">Marks your tenure on the turnover trend.</p>
              </div>
              <div className="flex items-end gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => { setStartDate(isoMonthsAgo(2)); setEndDate(iso(new Date())); }} className="flex-1">3 mo</Button>
                <Button variant="ghost" size="sm" onClick={() => { setStartDate(isoMonthsAgo(5)); setEndDate(iso(new Date())); }} className="flex-1">6 mo</Button>
                <Button variant="ghost" size="sm" onClick={() => { setStartDate(isoMonthsAgo(11)); setEndDate(iso(new Date())); }} className="flex-1">12 mo</Button>
              </div>
            </div>
          </Card>

          {/* Headline KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
              <p className="ui-section-label">Hires</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{totalHires}</p>
              <p className="text-[11px] theme-text-tertiary mt-0.5">in period</p>
            </Card>
            <Card>
              <p className="ui-section-label">Terms</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{totalTerms}</p>
              <p className="text-[11px] theme-text-tertiary mt-0.5">in period</p>
            </Card>
            <Card>
              <p className="ui-section-label">Net change</p>
              <p className={`text-2xl font-semibold mt-1 ${netChange >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {netChange >= 0 ? "+" : ""}{netChange}
              </p>
              <p className="text-[11px] theme-text-tertiary mt-0.5">hires − terms</p>
            </Card>
            <Card>
              <p className="ui-section-label">Annualized turnover</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{annualizedTurnover.toFixed(1)}%</p>
              <p className="text-[11px] theme-text-tertiary mt-0.5">vs current active</p>
            </Card>
            <Card>
              <p className="ui-section-label">Early exit rate</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{earlyExitRate.toFixed(0)}%</p>
              <p className="text-[11px] theme-text-tertiary mt-0.5">terms under 90 days</p>
            </Card>
          </div>

          {/* Turnover rate trend + your tenure */}
          <Card>
            <SectionHeader
              title="Turnover rate trend"
              actions={
                <div className="flex items-center p-1 rounded-lg bg-gray-100 dark:bg-slate-700">
                  {([3, 6, 12] as const).map((w) => (
                    <button
                      key={w}
                      onClick={() => setRollWindow(w)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        rollWindow === w
                          ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm"
                          : "text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-white"
                      }`}
                    >
                      {w} mo
                    </button>
                  ))}
                </div>
              }
            />

            {/* Before/after your tenure */}
            {hmSince && beforeAfter && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-xl p-3 text-center bg-[#f2f2f7] dark:bg-slate-700/50">
                  <p className="ui-section-label">Before you</p>
                  <p className="text-2xl font-semibold theme-text-primary mt-1">{beforeAfter.before.toFixed(1)}%</p>
                  <p className="text-[11px] theme-text-tertiary mt-0.5">avg rolling turnover</p>
                </div>
                <div className="rounded-xl p-3 text-center bg-[#f2f2f7] dark:bg-slate-700/50">
                  <p className="ui-section-label">Under your tenure</p>
                  <p className="text-2xl font-semibold theme-text-primary mt-1">{beforeAfter.after.toFixed(1)}%</p>
                  <p className="text-[11px] theme-text-tertiary mt-0.5">avg rolling turnover</p>
                </div>
                <div className={`rounded-xl p-3 text-center ${beforeAfter.delta <= 0 ? "ui-callout-green" : "ui-callout-red"}`}>
                  <p className="ui-section-label">Change</p>
                  <p className={`text-2xl font-semibold mt-1 ${beforeAfter.delta <= 0 ? "text-[#1f8f3d] dark:text-[#5fe08a]" : "text-[#c4271d] dark:text-[#ff8a82]"}`}>
                    {beforeAfter.delta <= 0 ? "▼" : "▲"} {Math.abs(beforeAfter.delta).toFixed(1)} pts
                  </p>
                  <p className="text-[11px] theme-text-tertiary mt-0.5">{beforeAfter.delta <= 0 ? "down since you took over" : "up since you took over"}</p>
                </div>
              </div>
            )}
            {hmSince && !beforeAfter && (
              <p className="text-xs theme-text-tertiary mb-3">
                Not enough turnover history on both sides of your start date within the selected range — widen the date range to compare before vs after.
              </p>
            )}

            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={rollingTurnover} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke={isDark ? "#334155" : "#E5E7EB"} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                <YAxis tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ background: isDark ? "#0F172A" : "#FFFFFF", border: `1px solid ${isDark ? "#334155" : "#E5E7EB"}`, borderRadius: 12 }}
                  formatter={(v) => [v == null ? "—" : `${v}%`, `${rollWindow}-mo turnover`]}
                />
                {tenureLabel && lastRollLabel && (
                  <ReferenceArea x1={tenureLabel} x2={lastRollLabel} fill="#34C759" fillOpacity={0.08} />
                )}
                {tenureLabel && (
                  <ReferenceLine
                    x={tenureLabel}
                    stroke={isDark ? "#5fe08a" : "#1f8f3d"}
                    strokeDasharray="4 3"
                    label={{ value: "You took over", position: "insideTopRight", fill: isDark ? "#5fe08a" : "#1f8f3d", fontSize: 11 }}
                  />
                )}
                <Line type="monotone" dataKey="rate" name="Turnover" stroke="#007AFF" strokeWidth={2} dot connectNulls />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[11px] theme-text-tertiary mt-2">
              Rolling {rollWindow}-month annualized turnover: terminations in the trailing {rollWindow} months ÷ average active headcount, ×{(12 / rollWindow).toFixed(0)}.
              {hmSince && tenureLabel && " Shaded region = your tenure."}
              {hmSince && !tenureLabel && " Your start date is outside the selected range — widen it to see the marker."}
            </p>
          </Card>

          {/* Hires vs terms chart */}
          <Card>
            <SectionHeader title="Hires vs terminations by month" />
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyHvT} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke={isDark ? "#334155" : "#E5E7EB"} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                <YAxis tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: isDark ? "#0F172A" : "#FFFFFF", border: `1px solid ${isDark ? "#334155" : "#E5E7EB"}`, borderRadius: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="hires" name="Hires" fill="#34C759" />
                <Bar dataKey="terms" name="Terminations" fill="#FF3B30" />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Tenure-at-termination + by-location */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <SectionHeader title="Tenure at termination" />
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={[
                    { bucket: "<30d", count: tenureBuckets.lt30 },
                    { bucket: "30-90d", count: tenureBuckets.lt90 },
                    { bucket: "90d-1yr", count: tenureBuckets.lt365 },
                    { bucket: "1-3yr", count: tenureBuckets.lt3y },
                    { bucket: "3yr+", count: tenureBuckets.ge3y },
                  ]}
                  margin={{ top: 8, right: 16, left: 8, bottom: 4 }}
                >
                  <CartesianGrid stroke={isDark ? "#334155" : "#E5E7EB"} strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                  <YAxis tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: isDark ? "#0F172A" : "#FFFFFF", border: `1px solid ${isDark ? "#334155" : "#E5E7EB"}`, borderRadius: 12 }} />
                  <Bar dataKey="count" fill="#FF9500" />
                </BarChart>
              </ResponsiveContainer>
              <p className="text-[11px] theme-text-tertiary mt-2">
                Median tenure of leavers: {avgLeaverTenureYears != null ? `${avgLeaverTenureYears.toFixed(1)} yr (mean)` : "—"}
              </p>
            </Card>
            <Card>
              <SectionHeader title="Reasons (from exit interviews)" />
              {reasonCounts.length === 0 ? (
                <p className="text-sm theme-text-tertiary py-6 text-center">No exit interview data for this period.</p>
              ) : (
                <div className="space-y-2">
                  {reasonCounts.map((r, i) => {
                    const pct = (r.count / totalTerms) * 100;
                    return (
                      <div key={r.category}>
                        <div className="flex justify-between text-xs theme-text-secondary">
                          <span>{r.label}</span>
                          <span className="tabular-nums">{r.count} · {pct.toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden bg-black/10 dark:bg-white/10">
                          <div className="h-full" style={{ width: `${pct}%`, background: PALETTE[i % PALETTE.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* Per-location table */}
          <Card padding="sm">
            <SectionHeader title="By location" />
            {byLocation.length === 0 ? (
              <p className="text-sm theme-text-tertiary py-6 text-center">No data.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b theme-border-secondary">
                      <th className="text-left py-2 px-2 font-semibold theme-text-tertiary">Location</th>
                      <th className="text-right py-2 px-2 font-semibold theme-text-tertiary">Active</th>
                      <th className="text-right py-2 px-2 font-semibold theme-text-tertiary">Terms in period</th>
                      <th className="text-right py-2 px-2 font-semibold theme-text-tertiary">Total ever</th>
                      <th className="text-right py-2 px-2 font-semibold theme-text-tertiary">Term %</th>
                      <th className="text-right py-2 px-2 font-semibold theme-text-tertiary">Avg leaver tenure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byLocation.map(l => (
                      <tr key={l.loc} className="border-b theme-border-secondary">
                        <td className="py-2 px-2 theme-text-primary font-medium">{l.loc}</td>
                        <td className="py-2 px-2 text-right theme-text-primary tabular-nums">{l.active}</td>
                        <td className="py-2 px-2 text-right theme-text-primary tabular-nums">{l.terms}</td>
                        <td className="py-2 px-2 text-right theme-text-secondary tabular-nums">{l.total}</td>
                        <td className="py-2 px-2 text-right theme-text-primary tabular-nums">{l.termRate.toFixed(0)}%</td>
                        <td className="py-2 px-2 text-right theme-text-secondary tabular-nums">
                          {l.avgTenureDays != null ? `${(l.avgTenureDays / 365.25).toFixed(1)} yr` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Net headcount over time (small) */}
          <Card>
            <SectionHeader title="Net change (hires − terms) per month" />
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthlyHvT} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke={isDark ? "#334155" : "#E5E7EB"} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                <YAxis tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: isDark ? "#0F172A" : "#FFFFFF", border: `1px solid ${isDark ? "#334155" : "#E5E7EB"}`, borderRadius: 12 }} />
                <Line type="monotone" dataKey="net" stroke="#007AFF" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <p className="text-[11px] theme-text-tertiary text-center pb-4">
            Source: personnel records + exit-interview data. terminationDate-based; historical pre-2026 dates may have been reset.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function TurnoverDashboardPage() {
  return (
    <Protected minTier={5}>
      <TurnoverDashboardContent />
    </Protected>
  );
}
