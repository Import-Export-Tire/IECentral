"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/ui/StatusBadge";
import ScorePill from "@/components/ui/ScorePill";

type Application = Doc<"applications">;

const STATUS_OPTIONS = [
  { value: "new", label: "New", color: "cyan", icon: "star" },
  { value: "reviewed", label: "Reviewed", color: "amber", icon: "eye" },
  { value: "contacted", label: "Contacted", color: "purple", icon: "mail" },
  { value: "scheduled", label: "Scheduled", color: "orange", icon: "calendar" },
  { value: "interviewed", label: "Interviewed", color: "blue", icon: "chat" },
  { value: "hired", label: "Hired", color: "green", icon: "check" },
  { value: "rejected", label: "Rejected", color: "red", icon: "x" },
];

const statusColors: Record<string, string> = {
  new: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  reviewed: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  contacted: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  scheduled: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  interviewed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  hired: "bg-green-500/20 text-green-400 border-green-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  dns: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  expired: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

// Kanban column header colors
const kanbanHeaderColors: Record<string, string> = {
  new: "bg-cyan-500/30 border-cyan-500/50",
  reviewed: "bg-amber-500/30 border-amber-500/50",
  contacted: "bg-purple-500/30 border-purple-500/50",
  scheduled: "bg-orange-500/30 border-orange-500/50",
  interviewed: "bg-blue-500/30 border-blue-500/50",
  hired: "bg-green-500/30 border-green-500/50",
  rejected: "bg-red-500/30 border-red-500/50",
  dns: "bg-slate-500/30 border-slate-500/50",
  expired: "bg-gray-500/30 border-gray-500/50",
};

function ApplicationsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);

  const applications = useQuery(api.applications.getAll, { includeArchived: showArchived }) || [];
  const groupedApplications = useQuery(api.applications.getByStatusGrouped, { includeArchived: showArchived });
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

  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterDepartment, setFilterDepartment] = useState<string>("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  // Get unique departments and locations from jobs for filters
  const departments = [...new Set(jobs.map(j => j.department))].sort();
  const locations = [...new Set(jobs.flatMap(j => j.locations || [j.location]))].sort();

  // Helper to get job details by ID
  const getJobById = (jobId: Id<"jobs"> | undefined) => jobs.find(j => j._id === jobId);
  const [deleteConfirmId, setDeleteConfirmId] = useState<Id<"applications"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [sortBy, setSortBy] = useState<"score" | "position" | "date" | "status">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [draggedApp, setDraggedApp] = useState<Id<"applications"> | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<Id<"applications"> | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Handle job change
  const handleJobChange = async (applicationId: Id<"applications">, jobId: Id<"jobs">) => {
    try {
      await updateAppliedJob({ applicationId, jobId });
      setEditingJobId(null);
    } catch (error) {
      console.error("Failed to update job:", error);
    }
  };

  // Status order for sorting
  const STATUS_ORDER: Record<string, number> = {
    new: 0,
    reviewed: 1,
    contacted: 2,
    scheduled: 3,
    interviewed: 4,
    hired: 5,
    rejected: 6,
  };

  const handleSort = (column: "score" | "position" | "date" | "status") => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder(column === "score" ? "desc" : "asc");
    }
  };

  const filteredApplications = applications
    .filter((app) => {
      const matchesStatus =
        filterStatus === "all" || app.status === filterStatus;

      // Department filter - check against the job's department
      const job = getJobById(app.appliedJobId);
      const matchesDepartment =
        filterDepartment === "all" || job?.department === filterDepartment;

      // Location filter - check against job locations or appliedLocation
      const jobLocations = job?.locations || (job?.location ? [job.location] : []);
      const matchesLocation =
        filterLocation === "all" ||
        app.appliedLocation === filterLocation ||
        jobLocations.includes(filterLocation);

      // Normalize phone search - strip non-digits for comparison
      const normalizedSearch = searchTerm.replace(/\D/g, "");
      const normalizedPhone = app.phone?.replace(/\D/g, "") || "";
      const matchesPhone = normalizedSearch.length >= 3 && normalizedPhone.includes(normalizedSearch);

      const matchesSearch =
        searchTerm === "" ||
        `${app.firstName} ${app.lastName}`
          .toLowerCase()
          .includes(searchTerm.toLowerCase()) ||
        app.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.appliedJobTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
        matchesPhone;
      return matchesStatus && matchesSearch && matchesDepartment && matchesLocation;
    })
    .sort((a, b) => {
      let comparison = 0;

      if (sortBy === "score") {
        const scoreA = a.candidateAnalysis?.overallScore ?? -1;
        const scoreB = b.candidateAnalysis?.overallScore ?? -1;
        comparison = scoreA - scoreB;
      } else if (sortBy === "position") {
        comparison = a.appliedJobTitle.localeCompare(b.appliedJobTitle);
      } else if (sortBy === "date") {
        comparison = a.createdAt - b.createdAt;
      } else if (sortBy === "status") {
        const statusA = STATUS_ORDER[a.status] ?? 99;
        const statusB = STATUS_ORDER[b.status] ?? 99;
        comparison = statusA - statusB;
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

  const handleStatusChange = async (
    applicationId: Id<"applications">,
    newStatus: string
  ) => {
    await updateStatus({ applicationId, status: newStatus });
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    setIsDeleting(true);
    try {
      await deleteApplication({ applicationId: deleteConfirmId });
      setDeleteConfirmId(null);
    } catch (error) {
      console.error("Failed to delete application:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const canDeleteApplications = user?.role === "super_admin" || user?.role === "admin";

  // Kanban drag and drop handlers
  const handleDragStart = (appId: Id<"applications">) => {
    setDraggedApp(appId);
  };

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

    // Find the application to check current status
    const app = applications.find(a => a._id === draggedApp);
    if (!app || app.status === newStatus) {
      handleDragEnd();
      return;
    }

    await updateStatusWithActivity({
      applicationId: draggedApp,
      newStatus,
      userId: user._id,
    });
    handleDragEnd();
  };

  // Calculate days since application was created (used for staleness indicator)
  const getDaysInStatus = (app: Application) => {
    const days = Math.floor((Date.now() - app.createdAt) / (1000 * 60 * 60 * 24));
    return days;
  };

  // Check if application is new (less than 24 hours)
  const isNewApplication = (app: Application) => {
    return Date.now() - app.createdAt < 24 * 60 * 60 * 1000;
  };

  return (
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Mobile Header */}
        <MobileHeader />

        {/* Header */}
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Applications</h1>
              <p className={`text-xs sm:text-sm mt-1 hidden sm:block ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Review and manage job applications
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              {/* View Toggle */}
              <div className={`flex rounded-lg p-1 ${isDark ? "bg-slate-800 border border-slate-700" : "bg-gray-100 border border-gray-200"}`}>
                <button
                  onClick={() => setViewMode("table")}
                  className={`px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    viewMode === "table"
                      ? isDark ? "bg-slate-700 text-white" : "bg-white text-gray-900 shadow-sm"
                      : isDark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  <span className="hidden sm:inline">Table</span>
                </button>
                <button
                  onClick={() => setViewMode("kanban")}
                  className={`px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    viewMode === "kanban"
                      ? isDark ? "bg-slate-700 text-white" : "bg-white text-gray-900 shadow-sm"
                      : isDark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                  </svg>
                  <span className="hidden sm:inline">Kanban</span>
                </button>
              </div>

              {/* Show Archived Toggle */}
              <label className={`flex items-center gap-2 cursor-pointer ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-xs sm:text-sm hidden sm:inline">Show Archived</span>
              </label>

              {/* Archive Rejected Button */}
              <button
                onClick={async () => {
                  if (confirm("Archive all rejected applications? They will be hidden from the main view.")) {
                    const result = await archiveRejected();
                    alert(`Archived ${result.archived} applications`);
                  }
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
                  isDark
                    ? "bg-slate-700 hover:bg-slate-600 text-slate-300"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
                <span className="hidden sm:inline">Archive Rejected</span>
              </button>

              {/* Help Button */}
              <button
                onClick={() => setShowHelp(true)}
                className={`p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}
                title="Applications Help"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>

              <button
                onClick={() => router.push("/applications/bulk-upload")}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium transition-colors flex-shrink-0 ${
                  isDark
                    ? "bg-cyan-600 hover:bg-cyan-700 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="hidden sm:inline">Bulk Upload</span>
                <span className="sm:hidden">Upload</span>
              </button>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-4 lg:grid-cols-8 gap-3">
              <div className="theme-card p-4 text-center">
                <p className="text-base sm:text-lg font-bold theme-text-primary">{stats.total}</p>
                <p className="ui-section-label">Total</p>
              </div>
              {STATUS_OPTIONS.map((status) => (
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
          {applications.length > 0 && (() => {
            const topCandidates = applications
              .filter(app =>
                app.candidateAnalysis?.overallScore &&
                app.status !== "hired" &&
                app.status !== "rejected"
              )
              .sort((a, b) => (b.candidateAnalysis?.overallScore || 0) - (a.candidateAnalysis?.overallScore || 0))
              .slice(0, 3);

            if (topCandidates.length === 0) return null;

            return (
              <Card padding="md">
                <SectionHeader
                  title="Top Candidates"
                  label="Highest scoring active applicants"
                />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {topCandidates.map((app, index) => (
                    <div
                      key={app._id}
                      onClick={() => router.push(`/applications/${app._id}`)}
                      className="theme-card p-4 cursor-pointer transition-all hover:scale-[1.02] relative"
                    >
                      {/* Rank Badge */}
                      <div className={`absolute -top-2 -left-2 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        index === 0
                          ? "bg-yellow-500 text-yellow-900"
                          : index === 1
                            ? "bg-gray-300 text-gray-700"
                            : "bg-amber-600 text-amber-100"
                      }`}>
                        #{index + 1}
                      </div>

                      {/* Status Badge - top right */}
                      <div className="absolute top-3 right-3">
                        <StatusBadge status={app.status} kind="applicant" />
                      </div>

                      {/* Name and Score */}
                      <div className="flex items-start justify-between mb-3 pr-20">
                        <div>
                          <p className="font-semibold theme-text-primary">
                            {app.firstName} {app.lastName}
                          </p>
                          <p className="text-sm theme-text-secondary">
                            {app.appliedJobTitle}
                          </p>
                        </div>
                        <ScorePill score={app.candidateAnalysis?.overallScore} size="sm" />
                      </div>

                      {/* Quick Stats */}
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

                      {/* Recommended Action */}
                      <div className={`mt-3 text-xs px-2 py-1 rounded inline-block ${
                        app.candidateAnalysis?.recommendedAction === "strong_candidate"
                          ? isDark ? "bg-green-900/50 text-green-400" : "bg-green-100 text-green-700"
                          : app.candidateAnalysis?.recommendedAction === "worth_interviewing"
                            ? isDark ? "bg-blue-900/50 text-blue-400" : "bg-blue-100 text-blue-700"
                            : isDark ? "bg-slate-700 text-slate-400" : "bg-gray-100 text-gray-600"
                      }`}>
                        {app.candidateAnalysis?.recommendedAction?.replace(/_/g, " ")}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}

          {/* Recent Interviews Section */}
          {recentInterviews.length > 0 && (
            <Card padding="md">
              <SectionHeader
                title="Recent Interviews"
                label={`Last ${recentInterviews.length} interviewed`}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                {recentInterviews.slice(0, 5).map((interview) => (
                  <div
                    key={interview._id}
                    onClick={() => router.push(`/applications/${interview._id}`)}
                    className="theme-card p-4 cursor-pointer transition-all hover:scale-[1.02] relative"
                  >
                    {/* Status Badge */}
                    <div className="absolute top-2 right-2">
                      <StatusBadge status={interview.status} kind="applicant" />
                    </div>

                    {/* Name and Position */}
                    <div className="mb-3 pr-16">
                      <p className="font-semibold truncate theme-text-primary">
                        {interview.firstName} {interview.lastName}
                      </p>
                      <p className="text-xs truncate theme-text-secondary">
                        {interview.appliedJobTitle}
                      </p>
                    </div>

                    {/* Interview Info */}
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
                        <span className="font-medium theme-accent-primary">
                          Round {interview.roundNumber}
                        </span>
                        {interview.totalRounds > 1 && (
                          <span className="opacity-70">of {interview.totalRounds}</span>
                        )}
                      </div>
                    </div>

                    {/* Scores */}
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

                    {/* Recommendation */}
                    {interview.recommendation && (
                      <div className={`mt-2 text-[10px] truncate ${
                        interview.recommendation.toLowerCase().includes("hire") || interview.recommendation.toLowerCase().includes("strong")
                          ? isDark ? "text-green-400" : "text-green-600"
                          : interview.recommendation.toLowerCase().includes("reject") || interview.recommendation.toLowerCase().includes("not")
                            ? isDark ? "text-red-400" : "text-red-600"
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
                  placeholder="Search name, email, phone, or job..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={`w-full px-3 sm:px-4 py-2 text-sm sm:text-base rounded-lg focus:outline-none ${isDark ? "bg-slate-800/50 border border-slate-700 text-white placeholder-slate-500 focus:border-cyan-500" : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-600"}`}
                />
              </div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className={`px-3 sm:px-4 py-2 text-sm sm:text-base rounded-lg focus:outline-none ${isDark ? "bg-slate-800/50 border border-slate-700 text-white focus:border-cyan-500" : "bg-white border border-gray-200 text-gray-900 focus:border-blue-600"}`}
              >
                <option value="all">All Statuses</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
              <select
                value={filterDepartment}
                onChange={(e) => setFilterDepartment(e.target.value)}
                className={`px-3 sm:px-4 py-2 text-sm sm:text-base rounded-lg focus:outline-none ${isDark ? "bg-slate-800/50 border border-slate-700 text-white focus:border-cyan-500" : "bg-white border border-gray-200 text-gray-900 focus:border-blue-600"}`}
              >
                <option value="all">All Departments</option>
                {departments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
              <select
                value={filterLocation}
                onChange={(e) => setFilterLocation(e.target.value)}
                className={`px-3 sm:px-4 py-2 text-sm sm:text-base rounded-lg focus:outline-none ${isDark ? "bg-slate-800/50 border border-slate-700 text-white focus:border-cyan-500" : "bg-white border border-gray-200 text-gray-900 focus:border-blue-600"}`}
              >
                <option value="all">All Locations</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Kanban Board View */}
          {viewMode === "kanban" && groupedApplications && (
            <div className="overflow-x-auto pb-4">
              <div className="flex gap-4 min-w-max">
                {STATUS_OPTIONS.map((status) => {
                  const columnApps = groupedApplications[status.value] || [];
                  const isDropTarget = dragOverColumn === status.value;

                  return (
                    <div
                      key={status.value}
                      className={`flex-shrink-0 w-72 rounded-xl transition-all ${
                        isDark ? "bg-slate-800/50" : "bg-gray-100"
                      } ${isDropTarget ? "ring-2 ring-cyan-500 ring-opacity-50" : ""}`}
                      onDragOver={(e) => handleDragOver(e, status.value)}
                      onDragLeave={() => setDragOverColumn(null)}
                      onDrop={(e) => handleDrop(e, status.value)}
                    >
                      {/* Column Header */}
                      <div className={`flex items-center justify-between px-4 py-3 rounded-t-xl border-b ${
                        isDark
                          ? `${kanbanHeaderColors[status.value]} border-slate-700`
                          : "bg-white border-gray-200"
                      }`}>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                            {status.label}
                          </span>
                          <span className={`px-2 py-0.5 text-xs rounded-full ${
                            isDark ? "bg-slate-700 text-slate-300" : "bg-gray-200 text-gray-600"
                          }`}>
                            {columnApps.length}
                          </span>
                        </div>
                      </div>

                      {/* Column Cards */}
                      <div className="p-3 space-y-3 max-h-[calc(100vh-400px)] overflow-y-auto">
                        {columnApps.length === 0 ? (
                          <div className={`text-center py-8 text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            No candidates
                          </div>
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
                                className={`rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] ${
                                  isDark
                                    ? "bg-slate-900 border border-slate-700 hover:border-slate-600"
                                    : "bg-white border border-gray-200 hover:border-gray-300 shadow-sm"
                                } ${isDragging ? "opacity-50 scale-95" : ""}`}
                              >
                                {/* Card Header */}
                                <div className="flex items-start justify-between mb-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className={`font-semibold truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                                        {app.firstName} {app.lastName}
                                      </p>
                                      {isNew && (
                                        <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-cyan-500/20 text-cyan-400 rounded">
                                          NEW
                                        </span>
                                      )}
                                    </div>
                                    <p className={`text-xs truncate ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                      {app.appliedJobTitle}
                                    </p>
                                  </div>
                                  {app.candidateAnalysis && (
                                    <ScorePill score={app.candidateAnalysis.overallScore} size="sm" />
                                  )}
                                </div>

                                {/* Score Breakdown */}
                                {app.candidateAnalysis && (
                                  <div className="flex gap-3 text-xs mb-2">
                                    <div>
                                      <span className={isDark ? "text-slate-500" : "text-gray-400"}>Stab: </span>
                                      <span className={isDark ? "text-slate-300" : "text-gray-700"}>
                                        {app.candidateAnalysis.stabilityScore}
                                      </span>
                                    </div>
                                    <div>
                                      <span className={isDark ? "text-slate-500" : "text-gray-400"}>Exp: </span>
                                      <span className={isDark ? "text-slate-300" : "text-gray-700"}>
                                        {app.candidateAnalysis.experienceScore}
                                      </span>
                                    </div>
                                    <div>
                                      <span className={isDark ? "text-slate-500" : "text-gray-400"}>
                                        {app.candidateAnalysis.totalYearsExperience.toFixed(1)}y
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {/* Flags */}
                                {app.candidateAnalysis && (
                                  <div className="flex gap-2 text-xs mb-2">
                                    <span className="text-red-400">
                                      {app.candidateAnalysis.redFlags.length} red flags
                                    </span>
                                    <span className="text-green-400">
                                      {app.candidateAnalysis.greenFlags.length} green flags
                                    </span>
                                  </div>
                                )}

                                {/* Interview Scheduled Indicator */}
                                {app.scheduledInterviewDate && (
                                  <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded mb-2 ${
                                    isDark ? "bg-orange-500/20 text-orange-400" : "bg-orange-100 text-orange-600"
                                  }`}>
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    <span>
                                      {new Date(app.scheduledInterviewDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                      {app.scheduledInterviewTime && ` @ ${app.scheduledInterviewTime}`}
                                    </span>
                                  </div>
                                )}

                                {/* Days in Status & Quick Actions */}
                                <div className="flex items-center justify-between pt-2 border-t theme-border-secondary">
                                  <span className={`text-xs ${
                                    daysInStatus > 7
                                      ? "text-amber-400"
                                      : isDark ? "text-slate-500" : "text-gray-400"
                                  }`}>
                                    {daysInStatus === 0 ? "Today" : `${daysInStatus}d ago`}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigator.clipboard.writeText(app.email);
                                      }}
                                      className={`p-1.5 rounded hover:bg-slate-700/50 transition-colors ${isDark ? "text-slate-400 hover:text-white" : "text-gray-400 hover:text-gray-700"}`}
                                      title="Copy email"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        router.push(`/applications/${app._id}`);
                                      }}
                                      className={`p-1.5 rounded hover:bg-slate-700/50 transition-colors ${isDark ? "text-slate-400 hover:text-white" : "text-gray-400 hover:text-gray-700"}`}
                                      title="View details"
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
          {viewMode === "table" && (
          <div className={`rounded-xl overflow-hidden ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={`border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                    <th className={`text-left px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Applicant
                    </th>
                    <th
                      onClick={() => handleSort("position")}
                      className={`text-left px-6 py-4 text-sm font-medium cursor-pointer select-none transition-colors ${
                        isDark
                          ? sortBy === "position" ? "text-cyan-400" : "text-slate-400 hover:text-slate-300"
                          : sortBy === "position" ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        Position
                        {sortBy === "position" && (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortOrder === "asc" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                          </svg>
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort("score")}
                      className={`text-left px-6 py-4 text-sm font-medium cursor-pointer select-none transition-colors ${
                        isDark
                          ? sortBy === "score" ? "text-cyan-400" : "text-slate-400 hover:text-slate-300"
                          : sortBy === "score" ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        Score
                        {sortBy === "score" && (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortOrder === "asc" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                          </svg>
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort("status")}
                      className={`text-left px-6 py-4 text-sm font-medium cursor-pointer select-none transition-colors ${
                        isDark
                          ? sortBy === "status" ? "text-cyan-400" : "text-slate-400 hover:text-slate-300"
                          : sortBy === "status" ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        Status
                        {sortBy === "status" && (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortOrder === "asc" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                          </svg>
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort("date")}
                      className={`text-left px-6 py-4 text-sm font-medium cursor-pointer select-none transition-colors ${
                        isDark
                          ? sortBy === "date" ? "text-cyan-400" : "text-slate-400 hover:text-slate-300"
                          : sortBy === "date" ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        Applied
                        {sortBy === "date" && (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortOrder === "asc" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                          </svg>
                        )}
                      </div>
                    </th>
                    <th className={`text-right px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApplications.map((app) => (
                    <tr
                      key={app._id}
                      className={`border-b cursor-pointer ${isDark ? "border-slate-700/50 hover:bg-slate-700/20" : "border-gray-200 hover:bg-gray-50"}`}
                      onClick={() => router.push(`/applications/${app._id}`)}
                    >
                      <td className="px-6 py-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              {app.firstName} {app.lastName}
                            </p>
                            {app.isArchived && (
                              <span className={`text-xs px-1.5 py-0.5 rounded ${isDark ? "bg-slate-700 text-slate-400" : "bg-gray-200 text-gray-500"}`}>
                                Archived
                              </span>
                            )}
                          </div>
                          <p className={`text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>{app.email}</p>
                        </div>
                      </td>
                      <td className={`px-6 py-4 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        {editingJobId === app._id ? (
                          <select
                            value={app.appliedJobId || ""}
                            onChange={(e) => {
                              e.stopPropagation();
                              if (e.target.value) {
                                handleJobChange(app._id, e.target.value as Id<"jobs">);
                              }
                            }}
                            onBlur={() => setEditingJobId(null)}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                            className={`w-full px-2 py-1 text-sm rounded border ${
                              isDark
                                ? "bg-slate-700 border-slate-600 text-white"
                                : "bg-white border-gray-300 text-gray-900"
                            } focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                          >
                            <option value="">Select Job...</option>
                            {jobs.filter(j => j.isActive).map((job) => (
                              <option key={job._id} value={job._id}>
                                {job.title}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span>{app.appliedJobTitle}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingJobId(app._id);
                              }}
                              className={`p-1 rounded transition-colors ${
                                isDark
                                  ? "text-cyan-400 hover:bg-slate-700 hover:text-cyan-300"
                                  : "text-blue-500 hover:bg-blue-50 hover:text-blue-600"
                              }`}
                              title="Change job position"
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
                      <td className="px-6 py-4">
                        <select
                          value={app.status}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleStatusChange(app._id, e.target.value);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className={`px-3 py-1 text-xs font-medium rounded border ${statusColors[app.status]} bg-transparent focus:outline-none`}
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option
                              key={status.value}
                              value={status.value}
                              className={isDark ? "bg-slate-800 text-white" : "bg-white text-gray-900"}
                            >
                              {status.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={`px-6 py-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        {new Date(app.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/applications/${app._id}`);
                            }}
                          >
                            View
                          </Button>
                          {/* Archive/Unarchive button */}
                          {app.isArchived ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                unarchiveApplication({ applicationId: app._id });
                              }}
                            >
                              Restore
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                archiveApplication({ applicationId: app._id });
                              }}
                            >
                              Archive
                            </Button>
                          )}
                          {canDeleteApplications && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmId(app._id);
                              }}
                            >
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
                  <p className={isDark ? "text-slate-500" : "text-gray-500"}>No applications found</p>
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <Card padding="md" className="w-full max-w-md">
            <h3 className="text-base sm:text-lg font-semibold mb-2 theme-text-primary">
              Delete Application
            </h3>
            <p className="text-sm sm:text-base mb-4 sm:mb-6 theme-text-secondary">
              Are you sure you want to delete this application? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setDeleteConfirmId(null)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <Card padding="md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold theme-text-primary">
                Applications Help
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHelp(false)}
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </div>

            <div className="space-y-6">
              {/* Status Workflow */}
              <div>
                <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                  <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Application Status Workflow
                </h3>
                <p className="text-sm theme-text-secondary">
                  Applications move through these stages: <strong>New</strong> → <strong>Reviewed</strong> → <strong>Contacted</strong> → <strong>Scheduled</strong> → <strong>Interviewed</strong> → <strong>Hired</strong> or <strong>Rejected</strong>.
                  Change status using the dropdown in the table or drag cards in Kanban view.
                </p>
              </div>

              {/* View Modes */}
              <div>
                <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                  <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  Table vs Kanban View
                </h3>
                <p className="text-sm theme-text-secondary">
                  <strong>Table View:</strong> See all applications in a sortable list. Click column headers to sort by score, position, date, or status.<br/>
                  <strong>Kanban View:</strong> Drag and drop applications between status columns to update their status visually.
                </p>
              </div>

              {/* AI Scoring */}
              <div>
                <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  AI Candidate Scoring
                </h3>
                <p className="text-sm theme-text-secondary">
                  Each application is analyzed by AI to provide an overall score, stability score, and experience score.
                  Click on an applicant to see detailed analysis including employment history, red/green flags, and hiring recommendations.
                </p>
              </div>

              {/* Scheduling Interviews */}
              <div>
                <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                  <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Scheduling Interviews
                </h3>
                <p className="text-sm theme-text-secondary">
                  Click on an applicant to open their profile, then use the &quot;Schedule Interview&quot; button.
                  This creates a calendar event and sends an automatic confirmation email to the candidate.
                </p>
              </div>

              {/* Auto-Archiving */}
              <div>
                <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                  <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

              {/* Bulk Upload */}
              <div>
                <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                  <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              <Button
                variant="primary"
                onClick={() => setShowHelp(false)}
                className="w-full justify-center"
              >
                Got it
              </Button>
            </div>
          </Card>
          </div>
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
