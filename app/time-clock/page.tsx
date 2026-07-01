"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";

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
  const { theme } = useTheme();
  const isDark = theme === "dark";
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
    <div className={`flex h-screen theme-bg-primary`}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        {/* Header */}
        <div
          className={`sticky top-0 z-10 backdrop-blur-md ${
            isDark ? "bg-slate-900/80" : "bg-[#f2f2f7]/80"
          }`}
        >
          <div className="px-4 sm:px-8 py-4 sm:py-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Time Clock
                </h1>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Manage employee clock in/out and time entries
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className={`px-3 py-2 rounded-lg text-sm ${
                    isDark
                      ? "bg-slate-800 border-slate-700 text-white"
                      : "bg-white border-gray-200 text-gray-900"
                  } border`}
                />
                <button
                  onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    isDark
                      ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                >
                  Today
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3 mt-4">
              <div className={`p-3 rounded-xl ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Clocked In</p>
                <p className={`text-xl font-bold ${isDark ? "text-green-400" : "text-green-600"}`}>
                  {clockedInCount}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>On Break</p>
                <p className={`text-xl font-bold ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                  {onBreakCount}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${lateCount > 0 ? (isDark ? "bg-red-500/10 border border-red-500/30" : "bg-red-50 border border-red-200") : (isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm")}`}>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Late Today</p>
                <p className={`text-xl font-bold ${lateCount > 0 ? (isDark ? "text-red-400" : "text-red-600") : (isDark ? "text-slate-400" : "text-gray-400")}`}>
                  {lateCount}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${graceCount > 0 ? (isDark ? "bg-amber-500/10 border border-amber-500/30" : "bg-amber-50 border border-amber-200") : (isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm")}`}>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Grace Period</p>
                <p className={`text-xl font-bold ${graceCount > 0 ? (isDark ? "text-amber-400" : "text-amber-600") : (isDark ? "text-slate-400" : "text-gray-400")}`}>
                  {graceCount}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Total Hours</p>
                <p className={`text-xl font-bold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                  {totalHoursToday.toFixed(1)}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${unresolvedIssues > 0 ? (isDark ? "bg-red-500/10 border border-red-500/30" : "bg-red-50 border border-red-200") : (isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm")}`}>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Needs Action</p>
                <p className={`text-xl font-bold ${unresolvedIssues > 0 ? (isDark ? "text-red-400" : "text-red-600") : (isDark ? "text-slate-400" : "text-gray-400")}`}>
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
                      ? isDark
                        ? "bg-cyan-500 text-white"
                        : "bg-blue-600 text-white"
                      : isDark
                        ? "text-slate-400 hover:bg-slate-800"
                        : "text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {tab.label}
                  {tab.id === "attendance" && unresolvedIssues > 0 && (
                    <span className={`ml-2 px-1.5 py-0.5 text-xs rounded-full ${
                      isDark ? "bg-red-500 text-white" : "bg-red-500 text-white"
                    }`}>
                      {unresolvedIssues}
                    </span>
                  )}
                  {tab.id === "corrections" && pendingCount > 0 && (
                    <span className={`ml-2 px-1.5 py-0.5 text-xs rounded-full ${
                      isDark ? "bg-red-500 text-white" : "bg-red-500 text-white"
                    }`}>
                      {pendingCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 sm:px-8 pb-8">
          {/* Live Status Tab */}
          {activeTab === "live" && (
            <div className="space-y-4">
              {/* Late arrivals alert */}
              {lateCount > 0 && (
                <div className={`p-4 rounded-xl ${isDark ? "bg-red-500/10 border border-red-500/30" : "bg-red-50 border border-red-200"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-red-500/20" : "bg-red-100"}`}>
                      <span className="text-xl">⚠️</span>
                    </div>
                    <div>
                      <h3 className={`font-semibold ${isDark ? "text-red-400" : "text-red-700"}`}>
                        {lateCount} Late Arrival{lateCount > 1 ? "s" : ""} Today
                      </h3>
                      <p className={`text-sm ${isDark ? "text-red-400/70" : "text-red-600"}`}>
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
                            ? isDark ? "bg-red-500/10 border border-red-500/30" : "bg-red-50 border border-red-200"
                            : isGrace
                            ? isDark ? "bg-amber-500/10 border border-amber-500/30" : "bg-amber-50 border border-amber-200"
                            : isDark
                            ? "bg-slate-800/50 border border-slate-700"
                            : "bg-white border border-gray-200 shadow-sm"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                              {person.name}
                            </h3>
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {person.position} - {person.department}
                            </p>
                          </div>
                          {/* Status badge */}
                          {person.isClockedIn ? (
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              isLate
                                ? "bg-red-500/20 text-red-400"
                                : isGrace
                                ? "bg-amber-500/20 text-amber-400"
                                : person.isOnBreak
                                ? "bg-amber-500/20 text-amber-400"
                                : "bg-green-500/20 text-green-400"
                            }`}>
                              {isLate ? `${person.minutesLate}m Late` : isGrace ? "Grace" : person.isOnBreak ? "Break" : "On Time"}
                            </span>
                          ) : (
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${isDark ? "bg-slate-700 text-slate-400" : "bg-gray-100 text-gray-500"}`}>
                              Not In
                            </span>
                          )}
                        </div>

                        {/* Time details */}
                        <div className={`mt-3 pt-3 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                          {person.scheduledStart && (
                            <div className="flex justify-between text-sm">
                              <span className={isDark ? "text-slate-400" : "text-gray-500"}>Scheduled:</span>
                              <span className={isDark ? "text-white" : "text-gray-900"}>{person.scheduledStart}</span>
                            </div>
                          )}
                          {person.isClockedIn && (
                            <>
                              <div className="flex justify-between text-sm mt-1">
                                <span className={isDark ? "text-slate-400" : "text-gray-500"}>Clocked In:</span>
                                <span className={`font-medium ${
                                  isLate ? (isDark ? "text-red-400" : "text-red-600")
                                  : isGrace ? (isDark ? "text-amber-400" : "text-amber-600")
                                  : (isDark ? "text-green-400" : "text-green-600")
                                }`}>
                                  {person.actualStart}
                                </span>
                              </div>
                              {person.clockInTime && (
                                <div className="flex justify-between text-sm mt-1">
                                  <span className={isDark ? "text-slate-400" : "text-gray-500"}>Working:</span>
                                  <span className={`font-medium ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                                    {formatDuration((Date.now() - person.clockInTime) / (1000 * 60 * 60))}
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                        </div>

                        {/* Actions */}
                        {person.isClockedIn && (
                          <button
                            onClick={() => handleForceClockOut(person.personnelId)}
                            className={`mt-3 w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                              isDark
                                ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                          >
                            Force Clock Out
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                  No employees with schedules today
                </div>
              )}
            </div>
          )}

          {/* Attendance Issues Tab */}
          {activeTab === "attendance" && (
            <div className="space-y-4">
              {/* Info box */}
              <div className={`p-4 rounded-xl ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-blue-50 border border-blue-200"}`}>
                <h3 className={`font-semibold mb-1 ${isDark ? "text-white" : "text-blue-900"}`}>
                  Attendance Write-Up Progression
                </h3>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-blue-700"}`}>
                  Click "Write Up" to automatically create a disciplinary action based on how many attendance issues this employee has had in the last 6 months:
                </p>
                <ul className={`text-sm mt-2 space-y-1 ${isDark ? "text-slate-400" : "text-blue-700"}`}>
                  <li>• 1st offense → Verbal Warning</li>
                  <li>• 2nd offense → Written Warning</li>
                  <li>• 3rd offense → Final Warning</li>
                  <li>• 4th+ offense → Suspension</li>
                </ul>
              </div>

              {/* Issues list */}
              {attendanceIssues && attendanceIssues.length > 0 ? (
                <div className="space-y-3">
                  {attendanceIssues.map((issue) => (
                    <div
                      key={issue._id}
                      className={`p-4 rounded-xl ${
                        issue.hasLinkedWriteUp
                          ? isDark ? "bg-slate-800/30 border border-slate-700/50" : "bg-gray-50 border border-gray-200"
                          : issue.status === "no_call_no_show"
                          ? isDark ? "bg-red-500/10 border border-red-500/30" : "bg-red-50 border border-red-200"
                          : isDark ? "bg-amber-500/10 border border-amber-500/30" : "bg-amber-50 border border-amber-200"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                              {issue.personnelName}
                            </h3>
                            <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                              issue.status === "no_call_no_show"
                                ? "bg-red-500/20 text-red-400"
                                : "bg-amber-500/20 text-amber-400"
                            }`}>
                              {issue.status === "no_call_no_show" ? "NO CALL/NO SHOW" : `${issue.minutesLate}min LATE`}
                            </span>
                            {issue.hasLinkedWriteUp && (
                              <span className={`px-2 py-0.5 text-xs font-medium rounded ${isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"}`}>
                                ✓ Write-up created
                              </span>
                            )}
                          </div>
                          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                            {issue.date} • {issue.department}
                          </p>
                          {issue.scheduledStart && issue.actualStart && (
                            <p className={`text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                              Scheduled: {issue.scheduledStart} → Arrived: {issue.actualStart}
                            </p>
                          )}
                          {!issue.hasLinkedWriteUp && (
                            <p className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                              {issue.writeUpsIn6Months} attendance write-up{issue.writeUpsIn6Months !== 1 ? "s" : ""} in last 6 months •
                              <span className={`font-medium ${
                                issue.recommendedSeverity === "suspension" ? (isDark ? "text-red-400" : "text-red-600")
                                : issue.recommendedSeverity === "final_warning" ? (isDark ? "text-amber-400" : "text-amber-600")
                                : (isDark ? "text-slate-300" : "text-gray-700")
                              }`}>
                                {" "}Next: {issue.severityLabel}
                              </span>
                            </p>
                          )}
                        </div>

                        {/* Write-up button */}
                        {!issue.hasLinkedWriteUp && (
                          <button
                            onClick={() => handleCreateWriteUp(issue._id)}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
                              issue.recommendedSeverity === "suspension"
                                ? isDark ? "bg-red-500 text-white hover:bg-red-400" : "bg-red-600 text-white hover:bg-red-700"
                                : issue.recommendedSeverity === "final_warning"
                                ? isDark ? "bg-amber-500 text-white hover:bg-amber-400" : "bg-amber-600 text-white hover:bg-amber-700"
                                : isDark ? "bg-cyan-500 text-white hover:bg-cyan-400" : "bg-blue-600 text-white hover:bg-blue-700"
                            }`}
                          >
                            Write Up
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
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
                  className={`px-3 py-2 rounded-lg text-sm ${
                    isDark
                      ? "bg-slate-800 border-slate-700 text-white"
                      : "bg-white border-gray-200 text-gray-900"
                  } border`}
                >
                  <option value="all">All Departments</option>
                  {departments.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setShowAddEntryModal(true)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    isDark
                      ? "bg-cyan-500 hover:bg-cyan-400 text-white"
                      : "bg-blue-600 hover:bg-blue-700 text-white"
                  }`}
                >
                  Add Entry
                </button>
              </div>

              {filteredSummary && filteredSummary.length > 0 ? (
                <div className="space-y-4">
                  {filteredSummary.map((summary) => (
                    <div
                      key={summary.personnelId}
                      className={`rounded-xl overflow-hidden ${
                        isDark
                          ? "bg-slate-800/50 border border-slate-700"
                          : "bg-white border border-gray-200 shadow-sm"
                      }`}
                    >
                      <div className="p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                              {summary.personnelName}
                            </h3>
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {summary.position} - {summary.department}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`text-lg font-bold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                              {formatDuration(summary.totalHours)}
                            </p>
                            {summary.breakMinutes > 0 && (
                              <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                                ({summary.breakMinutes}m break)
                              </p>
                            )}
                          </div>
                        </div>
                        <div className={`grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3 pt-3 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                          <div>
                            <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Clock In</p>
                            <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              {summary.clockIn ? formatTime(summary.clockIn) : "-"}
                            </p>
                          </div>
                          <div>
                            <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Clock Out</p>
                            <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              {summary.clockOut ? formatTime(summary.clockOut) : "-"}
                            </p>
                          </div>
                          <div>
                            <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Break Time</p>
                            <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              {summary.breakMinutes > 0 ? `${summary.breakMinutes}m` : "-"}
                            </p>
                          </div>
                          <div>
                            <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Status</p>
                            <span
                              className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                                summary.isComplete
                                  ? "bg-green-500/20 text-green-400"
                                  : "bg-amber-500/20 text-amber-400"
                              }`}
                            >
                              {summary.isComplete ? "Complete" : "In Progress"}
                            </span>
                          </div>
                        </div>

                        {/* Individual Entries */}
                        {summary.entries.length > 0 && (
                          <div className={`mt-3 pt-3 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                            <p className={`text-xs font-medium mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              Entries
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {summary.entries.map((entry) => (
                                <div
                                  key={entry._id}
                                  className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                                    isDark ? "bg-slate-700" : "bg-gray-100"
                                  }`}
                                >
                                  <span className={isDark ? "text-slate-300" : "text-gray-700"}>
                                    {entry.type.replace("_", " ")}
                                  </span>
                                  <span className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                                    {formatTime(entry.timestamp)}
                                  </span>
                                  {entry.editedBy && (
                                    <span className={`${isDark ? "text-amber-400" : "text-amber-600"}`}>
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
                                    className={`p-0.5 rounded hover:bg-slate-600 ${
                                      isDark ? "text-slate-400" : "text-gray-400"
                                    }`}
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => handleDeleteEntry(entry._id)}
                                    className={`p-0.5 rounded hover:bg-red-500/20 ${
                                      isDark ? "text-slate-400 hover:text-red-400" : "text-gray-400 hover:text-red-600"
                                    }`}
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
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
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
                <h2 className={`text-lg font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Pending Corrections
                </h2>
                {pendingCorrections && pendingCorrections.length > 0 ? (
                  <div className="space-y-3">
                    {pendingCorrections.map((correction) => (
                      <div
                        key={correction._id}
                        className={`p-4 rounded-xl ${
                          isDark
                            ? "bg-slate-800/50 border border-slate-700"
                            : "bg-white border border-gray-200 shadow-sm"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                              {correction.personnelName}
                            </h3>
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {correction.date} - {correction.requestType.replace("_", " ")}
                            </p>
                            <p className={`text-sm mt-1 ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                              {correction.reason}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
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
                              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                                isDark
                                  ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30"
                                  : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                              }`}
                            >
                              Review
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`text-center py-8 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                    No pending corrections
                  </div>
                )}
              </div>

              {/* Recent Corrections */}
              <div className="mt-8">
                <h2 className={`text-lg font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Recent Corrections
                </h2>
                {allCorrections && allCorrections.filter((c) => c.status !== "pending").length > 0 ? (
                  <div className="space-y-3">
                    {allCorrections
                      .filter((c) => c.status !== "pending")
                      .slice(0, 10)
                      .map((correction) => (
                        <div
                          key={correction._id}
                          className={`p-4 rounded-xl ${
                            isDark
                              ? "bg-slate-800/30 border border-slate-700/50"
                              : "bg-gray-50 border border-gray-200"
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                                  {correction.personnelName}
                                </h3>
                                <span
                                  className={`px-2 py-0.5 text-xs font-medium rounded ${
                                    correction.status === "approved"
                                      ? "bg-green-500/20 text-green-400"
                                      : "bg-red-500/20 text-red-400"
                                  }`}
                                >
                                  {correction.status}
                                </span>
                              </div>
                              <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                {correction.date} - {correction.requestType.replace("_", " ")}
                              </p>
                              <p className={`text-sm mt-1 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                                {correction.reason}
                              </p>
                              {correction.reviewNotes && (
                                <p className={`text-sm mt-1 italic ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                                  Note: {correction.reviewNotes}
                                </p>
                              )}
                            </div>
                            <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                              by {correction.reviewerName}
                            </p>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className={`text-center py-8 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                    No recent corrections
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Add Entry Modal */}
        {showAddEntryModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className={`w-full max-w-md rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Add Time Entry
              </h2>
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Employee
                  </label>
                  <select
                    value={addEntryForm.personnelId}
                    onChange={(e) => setAddEntryForm({ ...addEntryForm, personnelId: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"} border`}
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
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Date
                    </label>
                    <input
                      type="date"
                      value={addEntryForm.date}
                      onChange={(e) => setAddEntryForm({ ...addEntryForm, date: e.target.value })}
                      className={`w-full px-3 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"} border`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Time
                    </label>
                    <input
                      type="time"
                      value={addEntryForm.time}
                      onChange={(e) => setAddEntryForm({ ...addEntryForm, time: e.target.value })}
                      className={`w-full px-3 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"} border`}
                    />
                  </div>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Entry Type
                  </label>
                  <select
                    value={addEntryForm.type}
                    onChange={(e) => setAddEntryForm({ ...addEntryForm, type: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"} border`}
                  >
                    {ENTRY_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Reason
                  </label>
                  <input
                    type="text"
                    value={addEntryForm.reason}
                    onChange={(e) => setAddEntryForm({ ...addEntryForm, reason: e.target.value })}
                    placeholder="e.g., Forgot to clock in"
                    className={`w-full px-3 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"} border`}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowAddEntryModal(false)}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-slate-700 text-white" : "bg-gray-200 text-gray-900"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddEntry}
                  disabled={!addEntryForm.personnelId || !addEntryForm.reason}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-400" : "bg-blue-600 text-white hover:bg-blue-700"} disabled:opacity-50`}
                >
                  Add Entry
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Entry Modal */}
        {showEditEntryModal && selectedEntry && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className={`w-full max-w-md rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Edit Time Entry
              </h2>
              <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                {selectedEntry.personnelName} - {selectedEntry.type.replace("_", " ")}
              </p>
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    New Time
                  </label>
                  <input
                    type="time"
                    value={editEntryForm.time}
                    onChange={(e) => setEditEntryForm({ ...editEntryForm, time: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"} border`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Reason for Edit
                  </label>
                  <input
                    type="text"
                    value={editEntryForm.reason}
                    onChange={(e) => setEditEntryForm({ ...editEntryForm, reason: e.target.value })}
                    placeholder="e.g., Correcting clock-in time"
                    className={`w-full px-3 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"} border`}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowEditEntryModal(false);
                    setSelectedEntry(null);
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-slate-700 text-white" : "bg-gray-200 text-gray-900"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditEntry}
                  disabled={!editEntryForm.reason}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-400" : "bg-blue-600 text-white hover:bg-blue-700"} disabled:opacity-50`}
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Correction Review Modal */}
        {showCorrectionModal && selectedCorrection && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className={`w-full max-w-md rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Review Correction Request
              </h2>
              <div className={`space-y-3 p-4 rounded-lg mb-4 ${isDark ? "bg-slate-700" : "bg-gray-100"}`}>
                <div>
                  <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Employee:</span>
                  <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                    {selectedCorrection.personnelName}
                  </p>
                </div>
                <div>
                  <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Date:</span>
                  <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                    {selectedCorrection.date}
                  </p>
                </div>
                <div>
                  <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Request Type:</span>
                  <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                    {selectedCorrection.requestType.replace("_", " ")}
                  </p>
                </div>
                <div>
                  <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Reason:</span>
                  <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                    {selectedCorrection.reason}
                  </p>
                </div>
                {selectedCorrection.requestedTimestamp && (
                  <div>
                    <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Requested Time:</span>
                    <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                      {formatTime(selectedCorrection.requestedTimestamp)}
                    </p>
                  </div>
                )}
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Review Notes (optional)
                </label>
                <textarea
                  value={correctionReviewForm.notes}
                  onChange={(e) => setCorrectionReviewForm({ notes: e.target.value })}
                  placeholder="Add any notes about this decision..."
                  rows={2}
                  className={`w-full px-3 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"} border`}
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowCorrectionModal(false);
                    setSelectedCorrection(null);
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-slate-700 text-white" : "bg-gray-200 text-gray-900"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleReviewCorrection("denied")}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-50 text-red-600 hover:bg-red-100"}`}
                >
                  Deny
                </button>
                <button
                  onClick={() => handleReviewCorrection("approved")}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-green-500/20 text-green-400 hover:bg-green-500/30" : "bg-green-50 text-green-600 hover:bg-green-100"}`}
                >
                  Approve
                </button>
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
