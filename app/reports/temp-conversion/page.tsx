"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";
import { isTemp, computeTempEligibleDate, tempEligibilityLabel } from "@/lib/tempEligibility";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function formatDateShort(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function TempConversionContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const personnel = useQuery(api.personnel.list, { status: "active" });
  const locations = useQuery(api.locations.list) || [];

  const [daysBefore, setDaysBefore] = useState(30);
  const [daysAfter, setDaysAfter] = useState(30);
  const [locationFilter, setLocationFilter] = useState<Id<"locations"> | "">("");
  const [generating, setGenerating] = useState(false);

  const rows = useMemo(() => {
    if (!personnel) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return personnel
      .filter((p) => isTemp(p.employeeType))
      .filter((p) => !locationFilter || p.locationId === locationFilter)
      .map((p) => {
        const eligDate = computeTempEligibleDate(p);
        const daysToEligibility = eligDate
          ? Math.ceil((eligDate.getTime() - today.getTime()) / MS_PER_DAY)
          : null;
        const location = locations.find((l) => l._id === p.locationId);
        const phase: "approaching" | "crossed" =
          daysToEligibility !== null && daysToEligibility > 0 ? "approaching" : "crossed";
        return {
          id: p._id,
          name: `${p.lastName}, ${p.firstName}`,
          agency: p.staffingAgency || "—",
          startDate: p.hireDate,
          basis: tempEligibilityLabel(p),
          locationName: location?.name || "—",
          eligibilityDate: formatDateShort(eligDate),
          daysToEligibility,
          phase,
        };
      })
      .filter((r) => r.daysToEligibility !== null && r.daysToEligibility >= -daysAfter && r.daysToEligibility <= daysBefore)
      .sort((a, b) => (a.daysToEligibility ?? 0) - (b.daysToEligibility ?? 0));
  }, [personnel, locations, locationFilter, daysBefore, daysAfter]);

  const approachingCount = rows.filter((r) => r.phase === "approaching").length;
  const crossedCount = rows.filter((r) => r.phase === "crossed").length;

  const handleGeneratePDF = async () => {
    if (rows.length === 0) return;
    setGenerating(true);
    try {
      const { jsPDF } = await import("jspdf");
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = (autoTableModule.default || autoTableModule) as typeof import("jspdf-autotable").default;

      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const now = new Date();
      const ranDate = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${String(now.getFullYear()).slice(2)}`;
      const title = "Temp Conversion Eligibility";
      const subtitle = `${approachingCount} approaching · ${crossedCount} eligible now  ·  Window: ${daysBefore}d before / ${daysAfter}d after  ·  Ran: ${ranDate}`;

      const body = rows.map((r) => [
        r.phase === "approaching" ? "→" : "✓",
        r.name,
        r.agency,
        new Date(r.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
        r.basis,
        r.eligibilityDate,
        r.daysToEligibility !== null && r.daysToEligibility > 0 ? `in ${r.daysToEligibility}d` : `${Math.abs(r.daysToEligibility ?? 0)}d ago`,
      ]);

      autoTable(doc, {
        head: [["", "Name", "Agency", "Start", "Basis", "Eligible Date", "When"]],
        body,
        startY: 76,
        margin: { top: 76, bottom: 50, left: 28, right: 28 },
        styles: { fontSize: 9, cellPadding: 4, overflow: "linebreak" },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "left" },
        didDrawPage: () => {
          doc.setFontSize(13); doc.setFont("helvetica", "bold");
          doc.text(title, pageWidth / 2, 40, { align: "center" });
          doc.setFontSize(9); doc.setFont("helvetica", "normal");
          doc.text(subtitle, pageWidth / 2, 56, { align: "center" });
        },
      });
      doc.save(`temp_conversion_${ranDate.replace(/\//g, "")}.pdf`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center gap-3">
            <Link href="/reports" className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Temp Conversion</h1>
              <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Temps becoming eligible for direct hire</p>
            </div>
          </div>
        </header>

        <div className="p-8 max-w-5xl">
          <div className={`rounded-2xl border p-5 mb-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Location</label>
                <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value as Id<"locations"> | "")}
                  className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}>
                  <option value="">All locations</option>
                  {locations.map((loc) => (<option key={loc._id} value={loc._id}>{loc.name}</option>))}
                </select>
              </div>
              <div>
                <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Days before</label>
                <input type="number" min={0} max={365} value={daysBefore}
                  onChange={(e) => setDaysBefore(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
                  className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`} />
              </div>
              <div>
                <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Days after</label>
                <input type="number" min={0} max={365} value={daysAfter}
                  onChange={(e) => setDaysAfter(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
                  className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`} />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
              <div className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                <span className="font-semibold">{rows.length}</span> in window
                <span className={`ml-3 ${isDark ? "text-slate-500" : "text-gray-500"}`}>· {approachingCount} approaching · {crossedCount} eligible now</span>
              </div>
              <button onClick={handleGeneratePDF} disabled={rows.length === 0 || generating}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "#007AFF" }}>
                {generating ? "Generating…" : "Print PDF"}
              </button>
            </div>
          </div>

          <div className={`rounded-2xl border overflow-hidden ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
            {personnel === undefined ? (
              <div className={`p-8 text-center text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>Loading…</div>
            ) : rows.length === 0 ? (
              <div className={`p-8 text-center text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>No temps in the {daysBefore}-day / +{daysAfter}-day window.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={isDark ? "bg-slate-900/60" : "bg-gray-50"}>
                    <tr className={isDark ? "text-slate-400" : "text-gray-600"}>
                      <th className="text-left px-4 py-2 font-medium w-8"></th>
                      <th className="text-left px-4 py-2 font-medium">Name</th>
                      <th className="text-left px-4 py-2 font-medium">Agency</th>
                      <th className="text-left px-4 py-2 font-medium">Start</th>
                      <th className="text-left px-4 py-2 font-medium">Basis</th>
                      <th className="text-left px-4 py-2 font-medium">Eligible Date</th>
                      <th className="text-center px-4 py-2 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const approaching = r.phase === "approaching";
                      return (
                        <tr key={r.id} className={`border-t ${isDark ? "border-slate-700/40" : "border-gray-100"}`}>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${approaching ? (isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700") : (isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700")}`}>
                              {approaching ? "→" : "✓"}
                            </span>
                          </td>
                          <td className={`px-4 py-2 font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                            <Link href={`/personnel/${r.id}`} className={isDark ? "hover:text-cyan-400" : "hover:text-blue-600"}>{r.name}</Link>
                          </td>
                          <td className={`px-4 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{r.agency}</td>
                          <td className={`px-4 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{new Date(r.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
                          <td className={`px-4 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{r.basis}</td>
                          <td className={`px-4 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{r.eligibilityDate}</td>
                          <td className={`px-4 py-2 text-center font-semibold ${approaching ? (isDark ? "text-amber-400" : "text-amber-700") : (isDark ? "text-green-400" : "text-green-700")}`}>
                            {r.daysToEligibility !== null && r.daysToEligibility > 0 ? `in ${r.daysToEligibility}d` : `${Math.abs(r.daysToEligibility ?? 0)}d ago`}
                          </td>
                        </tr>
                      );
                    })}
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

export default function TempConversionPage() {
  return (
    <Protected minTier={3}>
      <TempConversionContent />
    </Protected>
  );
}
