"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Protected from "../protected";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../auth-context";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

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
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function EmployeePortalContent() {
  const router = useRouter();
  const { user, isEmployee, canAccessEmployeePortal } = useAuth();
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update current time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Get personnel record linked to this user
  const personnelId = user?.personnelId;

  // Queries
  const clockStatus = useQuery(
    api.timeClock.getCurrentStatus,
    personnelId ? { personnelId } : "skip"
  );
  const shifts = useQuery(api.shifts.listByDate, {
    date: new Date().toISOString().split("T")[0],
  });

  // Mutations
  const clockIn = useMutation(api.timeClock.clockIn);
  const clockOut = useMutation(api.timeClock.clockOut);
  const startBreak = useMutation(api.timeClock.startBreak);
  const endBreak = useMutation(api.timeClock.endBreak);

  const [isClocking, setIsClocking] = useState(false);
  const [clockError, setClockError] = useState<string | null>(null);

  // Redirect non-employees to main dashboard
  if (!canAccessEmployeePortal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f2f2f7] dark:bg-slate-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2 theme-text-primary">
            Access Denied
          </h1>
          <p className="mb-4 theme-text-secondary">
            This portal is only available to employees.
          </p>
          <Button variant="primary" onClick={() => router.push("/")}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (!personnelId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f2f2f7] dark:bg-slate-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2 theme-text-primary">
            Account Not Linked
          </h1>
          <p className="theme-text-secondary">
            Your account is not linked to a personnel record. Please contact your administrator.
          </p>
        </div>
      </div>
    );
  }

  const handleClockIn = async () => {
    setIsClocking(true);
    setClockError(null);
    try {
      await clockIn({
        personnelId,
        source: "employee_portal",
      });
    } catch (error) {
      setClockError(error instanceof Error ? error.message : "Failed to clock in");
    }
    setIsClocking(false);
  };

  const handleClockOut = async () => {
    setIsClocking(true);
    setClockError(null);
    try {
      await clockOut({
        personnelId,
        source: "employee_portal",
      });
    } catch (error) {
      setClockError(error instanceof Error ? error.message : "Failed to clock out");
    }
    setIsClocking(false);
  };

  const handleStartBreak = async () => {
    setIsClocking(true);
    setClockError(null);
    try {
      await startBreak({
        personnelId,
        source: "employee_portal",
      });
    } catch (error) {
      setClockError(error instanceof Error ? error.message : "Failed to start break");
    }
    setIsClocking(false);
  };

  const handleEndBreak = async () => {
    setIsClocking(true);
    setClockError(null);
    try {
      await endBreak({
        personnelId,
        source: "employee_portal",
      });
    } catch (error) {
      setClockError(error instanceof Error ? error.message : "Failed to end break");
    }
    setIsClocking(false);
  };

  // Find today's shift for this employee
  const myShift = shifts?.find(
    (s) => s.assignedPersonnel.includes(personnelId) || s.leadId === personnelId
  );

  const status = clockStatus?.status || "not_clocked_in";
  const hoursWorked = clockStatus?.hoursWorked || 0;

  return (
    <div className="min-h-screen bg-[#f2f2f7] dark:bg-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur-sm border-b px-4 py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold theme-text-primary">
              IE Central
            </h1>
            <p className="text-sm theme-text-tertiary">
              Employee Portal
            </p>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem("ie_central_user_id");
              window.location.href = "/login";
            }}
            className="p-2 rounded-lg theme-text-tertiary hover:theme-text-primary hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Welcome Card */}
        <div className="bg-gradient-to-br from-[#007AFF]/10 to-indigo-500/10 border border-[#007AFF]/20 dark:border-[#007AFF]/30 rounded-2xl p-6">
          <p className="text-sm text-[#007AFF]">Welcome back</p>
          <h2 className="text-2xl font-bold mt-1 theme-text-primary">
            {user?.name}
          </h2>
          <p className="text-4xl font-mono mt-4 theme-text-primary">
            {currentTime.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
              hour12: true,
            })}
          </p>
          <p className="text-sm mt-1 theme-text-tertiary">
            {currentTime.toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        {/* Clock Status & Actions */}
        <Card padding="md">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-sm theme-text-tertiary">Status</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`w-3 h-3 rounded-full ${
                  status === "clocked_in" ? "bg-green-500" :
                  status === "on_break" ? "bg-amber-500" :
                  status === "clocked_out" ? "bg-slate-500" :
                  "bg-red-500"
                }`}></span>
                <span className="font-semibold theme-text-primary">
                  {status === "clocked_in" ? "Clocked In" :
                   status === "on_break" ? "On Break" :
                   status === "clocked_out" ? "Clocked Out" :
                   "Not Clocked In"}
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm theme-text-tertiary">Hours Today</p>
              <p className="text-2xl font-bold mt-1 theme-text-primary">
                {formatDuration(hoursWorked)}
              </p>
            </div>
          </div>

          {clockError && (
            <div className="mb-4 p-3 rounded-lg ui-callout-red text-sm">
              {clockError}
            </div>
          )}

          {/* Clock Actions */}
          <div className="grid grid-cols-2 gap-3">
            {status === "not_clocked_in" && (
              <button
                onClick={handleClockIn}
                disabled={isClocking}
                className="col-span-2 w-full py-4 rounded-xl font-semibold text-white bg-green-500 hover:bg-green-600 disabled:opacity-50 transition-colors"
              >
                {isClocking ? "Clocking In..." : "Clock In"}
              </button>
            )}

            {status === "clocked_in" && (
              <>
                <button
                  onClick={handleStartBreak}
                  disabled={isClocking}
                  className="py-4 rounded-xl font-semibold transition-colors bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-400 dark:hover:bg-amber-500/30"
                >
                  Start Break
                </button>
                <button
                  onClick={handleClockOut}
                  disabled={isClocking}
                  className="py-4 rounded-xl font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  Clock Out
                </button>
              </>
            )}

            {status === "on_break" && (
              <button
                onClick={handleEndBreak}
                disabled={isClocking}
                className="col-span-2 w-full py-4 rounded-xl font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {isClocking ? "Ending Break..." : "End Break"}
              </button>
            )}

            {status === "clocked_out" && (
              <div className="col-span-2 text-center py-4">
                <p className="theme-text-tertiary">
                  You&apos;re done for today!
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Today's Schedule */}
        {myShift && (
          <Card padding="md">
            <h3 className="font-semibold mb-3 theme-text-primary">
              Today&apos;s Schedule
            </h3>
            <div className="p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-700/50">
              <p className="font-medium theme-text-primary">
                {myShift.department}
              </p>
              <p className="text-sm mt-1 theme-text-tertiary">
                {myShift.startTime} - {myShift.endTime}
              </p>
              {myShift.leadId === personnelId && (
                <span className="inline-block mt-2 px-2 py-1 text-xs rounded-full ui-badge ui-badge-amber">
                  Department Lead
                </span>
              )}
            </div>
          </Card>
        )}

        {/* Quick Links */}
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/portal/schedule"
            className="theme-card hover:bg-gray-50 dark:hover:bg-slate-700/60 rounded-xl p-4 text-center transition-colors"
          >
            <svg className="w-8 h-8 mx-auto mb-2 text-[#007AFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-sm font-medium theme-text-primary">Schedule</span>
          </Link>

          <Link
            href="/portal/hours"
            className="theme-card hover:bg-gray-50 dark:hover:bg-slate-700/60 rounded-xl p-4 text-center transition-colors"
          >
            <svg className="w-8 h-8 mx-auto mb-2 text-[#007AFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium theme-text-primary">My Hours</span>
          </Link>

          <Link
            href="/portal/time-off"
            className="theme-card hover:bg-gray-50 dark:hover:bg-slate-700/60 rounded-xl p-4 text-center transition-colors"
          >
            <svg className="w-8 h-8 mx-auto mb-2 text-[#007AFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
            </svg>
            <span className="text-sm font-medium theme-text-primary">Time Off</span>
          </Link>

          <Link
            href="/portal/call-off"
            className="theme-card hover:bg-gray-50 dark:hover:bg-slate-700/60 rounded-xl p-4 text-center transition-colors"
          >
            <svg className="w-8 h-8 mx-auto mb-2 text-[#007AFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            <span className="text-sm font-medium theme-text-primary">Call Off</span>
          </Link>

          <Link
            href="/portal/paystubs"
            className="theme-card hover:bg-gray-50 dark:hover:bg-slate-700/60 rounded-xl p-4 text-center transition-colors"
          >
            <svg className="w-8 h-8 mx-auto mb-2 text-[#007AFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-sm font-medium theme-text-primary">Paystubs</span>
          </Link>

          <Link
            href="/portal/corrections"
            className="theme-card hover:bg-gray-50 dark:hover:bg-slate-700/60 rounded-xl p-4 text-center transition-colors"
          >
            <svg className="w-8 h-8 mx-auto mb-2 text-[#007AFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span className="text-sm font-medium theme-text-primary">Corrections</span>
          </Link>

          <Link
            href="/portal/documents"
            className="theme-card hover:bg-gray-50 dark:hover:bg-slate-700/60 rounded-xl p-4 text-center transition-colors"
          >
            <svg className="w-8 h-8 mx-auto mb-2 text-[#007AFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span className="text-sm font-medium theme-text-primary">Documents</span>
          </Link>
        </div>
      </main>
    </div>
  );
}

export default function EmployeePortalPage() {
  return (
    <Protected>
      <EmployeePortalContent />
    </Protected>
  );
}
