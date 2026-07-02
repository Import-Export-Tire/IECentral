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

function ScheduleContent() {
  const router = useRouter();
  const { user, canAccessEmployeePortal } = useAuth();
  const personnelId = user?.personnelId;

  // Date range - current week and next week
  const [weekOffset, setWeekOffset] = useState(0);

  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay() + weekOffset * 7);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  const startDate = startOfWeek.toISOString().split("T")[0];
  const endDate = endOfWeek.toISOString().split("T")[0];

  const schedule = useQuery(
    api.employeePortal.getMySchedule,
    personnelId ? { personnelId, startDate, endDate } : "skip"
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

  // Loading state — schedule is undefined while the query is in flight
  if (schedule === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f2f2f7] dark:bg-slate-900">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-t-transparent border-[#007AFF] rounded-full animate-spin" />
          <p className="theme-text-tertiary">Loading schedule...</p>
        </div>
      </div>
    );
  }

  // Error state — query returned null
  if (schedule === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f2f2f7] dark:bg-slate-900">
        <div className="flex flex-col items-center gap-3">
          <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="font-medium text-red-500 dark:text-red-400">Failed to load schedule</p>
          <p className="text-sm theme-text-tertiary">Please try again later.</p>
        </div>
      </div>
    );
  }

  // Generate days of the week
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    days.push({
      date: date.toISOString().split("T")[0],
      dayName: date.toLocaleDateString("en-US", { weekday: "short" }),
      dayNum: date.getDate(),
      isToday: date.toISOString().split("T")[0] === today.toISOString().split("T")[0],
    });
  }

  const getShiftsForDay = (date: string) => {
    return schedule?.filter((s) => s.date === date) || [];
  };

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
            <h1 className="text-xl font-bold theme-text-primary">My Schedule</h1>
            <p className="text-sm theme-text-tertiary">
              {startOfWeek.toLocaleDateString("en-US", { month: "short", day: "numeric" })} -{" "}
              {endOfWeek.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Week Navigation */}
        <div className="flex items-center justify-between">
          <Button variant="secondary" size="sm" onClick={() => setWeekOffset((o) => o - 1)}>
            Previous
          </Button>
          {weekOffset !== 0 && (
            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>
              This Week
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setWeekOffset((o) => o + 1)}>
            Next
          </Button>
        </div>

        {/* Schedule Grid */}
        <div className="space-y-3">
          <SectionHeader title="Schedule" />
          {days.map((day) => {
            const shifts = getShiftsForDay(day.date);
            return (
              <Card
                key={day.date}
                padding="sm"
                tone={day.isToday ? "accent" : "default"}
                className={day.isToday ? "border border-[#007AFF]/30 bg-[#007AFF]/5 dark:bg-[#007AFF]/10" : ""}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold theme-text-primary">{day.dayName}</span>
                    <span className="text-sm theme-text-tertiary">{day.dayNum}</span>
                  </div>
                  {day.isToday && (
                    <span className="ui-badge ui-badge-blue text-xs">Today</span>
                  )}
                </div>

                {shifts.length > 0 ? (
                  <div className="space-y-2">
                    {shifts.map((shift) => (
                      <div
                        key={shift._id}
                        className="p-3 rounded-lg bg-[#f2f2f7] dark:bg-slate-700/50"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium theme-text-primary">{shift.department}</span>
                          {shift.isLead && (
                            <span className="ui-badge ui-badge-amber text-xs">Lead</span>
                          )}
                        </div>
                        <p className="text-sm mt-1 theme-text-tertiary">
                          {shift.startTime} - {shift.endTime}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm theme-text-tertiary">No shift scheduled</p>
                )}
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}

export default function SchedulePage() {
  return (
    <Protected>
      <ScheduleContent />
    </Protected>
  );
}
