"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
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

  const personnel = useQuery(api.personnel.list, {}) as PersonnelRow[] | undefined;
  const locations = useQuery(api.locations.list);
  const interviews = useQuery(api.exitInterviews.list, {}) as ExitInterviewRow[] | undefined;

  const [startDate, setStartDate] = useState<string>(isoMonthsAgo(11));
  const [endDate, setEndDate] = useState<string>(iso(new Date()));
  const [locationId, setLocationId] = useState<string>("");
  const [generating, setGenerating] = useState(false);

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

  const cardClass = `rounded-2xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"} shadow-sm`;
  const inputClass = `w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 ${
    isDark ? "bg-slate-900 border-slate-700 text-white" : "bg-white border-gray-300 text-gray-900"
  }`;
  const labelClass = `block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`;

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className={`sticky top-0 z-10 backdrop-blur-md border-b px-6 sm:px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/85 border-gray-200"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link href="/reports" className={`p-2 rounded-lg ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </Link>
              <div>
                <h1 className="text-xl font-semibold theme-text-primary tracking-tight">Turnover Dashboard</h1>
                <p className="text-xs theme-text-tertiary">Hires vs terms, tenure curves, by-location term rates, reasons</p>
              </div>
            </div>
            <button
              onClick={handlePdf}
              disabled={generating || totalTerms === 0}
              className="px-4 py-1.5 rounded-full text-xs font-semibold text-white bg-[#007AFF] hover:bg-[#0063CC] shadow-sm disabled:opacity-50"
            >
              {generating ? "Generating…" : "Period summary PDF"}
            </button>
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
              <div className="flex items-end gap-1.5">
                <button onClick={() => { setStartDate(isoMonthsAgo(2)); setEndDate(iso(new Date())); }}
                  className="flex-1 px-3 py-2 rounded-lg text-xs theme-bg-secondary theme-bg-hover theme-text-secondary">3 mo</button>
                <button onClick={() => { setStartDate(isoMonthsAgo(5)); setEndDate(iso(new Date())); }}
                  className="flex-1 px-3 py-2 rounded-lg text-xs theme-bg-secondary theme-bg-hover theme-text-secondary">6 mo</button>
                <button onClick={() => { setStartDate(isoMonthsAgo(11)); setEndDate(iso(new Date())); }}
                  className="flex-1 px-3 py-2 rounded-lg text-xs theme-bg-secondary theme-bg-hover theme-text-secondary">12 mo</button>
              </div>
            </div>
          </div>

          {/* Headline KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Hires</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{totalHires}</p>
              <p className="text-[11px] theme-text-muted mt-0.5">in period</p>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Terms</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{totalTerms}</p>
              <p className="text-[11px] theme-text-muted mt-0.5">in period</p>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Net change</p>
              <p className={`text-2xl font-semibold mt-1 ${netChange >= 0 ? (isDark ? "text-green-400" : "text-green-600") : (isDark ? "text-red-400" : "text-red-600")}`}>
                {netChange >= 0 ? "+" : ""}{netChange}
              </p>
              <p className="text-[11px] theme-text-muted mt-0.5">hires − terms</p>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Annualized turnover</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{annualizedTurnover.toFixed(1)}%</p>
              <p className="text-[11px] theme-text-muted mt-0.5">vs current active</p>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Early exit rate</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{earlyExitRate.toFixed(0)}%</p>
              <p className="text-[11px] theme-text-muted mt-0.5">terms under 90 days</p>
            </div>
          </div>

          {/* Hires vs terms chart */}
          <div className={cardClass}>
            <h2 className="text-sm font-semibold theme-text-primary mb-3">Hires vs terminations by month</h2>
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
          </div>

          {/* Tenure-at-termination + by-location */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className={cardClass}>
              <h2 className="text-sm font-semibold theme-text-primary mb-3">Tenure at termination</h2>
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
              <p className="text-[11px] theme-text-muted mt-2">
                Median tenure of leavers: {avgLeaverTenureYears != null ? `${avgLeaverTenureYears.toFixed(1)} yr (mean)` : "—"}
              </p>
            </div>
            <div className={cardClass}>
              <h2 className="text-sm font-semibold theme-text-primary mb-3">Reasons (from exit interviews)</h2>
              {reasonCounts.length === 0 ? (
                <p className="text-sm theme-text-muted py-6 text-center">No exit interview data for this period.</p>
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
                        <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? "bg-slate-700" : "bg-gray-200"}`}>
                          <div className="h-full" style={{ width: `${pct}%`, background: PALETTE[i % PALETTE.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Per-location table */}
          <div className={cardClass}>
            <h2 className="text-sm font-semibold theme-text-primary mb-3">By location</h2>
            {byLocation.length === 0 ? (
              <p className="text-sm theme-text-muted py-6 text-center">No data.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={isDark ? "text-slate-400" : "text-gray-600"}>
                    <tr className="border-b theme-border-secondary">
                      <th className="text-left py-2 px-2 font-medium">Location</th>
                      <th className="text-right py-2 px-2 font-medium">Active</th>
                      <th className="text-right py-2 px-2 font-medium">Terms in period</th>
                      <th className="text-right py-2 px-2 font-medium">Total ever</th>
                      <th className="text-right py-2 px-2 font-medium">Term %</th>
                      <th className="text-right py-2 px-2 font-medium">Avg leaver tenure</th>
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
          </div>

          {/* Net headcount over time (small) */}
          <div className={cardClass}>
            <h2 className="text-sm font-semibold theme-text-primary mb-3">Net change (hires − terms) per month</h2>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthlyHvT} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke={isDark ? "#334155" : "#E5E7EB"} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                <YAxis tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: isDark ? "#0F172A" : "#FFFFFF", border: `1px solid ${isDark ? "#334155" : "#E5E7EB"}`, borderRadius: 12 }} />
                <Line type="monotone" dataKey="net" stroke="#007AFF" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <p className="text-[11px] theme-text-muted text-center pb-4">
            Source: personnel records + exit-interview data. terminationDate-based; historical pre-2026 dates may have been reset.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function TurnoverDashboardPage() {
  return (
    <Protected minTier={3}>
      <TurnoverDashboardContent />
    </Protected>
  );
}
