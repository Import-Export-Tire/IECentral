"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import { useAuth } from "@/app/auth-context";
import Link from "next/link";

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const REVIEW_MILESTONE_DAYS = 90;

function daysSince(dateStr: string): number {
  const start = new Date(dateStr);
  if (isNaN(start.getTime())) return 0;
  return Math.floor((Date.now() - start.getTime()) / MS_PER_DAY);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function NinetyDayReviewsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user, canManagePersonnel } = useAuth();

  const personnel = useQuery(api.personnel.list, { status: "active" });
  const locations = useQuery(api.locations.list) || [];
  const markReview = useMutation(api.personnel.markNinetyDayReview);

  const [locationFilter, setLocationFilter] = useState<Id<"locations"> | "">("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const rows = useMemo(() => {
    if (!personnel) return [];
    return personnel
      .filter((p) => !locationFilter || p.locationId === locationFilter)
      .map((p) => {
        const totalDays = daysSince(p.hireDate);
        const daysToReview = REVIEW_MILESTONE_DAYS - totalDays;
        const reviewDueDate = addDays(p.hireDate, REVIEW_MILESTONE_DAYS);
        const location = locations.find((l) => l._id === p.locationId);
        const review = (p as { ninetyDayReview?: { completedAt: number; completedByName: string; notes?: string } }).ninetyDayReview;
        let bucket: "overdue" | "due-soon" | "upcoming" | "completed";
        if (review) bucket = "completed";
        else if (daysToReview <= 0) bucket = "overdue";
        else if (daysToReview <= 14) bucket = "due-soon";
        else bucket = "upcoming";
        return {
          id: p._id,
          name: `${p.lastName}, ${p.firstName}`,
          position: p.position,
          locationName: location?.name || "—",
          hireDate: p.hireDate,
          totalDays,
          daysToReview,
          reviewDueDate,
          review,
          bucket,
        };
      });
  }, [personnel, locations, locationFilter]);

  const overdue = rows.filter((r) => r.bucket === "overdue");
  const dueSoon = rows.filter((r) => r.bucket === "due-soon");
  const upcoming = rows.filter((r) => r.bucket === "upcoming");
  const completed = rows.filter((r) => r.bucket === "completed").sort((a, b) =>
    (b.review?.completedAt ?? 0) - (a.review?.completedAt ?? 0)
  );

  const handleQuickMark = async (personnelId: Id<"personnel">) => {
    if (!user) return;
    setSavingId(personnelId);
    try {
      await markReview({ personnelId, completedBy: user._id as Id<"users"> });
    } finally {
      setSavingId(null);
    }
  };

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
      const title = `90-Day Reviews — ${locLabel}`;
      const subtitle = `${overdue.length} overdue · ${dueSoon.length} due in 14d · ${completed.length} completed  ·  Ran: ${ranDate} ${ranTime}`;

      const drawHeaderFooter = () => {
        doc.setFontSize(13); doc.setFont("helvetica", "bold");
        doc.text(title, pageWidth / 2, 40, { align: "center" });
        doc.setFontSize(9); doc.setFont("helvetica", "normal");
        doc.text(subtitle, pageWidth / 2, 56, { align: "center" });
        doc.setFontSize(8);
        doc.text(`Generated ${ranDate}`, 36, pageHeight - 24);
      };

      const formatStatus = (r: (typeof rows)[number]) => {
        if (r.review) return `✓ ${new Date(r.review.completedAt).toLocaleDateString()} by ${r.review.completedByName}`;
        if (r.daysToReview <= 0) return `OVERDUE — ${Math.abs(r.daysToReview)}d past due`;
        return `Due in ${r.daysToReview}d`;
      };

      const body = [...overdue, ...dueSoon, ...upcoming, ...(showCompleted ? completed : [])].map((r) => [
        r.name,
        r.position || "",
        r.locationName,
        new Date(r.hireDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
        r.reviewDueDate,
        formatStatus(r),
      ]);

      autoTable(doc, {
        head: [["Name", "Position", "Location", "Hire Date", "90-Day Date", "Status"]],
        body,
        startY: 76,
        margin: { top: 76, bottom: 50, left: 28, right: 28 },
        styles: { fontSize: 9, cellPadding: 4, overflow: "linebreak" },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "left" },
        columnStyles: {
          0: { cellWidth: 110, fontStyle: "bold" },
          1: { cellWidth: 90 },
          2: { cellWidth: 65 },
          3: { cellWidth: 65 },
          4: { cellWidth: 65 },
          5: { cellWidth: "auto" },
        },
        didDrawPage: drawHeaderFooter,
      });

      const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 36, pageHeight - 24, { align: "right" });
      }

      doc.save(`ninety_day_reviews_${ranDate.replace(/\//g, "")}.pdf`);
    } finally {
      setGenerating(false);
    }
  };

  const sectionCard = (
    label: string,
    items: typeof rows,
    accentClass: string,
    isOverdue: boolean,
  ) => (
    <div className={`rounded-2xl border overflow-hidden ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
      <div className={`px-5 py-3 border-b flex items-center justify-between ${isDark ? "border-slate-700" : "border-gray-200"}`}>
        <h2 className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
          <span className={accentClass}>{label}</span>
          <span className={`ml-2 font-normal ${isDark ? "text-slate-500" : "text-gray-500"}`}>{items.length}</span>
        </h2>
      </div>
      {items.length === 0 ? (
        <div className={`p-5 text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          {isOverdue ? "None overdue — nice." : "None in this window."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={isDark ? "bg-slate-900/40" : "bg-gray-50"}>
              <tr className={isDark ? "text-slate-400" : "text-gray-600"}>
                <th className="text-left px-5 py-2 font-medium">Name</th>
                <th className="text-left px-5 py-2 font-medium">Position</th>
                <th className="text-left px-5 py-2 font-medium">Location</th>
                <th className="text-left px-5 py-2 font-medium">Hire Date</th>
                <th className="text-left px-5 py-2 font-medium">90-Day Date</th>
                <th className="text-left px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className={`border-t ${isDark ? "border-slate-700/40" : "border-gray-100"}`}>
                  <td className={`px-5 py-2 font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                    <Link href={`/personnel/${r.id}`} className={isDark ? "hover:text-cyan-400" : "hover:text-blue-600"}>
                      {r.name}
                    </Link>
                  </td>
                  <td className={`px-5 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{r.position}</td>
                  <td className={`px-5 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{r.locationName}</td>
                  <td className={`px-5 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    {new Date(r.hireDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className={`px-5 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{r.reviewDueDate}</td>
                  <td className={`px-5 py-2 ${accentClass} font-medium`}>
                    {r.review
                      ? `✓ by ${r.review.completedByName} on ${new Date(r.review.completedAt).toLocaleDateString()}`
                      : r.daysToReview <= 0
                        ? `${Math.abs(r.daysToReview)}d past due`
                        : `in ${r.daysToReview}d`}
                  </td>
                  <td className="px-5 py-2 text-right">
                    {!r.review && canManagePersonnel && (
                      <button
                        onClick={() => handleQuickMark(r.id)}
                        disabled={savingId === r.id}
                        className="text-xs font-semibold text-white px-2.5 py-1 rounded-lg disabled:opacity-50"
                        style={{ backgroundColor: "#34C759" }}
                        title="Mark this review completed by you, with no notes"
                      >
                        {savingId === r.id ? "Saving…" : "Mark Done"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center gap-3">
            <Link
              href="/reports"
              className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                90-Day Reviews
              </h1>
              <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Who needs a review around their 90-day mark, and who's already been reviewed
              </p>
            </div>
          </div>
        </header>

        <div className="p-8 max-w-6xl space-y-5">
          {/* Filters */}
          <div className={`rounded-2xl border p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Location</label>
                <select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value as Id<"locations"> | "")}
                  className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                >
                  <option value="">All locations</option>
                  {locations.map((loc) => (
                    <option key={loc._id} value={loc._id}>{loc.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <label className={`flex items-center gap-2 text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  <input
                    type="checkbox"
                    checked={showCompleted}
                    onChange={(e) => setShowCompleted(e.target.checked)}
                    className="rounded"
                  />
                  Show completed reviews
                </label>
              </div>
              <div className="flex items-end justify-end">
                <button
                  onClick={handleGeneratePDF}
                  disabled={rows.length === 0 || generating}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: "#007AFF" }}
                >
                  {generating ? "Generating…" : "Print PDF"}
                </button>
              </div>
            </div>
            <div className={`mt-3 text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
              <span className={`font-semibold ${isDark ? "text-red-400" : "text-red-600"}`}>{overdue.length}</span> overdue
              <span className={`mx-3 ${isDark ? "text-slate-600" : "text-gray-300"}`}>·</span>
              <span className={`font-semibold ${isDark ? "text-amber-400" : "text-amber-600"}`}>{dueSoon.length}</span> due within 14 days
              <span className={`mx-3 ${isDark ? "text-slate-600" : "text-gray-300"}`}>·</span>
              <span className={`font-semibold ${isDark ? "text-slate-400" : "text-gray-500"}`}>{upcoming.length}</span> upcoming
              <span className={`mx-3 ${isDark ? "text-slate-600" : "text-gray-300"}`}>·</span>
              <span className={`font-semibold ${isDark ? "text-green-400" : "text-green-600"}`}>{completed.length}</span> completed
            </div>
          </div>

          {sectionCard("Overdue", overdue, isDark ? "text-red-400" : "text-red-600", true)}
          {sectionCard("Due Within 14 Days", dueSoon, isDark ? "text-amber-400" : "text-amber-600", false)}
          {sectionCard("Upcoming", upcoming, isDark ? "text-slate-400" : "text-gray-500", false)}
          {showCompleted && sectionCard("Completed", completed, isDark ? "text-green-400" : "text-green-600", false)}
        </div>
      </main>
    </div>
  );
}

export default function NinetyDayReviewsPage() {
  return (
    <Protected minTier={3}>
      <NinetyDayReviewsContent />
    </Protected>
  );
}
