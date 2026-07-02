"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "../auth-context";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

const REQUEST_TYPES = [
  { value: "vacation", label: "Vacation", color: "blue" },
  { value: "sick", label: "Sick", color: "amber" },
  { value: "personal", label: "Personal", color: "purple" },
  { value: "bereavement", label: "Bereavement", color: "slate" },
  { value: "other", label: "Other", color: "gray" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All Requests" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
];

// ui-badge color keys for request type
const typeBadgeColor: Record<string, string> = {
  vacation: "ui-badge ui-badge-blue",
  sick: "ui-badge ui-badge-amber",
  personal: "ui-badge ui-badge-purple",
  bereavement: "ui-badge ui-badge-gray",
  other: "ui-badge ui-badge-gray",
};

const statusBadgeColor: Record<string, string> = {
  pending: "ui-badge ui-badge-amber",
  approved: "ui-badge ui-badge-green",
  denied: "ui-badge ui-badge-red",
};

function TimeOffContent() {
  const { user, canManageTimeOff } = useAuth();

  const allRequests = useQuery(api.timeOffRequests.getAll, {}) || [];
  const stats = useQuery(api.timeOffRequests.getStats) || {
    pendingCount: 0,
    outToday: 0,
    requestsThisWeek: 0,
    approvedUpcoming: 0,
  };

  const approveMutation = useMutation(api.timeOffRequests.approve);
  const denyMutation = useMutation(api.timeOffRequests.deny);

  const [filterStatus, setFilterStatus] = useState<string>("pending");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<Id<"timeOffRequests"> | null>(null);
  const [managerNotes, setManagerNotes] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Redirect if user doesn't have permission
  if (!canManageTimeOff) {
    return (
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center px-4">
            <h1 className="text-2xl font-bold theme-text-primary">Access Denied</h1>
            <p className="mt-2 theme-text-secondary">
              You don&apos;t have permission to view this page.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const filteredRequests = allRequests.filter((request) => {
    const matchesStatus = filterStatus === "all" || request.status === filterStatus;
    const matchesSearch =
      searchTerm === "" ||
      request.personnelName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      request.personnelDepartment?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const handleApprove = async (requestId: Id<"timeOffRequests">) => {
    if (!user) return;
    setIsProcessing(true);
    try {
      await approveMutation({
        requestId,
        reviewedBy: user._id,
        managerNotes: managerNotes || undefined,
      });
      setSelectedRequest(null);
      setManagerNotes("");
    } catch (error) {
      console.error("Failed to approve request:", error);
    }
    setIsProcessing(false);
  };

  const handleDeny = async (requestId: Id<"timeOffRequests">) => {
    if (!user) return;
    setIsProcessing(true);
    try {
      await denyMutation({
        requestId,
        reviewedBy: user._id,
        managerNotes: managerNotes || undefined,
      });
      setSelectedRequest(null);
      setManagerNotes("");
    } catch (error) {
      console.error("Failed to deny request:", error);
    }
    setIsProcessing(false);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const selectedRequestData = selectedRequest
    ? allRequests.find((r) => r._id === selectedRequest)
    : null;

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Sticky iOS-style page header */}
        <header className="flex-shrink-0 sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary truncate">
                Time Off Requests
              </h1>
              <p className="text-xs sm:text-sm mt-0.5 hidden sm:block theme-text-tertiary">
                Review and manage employee time off requests
              </p>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
            <Card padding="sm">
              <div className="text-center py-1">
                <p className="text-lg sm:text-2xl font-bold text-amber-500 dark:text-amber-400">{stats.pendingCount}</p>
                <p className="text-[10px] sm:text-xs theme-text-tertiary mt-0.5">Pending</p>
              </div>
            </Card>
            <Card padding="sm">
              <div className="text-center py-1">
                <p className="text-lg sm:text-2xl font-bold text-[#007AFF]">{stats.outToday}</p>
                <p className="text-[10px] sm:text-xs theme-text-tertiary mt-0.5">Out Today</p>
              </div>
            </Card>
            <Card padding="sm">
              <div className="text-center py-1">
                <p className="text-lg sm:text-2xl font-bold text-green-500 dark:text-green-400">{stats.approvedUpcoming}</p>
                <p className="text-[10px] sm:text-xs theme-text-tertiary mt-0.5">Upcoming</p>
              </div>
            </Card>
            <Card padding="sm">
              <div className="text-center py-1">
                <p className="text-lg sm:text-2xl font-bold theme-text-primary">{stats.requestsThisWeek}</p>
                <p className="text-[10px] sm:text-xs theme-text-tertiary mt-0.5">This Week</p>
              </div>
            </Card>
          </div>

          {/* Filters */}
          <Card padding="sm">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search by name or department..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {STATUS_OPTIONS.map((status) => (
                  <button
                    key={status.value}
                    onClick={() => setFilterStatus(status.value)}
                    className={`px-3 py-1.5 rounded-[9px] text-[13px] font-semibold whitespace-nowrap transition-colors ${
                      filterStatus === status.value
                        ? "theme-btn-primary"
                        : "ui-btn-ghost"
                    }`}
                  >
                    {status.label}
                    {status.value === "pending" && stats.pendingCount > 0 && (
                      <span className="ml-1.5 bg-amber-500 text-white px-1.5 py-0.5 rounded-full text-xs">
                        {stats.pendingCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* Requests List */}
          <Card padding="sm" className="overflow-hidden">
            {filteredRequests.length === 0 ? (
              <div className="py-10 text-center">
                <svg
                  className="w-12 h-12 mx-auto mb-3 theme-text-tertiary opacity-40"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <p className="text-sm theme-text-tertiary">No time off requests found</p>
              </div>
            ) : (
              <div className="divide-y theme-border-secondary">
                {filteredRequests.map((request) => (
                  <div
                    key={request._id}
                    className="p-4 hover:bg-gray-50 dark:hover:bg-slate-700/40 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-[15px] theme-text-primary">
                            {request.personnelName}
                          </h3>
                          <span className={typeBadgeColor[request.requestType] ?? "ui-badge ui-badge-gray"}>
                            {REQUEST_TYPES.find((t) => t.value === request.requestType)?.label || request.requestType}
                          </span>
                          <span className={statusBadgeColor[request.status] ?? "ui-badge ui-badge-gray"}>
                            {request.status}
                          </span>
                        </div>
                        <div className="mt-1 text-sm theme-text-tertiary">
                          {request.personnelDepartment} &bull; {request.personnelPosition}
                        </div>
                        <div className="mt-2 text-sm theme-text-primary">
                          <span className="font-medium">{formatDate(request.startDate)}</span>
                          {request.startDate !== request.endDate && (
                            <>
                              <span className="theme-text-tertiary"> to </span>
                              <span className="font-medium">{formatDate(request.endDate)}</span>
                            </>
                          )}
                          <span className="ml-2 theme-text-tertiary">
                            ({request.totalDays} day{request.totalDays !== 1 ? "s" : ""})
                          </span>
                        </div>
                        {request.reason && (
                          <p className="mt-2 text-sm theme-text-secondary">
                            {request.reason}
                          </p>
                        )}
                        <p className="mt-2 text-xs theme-text-tertiary">
                          Requested {formatTimestamp(request.requestedAt)}
                          {request.reviewedBy && (
                            <>
                              <span> &bull; </span>
                              {request.status === "approved" ? "Approved" : "Denied"} by {request.reviewerName}
                            </>
                          )}
                        </p>
                        {request.managerNotes && (
                          <p className="mt-1 text-xs italic theme-text-tertiary">
                            Note: {request.managerNotes}
                          </p>
                        )}
                      </div>

                      {request.status === "pending" && (
                        <div className="flex gap-2 flex-shrink-0">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setSelectedRequest(request._id);
                              setManagerNotes("");
                            }}
                          >
                            Review
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </main>

      {/* Review Modal */}
      {selectedRequest && selectedRequestData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
            <div className="px-5 py-4 border-b theme-border-secondary">
              <h2 className="text-[17px] font-semibold theme-text-primary">Review Time Off Request</h2>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div>
                <p className="ui-section-label">Employee</p>
                <p className="font-medium text-sm theme-text-primary mt-0.5">{selectedRequestData.personnelName}</p>
              </div>
              <div>
                <p className="ui-section-label">Type</p>
                <p className="font-medium text-sm theme-text-primary mt-0.5">
                  {REQUEST_TYPES.find((t) => t.value === selectedRequestData.requestType)?.label}
                </p>
              </div>
              <div>
                <p className="ui-section-label">Dates</p>
                <p className="font-medium text-sm theme-text-primary mt-0.5">
                  {formatDate(selectedRequestData.startDate)}
                  {selectedRequestData.startDate !== selectedRequestData.endDate && (
                    <> to {formatDate(selectedRequestData.endDate)}</>
                  )}
                  <span className="ml-2 font-normal theme-text-tertiary">
                    ({selectedRequestData.totalDays} day{selectedRequestData.totalDays !== 1 ? "s" : ""})
                  </span>
                </p>
              </div>
              {selectedRequestData.reason && (
                <div>
                  <p className="ui-section-label">Reason</p>
                  <p className="text-sm theme-text-primary mt-0.5">{selectedRequestData.reason}</p>
                </div>
              )}
            </div>

            <div className="px-5 pb-4">
              <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">
                Manager Notes (optional)
              </label>
              <textarea
                value={managerNotes}
                onChange={(e) => setManagerNotes(e.target.value)}
                rows={3}
                className="theme-input w-full px-3 py-2 text-sm"
                placeholder="Add a note for the employee..."
              />
            </div>

            <div className="px-5 pb-4 flex gap-3">
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => handleDeny(selectedRequest)}
                disabled={isProcessing}
              >
                Deny
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => handleApprove(selectedRequest)}
                disabled={isProcessing}
              >
                Approve
              </Button>
            </div>

            <div className="px-5 pb-5 border-t theme-border-secondary pt-3">
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setSelectedRequest(null);
                  setManagerNotes("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TimeOffPage() {
  return (
    <Protected>
      <TimeOffContent />
    </Protected>
  );
}
