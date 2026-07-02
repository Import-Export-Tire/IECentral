"use client";

import React, { useState, useEffect } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../auth-context";
import { Id } from "@/convex/_generated/dataModel";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

// Admin View Component - Shows all team logs with live activity
function AdminDailyLogView() {
  const { user } = useAuth();
  const [showDrafts, setShowDrafts] = useState(true);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [editingCommentLogId, setEditingCommentLogId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<string>("all");

  // Submit on behalf modal state
  const [showSubmitOnBehalfModal, setShowSubmitOnBehalfModal] = useState(false);
  const [submitOnBehalfUser, setSubmitOnBehalfUser] = useState<string>("");
  const [submitOnBehalfDate, setSubmitOnBehalfDate] = useState(new Date().toISOString().split("T")[0]);
  const [submitOnBehalfSummary, setSubmitOnBehalfSummary] = useState("");
  const [submitOnBehalfAccomplishments, setSubmitOnBehalfAccomplishments] = useState<string[]>([""]);
  const [submitOnBehalfBlockers, setSubmitOnBehalfBlockers] = useState("");
  const [submitOnBehalfGoals, setSubmitOnBehalfGoals] = useState("");
  const [submitOnBehalfHours, setSubmitOnBehalfHours] = useState<number | undefined>();
  const [isSubmittingOnBehalf, setIsSubmittingOnBehalf] = useState(false);

  // Toggle log expansion
  const toggleLogExpansion = (logId: string) => {
    setExpandedLogs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      return newSet;
    });
  };

  const allLogs = useQuery(api.dailyLogs.getAllLogsIncludingDrafts, { limit: 100 });
  const todayLiveActivity = useQuery(api.dailyLogs.getTodayLiveActivity, {});
  const dailyLogUsers = useQuery(api.dailyLogs.getUsersRequiringDailyLog, {});
  const addReviewerComment = useMutation(api.dailyLogs.addReviewerComment);
  const submitOnBehalf = useMutation(api.dailyLogs.submitOnBehalf);
  const unlockLog = useMutation(api.dailyLogs.unlockLog);

  // Get unique users from logs for filter dropdown
  const uniqueUsers = React.useMemo(() => {
    if (!allLogs) return [];
    const usersMap = new Map<string, string>();
    allLogs.forEach(log => {
      if (!usersMap.has(log.userId)) {
        usersMap.set(log.userId, log.userName);
      }
    });
    return Array.from(usersMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allLogs]);

  // Calculate user stats (streaks, totals)
  const userStats = React.useMemo(() => {
    if (!allLogs) return new Map();
    const stats = new Map<string, {
      totalLogs: number;
      totalHours: number;
      totalAccomplishments: number;
      currentStreak: number;
      submittedDates: Set<string>;
    }>();

    // Group logs by user
    allLogs.filter(l => l.isSubmitted).forEach(log => {
      const existing = stats.get(log.userId) || {
        totalLogs: 0,
        totalHours: 0,
        totalAccomplishments: 0,
        currentStreak: 0,
        submittedDates: new Set<string>(),
      };
      existing.totalLogs++;
      existing.totalHours += log.hoursWorked || 0;
      existing.totalAccomplishments += log.accomplishments?.length || 0;
      existing.submittedDates.add(log.date);
      stats.set(log.userId, existing);
    });

    // Calculate current streak for each user
    stats.forEach((stat, userId) => {
      const sortedDates = Array.from(stat.submittedDates).sort((a, b) => b.localeCompare(a));
      let streak = 0;
      const today = new Date();

      for (let i = 0; i < 30; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(checkDate.getDate() - i);
        const dateStr = checkDate.toISOString().split("T")[0];

        // Skip weekends
        const dayOfWeek = checkDate.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;

        if (stat.submittedDates.has(dateStr)) {
          streak++;
        } else if (i > 0) {
          break; // Streak broken
        }
      }
      stat.currentStreak = streak;
    });

    return stats;
  }, [allLogs]);

  // Export to CSV function
  const exportToCSV = () => {
    if (!allLogs) return;

    const logsToExport = selectedPerson === "all"
      ? allLogs.filter(l => l.isSubmitted)
      : allLogs.filter(l => l.isSubmitted && l.userId === selectedPerson);

    const headers = ["Date", "Name", "Hours", "Summary", "Accomplishments", "Blockers", "Goals for Tomorrow", "Reviewer Notes"];
    const rows = logsToExport.map(log => [
      log.date,
      log.userName,
      log.hoursWorked?.toString() || "",
      `"${(log.summary || "").replace(/"/g, '""')}"`,
      `"${(log.accomplishments || []).join("; ").replace(/"/g, '""')}"`,
      `"${(log.blockers || "").replace(/"/g, '""')}"`,
      `"${(log.goalsForTomorrow || "").replace(/"/g, '""')}"`,
      `"${(log.reviewerComment || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `daily-logs-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  // Handle saving reviewer comment
  const handleSaveComment = async (logId: Id<"dailyLogs">) => {
    if (!user) return;
    setSavingComment(true);
    try {
      await addReviewerComment({
        logId,
        reviewerId: user._id,
        comment: commentText,
      });
      setEditingCommentLogId(null);
      setCommentText("");
    } catch (error) {
      console.error("Failed to save comment:", error);
      alert("Failed to save comment");
    } finally {
      setSavingComment(false);
    }
  };

  // Start editing a comment
  const handleStartEditing = (logId: string, existingComment?: string) => {
    setEditingCommentLogId(logId);
    setCommentText(existingComment || "");
  };

  // Handle submit on behalf
  const handleSubmitOnBehalf = async () => {
    if (!user || !submitOnBehalfUser || !submitOnBehalfSummary) return;
    setIsSubmittingOnBehalf(true);
    try {
      const filteredAccomplishments = submitOnBehalfAccomplishments.filter(a => a.trim() !== "");
      await submitOnBehalf({
        targetUserId: submitOnBehalfUser as Id<"users">,
        date: submitOnBehalfDate,
        summary: submitOnBehalfSummary,
        accomplishments: filteredAccomplishments,
        blockers: submitOnBehalfBlockers || undefined,
        goalsForTomorrow: submitOnBehalfGoals || undefined,
        hoursWorked: submitOnBehalfHours,
        adminUserId: user._id,
      });
      // Reset form
      setShowSubmitOnBehalfModal(false);
      setSubmitOnBehalfUser("");
      setSubmitOnBehalfDate(new Date().toISOString().split("T")[0]);
      setSubmitOnBehalfSummary("");
      setSubmitOnBehalfAccomplishments([""]);
      setSubmitOnBehalfBlockers("");
      setSubmitOnBehalfGoals("");
      setSubmitOnBehalfHours(undefined);
    } catch (error) {
      console.error("Failed to submit on behalf:", error);
      alert("Failed to submit log. " + (error instanceof Error ? error.message : ""));
    } finally {
      setIsSubmittingOnBehalf(false);
    }
  };

  // Handle unlock log
  const handleUnlockLog = async (logId: Id<"dailyLogs">) => {
    if (!user) return;
    if (!confirm("Are you sure you want to unlock this log for editing? The user will be able to modify it.")) return;
    try {
      await unlockLog({ logId, adminUserId: user._id });
    } catch (error) {
      console.error("Failed to unlock log:", error);
      alert("Failed to unlock log");
    }
  };

  // Add accomplishment field for submit on behalf
  const addAccomplishmentField = () => {
    setSubmitOnBehalfAccomplishments([...submitOnBehalfAccomplishments, ""]);
  };

  // Update accomplishment
  const updateAccomplishment = (index: number, value: string) => {
    const updated = [...submitOnBehalfAccomplishments];
    updated[index] = value;
    setSubmitOnBehalfAccomplishments(updated);
  };

  // Remove accomplishment
  const removeAccomplishment = (index: number) => {
    if (submitOnBehalfAccomplishments.length > 1) {
      setSubmitOnBehalfAccomplishments(submitOnBehalfAccomplishments.filter((_, i) => i !== index));
    }
  };

  // Filter logs based on showDrafts toggle and selected person
  const filteredLogs = allLogs?.filter(log => {
    const matchesDraft = showDrafts || log.isSubmitted;
    const matchesPerson = selectedPerson === "all" || log.userId === selectedPerson;
    return matchesDraft && matchesPerson;
  }) || [];

  // Group logs by date
  const logsByDate = filteredLogs.reduce((acc, log) => {
    if (!acc[log.date]) {
      acc[log.date] = [];
    }
    acc[log.date].push(log);
    return acc;
  }, {} as Record<string, typeof filteredLogs>);

  const sortedDates = Object.keys(logsByDate).sort((a, b) => b.localeCompare(a));
  const today = new Date().toISOString().split("T")[0];

  // Get selected user's stats
  const selectedUserStats = selectedPerson !== "all" ? userStats.get(selectedPerson) : null;

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden">
        <MobileHeader />

        {/* Header */}
        <header className="flex-shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-b theme-border-secondary px-4 sm:px-8 py-3 sm:py-4">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Team Daily Logs</h1>
                <p className="theme-text-secondary text-xs sm:text-sm mt-1">
                  View team activity and daily logs in real-time
                </p>
              </div>
              <div className="flex flex-col gap-2 items-end">
                {/* Row 1: select + drafts checkbox */}
                <div className="flex items-center gap-2">
                  <select
                    value={selectedPerson}
                    onChange={(e) => setSelectedPerson(e.target.value)}
                    className="theme-input text-sm"
                  >
                    <option value="all">All Team Members</option>
                    {uniqueUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>

                  <label className="hidden sm:flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showDrafts}
                      onChange={(e) => setShowDrafts(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                    />
                    <span className="text-sm theme-text-secondary">Drafts</span>
                  </label>
                </div>

                {/* Row 2: action buttons — wraps on mobile */}
                <div className="flex flex-wrap gap-2 justify-end">
                  {/* Submit on Behalf */}
                  <button
                    onClick={() => setShowSubmitOnBehalfModal(true)}
                    className="px-3 py-2 bg-amber-500/20 text-amber-400 font-medium rounded-lg hover:bg-amber-500/30 transition-colors flex items-center gap-2 text-sm border border-amber-500/30"
                    title="Submit log on behalf of employee"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                    <span className="hidden sm:inline">Submit for Employee</span>
                  </button>

                  {/* Export CSV */}
                  <button
                    onClick={exportToCSV}
                    className="theme-btn-secondary px-3 py-2 font-medium rounded-lg transition-colors flex items-center gap-2 text-sm"
                    title="Export to CSV"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="hidden sm:inline">Export</span>
                  </button>

                  <a
                    href="/daily-log/report"
                    className="theme-btn-primary px-3 py-2 font-medium rounded-lg transition-colors flex items-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    <span className="hidden sm:inline">Print</span>
                  </a>
                </div>
              </div>
            </div>

            {/* Stats Bar - Show when filtering by person */}
            {selectedUserStats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-2 px-4 theme-card rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
                    <span className="theme-accent-primary text-sm font-bold">{selectedUserStats.currentStreak}</span>
                  </div>
                  <div>
                    <p className="theme-text-primary text-sm font-medium">Day Streak</p>
                    <p className="theme-text-tertiary text-xs">Consecutive submissions</p>
                  </div>
                </div>
                <div>
                  <p className="theme-text-primary text-sm font-medium">{selectedUserStats.totalLogs} Logs</p>
                  <p className="theme-text-tertiary text-xs">Total submitted</p>
                </div>
                <div>
                  <p className="theme-text-primary text-sm font-medium">{selectedUserStats.totalHours.toFixed(1)}h</p>
                  <p className="theme-text-tertiary text-xs">Hours logged</p>
                </div>
                <div>
                  <p className="theme-text-primary text-sm font-medium">{selectedUserStats.totalAccomplishments}</p>
                  <p className="theme-text-tertiary text-xs">Accomplishments</p>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-5xl mx-auto space-y-6">

            {/* Today's Live Activity Section */}
            {todayLiveActivity && todayLiveActivity.length > 0 && (
              <div className="theme-card rounded-xl p-4 sm:p-6 border border-purple-500/30">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <h2 className="text-lg font-semibold theme-text-primary">Today&apos;s Live Activity</h2>
                  <span className="theme-text-secondary text-sm">({new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })})</span>
                </div>

                <div className="space-y-4">
                  {todayLiveActivity.map((userActivity) => (
                    <div key={userActivity.userId} className="theme-card rounded-lg p-4">
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => setExpandedUser(expandedUser === userActivity.userId ? null : userActivity.userId)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-medium">
                            {userActivity.userName
                              .split(" ")
                              .map((n: string) => n[0])
                              .join("")
                              .slice(0, 2)}
                          </div>
                          <div>
                            <p className="theme-text-primary font-medium">{userActivity.userName}</p>
                            <div className="flex items-center gap-3 text-sm">
                              <span className="theme-accent-primary">{userActivity.activity.totalActions} actions today</span>
                              {userActivity.todayLog ? (
                                userActivity.todayLog.isSubmitted ? (
                                  <span className="text-green-400 flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    Log Submitted
                                  </span>
                                ) : (
                                  <span className="text-amber-400 flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                    Draft in Progress
                                  </span>
                                )
                              ) : (
                                <span className="theme-text-tertiary">No log started</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="hidden sm:flex gap-4 text-sm">
                            {userActivity.activity.projectsCreated > 0 && (
                              <span className="theme-text-secondary">{userActivity.activity.projectsCreated} projects</span>
                            )}
                            {userActivity.activity.tasksCompleted > 0 && (
                              <span className="theme-text-secondary">{userActivity.activity.tasksCompleted} tasks</span>
                            )}
                          </div>
                          <svg
                            className={`w-5 h-5 theme-text-secondary transition-transform ${expandedUser === userActivity.userId ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {expandedUser === userActivity.userId && (
                        <div className="mt-4 pt-4 border-t theme-border-secondary space-y-4">
                          {/* Activity Stats */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="bg-[#f2f2f7] dark:bg-slate-900/50 rounded-lg p-3 text-center">
                              <p className="text-2xl font-bold text-purple-400">{userActivity.activity.projectsCreated}</p>
                              <p className="text-xs theme-text-secondary">Projects Created</p>
                            </div>
                            <div className="bg-[#f2f2f7] dark:bg-slate-900/50 rounded-lg p-3 text-center">
                              <p className="text-2xl font-bold text-blue-400">{userActivity.activity.projectsMoved}</p>
                              <p className="text-xs theme-text-secondary">Projects Moved</p>
                            </div>
                            <div className="bg-[#f2f2f7] dark:bg-slate-900/50 rounded-lg p-3 text-center">
                              <p className="text-2xl font-bold text-green-400">{userActivity.activity.tasksCompleted}</p>
                              <p className="text-xs theme-text-secondary">Tasks Done</p>
                            </div>
                            <div className="bg-[#f2f2f7] dark:bg-slate-900/50 rounded-lg p-3 text-center">
                              <p className="text-2xl font-bold text-cyan-400">{userActivity.activity.totalActions}</p>
                              <p className="text-xs theme-text-secondary">Total Actions</p>
                            </div>
                          </div>

                          {/* Current Draft Log */}
                          {userActivity.todayLog && !userActivity.todayLog.isSubmitted && (
                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                              <h4 className="text-amber-400 text-sm font-medium mb-2 flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Current Draft
                                <span className="theme-text-secondary font-normal">
                                  (Last updated: {new Date(userActivity.todayLog.updatedAt).toLocaleTimeString()})
                                </span>
                              </h4>
                              {userActivity.todayLog.summary && (
                                <div className="mb-2">
                                  <span className="theme-text-secondary text-xs block mb-1">Summary:</span>
                                  <p className="theme-text-primary text-sm whitespace-pre-wrap leading-relaxed">{userActivity.todayLog.summary}</p>
                                </div>
                              )}
                              {userActivity.todayLog.accomplishments && userActivity.todayLog.accomplishments.length > 0 && (
                                <div className="mb-2">
                                  <span className="theme-text-secondary text-xs">Accomplishments: </span>
                                  <span className="text-green-400 text-sm">{userActivity.todayLog.accomplishments.length} items</span>
                                </div>
                              )}
                              {userActivity.todayLog.hoursWorked && (
                                <div>
                                  <span className="theme-text-secondary text-xs">Hours: </span>
                                  <span className="theme-text-primary text-sm">{userActivity.todayLog.hoursWorked}h</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Recent Actions Feed */}
                          {userActivity.recentActions.length > 0 && (
                            <div>
                              <h4 className="theme-text-secondary text-sm font-medium mb-2">Recent Activity</h4>
                              <div className="space-y-2 max-h-48 overflow-y-auto">
                                {userActivity.recentActions.map((action, idx) => (
                                  <div key={idx} className="flex items-start gap-2 text-sm">
                                    <span className="theme-text-tertiary text-xs whitespace-nowrap">
                                      {new Date(action.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    <span className="theme-text-secondary">{action.action || action.details}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Historical Logs Section */}
            <div>
              <h2 className="text-lg font-semibold theme-text-primary mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 theme-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Log History
              </h2>

              {!allLogs ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
                </div>
              ) : sortedDates.length === 0 ? (
                <div className="theme-card rounded-xl p-8 text-center">
                  <svg className="w-12 h-12 mx-auto theme-text-tertiary mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="theme-text-secondary">No daily logs yet</p>
                  <p className="theme-text-tertiary text-sm mt-2">
                    Team members with &quot;Requires Daily Log&quot; enabled can submit logs from their Daily Log page
                  </p>
                </div>
              ) : (
                sortedDates.map((date) => (
                  <div key={date} className="space-y-4 mb-6">
                    <h3 className="text-md font-medium theme-text-secondary flex items-center gap-2">
                      <svg className="w-4 h-4 theme-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                      {date === today && <span className="text-cyan-400 text-xs bg-cyan-500/20 px-2 py-0.5 rounded-full ml-2">Today</span>}
                    </h3>

                    {logsByDate[date]?.map((log) => {
                      const isExpanded = expandedLogs.has(log._id);
                      return (
                      <div
                        key={log._id}
                        className={`theme-card rounded-xl overflow-hidden ${
                          log.isSubmitted ? '' : 'border border-amber-500/30'
                        }`}
                      >
                        {/* Clickable User Header */}
                        <div
                          className="flex items-center justify-between p-4 sm:p-6 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          onClick={() => toggleLogExpansion(log._id)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 font-medium">
                              {log.userName
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .slice(0, 2)}
                            </div>
                            <div>
                              <p className="theme-text-primary font-medium">{log.userName}</p>
                              <div className="flex items-center gap-2 theme-text-secondary text-sm">
                                {log.hoursWorked && <span>{log.hoursWorked}h</span>}
                                {log.accomplishments && log.accomplishments.length > 0 && (
                                  <span className="text-green-400">{log.accomplishments.length} accomplishments</span>
                                )}
                                {log.reviewerComment && (
                                  <span className="text-indigo-400 flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                                    </svg>
                                    Note
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {log.isSubmitted ? (
                              <>
                                <span className="text-green-400 text-xs flex items-center gap-1 bg-green-500/10 px-2 py-1 rounded-full">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  Submitted
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUnlockLog(log._id);
                                  }}
                                  className="theme-text-tertiary hover:text-amber-400 text-xs flex items-center gap-1 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                                  title="Unlock for editing"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                  </svg>
                                  Unlock
                                </button>
                              </>
                            ) : (
                              <span className="text-amber-400 text-xs flex items-center gap-1 bg-amber-500/10 px-2 py-1 rounded-full">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Draft
                              </span>
                            )}
                            <svg
                              className={`w-5 h-5 theme-text-secondary transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </div>

                        {/* Expandable Content */}
                        {isExpanded && (
                        <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t theme-border-secondary">
                        {/* Summary */}
                        <div className="pt-4">
                          <h4 className="theme-text-secondary text-xs uppercase tracking-wide mb-2 flex items-center gap-2">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                            </svg>
                            Summary
                          </h4>
                          <p className="theme-text-primary text-sm leading-relaxed whitespace-pre-wrap">{log.summary || <span className="theme-text-tertiary italic">No summary yet</span>}</p>
                        </div>

                        {/* Accomplishments */}
                        {log.accomplishments && log.accomplishments.length > 0 && (
                          <div className="pt-4 mt-4 border-t theme-border-secondary">
                            <h4 className="theme-text-secondary text-xs uppercase tracking-wide mb-2 flex items-center gap-2">
                              <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Accomplishments ({log.accomplishments.length})
                            </h4>
                            <ul className="space-y-1.5">
                              {log.accomplishments.map((acc, i) => (
                                <li key={i} className="flex items-start gap-2 text-green-400 text-sm">
                                  <span className="mt-0.5 text-green-500">•</span>
                                  <span>{acc}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Blockers */}
                        {log.blockers && (
                          <div className="pt-4 mt-4 border-t theme-border-secondary">
                            <h4 className="theme-text-secondary text-xs uppercase tracking-wide mb-2 flex items-center gap-2">
                              <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              Blockers
                            </h4>
                            <p className="text-amber-400 text-sm leading-relaxed whitespace-pre-wrap">{log.blockers}</p>
                          </div>
                        )}

                        {/* Goals for Tomorrow */}
                        {log.goalsForTomorrow && (
                          <div className="pt-4 mt-4 border-t theme-border-secondary">
                            <h4 className="theme-text-secondary text-xs uppercase tracking-wide mb-2 flex items-center gap-2">
                              <svg className="w-3.5 h-3.5 theme-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                              </svg>
                              Goals for Tomorrow
                            </h4>
                            <p className="theme-text-secondary text-sm leading-relaxed whitespace-pre-wrap">{log.goalsForTomorrow}</p>
                          </div>
                        )}

                        {/* Auto Activities */}
                        {log.autoActivities && log.autoActivities.totalActions > 0 && (
                          <div className="mt-4 pt-4 border-t theme-border-secondary">
                            <h4 className="theme-text-secondary text-xs uppercase tracking-wide mb-2">Auto-Tracked Activity</h4>
                            <div className="flex gap-4 text-sm">
                              {log.autoActivities.projectsCreated > 0 && (
                                <span className="theme-text-secondary">
                                  {log.autoActivities.projectsCreated} project{log.autoActivities.projectsCreated !== 1 ? "s" : ""} created
                                </span>
                              )}
                              {log.autoActivities.tasksCompleted > 0 && (
                                <span className="theme-text-secondary">
                                  {log.autoActivities.tasksCompleted} task{log.autoActivities.tasksCompleted !== 1 ? "s" : ""} completed
                                </span>
                              )}
                              <span className="theme-accent-primary">
                                {log.autoActivities.totalActions} total actions
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Reviewer Notes - Only for submitted logs */}
                        {log.isSubmitted && (
                          <div className="mt-4 pt-4 border-t theme-border-secondary">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="theme-text-secondary text-xs uppercase tracking-wide flex items-center gap-2">
                                <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Reviewer Notes
                                <span className="theme-text-tertiary normal-case text-xs">(not visible to submitter)</span>
                              </h4>
                              {!editingCommentLogId && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStartEditing(log._id, log.reviewerComment);
                                  }}
                                  className="text-indigo-400 hover:text-indigo-300 text-xs flex items-center gap-1"
                                >
                                  {log.reviewerComment ? "Edit" : "Add Note"}
                                </button>
                              )}
                            </div>

                            {editingCommentLogId === log._id ? (
                              <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                                <textarea
                                  value={commentText}
                                  onChange={(e) => setCommentText(e.target.value)}
                                  className="w-full px-3 py-2 bg-white/60 dark:bg-slate-900/50 border border-indigo-500/50 rounded-lg theme-text-primary placeholder-slate-500 focus:outline-none focus:border-indigo-400 text-sm resize-none"
                                  placeholder="Add reviewer notes for this log..."
                                  rows={3}
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => {
                                      setEditingCommentLogId(null);
                                      setCommentText("");
                                    }}
                                    className="px-3 py-1.5 theme-text-secondary hover:theme-text-primary text-sm"
                                    disabled={savingComment}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleSaveComment(log._id as Id<"dailyLogs">)}
                                    disabled={savingComment}
                                    className="px-3 py-1.5 bg-indigo-500 text-white text-sm rounded-lg hover:bg-indigo-600 disabled:opacity-50"
                                  >
                                    {savingComment ? "Saving..." : "Save Note"}
                                  </button>
                                </div>
                              </div>
                            ) : log.reviewerComment ? (
                              <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-3">
                                <p className="text-indigo-300 text-sm">{log.reviewerComment}</p>
                                {log.reviewerCommentByName && log.reviewerCommentAt && (
                                  <p className="theme-text-tertiary text-xs mt-2">
                                    — {log.reviewerCommentByName}, {new Date(log.reviewerCommentAt).toLocaleDateString()}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="theme-text-tertiary text-sm italic">No reviewer notes yet</p>
                            )}
                          </div>
                        )}
                        </div>
                        )}
                      </div>
                    );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Submit on Behalf Modal */}
      {showSubmitOnBehalfModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="theme-card rounded-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b theme-border-secondary">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold theme-text-primary">Submit Log on Behalf of Employee</h2>
                <button
                  onClick={() => setShowSubmitOnBehalfModal(false)}
                  className="theme-text-secondary hover:theme-text-primary"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="theme-text-secondary text-sm mt-1">Fill out a daily log for an employee who forgot to submit.</p>
            </div>

            <div className="p-6 space-y-4">
              {/* Employee Select */}
              <div>
                <label className="block text-sm font-medium theme-text-secondary mb-1">Employee</label>
                <select
                  value={submitOnBehalfUser}
                  onChange={(e) => setSubmitOnBehalfUser(e.target.value)}
                  className="w-full theme-input"
                >
                  <option value="">Select an employee...</option>
                  {dailyLogUsers?.map((u) => (
                    <option key={u._id} value={u._id}>{u.name}</option>
                  ))}
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="block text-sm font-medium theme-text-secondary mb-1">Date</label>
                <input
                  type="date"
                  value={submitOnBehalfDate}
                  onChange={(e) => setSubmitOnBehalfDate(e.target.value)}
                  max={new Date().toISOString().split("T")[0]}
                  className="w-full theme-input"
                />
              </div>

              {/* Summary */}
              <div>
                <label className="block text-sm font-medium theme-text-secondary mb-1">Summary</label>
                <textarea
                  value={submitOnBehalfSummary}
                  onChange={(e) => setSubmitOnBehalfSummary(e.target.value)}
                  placeholder="What did they work on?"
                  rows={2}
                  className="w-full theme-input"
                />
              </div>

              {/* Accomplishments */}
              <div>
                <label className="block text-sm font-medium theme-text-secondary mb-1">Accomplishments</label>
                <div className="space-y-2">
                  {submitOnBehalfAccomplishments.map((acc, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={acc}
                        onChange={(e) => updateAccomplishment(index, e.target.value)}
                        placeholder="Enter accomplishment..."
                        className="flex-1 theme-input"
                      />
                      {submitOnBehalfAccomplishments.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeAccomplishment(index)}
                          className="p-2 text-red-400 hover:text-red-300"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addAccomplishmentField}
                    className="text-sm theme-accent-primary hover:opacity-80"
                  >
                    + Add another
                  </button>
                </div>
              </div>

              {/* Hours */}
              <div>
                <label className="block text-sm font-medium theme-text-secondary mb-1">Hours Worked</label>
                <input
                  type="number"
                  value={submitOnBehalfHours || ""}
                  onChange={(e) => setSubmitOnBehalfHours(e.target.value ? parseFloat(e.target.value) : undefined)}
                  min="0"
                  max="24"
                  step="0.5"
                  placeholder="8"
                  className="w-32 theme-input"
                />
              </div>

              {/* Blockers (optional) */}
              <div>
                <label className="block text-sm font-medium theme-text-secondary mb-1">Blockers <span className="theme-text-tertiary">(optional)</span></label>
                <textarea
                  value={submitOnBehalfBlockers}
                  onChange={(e) => setSubmitOnBehalfBlockers(e.target.value)}
                  placeholder="Any blockers or challenges?"
                  rows={2}
                  className="w-full theme-input"
                />
              </div>

              {/* Goals (optional) */}
              <div>
                <label className="block text-sm font-medium theme-text-secondary mb-1">Goals for Tomorrow <span className="theme-text-tertiary">(optional)</span></label>
                <textarea
                  value={submitOnBehalfGoals}
                  onChange={(e) => setSubmitOnBehalfGoals(e.target.value)}
                  placeholder="What will they work on next?"
                  rows={2}
                  className="w-full theme-input"
                />
              </div>
            </div>

            <div className="p-6 border-t theme-border-secondary flex justify-end gap-3">
              <button
                onClick={() => setShowSubmitOnBehalfModal(false)}
                className="theme-btn-secondary px-4 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitOnBehalf}
                disabled={!submitOnBehalfUser || !submitOnBehalfSummary || isSubmittingOnBehalf}
                className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmittingOnBehalf ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Submitting...
                  </>
                ) : (
                  "Submit on Behalf"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Employee View Component - Entry form for daily logs
function EmployeeDailyLogView() {
  const { user } = useAuth();
  const today = new Date().toISOString().split("T")[0];

  const [selectedDate, setSelectedDate] = useState(today);
  const [summary, setSummary] = useState("");
  const [accomplishments, setAccomplishments] = useState<string[]>([""]);
  const [blockers, setBlockers] = useState("");
  const [goalsForTomorrow, setGoalsForTomorrow] = useState("");
  const [hoursWorked, setHoursWorked] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [showPastLogs, setShowPastLogs] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Auto-save state
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const isInitialLoad = React.useRef(true);
  const autoSaveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Daily tasks state
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [showAddTask, setShowAddTask] = useState(false);

  // Queries
  const existingLog = useQuery(
    api.dailyLogs.getByDate,
    user?._id ? { userId: user._id, date: selectedDate } : "skip"
  );
  const autoActivities = useQuery(
    api.dailyLogs.getAutoActivities,
    user?._id ? { userId: user._id, date: selectedDate } : "skip"
  );
  const myLogs = useQuery(
    api.dailyLogs.getMyLogs,
    user?._id ? { userId: user._id, limit: 14 } : "skip"
  );
  const dailyTasksWithStatus = useQuery(
    api.dailyLogs.getDailyTasksWithStatus,
    user?._id ? { userId: user._id, date: selectedDate } : "skip"
  );

  // Mutations
  const saveLog = useMutation(api.dailyLogs.saveLog);
  const toggleTaskCompletion = useMutation(api.dailyLogs.toggleDailyTaskCompletion);
  const createDailyTask = useMutation(api.dailyLogs.createDailyTask);
  const deleteDailyTask = useMutation(api.dailyLogs.deleteDailyTask);

  // Handle task completion toggle
  const handleToggleTask = async (taskId: Id<"dailyTaskTemplates">, taskTitle: string, currentlyCompleted: boolean) => {
    if (!user) return;

    const newCompletedState = !currentlyCompleted;

    // Toggle the task completion
    await toggleTaskCompletion({
      taskId,
      userId: user._id,
      date: selectedDate,
      completed: newCompletedState,
    });

    // If completing the task, add to accomplishments
    if (newCompletedState && !existingLog?.isSubmitted) {
      const taskAccomplishment = `✓ ${taskTitle}`;
      // Check if already in accomplishments
      if (!accomplishments.includes(taskAccomplishment)) {
        // Find first empty slot or add new
        const emptyIndex = accomplishments.findIndex(a => a.trim() === "");
        if (emptyIndex !== -1) {
          const updated = [...accomplishments];
          updated[emptyIndex] = taskAccomplishment;
          setAccomplishments(updated);
        } else {
          setAccomplishments([...accomplishments, taskAccomplishment]);
        }
      }
    }
  };

  // Handle adding a new daily task
  const handleAddTask = async () => {
    if (!user || !newTaskTitle.trim()) return;

    await createDailyTask({
      userId: user._id,
      title: newTaskTitle.trim(),
      createdBy: user._id,
    });

    setNewTaskTitle("");
    setShowAddTask(false);
  };

  // Handle deleting a daily task
  const handleDeleteTask = async (taskId: Id<"dailyTaskTemplates">) => {
    if (!confirm("Delete this daily task? This will remove it from your recurring tasks.")) return;
    await deleteDailyTask({ taskId });
  };

  // Load existing log into form when date changes
  useEffect(() => {
    isInitialLoad.current = true;
    if (existingLog) {
      setSummary(existingLog.summary);
      setAccomplishments(
        existingLog.accomplishments.length > 0 ? existingLog.accomplishments : [""]
      );
      setBlockers(existingLog.blockers || "");
      setGoalsForTomorrow(existingLog.goalsForTomorrow || "");
      setHoursWorked(existingLog.hoursWorked?.toString() || "");
      if (existingLog.updatedAt) {
        setLastSaved(new Date(existingLog.updatedAt));
      }
    } else {
      // Reset form for new date
      setSummary("");
      setAccomplishments([""]);
      setBlockers("");
      setGoalsForTomorrow("");
      setHoursWorked("");
      setLastSaved(null);
    }
    // Allow auto-save after a short delay to prevent saving on initial load
    setTimeout(() => {
      isInitialLoad.current = false;
    }, 500);
  }, [existingLog, selectedDate]);

  // Auto-save function
  const performAutoSave = React.useCallback(async () => {
    if (!user || isInitialLoad.current) return;

    // Don't auto-save if already submitted
    if (existingLog?.isSubmitted) return;

    // Don't auto-save empty forms
    const hasContent = summary.trim() || accomplishments.some(a => a.trim()) || blockers.trim() || goalsForTomorrow.trim() || hoursWorked;
    if (!hasContent) return;

    setAutoSaveStatus("saving");
    try {
      await saveLog({
        userId: user._id,
        date: selectedDate,
        summary,
        accomplishments: accomplishments.filter((a) => a.trim() !== ""),
        blockers: blockers || undefined,
        goalsForTomorrow: goalsForTomorrow || undefined,
        hoursWorked: hoursWorked ? parseFloat(hoursWorked) : undefined,
        isSubmitted: false,
      });
      setAutoSaveStatus("saved");
      setLastSaved(new Date());
      // Reset to idle after 3 seconds
      setTimeout(() => setAutoSaveStatus("idle"), 3000);
    } catch (error) {
      console.error("Auto-save failed:", error);
      setAutoSaveStatus("error");
    }
  }, [user, selectedDate, summary, accomplishments, blockers, goalsForTomorrow, hoursWorked, saveLog, existingLog?.isSubmitted]);

  // Debounced auto-save effect - triggers 2 seconds after user stops typing
  useEffect(() => {
    if (isInitialLoad.current) return;
    if (existingLog?.isSubmitted) return;

    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Set new timeout for auto-save
    autoSaveTimeoutRef.current = setTimeout(() => {
      performAutoSave();
    }, 2000);

    // Cleanup on unmount
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [summary, accomplishments, blockers, goalsForTomorrow, hoursWorked, performAutoSave, existingLog?.isSubmitted]);

  const handleAddAccomplishment = () => {
    setAccomplishments([...accomplishments, ""]);
  };

  const handleRemoveAccomplishment = (index: number) => {
    if (accomplishments.length > 1) {
      setAccomplishments(accomplishments.filter((_, i) => i !== index));
    }
  };

  const handleAccomplishmentChange = (index: number, value: string) => {
    const updated = [...accomplishments];
    updated[index] = value;
    setAccomplishments(updated);
  };

  const handleSave = async (submit: boolean = false) => {
    if (!user) return;

    setIsSaving(true);
    try {
      await saveLog({
        userId: user._id,
        date: selectedDate,
        summary,
        accomplishments: accomplishments.filter((a) => a.trim() !== ""),
        blockers: blockers || undefined,
        goalsForTomorrow: goalsForTomorrow || undefined,
        hoursWorked: hoursWorked ? parseFloat(hoursWorked) : undefined,
        isSubmitted: submit,
      });
    } catch (error) {
      console.error("Failed to save log:", error);
      alert(error instanceof Error ? error.message : "Failed to save log");
    } finally {
      setIsSaving(false);
    }
  };

  const isLocked = existingLog?.isSubmitted || false;
  const canSubmit = summary.trim() !== "" && accomplishments.some((a) => a.trim() !== "");

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden">
        <MobileHeader />

        {/* Header */}
        <header className="flex-shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-b theme-border-secondary px-4 sm:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Daily Activity Log</h1>
              <div className="flex items-center gap-3 mt-1">
                <p className="theme-text-secondary text-xs sm:text-sm">
                  Track your daily work and accomplishments
                </p>
                {/* Auto-save status indicator */}
                {!existingLog?.isSubmitted && (
                  <div className="flex items-center gap-1.5">
                    {autoSaveStatus === "saving" && (
                      <>
                        <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></div>
                        <span className="text-amber-400 text-xs">Saving...</span>
                      </>
                    )}
                    {autoSaveStatus === "saved" && (
                      <>
                        <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-green-400 text-xs">Saved</span>
                      </>
                    )}
                    {autoSaveStatus === "error" && (
                      <>
                        <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-red-400 text-xs">Save failed</span>
                      </>
                    )}
                    {autoSaveStatus === "idle" && lastSaved && (
                      <span className="theme-text-tertiary text-xs">
                        Last saved {lastSaved.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={today}
                className="theme-input px-3 py-2 text-sm"
              />
              <button
                onClick={() => setShowPastLogs(!showPastLogs)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  showPastLogs
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/50"
                    : "theme-btn-secondary"
                }`}
              >
                Past Logs
              </button>
              {/* Help Button */}
              <button
                onClick={() => setShowHelp(true)}
                className="p-2 rounded-lg transition-colors theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
                title="How to use Daily Log"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        {/* Reminder Banner - show if today's log not submitted */}
        {selectedDate === today && !existingLog?.isSubmitted && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 sm:px-8 py-3">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-amber-400 text-sm">
                <span className="font-medium">Daily log reminder:</span> Add your accomplishments throughout the day - they auto-save as you type! Submit before you leave.
              </p>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Form */}
            <div className="lg:col-span-2 space-y-6">
              {/* Status Banner */}
              {isLocked && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-center gap-3">
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-green-400 font-medium">This log has been submitted</span>
                </div>
              )}

              {/* Summary */}
              <div className="theme-card rounded-xl p-4 sm:p-6">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium theme-text-secondary">
                    What did you work on today? <span className="text-red-400">*</span>
                  </label>
                  {!isLocked && autoActivities && (autoActivities.totalActions > 0 || (dailyTasksWithStatus && dailyTasksWithStatus.some(t => t.isCompletedToday))) && (
                    <button
                      onClick={() => {
                        const parts: string[] = [];

                        // Add auto-tracked activities
                        if (autoActivities.projectsCreated > 0) {
                          parts.push(`Created ${autoActivities.projectsCreated} project${autoActivities.projectsCreated > 1 ? "s" : ""}`);
                        }
                        if (autoActivities.projectsMoved > 0) {
                          parts.push(`Updated ${autoActivities.projectsMoved} project status${autoActivities.projectsMoved > 1 ? "es" : ""}`);
                        }
                        if (autoActivities.tasksCompleted > 0) {
                          parts.push(`Completed ${autoActivities.tasksCompleted} task${autoActivities.tasksCompleted > 1 ? "s" : ""}`);
                        }

                        // Add completed daily tasks
                        const completedTasks = dailyTasksWithStatus?.filter(t => t.isCompletedToday) || [];
                        if (completedTasks.length > 0) {
                          parts.push(`Completed daily tasks: ${completedTasks.map(t => t.title).join(", ")}`);
                        }

                        if (parts.length > 0) {
                          const newSummary = parts.join(". ") + ".";
                          setSummary(prev => prev ? `${prev} ${newSummary}` : newSummary);
                        }
                      }}
                      className="text-purple-400 hover:text-purple-300 text-xs flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Generate from activities
                    </button>
                  )}
                </div>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  disabled={isLocked}
                  className="theme-input resize-none disabled:opacity-50"
                  placeholder="Describe your main focus and activities..."
                  rows={4}
                />
              </div>

              {/* Accomplishments */}
              <div className="theme-card rounded-xl p-4 sm:p-6">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium theme-text-secondary">
                    Accomplishments <span className="text-red-400">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {!isLocked && dailyTasksWithStatus && dailyTasksWithStatus.some(t => t.isCompletedToday) && (
                      <button
                        onClick={() => {
                          const completedTasks = dailyTasksWithStatus.filter(t => t.isCompletedToday);
                          const newAccomplishments = completedTasks
                            .map(t => `✓ ${t.title}`)
                            .filter(item => !accomplishments.includes(item));

                          if (newAccomplishments.length > 0) {
                            // Filter out empty entries and add new ones
                            const currentNonEmpty = accomplishments.filter(a => a.trim() !== "");
                            setAccomplishments([...currentNonEmpty, ...newAccomplishments, ""]);
                          }
                        }}
                        className="text-emerald-400 hover:text-emerald-300 text-xs flex items-center gap-1"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        Add daily tasks
                      </button>
                    )}
                    {!isLocked && (
                      <button
                        onClick={handleAddAccomplishment}
                        className="theme-accent-primary hover:underline text-sm flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  {accomplishments.map((item, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="text-green-400">•</span>
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => handleAccomplishmentChange(index, e.target.value)}
                        disabled={isLocked}
                        className="flex-1 theme-input text-sm disabled:opacity-50"
                        placeholder="What did you accomplish?"
                      />
                      {!isLocked && accomplishments.length > 1 && (
                        <button
                          onClick={() => handleRemoveAccomplishment(index)}
                          className="theme-text-tertiary hover:text-red-400 p-1"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Quick Templates */}
                {!isLocked && (
                  <div className="mt-4 pt-4 border-t theme-border-secondary">
                    <p className="text-xs theme-text-tertiary mb-2">Quick add:</p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        "Completed project tasks",
                        "Attended team meeting",
                        "Resolved customer issue",
                        "Processed orders/shipments",
                        "Updated documentation",
                        "Conducted inventory check",
                        "Trained team member",
                        "Fixed bug/issue",
                      ].map((template) => (
                        <button
                          key={template}
                          type="button"
                          onClick={() => {
                            // Find first empty slot or add new one
                            const emptyIndex = accomplishments.findIndex(a => a.trim() === "");
                            if (emptyIndex !== -1) {
                              handleAccomplishmentChange(emptyIndex, template);
                            } else {
                              setAccomplishments([...accomplishments, template]);
                            }
                          }}
                          className="px-2.5 py-1 text-xs bg-black/5 dark:bg-slate-700/50 theme-text-secondary rounded-full hover:bg-[#007AFF]/10 hover:text-[#007AFF] transition-colors"
                        >
                          + {template}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Blockers */}
              <div className="theme-card rounded-xl p-4 sm:p-6">
                <label className="block text-sm font-medium theme-text-secondary mb-2">
                  Blockers / Challenges
                </label>
                <textarea
                  value={blockers}
                  onChange={(e) => setBlockers(e.target.value)}
                  disabled={isLocked}
                  className="theme-input resize-none disabled:opacity-50"
                  placeholder="Any blockers or challenges you faced..."
                  rows={2}
                />
              </div>

              {/* Goals for Tomorrow */}
              <div className="theme-card rounded-xl p-4 sm:p-6">
                <label className="block text-sm font-medium theme-text-secondary mb-2">
                  Goals for Tomorrow
                </label>
                <textarea
                  value={goalsForTomorrow}
                  onChange={(e) => setGoalsForTomorrow(e.target.value)}
                  disabled={isLocked}
                  className="theme-input resize-none disabled:opacity-50"
                  placeholder="What do you plan to focus on tomorrow?"
                  rows={2}
                />
              </div>

              {/* Hours Worked */}
              <div className="theme-card rounded-xl p-4 sm:p-6">
                <label className="block text-sm font-medium theme-text-secondary mb-2">
                  Hours Worked
                </label>
                <input
                  type="number"
                  value={hoursWorked}
                  onChange={(e) => setHoursWorked(e.target.value)}
                  disabled={isLocked}
                  min="0"
                  max="24"
                  step="0.5"
                  className="theme-input disabled:opacity-50"
                  placeholder="8"
                />
              </div>

              {/* Action Buttons */}
              {!isLocked && (
                <div className="flex items-center justify-between">
                  <p className="theme-text-tertiary text-sm flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Changes auto-save as you type
                  </p>
                  <button
                    onClick={() => handleSave(true)}
                    disabled={isSaving || !canSubmit}
                    className="theme-btn-primary px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSaving ? "Submitting..." : "Submit Log"}
                  </button>
                </div>
              )}
            </div>

            {/* Sidebar - Daily Tasks, Auto Activities & Past Logs */}
            <div className="space-y-6">
              {/* Daily Tasks Checklist */}
              <div className="theme-card rounded-xl p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium theme-text-secondary flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    Daily Tasks
                  </h3>
                  {!isLocked && (
                    <button
                      onClick={() => setShowAddTask(!showAddTask)}
                      className="text-emerald-400 hover:text-emerald-300 text-xs flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add
                    </button>
                  )}
                </div>

                {/* Add new task form */}
                {showAddTask && (
                  <div className="mb-4 p-3 bg-[#f2f2f7] dark:bg-slate-900/50 rounded-lg border theme-border-secondary">
                    <input
                      type="text"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      placeholder="New daily task..."
                      className="theme-input w-full px-3 py-2 text-sm mb-2"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddTask();
                        if (e.key === "Escape") {
                          setShowAddTask(false);
                          setNewTaskTitle("");
                        }
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleAddTask}
                        disabled={!newTaskTitle.trim()}
                        className="flex-1 px-3 py-1.5 bg-emerald-500 text-white text-xs font-medium rounded-lg hover:bg-emerald-600 disabled:opacity-50"
                      >
                        Add Task
                      </button>
                      <button
                        onClick={() => {
                          setShowAddTask(false);
                          setNewTaskTitle("");
                        }}
                        className="px-3 py-1.5 theme-text-secondary text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Task list */}
                {dailyTasksWithStatus && dailyTasksWithStatus.length > 0 ? (
                  <div className="space-y-2">
                    {dailyTasksWithStatus.map((task) => (
                      <div
                        key={task._id}
                        className={`flex items-center gap-3 p-2 rounded-lg transition-colors group ${
                          task.isCompletedToday
                            ? "bg-emerald-500/10 border border-emerald-500/30"
                            : "bg-black/5 dark:bg-slate-900/30 hover:bg-black/10 dark:hover:bg-slate-900/50"
                        }`}
                      >
                        <button
                          onClick={() => handleToggleTask(task._id, task.title, task.isCompletedToday)}
                          disabled={isLocked}
                          className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            task.isCompletedToday
                              ? "bg-emerald-500 border-emerald-500 text-white"
                              : "border-slate-500 hover:border-emerald-400"
                          } ${isLocked ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          {task.isCompletedToday && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <span
                          className={`flex-1 text-sm ${
                            task.isCompletedToday ? "text-emerald-400 line-through" : "theme-text-secondary"
                          }`}
                        >
                          {task.title}
                        </span>
                        {!isLocked && (
                          <button
                            onClick={() => handleDeleteTask(task._id)}
                            className="opacity-0 group-hover:opacity-100 theme-text-tertiary hover:text-red-400 p-1 transition-opacity"
                            title="Delete task"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                    {/* Completion summary */}
                    <div className="pt-2 border-t theme-border-secondary flex justify-between items-center">
                      <span className="theme-text-tertiary text-xs">
                        {dailyTasksWithStatus.filter(t => t.isCompletedToday).length} of {dailyTasksWithStatus.length} complete
                      </span>
                      {dailyTasksWithStatus.length > 0 && dailyTasksWithStatus.every(t => t.isCompletedToday) && (
                        <span className="text-emerald-400 text-xs font-medium flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          All done!
                        </span>
                      )}
                    </div>
                  </div>
                ) : dailyTasksWithStatus && dailyTasksWithStatus.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="theme-text-tertiary text-sm mb-2">No daily tasks yet</p>
                    <p className="theme-text-tertiary text-xs">
                      Add recurring tasks that you do every day
                    </p>
                  </div>
                ) : (
                  <p className="theme-text-tertiary text-sm">Loading...</p>
                )}
              </div>

              {/* Auto-Tracked Activities */}
              <div className="theme-card rounded-xl p-4 sm:p-6">
                <h3 className="text-sm font-medium theme-text-secondary mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Auto-Tracked Today
                </h3>
                {autoActivities ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="theme-text-secondary text-sm">Projects Created</span>
                      <span className="theme-text-primary font-medium">{autoActivities.projectsCreated}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="theme-text-secondary text-sm">Projects Moved</span>
                      <span className="theme-text-primary font-medium">{autoActivities.projectsMoved}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="theme-text-secondary text-sm">Tasks Completed</span>
                      <span className="theme-text-primary font-medium">{autoActivities.tasksCompleted}</span>
                    </div>
                    <div className="border-t theme-border-secondary pt-3 flex justify-between items-center">
                      <span className="theme-text-secondary text-sm font-medium">Total Actions</span>
                      <span className="theme-accent-primary font-bold">{autoActivities.totalActions}</span>
                    </div>
                  </div>
                ) : (
                  <p className="theme-text-tertiary text-sm">Loading...</p>
                )}
              </div>

              {/* Past Logs */}
              {(showPastLogs || !existingLog) && myLogs && myLogs.length > 0 && (
                <div className="theme-card rounded-xl p-4 sm:p-6">
                  <h3 className="text-sm font-medium theme-text-secondary mb-4">Recent Logs</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {myLogs.map((log) => (
                      <button
                        key={log._id}
                        onClick={() => setSelectedDate(log.date)}
                        className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                          log.date === selectedDate
                            ? "bg-cyan-500/20 border border-cyan-500/50"
                            : "bg-black/5 dark:bg-slate-900/50 hover:bg-black/10 dark:hover:bg-slate-700/50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="theme-text-primary text-sm">
                            {new Date(log.date + "T00:00:00").toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          {log.isSubmitted ? (
                            <span className="text-green-400 text-xs flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Submitted
                            </span>
                          ) : (
                            <span className="text-amber-400 text-xs">Draft</span>
                          )}
                        </div>
                        <p className="theme-text-secondary text-xs truncate mt-1">
                          {log.accomplishments.length} accomplishments
                          {log.hoursWorked ? ` • ${log.hoursWorked}h` : ""}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Stats */}
              {existingLog && (
                <div className="theme-card rounded-xl p-4 sm:p-6">
                  <h3 className="text-sm font-medium theme-text-secondary mb-4">Log Summary</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="theme-text-secondary text-sm">Accomplishments</span>
                      <span className="theme-text-primary font-medium">{existingLog.accomplishments.length}</span>
                    </div>
                    {existingLog.hoursWorked && (
                      <div className="flex justify-between items-center">
                        <span className="theme-text-secondary text-sm">Hours</span>
                        <span className="theme-text-primary font-medium">{existingLog.hoursWorked}h</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="theme-text-secondary text-sm">Status</span>
                      <span className={`text-xs font-medium ${existingLog.isSubmitted ? "text-green-400" : "text-amber-400"}`}>
                        {existingLog.isSubmitted ? "Submitted" : "Draft"}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Help Modal */}
        {showHelp && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="theme-card w-full max-w-lg rounded-xl p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold theme-text-primary">
                  How to Use Daily Logs
                </h2>
                <button
                  onClick={() => setShowHelp(false)}
                  className="p-2 rounded-lg transition-colors theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-6">
                {/* Why Daily Logs */}
                <div>
                  <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                    <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Why Fill Out Daily Logs?
                  </h3>
                  <p className="text-sm theme-text-secondary">
                    Daily logs help management track team progress and provide visibility to stakeholders.
                    They also help you keep a record of your accomplishments for performance reviews.
                  </p>
                </div>

                {/* What to Include */}
                <div>
                  <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    What to Include
                  </h3>
                  <ul className="text-sm theme-text-secondary space-y-2 ml-7">
                    <li><span className="theme-text-primary font-medium">Summary:</span> Brief overview of what you worked on today</li>
                    <li><span className="theme-text-primary font-medium">Accomplishments:</span> Specific tasks you completed (be specific!)</li>
                    <li><span className="theme-text-primary font-medium">Blockers:</span> Any issues preventing progress (optional)</li>
                    <li><span className="theme-text-primary font-medium">Goals:</span> What you plan to work on tomorrow (optional)</li>
                    <li><span className="theme-text-primary font-medium">Hours:</span> How many hours you worked</li>
                  </ul>
                </div>

                {/* Auto-Tracked Activities */}
                <div>
                  <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Auto-Tracked Activities
                  </h3>
                  <p className="text-sm theme-text-secondary mb-2">
                    The system automatically tracks some of your activities:
                  </p>
                  <ul className="text-sm theme-text-secondary space-y-1 ml-7 list-disc">
                    <li><span className="text-purple-400">Projects Created</span> - When you create a new project</li>
                    <li><span className="text-purple-400">Projects Moved</span> - Moving projects between status columns</li>
                    <li><span className="text-purple-400">Tasks Completed</span> - Marking tasks as done on your project board</li>
                    <li><span className="text-purple-400">Total Actions</span> - All tracked activities combined</li>
                  </ul>
                  <p className="text-sm theme-text-tertiary mt-2 italic">
                    These are captured automatically when you submit - no need to list them manually!
                  </p>
                </div>

                {/* Save vs Submit */}
                <div>
                  <h3 className="font-medium mb-2 flex items-center gap-2 theme-text-primary">
                    <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                    Auto-Save & Submit
                  </h3>
                  <ul className="text-sm theme-text-secondary space-y-2 ml-7">
                    <li><span className="theme-text-primary font-medium">Auto-Save:</span> Your progress saves automatically as you type - no need to click save! Just add items throughout the day.</li>
                    <li><span className="theme-text-primary font-medium">Submit:</span> Finalizes your log and sends it to management. Click this at the end of your day.</li>
                  </ul>
                </div>

                {/* Tips */}
                <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
                  <h3 className="font-medium mb-2 flex items-center gap-2 text-cyan-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    Pro Tips
                  </h3>
                  <ul className="text-sm text-cyan-300/80 space-y-1 list-disc ml-5">
                    <li>Add accomplishments throughout the day - everything auto-saves!</li>
                    <li>Be specific - &quot;Fixed login bug&quot; is better than &quot;worked on bugs&quot;</li>
                    <li>Submit before you leave for the day</li>
                    <li>Check the sidebar for your auto-tracked activities</li>
                  </ul>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t theme-border-secondary">
                <button
                  onClick={() => setShowHelp(false)}
                  className="theme-btn-primary w-full px-4 py-2"
                >
                  Got it!
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Reportee User Type
interface ReporteeUser {
  _id: Id<"users">;
  name: string;
  email?: string;
  requiresDailyLog?: boolean;
}

// ReporteesOnlyView - For managers who don't require daily log but have reportees who do
function ReporteesOnlyView({ reportees }: { reportees: ReporteeUser[] }) {
  const today = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  // Get today's logs for all reportees
  const reporteeIds = reportees.map(r => r._id);
  const todayLogs = useQuery(
    api.dailyLogs.getTodayLogsForUsers,
    { userIds: reporteeIds, date: selectedDate }
  );

  // Get recent logs for all reportees
  const recentLogs = useQuery(
    api.dailyLogs.getLogsForUsers,
    { userIds: reporteeIds, limit: 30 }
  );

  const toggleLogExpansion = (logId: string) => {
    setExpandedLogs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      return newSet;
    });
  };

  // Group logs by date
  const logsByDate = React.useMemo(() => {
    if (!recentLogs) return {};
    return recentLogs.reduce((acc, log) => {
      if (!acc[log.date]) {
        acc[log.date] = [];
      }
      acc[log.date].push(log);
      return acc;
    }, {} as Record<string, typeof recentLogs>);
  }, [recentLogs]);

  const sortedDates = Object.keys(logsByDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden">
        <MobileHeader />

        {/* Header */}
        <header className="flex-shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-b theme-border-secondary px-4 sm:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Team Daily Logs</h1>
              <p className="theme-text-secondary text-xs sm:text-sm mt-1">
                View daily logs from your direct reports
              </p>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/daily-log/report"
                className="theme-btn-primary px-3 py-2 font-medium rounded-lg transition-colors flex items-center gap-2 text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                <span className="hidden sm:inline">Print Team Log</span>
              </a>
              <div className="flex items-center gap-2 text-sm theme-text-secondary">
                <svg className="w-4 h-4 theme-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                {reportees.length} reportee{reportees.length > 1 ? "s" : ""}
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-4xl mx-auto space-y-6">

            {/* Today's Status Card */}
            <div className="theme-card rounded-xl border border-cyan-500/30 p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <h2 className="text-lg font-semibold theme-text-primary">Today&apos;s Status</h2>
                <span className="theme-text-secondary text-sm">
                  ({new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })})
                </span>
              </div>

              <div className="grid gap-3">
                {reportees.map(reportee => {
                  const todayLog = todayLogs?.find(l => l.userId === reportee._id);
                  const hasSubmitted = todayLog?.isSubmitted;
                  const hasDraft = todayLog && !todayLog.isSubmitted;

                  return (
                    <div key={reportee._id} className="flex items-center justify-between theme-card rounded-lg p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 font-medium">
                          {reportee.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                        </div>
                        <div>
                          <p className="theme-text-primary font-medium">{reportee.name}</p>
                          <p className="theme-text-secondary text-sm">{reportee.email}</p>
                        </div>
                      </div>
                      <div>
                        {hasSubmitted ? (
                          <span className="px-3 py-1 text-xs font-medium rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                            Submitted
                          </span>
                        ) : hasDraft ? (
                          <span className="px-3 py-1 text-xs font-medium rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            Draft in Progress
                          </span>
                        ) : (
                          <span className="px-3 py-1 text-xs font-medium rounded-full bg-black/5 dark:bg-slate-500/20 theme-text-secondary border theme-border-secondary">
                            Not Started
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent Logs */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold theme-text-primary">Recent Logs</h2>

              {sortedDates.length === 0 ? (
                <div className="theme-card rounded-xl p-8 text-center">
                  <svg className="w-12 h-12 theme-text-tertiary mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="theme-text-secondary">No logs submitted yet</p>
                  <p className="theme-text-tertiary text-sm mt-1">Logs from your direct reports will appear here</p>
                </div>
              ) : (
                sortedDates.map(date => (
                  <div key={date} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium theme-text-secondary">
                        {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                          weekday: "long",
                          month: "short",
                          day: "numeric",
                        })}
                      </h3>
                      {date === today && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-cyan-500/20 text-cyan-400">
                          Today
                        </span>
                      )}
                    </div>

                    {logsByDate[date].filter(l => l.isSubmitted).map(log => (
                      <div key={log._id} className="theme-card rounded-xl overflow-hidden">
                        <div
                          className="p-4 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          onClick={() => toggleLogExpansion(log._id)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-sm font-medium">
                                {log.userName.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                              </div>
                              <div>
                                <p className="theme-text-primary font-medium">{log.userName}</p>
                                <p className="theme-text-tertiary text-sm">{log.summary?.slice(0, 60)}{log.summary && log.summary.length > 60 ? "..." : ""}</p>
                              </div>
                            </div>
                            <svg
                              className={`w-5 h-5 theme-text-secondary transition-transform ${expandedLogs.has(log._id) ? "rotate-180" : ""}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </div>

                        {expandedLogs.has(log._id) && (
                          <div className="px-4 pb-4 border-t theme-border-secondary pt-4 space-y-4">
                            {log.summary && (
                              <div>
                                <h4 className="text-xs font-medium theme-text-tertiary uppercase mb-1">Summary</h4>
                                <p className="theme-text-primary">{log.summary}</p>
                              </div>
                            )}
                            {log.accomplishments && log.accomplishments.length > 0 && (
                              <div>
                                <h4 className="text-xs font-medium theme-text-tertiary uppercase mb-1">Accomplishments</h4>
                                <ul className="space-y-1">
                                  {log.accomplishments.map((acc: string, i: number) => (
                                    <li key={i} className="flex items-start gap-2">
                                      <svg className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      <span className="theme-text-secondary">{acc}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {log.blockers && (
                              <div>
                                <h4 className="text-xs font-medium theme-text-tertiary uppercase mb-1">Blockers</h4>
                                <p className="theme-text-secondary">{log.blockers}</p>
                              </div>
                            )}
                            {log.goalsForTomorrow && (
                              <div>
                                <h4 className="text-xs font-medium theme-text-tertiary uppercase mb-1">Goals for Tomorrow</h4>
                                <p className="theme-text-secondary">{log.goalsForTomorrow}</p>
                              </div>
                            )}
                            {log.hoursWorked && (
                              <div className="text-sm theme-text-secondary">
                                Hours worked: <span className="theme-text-primary">{log.hoursWorked}h</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ManagerWithReporteesView - For managers who require daily log AND have reportees
function ManagerWithReporteesView({ reportees }: { reportees: ReporteeUser[] }) {
  const [activeTab, setActiveTab] = useState<"my-log" | "team">("my-log");

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden">
        <MobileHeader />

        {/* Header with Tabs */}
        <header className="flex-shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-b theme-border-secondary px-4 sm:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Daily Log</h1>
              <p className="theme-text-secondary text-xs sm:text-sm mt-1">
                Submit your log and view your team&apos;s activity
              </p>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/daily-log/report"
                className="theme-btn-primary px-3 py-2 font-medium rounded-lg transition-colors flex items-center gap-2 text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                <span className="hidden sm:inline">Print</span>
              </a>
              <div className="flex items-center gap-2 text-sm theme-text-secondary">
                <svg className="w-4 h-4 theme-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                {reportees.length} reportee{reportees.length > 1 ? "s" : ""}
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-1 bg-black/5 dark:bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => setActiveTab("my-log")}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === "my-log"
                  ? "theme-btn-primary"
                  : "theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              My Daily Log
            </button>
            <button
              onClick={() => setActiveTab("team")}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === "team"
                  ? "theme-btn-primary"
                  : "theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              Team Logs
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "my-log" ? (
            <EmployeeDailyLogViewContent />
          ) : (
            <ReporteesLogsContent reportees={reportees} />
          )}
        </div>
      </main>
    </div>
  );
}

// Extracted content from EmployeeDailyLogView for reuse in tabs
function EmployeeDailyLogViewContent() {
  const { user } = useAuth();
  const today = new Date().toISOString().split("T")[0];

  const [selectedDate, setSelectedDate] = useState(today);
  const [summary, setSummary] = useState("");
  const [accomplishments, setAccomplishments] = useState<string[]>([""]);
  const [blockers, setBlockers] = useState("");
  const [goalsForTomorrow, setGoalsForTomorrow] = useState("");
  const [hoursWorked, setHoursWorked] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [showPastLogs, setShowPastLogs] = useState(false);

  // Auto-save state
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const isInitialLoad = React.useRef(true);
  const autoSaveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Queries
  const existingLog = useQuery(
    api.dailyLogs.getByDate,
    user?._id ? { userId: user._id, date: selectedDate } : "skip"
  );
  const autoActivities = useQuery(
    api.dailyLogs.getAutoActivities,
    user?._id ? { userId: user._id, date: selectedDate } : "skip"
  );
  const myLogs = useQuery(
    api.dailyLogs.getMyLogs,
    user?._id ? { userId: user._id, limit: 14 } : "skip"
  );

  // Mutations
  const saveLog = useMutation(api.dailyLogs.saveLog);

  // Load existing log into form when date changes
  useEffect(() => {
    isInitialLoad.current = true;
    if (existingLog) {
      setSummary(existingLog.summary);
      setAccomplishments(
        existingLog.accomplishments.length > 0 ? existingLog.accomplishments : [""]
      );
      setBlockers(existingLog.blockers || "");
      setGoalsForTomorrow(existingLog.goalsForTomorrow || "");
      setHoursWorked(existingLog.hoursWorked?.toString() || "");
      if (existingLog.updatedAt) {
        setLastSaved(new Date(existingLog.updatedAt));
      }
    } else {
      setSummary("");
      setAccomplishments([""]);
      setBlockers("");
      setGoalsForTomorrow("");
      setHoursWorked("");
      setLastSaved(null);
    }
    setTimeout(() => {
      isInitialLoad.current = false;
    }, 500);
  }, [existingLog, selectedDate]);

  // Auto-save effect
  useEffect(() => {
    if (isInitialLoad.current || !user || existingLog?.isSubmitted) return;

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(async () => {
      const filteredAccomplishments = accomplishments.filter(a => a.trim() !== "");
      if (!summary.trim() && filteredAccomplishments.length === 0) return;

      setAutoSaveStatus("saving");
      try {
        await saveLog({
          userId: user._id,
          date: selectedDate,
          summary: summary.trim(),
          accomplishments: filteredAccomplishments,
          blockers: blockers.trim() || undefined,
          goalsForTomorrow: goalsForTomorrow.trim() || undefined,
          hoursWorked: hoursWorked ? parseFloat(hoursWorked) : undefined,
          isSubmitted: false,
        });
        setAutoSaveStatus("saved");
        setLastSaved(new Date());
      } catch {
        setAutoSaveStatus("error");
      }
    }, 2000);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [summary, accomplishments, blockers, goalsForTomorrow, hoursWorked, user, selectedDate, existingLog?.isSubmitted, saveLog]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsSaving(true);
    try {
      const filteredAccomplishments = accomplishments.filter(a => a.trim() !== "");

      await saveLog({
        userId: user._id,
        date: selectedDate,
        summary: summary.trim(),
        accomplishments: filteredAccomplishments,
        blockers: blockers.trim() || undefined,
        goalsForTomorrow: goalsForTomorrow.trim() || undefined,
        hoursWorked: hoursWorked ? parseFloat(hoursWorked) : undefined,
        isSubmitted: true,
      });
    } catch (error) {
      console.error("Failed to submit log:", error);
      alert("Failed to submit log");
    } finally {
      setIsSaving(false);
    }
  };

  const addAccomplishment = () => {
    setAccomplishments([...accomplishments, ""]);
  };

  const updateAccomplishment = (index: number, value: string) => {
    const updated = [...accomplishments];
    updated[index] = value;
    setAccomplishments(updated);
  };

  const removeAccomplishment = (index: number) => {
    if (accomplishments.length > 1) {
      setAccomplishments(accomplishments.filter((_, i) => i !== index));
    }
  };

  const isLocked = existingLog?.isSubmitted === true;

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        {/* Submitted confirmation */}
        {isLocked && (
          <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-xl flex items-center gap-3">
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-green-400 font-medium">Log submitted for {selectedDate}</p>
              <p className="text-green-400/70 text-sm">Your daily log has been submitted and is locked.</p>
            </div>
          </div>
        )}

        {/* Date Selector */}
        <div className="flex items-center gap-3 mb-6">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            max={today}
            className="theme-input"
          />
          {selectedDate !== today && (
            <button
              onClick={() => setSelectedDate(today)}
              className="theme-accent-primary text-sm hover:underline"
            >
              Go to today
            </button>
          )}
          {autoSaveStatus === "saving" && (
            <span className="text-amber-400 text-sm flex items-center gap-1">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Saving...
            </span>
          )}
          {autoSaveStatus === "saved" && lastSaved && (
            <span className="text-green-400 text-sm">
              Saved at {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Summary */}
          <div>
            <label className="block text-sm font-medium theme-text-secondary mb-2">
              Summary <span className="text-red-400">*</span>
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Brief overview of your day..."
              rows={3}
              disabled={isLocked}
              className="theme-input disabled:opacity-50"
              required
            />
          </div>

          {/* Accomplishments */}
          <div>
            <label className="block text-sm font-medium theme-text-secondary mb-2">
              Accomplishments <span className="text-red-400">*</span>
            </label>
            <div className="space-y-2">
              {accomplishments.map((acc, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={acc}
                    onChange={(e) => updateAccomplishment(index, e.target.value)}
                    placeholder={`Accomplishment ${index + 1}`}
                    disabled={isLocked}
                    className="flex-1 theme-input disabled:opacity-50"
                  />
                  {accomplishments.length > 1 && !isLocked && (
                    <button
                      type="button"
                      onClick={() => removeAccomplishment(index)}
                      className="p-2 theme-text-secondary hover:text-red-400"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!isLocked && (
              <button
                type="button"
                onClick={addAccomplishment}
                className="mt-2 theme-accent-primary text-sm hover:underline flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add another
              </button>
            )}
          </div>

          {/* Blockers */}
          <div>
            <label className="block text-sm font-medium theme-text-secondary mb-2">
              Blockers <span className="theme-text-tertiary">(optional)</span>
            </label>
            <textarea
              value={blockers}
              onChange={(e) => setBlockers(e.target.value)}
              placeholder="Any challenges or blockers?"
              rows={2}
              disabled={isLocked}
              className="theme-input disabled:opacity-50"
            />
          </div>

          {/* Goals for Tomorrow */}
          <div>
            <label className="block text-sm font-medium theme-text-secondary mb-2">
              Goals for Tomorrow <span className="theme-text-tertiary">(optional)</span>
            </label>
            <textarea
              value={goalsForTomorrow}
              onChange={(e) => setGoalsForTomorrow(e.target.value)}
              placeholder="What do you plan to work on?"
              rows={2}
              disabled={isLocked}
              className="theme-input disabled:opacity-50"
            />
          </div>

          {/* Hours Worked */}
          <div>
            <label className="block text-sm font-medium theme-text-secondary mb-2">
              Hours Worked <span className="theme-text-tertiary">(optional)</span>
            </label>
            <input
              type="number"
              value={hoursWorked}
              onChange={(e) => setHoursWorked(e.target.value)}
              placeholder="8"
              min="0"
              max="24"
              step="0.5"
              disabled={isLocked}
              className="w-32 theme-input disabled:opacity-50"
            />
          </div>

          {/* Submit Button */}
          {!isLocked && (
            <button
              type="submit"
              disabled={isSaving || !summary.trim()}
              className="theme-btn-primary w-full px-6 py-3 font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Submitting...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Submit Daily Log
                </>
              )}
            </button>
          )}
        </form>

        {/* Past Logs Section */}
        {myLogs && myLogs.length > 0 && (
          <div className="mt-8 pt-6 border-t theme-border-secondary">
            <button
              onClick={() => setShowPastLogs(!showPastLogs)}
              className="flex items-center gap-2 theme-text-secondary transition-colors"
            >
              <svg
                className={`w-5 h-5 transition-transform ${showPastLogs ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="font-medium">My Past Logs ({myLogs.filter(l => l.isSubmitted).length})</span>
            </button>

            {showPastLogs && (
              <div className="mt-4 space-y-3">
                {myLogs.filter(l => l.isSubmitted && l.date !== selectedDate).map(log => (
                  <div key={log._id} className="theme-card rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="theme-text-primary font-medium">
                        {new Date(log.date + "T12:00:00").toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      {log.hoursWorked && (
                        <span className="theme-text-secondary text-sm">{log.hoursWorked}h</span>
                      )}
                    </div>
                    <p className="theme-text-secondary text-sm">{log.summary}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Reportees logs content for the tab
function ReporteesLogsContent({ reportees }: { reportees: ReporteeUser[] }) {
  const today = new Date().toISOString().split("T")[0];
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const reporteeIds = reportees.map(r => r._id);
  const todayLogs = useQuery(
    api.dailyLogs.getTodayLogsForUsers,
    { userIds: reporteeIds, date: today }
  );
  const recentLogs = useQuery(
    api.dailyLogs.getLogsForUsers,
    { userIds: reporteeIds, limit: 30 }
  );

  const toggleLogExpansion = (logId: string) => {
    setExpandedLogs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      return newSet;
    });
  };

  const logsByDate = React.useMemo(() => {
    if (!recentLogs) return {};
    return recentLogs.reduce((acc, log) => {
      if (!acc[log.date]) {
        acc[log.date] = [];
      }
      acc[log.date].push(log);
      return acc;
    }, {} as Record<string, typeof recentLogs>);
  }, [recentLogs]);

  const sortedDates = Object.keys(logsByDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Today's Status */}
        <div className="theme-card rounded-xl border border-cyan-500/30 p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <h2 className="text-lg font-semibold theme-text-primary">Today&apos;s Status</h2>
          </div>

          <div className="grid gap-2">
            {reportees.map(reportee => {
              const todayLog = todayLogs?.find(l => l.userId === reportee._id);
              const hasSubmitted = todayLog?.isSubmitted;
              const hasDraft = todayLog && !todayLog.isSubmitted;

              return (
                <div key={reportee._id} className="flex items-center justify-between theme-card rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-sm font-medium">
                      {reportee.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                    </div>
                    <span className="theme-text-primary">{reportee.name}</span>
                  </div>
                  {hasSubmitted ? (
                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-500/20 text-green-400">Submitted</span>
                  ) : hasDraft ? (
                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-amber-500/20 text-amber-400">Draft</span>
                  ) : (
                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-black/5 dark:bg-slate-500/20 theme-text-secondary">Not Started</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Logs */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold theme-text-primary">Recent Logs</h2>

          {sortedDates.length === 0 ? (
            <div className="theme-card rounded-xl p-8 text-center">
              <p className="theme-text-secondary">No logs from your team yet</p>
            </div>
          ) : (
            sortedDates.map(date => (
              <div key={date} className="space-y-2">
                <h3 className="text-sm font-medium theme-text-secondary flex items-center gap-2">
                  {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}
                  {date === today && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-cyan-500/20 text-cyan-400">Today</span>
                  )}
                </h3>

                {logsByDate[date].filter(l => l.isSubmitted).map(log => (
                  <div key={log._id} className="theme-card rounded-xl overflow-hidden">
                    <div
                      className="p-4 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      onClick={() => toggleLogExpansion(log._id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-sm font-medium">
                            {log.userName.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                          </div>
                          <div>
                            <p className="theme-text-primary font-medium">{log.userName}</p>
                            <p className="theme-text-tertiary text-sm truncate max-w-md">{log.summary?.slice(0, 50)}...</p>
                          </div>
                        </div>
                        <svg className={`w-5 h-5 theme-text-secondary transition-transform ${expandedLogs.has(log._id) ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>

                    {expandedLogs.has(log._id) && (
                      <div className="px-4 pb-4 border-t theme-border-secondary pt-4 space-y-3">
                        {log.summary && (
                          <div>
                            <h4 className="text-xs font-medium theme-text-tertiary uppercase mb-1">Summary</h4>
                            <p className="theme-text-primary">{log.summary}</p>
                          </div>
                        )}
                        {log.accomplishments && log.accomplishments.length > 0 && (
                          <div>
                            <h4 className="text-xs font-medium theme-text-tertiary uppercase mb-1">Accomplishments</h4>
                            <ul className="space-y-1">
                              {log.accomplishments.map((acc: string, i: number) => (
                                <li key={i} className="flex items-start gap-2">
                                  <svg className="w-4 h-4 text-green-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  <span className="theme-text-secondary">{acc}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {log.blockers && (
                          <div>
                            <h4 className="text-xs font-medium theme-text-tertiary uppercase mb-1">Blockers</h4>
                            <p className="theme-text-secondary">{log.blockers}</p>
                          </div>
                        )}
                        {log.hoursWorked && (
                          <div className="text-sm theme-text-secondary">
                            Hours: <span className="theme-text-primary">{log.hoursWorked}h</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Main Component - Decides which view to show
function DailyLogContent() {
  const { user } = useAuth();

  // If requiresDailyLog is checked, user fills out their own log (employee view)
  const requiresDailyLog = user?.requiresDailyLog === true;

  // Check if user has reportees who require daily logs
  const reporteesRequiringLog = useQuery(
    api.auth.getReporteesRequiringDailyLog,
    user?._id ? { managerId: user._id } : "skip"
  );

  if (!user) {
    return (
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#007AFF]"></div>
      </div>
    );
  }

  // Loading state for reportees query
  if (reporteesRequiringLog === undefined) {
    return (
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#007AFF]"></div>
      </div>
    );
  }

  const hasReporteesRequiringLog = reporteesRequiringLog && reporteesRequiringLog.length > 0;

  // View logic:
  // 1. User requires daily log AND has reportees who require daily logs -> ManagerWithReporteesView (both)
  // 2. User requires daily log but no reportees -> EmployeeDailyLogView (just their own)
  // 3. User doesn't require daily log but has reportees -> ReporteesOnlyView (just see reportee logs)
  // 4. User doesn't require daily log and no reportees -> AdminDailyLogView (team view)

  if (requiresDailyLog && hasReporteesRequiringLog) {
    return <ManagerWithReporteesView reportees={reporteesRequiringLog} />;
  } else if (requiresDailyLog) {
    return <EmployeeDailyLogView />;
  } else if (hasReporteesRequiringLog) {
    return <ReporteesOnlyView reportees={reporteesRequiringLog} />;
  } else {
    return <AdminDailyLogView />;
  }
}

export default function DailyLogPage() {
  return (
    <Protected>
      <DailyLogContent />
    </Protected>
  );
}
