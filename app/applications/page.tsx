"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { useAuth } from "../auth-context";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/ui/StatusBadge";
import ScorePill from "@/components/ui/ScorePill";

type Application = Doc<"applications">;

// Single source of truth for application statuses. `terminal` marks states that
// aren't part of the normal workflow (dns = did-not-show, expired = auto-expired);
// they're excluded from the Kanban board and stats row but must still be selectable
// in the table so an application already in one of them isn't silently changed.
const STATUS_OPTIONS: { value: string; label: string; terminal?: boolean }[] = [
  { value: "new", label: "New" },
  { value: "reviewed", label: "Reviewed" },
  { value: "contacted", label: "Contacted" },
  { value: "scheduled", label: "Scheduled" },
  { value: "interviewed", label: "Interviewed" },
  { value: "hired", label: "Hired" },
  { value: "rejected", label: "Rejected" },
  { value: "dns", label: "Did Not Show", terminal: true },
  { value: "expired", label: "Expired", terminal: true },
];

// Workflow statuses only — Kanban columns + stats row (matches what the backend
// groups and counts).
const WORKFLOW_STATUSES = STATUS_OPTIONS.filter((s) => !s.terminal);

// Sort order derived from the canonical list (no separate hand-maintained map).
const STATUS_ORDER: Record<string, number> = Object.fromEntries(
  STATUS_OPTIONS.map((s, i) => [s.value, i]),
);

type ToastState = { msg: string; tone: "success" | "error" } | null;

