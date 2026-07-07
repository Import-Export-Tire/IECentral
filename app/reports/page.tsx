"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { usePermissions } from "@/lib/usePermissions";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useMemo } from "react";
import Link from "next/link";
import { REPORT_TYPES, REPORT_GROUPS } from "@/lib/reportTypes";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";

// CSV export utility
function exportToCSV(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(","),
    ...data.map((row) =>
      headers
        .map((h) => {
          const value = String(row[h] ?? "");
          // Escape quotes and wrap in quotes if contains comma, quote, or newline
          if (value.includes(",") || value.includes('"') || value.includes("\n")) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        })
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${new Date().toISOString().split("T")[0]}.csv`;
  link.click();
}

type ReportType = "personnel" | "applications" | "hiring" | "attendance" | "equipment" | "weekly" | "sales";

function ReportsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const searchParams = useSearchParams();

  const { user } = useAuth();
  const permissions = usePermissions();
  const savedConfigs = useQuery(api.savedReports.list);
  const [showHub, setShowHub] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeReport, setActiveReport] = useState<ReportType>("personnel");
  const [appStatus, setAppStatus] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [equipmentTypeFilter, setEquipmentTypeFilter] = useState("all");

  // Weekly overview date range (defaults to current week)
  const getWeekDates = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    return {
      start: startOfWeek.toISOString().split("T")[0],
      end: endOfWeek.toISOString().split("T")[0],
    };
  };
  const weekDates = getWeekDates();
  const [weeklyStartDate, setWeeklyStartDate] = useState(weekDates.start);
  const [weeklyEndDate, setWeeklyEndDate] = useState(weekDates.end);

  // HR/Employment views are super-admin only — non-super-admins get
  // redirected back to the hub even if they have the URL.
  const HR_LOCKED_VIEWS = new Set(["personnel", "applications", "hiring"]);

  // Read URL params on mount
  useEffect(() => {
    const type = searchParams.get("type");
    const view = searchParams.get("view");
    const equipmentType = searchParams.get("equipmentType");

    const validViews = ["personnel", "applications", "hiring", "attendance", "equipment", "weekly", "sales"];
    const selected = view || type;

    if (selected && validViews.includes(selected)) {
      // Block HR-locked views for non-super-admins.
      if (HR_LOCKED_VIEWS.has(selected) && permissions.tier < 5) {
        setShowHub(true);
        return;
      }
      setActiveReport(selected as ReportType);
      setShowHub(false);
    }
    if (equipmentType) {
      setEquipmentTypeFilter(equipmentType);
    }
  }, [searchParams, permissions.tier]); // eslint-disable-line react-hooks/exhaustive-deps

  // Queries
  const personnel = useQuery(api.reports.getPersonnelExport);
  const applications = useQuery(api.reports.getApplicationsExport, {
    status: appStatus === "all" ? undefined : appStatus,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  });
  const hiringReport = useQuery(api.reports.getHiringReport, {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  });
  const equipmentReport = useQuery(api.reports.getEquipmentReport);
  const attendanceReport = useQuery(
    api.reports.getAttendanceReport,
    startDate && endDate ? { startDate, endDate } : "skip"
  );
  const weeklyOverview = useQuery(
    api.dailyLogs.getWeeklyOverview,
    weeklyStartDate && weeklyEndDate
      ? { startDate: weeklyStartDate, endDate: weeklyEndDate }
      : "skip"
  );

  const reportTypes: { id: ReportType; label: string; icon: string; description: string }[] = [
    {
      id: "personnel",
      label: "Personnel",
      icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
      description: "Export all personnel records with contact info, departments, and status",
    },
    {
      id: "attendance",
      label: "Attendance",
      icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
      description: "View attendance records, late arrivals, and time tracking data",
    },
    {
      id: "applications",
      label: "Applications",
      icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
      description: "Export job applications with scores, status, and interview info",
    },
    {
      id: "hiring",
      label: "Hiring Analytics",
      icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
      description: "View hiring metrics, conversion rates, and job-specific analytics",
    },
    {
      id: "equipment",
      label: "Equipment",
      icon: "M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z",
      description: "Export scanner and picker inventory with assignments",
    },
    {
      id: "weekly",
      label: "Weekly Overview",
      icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
      description: "Weekly summary of daily activity logs for stakeholders",
    },
    {
      id: "sales",
      label: "Sales Dashboard",
      icon: "M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
      description: "Visual sales analytics from JMK data — revenue, brands, locations, trends",
    },
  ];

  const handleExport = () => {
    switch (activeReport) {
      case "personnel":
        if (personnel) exportToCSV(personnel, "personnel_export");
        break;
      case "attendance":
        if (attendanceReport) exportToCSV(attendanceReport.records, "attendance_export");
        break;
      case "applications":
        if (applications) exportToCSV(applications, "applications_export");
        break;
      case "hiring":
        if (hiringReport) {
          exportToCSV(hiringReport.byJob, "hiring_by_job");
        }
        break;
      case "equipment":
        if (equipmentReport) exportToCSV(equipmentReport.equipment, "equipment_export");
        break;
      case "weekly":
        if (weeklyOverview) {
          // Create flattened export data from weekly overview
          const exportData = weeklyOverview.userSummaries.flatMap((user) =>
            user.logs.map((log) => ({
              userName: user.userName,
              date: log.date,
              summary: log.summary,
              accomplishments: log.accomplishments.join("; "),
              blockers: log.blockers || "",
              goalsForTomorrow: log.goalsForTomorrow || "",
              hoursWorked: log.hoursWorked || 0,
              projectsCreated: log.autoActivities?.projectsCreated || 0,
              projectsMoved: log.autoActivities?.projectsMoved || 0,
              tasksCompleted: log.autoActivities?.tasksCompleted || 0,
              totalActions: log.autoActivities?.totalActions || 0,
            }))
          );
          exportToCSV(exportData, `weekly_overview_${weeklyStartDate}_${weeklyEndDate}`);
        }
        break;
    }
  };

  return (
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Sticky iOS-style page header */}
        <header className="sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-6 py-3 sm:py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {!showHub && (
                <button
                  onClick={() => setShowHub(true)}
                  className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </button>
              )}
              <div>
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">
                  {showHub ? "Reports" : reportTypes.find((r) => r.id === activeReport)?.label || "Report"}
                </h1>
                <p className="text-xs sm:text-sm mt-1 theme-text-tertiary">
                  {showHub ? "Select a report to view" : "Generate and export data"}
                </p>
              </div>
            </div>
          </div>
        </header>

        <div className="px-4 sm:px-6 py-5 space-y-6">
          {/* Card Hub */}
          {showHub ? (
            <div className="space-y-6">
              {/* Search */}
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search reports..."
                  className="theme-input w-full pl-10 pr-4 py-2.5 text-sm"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 theme-text-tertiary hover:theme-text-secondary"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {REPORT_GROUPS.map((group) => {
                // Saved configs group — render dynamically from Convex
                if (group.id === "saved") {
                  const configs = savedConfigs || [];
                  let filteredConfigs = configs;
                  if (searchQuery) {
                    const q = searchQuery.toLowerCase();
                    filteredConfigs = configs.filter((c: { name: string; description?: string }) =>
                      c.name.toLowerCase().includes(q) || (c.description || "").toLowerCase().includes(q)
                    );
                  }
                  if (filteredConfigs.length === 0) return null;

                  return (
                    <div key={group.id}>
                      <div className="flex items-center gap-2 mb-3">
                        <svg className="w-4 h-4 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={group.icon} />
                        </svg>
                        <h2 className="text-sm font-semibold uppercase tracking-wider theme-text-tertiary">{group.label}</h2>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {filteredConfigs.map((config: { _id: string; name: string; description?: string; sources: string[]; autoRun: boolean }) => (
                          <Link key={config._id} href={`/reports/saved/${config._id}`}>
                            <div className="group theme-card p-5 transition-all cursor-pointer hover:shadow-md">
                              <div className="flex items-start gap-4">
                                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-50 dark:bg-amber-500/10 group-hover:bg-amber-100 dark:group-hover:bg-amber-500/20">
                                  <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                                  </svg>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="text-sm font-semibold theme-text-primary">{config.name}</h3>
                                  <p className="text-xs mt-0.5 theme-text-secondary">
                                    {config.description || config.sources.join(" + ")}
                                  </p>
                                  {config.autoRun && (
                                    <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">Auto-run</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                }

                // Per-report permission gating — each report has its own `report.<id>`
                // permission (defaults preserve prior tier visibility; overridable per user).
                let groupReports = REPORT_TYPES.filter(
                  (r) => r.group === group.id && permissions.hasPermission(`report.${r.id}`),
                );
                // Filter by search
                if (searchQuery) {
                  const q = searchQuery.toLowerCase();
                  groupReports = groupReports.filter((r) =>
                    r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)
                  );
                }
                if (groupReports.length === 0) return null;

                return (
                  <div key={group.id}>
                    <div className="flex items-center gap-2 mb-3">
                      <svg className="w-4 h-4 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={group.icon} />
                      </svg>
                      <h2 className="text-sm font-semibold uppercase tracking-wider theme-text-tertiary">
                        {group.label}
                      </h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 auto-rows-fr">
                      {groupReports.map((report) => {
                        // External links go to their own pages
                        if (report.external) {
                          return (
                            <Link key={report.id} href={report.href} className="block h-full">
                              <div className="group theme-card p-5 h-full min-h-[7.5rem] transition-all cursor-pointer hover:shadow-md">
                                <div className="flex items-start gap-4">
                                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-blue-50 dark:bg-cyan-500/10 group-hover:bg-blue-100 dark:group-hover:bg-cyan-500/20">
                                    <svg className="w-5 h-5 text-blue-600 dark:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={report.icon} />
                                    </svg>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h3 className="text-sm font-semibold theme-text-primary">{report.title}</h3>
                                    <p className="text-xs mt-0.5 theme-text-secondary">{report.description}</p>
                                  </div>
                                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5 theme-text-tertiary opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </div>
                              </div>
                            </Link>
                          );
                        }

                        // Internal reports activate the report view
                        const reportId = report.id as ReportType;
                        return (
                          <button
                            key={report.id}
                            onClick={() => { setActiveReport(reportId); setShowHub(false); }}
                            className="text-left group theme-card p-5 h-full min-h-[7.5rem] transition-all cursor-pointer hover:shadow-md w-full"
                          >
                            <div className="flex items-start gap-4">
                              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-blue-50 dark:bg-cyan-500/10 group-hover:bg-blue-100 dark:group-hover:bg-cyan-500/20">
                                <svg className="w-5 h-5 text-blue-600 dark:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={report.icon} />
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-semibold theme-text-primary">{report.title}</h3>
                                <p className="text-xs mt-0.5 theme-text-secondary">{report.description}</p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Report Content */}
          <div className={showHub ? "hidden" : ""}>

            {/* Filters */}
            {(activeReport === "applications" || activeReport === "hiring" || activeReport === "attendance" || activeReport === "weekly") && (
              <Card padding="md" className="mb-4">
                <SectionHeader label="Filters" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {activeReport === "applications" && (
                    <div>
                      <label className="block text-xs ui-section-label mb-1">Status</label>
                      <select
                        value={appStatus}
                        onChange={(e) => setAppStatus(e.target.value)}
                        className="theme-input w-full px-3 py-2 text-sm"
                      >
                        <option value="all">All Statuses</option>
                        <option value="new">New</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="contacted">Contacted</option>
                        <option value="scheduled">Interview Scheduled</option>
                        <option value="interviewed">Interviewed</option>
                        <option value="hired">Hired</option>
                        <option value="rejected">Rejected</option>
                        <option value="dns">Did Not Show</option>
                        <option value="expired">Expired</option>
                      </select>
                    </div>
                  )}
                  {activeReport !== "weekly" ? (
                    <>
                      <div>
                        <label className="block text-xs ui-section-label mb-1">Start Date</label>
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="theme-input w-full px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs ui-section-label mb-1">End Date</label>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="theme-input w-full px-3 py-2 text-sm"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs ui-section-label mb-1">Week Start</label>
                        <input
                          type="date"
                          value={weeklyStartDate}
                          onChange={(e) => setWeeklyStartDate(e.target.value)}
                          className="theme-input w-full px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs ui-section-label mb-1">Week End</label>
                        <input
                          type="date"
                          value={weeklyEndDate}
                          onChange={(e) => setWeeklyEndDate(e.target.value)}
                          className="theme-input w-full px-3 py-2 text-sm"
                        />
                      </div>
                    </>
                  )}
                </div>
              </Card>
            )}

            {/* Report Content Card */}
            <Card padding="md">
              <SectionHeader
                title={`${reportTypes.find((r) => r.id === activeReport)?.label} Report`}
                actions={
                  <Button variant="primary" onClick={handleExport}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Export CSV
                  </Button>
                }
              />

              {/* Personnel Report */}
              {activeReport === "personnel" && (
                <div className="overflow-x-auto">
                  {personnel ? (
                    <>
                      <p className="mb-4 text-sm theme-text-secondary">
                        {personnel.length} personnel records
                      </p>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b theme-border-secondary">
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Name</th>
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Position</th>
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Department</th>
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Status</th>
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Hire Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {personnel.slice(0, 10).map((p) => (
                            <tr key={p.id} className="border-t theme-border-secondary hover:bg-black/3 dark:hover:bg-white/3">
                              <td className="py-2 px-3 font-medium theme-text-primary">
                                {p.firstName} {p.lastName}
                              </td>
                              <td className="py-2 px-3 theme-text-secondary">{p.position}</td>
                              <td className="py-2 px-3 theme-text-secondary">{p.department}</td>
                              <td className="py-2 px-3">
                                <span className={`px-2 py-0.5 text-xs rounded-full ${
                                  p.status === "active"
                                    ? "bg-green-500/20 text-green-600 dark:text-green-400"
                                    : "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400"
                                }`}>
                                  {p.status}
                                </span>
                              </td>
                              <td className="py-2 px-3 theme-text-secondary">{p.hireDate}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {personnel.length > 10 && (
                        <p className="mt-4 text-sm theme-text-tertiary">
                          Showing 10 of {personnel.length} records. Export to see all.
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex justify-center py-8">
                      <div className="w-8 h-8 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              )}

              {/* Applications Report */}
              {activeReport === "applications" && (
                <div className="overflow-x-auto">
                  {applications ? (
                    <>
                      <p className="mb-4 text-sm theme-text-secondary">
                        {applications.length} applications
                      </p>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b theme-border-secondary">
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Name</th>
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Position</th>
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Score</th>
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Status</th>
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Applied</th>
                          </tr>
                        </thead>
                        <tbody>
                          {applications.slice(0, 10).map((a) => (
                            <tr key={a.id} className="border-t theme-border-secondary hover:bg-black/3 dark:hover:bg-white/3">
                              <td className="py-2 px-3 font-medium theme-text-primary">
                                {a.firstName} {a.lastName}
                              </td>
                              <td className="py-2 px-3 theme-text-secondary">{a.appliedJobTitle}</td>
                              <td className="py-2 px-3">
                                {a.overallScore ? (
                                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                                    Number(a.overallScore) >= 70 ? "bg-green-500/20 text-green-600 dark:text-green-400" :
                                    Number(a.overallScore) >= 50 ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" :
                                    "bg-red-500/20 text-red-600 dark:text-red-400"
                                  }`}>
                                    {a.overallScore}%
                                  </span>
                                ) : "-"}
                              </td>
                              <td className="py-2 px-3 theme-text-secondary">{a.status}</td>
                              <td className="py-2 px-3 theme-text-secondary">
                                {new Date(a.createdAt).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {applications.length > 10 && (
                        <p className="mt-4 text-sm theme-text-tertiary">
                          Showing 10 of {applications.length} records. Export to see all.
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex justify-center py-8">
                      <div className="w-8 h-8 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              )}

              {/* Hiring Analytics */}
              {activeReport === "hiring" && hiringReport && (
                <div className="space-y-6">
                  {/* Summary KPI Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/50 border theme-border-secondary">
                      <p className="text-2xl font-bold theme-text-primary">{hiringReport.summary.totalApplications}</p>
                      <p className="text-sm theme-text-secondary mt-1">Total Applications</p>
                    </div>
                    <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/50 border theme-border-secondary">
                      <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{hiringReport.summary.hired}</p>
                      <p className="text-sm theme-text-secondary mt-1">Hired</p>
                    </div>
                    <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/50 border theme-border-secondary">
                      <p className="text-2xl font-bold text-[#007AFF]">{hiringReport.summary.hireRate}%</p>
                      <p className="text-sm theme-text-secondary mt-1">Hire Rate</p>
                    </div>
                    <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/50 border theme-border-secondary">
                      <p className="text-2xl font-bold theme-text-primary">{hiringReport.summary.avgHiredScore || "-"}%</p>
                      <p className="text-sm theme-text-secondary mt-1">Avg Hired Score</p>
                    </div>
                  </div>

                  {/* By Job Table — applicant quality per listing */}
                  <div>
                    <div className="flex items-baseline justify-between mb-3">
                      <div className="ui-section-label">By Position — applicant quality</div>
                      <div className="text-xs theme-text-tertiary">
                        Overall avg applicant score: <span className="font-semibold theme-text-primary">{hiringReport.summary.avgScore || "—"}</span>
                        {" · "}amber = below overall (candidate for a listing tweak)
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b theme-border-secondary">
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Position</th>
                            <th className="text-right py-2 px-3 text-xs font-semibold theme-text-tertiary">Avg score</th>
                            <th className="text-right py-2 px-3 text-xs font-semibold theme-text-tertiary">Scored</th>
                            <th className="text-right py-2 px-3 text-xs font-semibold theme-text-tertiary">Total</th>
                            <th className="text-right py-2 px-3 text-xs font-semibold theme-text-tertiary">Hired</th>
                            <th className="text-right py-2 px-3 text-xs font-semibold theme-text-tertiary">Hire Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...hiringReport.byJob]
                            .sort((a, b) => {
                              // Lowest avg score first (weak listings surface at top); no-score last.
                              if (a.avgScore == null && b.avgScore == null) return b.total - a.total;
                              if (a.avgScore == null) return 1;
                              if (b.avgScore == null) return -1;
                              return a.avgScore - b.avgScore;
                            })
                            .map((job) => {
                              const overall = hiringReport.summary.avgScore;
                              const lowSample = job.scoredCount > 0 && job.scoredCount < 3;
                              const belowAvg = job.avgScore != null && job.scoredCount >= 3 && overall > 0 && job.avgScore < overall;
                              return (
                                <tr key={job.jobTitle} className="border-t theme-border-secondary hover:bg-black/3 dark:hover:bg-white/3">
                                  <td className="py-2 px-3 font-medium theme-text-primary">{job.jobTitle}</td>
                                  <td className={`py-2 px-3 text-right font-semibold tabular-nums ${belowAvg ? "text-[#b25e00] dark:text-[#ffc266]" : "theme-text-primary"}`}>
                                    {job.avgScore != null ? job.avgScore : "—"}
                                    {lowSample && <span className="ml-1 text-[10px] font-normal theme-text-tertiary">low sample</span>}
                                  </td>
                                  <td className="py-2 px-3 text-right theme-text-tertiary tabular-nums">{job.scoredCount}</td>
                                  <td className="py-2 px-3 text-right theme-text-secondary tabular-nums">{job.total}</td>
                                  <td className="py-2 px-3 text-right text-emerald-600 dark:text-emerald-400 tabular-nums">{job.hired}</td>
                                  <td className="py-2 px-3 text-right text-[#007AFF] tabular-nums">{job.hireRate}%</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] theme-text-tertiary mt-2">
                      Score = AI overall applicant score (0–100). Averages exclude applicants without a score; &ldquo;low sample&rdquo; = fewer than 3 scored applicants.
                    </p>
                  </div>

                  {/* Applicant-quality trend over time */}
                  <div>
                    <div className="ui-section-label mb-3">Average applicant score over time</div>
                    {hiringReport.scoreByMonth.length === 0 ? (
                      <p className="text-sm theme-text-tertiary py-6 text-center">No scored applicants in this period.</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={260}>
                        <LineChart
                          data={hiringReport.scoreByMonth.map((m) => ({
                            label: `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m.month.split("-")[1]) - 1]} '${m.month.slice(2, 4)}`,
                            avgScore: m.avgScore,
                            count: m.count,
                          }))}
                          margin={{ top: 8, right: 16, left: 8, bottom: 4 }}
                        >
                          <CartesianGrid stroke={isDark ? "#334155" : "#E5E7EB"} strokeDasharray="3 3" />
                          <XAxis dataKey="label" tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                          <YAxis domain={[0, 100]} tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                          <Tooltip
                            contentStyle={{ background: isDark ? "#0F172A" : "#FFFFFF", border: `1px solid ${isDark ? "#334155" : "#E5E7EB"}`, borderRadius: 12 }}
                            formatter={(v, _n, item) => {
                              const count = (item as { payload?: { count?: number } })?.payload?.count;
                              return [count != null ? `${v} (${count} scored)` : `${v}`, "Avg score"];
                            }}
                          />
                          {hiringReport.summary.avgScore > 0 && (
                            <ReferenceLine
                              y={hiringReport.summary.avgScore}
                              stroke={isDark ? "#64748B" : "#9CA3AF"}
                              strokeDasharray="4 3"
                              label={{ value: `overall ${hiringReport.summary.avgScore}`, position: "insideTopRight", fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }}
                            />
                          )}
                          <Line type="monotone" dataKey="avgScore" name="Avg score" stroke="#007AFF" strokeWidth={2} dot connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              )}

              {/* Equipment Report */}
              {activeReport === "equipment" && equipmentReport && (() => {
                // Get unique equipment types and sort them
                const equipmentTypes = [...new Set(equipmentReport.equipment.map(eq => eq.type))].sort();

                // Filter equipment by selected type
                const filteredEquipment = equipmentTypeFilter === "all"
                  ? equipmentReport.equipment
                  : equipmentReport.equipment.filter(eq => eq.type === equipmentTypeFilter);

                // Sort by type, then by number
                const sortedEquipment = [...filteredEquipment].sort((a, b) => {
                  const typeCompare = a.type.localeCompare(b.type);
                  if (typeCompare !== 0) return typeCompare;
                  return (a.number || "").localeCompare(b.number || "");
                });

                return (
                  <div className="space-y-6">
                    {/* Filter by Type */}
                    <div className="flex items-center gap-3">
                      <span className="ui-section-label">Filter by Type:</span>
                      <select
                        value={equipmentTypeFilter}
                        onChange={(e) => setEquipmentTypeFilter(e.target.value)}
                        className="theme-input px-3 py-2 text-sm"
                      >
                        <option value="all">All Equipment ({equipmentReport.equipment.length})</option>
                        {equipmentTypes.map(type => {
                          const count = equipmentReport.equipment.filter(eq => eq.type === type).length;
                          return (
                            <option key={type} value={type}>{type} ({count})</option>
                          );
                        })}
                      </select>
                    </div>

                    {/* Summary KPI Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/50 border theme-border-secondary">
                        <p className="text-2xl font-bold theme-text-primary">{equipmentReport.summary.totalScanners}</p>
                        <p className="text-sm theme-text-secondary mt-1">Scanners</p>
                      </div>
                      <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/50 border theme-border-secondary">
                        <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{equipmentReport.summary.scannersAvailable}</p>
                        <p className="text-sm theme-text-secondary mt-1">Available</p>
                      </div>
                      <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/50 border theme-border-secondary">
                        <p className="text-2xl font-bold theme-text-primary">{equipmentReport.summary.totalPickers}</p>
                        <p className="text-sm theme-text-secondary mt-1">Pickers</p>
                      </div>
                      <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/50 border theme-border-secondary">
                        <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{equipmentReport.summary.pickersAvailable}</p>
                        <p className="text-sm theme-text-secondary mt-1">Available</p>
                      </div>
                    </div>

                    {/* Equipment Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b theme-border-secondary">
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Type</th>
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Number</th>
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Model</th>
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Status</th>
                            <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Assigned To</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedEquipment.map((eq, i) => (
                            <tr key={i} className="border-t theme-border-secondary hover:bg-black/3 dark:hover:bg-white/3">
                              <td className="py-2 px-3 font-medium theme-text-primary">{eq.type}</td>
                              <td className="py-2 px-3 theme-text-secondary">#{eq.number}</td>
                              <td className="py-2 px-3 theme-text-secondary">{eq.model || "-"}</td>
                              <td className="py-2 px-3">
                                <span className={`px-2 py-0.5 text-xs rounded-full ${
                                  eq.status === "available" ? "bg-green-500/20 text-green-600 dark:text-green-400" :
                                  eq.status === "assigned" ? "bg-blue-500/20 text-[#007AFF]" :
                                  eq.status === "inactive" ? "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400" :
                                  eq.status === "inoperable" ? "bg-red-500/20 text-red-600 dark:text-red-400" :
                                  "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                                }`}>
                                  {eq.status}
                                </span>
                              </td>
                              <td className="py-2 px-3 theme-text-secondary">{eq.assignedTo || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-sm theme-text-tertiary">
                      Showing {sortedEquipment.length} of {equipmentReport.equipment.length} total equipment items
                    </p>
                  </div>
                );
              })()}

              {/* Attendance Report */}
              {activeReport === "attendance" && (
                <div className="space-y-6">
                  {!startDate || !endDate ? (
                    <div className="text-center py-8 theme-text-secondary">
                      <svg className="w-12 h-12 mx-auto mb-4 theme-text-tertiary opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <p>Select a date range to view attendance records</p>
                    </div>
                  ) : attendanceReport ? (
                    <>
                      {/* Summary Cards */}
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {attendanceReport.summary.map((s) => (
                          <div key={s.name} className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/50 border theme-border-secondary">
                            <p className="font-medium truncate theme-text-primary">{s.name}</p>
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-emerald-600 dark:text-emerald-400 text-sm">{s.present}P</span>
                              <span className="text-amber-600 dark:text-amber-400 text-sm">{s.late}L</span>
                              <span className="text-red-500 dark:text-red-400 text-sm">{s.absent}A</span>
                            </div>
                            <p className="text-xs mt-1 theme-text-tertiary">{s.attendanceRate}% attendance</p>
                          </div>
                        ))}
                      </div>

                      {/* Records Table */}
                      <div className="overflow-x-auto">
                        <p className="mb-4 text-sm theme-text-secondary">
                          {attendanceReport.records.length} attendance records
                        </p>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b theme-border-secondary">
                              <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Date</th>
                              <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Employee</th>
                              <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Status</th>
                              <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Scheduled</th>
                              <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Actual</th>
                              <th className="text-left py-2 px-3 text-xs font-semibold theme-text-tertiary">Hours</th>
                            </tr>
                          </thead>
                          <tbody>
                            {attendanceReport.records.slice(0, 20).map((r) => (
                              <tr key={r.id} className="border-t theme-border-secondary hover:bg-black/3 dark:hover:bg-white/3">
                                <td className="py-2 px-3 theme-text-primary">{r.date}</td>
                                <td className="py-2 px-3 theme-text-secondary">{r.personnelName}</td>
                                <td className="py-2 px-3">
                                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                                    r.status === "present" ? "bg-green-500/20 text-green-600 dark:text-green-400" :
                                    r.status === "late" ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" :
                                    r.status === "excused" ? "bg-blue-500/20 text-[#007AFF]" :
                                    "bg-red-500/20 text-red-600 dark:text-red-400"
                                  }`}>
                                    {r.status.replace("_", " ")}
                                  </span>
                                </td>
                                <td className="py-2 px-3 theme-text-secondary">{r.scheduledStart} - {r.scheduledEnd}</td>
                                <td className="py-2 px-3 theme-text-secondary">{r.actualStart || "-"} - {r.actualEnd || "-"}</td>
                                <td className="py-2 px-3 theme-text-secondary">{r.hoursWorked.toFixed(1)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {attendanceReport.records.length > 20 && (
                          <p className="mt-4 text-sm theme-text-tertiary">
                            Showing 20 of {attendanceReport.records.length} records. Export to see all.
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-center py-8">
                      <div className="w-8 h-8 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              )}

              {/* Weekly Overview Report */}
              {activeReport === "weekly" && (
                <div className="space-y-6">
                  {weeklyOverview ? (
                    <>
                      {/* Date Range Header */}
                      <div className="text-sm theme-text-secondary">
                        Week of {new Date(weeklyOverview.startDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} - {new Date(weeklyOverview.endDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>

                      {/* Summary KPI Cards */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/50 border theme-border-secondary">
                          <p className="text-2xl font-bold theme-text-primary">{weeklyOverview.totals.totalLogs}</p>
                          <p className="text-sm theme-text-secondary mt-1">Logs Submitted</p>
                        </div>
                        <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/50 border theme-border-secondary">
                          <p className="text-2xl font-bold text-[#007AFF]">{weeklyOverview.totals.totalHours.toFixed(1)}</p>
                          <p className="text-sm theme-text-secondary mt-1">Hours Worked</p>
                        </div>
                        <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/50 border theme-border-secondary">
                          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{weeklyOverview.totals.totalAccomplishments}</p>
                          <p className="text-sm theme-text-secondary mt-1">Accomplishments</p>
                        </div>
                        <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/50 border theme-border-secondary">
                          <p className="text-2xl font-bold theme-text-primary">{weeklyOverview.totals.uniqueUsers}</p>
                          <p className="text-sm theme-text-secondary mt-1">Team Members</p>
                        </div>
                      </div>

                      {/* Per-User Breakdown */}
                      {weeklyOverview.userSummaries.length > 0 ? (
                        <div>
                          <div className="ui-section-label mb-3">Per-User Breakdown</div>
                          <div className="space-y-4">
                            {weeklyOverview.userSummaries.map((user) => (
                              <div
                                key={user.userId}
                                className="theme-card p-4"
                              >
                                <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium bg-[#007AFF]">
                                      {user.userName.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                                    </div>
                                    <div>
                                      <p className="font-medium theme-text-primary">{user.userName}</p>
                                      <p className="text-sm theme-text-tertiary">
                                        {user.daysLogged} day{user.daysLogged !== 1 ? "s" : ""} logged &middot; {user.totalHours.toFixed(1)} hours
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-4 text-sm">
                                    <span className="text-emerald-600 dark:text-emerald-400">
                                      {user.totalAccomplishments} accomplishments
                                    </span>
                                    {user.blockers.length > 0 && (
                                      <span className="text-amber-600 dark:text-amber-400">
                                        {user.blockers.length} blocker{user.blockers.length !== 1 ? "s" : ""}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Expandable Details */}
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-sm theme-text-tertiary hover:theme-text-secondary">
                                    View daily details
                                  </summary>
                                  <div className="mt-3 space-y-3">
                                    {user.logs
                                      .sort((a, b) => a.date.localeCompare(b.date))
                                      .map((log) => (
                                        <div
                                          key={log._id}
                                          className="border-l-2 pl-3 theme-border-secondary"
                                        >
                                          <p className="text-sm font-medium theme-text-secondary">
                                            {new Date(log.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                            {log.hoursWorked && (
                                              <span className="ml-2 font-normal theme-text-tertiary">
                                                ({log.hoursWorked}h)
                                              </span>
                                            )}
                                          </p>
                                          <p className="text-sm mt-1 theme-text-secondary">{log.summary}</p>
                                          {log.accomplishments.length > 0 && (
                                            <ul className="mt-2 text-sm list-disc list-inside text-emerald-700 dark:text-emerald-400/80">
                                              {log.accomplishments.map((acc, i) => (
                                                <li key={i}>{acc}</li>
                                              ))}
                                            </ul>
                                          )}
                                          {log.blockers && (
                                            <p className="mt-2 text-sm text-amber-700 dark:text-amber-400/80">
                                              <span className="font-medium">Blocker:</span> {log.blockers}
                                            </p>
                                          )}
                                        </div>
                                      ))}
                                  </div>
                                </details>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-8 theme-text-secondary">
                          <svg className="w-12 h-12 mx-auto mb-4 theme-text-tertiary opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <p>No submitted daily logs for this week</p>
                          <p className="text-sm mt-1 theme-text-tertiary">
                            Team members can submit daily logs from the Daily Log page
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex justify-center py-8">
                      <div className="w-8 h-8 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              )}

              {activeReport === "sales" && (
                <SalesDashboard isDark={isDark} />
              )}
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SALES DASHBOARD COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const CHART_COLORS = ["#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#3b82f6", "#f97316", "#14b8a6", "#6366f1", "#84cc16", "#e11d48"];
const LOC_NAMES: Record<string, string> = {
  W07: "Uniontown (W07)", W08: "Latrobe (W08)", W09: "Chestnut Ridge (W09)",
  R10: "Everson (R10)", R20: "TRD/Essey (R20)", R25: "Command Trax (R25)", R35: "King Super (R35)", R15: "R15",
};

interface SalesRow {
  date: string; item_id: string; description: string; product_type: string;
  brand: string; mfg_item: string; loc: string; trn: string;
  qty: number; price: number; ext_sell: number; account: string; customer: string;
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function fmtMonth(yyyymm: string) {
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[parseInt(yyyymm.slice(4,6),10)-1]} ${yyyymm.slice(0,4)}`;
}

interface AggData {
  kpis: { totalRevenue: number; totalUnits: number; avgPrice: number; uniqueCustomers: number };
  byLocation: { name: string; units: number; revenue: number }[];
  byBrand: { name: string; units: number; revenue: number }[];
  dailyTrend: { date: string; units: number; revenue: number }[];
  byTrnType: { name: string; value: number }[];
  topCustomers: { account: string; name: string; units: number; revenue: number; txns: number }[];
  uniqueLocations: string[];
  dowByLocation: { loc: string; totalRevenue: number; saturdayRevenue: number; saturdayPct: number; saturdayUnits: number; saturdayTransactions: number; days: { day: string; revenue: number; units: number; transactions: number; pct: number }[] }[];
  customerAccounts?: string[];
}

interface CompareData {
  current: AggData;
  currentMonth: string;
  prevMonth: { month: string; data: AggData | null };
  yoyMonth: { month: string; data: AggData | null };
  monthlyTrend: { month: string; revenue: number; units: number; customers: number; hasData: boolean }[];
  allLocations?: string[];
}

function pctChange(current: number, previous: number): number | null {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function ChangeBadge({ current, previous, format = "pct", isDark }: { current: number; previous: number | undefined; format?: "pct" | "val"; isDark: boolean }) {
  if (previous === undefined || previous === 0) return null;
  const change = pctChange(current, previous);
  if (change === null) return null;
  const isUp = change > 0;
  const isDown = change < 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${
      isUp ? isDark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600"
        : isDown ? isDark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
        : isDark ? "bg-slate-700 text-slate-400" : "bg-gray-100 text-gray-500"
    }`}>
      {isUp ? "↑" : isDown ? "↓" : "→"}{Math.abs(change).toFixed(1)}%
    </span>
  );
}

function SalesDashboard({ isDark }: { isDark: boolean }) {
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [compareData, setCompareData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [allLocations, setAllLocations] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set()); // empty = all

  // Derived data
  const agg = compareData?.current || null;
  const prevAgg = compareData?.prevMonth?.data || null;
  const yoyAgg = compareData?.yoyMonth?.data || null;
  const monthlyTrend = compareData?.monthlyTrend || [];

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/sales");
        if (res.ok) {
          const { available } = await res.json();
          setAvailableMonths(available || []);
          if (available?.length > 0) setSelectedMonth(available[0]);
        }
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (!selectedMonth) return;
    (async () => {
      setLoading(true);
      try {
        const locParam = selectedLocations.size > 0 ? `&locations=${[...selectedLocations].join(",")}` : "";
        const res = await fetch(`/api/sales?months=${selectedMonth}&compare=true${locParam}`);
        if (res.ok) {
          const data = await res.json();
          setCompareData(data);
          // Set all locations from response (only on first load or when no filter active)
          if (data.allLocations && allLocations.length === 0) {
            setAllLocations(data.allLocations);
          }
        }
      } catch {} finally { setLoading(false); }
    })();
  }, [selectedMonth, selectedLocations]);

  const byLocation = useMemo(() => (agg?.byLocation || []).map(l => ({ ...l, name: LOC_NAMES[l.name] || l.name })), [agg]);
  const prevByLocation = useMemo(() => (prevAgg?.byLocation || []).map(l => ({ ...l, name: LOC_NAMES[l.name] || l.name })), [prevAgg]);
  const byBrand = agg?.byBrand || [];
  const dailyTrend = useMemo(() => (agg?.dailyTrend || []).map(d => ({ ...d, date: d.date.slice(5) })), [agg]);
  const byTrnType = agg?.byTrnType || [];
  const topCustomers = agg?.topCustomers || [];
  const kpis = agg?.kpis || { totalRevenue: 0, totalUnits: 0, avgPrice: 0, uniqueCustomers: 0 };
  const prevKpis = prevAgg?.kpis;
  const yoyKpis = yoyAgg?.kpis;

  // Customer retention: how many of last month's customers are still buying
  const retentionRate = useMemo(() => {
    if (!agg?.customerAccounts || !prevAgg?.customerAccounts) return null;
    const currentSet = new Set(agg.customerAccounts);
    const prevSet = prevAgg.customerAccounts;
    if (prevSet.length === 0) return null;
    const retained = prevSet.filter(a => currentSet.has(a)).length;
    return Math.round((retained / prevSet.length) * 100);
  }, [agg, prevAgg]);

  // Location comparison data for MoM chart
  const locationComparison = useMemo(() => {
    if (!byLocation.length) return [];
    return byLocation.map(loc => {
      const prev = prevByLocation.find(p => p.name === loc.name);
      return {
        name: loc.name.replace(/ \(.*\)/, ""), // Short name for chart
        current: loc.revenue,
        previous: prev?.revenue || 0,
      };
    });
  }, [byLocation, prevByLocation]);

  // Monthly trend for sparkline
  const trendData = useMemo(() => monthlyTrend.filter(m => m.hasData), [monthlyTrend]);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (availableMonths.length === 0) return (
    <div className="text-center py-16 theme-text-secondary">
      <p className="text-lg font-medium theme-text-primary">No sales data yet</p>
      <p className="text-sm mt-1 theme-text-tertiary">Upload a JMK report through the Dunlop Reporting tool to populate the dashboard.</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="theme-input px-3 py-1.5 text-sm"
        >
          {availableMonths.map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}
        </select>

        {/* Location filter */}
        {allLocations.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs ui-section-label mr-1">Locations:</span>
            <button
              onClick={() => setSelectedLocations(new Set())}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                selectedLocations.size === 0
                  ? "bg-[#007AFF]/15 text-[#007AFF] font-medium"
                  : "theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              All
            </button>
            {allLocations.map(loc => {
              const isSelected = selectedLocations.has(loc);
              return (
                <button
                  key={loc}
                  onClick={() => {
                    setSelectedLocations(prev => {
                      const next = new Set(prev);
                      if (isSelected) {
                        next.delete(loc);
                      } else {
                        next.add(loc);
                      }
                      return next;
                    });
                  }}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    isSelected
                      ? "bg-[#007AFF]/15 text-[#007AFF] font-medium"
                      : "theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  {LOC_NAMES[loc]?.replace(/ \(.*\)/, "") || loc}
                </button>
              );
            })}
          </div>
        )}

        {prevAgg && (
          <span className="text-xs theme-text-tertiary">
            vs {fmtMonth(compareData?.prevMonth?.month || "")} (MoM)
            {yoyAgg && ` / ${fmtMonth(compareData?.yoyMonth?.month || "")} (YoY)`}
          </span>
        )}
      </div>

      {/* KPI Cards with MoM/YoY badges */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="theme-card p-5">
          <p className="text-xs font-medium theme-text-tertiary">Total Revenue</p>
          <p className="text-2xl font-bold theme-text-primary mt-1">{fmtCurrency(kpis.totalRevenue)}</p>
          <div className="flex items-center gap-2 mt-1">
            {prevKpis && <ChangeBadge current={kpis.totalRevenue} previous={prevKpis.totalRevenue} isDark={isDark} />}
            {yoyKpis && <span className="text-[10px] theme-text-tertiary">YoY: <ChangeBadge current={kpis.totalRevenue} previous={yoyKpis.totalRevenue} isDark={isDark} /></span>}
          </div>
        </div>
        <div className="theme-card p-5">
          <p className="text-xs font-medium theme-text-tertiary">Units Sold</p>
          <p className="text-2xl font-bold theme-text-primary mt-1">{kpis.totalUnits.toLocaleString()}</p>
          <div className="flex items-center gap-2 mt-1">
            {prevKpis && <ChangeBadge current={kpis.totalUnits} previous={prevKpis.totalUnits} isDark={isDark} />}
            {yoyKpis && <span className="text-[10px] theme-text-tertiary">YoY: <ChangeBadge current={kpis.totalUnits} previous={yoyKpis.totalUnits} isDark={isDark} /></span>}
          </div>
        </div>
        <div className="theme-card p-5">
          <p className="text-xs font-medium theme-text-tertiary">Avg Price / Unit</p>
          <p className="text-2xl font-bold theme-text-primary mt-1">{fmtCurrency(kpis.avgPrice)}</p>
          <div className="flex items-center gap-2 mt-1">
            {prevKpis && <ChangeBadge current={kpis.avgPrice} previous={prevKpis.avgPrice} isDark={isDark} />}
          </div>
        </div>
        <div className="theme-card p-5">
          <p className="text-xs font-medium theme-text-tertiary">Unique Customers</p>
          <p className="text-2xl font-bold theme-text-primary mt-1">{kpis.uniqueCustomers.toLocaleString()}</p>
          <div className="flex items-center gap-2 mt-1">
            {prevKpis && <ChangeBadge current={kpis.uniqueCustomers} previous={prevKpis.uniqueCustomers} isDark={isDark} />}
            {retentionRate !== null && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#007AFF]/10 text-[#007AFF]">
                {retentionRate}% retained
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Monthly Revenue Trend (12mo sparkline) */}
      {trendData.length > 1 && (
        <div className="theme-card p-5">
          <h3 className="text-sm font-semibold theme-text-primary mb-4">Monthly Revenue Trend</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e5e7eb"} />
              <XAxis dataKey="month" stroke={isDark ? "#94a3b8" : "#6b7280"} fontSize={11} tickFormatter={(m) => fmtMonth(m).slice(0, 3)} />
              <YAxis stroke={isDark ? "#94a3b8" : "#6b7280"} fontSize={11} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ backgroundColor: isDark ? "#1e293b" : "#fff", border: `1px solid ${isDark ? "#334155" : "#e5e7eb"}`, borderRadius: 8, color: isDark ? "#e2e8f0" : "#1f2937" }} labelStyle={{ color: isDark ? "#94a3b8" : "#6b7280" }}
                formatter={(value) => [fmtCurrency(Number(value)), "Revenue"]}
                labelFormatter={(m) => fmtMonth(String(m))} />
              <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                {trendData.map((entry, i) => (
                  <Cell key={i} fill={entry.month === selectedMonth ? "#06b6d4" : isDark ? "#334155" : "#cbd5e1"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Location MoM Comparison */}
      {locationComparison.length > 0 && prevAgg && (
        <div className="theme-card p-5">
          <h3 className="text-sm font-semibold theme-text-primary mb-1">Revenue by Location — Month over Month</h3>
          <p className="text-xs theme-text-tertiary mb-4">{fmtMonth(selectedMonth)} vs {fmtMonth(compareData?.prevMonth?.month || "")}</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={locationComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e5e7eb"} />
              <XAxis dataKey="name" stroke={isDark ? "#94a3b8" : "#6b7280"} fontSize={11} />
              <YAxis stroke={isDark ? "#94a3b8" : "#6b7280"} fontSize={11} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ backgroundColor: isDark ? "#1e293b" : "#fff", border: `1px solid ${isDark ? "#334155" : "#e5e7eb"}`, borderRadius: 8, color: isDark ? "#e2e8f0" : "#1f2937" }} labelStyle={{ color: isDark ? "#94a3b8" : "#6b7280" }}
                formatter={(value) => [fmtCurrency(Number(value))]} />
              <Bar dataKey="previous" name={fmtMonth(compareData?.prevMonth?.month || "")} fill={isDark ? "#475569" : "#cbd5e1"} radius={[4, 4, 0, 0]} />
              <Bar dataKey="current" name={fmtMonth(selectedMonth)} fill="#06b6d4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Daily Trend */}
      <div className="theme-card p-5">
        <h3 className="text-sm font-semibold theme-text-primary mb-4">Daily Revenue</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={dailyTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e5e7eb"} />
            <XAxis dataKey="date" stroke={isDark ? "#94a3b8" : "#6b7280"} fontSize={12} />
            <YAxis stroke={isDark ? "#94a3b8" : "#6b7280"} fontSize={12} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
            <Tooltip contentStyle={{ backgroundColor: isDark ? "#1e293b" : "#fff", border: `1px solid ${isDark ? "#334155" : "#e5e7eb"}`, borderRadius: 8, color: isDark ? "#e2e8f0" : "#1f2937" }} labelStyle={{ color: isDark ? "#94a3b8" : "#6b7280" }} formatter={(value) => [fmtCurrency(Number(value)), "Revenue"]} />
            <Line type="monotone" dataKey="revenue" stroke="#06b6d4" strokeWidth={2} dot={{ fill: "#06b6d4", r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Two column charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="theme-card p-5">
          <h3 className="text-sm font-semibold theme-text-primary mb-4">Revenue by Location</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byLocation} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e5e7eb"} />
              <XAxis type="number" stroke={isDark ? "#94a3b8" : "#6b7280"} fontSize={12} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" stroke={isDark ? "#94a3b8" : "#6b7280"} fontSize={11} width={130} />
              <Tooltip contentStyle={{ backgroundColor: isDark ? "#1e293b" : "#fff", border: `1px solid ${isDark ? "#334155" : "#e5e7eb"}`, borderRadius: 8, color: isDark ? "#e2e8f0" : "#1f2937" }} labelStyle={{ color: isDark ? "#94a3b8" : "#6b7280" }} formatter={(value) => [fmtCurrency(Number(value)), "Revenue"]} />
              <Bar dataKey="revenue" fill="#06b6d4" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="theme-card p-5">
          <h3 className="text-sm font-semibold theme-text-primary mb-4">Top Brands by Revenue</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byBrand} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e5e7eb"} />
              <XAxis type="number" stroke={isDark ? "#94a3b8" : "#6b7280"} fontSize={12} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" stroke={isDark ? "#94a3b8" : "#6b7280"} fontSize={11} width={60} />
              <Tooltip contentStyle={{ backgroundColor: isDark ? "#1e293b" : "#fff", border: `1px solid ${isDark ? "#334155" : "#e5e7eb"}`, borderRadius: 8, color: isDark ? "#e2e8f0" : "#1f2937" }} labelStyle={{ color: isDark ? "#94a3b8" : "#6b7280" }} formatter={(value) => [fmtCurrency(Number(value)), "Revenue"]} />
              <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>{byBrand.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="theme-card p-5">
          <h3 className="text-sm font-semibold theme-text-primary mb-4">Transaction Types</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={byTrnType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                {byTrnType.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="theme-card p-5">
          <h3 className="text-sm font-semibold theme-text-primary mb-4">Units by Location</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byLocation}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e5e7eb"} />
              <XAxis dataKey="name" stroke={isDark ? "#94a3b8" : "#6b7280"} fontSize={10} angle={-20} textAnchor="end" height={60} />
              <YAxis stroke={isDark ? "#94a3b8" : "#6b7280"} fontSize={12} />
              <Tooltip contentStyle={{ backgroundColor: isDark ? "#1e293b" : "#fff", border: `1px solid ${isDark ? "#334155" : "#e5e7eb"}`, borderRadius: 8, color: isDark ? "#e2e8f0" : "#1f2937" }} labelStyle={{ color: isDark ? "#94a3b8" : "#6b7280" }} />
              <Bar dataKey="units" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Day-of-Week Analysis */}
      {agg?.dowByLocation && agg.dowByLocation.length > 0 && (
        <div className="theme-card p-5">
          <h3 className="text-sm font-semibold theme-text-primary mb-2">Day-of-Week Revenue by Location</h3>
          <p className="text-xs theme-text-tertiary mb-4">
            Shows what % of each location&apos;s revenue falls on each day — useful for evaluating Saturday hours.
          </p>

          {/* Saturday summary */}
          <div className="rounded-xl p-4 mb-4 bg-amber-50 dark:bg-slate-700/30">
            <h4 className="text-xs font-semibold uppercase mb-2 text-amber-700 dark:text-amber-400">Saturday Impact</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {agg.dowByLocation.filter((d: { saturdayTransactions: number }) => d.saturdayTransactions > 0).map((d: { loc: string; saturdayPct: number; saturdayRevenue: number; saturdayUnits: number; saturdayTransactions: number }) => (
                <div key={d.loc} className="text-center p-2 rounded-lg theme-card">
                  <p className="text-xs font-medium theme-text-tertiary">{LOC_NAMES[d.loc] || d.loc}</p>
                  <p className={`text-lg font-bold ${d.saturdayPct > 15 ? "text-emerald-600 dark:text-emerald-400" : "theme-text-primary"}`}>{d.saturdayPct}%</p>
                  <p className="text-[10px] theme-text-tertiary">{fmtCurrency(d.saturdayRevenue)} / {d.saturdayUnits} units</p>
                </div>
              ))}
            </div>
          </div>

          {/* Full heatmap table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b theme-border-secondary">
                  <th className="px-3 py-2 text-left text-xs font-semibold theme-text-tertiary">Location</th>
                  {[{d:"Mon",l:"M"},{d:"Tue",l:"T"},{d:"Wed",l:"W"},{d:"Thu",l:"T"},{d:"Fri",l:"F"},{d:"Sat",l:"Sa"}].map(({d,l}) => (
                    <th key={d} className={`px-3 py-2 text-center text-xs font-semibold ${d === "Sat" ? "text-amber-600 dark:text-amber-400" : "theme-text-tertiary"}`}>{l}</th>
                  ))}
                  <th className="px-3 py-2 text-right text-xs font-semibold theme-text-tertiary">Total</th>
                </tr>
              </thead>
              <tbody>
                {agg.dowByLocation.map((loc: { loc: string; totalRevenue: number; days: { day: string; revenue: number; pct: number }[] }) => (
                  <tr key={loc.loc} className="border-t theme-border-secondary">
                    <td className="px-3 py-2 font-medium text-xs theme-text-primary">{LOC_NAMES[loc.loc] || loc.loc}</td>
                    {loc.days.filter(d => d.day !== "Sun").map(d => {
                      const intensity = Math.min(d.pct / 25, 1);
                      const bg = d.day === "Sat"
                        ? `rgba(${isDark ? "251,191,36" : "217,119,6"}, ${intensity * 0.4})`
                        : `rgba(${isDark ? "6,182,212" : "8,145,178"}, ${intensity * 0.4})`;
                      return (
                        <td key={d.day} className="px-3 py-2 text-center" style={{ backgroundColor: bg }}>
                          <span className="text-xs font-mono font-bold theme-text-primary">{d.pct}%</span>
                          <br />
                          <span className="text-[10px] theme-text-tertiary">{fmtCurrency(d.revenue)}</span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">{fmtCurrency(loc.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Customers */}
      <div className="theme-card p-5">
        <h3 className="text-sm font-semibold theme-text-primary mb-4">Top 20 Customers</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border-secondary">
                {["#", "Customer", "Revenue", "Units", "Txns", "Avg/Unit"].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold theme-text-tertiary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topCustomers.map((c, i) => (
                <tr key={i} className="border-t theme-border-secondary hover:bg-black/3 dark:hover:bg-white/3">
                  <td className="px-3 py-2 theme-text-tertiary">{i+1}</td>
                  <td className="px-3 py-2 font-medium theme-text-primary">{c.name}</td>
                  <td className="px-3 py-2 font-mono text-emerald-600 dark:text-emerald-400">{fmtCurrency(c.revenue)}</td>
                  <td className="px-3 py-2 theme-text-secondary">{c.units}</td>
                  <td className="px-3 py-2 theme-text-secondary">{(c as { txns: number }).txns}</td>
                  <td className="px-3 py-2 font-mono theme-text-tertiary">{c.units > 0 ? fmtCurrency(c.revenue / c.units) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Protected>
      <ReportsContent />
    </Protected>
  );
}
