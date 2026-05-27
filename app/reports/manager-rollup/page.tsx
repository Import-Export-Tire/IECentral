"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";
import {
  ResponsiveContainer, BarChart, Bar,
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
}

interface ExitInterviewRow {
  _id: string;
  personnelId: string;
  leavingCategory?: string;
}

const MS_PER_DAY = 86400_000;
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoMonthsAgo(n: number): string {
  const d = new Date(); d.setMonth(d.getMonth() - n); return iso(d);
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

const UNASSIGNED = "__unassigned__";

function ManagerRollupContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const personnel = useQuery(api.personnel.list, {}) as PersonnelRow[] | undefined;
  const locations = useQuery(api.locations.list);
  const users = useQuery(api.auth.getAllUsers);
  const interviews = useQuery(api.exitInterviews.list, {}) as ExitInterviewRow[] | undefined;

  const [startDate, setStartDate] = useState<string>(isoMonthsAgo(5));
  const [endDate, setEndDate] = useState<string>(iso(new Date()));
  const [generating, setGenerating] = useState(false);

  // Build lookups
  const locById = useMemo(
    () => new Map<string, { name: string; managerId?: string }>(
      (locations || []).map(l => [String(l._id), { name: l.name, managerId: l.managerId as string | undefined }])
    ),
    [locations]
  );
  const userById = useMemo(
    () => new Map<string, { name: string; role: string }>(
      (users || []).map(u => [String(u._id), { name: u.name, role: u.role }])
    ),
    [users]
  );

  // For each personnel, resolve effective manager (location manager).
  // Personnel without a location, OR location without a manager → unassigned bucket.
  const managerForPersonnel = (p: PersonnelRow): { id: string; name: string } => {
    if (!p.locationId) return { id: UNASSIGNED, name: "(no location)" };
    const loc = locById.get(p.locationId);
    if (!loc || !loc.managerId) return { id: UNASSIGNED, name: `(${loc?.name || "unknown loc"} — no manager)` };
    const mgr = userById.get(loc.managerId);
    return { id: String(loc.managerId), name: mgr?.name || "(unknown manager)" };
  };

  const inRange = (d?: string) => !!d && d >= startDate && d <= endDate;

  // Aggregate per manager
  const rollup = useMemo(() => {
    type Cell = {
      managerId: string;
      managerName: string;
      locations: Set<string>;
      activeReports: number;
      termsInPeriod: PersonnelRow[];
    };
    const map = new Map<string, Cell>();
    for (const p of personnel || []) {
      const mgr = managerForPersonnel(p);
      let cell = map.get(mgr.id);
      if (!cell) {
        cell = { managerId: mgr.id, managerName: mgr.name, locations: new Set(), activeReports: 0, termsInPeriod: [] };
        map.set(mgr.id, cell);
      }
      if (p.locationId) cell.locations.add(locById.get(p.locationId)?.name || "?");
      if (p.status === "active") cell.activeReports++;
      if (p.status === "terminated" && inRange(p.terminationDate)) cell.termsInPeriod.push(p);
    }
    return [...map.values()].map(c => {
      const terms = c.termsInPeriod.length;
      const tenures = c.termsInPeriod
        .map(t => tenureDays(t.hireDate, t.terminationDate))
        .filter((d): d is number => d != null);
      const avgTenureDays = tenures.length > 0 ? tenures.reduce((s, v) => s + v, 0) / tenures.length : null;
      const early = c.termsInPeriod.filter(t => {
        const d = tenureDays(t.hireDate, t.terminationDate);
        return d != null && d < 90;
      }).length;
      const total = c.activeReports + terms;
      const termRate = total > 0 ? (terms / total) * 100 : 0;
      const earlyRate = terms > 0 ? (early / terms) * 100 : 0;
      return {
        ...c,
        terms,
        total,
        termRate,
        avgTenureDays,
        earlyRate,
        locationsList: [...c.locations].sort().join(", ") || "—",
      };
    }).sort((a, b) => b.terms - a.terms);
  }, [personnel, locById, userById, startDate, endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Top reasons per top-3 managers (for the side chart)
  const topManagers = rollup.slice(0, 5);
  const reasonsByManager = useMemo(() => {
    if (!interviews) return new Map<string, Map<string, number>>();
    const personnelToManager = new Map<string, string>();
    for (const p of personnel || []) {
      personnelToManager.set(p._id, managerForPersonnel(p).id);
    }
    const out = new Map<string, Map<string, number>>();
    for (const i of interviews) {
      const mid = personnelToManager.get(i.personnelId);
      if (!mid) continue;
      const cat = i.leavingCategory || "(uncategorized)";
      if (!out.has(mid)) out.set(mid, new Map());
      out.get(mid)!.set(cat, (out.get(mid)!.get(cat) || 0) + 1);
    }
    return out;
  }, [interviews, personnel, locById, userById]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manager bar chart data: top 8 managers by terms in period
  const chartData = useMemo(() => {
    return rollup.slice(0, 8).map(r => ({
      manager: r.managerName.length > 18 ? r.managerName.slice(0, 16) + "…" : r.managerName,
      Terms: r.terms,
      Active: r.activeReports,
    }));
  }, [rollup]);

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
      doc.setFontSize(14); doc.setFont("helvetica", "bold");
      doc.text("Termination Rollup by Manager", pageWidth / 2, 40, { align: "center" });
      doc.setFontSize(9); doc.setFont("helvetica", "normal");
      doc.text(`${startDate} → ${endDate}  ·  Generated ${now.toLocaleString()}`, pageWidth / 2, 58, { align: "center" });

      autoTable(doc, {
        startY: 80,
        head: [["Manager", "Locations", "Active", "Terms", "Term %", "Avg leaver tenure", "Early-exit %"]],
        body: rollup.map(r => [
          r.managerName,
          r.locationsList,
          String(r.activeReports),
          String(r.terms),
          `${r.termRate.toFixed(0)}%`,
          r.avgTenureDays != null ? `${(r.avgTenureDays / 365.25).toFixed(1)} yr` : "—",
          r.terms > 0 ? `${r.earlyRate.toFixed(0)}%` : "—",
        ]),
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold" },
        margin: { left: 28, right: 28 },
        columnStyles: { 0: { fontStyle: "bold" } },
      });

      const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 36, pageHeight - 24, { align: "right" });
      }
      doc.save(`manager_rollup_${startDate}_to_${endDate}.pdf`);
    } finally {
      setGenerating(false);
    }
  };

  const totalTermsInPeriod = rollup.reduce((s, r) => s + r.terms, 0);
  const totalActive = rollup.reduce((s, r) => s + r.activeReports, 0);

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
                <h1 className="text-xl font-semibold theme-text-primary tracking-tight">Termination Rollup by Manager</h1>
                <p className="text-xs theme-text-tertiary">Isolates the &ldquo;is it this manager?&rdquo; question — rolled up via location-manager assignment</p>
              </div>
            </div>
            <button
              onClick={handlePdf}
              disabled={generating || totalTermsInPeriod === 0}
              className="px-4 py-1.5 rounded-full text-xs font-semibold text-white bg-[#007AFF] hover:bg-[#0063CC] shadow-sm disabled:opacity-50"
            >
              {generating ? "Generating…" : "Period PDF"}
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
              <div className="flex items-end gap-1.5 md:col-span-2">
                <button onClick={() => { setStartDate(isoMonthsAgo(2)); setEndDate(iso(new Date())); }}
                  className="flex-1 px-3 py-2 rounded-lg text-xs theme-bg-secondary theme-bg-hover theme-text-secondary">3 mo</button>
                <button onClick={() => { setStartDate(isoMonthsAgo(5)); setEndDate(iso(new Date())); }}
                  className="flex-1 px-3 py-2 rounded-lg text-xs theme-bg-secondary theme-bg-hover theme-text-secondary">6 mo</button>
                <button onClick={() => { setStartDate(isoMonthsAgo(11)); setEndDate(iso(new Date())); }}
                  className="flex-1 px-3 py-2 rounded-lg text-xs theme-bg-secondary theme-bg-hover theme-text-secondary">12 mo</button>
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Managers</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{rollup.length}</p>
              <p className="text-[11px] theme-text-muted mt-0.5">with personnel under them</p>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Total active reports</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{totalActive}</p>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Terms in period</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{totalTermsInPeriod}</p>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Highest single-mgr term %</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">
                {rollup[0] ? `${rollup[0].termRate.toFixed(0)}%` : "—"}
              </p>
              <p className="text-[11px] theme-text-muted mt-0.5">{rollup[0]?.managerName || ""}</p>
            </div>
          </div>

          {/* Top managers by terms bar chart */}
          <div className={cardClass}>
            <h2 className="text-sm font-semibold theme-text-primary mb-3">Top managers — active vs terminated reports in period</h2>
            {chartData.length === 0 ? (
              <p className="text-sm theme-text-muted py-6 text-center">No data.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke={isDark ? "#334155" : "#E5E7EB"} strokeDasharray="3 3" />
                  <XAxis dataKey="manager" tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                  <YAxis tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: isDark ? "#0F172A" : "#FFFFFF", border: `1px solid ${isDark ? "#334155" : "#E5E7EB"}`, borderRadius: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Active" stackId="a" fill="#34C759" />
                  <Bar dataKey="Terms"  stackId="a" fill="#FF3B30" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Full table */}
          <div className={cardClass}>
            <h2 className="text-sm font-semibold theme-text-primary mb-3">Per-manager rollup</h2>
            {rollup.length === 0 ? (
              <p className="text-sm theme-text-muted py-6 text-center">No managers in scope.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={isDark ? "text-slate-400" : "text-gray-600"}>
                    <tr className="border-b theme-border-secondary">
                      <th className="text-left py-2 px-2 font-medium">Manager</th>
                      <th className="text-left py-2 px-2 font-medium">Locations</th>
                      <th className="text-right py-2 px-2 font-medium">Active</th>
                      <th className="text-right py-2 px-2 font-medium">Terms (period)</th>
                      <th className="text-right py-2 px-2 font-medium">Term %</th>
                      <th className="text-right py-2 px-2 font-medium">Avg leaver tenure</th>
                      <th className="text-right py-2 px-2 font-medium">Early-exit % of terms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollup.map(r => (
                      <tr key={r.managerId} className="border-b theme-border-secondary">
                        <td className="py-2 px-2 theme-text-primary font-medium">{r.managerName}</td>
                        <td className="py-2 px-2 theme-text-secondary text-xs">{r.locationsList}</td>
                        <td className="py-2 px-2 text-right theme-text-primary tabular-nums">{r.activeReports}</td>
                        <td className="py-2 px-2 text-right theme-text-primary tabular-nums">{r.terms}</td>
                        <td className="py-2 px-2 text-right theme-text-primary tabular-nums">
                          <span className={`px-1.5 py-0.5 rounded-full text-[11px] ${
                            r.termRate >= 30 ? "bg-red-100 text-red-700" :
                            r.termRate >= 15 ? "bg-amber-100 text-amber-700" :
                            "theme-bg-secondary theme-text-secondary"
                          }`}>{r.termRate.toFixed(0)}%</span>
                        </td>
                        <td className="py-2 px-2 text-right theme-text-secondary tabular-nums">
                          {r.avgTenureDays != null ? `${(r.avgTenureDays / 365.25).toFixed(1)} yr` : "—"}
                        </td>
                        <td className="py-2 px-2 text-right theme-text-secondary tabular-nums">
                          {r.terms > 0 ? `${r.earlyRate.toFixed(0)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Top reasons per top managers */}
          {topManagers.length > 0 && (
            <div className={cardClass}>
              <h2 className="text-sm font-semibold theme-text-primary mb-3">Top reasons — per top 5 managers</h2>
              <div className="space-y-4">
                {topManagers.map(m => {
                  const reasons = reasonsByManager.get(m.managerId);
                  if (!reasons || reasons.size === 0) {
                    return (
                      <div key={m.managerId}>
                        <p className="text-xs font-medium theme-text-secondary mb-1">{m.managerName}</p>
                        <p className="text-xs theme-text-muted">No exit interview data for their terms.</p>
                      </div>
                    );
                  }
                  const sorted = [...reasons].sort((a, b) => b[1] - a[1]);
                  const total = sorted.reduce((s, [, n]) => s + n, 0);
                  return (
                    <div key={m.managerId}>
                      <p className="text-xs font-semibold theme-text-primary mb-1.5">{m.managerName}</p>
                      <div className="space-y-1">
                        {sorted.map(([cat, n]) => {
                          const pct = (n / total) * 100;
                          return (
                            <div key={cat}>
                              <div className="flex justify-between text-[11px] theme-text-secondary">
                                <span>{CATEGORY_LABELS[cat] || cat}</span>
                                <span className="tabular-nums">{n} · {pct.toFixed(0)}%</span>
                              </div>
                              <div className={`h-1 rounded-full overflow-hidden ${isDark ? "bg-slate-700" : "bg-gray-200"}`}>
                                <div className="h-full bg-[#007AFF]" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[11px] theme-text-muted text-center pb-4">
            Rollup uses each personnel record&apos;s location → location.managerId. Personnel without a location or whose location has
            no manager assigned roll into the &ldquo;unassigned&rdquo; bucket. Term % is terms ÷ (active + terms in period).
          </p>
        </div>
      </main>
    </div>
  );
}

export default function ManagerRollupPage() {
  return (
    <Protected minTier={4}>
      <ManagerRollupContent />
    </Protected>
  );
}
