"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../auth-context";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

const STATUS_OPTIONS = [
  { value: "open", label: "Accepting Applications", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  { value: "closed", label: "Closed", color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
];

const DEPARTMENT_OPTIONS = ["Executive", "Operations", "IT", "Sales", "Logistics", "Management", "HR", "Finance", "Retail", "Retail Management"];
const TYPE_OPTIONS = ["Full-time", "Part-time", "Contract", "Temporary"];
const POSITION_TYPE_OPTIONS = [
  { value: "hourly", label: "Hourly" },
  { value: "salaried", label: "Salaried" },
  { value: "management", label: "Management" },
];

const BADGE_TYPE_OPTIONS = [
  { value: "urgently_hiring", label: "Urgently Hiring", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  { value: "accepting_applications", label: "Accepting Applications", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { value: "open_position", label: "Open Position", color: "bg-green-500/20 text-green-400 border-green-500/30" },
];

interface Job {
  _id: Id<"jobs">;
  title: string;
  location: string;
  locations?: string[]; // Multiple locations
  type: string;
  positionType?: string;
  department: string;
  status: string;
  description: string;
  benefits: string[];
  keywords: string[];
  isActive: boolean;
  urgentHiring?: boolean;
  badgeType?: string;
  displayOrder?: number;
  createdAt: number;
  updatedAt: number;
}

interface JobFormData {
  title: string;
  location: string;
  locations: string[]; // Multiple locations array
  type: string;
  positionType: string;
  department: string;
  description: string;
  benefits: string;
  keywords: string;
  status: string;
  isActive: boolean;
  badgeType: string;
}

// Helper to get display text for locations
const getLocationsDisplay = (job: Job): string => {
  if (job.locations && job.locations.length > 0) {
    if (job.locations.length === 1) return job.locations[0];
    return `${job.locations.length} Locations`;
  }
  return job.location;
};

// Helper function to get effective badge type (supports legacy urgentHiring field)
const getEffectiveBadgeType = (job: Job): string => {
  if (job.badgeType) return job.badgeType;
  if (job.urgentHiring) return "urgently_hiring";
  return "open_position";
};

export default function JobsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const jobs = useQuery(api.jobs.getAll);
  const createJob = useMutation(api.jobs.create);
  const updateJob = useMutation(api.jobs.update);
  const deleteJob = useMutation(api.jobs.remove);

  const [showModal, setShowModal] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Job | null>(null);
  const [filterDepartment, setFilterDepartment] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Restrict warehouse_manager role from accessing this page
  const isWarehouseManager = user?.role === "warehouse_manager";

  useEffect(() => {
    if (isWarehouseManager) {
      router.push("/");
    }
  }, [isWarehouseManager, router]);

  // Show nothing while redirecting warehouse manager
  if (isWarehouseManager) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f2f2f7] dark:bg-slate-900">
        <div className="text-center theme-text-tertiary">
          <p>You do not have access to this page.</p>
          <p className="text-sm mt-2">Redirecting...</p>
        </div>
      </div>
    );
  }

  const [formData, setFormData] = useState<JobFormData>({
    title: "",
    location: "Bensenville, IL",
    locations: [],
    type: "Full-time",
    positionType: "hourly",
    department: "Operations",
    description: "",
    benefits: "",
    keywords: "",
    status: "open",
    isActive: true,
    badgeType: "open_position",
  });
  const [newLocation, setNewLocation] = useState("");

  const resetForm = () => {
    setFormData({
      title: "",
      location: "Bensenville, IL",
      locations: [],
      type: "Full-time",
      positionType: "hourly",
      department: "Operations",
      description: "",
      benefits: "",
      keywords: "",
      status: "open",
      isActive: true,
      badgeType: "open_position",
    });
    setNewLocation("");
    setEditingJob(null);
  };

  const addLocation = () => {
    const loc = newLocation.trim();
    if (loc && !formData.locations.includes(loc)) {
      setFormData({ ...formData, locations: [...formData.locations, loc] });
      setNewLocation("");
    }
  };

  const removeLocation = (loc: string) => {
    setFormData({ ...formData, locations: formData.locations.filter(l => l !== loc) });
  };

  const openAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (job: Job) => {
    setEditingJob(job);
    setFormData({
      title: job.title,
      location: job.location,
      locations: job.locations || [],
      type: job.type,
      positionType: job.positionType || "hourly",
      department: job.department,
      description: job.description,
      benefits: job.benefits.join(", "),
      keywords: job.keywords.join(", "),
      status: job.status,
      isActive: job.isActive,
      badgeType: getEffectiveBadgeType(job),
    });
    setNewLocation("");
    setShowModal(true);
  };

  const openCopyModal = (job: Job) => {
    setEditingJob(null); // Not editing, creating a copy
    setFormData({
      title: `${job.title} (Copy)`,
      location: job.location,
      locations: job.locations || [],
      type: job.type,
      positionType: job.positionType || "hourly",
      department: job.department,
      description: job.description,
      benefits: job.benefits.join(", "),
      keywords: job.keywords.join(", "),
      status: "open",
      isActive: true,
      badgeType: getEffectiveBadgeType(job),
    });
    setNewLocation("");
    setShowModal(true);
  };

  const handleBadgeTypeChange = async (job: Job, badgeType: string) => {
    try {
      console.log("Updating badge type for job:", job._id, "to:", badgeType);
      await updateJob({
        jobId: job._id,
        badgeType,
        // Also clear the legacy urgentHiring field to prevent conflicts
        urgentHiring: badgeType === "urgently_hiring",
      });
      console.log("Badge type updated successfully");
    } catch (error: unknown) {
      console.error("Failed to update badge type:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      alert(`Failed to update badge type: ${errorMessage}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate at least one location
    if (formData.locations.length === 0) {
      alert("Please add at least one location.");
      return;
    }

    const benefitsArray = formData.benefits
      .split(",")
      .map((b) => b.trim())
      .filter((b) => b);
    const keywordsArray = formData.keywords
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k);

    try {
      // Use first location as primary
      const primaryLocation = formData.locations[0];

      if (editingJob) {
        console.log("Updating job:", editingJob._id, formData);
        await updateJob({
          jobId: editingJob._id,
          title: formData.title,
          location: primaryLocation,
          locations: formData.locations.length > 0 ? formData.locations : undefined,
          type: formData.type,
          positionType: formData.positionType,
          department: formData.department,
          description: formData.description,
          benefits: benefitsArray,
          keywords: keywordsArray,
          status: formData.status,
          isActive: formData.isActive,
          badgeType: formData.badgeType,
          // Also sync the legacy urgentHiring field
          urgentHiring: formData.badgeType === "urgently_hiring",
        });
        console.log("Job updated successfully");
      } else {
        console.log("Creating job:", formData);
        await createJob({
          title: formData.title,
          location: primaryLocation,
          locations: formData.locations.length > 0 ? formData.locations : undefined,
          type: formData.type,
          positionType: formData.positionType,
          department: formData.department,
          description: formData.description,
          benefits: benefitsArray,
          keywords: keywordsArray,
          badgeType: formData.badgeType,
          urgentHiring: formData.badgeType === "urgently_hiring",
        });
        console.log("Job created successfully");
      }

      setShowModal(false);
      resetForm();
    } catch (error) {
      console.error("Failed to save job:", error);
      alert("Failed to save job. Please try again.");
    }
  };

  const handleDelete = async () => {
    if (showDeleteConfirm) {
      await deleteJob({ jobId: showDeleteConfirm._id });
      setShowDeleteConfirm(null);
    }
  };

  const handleQuickStatusChange = async (job: Job, newStatus: string) => {
    await updateJob({
      jobId: job._id,
      status: newStatus,
    });
  };

  const getStatusBadge = (status: string) => {
    const statusOption = STATUS_OPTIONS.find((s) => s.value === status);
    if (!statusOption) {
      return <span className="px-2 py-1 text-xs rounded-full bg-slate-500/20 text-slate-400">{status}</span>;
    }
    return (
      <span className={`px-2 py-1 text-xs rounded-full border ${statusOption.color}`}>
        {statusOption.label}
      </span>
    );
  };

  const filteredJobs = jobs?.filter((job) => {
    if (filterDepartment !== "all" && job.department !== filterDepartment) return false;
    if (filterStatus !== "all" && job.status !== filterStatus) return false;
    return true;
  });

  const departments = [...new Set(jobs?.map((j) => j.department) || [])];

  return (
    <Protected minTier={4}>
      <div className="min-h-screen flex bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <MobileHeader />
          {/* Header */}
          <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-[var(--theme-border-secondary)] px-4 sm:px-8 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold truncate theme-text-primary">Job Listings</h1>
                <p className="text-xs sm:text-sm mt-1 hidden sm:block theme-text-tertiary">Manage positions for IE Tire careers page</p>
              </div>
              <Button variant="primary" onClick={openAddModal}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden sm:inline">Add Job</span>
                <span className="sm:hidden">Add</span>
              </Button>
            </div>
          </div>

          <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <select
                value={filterDepartment}
                onChange={(e) => setFilterDepartment(e.target.value)}
                className="theme-input flex-1 sm:flex-initial px-3 sm:px-4 py-2 text-sm sm:text-base"
              >
                <option value="all">All Departments</option>
                {departments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="theme-input flex-1 sm:flex-initial px-3 sm:px-4 py-2 text-sm sm:text-base"
              >
                <option value="all">All Statuses</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
              <Card padding="sm" className="text-center">
                <p className="text-lg sm:text-2xl font-bold theme-text-primary">{jobs?.length || 0}</p>
                <p className="text-[10px] sm:text-xs theme-text-tertiary">Total Jobs</p>
              </Card>
              <Card padding="sm" className="text-center">
                <p className="text-lg sm:text-2xl font-bold text-green-400">
                  {jobs?.filter((j) => j.isActive).length || 0}
                </p>
                <p className="text-[10px] sm:text-xs theme-text-tertiary">Active</p>
              </Card>
              <Card padding="sm" className="text-center">
                <p className="text-lg sm:text-2xl font-bold text-red-400">
                  {jobs?.filter((j) => getEffectiveBadgeType(j) === "urgently_hiring").length || 0}
                </p>
                <p className="text-[10px] sm:text-xs theme-text-tertiary">Urgent</p>
              </Card>
              <Card padding="sm" className="text-center">
                <p className="text-lg sm:text-2xl font-bold theme-text-secondary">
                  {jobs?.filter((j) => !j.isActive).length || 0}
                </p>
                <p className="text-[10px] sm:text-xs theme-text-tertiary">Inactive</p>
              </Card>
            </div>

            {/* Jobs Table - Desktop */}
            <div className="hidden sm:block">
              <Card padding="sm" className="overflow-hidden !p-0">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-slate-800">
                    <tr>
                      <th className="px-6 py-4 text-left text-sm font-medium theme-text-tertiary">Title</th>
                      <th className="px-6 py-4 text-left text-sm font-medium theme-text-tertiary">Department</th>
                      <th className="px-6 py-4 text-left text-sm font-medium theme-text-tertiary">Position Type</th>
                      <th className="px-6 py-4 text-center text-sm font-medium theme-text-tertiary">Badge Type</th>
                      <th className="px-6 py-4 text-center text-sm font-medium theme-text-tertiary">Active</th>
                      <th className="px-6 py-4 text-right text-sm font-medium theme-text-tertiary">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--theme-border-secondary)]">
                    {filteredJobs?.map((job) => (
                      <tr key={job._id} className="transition-colors hover:bg-gray-50 dark:hover:bg-slate-800/50">
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-medium theme-text-primary">{job.title}</p>
                            <p className="text-sm theme-text-tertiary" title={job.locations?.join(", ") || job.location}>{getLocationsDisplay(job)}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="ui-badge ui-badge-blue">
                            {job.department}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs rounded-full border ${
                            job.positionType === "management"
                              ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                              : job.positionType === "salaried"
                              ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                              : "bg-slate-500/20 text-slate-400 border-slate-500/30"
                          }`}>
                            {job.positionType || "hourly"}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <select
                            value={getEffectiveBadgeType(job)}
                            onChange={(e) => handleBadgeTypeChange(job, e.target.value)}
                            className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                              getEffectiveBadgeType(job) === "urgently_hiring"
                                ? "bg-red-500/20 text-red-400 border-red-500/30 focus:ring-red-500/50 dark:bg-red-500/20 dark:text-red-400 dark:border-red-500/30"
                                : getEffectiveBadgeType(job) === "accepting_applications"
                                ? "bg-blue-500/20 text-blue-400 border-blue-500/30 focus:ring-blue-500/50 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30"
                                : "bg-green-500/20 text-green-400 border-green-500/30 focus:ring-green-500/50 dark:bg-green-500/20 dark:text-green-400 dark:border-green-500/30"
                            }`}
                          >
                            {BADGE_TYPE_OPTIONS.map((badge) => (
                              <option key={badge.value} value={badge.value} className="bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                                {badge.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {job.isActive ? (
                            <span className="inline-flex items-center gap-1 text-green-400">
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                              Active
                            </span>
                          ) : (
                            <span className="text-slate-500">Inactive</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openCopyModal(job)}
                              className="p-2 transition-colors theme-text-tertiary hover:text-green-400 dark:hover:text-green-400"
                              title="Copy job"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                />
                              </svg>
                            </button>
                            <button
                              onClick={() => openEditModal(job)}
                              className="p-2 transition-colors theme-text-tertiary hover:text-blue-600 dark:hover:text-cyan-400"
                              title="Edit job"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                />
                              </svg>
                            </button>
                            <button
                              onClick={() => setShowDeleteConfirm(job)}
                              className="p-2 transition-colors theme-text-tertiary hover:text-red-400"
                              title="Delete job"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {filteredJobs?.length === 0 && (
                  <div className="text-center py-12 theme-text-tertiary">
                    No jobs found matching your filters
                  </div>
                )}
              </Card>
            </div>

            {/* Jobs Cards - Mobile */}
            <div className="sm:hidden space-y-3">
              {filteredJobs?.map((job) => (
                <Card key={job._id} padding="sm">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate theme-text-primary">{job.title}</p>
                      <p className="text-xs theme-text-tertiary" title={job.locations?.join(", ") || job.location}>{getLocationsDisplay(job)}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openCopyModal(job)}
                        className="p-1.5 transition-colors theme-text-tertiary hover:text-green-400 dark:hover:text-green-400"
                        title="Copy job"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => openEditModal(job)}
                        className="p-1.5 transition-colors theme-text-tertiary hover:text-blue-600 dark:hover:text-cyan-400"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(job)}
                        className="p-1.5 transition-colors theme-text-tertiary hover:text-red-400"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="ui-badge ui-badge-blue">
                      {job.department}
                    </span>
                    <span className={`px-2 py-0.5 text-[10px] rounded-full border ${
                      job.positionType === "management"
                        ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                        : job.positionType === "salaried"
                        ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                        : "bg-slate-500/20 text-slate-400 border-slate-500/30"
                    }`}>
                      {job.positionType || "hourly"}
                    </span>
                    {job.isActive ? (
                      <span className="inline-flex items-center gap-1 text-green-400 text-[10px]">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Active
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[10px]">Inactive</span>
                    )}
                  </div>
                  <select
                    value={getEffectiveBadgeType(job)}
                    onChange={(e) => handleBadgeTypeChange(job, e.target.value)}
                    className={`w-full px-3 py-2 text-xs rounded-lg border cursor-pointer focus:outline-none ${
                      getEffectiveBadgeType(job) === "urgently_hiring"
                        ? "bg-red-500/20 text-red-400 border-red-500/30"
                        : getEffectiveBadgeType(job) === "accepting_applications"
                        ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                        : "bg-green-500/20 text-green-400 border-green-500/30"
                    }`}
                  >
                    {BADGE_TYPE_OPTIONS.map((badge) => (
                      <option key={badge.value} value={badge.value} className="bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                        {badge.label}
                      </option>
                    ))}
                  </select>
                </Card>
              ))}
              {filteredJobs?.length === 0 && (
                <div className="text-center py-12 theme-text-tertiary">
                  No jobs found matching your filters
                </div>
              )}
            </div>
          </div>

          {/* Add/Edit Modal */}
          {showModal && (
            <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
              <div className="bg-white dark:bg-slate-800 border border-[var(--theme-border-secondary)] rounded-t-xl sm:rounded-2xl p-4 sm:p-6 w-full sm:max-w-2xl max-h-[85vh] sm:max-h-[90vh] overflow-y-auto shadow-xl">
                <h2 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6 theme-text-primary">
                  {editingJob ? "Edit Job" : "Add New Job"}
                </h2>
                <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="block ui-section-label mb-1">
                        Job Title *
                      </label>
                      <input
                        type="text"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        className="theme-input w-full px-4 py-2"
                        required
                      />
                    </div>
                    <div>
                      <label className="block ui-section-label mb-1">
                        Locations *
                      </label>
                      {/* Location tags */}
                      {formData.locations.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {formData.locations.map((loc) => (
                            <span
                              key={loc}
                              className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30"
                            >
                              {loc}
                              <button
                                type="button"
                                onClick={() => removeLocation(loc)}
                                className="hover:text-red-400 ml-1"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Add new location input */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newLocation}
                          onChange={(e) => setNewLocation(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addLocation();
                            }
                          }}
                          placeholder="Add location (e.g., Bensenville, IL)"
                          className="theme-input flex-1 px-4 py-2"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={addLocation}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </Button>
                      </div>
                      <p className="text-xs mt-1 theme-text-tertiary">
                        Add one or more locations. Press Enter or click + to add.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                    <div>
                      <label className="block ui-section-label mb-1">
                        Department *
                      </label>
                      <select
                        value={formData.department}
                        onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                        className="theme-input w-full px-4 py-2"
                      >
                        {DEPARTMENT_OPTIONS.map((dept) => (
                          <option key={dept} value={dept}>
                            {dept}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block ui-section-label mb-1">
                        Employment Type *
                      </label>
                      <select
                        value={formData.type}
                        onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                        className="theme-input w-full px-4 py-2"
                      >
                        {TYPE_OPTIONS.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block ui-section-label mb-1">
                        Position Type *
                      </label>
                      <select
                        value={formData.positionType}
                        onChange={(e) => setFormData({ ...formData, positionType: e.target.value })}
                        className="theme-input w-full px-4 py-2"
                      >
                        {POSITION_TYPE_OPTIONS.map((pt) => (
                          <option key={pt.value} value={pt.value}>
                            {pt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="block ui-section-label mb-1">
                        Badge Type
                      </label>
                      <select
                        value={formData.badgeType}
                        onChange={(e) => setFormData({ ...formData, badgeType: e.target.value })}
                        className="theme-input w-full px-4 py-2"
                      >
                        {BADGE_TYPE_OPTIONS.map((badge) => (
                          <option key={badge.value} value={badge.value}>
                            {badge.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs mt-1 theme-text-tertiary">
                        Badge displayed on the careers page
                      </p>
                    </div>
                    {editingJob && (
                      <div className="flex items-center">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.isActive}
                            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                            className="w-5 h-5 rounded border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-blue-600 dark:text-cyan-500 focus:ring-cyan-500"
                          />
                          <div>
                            <span className="text-sm font-medium theme-text-primary">Active</span>
                            <p className="text-xs theme-text-tertiary">Visible on IE Tire website</p>
                          </div>
                        </label>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block ui-section-label mb-1">
                      Description *
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={4}
                      className="theme-input w-full px-4 py-2 resize-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block ui-section-label mb-1">
                      Benefits (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={formData.benefits}
                      onChange={(e) => setFormData({ ...formData, benefits: e.target.value })}
                      placeholder="Health Insurance, 401k Match, Paid Time Off"
                      className="theme-input w-full px-4 py-2"
                    />
                  </div>

                  <div>
                    <label className="block ui-section-label mb-1">
                      Keywords for AI Matching (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={formData.keywords}
                      onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                      placeholder="warehouse, logistics, leadership, forklift"
                      className="theme-input w-full px-4 py-2"
                    />
                    <p className="text-xs mt-1 theme-text-tertiary">
                      These keywords help the AI match resumes to this position
                    </p>
                  </div>

                  <div className="flex justify-end gap-3 pt-4">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setShowModal(false);
                        resetForm();
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary">
                      {editingJob ? "Save Changes" : "Create Job"}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Delete Confirmation Modal */}
          {showDeleteConfirm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-slate-800 border border-[var(--theme-border-secondary)] rounded-2xl p-4 sm:p-6 w-full max-w-md shadow-xl">
                <h2 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4 theme-text-primary">Delete Job</h2>
                <p className="text-sm sm:text-base mb-4 sm:mb-6 theme-text-secondary">
                  Are you sure you want to delete <strong>{showDeleteConfirm.title}</strong>? This
                  action cannot be undone.
                </p>
                <div className="flex justify-end gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setShowDeleteConfirm(null)}
                  >
                    Cancel
                  </Button>
                  <Button variant="danger" onClick={handleDelete}>
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </Protected>
  );
}
