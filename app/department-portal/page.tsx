"use client";

import { useState, useMemo } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../auth-context";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function DepartmentPortalContent() {
  const { user, canAccessDepartmentPortal } = useAuth();

  const [selectedDate, setSelectedDate] = useState(() => formatDate(new Date()));

  // Parse selected date
  const currentDate = useMemo(() => new Date(selectedDate + "T12:00:00"), [selectedDate]);
  const isToday = formatDate(new Date()) === selectedDate;

  // Get user's managed departments
  const managedDepartments = user?.managedDepartments || [];

  // Queries
  const shifts = useQuery(api.shifts.listByDate, { date: selectedDate }) || [];
  const dailyTasks = useQuery(api.shifts.getDailyTasksByDate, { date: selectedDate }) || {};
  const locations = useQuery(api.locations.list) || [];
  const clockStatuses = useQuery(api.timeClock.getAllClockStatuses) || {};

  // Helper to get clock status indicator
  const getClockStatusIndicator = (personnelId: string) => {
    const status = clockStatuses[personnelId];
    if (!status || status.status === "not_clocked_in") {
      return { color: "bg-red-500", label: "Not clocked in" };
    } else if (status.status === "clocked_in") {
      return { color: "bg-green-500", label: `Clocked in${status.hoursWorked ? ` (${status.hoursWorked}h)` : ""}` };
    } else if (status.status === "on_break") {
      return { color: "bg-amber-500", label: "On break" };
    } else if (status.status === "clocked_out") {
      return { color: "bg-slate-500", label: `Clocked out${status.hoursWorked ? ` (${status.hoursWorked}h)` : ""}` };
    }
    return { color: "bg-red-500", label: "Not clocked in" };
  };

  // Toggle task mutation
  const toggleDailyTask = useMutation(api.shifts.toggleDailyTaskComplete);

  // Filter shifts to only managed departments
  const myDepartmentShifts = useMemo(() => {
    if (managedDepartments.length === 0) return shifts;
    return shifts.filter(s => managedDepartments.includes(s.department));
  }, [shifts, managedDepartments]);

  // Get warehouse manager info (from first location for now)
  const warehouseManager = useMemo(() => {
    const loc = locations.find(l => l.warehouseManagerName);
    return loc ? {
      name: loc.warehouseManagerName,
      phone: loc.warehouseManagerPhone,
      email: loc.warehouseManagerEmail,
    } : null;
  }, [locations]);

  // Navigate dates
  const goToPreviousDay = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(formatDate(newDate));
  };

  const goToNextDay = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + 1);
    setSelectedDate(formatDate(newDate));
  };

  const goToToday = () => {
    setSelectedDate(formatDate(new Date()));
  };

  // Handle task toggle
  const handleToggleTask = async (department: string, taskId: string) => {
    try {
      await toggleDailyTask({
        date: selectedDate,
        department,
        taskId,
      });
    } catch (error) {
      console.error("Failed to toggle task:", error);
    }
  };

  // Permission check
  if (!canAccessDepartmentPortal) {
    return (
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold theme-text-primary">
              Access Denied
            </h1>
            <p className="mt-2 theme-text-secondary">
              This portal is only available to department managers.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 overflow-hidden flex flex-col">
        <MobileHeader />
        {/* Header */}
        <header className="flex-shrink-0 border-b px-4 sm:px-8 py-3 sm:py-4 bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold truncate theme-text-primary">
                Department Portal
              </h1>
              <p className="text-xs sm:text-sm mt-1 theme-text-tertiary">
                {managedDepartments.length > 0
                  ? `Managing: ${managedDepartments.join(", ")}`
                  : "View your department assignments and tasks"}
              </p>
            </div>
          </div>

          {/* Date Navigation */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-3 sm:mt-4">
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={goToPreviousDay}
                className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-gray-100 dark:hover:bg-slate-700"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <Button
                variant={isToday ? "primary" : "ghost"}
                size="sm"
                onClick={goToToday}
              >
                Today
              </Button>
              <button
                onClick={goToNextDay}
                className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-gray-100 dark:hover:bg-slate-700"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="theme-input px-3 sm:px-4 py-1.5 sm:py-2 text-sm sm:text-base"
            />

            <span className="text-sm sm:text-lg font-semibold hidden sm:inline theme-text-primary">
              {formatDisplayDate(currentDate)}
            </span>

            {isToday && (
              <span className="hidden sm:inline ui-badge ui-badge-blue">
                Today
              </span>
            )}
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          {/* Warehouse Manager Contact */}
          {warehouseManager && (
            <Card padding="sm" className="mb-6">
              <h2 className="text-sm font-medium mb-2 theme-text-tertiary ui-section-label">
                Warehouse Manager
              </h2>
              <div className="flex flex-wrap items-center gap-4">
                <span className="font-semibold theme-text-primary">
                  {warehouseManager.name}
                </span>
                {warehouseManager.phone && (
                  <a
                    href={`tel:${warehouseManager.phone}`}
                    className="flex items-center gap-1 text-sm text-[#007AFF]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    {warehouseManager.phone}
                  </a>
                )}
                {warehouseManager.email && (
                  <a
                    href={`mailto:${warehouseManager.email}`}
                    className="flex items-center gap-1 text-sm text-[#007AFF]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {warehouseManager.email}
                  </a>
                )}
              </div>
            </Card>
          )}

          {/* Department Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {myDepartmentShifts.map((shift) => {
              const deptTasks = dailyTasks[shift.department] || [];

              return (
                <Card key={shift._id} padding="sm" className="overflow-hidden p-0">
                  {/* Department Header */}
                  <div className="p-4 border-b theme-border-secondary bg-gray-50 dark:bg-slate-800">
                    <h3 className="font-bold text-xl theme-text-primary">
                      {shift.department}
                    </h3>
                    <p className="text-sm mt-1 theme-text-tertiary">
                      {shift.assignedPersonnel.length + (shift.leadId ? 1 : 0)} team members today
                    </p>
                  </div>

                  {/* Lead Section */}
                  {shift.leadName && shift.leadId && (
                    <div className="p-4 border-b theme-border-secondary">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                        <span className="text-sm font-medium text-amber-500 dark:text-amber-400">
                          Department Lead
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Clock status indicator for lead — data-driven color kept */}
                        <div className="relative" title={getClockStatusIndicator(shift.leadId).label}>
                          <span className={`inline-block w-3 h-3 rounded-full ${getClockStatusIndicator(shift.leadId).color}`}></span>
                          {(clockStatuses[shift.leadId]?.status === "clocked_in" || clockStatuses[shift.leadId]?.status === "on_break") && (
                            <span className={`absolute inset-0 rounded-full animate-ping opacity-75 ${getClockStatusIndicator(shift.leadId).color}`}></span>
                          )}
                        </div>
                        <p className="font-semibold text-lg text-amber-700 dark:text-amber-300">
                          {shift.leadName}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Daily Tasks Section */}
                  <div className="p-4 border-b theme-border-secondary">
                    <div className="flex items-center gap-2 mb-3">
                      <svg className="w-5 h-5 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                      <span className="font-medium text-green-600 dark:text-green-400">
                        Today&apos;s Goals
                      </span>
                    </div>

                    {deptTasks.length > 0 ? (
                      <div className="space-y-2">
                        {deptTasks.map((task: { id: string; text: string; completed?: boolean }) => (
                          <div
                            key={task.id}
                            className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-slate-700/50"
                          >
                            <button
                              onClick={() => handleToggleTask(shift.department, task.id)}
                              className={`flex-shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${
                                task.completed
                                  ? "bg-green-500 border-green-500"
                                  : "border-gray-300 dark:border-slate-500 hover:border-green-500"
                              }`}
                            >
                              {task.completed && (
                                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                            <span className={`flex-1 ${
                              task.completed
                                ? "theme-text-tertiary line-through"
                                : "theme-text-primary"
                            }`}>
                              {task.text}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm theme-text-tertiary">
                        No tasks assigned for today
                      </p>
                    )}
                  </div>

                  {/* Crew Section */}
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <svg className="w-5 h-5 text-blue-500 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <span className="font-medium text-blue-600 dark:text-blue-400">
                        Your Crew Today
                      </span>
                    </div>

                    {shift.assignedNames.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {shift.assignedNames.map((name, idx) => {
                          const personnelId = shift.assignedPersonnel[idx];
                          const statusInfo = getClockStatusIndicator(personnelId);
                          return (
                            <div
                              key={personnelId}
                              className="p-3 rounded-xl flex items-center gap-3 bg-gray-50 dark:bg-slate-700/50"
                              title={statusInfo.label}
                            >
                              {/* Clock status dot — data-driven color kept */}
                              <div className="relative flex-shrink-0">
                                <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusInfo.color}`}></span>
                                {(clockStatuses[personnelId]?.status === "clocked_in" || clockStatuses[personnelId]?.status === "on_break") && (
                                  <span className={`absolute inset-0 rounded-full animate-ping opacity-75 ${statusInfo.color}`}></span>
                                )}
                              </div>
                              <span className="theme-text-primary">
                                {name}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm theme-text-tertiary">
                        No crew assigned for today
                      </p>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {myDepartmentShifts.length === 0 && (
            <div className="text-center py-16 theme-text-tertiary">
              <svg
                className="w-16 h-16 mx-auto mb-4 opacity-50"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
              <h3 className="text-lg font-medium mb-2 theme-text-secondary">
                No shifts for today
              </h3>
              <p className="text-sm">
                {managedDepartments.length > 0
                  ? "No shifts have been created for your departments today."
                  : "Contact your admin to assign you to a department."}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function DepartmentPortalPage() {
  return (
    <Protected>
      <DepartmentPortalContent />
    </Protected>
  );
}
