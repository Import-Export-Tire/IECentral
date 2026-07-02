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
import SectionHeader from "@/components/ui/SectionHeader";

const TABS = [
  { id: "live", label: "Live Status" },
  { id: "attendance", label: "Attendance Issues" },
  { id: "daily", label: "Daily View" },
  { id: "corrections", label: "Corrections" },
];

const ENTRY_TYPES = [
  { value: "clock_in", label: "Clock In" },
  { value: "clock_out", label: "Clock Out" },
  { value: "break_start", label: "Break Start" },
  { value: "break_end", label: "Break End" },
];

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

function TimeClockContent() {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState("live");
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [filterDepartment, setFilterDepartment] = useState("all");

  // Modals
  const [showAddEntryModal, setShowAddEntryModal] = useState(false);
  const [showEditEntryModal, setShowEditEntryModal] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<{
    _id: Id<"timeEntries">;
    timestamp: number;
    type: string;
    personnelName: string;
  } | null>(null);
  const [selectedCorrection, setSelectedCorrection] = useState<{
    _id: Id<"timeCorrections">;
    personnelName: string;
    date: string;
    requestType: string;
    reason: string;
    requestedTimestamp?: number;
    requestedType?: string;
    currentTimestamp?: number;
  } | null>(null);

  // Form states
  const [addEntryForm, setAddEntryForm] = useState({
    personnelId: "",
    date: new Date().toISOString().split("T")[0],
    type: "clock_in",
    time: "09:00",
    reason: "",
  });
  const [editEntryForm, setEditEntryForm] = useState({
    time: "",
    reason: "",
  });
  const [correctionReviewForm, setCorrectionReviewForm] = useState({
    notes: "",
  });

  // Queries
  const activeClocks = useQuery(api.timeClock.getActiveClocks);
  const dailySummary = useQuery(api.timeClock.getDailySummary, { date: selectedDate });
  const pendingCorrections = useQuery(api.timeClock.getPendingCorrections);
  const allCorrections = useQuery(api.timeClock.getCorrections, {});
  const personnel = useQuery(api.personnel.listAll, { status: "active" });
  const activePersonnel = personnel || [];
  const liveAttendance = useQuery(api.attendance.getTodayLive, {
    userId: user?._id as Id<"users"> | undefined,
  });
  const attendanceIssues = useQuery(api.attendance.getIssues, {
    userId: user?._id as Id<"users"> | undefined,
  });

  // Mutations
  const addMissedEntry = useMutation(api.timeClock.addMissedEntry);
  const editEntry = useMutation(api.timeClock.editEntry);
  const deleteEntry = useMutation(api.timeClock.deleteEntry);
  const forceClockOut = useMutation(api.timeClock.forceClockOut);
  const reviewCorrection = useMutation(api.timeClock.reviewCorrection);
  const createWriteUpFromAttendance = useMutation(api.attendance.createWriteUpFromAttendance);

  // Get unique departments
  const departments = [
    ...new Set(dailySummary?.map((s) => s.department) || []),
  ].sort();

  // Filter daily summary
  const filteredSummary =
    filterDepartment === "all"
      ? dailySummary
      : dailySummary?.filter((s) => s.department === filterDepartment);

  // Stats
  const clockedInCount = activeClocks?.length || 0;
  const onBreakCount = activeClocks?.filter((c) => c.status === "on_break").length || 0;
  const totalHoursToday = dailySummary?.reduce((sum, s) => sum + s.totalHours, 0) || 0;
  const pendingCount = pendingCorrections?.length || 0;
  const lateCount = liveAttendance?.filter((a) => a.attendanceStatus === "late").length || 0;
  const graceCount = liveAttendance?.filter((a) => a.attendanceStatus === "grace_period").length || 0;
  const unresolvedIssues = attendanceIssues?.filter((i) => !i.hasLinkedWriteUp).length || 0;

  // Handle write-up creation
  const handleCreateWriteUp = async (attendanceId: Id<"attendance">) => {
    if (!user) return;
    if (confirm("Create a write-up for this attendance issue? The severity will be automatically determined based on how many attendance write-ups this employee has in the last 6 months.")) {
      try {
        await createWriteUpFromAttendance({
          attendanceId,
          userId: user._id as Id<"users">,
        });
        alert("Write-up created successfully!");
      } catch (error: any) {
        alert(error.message || "Failed to create write-up");
      }
    }
  };

  const handleAddEntry = async () => {
    if (!user || !addEntryForm.personnelId || !addEntryForm.reason) return;

    const [hours, minutes] = addEntryForm.time.split(":").map(Number);
    const date = new Date(addEntryForm.date);
    date.setHours(hours, minutes, 0, 0);

    await addMissedEntry({
      personnelId: addEntryForm.personnelId as Id<"personnel">,
      date: addEntryForm.date,
      type: addEntryForm.type,
      timestamp: date.getTime(),
      userId: user._id as Id<"users">,
      reason: addEntryForm.reason,
    });

    setShowAddEntryModal(false);
    setAddEntryForm({
      personnelId: "",
      date: new Date().toISOString().split("T")[0],
      type: "clock_in",
      time: "09:00",
      reason: "",
    });
  };

  const handleEditEntry = async () => {
    if (!user || !selectedEntry || !editEntryForm.reason) return;

    const [hours, minutes] = editEntryForm.time.split(":").map(Number);
    const date = new Date(selectedEntry.timestamp);
    date.setHours(hours, minutes, 0, 0);

    await editEntry({
      timeEntryId: selectedEntry._id,
      newTimestamp: date.getTime(),
      userId: user._id as Id<"users">,
      reason: editEntryForm.reason,
    });

    setShowEditEntryModal(false);
    setSelectedEntry(null);
    setEditEntryForm({ time: "", reason: "" });
  };

  const handleDeleteEntry = async (entryId: Id<"timeEntries">) => {
    if (confirm("Are you sure you want to delete this time entry?")) {
      await deleteEntry({ timeEntryId: entryId });
    }
  };

  const handleForceClockOut = async (personnelId: Id<"personnel">) => {
    if (!user) return;
    if (confirm("Force clock out this employee now?")) {
      await forceClockOut({
        personnelId,
        userId: user._id as Id<"users">,
      });
    }
  };

  const handleReviewCorrection = async (status: "approved" | "denied") => {
    if (!user || !selectedCorrection) return;

    await reviewCorrection({
      correctionId: selectedCorrection._id,
      status,
      userId: user._id as Id<"users">,
      reviewNotes: correctionReviewForm.notes || undefined,
    });

    setShowCorrectionModal(false);
    setSelectedCorrection(null);
    setCorrectionReviewForm({ notes: "" });
  };

  const openEditModal = (entry: typeof selectedEntry) => {
    if (!entry) return;
    setSelectedEntry(entry);
    setEditEntryForm({
      time: new Date(entry.timestamp).toTimeString().slice(0, 5),
      reason: "",
    });
    setShowEditEntryModal(true);
  };

  const openCorrectionModal = (correction: typeof selectedCorrection) => {
    setSelectedCorrection(correction);
    setCorrectionReviewForm({ notes: "" });
    setShowCorrectionModal(true);
  };

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#f2f2f7]/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-[var(--theme-border-secondary)]">
          <div className="px-4 sm:px-8 py-4 sm:py-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">
                  Time Clock
                </h1>
                <p className="text-sm theme-text-tertiary">
                  Manage employee clock in/out and time entries
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="theme-input px-3 py-2 text-sm"
                />
                <Button
                  variant="secondary"
                  onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
                >
                  Today
                </Button>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3 mt-4">
              <div className="theme-card p-3">
                <p className="text-xs theme-text-tertiary">Clocked In</p>
                <p className="text-xl font-bold text-green-600 dark:text-green-400">
                  {clockedInCount}
                </p>
              </div>
              <div className="theme-card p-3">
                <p className="text-xs theme-text-tertiary">On Break</p>
                <p className="text-xl font-bold text-amber-600 dark:text-amber-400">
                  {onBreakCount}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${lateCount > 0 ? "bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30" : "theme-card"}`}>
                <p className="text-xs theme-text-tertiary">Late Today</p>
                <p className={`text-xl font-bold ${lateCount > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400 dark:text-slate-400"}`}>
                  {lateCount}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${graceCount > 0 ? "bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30" : "theme-card"}`}>
                <p className="text-xs theme-text-tertiary">Grace Period</p>
                <p className={`text-xl font-bold ${graceCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400 dark:text-slate-400"}`}>
                  {graceCount}
                </p>
              </div>
              <div className="theme-card p-3">
                <p className="text-xs theme-text-tertiary">Total Hours</p>
                <p className="text-xl font-bold text-blue-600 dark:text-cyan-400">
                  {totalHoursToday.toFixed(1)}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${unresolvedIssues > 0 ? "bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30" : "theme-card"}`}>
                <p className="text-xs theme-text-tertiary">Needs Action</p>
                <p className={`text-xl font-bold ${unresolvedIssues > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400 dark:text-slate-400"}`}>
                  {unresolvedIssues}
                </p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mt-4 overflow-x-auto">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? "bg-[#007AFF] text-white dark:bg-cyan-500"
                      : "text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-800"
                  }`}
                >
                  {tab.label}
                  {tab.id === "attendance" && unresolvedIssues > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-red-500 text-white">
                      {unresolvedIssues}
                    </span>
                  )}
                  {tab.id === "corrections" && pendingCount > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-red-500 text-white">
                      {pendingCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 sm:px-8 pb-8 pt-4">
          {/* Live Status Tab */}
          {activeTab === "live" && (
            <div className="space-y-4">
              {/* Late arrivals alert */}
              {lateCount > 0 && (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center bg-red-100 dark:bg-red-500/20">
                      <span className="text-xl">⚠️</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-red-700 dark:text-red-400">
                        {lateCount} Late Arrival{lateCount > 1 ? "s" : ""} Today
                      </h3>
                      <p className="text-sm text-red-600 dark:text-red-400/70">
                        Review the attendance issues tab to take action
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Live attendance list */}
              {liveAttendance && liveAttendance.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {liveAttendance.map((person) => {
                    const isLate = person.attendanceStatus === "late";
                    const isGrace = person.attendanceStatus === "grace_period";
                    const isOnTime = person.attendanceStatus === "on_time";

                    return (
                      <div
                        key={person.personnelId}
                        className={`p-4 rounded-xl ${
                          isLate
                            ? "bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30"
                            : isGrace
                            ? "bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30"
                            : "theme-card"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold theme-text-primary">
                              {person.name}
                            </h3>
                            <p className="text-sm theme-text-tertiary">
                              {person.position} - {person.department}
                            </p>
                          </div>
                          {/* Status badge */}
                          {person.isClockedIn ? (
                            <span className={`ui-badge ${
                              isLate
                                ? "ui-badge-red"
                                : isGrace
                                ? "ui-badge-amber"
                                : person.isOnBreak
                                ? "ui-badge-amber"
                                : "ui-badge-green"
                            }`}>
                              {isLate ? `${person.minutesLate}m Late` : isGrace ? "Grace" : person.isOnBreak ? "Break" : "On Time"}
                            </span>
                          ) : (
                            <span className="ui-badge ui-badge-gray">Not In</span>
                          )}
                        </div>

                        {/* Time details */}
                        <div className="mt-3 pt-3 border-t border-[var(--theme-border-secondary)]">
                          {person.scheduledStart && (
                            <div className="flex justify-between text-sm">
                              <span className="theme-text-tertiary">Scheduled:</span>
                              <span className="theme-text-primary">{person.scheduledStart}</span>
                            </div>
                          )}
                          {person.isClockedIn && (
                            <>
                              <div className="flex justify-between text-sm mt-1">
                                <span className="theme-text-tertiary">Clocked In:</span>
                                <span className={`font-medium ${
                                  isLate ? "text-red-600 dark:text-red-400"
                                  : isGrace ? "text-amber-600 dark:text-amber-400"
                                  : "text-green-600 dark:text-green-400"
                                }`}>
                                  {person.actualStart}
                                </span>
                              </div>
                              {person.clockInTime && (
                                <div className="flex justify-between text-sm mt-1">
                                  <span className="theme-text-tertiary">Working:</span>
                                  <span className="font-medium text-blue-600 dark:text-cyan-400">
                                    {formatDuration((Date.now() - person.clockInTime) / (1000 * 60 * 60))}
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                        </div>

                        {/* Actions */}
                        {person.isClockedIn && (
                          <Button
                            variant="secondary"
                            className="mt-3 w-full"
                            onClick={() => handleForceClockOut(person.personnelId)}
                          >
                            Force Clock Out
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 theme-text-tertiary">
                  No employees with schedules today
                </div>
              )}
            </div>
          )}

          {/* Attendance Issues Tab */}
          {activeTab === "attendance" && (
            <div className="space-y-4">
              {/* Info box */}
              <Card padding="md">
                <h3 className="font-semibold mb-1 theme-text-primary">
                  Attendance Write-Up Progression
                </h3>
                <p className="text-sm theme-text-secondary">
                  Click "Write Up" to automatically create a disciplinary action based on how many attendance issues this employee has had in the last 6 months:
                </p>
                <ul className="text-sm mt-2 space-y-1 theme-text-secondary">
                  <li>• 1st offense → Verbal Warning</li>
                  <li>• 2nd offense → Written Warning</li>
                  <li>• 3rd offense → Final Warning</li>
                  <li>• 4th+ offense → Suspension</li>
                </ul>
              </Card>

              {/* Issues list */}
              {attendanceIssues && attendanceIssues.length > 0 ? (
                <div className="space-y-3">
                  {attendanceIssues.map((issue) => (
                    <div
                      key={issue._id}
                      className={`p-4 rounded-xl ${
                        issue.hasLinkedWriteUp
                          ? "bg-gray-50 dark:bg-slate-800/30 border border-gray-200 dark:border-slate-700/50"
                          : issue.status === "no_call_no_show"
                          ? "bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30"
                          : "bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold theme-text-primary">
                              {issue.personnelName}
                            </h3>
                            <span className={`ui-badge ${
                              issue.status === "no_call_no_show"
                                ? "ui-badge-red"
                                : "ui-badge-amber"
                            }`}>
                              {issue.status === "no_call_no_show" ? "NO CALL/NO SHOW" : `${issue.minutesLate}min LATE`}
                            </span>
                            {issue.hasLinkedWriteUp && (
                              <span className="ui-badge ui-badge-green">✓ Write-up created</span>
                            )}
                          </div>
                          <p className="text-sm mt-1 theme-text-secondary">
                            {issue.date} • {issue.department}
                          </p>
                          {issue.scheduledStart && issue.actualStart && (
                            <p className="text-sm theme-text-tertiary">
                              Scheduled: {issue.scheduledStart} → Arrived: {issue.actualStart}
                            </p>
                          )}
                          {!issue.hasLinkedWriteUp && (
                            <p className="text-xs mt-2 theme-text-tertiary">
                              {issue.writeUpsIn6Months} attendance write-up{issue.writeUpsIn6Months !== 1 ? "s" : ""} in last 6 months •
                              <span className={`font-medium ${
                                issue.recommendedSeverity === "suspension" ? "text-red-600 dark:text-red-400"
                                : issue.recommendedSeverity === "final_warning" ? "text-amber-600 dark:text-amber-400"
                                : "text-gray-700 dark:text-slate-300"
                              }`}>
                                {" "}Next: {issue.severityLabel}
                              </span>
                            </p>
                          )}
                        </div>

                        {/* Write-up button */}
                        {!issue.hasLinkedWriteUp && (
                          <Button
                            variant={
                              issue.recommendedSeverity === "suspension" ? "danger"
                              : "primary"
                            }
                            onClick={() => handleCreateWriteUp(issue._id)}
                            className="whitespace-nowrap"
                          >
                            Write Up
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 theme-text-tertiary">
                  <div className="text-4xl mb-3">✅</div>
                  <p>No attendance issues to address</p>
                </div>
              )}
            </div>
          )}

          {/* Daily View Tab */}
          {activeTab === "daily" && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <select
                  value={filterDepartment}
                  onChange={(e) => setFilterDepartment(e.target.value)}
                  className="theme-input px-3 py-2 text-sm"
                >
                  <option value="all">All Departments</option>
                  {departments.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
                <Button
                  variant="primary"
                  onClick={() => setShowAddEntryModal(true)}
                >
                  Add Entry
                </Button>
              </div>

              {filteredSummary && filteredSummary.length > 0 ? (
                <div className="space-y-4">
                  {filteredSummary.map((summary) => (
                    <Card key={summary.personnelId} padding="md">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold theme-text-primary">
                            {summary.personnelName}
                          </h3>
                          <p className="text-sm theme-text-tertiary">
                            {summary.position} - {summary.department}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-blue-600 dark:text-cyan-400">
                            {formatDuration(summary.totalHours)}
                          </p>
                          {summary.breakMinutes > 0 && (
                            <p className="text-xs theme-text-tertiary">
                              ({summary.breakMinutes}m break)
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3 pt-3 border-t border-[var(--theme-border-secondary)]">
                        <div>
                          <p className="text-xs theme-text-tertiary">Clock In</p>
                          <p className="font-medium theme-text-primary">
                            {summary.clockIn ? formatTime(summary.clockIn) : "-"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs theme-text-tertiary">Clock Out</p>
                          <p className="font-medium theme-text-primary">
                            {summary.clockOut ? formatTime(summary.clockOut) : "-"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs theme-text-tertiary">Break Time</p>
                          <p className="font-medium theme-text-primary">
                            {summary.breakMinutes > 0 ? `${summary.breakMinutes}m` : "-"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs theme-text-tertiary">Status</p>
                          <span className={`ui-badge ${
                            summary.isComplete ? "ui-badge-green" : "ui-badge-amber"
                          }`}>
                            {summary.isComplete ? "Complete" : "In Progress"}
                          </span>
                        </div>
                      </div>

                      {/* Individual Entries */}
                      {summary.entries.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-[var(--theme-border-secondary)]">
                          <p className="text-xs font-medium mb-2 theme-text-tertiary">
                            Entries
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {summary.entries.map((entry) => (
                              <div
                                key={entry._id}
                                className="flex items-center gap-2 px-2 py-1 rounded bg-gray-100 dark:bg-slate-700 text-xs"
                              >
                                <span className="theme-text-secondary">
                                  {entry.type.replace("_", " ")}
                                </span>
                                <span className="font-medium theme-text-primary">
                                  {formatTime(entry.timestamp)}
                                </span>
                                {entry.editedBy && (
                                  <span className="text-amber-600 dark:text-amber-400">
                                    (edited)
                                  </span>
                                )}
                                <button
                                  onClick={() =>
                                    openEditModal({
                                      _id: entry._id,
                                      timestamp: entry.timestamp,
                                      type: entry.type,
                                      personnelName: summary.personnelName,
                                    })
                                  }
                                  className="p-0.5 rounded hover:bg-slate-600 theme-text-tertiary"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleDeleteEntry(entry._id)}
                                  className="p-0.5 rounded hover:bg-red-500/20 theme-text-tertiary hover:text-red-600 dark:hover:text-red-400"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 theme-text-tertiary">
                  No time entries for this date
                </div>
              )}
            </div>
          )}

          {/* Corrections Tab */}
          {activeTab === "corrections" && (
            <div className="space-y-4">
              {/* Pending Corrections */}
              <div>
                <SectionHeader title="Pending Corrections" />
                {pendingCorrections && pendingCorrections.length > 0 ? (
                  <div className="space-y-3">
                    {pendingCorrections.map((correction) => (
                      <Card key={correction._id} padding="md">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold theme-text-primary">
                              {correction.personnelName}
                            </h3>
                            <p className="text-sm theme-text-tertiary">
                              {correction.date} - {correction.requestType.replace("_", " ")}
                            </p>
                            <p className="text-sm mt-1 theme-text-secondary">
                              {correction.reason}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                openCorrectionModal({
                                  _id: correction._id,
                                  personnelName: correction.personnelName,
                                  date: correction.date,
                                  requestType: correction.requestType,
                                  reason: correction.reason,
                                  requestedTimestamp: correction.requestedTimestamp,
                                  requestedType: correction.requestedType,
                                  currentTimestamp: correction.currentTimestamp,
                                })
                              }
                            >
                              Review
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 theme-text-tertiary">
                    No pending corrections
                  </div>
                )}
              </div>

              {/* Recent Corrections */}
              <div className="mt-8">
                <SectionHeader title="Recent Corrections" />
                {allCorrections && allCorrections.filter((c) => c.status !== "pending").length > 0 ? (
                  <div className="space-y-3">
                    {allCorrections
                      .filter((c) => c.status !== "pending")
                      .slice(0, 10)
                      .map((correction) => (
                        <Card key={correction._id} padding="md">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold theme-text-primary">
                                  {correction.personnelName}
                                </h3>
                                <span className={`ui-badge ${
                                  correction.status === "approved"
                                    ? "ui-badge-green"
                                    : "ui-badge-red"
                                }`}>
                                  {correction.status}
                                </span>
                              </div>
                              <p className="text-sm theme-text-tertiary">
                                {correction.date} - {correction.requestType.replace("_", " ")}
                              </p>
                              <p className="text-sm mt-1 theme-text-tertiary">
                                {correction.reason}
                              </p>
                              {correction.reviewNotes && (
                                <p className="text-sm mt-1 italic theme-text-tertiary">
                                  Note: {correction.reviewNotes}
                                </p>
                              )}
                            </div>
                            <p className="text-xs theme-text-tertiary">
                              by {correction.reviewerName}
                            </p>
                          </div>
                        </Card>
                      ))}
                  </div>
                ) : (
                  <div className="text-center py-8 theme-text-tertiary">
                    No recent corrections
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Add Entry Modal */}
        {showAddEntryModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md theme-card rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4 theme-text-primary">
                Add Time Entry
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="ui-section-label block mb-1">
                    Employee
                  </label>
                  <select
                    value={addEntryForm.personnelId}
                    onChange={(e) => setAddEntryForm({ ...addEntryForm, personnelId: e.target.value })}
                    className="theme-input w-full px-3 py-2"
                  >
                    <option value="">Select employee...</option>
                    {activePersonnel.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.firstName} {p.lastName} - {p.department}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="ui-section-label block mb-1">
                      Date
                    </label>
                    <input
                      type="date"
                      value={addEntryForm.date}
                      onChange={(e) => setAddEntryForm({ ...addEntryForm, date: e.target.value })}
                      className="theme-input w-full px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="ui-section-label block mb-1">
                      Time
                    </label>
                    <input
                      type="time"
                      value={addEntryForm.time}
                      onChange={(e) => setAddEntryForm({ ...addEntryForm, time: e.target.value })}
                      className="theme-input w-full px-3 py-2"
                    />
                  </div>
                </div>
                <div>
                  <label className="ui-section-label block mb-1">
                    Entry Type
                  </label>
                  <select
                    value={addEntryForm.type}
                    onChange={(e) => setAddEntryForm({ ...addEntryForm, type: e.target.value })}
                    className="theme-input w-full px-3 py-2"
                  >
                    {ENTRY_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="ui-section-label block mb-1">
                    Reason
                  </label>
                  <input
                    type="text"
                    value={addEntryForm.reason}
                    onChange={(e) => setAddEntryForm({ ...addEntryForm, reason: e.target.value })}
                    placeholder="e.g., Forgot to clock in"
                    className="theme-input w-full px-3 py-2"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setShowAddEntryModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!addEntryForm.personnelId || !addEntryForm.reason}
                  onClick={handleAddEntry}
                >
                  Add Entry
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Entry Modal */}
        {showEditEntryModal && selectedEntry && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md theme-card rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4 theme-text-primary">
                Edit Time Entry
              </h2>
              <p className="text-sm mb-4 theme-text-tertiary">
                {selectedEntry.personnelName} - {selectedEntry.type.replace("_", " ")}
              </p>
              <div className="space-y-4">
                <div>
                  <label className="ui-section-label block mb-1">
                    New Time
                  </label>
                  <input
                    type="time"
                    value={editEntryForm.time}
                    onChange={(e) => setEditEntryForm({ ...editEntryForm, time: e.target.value })}
                    className="theme-input w-full px-3 py-2"
                  />
                </div>
                <div>
                  <label className="ui-section-label block mb-1">
                    Reason for Edit
                  </label>
                  <input
                    type="text"
                    value={editEntryForm.reason}
                    onChange={(e) => setEditEntryForm({ ...editEntryForm, reason: e.target.value })}
                    placeholder="e.g., Correcting clock-in time"
                    className="theme-input w-full px-3 py-2"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowEditEntryModal(false);
                    setSelectedEntry(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!editEntryForm.reason}
                  onClick={handleEditEntry}
                >
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Correction Review Modal */}
        {showCorrectionModal && selectedCorrection && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md theme-card rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4 theme-text-primary">
                Review Correction Request
              </h2>
              <div className="space-y-3 p-4 rounded-lg mb-4 bg-[#f2f2f7] dark:bg-slate-700/50 border border-[var(--theme-border-secondary)]">
                <div>
                  <span className="text-sm theme-text-tertiary">Employee:</span>
                  <p className="font-medium theme-text-primary">
                    {selectedCorrection.personnelName}
                  </p>
                </div>
                <div>
                  <span className="text-sm theme-text-tertiary">Date:</span>
                  <p className="font-medium theme-text-primary">
                    {selectedCorrection.date}
                  </p>
                </div>
                <div>
                  <span className="text-sm theme-text-tertiary">Request Type:</span>
                  <p className="font-medium theme-text-primary">
                    {selectedCorrection.requestType.replace("_", " ")}
                  </p>
                </div>
                <div>
                  <span className="text-sm theme-text-tertiary">Reason:</span>
                  <p className="font-medium theme-text-primary">
                    {selectedCorrection.reason}
                  </p>
                </div>
                {selectedCorrection.requestedTimestamp && (
                  <div>
                    <span className="text-sm theme-text-tertiary">Requested Time:</span>
                    <p className="font-medium theme-text-primary">
                      {formatTime(selectedCorrection.requestedTimestamp)}
                    </p>
                  </div>
                )}
              </div>
              <div>
                <label className="ui-section-label block mb-1">
                  Review Notes (optional)
                </label>
                <textarea
                  value={correctionReviewForm.notes}
                  onChange={(e) => setCorrectionReviewForm({ notes: e.target.value })}
                  placeholder="Add any notes about this decision..."
                  rows={2}
                  className="theme-input w-full px-3 py-2"
                />
              </div>
              <div className="flex gap-3 mt-6">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowCorrectionModal(false);
                    setSelectedCorrection(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={() => handleReviewCorrection("denied")}
                >
                  Deny
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => handleReviewCorrection("approved")}
                >
                  Approve
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function TimeClock() {
  return (
    <Protected>
      <TimeClockContent />
    </Protected>
  );
}
