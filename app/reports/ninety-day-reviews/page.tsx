"use client";

import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import { useAuth } from "@/app/auth-context";
import Link from "next/link";
import ReviewPrintForm, { type ReviewFormPerson } from "@/components/ReviewPrintForm";
import ReviewScorePanel from "@/components/ReviewScorePanel";
import ReviewSummaryPrint from "@/components/ReviewSummaryPrint";

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const REVIEW_MILESTONE_DAYS = 90;
const ANNUAL_DUE_SOON_DAYS = 30; // alert when an upcoming anniversary is within this window

type Tab = "ninety" | "annual";

type AnnualReview = {
  cycleYear: number;
  completedAt: number;
  completedBy: Id<"users">;
  completedByName: string;
  notes?: string;
};

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

// Anniversary on a given year. Uses local time to keep dates from drifting.
function anniversaryOn(hireDate: string, year: number): Date {
  const h = new Date(hireDate);
  return new Date(year, h.getMonth(), h.getDate());
}

// The next annual cycle that needs a review for this employee.
// - Returns nextDueDate (Date object), cycleYear (number for the cycle the
//   review covers), daysToReview (negative = overdue, positive = future),
//   and last completed review if any.
function annualState(hireDate: string, annualReviews: AnnualReview[] | undefined) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const hire = new Date(hireDate);
  if (isNaN(hire.getTime())) return null;
  hire.setHours(0, 0, 0, 0);

  // Walk forward from the first anniversary until we find one whose review
  // is missing. If we find a future anniversary, that's the next-upcoming
  // review and the employee is up-to-date through all earlier cycles.
  let yearOffset = 1;
  let nextDue = anniversaryOn(hireDate, hire.getFullYear() + yearOffset);
  while (nextDue.getTime() <= today.getTime()) {
    const cycleYear = nextDue.getFullYear();
    const hasReview = (annualReviews || []).some((r) => r.cycleYear === cycleYear);
    if (!hasReview) break; // overdue
    yearOffset += 1;
    nextDue = anniversaryOn(hireDate, hire.getFullYear() + yearOffset);
  }

  const cycleYear = nextDue.getFullYear();
  const daysToReview = Math.round((nextDue.getTime() - today.getTime()) / MS_PER_DAY);
  const lastCompleted = (annualReviews || [])
    .slice()
    .sort((a, b) => b.cycleYear - a.cycleYear)[0];

  return {
    nextDue,
    cycleYear,
    daysToReview,
    lastCompleted,
  };
}

function NinetyDayReviewsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user, canManagePersonnel } = useAuth();

  const personnel = useQuery(api.personnel.list, { status: "active" });
  const locations = useQuery(api.locations.list) || [];
  const markReview = useMutation(api.personnel.markNinetyDayReview);
  const markAnnual = useMutation(api.personnel.markAnnualReview);

  const [tab, setTab] = useState<Tab>("ninety");
  const [locationFilter, setLocationFilter] = useState<Id<"locations"> | "">("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [printPeople, setPrintPeople] = useState<ReviewFormPerson[]>([]);
  const [printSummary, setPrintSummary] = useState(false);
  const [scoreReviewId, setScoreReviewId] = useState<Id<"employeeReviews"> | null>(null);
  const [openingScore, setOpeningScore] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const clear = () => { setPrintPeople([]); setPrintSummary(false); };
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  const reviewType = tab === "annual" ? "annual" : "90_day";
  const empReviews = useQuery(
    api.employeeReviews.list,
    user?._id && canManagePersonnel ? { requestingUserId: user._id, reviewType } : "skip",
  );
  const generateReview = useMutation(api.employeeReviews.generate);
  const reviewByPersonnel = useMemo(() => {
    const m = new Map<string, NonNullable<typeof empReviews>[number]>();
    for (const r of empReviews ?? []) m.set(r.personnelId as unknown as string, r);
    return m;
  }, [empReviews]);

  const openScore = async (personnelId: Id<"personnel">) => {
    if (!user?._id) return;
    setOpeningScore(personnelId);
    try {
      const res = await generateReview({ requestingUserId: user._id, personnelId, reviewType, createdByName: user.name ?? user.email ?? "" });
      setScoreReviewId(res.id as Id<"employeeReviews">);
    } finally { setOpeningScore(null); }
  };

  // ===== 90-day rows =====
  const ninetyRows = useMemo(() => {
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
          department: p.department,
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

  // ===== Annual rows =====
  const annualRows = useMemo(() => {
    if (!personnel) return [];
    return personnel
      .filter((p) => !locationFilter || p.locationId === locationFilter)
      .map((p) => {
        const annualReviews = (p as { annualReviews?: AnnualReview[] }).annualReviews;
        const state = annualState(p.hireDate, annualReviews);
        const location = locations.find((l) => l._id === p.locationId);
        if (!state) return null;

        let bucket: "overdue" | "due-soon" | "upcoming" | "completed";
        if (state.daysToReview <= 0) bucket = "overdue";
        else if (state.daysToReview <= ANNUAL_DUE_SOON_DAYS) bucket = "due-soon";
        else if (state.lastCompleted && state.lastCompleted.cycleYear === state.cycleYear - 1) {
          // already reviewed for previous cycle; next is just upcoming
          bucket = "upcoming";
        } else {
          bucket = "upcoming";
        }

        return {
          id: p._id,
          name: `${p.lastName}, ${p.firstName}`,
          position: p.position,
          department: p.department,
          locationName: location?.name || "—",
          hireDate: p.hireDate,
          nextDue: state.nextDue,
          cycleYear: state.cycleYear,
          daysToReview: state.daysToReview,
          lastCompleted: state.lastCompleted,
          bucket,
        };
      })
      .filter(<T,>(r: T | null): r is T => r !== null);
  }, [personnel, locations, locationFilter]);

  // Buckets for the active tab — sorted by location (then name) so each location groups together.
  const rowsRaw = tab === "ninety" ? ninetyRows : annualRows;
  const rows = [...rowsRaw].sort((a, b) =>
    (a.locationName || "").localeCompare(b.locationName || "") || a.name.localeCompare(b.name),
  );
  const overdue = rows.filter((r) => r.bucket === "overdue");
  const dueSoon = rows.filter((r) => r.bucket === "due-soon");
  const upcoming = rows.filter((r) => r.bucket === "upcoming");
  const completed = tab === "ninety"
    ? ninetyRows.filter((r) => r.bucket === "completed").sort(
      (a, b) => ((b as typeof ninetyRows[number]).review?.completedAt ?? 0) - ((a as typeof ninetyRows[number]).review?.completedAt ?? 0)
    )
    : [];

  // ===== Print pre-filled review forms (one per due person, current tab) =====
  const fmtDate = (d: Date | string | undefined) => {
    if (!d) return "—";
    const dt = typeof d === "string" ? new Date(d) : d;
    return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString();
  };
  const printForms = (which: "due" | "all") => {
    const src = which === "all" ? [...overdue, ...dueSoon, ...upcoming] : [...overdue, ...dueSoon];
    const people: ReviewFormPerson[] = src.map((r) => {
      const rr = r as typeof ninetyRows[number] & typeof annualRows[number];
      return {
        name: rr.name,
        position: rr.position,
        department: (rr as { department?: string }).department,
        locationName: rr.locationName,
        hireDate: rr.hireDate,
        dueDateLabel: tab === "ninety" ? "90-Day Due" : "Annual Due",
        dueDate: fmtDate(tab === "ninety" ? (rr as typeof ninetyRows[number]).reviewDueDate : (rr as typeof annualRows[number]).nextDue),
      };
    });
    if (people.length === 0) return;
    setPrintPeople(people);
    setTimeout(() => window.print(), 80);
  };

  // ===== Actions =====
  const handleQuickMarkNinety = async (personnelId: Id<"personnel">) => {
    if (!user) return;
    setSavingId(personnelId);
    try {
      await markReview({ personnelId, completedBy: user._id as Id<"users"> });
    } finally {
      setSavingId(null);
    }
  };

  const handleQuickMarkAnnual = async (personnelId: Id<"personnel">, cycleYear: number) => {
    if (!user) return;
    setSavingId(personnelId);
    try {
      await markAnnual({ personnelId, cycleYear, completedBy: user._id as Id<"users"> });
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
      const title = tab === "ninety"
        ? `90-Day Reviews — ${locLabel}`
        : `Annual Reviews — ${locLabel}`;
      const subtitle = `${overdue.length} overdue · ${dueSoon.length} due ${tab === "ninety" ? "in 14d" : `in ${ANNUAL_DUE_SOON_DAYS}d`}${tab === "ninety" ? ` · ${completed.length} completed` : ""}  ·  Ran: ${ranDate} ${ranTime}`;

      const drawHeaderFooter = () => {
        doc.setFontSize(13); doc.setFont("helvetica", "bold");
        doc.text(title, pageWidth / 2, 40, { align: "center" });
        doc.setFontSize(9); doc.setFont("helvetica", "normal");
        doc.text(subtitle, pageWidth / 2, 56, { align: "center" });
        doc.setFontSize(8);
        doc.text(`Generated ${ranDate}`, 36, pageHeight - 24);
      };

      if (tab === "ninety") {
        const formatStatus = (r: (typeof ninetyRows)[number]) => {
          if (r.review) return `✓ ${new Date(r.review.completedAt).toLocaleDateString()} by ${r.review.completedByName}`;
          if (r.daysToReview <= 0) return `OVERDUE — ${Math.abs(r.daysToReview)}d past due`;
          return `Due in ${r.daysToReview}d`;
        };

        const body = [...overdue, ...dueSoon, ...upcoming, ...(showCompleted ? completed : [])].map((r) => {
          const rr = r as (typeof ninetyRows)[number];
          return [
            rr.name,
            rr.position || "",
            rr.locationName,
            new Date(rr.hireDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
            rr.reviewDueDate,
            formatStatus(rr),
          ];
        });

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
      } else {
        const body = [...overdue, ...dueSoon, ...upcoming].map((r) => {
          const rr = r as (typeof annualRows)[number];
          const status = rr.daysToReview <= 0
            ? `OVERDUE — ${Math.abs(rr.daysToReview)}d past due`
            : `Due in ${rr.daysToReview}d`;
          const last = rr.lastCompleted
            ? `${rr.lastCompleted.cycleYear} by ${rr.lastCompleted.completedByName} on ${new Date(rr.lastCompleted.completedAt).toLocaleDateString()}`
            : "—";
          return [
            rr.name,
            rr.position || "",
            rr.locationName,
            new Date(rr.hireDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
            rr.nextDue.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
            String(rr.cycleYear),
            last,
            status,
          ];
        });

        autoTable(doc, {
          head: [["Name", "Position", "Location", "Hire Date", "Next Anniversary", "Cycle", "Last Reviewed", "Status"]],
          body,
          startY: 76,
          margin: { top: 76, bottom: 50, left: 28, right: 28 },
          styles: { fontSize: 9, cellPadding: 4, overflow: "linebreak" },
          headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "left" },
          columnStyles: {
            0: { cellWidth: 100, fontStyle: "bold" },
            1: { cellWidth: 80 },
            2: { cellWidth: 60 },
            3: { cellWidth: 60 },
            4: { cellWidth: 65 },
            5: { cellWidth: 38 },
            6: { cellWidth: 95 },
            7: { cellWidth: "auto" },
          },
          didDrawPage: drawHeaderFooter,
        });
      }

      const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 36, pageHeight - 24, { align: "right" });
      }

      const filename = tab === "ninety"
        ? `ninety_day_reviews_${ranDate.replace(/\//g, "")}.pdf`
        : `annual_reviews_${ranDate.replace(/\//g, "")}.pdf`;
      doc.save(filename);
    } finally {
      setGenerating(false);
    }
  };

  // ===== Render helpers =====
  const ninetySection = (
    label: string,
    items: typeof ninetyRows,
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
                  <td className="px-5 py-2 text-right whitespace-nowrap">
                    {(() => { const er = reviewByPersonnel.get(r.id as unknown as string); return er && er.averageScore != null ? (
                      <span className={`mr-2 text-xs ${isDark ? "text-slate-300" : "text-gray-600"}`}>avg {er.averageScore.toFixed(1)}{er.decision !== "pending" ? ` · ${er.decision}` : ""}</span>
                    ) : null; })()}
                    {canManagePersonnel && (
                      <button
                        onClick={() => openScore(r.id)}
                        disabled={openingScore === r.id}
                        className="text-xs font-semibold text-white px-2.5 py-1 rounded-lg mr-2 disabled:opacity-50"
                        style={{ backgroundColor: "#FF9500" }}
                        title="Enter scores, see the recommended raise, and approve/deny"
                      >
                        {openingScore === r.id ? "…" : "Score"}
                      </button>
                    )}
                    {!r.review && canManagePersonnel && (
                      <button
                        onClick={() => handleQuickMarkNinety(r.id)}
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

  const annualSection = (
    label: string,
    items: typeof annualRows,
    accentClass: string,
    emptyMessage: string,
  ) => (
    <div className={`rounded-2xl border overflow-hidden ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
      <div className={`px-5 py-3 border-b flex items-center justify-between ${isDark ? "border-slate-700" : "border-gray-200"}`}>
        <h2 className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
          <span className={accentClass}>{label}</span>
          <span className={`ml-2 font-normal ${isDark ? "text-slate-500" : "text-gray-500"}`}>{items.length}</span>
        </h2>
      </div>
      {items.length === 0 ? (
        <div className={`p-5 text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>{emptyMessage}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={isDark ? "bg-slate-900/40" : "bg-gray-50"}>
              <tr className={isDark ? "text-slate-400" : "text-gray-600"}>
                <th className="text-left px-5 py-2 font-medium">Name</th>
                <th className="text-left px-5 py-2 font-medium">Position</th>
                <th className="text-left px-5 py-2 font-medium">Location</th>
                <th className="text-left px-5 py-2 font-medium">Hire Date</th>
                <th className="text-left px-5 py-2 font-medium">Next Anniversary</th>
                <th className="text-left px-5 py-2 font-medium">Cycle</th>
                <th className="text-left px-5 py-2 font-medium">Last Reviewed</th>
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
                  <td className={`px-5 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    {r.nextDue.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className={`px-5 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{r.cycleYear}</td>
                  <td className={`px-5 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    {r.lastCompleted
                      ? `${r.lastCompleted.cycleYear} — ${r.lastCompleted.completedByName}`
                      : "—"}
                  </td>
                  <td className={`px-5 py-2 ${accentClass} font-medium`}>
                    {r.daysToReview <= 0
                      ? `${Math.abs(r.daysToReview)}d past due`
                      : `in ${r.daysToReview}d`}
                  </td>
                  <td className="px-5 py-2 text-right whitespace-nowrap">
                    {(() => { const er = reviewByPersonnel.get(r.id as unknown as string); return er && er.averageScore != null ? (
                      <span className={`mr-2 text-xs ${isDark ? "text-slate-300" : "text-gray-600"}`}>avg {er.averageScore.toFixed(1)}{er.decision !== "pending" ? ` · ${er.decision}` : ""}</span>
                    ) : null; })()}
                    {canManagePersonnel && (
                      <button
                        onClick={() => openScore(r.id)}
                        disabled={openingScore === r.id}
                        className="text-xs font-semibold text-white px-2.5 py-1 rounded-lg mr-2 disabled:opacity-50"
                        style={{ backgroundColor: "#FF9500" }}
                        title="Enter scores, see the recommended raise, and approve/deny"
                      >
                        {openingScore === r.id ? "…" : "Score"}
                      </button>
                    )}
                    {r.daysToReview <= 0 && canManagePersonnel && (
                      <button
                        onClick={() => handleQuickMarkAnnual(r.id, r.cycleYear)}
                        disabled={savingId === r.id}
                        className="text-xs font-semibold text-white px-2.5 py-1 rounded-lg disabled:opacity-50"
                        style={{ backgroundColor: "#34C759" }}
                        title={`Mark ${r.cycleYear} annual review complete by you`}
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

  const tabButton = (key: Tab, label: string, count: number) => {
    const active = tab === key;
    return (
      <button
        onClick={() => setTab(key)}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
          active
            ? "bg-[#007AFF] text-white shadow-sm"
            : isDark
              ? "theme-text-secondary hover:theme-text-primary theme-bg-hover"
              : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
        }`}
      >
        {label}
        <span className={`ml-1.5 text-[11px] ${active ? "opacity-80" : "opacity-60"}`}>{count}</span>
      </button>
    );
  };

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
                Review Tracker
              </h1>
              <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                90-day reviews and annual reviews — who's overdue, who's coming up, and who's done
              </p>
            </div>
          </div>
        </header>

        <div className="p-8 max-w-6xl space-y-5">
          {/* Tabs */}
          <div className={`inline-flex items-center gap-1 rounded-full p-1 ${isDark ? "bg-slate-800/60 border border-slate-700" : "bg-gray-100"}`}>
            {tabButton("ninety", "90-Day", ninetyRows.length)}
            {tabButton("annual", "Annual", annualRows.length)}
          </div>

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
                {tab === "ninety" ? (
                  <label className={`flex items-center gap-2 text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    <input
                      type="checkbox"
                      checked={showCompleted}
                      onChange={(e) => setShowCompleted(e.target.checked)}
                      className="rounded"
                    />
                    Show completed reviews
                  </label>
                ) : null}
              </div>
              <div className="flex items-end justify-end gap-2">
                <button
                  onClick={() => printForms("due")}
                  disabled={overdue.length + dueSoon.length === 0}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 ${isDark ? "bg-orange-500 hover:bg-orange-400 text-white" : "bg-orange-600 hover:bg-orange-700 text-white"}`}
                  title="Print a pre-filled blank form for each person due (overdue + due-soon)"
                >
                  Print Forms ({overdue.length + dueSoon.length})
                </button>
                <button
                  onClick={() => { setPrintSummary(true); setTimeout(() => window.print(), 80); }}
                  disabled={!(empReviews && empReviews.some((r) => r.averageScore != null))}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 ${isDark ? "bg-slate-600 hover:bg-slate-500 text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-800"}`}
                  title="Print a scores + recommended-raise summary for Terry"
                >
                  Print Summary
                </button>
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
              <span className={`font-semibold ${isDark ? "text-amber-400" : "text-amber-600"}`}>{dueSoon.length}</span>
              {" "}due within {tab === "ninety" ? "14" : ANNUAL_DUE_SOON_DAYS} days
              <span className={`mx-3 ${isDark ? "text-slate-600" : "text-gray-300"}`}>·</span>
              <span className={`font-semibold ${isDark ? "text-slate-400" : "text-gray-500"}`}>{upcoming.length}</span> upcoming
              {tab === "ninety" && (
                <>
                  <span className={`mx-3 ${isDark ? "text-slate-600" : "text-gray-300"}`}>·</span>
                  <span className={`font-semibold ${isDark ? "text-green-400" : "text-green-600"}`}>{completed.length}</span> completed
                </>
              )}
            </div>
          </div>

          {tab === "ninety" ? (
            <>
              {ninetySection("Overdue", overdue as typeof ninetyRows, isDark ? "text-red-400" : "text-red-600", true)}
              {ninetySection("Due Within 14 Days", dueSoon as typeof ninetyRows, isDark ? "text-amber-400" : "text-amber-600", false)}
              {ninetySection("Upcoming", upcoming as typeof ninetyRows, isDark ? "text-slate-400" : "text-gray-500", false)}
              {showCompleted && ninetySection("Completed", completed, isDark ? "text-green-400" : "text-green-600", false)}
            </>
          ) : (
            <>
              {annualSection("Overdue", overdue as typeof annualRows, isDark ? "text-red-400" : "text-red-600", "None overdue — nice.")}
              {annualSection(`Due Within ${ANNUAL_DUE_SOON_DAYS} Days`, dueSoon as typeof annualRows, isDark ? "text-amber-400" : "text-amber-600", "None in this window.")}
              {annualSection("Upcoming", upcoming as typeof annualRows, isDark ? "text-slate-400" : "text-gray-500", "No upcoming anniversaries (or no one with 1+ year tenure).")}
            </>
          )}
        </div>
      </main>

      {/* Inline score-entry + approve/deny modal */}
      {scoreReviewId && user?._id && (
        <ReviewScorePanel
          reviewId={scoreReviewId}
          reqId={user._id}
          userName={user.name ?? user.email ?? "Unknown"}
          isDark={isDark}
          onClose={() => setScoreReviewId(null)}
        />
      )}

      {/* Pre-filled forms for printing (portal to body). Print CSS is only injected
          while forms are queued, so normal Ctrl+P of the tracker is unaffected. */}
      {mounted && (printPeople.length > 0 || printSummary) && createPortal(
        <div id="rv-forms-print-root">
          {printPeople.length > 0
            ? printPeople.map((p, i) => (
              <ReviewPrintForm key={i} person={p} type={reviewType} />
            ))
            : <ReviewSummaryPrint rows={(empReviews ?? []) as any} type={reviewType} />}
        </div>,
        document.body,
      )}
      {mounted && (printPeople.length > 0 || printSummary) && (
        <style dangerouslySetInnerHTML={{ __html: `
          #rv-forms-print-root { display: none; }
          @media print {
            @page { size: letter portrait; margin: 0.5in; }
            body > :not(#rv-forms-print-root) { display: none !important; }
            #rv-forms-print-root { display: block !important; color: #000; }
          }
        ` }} />
      )}
    </div>
  );
}

export default function NinetyDayReviewsPage() {
  return (
    <Protected minTier={5}>
      <NinetyDayReviewsContent />
    </Protected>
  );
}
