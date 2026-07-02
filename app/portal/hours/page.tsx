"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Protected from "../../protected";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../../auth-context";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";

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

function HoursContent() {
  const router = useRouter();
  const { user, canAccessEmployeePortal } = useAuth();
  const personnelId = user?.personnelId;

  const [periodOffset, setPeriodOffset] = useState(0);

  // Get current pay period
  const payPeriod = useQuery(api.employeePortal.getCurrentPayPeriod);

  // Calculate the pay period based on offset
  const getPeriodDates = () => {
    if (!payPeriod) return { startDate: "", endDate: "" };

    const start = new Date(payPeriod.startDate);
    start.setDate(start.getDate() + periodOffset * 14);
    const end = new Date(start);
    end.setDate(end.getDate() + 13);

    return {
      startDate: start.toISOString().split("T")[0],
      endDate: end.toISOString().split("T")[0],
    };
  };

  const { startDate, endDate } = getPeriodDates();

  const hours = useQuery(
    api.employeePortal.getMyHours,
    personnelId && startDate ? { personnelId, startDate, endDate } : "skip"
  );

  if (!canAccessEmployeePortal) {
    router.push("/");
    return null;
  }

  if (!personnelId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f2f2f7] dark:bg-slate-900">
        <p className="theme-text-tertiary">Account not linked to personnel record.</p>
      </div>
    );
  }

  const startDateObj = startDate ? new Date(startDate + "T00:00:00") : new Date();
  const endDateObj = endDate ? new Date(endDate + "T00:00:00") : new Date();

  return (
    <div className="min-h-screen bg-[#f2f2f7] dark:bg-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur-sm border-b px-4 py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
        <div className="max-w-lg mx-auto flex items-center gap-4">
          <Link
            href="/portal"
            className="p-2 -ml-2 rounded-lg theme-text-primary hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold theme-text-primary">My Hours</h1>
            <p className="text-sm theme-text-tertiary">
              Pay Period: {startDateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" })} -{" "}
              {endDateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Period Navigation */}
        <div className="flex items-center justify-between">
          <Button variant="secondary" size="sm" onClick={() => setPeriodOffset((o) => o - 1)}>
            Previous
          </Button>
          {periodOffset !== 0 && (
            <Button variant="ghost" size="sm" onClick={() => setPeriodOffset(0)}>
              Current
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPeriodOffset((o) => o + 1)}
            disabled={periodOffset >= 0}
          >
            Next
          </Button>
        </div>

        {/* Summary Card */}
        <div className="bg-gradient-to-br from-[#007AFF]/10 to-indigo-500/10 border border-[#007AFF]/20 dark:border-[#007AFF]/30 rounded-2xl p-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-[#007AFF]">Total Hours</p>
              <p className="text-3xl font-bold theme-text-primary">
                {hours ? formatDuration(hours.totalHours) : "--"}
              </p>
            </div>
            <div>
              <p className="text-sm text-[#007AFF]">Days Worked</p>
              <p className="text-3xl font-bold theme-text-primary">
                {hours?.daysWorked || 0}
              </p>
            </div>
          </div>
          {hours && hours.totalBreakMinutes > 0 && (
            <p className="text-sm mt-4 theme-text-tertiary">
              Total break time: {Math.floor(hours.totalBreakMinutes / 60)}h {hours.totalBreakMinutes % 60}m
            </p>
          )}
        </div>

        {/* Daily Breakdown */}
        <div className="space-y-3">
          <SectionHeader title="Daily Breakdown" />

          {hours?.days && hours.days.length > 0 ? (
            hours.days.map((day) => (
              <Card key={day.date} padding="sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium theme-text-primary">
                    {new Date(day.date + "T00:00:00").toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span className="font-bold text-[#007AFF]">
                    {formatDuration(day.totalHours)}
                  </span>
                </div>
                <div className="text-sm theme-text-tertiary">
                  {day.clockIn && (
                    <span>In: {formatTime(day.clockIn)}</span>
                  )}
                  {day.clockOut && (
                    <span className="ml-4">Out: {formatTime(day.clockOut)}</span>
                  )}
                  {day.breakMinutes > 0 && (
                    <span className="ml-4">Break: {day.breakMinutes}m</span>
                  )}
                </div>
              </Card>
            ))
          ) : (
            <Card padding="md" className="text-center">
              <p className="theme-text-tertiary">No hours recorded for this pay period</p>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

export default function HoursPage() {
  return (
    <Protected>
      <HoursContent />
    </Protected>
  );
}
