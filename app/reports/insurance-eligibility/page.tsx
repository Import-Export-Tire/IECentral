"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysSince(dateStr: string): number {
  const start = new Date(dateStr);
  if (isNaN(start.getTime())) return 0;
  return Math.floor((Date.now() - start.getTime()) / MS_PER_DAY);
}

// Insurance eligibility = 1st of the month FOLLOWING the 60-day mark.
// Hired May 12 → 60-day mark July 11 → eligible August 1.
function insuranceEligibilityDate(hireDateStr: string): Date | null {
  const hire = new Date(hireDateStr);
  if (isNaN(hire.getTime())) return null;
  const sixty = new Date(hire);
  sixty.setDate(sixty.getDate() + 60);
  return new Date(sixty.getFullYear(), sixty.getMonth() + 1, 1);
}

function formatDateShort(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function InsuranceEligibilityContent() {
  const { theme } = useTheme();
  void theme;

  const personnel = useQuery(api.personnel.listAll, { status: "active" });
  const locations = useQuery(api.locations.list) || [];

  // Default window: 14 days before milestone, 30 days after.
  // "Approaching" = haven't hit 60 yet (1–60 days in)
  // "Just crossed" = 60–90 days in (catch anyone HR missed)
  const [daysBefore, setDaysBefore] = useState(14);
  const [daysAfter, setDaysAfter] = useState(30);
  const [locationFilter, setLocationFilter] = useState<Id<"locations"> | "">("");
  const [generating, setGenerating] = useState(false);

  const rows = useMemo(() => {
    if (!personnel) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return personnel
      .filter((p) => p.employeeType !== "temp")
      .filter((p) => !locationFilter || p.locationId === locationFilter)
      .map((p) => {
        const totalDays = daysSince(p.hireDate);
        const eligDate = insuranceEligibilityDate(p.hireDate);
        const daysToEligibility = eligDate
          ? Math.ceil((eligDate.getTime() - today.getTime()) / MS_PER_DAY)
          : 0;
        const location = locations.find((l) => l._id === p.locationId);
        const phase: "approaching" | "crossed" = daysToEligibility > 0 ? "approaching" : "crossed";
        return {
          id: p._id,
          firstName: p.firstName,
          lastName: p.lastName,
          name: `${p.lastName}, ${p.firstName}`,
          position: p.position,
          department: p.department,
          locationName: location?.name || "—",
          hireDate: p.hireDate,
          totalDays,
          daysToEligibility,
          eligibilityDate: formatDateShort(eligDate),
          phase,
        };
      })
      .filter((r) => r.daysToEligibility >= -daysAfter && r.daysToEligibility <= daysBefore)
      .sort((a, b) => a.daysToEligibility - b.daysToEligibility);
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
      const pageHeight = doc.internal.pageSize.getHeight();

      const now = new Date();
      const ranDate = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${String(now.getFullYear()).slice(2)}`;
      const ranTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const locLabel = locationFilter
        ? locations.find((l) => l._id === locationFilter)?.name || "Location"
        : "All Locations";
      const title = `60-Day Insurance Eligibility — ${locLabel}`;
      const subtitle = `${approachingCount} approaching · ${crossedCount} just crossed  ·  Window: ${daysBefore}d before / ${daysAfter}d after  ·  Ran: ${ranDate} ${ranTime}`;

      const drawHeaderFooter = () => {
        doc.setFontSize(13); doc.setFont("helvetica", "bold");
        doc.text(title, pageWidth / 2, 40, { align: "center" });
        doc.setFontSize(9); doc.setFont("helvetica", "normal");
        doc.text(subtitle, pageWidth / 2, 56, { align: "center" });
        doc.setFontSize(8);
        doc.text(`Generated ${ranDate}`, 36, pageHeight - 24);
      };

      const body = rows.map((r) => [
        r.phase === "approaching" ? "→" : "✓",
        r.name,
        r.position || "",
        r.locationName,
        new Date(r.hireDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
        String(r.totalDays),
        r.daysToEligibility > 0 ? `in ${r.daysToEligibility}d` : `${Math.abs(r.daysToEligibility)}d ago`,
        r.eligibilityDate,
      ]);

      autoTable(doc, {
        head: [["", "Name", "Position", "Location", "Hire Date", "Days In", "Milestone", "Eligible Date"]],
        body,
        startY: 76,
        margin: { top: 76, bottom: 50, left: 28, right: 28 },
        styles: { fontSize: 9, cellPadding: 4, overflow: "linebreak" },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "left" },
        columnStyles: {
          0: { cellWidth: 18, halign: "center" },
          1: { cellWidth: 120, fontStyle: "bold" },
          2: { cellWidth: 95 },
          3: { cellWidth: 70 },
          4: { cellWidth: 65 },
          5: { cellWidth: 40, halign: "center" },
          6: { cellWidth: 60, halign: "center" },
          7: { cellWidth: 75 },
        },
        didDrawPage: drawHeaderFooter,
      });

      const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 36, pageHeight - 24, { align: "right" });
      }

      doc.save(`insurance_eligibility_${ranDate.replace(/\//g, "")}.pdf`);
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
          <div className="flex items-center gap-3">
            <Link
              href="/reports"
              className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5 flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold theme-text-primary">60-Day Insurance Eligibility</h1>
              <p className="text-xs mt-0.5 theme-text-tertiary">
                Eligible the 1st of the month following their 60-day mark
              </p>
            </div>
          </div>
        </header>

        <div className="px-4 sm:px-6 py-5 max-w-5xl space-y-4">
          {/* Filters */}
          <Card>
            <SectionHeader label="Filters" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block ui-section-label mb-1">Location</label>
                <select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value as Id<"locations"> | "")}
                  className="theme-input w-full px-3 py-2"
                >
                  <option value="">All locations</option>
                  {locations.map((loc) => (
                    <option key={loc._id} value={loc._id}>{loc.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block ui-section-label mb-1">Days before milestone</label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={daysBefore}
                  onChange={(e) => setDaysBefore(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
                  className="theme-input w-full px-3 py-2"
                />
              </div>
              <div>
                <label className="block ui-section-label mb-1">Days after milestone (catch-up)</label>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={daysAfter}
                  onChange={(e) => setDaysAfter(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
                  className="theme-input w-full px-3 py-2"
                />
              </div>
            </div>
            <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t theme-border-secondary">
              <p className="text-sm theme-text-secondary">
                <span className="font-semibold theme-text-primary">{rows.length}</span> in window
                <span className="ml-3 theme-text-tertiary">
                  · {approachingCount} approaching · {crossedCount} just crossed
                </span>
              </p>
              <Button
                variant="primary"
                onClick={handleGeneratePDF}
                disabled={rows.length === 0 || generating}
              >
                {generating ? "Generating…" : "Print PDF"}
              </Button>
            </div>
          </Card>

          {/* Table */}
          <div className="theme-card overflow-hidden p-0">
            {personnel === undefined ? (
              <div className="p-8 text-center text-sm theme-text-tertiary">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="p-8 text-center text-sm theme-text-tertiary">
                No personnel currently in the {daysBefore}-day / +{daysAfter}-day window.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
                    <tr className="border-b theme-border-secondary">
                      <th className="text-left px-4 py-2 font-semibold theme-text-tertiary w-8"></th>
                      <th className="text-left px-4 py-2 font-semibold theme-text-tertiary">Name</th>
                      <th className="text-left px-4 py-2 font-semibold theme-text-tertiary">Position</th>
                      <th className="text-left px-4 py-2 font-semibold theme-text-tertiary">Location</th>
                      <th className="text-left px-4 py-2 font-semibold theme-text-tertiary">Hire Date</th>
                      <th className="text-center px-4 py-2 font-semibold theme-text-tertiary">Days In</th>
                      <th className="text-center px-4 py-2 font-semibold theme-text-tertiary">Milestone</th>
                      <th className="text-left px-4 py-2 font-semibold theme-text-tertiary">Eligible Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const approaching = r.phase === "approaching";
                      return (
                        <tr
                          key={r.id}
                          className="border-t theme-border-secondary"
                        >
                          <td className="px-4 py-2">
                            <span
                              className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                                approaching
                                  ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
                                  : "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400"
                              }`}
                            >
                              {approaching ? "→" : "✓"}
                            </span>
                          </td>
                          <td className="px-4 py-2 font-medium theme-text-primary">
                            <Link
                              href={`/personnel/${r.id}`}
                              className="hover:text-[#007AFF]"
                            >
                              {r.name}
                            </Link>
                          </td>
                          <td className="px-4 py-2 theme-text-secondary">{r.position}</td>
                          <td className="px-4 py-2 theme-text-secondary">{r.locationName}</td>
                          <td className="px-4 py-2 theme-text-secondary">
                            {new Date(r.hireDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </td>
                          <td className="px-4 py-2 text-center font-mono theme-text-secondary">
                            {r.totalDays}
                          </td>
                          <td className={`px-4 py-2 text-center font-semibold ${
                            approaching
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-green-700 dark:text-green-400"
                          }`}>
                            {r.daysToEligibility > 0 ? `in ${r.daysToEligibility}d` : `${Math.abs(r.daysToEligibility)}d ago`}
                          </td>
                          <td className="px-4 py-2 theme-text-secondary">
                            {r.eligibilityDate}
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

export default function InsuranceEligibilityPage() {
  return (
    <Protected minTier={5}>
      <InsuranceEligibilityContent />
    </Protected>
  );
}
