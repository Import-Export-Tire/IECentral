"use client";

import React, { useState, useRef } from "react";
import Protected from "../../protected";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../../auth-context";

function ReportContent() {
  const { user } = useAuth();
  const today = new Date().toISOString().split("T")[0];

  // Default to current week (Monday to today)
  const getMonday = (d: Date) => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
  };

  const monday = getMonday(new Date()).toISOString().split("T")[0];

  const [startDate, setStartDate] = useState(monday);
  const [endDate, setEndDate] = useState(today);
  const [selectedPerson, setSelectedPerson] = useState<string>("all");
  const reportRef = useRef<HTMLDivElement>(null);

  const weeklyOverview = useQuery(
    api.dailyLogs.getWeeklyOverview,
    { startDate, endDate }
  );

  const handlePrint = () => {
    window.print();
  };

  // Date range presets
  const applyPreset = (preset: string) => {
    const now = new Date();
    let start: Date;
    let end: Date;

    switch (preset) {
      case "this_week":
        start = getMonday(now);
        end = now;
        break;
      case "last_week":
        const lastWeek = new Date(now);
        lastWeek.setDate(lastWeek.getDate() - 7);
        start = getMonday(lastWeek);
        end = new Date(start);
        end.setDate(end.getDate() + 4); // Friday of last week
        break;
      case "this_month":
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = now;
        break;
      case "last_month":
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0); // Last day of previous month
        break;
      default:
        return;
    }

    setStartDate(start.toISOString().split("T")[0]);
    setEndDate(end.toISOString().split("T")[0]);
  };

  // Get user summaries from the response
  const allUserSummaries = weeklyOverview?.userSummaries || [];

  // Get unique users for filter dropdown
  const uniqueUsers = React.useMemo(() => {
    return allUserSummaries.map(u => ({ id: u.userId, name: u.userName })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allUserSummaries]);

  // Filter user summaries based on selected person
  const userSummaries = selectedPerson === "all"
    ? allUserSummaries
    : allUserSummaries.filter(u => u.userId === selectedPerson);

  // Calculate totals based on filtered users
  const totals = React.useMemo(() => {
    if (!weeklyOverview) return null;
    if (selectedPerson === "all") return weeklyOverview.totals;

    // Recalculate totals for filtered user
    return {
      totalLogs: userSummaries.reduce((sum, u) => sum + u.daysLogged, 0),
      totalHours: userSummaries.reduce((sum, u) => sum + u.totalHours, 0),
      totalAccomplishments: userSummaries.reduce((sum, u) => sum + u.totalAccomplishments, 0),
      uniqueUsers: userSummaries.length,
    };
  }, [weeklyOverview, selectedPerson, userSummaries]);

  const formatDateRange = () => {
    const start = new Date(startDate + "T12:00:00");
    const end = new Date(endDate + "T12:00:00");
    return `${start.toLocaleDateString("en-US", { month: "long", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  };

  return (
    <div className="min-h-screen bg-slate-900 print:bg-white">
      {/* Controls - Hidden when printing */}
      <div className="print:hidden bg-slate-800 border-b border-slate-700 px-6 py-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Top Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <a
                href="/daily-log"
                className="text-slate-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </a>
              <h1 className="text-xl font-bold text-white">Daily Log Report</h1>
            </div>
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-cyan-500 text-white font-medium rounded-lg hover:bg-cyan-600 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print Report
            </button>
          </div>

          {/* Filters Row */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Date Range Presets */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm">Quick:</span>
              <div className="flex gap-1">
                {[
                  { id: "this_week", label: "This Week" },
                  { id: "last_week", label: "Last Week" },
                  { id: "this_month", label: "This Month" },
                  { id: "last_month", label: "Last Month" },
                ].map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => applyPreset(preset.id)}
                    className="px-3 py-1.5 text-xs bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 hover:text-white transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-6 w-px bg-slate-700"></div>

            {/* Custom Date Range */}
            <div className="flex items-center gap-2">
              <label className="text-slate-400 text-sm">From:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={endDate}
                className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-slate-400 text-sm">To:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                max={today}
                className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="h-6 w-px bg-slate-700"></div>

            {/* Person Filter */}
            <div className="flex items-center gap-2">
              <label className="text-slate-400 text-sm">Person:</label>
              <select
                value={selectedPerson}
                onChange={(e) => setSelectedPerson(e.target.value)}
                className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500"
              >
                <option value="all">All Team Members</option>
                {uniqueUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Report Content */}
      <div ref={reportRef} className="max-w-4xl mx-auto p-8 print:p-0 print:max-w-none">
        <div className="bg-white text-black rounded-xl print:rounded-none shadow-xl print:shadow-none">
          {/* Report Header */}
          <div className="p-8 border-b-2 border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Daily Activity Report</h1>
                <p className="text-gray-600 mt-1 text-lg">{formatDateRange()}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">Generated</p>
                <p className="font-medium text-gray-700">
                  {new Date().toLocaleDateString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          {totals && (
            <div className="p-8 border-b border-gray-200 bg-gray-50 print:bg-gray-100">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Summary</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center">
                  <p className="text-4xl font-bold text-blue-600">{totals.totalLogs}</p>
                  <p className="text-sm text-gray-600 mt-1">Logs Submitted</p>
                </div>
                <div className="text-center">
                  <p className="text-4xl font-bold text-green-600">{totals.totalHours.toFixed(1)}</p>
                  <p className="text-sm text-gray-600 mt-1">Hours Worked</p>
                </div>
                <div className="text-center">
                  <p className="text-4xl font-bold text-purple-600">{totals.totalAccomplishments}</p>
                  <p className="text-sm text-gray-600 mt-1">Accomplishments</p>
                </div>
                <div className="text-center">
                  <p className="text-4xl font-bold text-cyan-600">{totals.uniqueUsers}</p>
                  <p className="text-sm text-gray-600 mt-1">Team Members</p>
                </div>
              </div>
            </div>
          )}

          {/* Loading State */}
          {!weeklyOverview && (
            <div className="p-12 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
              <p className="text-gray-500 mt-4">Loading report data...</p>
            </div>
          )}

          {/* No Data State */}
          {weeklyOverview && userSummaries.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-gray-500">No daily logs submitted for this date range.</p>
            </div>
          )}

          {/* Per-User Breakdown */}
          {weeklyOverview && userSummaries.length > 0 && (
            <div className="p-8">
              <h2 className="text-lg font-semibold text-gray-800 mb-6">Individual Reports</h2>

              {userSummaries.map((userReport, idx) => (
                <div
                  key={userReport.userId}
                  className={`${idx > 0 ? "mt-8 pt-8 border-t border-gray-200" : ""}`}
                >
                  {/* User Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold">
                        {userReport.userName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2)}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{userReport.userName}</h3>
                        <p className="text-sm text-gray-500">
                          {userReport.daysLogged} day{userReport.daysLogged !== 1 ? "s" : ""} logged
                          {userReport.totalHours > 0 && ` • ${userReport.totalHours.toFixed(1)} hours`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-green-600">{userReport.totalAccomplishments}</p>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Accomplishments</p>
                    </div>
                  </div>

                  {/* Daily Logs */}
                  <div className="space-y-4 ml-13">
                    {userReport.logs
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((log) => (
                        <div key={log._id} className="bg-gray-50 rounded-lg p-4 print:bg-gray-100 daily-log-entry">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium text-gray-800">
                              {new Date(log.date + "T12:00:00").toLocaleDateString("en-US", {
                                weekday: "long",
                                month: "short",
                                day: "numeric",
                              })}
                            </p>
                            {log.hoursWorked && (
                              <span className="text-sm text-gray-600">{log.hoursWorked} hours</span>
                            )}
                          </div>

                          {/* Summary */}
                          {log.summary && (
                            <p className="text-gray-700 text-sm mb-3 whitespace-pre-wrap leading-relaxed">{log.summary}</p>
                          )}

                          {/* Accomplishments */}
                          {log.accomplishments && log.accomplishments.length > 0 && (
                            <div className="mb-3">
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                                Accomplishments
                              </p>
                              <ul className="space-y-1">
                                {log.accomplishments.map((acc, i) => (
                                  <li key={i} className="text-sm text-green-700 flex items-start gap-2">
                                    <span className="text-green-500 mt-0.5">✓</span>
                                    <span>{acc}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Goals for Tomorrow */}
                          {log.goalsForTomorrow && (
                            <div className="mb-2">
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                                Goals for Next Day
                              </p>
                              <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{log.goalsForTomorrow}</p>
                            </div>
                          )}

                          {/* Auto Activities */}
                          {log.autoActivities && log.autoActivities.totalActions > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-200">
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                                System-Tracked Activity
                              </p>
                              <div className="flex gap-4 text-xs text-gray-600">
                                {log.autoActivities.projectsCreated > 0 && (
                                  <span>{log.autoActivities.projectsCreated} projects created</span>
                                )}
                                {log.autoActivities.projectsMoved > 0 && (
                                  <span>{log.autoActivities.projectsMoved} projects moved</span>
                                )}
                                {log.autoActivities.tasksCompleted > 0 && (
                                  <span>{log.autoActivities.tasksCompleted} tasks completed</span>
                                )}
                                <span className="text-blue-600 font-medium">
                                  {log.autoActivities.totalActions} total actions
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Reviewer Notes */}
                          {log.reviewerComment && (
                            <div className="mt-3 pt-3 border-t border-gray-200">
                              <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-1">
                                Reviewer Notes
                              </p>
                              <p className="text-sm text-indigo-800 bg-indigo-50 rounded p-2 print:bg-indigo-100">
                                {log.reviewerComment}
                              </p>
                              {log.reviewerCommentByName && (
                                <p className="text-xs text-gray-500 mt-1 text-right">
                                  — {log.reviewerCommentByName}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>

                  {/* Blockers Section */}
                  {userReport.blockers.length > 0 && (
                    <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4 print:bg-amber-100">
                      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
                        Blockers / Challenges Reported
                      </p>
                      <ul className="space-y-1">
                        {userReport.blockers.map((blocker, i) => (
                          <li key={i} className="text-sm text-amber-800">
                            • {blocker}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Report Footer */}
          <div className="p-6 border-t border-gray-200 bg-gray-50 print:bg-gray-100 text-center">
            <p className="text-sm text-gray-500">
              IE Central Daily Activity Report • Generated by {user?.name || "System"}
            </p>
          </div>
        </div>
      </div>

      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          @page {
            margin: 0.5in;
            size: letter;
          }

          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .print\\:hidden {
            display: none !important;
          }

          .print\\:bg-white {
            background-color: white !important;
          }

          .print\\:bg-gray-100 {
            background-color: #f3f4f6 !important;
          }

          .print\\:bg-indigo-100 {
            background-color: #e0e7ff !important;
          }

          .print\\:rounded-none {
            border-radius: 0 !important;
          }

          .print\\:shadow-none {
            box-shadow: none !important;
          }

          .print\\:p-0 {
            padding: 0 !important;
          }

          .print\\:max-w-none {
            max-width: none !important;
          }

          /* Page break styles - each day fits on one page */
          .daily-log-entry {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          /* Prevent orphaned headers */
          h2, h3, h4 {
            page-break-after: avoid !important;
            break-after: avoid !important;
          }

          /* Keep user sections together when possible */
          .user-section {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>
    </div>
  );
}

export default function DailyLogReportPage() {
  return (
    <Protected>
      <ReportContent />
    </Protected>
  );
}