function ApplicationsContent() {
  const { user } = useAuth();
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");

  // `applications` powers Top Candidates (both views) + the table; always needed.
  // `groupedApplications` is only used by the Kanban board, so skip that full-table
  // read entirely while in table view (the default) — avoids fetching everything twice.
  const applicationsRaw = useQuery(api.applications.getAll, { includeArchived: showArchived });
  const applications = useMemo(() => applicationsRaw ?? [], [applicationsRaw]);
  const isLoading = applicationsRaw === undefined;
  const groupedApplications = useQuery(
    api.applications.getByStatusGrouped,
    viewMode === "kanban" ? { includeArchived: showArchived } : "skip",
  );
  const stats = useQuery(api.applications.getStats);
  const recentInterviews = useQuery(api.applications.getRecentlyInterviewed) || [];
  const jobs = useQuery(api.jobs.getAll) || [];
  const updateStatus = useMutation(api.applications.updateStatus);
  const updateStatusWithActivity = useMutation(api.applications.updateStatusWithActivity);
  const updateAppliedJob = useMutation(api.applications.updateAppliedJob);
  const deleteApplication = useMutation(api.applications.remove);
  const archiveApplication = useMutation(api.applications.archive);
  const unarchiveApplication = useMutation(api.applications.unarchive);
  const archiveRejected = useMutation(api.applications.archiveRejected);

  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterDepartment, setFilterDepartment] = useState<string>("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const [deleteConfirmId, setDeleteConfirmId] = useState<Id<"applications"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [sortBy, setSortBy] = useState<"score" | "position" | "date" | "status">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [draggedApp, setDraggedApp] = useState<Id<"applications"> | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<Id<"applications"> | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  // Lightweight transient toast (no toast lib in this app yet).
  const showToast = useCallback((msg: string, tone: "success" | "error" = "success") => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Dismiss any open modal on Escape.
  useEffect(() => {
    if (!deleteConfirmId && !showHelp && !showArchiveConfirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDeleteConfirmId(null);
        setShowHelp(false);
        setShowArchiveConfirm(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteConfirmId, showHelp, showArchiveConfirm]);

  // Job lookup as a Map (was an O(n) find() called once per row inside the filter).
  const jobsById = useMemo(() => new Map(jobs.map((j) => [j._id, j])), [jobs]);
  const getJobById = useCallback(
    (jobId: Id<"jobs"> | undefined) => (jobId ? jobsById.get(jobId) : undefined),
    [jobsById],
  );

  const departments = useMemo(
    () => [...new Set(jobs.map((j) => j.department))].sort(),
    [jobs],
  );
  const locations = useMemo(
    () => [...new Set(jobs.flatMap((j) => j.locations || [j.location]))].sort(),
    [jobs],
  );

  const handleJobChange = async (applicationId: Id<"applications">, jobId: Id<"jobs">) => {
    try {
      await updateAppliedJob({ applicationId, jobId });
      setEditingJobId(null);
      showToast("Position updated");
    } catch (error) {
      console.error("Failed to update job:", error);
      showToast("Couldn't update position", "error");
    }
  };

  const handleSort = (column: "score" | "position" | "date" | "status") => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder(column === "score" ? "desc" : "asc");
    }
  };

  const filteredApplications = useMemo(() => {
    return applications
      .filter((app) => {
        const matchesStatus = filterStatus === "all" || app.status === filterStatus;

        const job = getJobById(app.appliedJobId);
        const matchesDepartment =
          filterDepartment === "all" || job?.department === filterDepartment;

        const jobLocations = job?.locations || (job?.location ? [job.location] : []);
        const matchesLocation =
          filterLocation === "all" ||
          app.appliedLocation === filterLocation ||
          jobLocations.includes(filterLocation);

        const normalizedSearch = searchTerm.replace(/\D/g, "");
        const normalizedPhone = app.phone?.replace(/\D/g, "") || "";
        const matchesPhone =
          normalizedSearch.length >= 3 && normalizedPhone.includes(normalizedSearch);

        const matchesSearch =
          searchTerm === "" ||
          `${app.firstName} ${app.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
          app.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
          app.appliedJobTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
          matchesPhone;
        return matchesStatus && matchesSearch && matchesDepartment && matchesLocation;
      })
      .sort((a, b) => {
        let comparison = 0;
        if (sortBy === "score") {
          comparison = (a.candidateAnalysis?.overallScore ?? -1) - (b.candidateAnalysis?.overallScore ?? -1);
        } else if (sortBy === "position") {
          comparison = a.appliedJobTitle.localeCompare(b.appliedJobTitle);
        } else if (sortBy === "date") {
          comparison = a.createdAt - b.createdAt;
        } else if (sortBy === "status") {
          comparison = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
        }
        return sortOrder === "asc" ? comparison : -comparison;
      });
  }, [applications, filterStatus, filterDepartment, filterLocation, searchTerm, sortBy, sortOrder, getJobById]);

  const topCandidates = useMemo(
    () =>
      applications
        .filter(
          (app) =>
            app.candidateAnalysis?.overallScore &&
            app.status !== "hired" &&
            app.status !== "rejected",
        )
        .sort((a, b) => (b.candidateAnalysis?.overallScore || 0) - (a.candidateAnalysis?.overallScore || 0))
        .slice(0, 3),
    [applications],
  );

  const handleStatusChange = async (applicationId: Id<"applications">, newStatus: string) => {
    try {
      await updateStatus({ applicationId, status: newStatus });
    } catch (error) {
      console.error("Failed to update status:", error);
      showToast("Couldn't update status", "error");
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    setIsDeleting(true);
    try {
      await deleteApplication({ applicationId: deleteConfirmId });
      setDeleteConfirmId(null);
      showToast("Application deleted");
    } catch (error) {
      console.error("Failed to delete application:", error);
      showToast("Couldn't delete application", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleArchiveRejected = async () => {
    setIsArchiving(true);
    try {
      const result = await archiveRejected();
      setShowArchiveConfirm(false);
      showToast(`Archived ${result.archived} application${result.archived !== 1 ? "s" : ""}`);
    } catch (error) {
      console.error("Failed to archive rejected:", error);
      showToast("Couldn't archive applications", "error");
    } finally {
      setIsArchiving(false);
    }
  };

  const handleArchiveToggle = async (app: Application) => {
    try {
      if (app.isArchived) {
        await unarchiveApplication({ applicationId: app._id });
        showToast("Application restored");
      } else {
        await archiveApplication({ applicationId: app._id });
        showToast("Application archived");
      }
    } catch (error) {
      console.error("Failed to toggle archive:", error);
      showToast("Couldn't update application", "error");
    }
  };

  const copyEmail = (email: string) => {
    navigator.clipboard.writeText(email).then(
      () => showToast("Email copied"),
      () => showToast("Couldn't copy email", "error"),
    );
  };

  const canDeleteApplications = user?.role === "super_admin" || user?.role === "admin";

  // Kanban drag and drop handlers
  const handleDragStart = (appId: Id<"applications">) => setDraggedApp(appId);
  const handleDragEnd = () => {
    setDraggedApp(null);
    setDragOverColumn(null);
  };
  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    setDragOverColumn(status);
  };
  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    if (!draggedApp || !user) return;
    const app = applications.find((a) => a._id === draggedApp);
    if (!app || app.status === newStatus) {
      handleDragEnd();
      return;
    }
    try {
      await updateStatusWithActivity({ applicationId: draggedApp, newStatus, userId: user._id });
    } catch (error) {
      console.error("Failed to move application:", error);
      showToast("Couldn't move application", "error");
    }
    handleDragEnd();
  };

  const getDaysInStatus = (app: Application) =>
    Math.floor((Date.now() - app.createdAt) / (1000 * 60 * 60 * 24));
  const isNewApplication = (app: Application) => Date.now() - app.createdAt < 24 * 60 * 60 * 1000;

  const sortArrow = (col: "score" | "position" | "date" | "status") =>
    sortBy === col ? (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortOrder === "asc" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
      </svg>
    ) : null;

  const thSortClass = (col: string) =>
    `text-left px-6 py-4 text-sm font-medium cursor-pointer select-none transition-colors ${
      sortBy === col ? "text-[#007AFF]" : "theme-text-tertiary hover:theme-text-secondary"
    }`;

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Header */}
        <header className="sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Applications</h1>
              <p className="text-xs sm:text-sm mt-1 hidden sm:block theme-text-tertiary">
                Review and manage job applications
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              {/* View Toggle */}
              <div className="flex items-center p-1 rounded-lg bg-gray-100 dark:bg-slate-700">
                {(["table", "kanban"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setViewMode(m)}
                    className={`px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                      viewMode === m
                        ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm"
                        : "text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-white"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {m === "table" ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                      )}
                    </svg>
                    <span className="hidden sm:inline capitalize">{m}</span>
                  </button>
                ))}
              </div>

              {/* Show Archived Toggle */}
              <label className="flex items-center gap-2 cursor-pointer theme-text-tertiary">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#007AFF]"
                />
                <span className="text-xs sm:text-sm hidden sm:inline">Show Archived</span>
              </label>

              <Button variant="secondary" onClick={() => setShowArchiveConfirm(true)}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
                <span className="hidden sm:inline">Archive Rejected</span>
              </Button>

              <button
                onClick={() => setShowHelp(true)}
                className="p-2 rounded-[9px] transition-colors theme-text-tertiary hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700"
                title="Applications Help"
                aria-label="Applications Help"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>

              <Button variant="primary" onClick={() => router.push("/applications/bulk-upload")}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="hidden sm:inline">Bulk Upload</span>
                <span className="sm:hidden">Upload</span>
              </Button>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
              <div className="theme-card p-4 text-center">
                <p className="text-base sm:text-lg font-bold theme-text-primary">{stats.total}</p>
                <p className="ui-section-label">Total</p>
              </div>
              {WORKFLOW_STATUSES.map((status) => (
                <div key={status.value} className="theme-card p-4 text-center">
                  <p className="text-base sm:text-lg font-bold theme-text-primary">
                    {stats[status.value as keyof typeof stats] || 0}
                  </p>
                  <p className="ui-section-label truncate">{status.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Top Candidates Section */}
          {topCandidates.length > 0 && (
            <Card padding="md">
              <SectionHeader title="Top Candidates" label="Highest scoring active applicants" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {topCandidates.map((app, index) => (
                  <div
                    key={app._id}
                    onClick={() => router.push(`/applications/${app._id}`)}
                    className="theme-card p-4 cursor-pointer transition-all hover:scale-[1.02] relative"
                  >
                    <div className={`absolute -top-2 -left-2 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      index === 0 ? "bg-yellow-500 text-yellow-900" : index === 1 ? "bg-gray-300 text-gray-700" : "bg-amber-600 text-amber-100"
                    }`}>
                      #{index + 1}
                    </div>
                    <div className="absolute top-3 right-3">
                      <StatusBadge status={app.status} kind="applicant" />
                    </div>
                    <div className="flex items-start justify-between mb-3 pr-20">
                      <div>
                        <p className="font-semibold theme-text-primary">{app.firstName} {app.lastName}</p>
                        <p className="text-sm theme-text-secondary">{app.appliedJobTitle}</p>
                      </div>
                      <ScorePill score={app.candidateAnalysis?.overallScore} size="sm" />
                    </div>
                    <div className="flex gap-4 text-xs">
                      <div>
                        <span className="theme-text-tertiary">Stability: </span>
                        <span className="theme-text-secondary">{app.candidateAnalysis?.stabilityScore}</span>
                      </div>
                      <div>
                        <span className="theme-text-tertiary">Experience: </span>
                        <span className="theme-text-secondary">{app.candidateAnalysis?.experienceScore}</span>
                      </div>
                    </div>
                    {app.candidateAnalysis?.recommendedAction && (
                      <div className={`mt-3 inline-block ui-badge ${
                        app.candidateAnalysis.recommendedAction === "strong_candidate" ? "ui-badge-green"
                        : app.candidateAnalysis.recommendedAction === "worth_interviewing" ? "ui-badge-blue"
                        : "ui-badge-gray"
                      }`}>
                        {app.candidateAnalysis.recommendedAction.replace(/_/g, " ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Recent Interviews Section */}
          {recentInterviews.length > 0 && (
            <Card padding="md">
              <SectionHeader title="Recent Interviews" label={`Last ${recentInterviews.length} interviewed`} />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                {recentInterviews.slice(0, 5).map((interview) => (
                  <div
                    key={interview._id}
                    onClick={() => router.push(`/applications/${interview._id}`)}
                    className="theme-card p-4 cursor-pointer transition-all hover:scale-[1.02] relative"
                  >
                    <div className="absolute top-2 right-2">
                      <StatusBadge status={interview.status} kind="applicant" />
                    </div>
                    <div className="mb-3 pr-16">
                      <p className="font-semibold truncate theme-text-primary">{interview.firstName} {interview.lastName}</p>
                      <p className="text-xs truncate theme-text-secondary">{interview.appliedJobTitle}</p>
                    </div>
                    <div className="text-xs space-y-1 theme-text-secondary">
                      <div className="flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>{new Date(interview.interviewDate).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span className="truncate">{interview.interviewerName}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-medium theme-accent-primary">Round {interview.roundNumber}</span>
                        {interview.totalRounds > 1 && <span className="opacity-70">of {interview.totalRounds}</span>}
                      </div>
                    </div>
                    <div className="mt-3 pt-2 theme-border-secondary border-t flex gap-2 flex-wrap">
                      {interview.preliminaryScore !== null && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs theme-text-tertiary">Prelim:</span>
                          <ScorePill score={interview.preliminaryScore} size="sm" />
                        </div>
                      )}
                      {interview.aiScore !== null && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs theme-text-tertiary">AI:</span>
                          <ScorePill score={interview.aiScore} size="sm" />
                        </div>
                      )}
                      {interview.preliminaryScore === null && interview.aiScore === null && (
                        <span className="ui-badge ui-badge-gray">Pending</span>
                      )}
                    </div>
                    {interview.recommendation && (
                      <div className={`mt-2 text-[10px] truncate ${
                        interview.recommendation.toLowerCase().includes("hire") || interview.recommendation.toLowerCase().includes("strong")
                          ? "text-[#1f8f3d] dark:text-[#5fe08a]"
                          : interview.recommendation.toLowerCase().includes("reject") || interview.recommendation.toLowerCase().includes("not")
                            ? "text-[#c4271d] dark:text-[#ff8a82]"
                            : "theme-text-secondary"
                      }`}>
                        {interview.recommendation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Filters - only show for table view */}
          {viewMode === "table" && (
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  aria-label="Search applications"
                  placeholder="Search name, email, phone, or job..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="theme-input w-full"
                />
              </div>
              <select aria-label="Filter by status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="theme-input">
                <option value="all">All Statuses</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
              <select aria-label="Filter by department" value={filterDepartment} onChange={(e) => setFilterDepartment(e.target.value)} className="theme-input">
                <option value="all">All Departments</option>
                {departments.map((dept) => <option key={dept} value={dept}>{dept}</option>)}
              </select>
              <select aria-label="Filter by location" value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)} className="theme-input">
                <option value="all">All Locations</option>
                {locations.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
              </select>
            </div>
          )}

          {/* Loading skeleton */}
          {isLoading && (
            <div className="theme-card overflow-hidden">
              <div className="divide-y divide-gray-200 dark:divide-slate-700">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-6 py-4 animate-pulse">
                    <div className="h-4 w-40 rounded bg-gray-200 dark:bg-slate-700" />
                    <div className="h-4 w-32 rounded bg-gray-200 dark:bg-slate-700" />
                    <div className="h-4 w-16 rounded bg-gray-200 dark:bg-slate-700 ml-auto" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Kanban Board View */}
          {!isLoading && viewMode === "kanban" && groupedApplications && (
            <div className="overflow-x-auto pb-4">
              <div className="flex gap-4 min-w-max">
                {WORKFLOW_STATUSES.map((status) => {
                  const columnApps = groupedApplications[status.value] || [];
                  const isDropTarget = dragOverColumn === status.value;
                  return (
                    <div
                      key={status.value}
                      className={`flex-shrink-0 w-72 rounded-xl transition-all bg-gray-100 dark:bg-slate-800/50 ${
                        isDropTarget ? "ring-2 ring-[#007AFF]/50" : ""
                      }`}
                      onDragOver={(e) => handleDragOver(e, status.value)}
                      onDragLeave={() => setDragOverColumn(null)}
                      onDrop={(e) => handleDrop(e, status.value)}
                    >
                      {/* Column Header */}
                      <div className="flex items-center justify-between px-4 py-3 rounded-t-xl border-b bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={status.value} kind="applicant" />
                        </div>
                        <span className="ui-badge ui-badge-gray">{columnApps.length}</span>
                      </div>

                      {/* Column Cards */}
                      <div className="p-3 space-y-3 max-h-[calc(100vh-400px)] overflow-y-auto">
                        {columnApps.length === 0 ? (
                          <div className="text-center py-8 text-sm theme-text-tertiary">No candidates</div>
                        ) : (
                          columnApps.map((app: Application) => {
                            const daysInStatus = getDaysInStatus(app);
                            const isNew = isNewApplication(app);
                            const isDragging = draggedApp === app._id;
                            return (
                              <div
                                key={app._id}
                                draggable
                                onDragStart={() => handleDragStart(app._id)}
                                onDragEnd={handleDragEnd}
                                onClick={() => router.push(`/applications/${app._id}`)}
                                className={`rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 shadow-sm ${
                                  isDragging ? "opacity-50 scale-95" : ""
                                }`}
                              >
                                <div className="flex items-start justify-between mb-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="font-semibold truncate theme-text-primary">{app.firstName} {app.lastName}</p>
                                      {isNew && <span className="flex-shrink-0 ui-badge ui-badge-blue">NEW</span>}
                                    </div>
                                    <p className="text-xs truncate theme-text-tertiary">{app.appliedJobTitle}</p>
                                  </div>
                                  {app.candidateAnalysis && <ScorePill score={app.candidateAnalysis.overallScore} size="sm" />}
                                </div>

                                {app.candidateAnalysis && (
                                  <div className="flex gap-3 text-xs mb-2 theme-text-secondary">
                                    <div><span className="theme-text-tertiary">Stab: </span>{app.candidateAnalysis.stabilityScore}</div>
                                    <div><span className="theme-text-tertiary">Exp: </span>{app.candidateAnalysis.experienceScore}</div>
                                    <div className="theme-text-tertiary">{app.candidateAnalysis.totalYearsExperience.toFixed(1)}y</div>
                                  </div>
                                )}

                                {app.candidateAnalysis && (
                                  <div className="flex gap-3 text-xs mb-2">
                                    <span className="text-[#c4271d] dark:text-[#ff8a82]">{app.candidateAnalysis.redFlags.length} red flags</span>
                                    <span className="text-[#1f8f3d] dark:text-[#5fe08a]">{app.candidateAnalysis.greenFlags.length} green flags</span>
                                  </div>
                                )}

                                {app.scheduledInterviewDate && (
                                  <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded mb-2 ui-callout-amber">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    <span>
                                      {new Date(app.scheduledInterviewDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                      {app.scheduledInterviewTime && ` @ ${app.scheduledInterviewTime}`}
                                    </span>
                                  </div>
                                )}

                                <div className="flex items-center justify-between pt-2 border-t theme-border-secondary">
                                  <span className={`text-xs ${daysInStatus > 7 ? "text-[#b25e00] dark:text-[#ffc266]" : "theme-text-tertiary"}`}>
                                    {daysInStatus === 0 ? "Today" : `${daysInStatus}d ago`}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); copyEmail(app.email); }}
                                      className="p-1.5 rounded transition-colors theme-text-tertiary hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700"
                                      title="Copy email"
                                      aria-label="Copy email"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); router.push(`/applications/${app._id}`); }}
                                      className="p-1.5 rounded transition-colors theme-text-tertiary hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700"
                                      title="View details"
                                      aria-label="View details"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Applications Table */}
          {!isLoading && viewMode === "table" && (
            <div className="rounded-xl overflow-hidden bg-white dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-slate-700">
                      <th className="text-left px-6 py-4 text-sm font-medium theme-text-tertiary">Applicant</th>
                      <th onClick={() => handleSort("position")} className={thSortClass("position")}>
                        <div className="flex items-center gap-1">Position {sortArrow("position")}</div>
                      </th>
                      <th onClick={() => handleSort("score")} className={thSortClass("score")}>
                        <div className="flex items-center gap-1">Score {sortArrow("score")}</div>
                      </th>
                      <th onClick={() => handleSort("status")} className={thSortClass("status")}>
                        <div className="flex items-center gap-1">Status {sortArrow("status")}</div>
                      </th>
                      <th onClick={() => handleSort("date")} className={thSortClass("date")}>
                        <div className="flex items-center gap-1">Applied {sortArrow("date")}</div>
                      </th>
                      <th className="text-right px-6 py-4 text-sm font-medium theme-text-tertiary">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApplications.map((app) => (
                      <tr
                        key={app._id}
                        className="border-b cursor-pointer border-gray-200 dark:border-slate-700/50 hover:bg-gray-50 dark:hover:bg-slate-700/20"
                        onClick={() => router.push(`/applications/${app._id}`)}
                      >
                        <td className="px-6 py-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium theme-text-primary">{app.firstName} {app.lastName}</p>
                              {app.isArchived && <span className="ui-badge ui-badge-gray">Archived</span>}
                            </div>
                            <p className="text-sm theme-text-tertiary">{app.email}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4 theme-text-secondary">
                          {editingJobId === app._id ? (
                            <select
                              value={app.appliedJobId || ""}
                              onChange={(e) => { e.stopPropagation(); if (e.target.value) handleJobChange(app._id, e.target.value as Id<"jobs">); }}
                              onBlur={() => setEditingJobId(null)}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                              aria-label="Change job position"
                              className="theme-input w-full !py-1 text-sm"
                            >
                              <option value="">Select Job...</option>
                              {jobs.filter((j) => j.isActive).map((job) => (
                                <option key={job._id} value={job._id}>{job.title}</option>
                              ))}
                            </select>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span>{app.appliedJobTitle}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditingJobId(app._id); }}
                                className="p-1 rounded transition-colors text-[#007AFF] hover:bg-[#007AFF]/10"
                                title="Change job position"
                                aria-label="Change job position"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {app.candidateAnalysis ? (
                            <ScorePill score={app.candidateAnalysis.overallScore} size="sm" />
                          ) : (
                            <span className="ui-badge ui-badge-gray">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                          {/* Real StatusBadge with an invisible select layered on top for
                              interaction — keeps status colors consistent with the rest of
                              the app and correctly shows dns/expired states. */}
                          <div className="relative inline-flex items-center">
                            <StatusBadge status={app.status} kind="applicant" />
                            <select
                              value={app.status}
                              onChange={(e) => handleStatusChange(app._id, e.target.value)}
                              aria-label="Change application status"
                              className="absolute inset-0 w-full opacity-0 cursor-pointer"
                            >
                              {STATUS_OPTIONS.map((status) => (
                                <option key={status.value} value={status.value}>{status.label}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm theme-text-tertiary">
                          {new Date(app.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/applications/${app._id}`); }}>
                              View
                            </Button>
                            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleArchiveToggle(app); }}>
                              {app.isArchived ? "Restore" : "Archive"}
                            </Button>
                            {canDeleteApplications && (
                              <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(app._id); }}>
                                Delete
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {filteredApplications.length === 0 && (
                  <div className="text-center py-12">
                    <p className="theme-text-tertiary">No applications found</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setDeleteConfirmId(null)}
        >
          <Card padding="md" className="w-full max-w-md" >
            <div role="dialog" aria-modal="true" aria-label="Delete application" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base sm:text-lg font-semibold mb-2 theme-text-primary">Delete Application</h3>
              <p className="text-sm sm:text-base mb-4 sm:mb-6 theme-text-secondary">
                Are you sure you want to delete this application? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setDeleteConfirmId(null)} disabled={isDeleting}>Cancel</Button>
                <Button variant="danger" onClick={handleDelete} disabled={isDeleting} autoFocus>
                  {isDeleting ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Archive Rejected Confirmation Modal */}
      {showArchiveConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowArchiveConfirm(false)}
        >
          <Card padding="md" className="w-full max-w-md">
            <div role="dialog" aria-modal="true" aria-label="Archive rejected applications" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base sm:text-lg font-semibold mb-2 theme-text-primary">Archive Rejected</h3>
              <p className="text-sm sm:text-base mb-4 sm:mb-6 theme-text-secondary">
                Archive all rejected applications? They&apos;ll be hidden from the main view but can be shown again with &quot;Show Archived.&quot;
              </p>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setShowArchiveConfirm(false)} disabled={isArchiving}>Cancel</Button>
                <Button variant="primary" onClick={handleArchiveRejected} disabled={isArchiving} autoFocus>
                  {isArchiving ? "Archiving..." : "Archive Rejected"}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowHelp(false)}
        >
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <Card padding="md">
              <div role="dialog" aria-modal="true" aria-label="Applications help">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold theme-text-primary">Applications Help</h2>
                  <Button variant="ghost" size="sm" onClick={() => setShowHelp(false)} aria-label="Close" autoFocus>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </Button>
                </div>

                <div className="space-y-6">
                  <div>
                    <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                      <svg className="w-5 h-5 text-[#007AFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      Application Status Workflow
                    </h3>
                    <p className="text-sm theme-text-secondary">
                      Applications move through these stages: <strong>New</strong> → <strong>Reviewed</strong> → <strong>Contacted</strong> → <strong>Scheduled</strong> → <strong>Interviewed</strong> → <strong>Hired</strong> or <strong>Rejected</strong>.
                      Change status using the dropdown in the table or drag cards in Kanban view.
                    </p>
                  </div>
                  <div>
                    <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                      <svg className="w-5 h-5 text-[#7e3bb0] dark:text-[#d59cf0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                      </svg>
                      Table vs Kanban View
                    </h3>
                    <p className="text-sm theme-text-secondary">
                      <strong>Table View:</strong> See all applications in a sortable list. Click column headers to sort by score, position, date, or status.<br />
                      <strong>Kanban View:</strong> Drag and drop applications between status columns to update their status visually.
                    </p>
                  </div>
                  <div>
                    <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                      <svg className="w-5 h-5 text-[#1f8f3d] dark:text-[#5fe08a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      AI Candidate Scoring
                    </h3>
                    <p className="text-sm theme-text-secondary">
                      Each application is analyzed by AI to provide an overall score, stability score, and experience score.
                      Click on an applicant to see detailed analysis including employment history, red/green flags, and hiring recommendations.
                    </p>
                  </div>
                  <div>
                    <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                      <svg className="w-5 h-5 text-[#b25e00] dark:text-[#ffc266]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Scheduling Interviews
                    </h3>
                    <p className="text-sm theme-text-secondary">
                      Click on an applicant to open their profile, then use the &quot;Schedule Interview&quot; button.
                      This creates a calendar event and sends an automatic confirmation email to the candidate.
                    </p>
                  </div>
                  <div>
                    <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                      <svg className="w-5 h-5 text-[#b25e00] dark:text-[#ffc266]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                      Archiving &amp; Auto-Expire
                    </h3>
                    <p className="text-sm theme-text-secondary">
                      Applications marked as <strong>Hired</strong> or <strong>Rejected</strong> are automatically archived.
                      Stagnant applications (no activity for 45 days) are auto-expired nightly.
                      Use &quot;Show Archived&quot; to view archived applications or &quot;Archive Rejected&quot; to bulk archive.
                    </p>
                  </div>
                  <div>
                    <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                      <svg className="w-5 h-5 text-[#007AFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      Bulk Upload
                    </h3>
                    <p className="text-sm theme-text-secondary">
                      Use the &quot;Bulk Upload&quot; button to import multiple resumes at once.
                      The system will extract text and run AI analysis on each resume automatically.
                    </p>
                  </div>
                </div>

                <div className="mt-6 pt-4 theme-border-secondary border-t">
                  <Button variant="primary" onClick={() => setShowHelp(false)} className="w-full justify-center">Got it</Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium theme-text-primary ${
            toast.tone === "error" ? "ui-callout-red" : "ui-callout-green"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

export default function ApplicationsPage() {
  return (
    <Protected minTier={2}>
      <ApplicationsContent />
    </Protected>
  );
}
