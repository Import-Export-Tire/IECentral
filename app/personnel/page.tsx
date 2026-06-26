"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { isTemp } from "@/lib/tempEligibility";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/ui/StatusBadge";

function PersonnelContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const router = useRouter();
  const { user, canViewPersonnel, canManagePersonnel } = useAuth();

  // Redirect if user doesn't have personnel permission (respects overrides)
  useEffect(() => {
    if (user && !canViewPersonnel) {
      router.push("/");
    }
  }, [user, canViewPersonnel, router]);

  if (user && !canViewPersonnel) {
    return (
      <div className={`flex h-screen items-center justify-center ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
        <div className={`text-center ${isDark ? "text-slate-400" : "text-gray-500"}`}>
          <p>You do not have access to this page.</p>
          <p className="text-sm mt-2">Redirecting...</p>
        </div>
      </div>
    );
  }

  const personnel = useQuery(api.personnel.list, {}) || [];
  const departments = useQuery(api.personnel.getDepartments) || [];
  const locations = useQuery(api.locations.list) || [];
  const clockStatuses = useQuery(api.timeClock.getAllClockStatuses) || {};
  const updatePersonnel = useMutation(api.personnel.update);

  // Helper to get clock status indicator
  const getClockStatusIndicator = (personnelId: string) => {
    const status = clockStatuses[personnelId];
    if (!status || status.status === "not_clocked_in") {
      return { color: "bg-red-500", label: "Not clocked in", dotColor: "bg-red-500" };
    } else if (status.status === "clocked_in") {
      return { color: "bg-green-500", label: `Clocked in${status.hoursWorked ? ` (${status.hoursWorked}h)` : ""}`, dotColor: "bg-green-500" };
    } else if (status.status === "on_break") {
      return { color: "bg-amber-500", label: "On break", dotColor: "bg-amber-500" };
    } else if (status.status === "clocked_out") {
      return { color: "bg-slate-500", label: `Clocked out${status.hoursWorked ? ` (${status.hoursWorked}h)` : ""}`, dotColor: "bg-slate-500" };
    }
    return { color: "bg-red-500", label: "Not clocked in", dotColor: "bg-red-500" };
  };

  const [filterDepartment, setFilterDepartment] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("active"); // Default to active only
  const [searchTerm, setSearchTerm] = useState("");
  const [showTerminated, setShowTerminated] = useState(false);
  const [showTempsOnly, setShowTempsOnly] = useState(false);

  // Redirect if user doesn't have permission
  if (!canViewPersonnel) {
    return (
      <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
              Access Denied
            </h1>
            <p className={`mt-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              You don&apos;t have permission to view this page.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Separate active/on_leave personnel from terminated
  const activePersonnel = personnel.filter((p) => p.status !== "terminated");
  const terminatedPersonnel = personnel.filter((p) => p.status === "terminated");

  const filteredPersonnel = activePersonnel.filter((person) => {
    const matchesDepartment =
      filterDepartment === "all" || person.department === filterDepartment;
    const matchesStatus =
      filterStatus === "all" || person.status === filterStatus;
    const matchesSearch =
      searchTerm === "" ||
      `${person.firstName} ${person.lastName}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      person.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      person.position.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTempsOnly = !showTempsOnly || isTemp(person.employeeType);
    return matchesDepartment && matchesStatus && matchesSearch && matchesTempsOnly;
  });

  // Filter terminated personnel by search term
  const filteredTerminated = terminatedPersonnel.filter((person) => {
    const matchesSearch =
      searchTerm === "" ||
      `${person.firstName} ${person.lastName}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      person.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      person.position.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  // Calculate stats
  const stats = {
    total: personnel.length,
    active: personnel.filter((p) => p.status === "active" && p.employeeType !== "temp").length,
    onLeave: personnel.filter((p) => p.status === "on_leave").length,
    terminated: personnel.filter((p) => p.status === "terminated").length,
  };

  return (
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Mobile Header */}
        <MobileHeader />

        {/* Header */}
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Personnel</h1>
              <p className="text-xs sm:text-sm mt-1 hidden sm:block theme-text-tertiary">
                Manage employees and their records
              </p>
            </div>
            {canManagePersonnel && (
              <div className="flex gap-2 flex-shrink-0">
                <Button
                  variant="ghost"
                  onClick={() => router.push("/reports/ninety-day-reviews")}
                  title="90-day & annual performance reviews"
                >
                  Reviews
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => router.push("/personnel/import")}
                  title="Bulk upload personnel from an XLSX file"
                >
                  <span className="hidden sm:inline">Import XLSX</span>
                  <span className="sm:hidden">Import</span>
                </Button>
                <Button
                  variant="primary"
                  onClick={() => router.push("/personnel/new")}
                >
                  <span className="hidden sm:inline">Add Employee</span>
                  <span className="sm:hidden">Add</span>
                </Button>
              </div>
            )}
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
            <div className="theme-card p-4 text-center">
              <p className="text-lg sm:text-2xl font-bold theme-text-primary">{stats.total}</p>
              <p className="text-[10px] sm:text-xs theme-text-tertiary">Total</p>
            </div>
            <div className="theme-card p-4 text-center">
              <p className="text-lg sm:text-2xl font-bold text-green-500">{stats.active}</p>
              <p className="text-[10px] sm:text-xs theme-text-tertiary">Active</p>
            </div>
            <div className="theme-card p-4 text-center">
              <p className="text-lg sm:text-2xl font-bold text-amber-500">{stats.onLeave}</p>
              <p className="text-[10px] sm:text-xs theme-text-tertiary">On Leave</p>
            </div>
            <div className="theme-card p-4 text-center">
              <p className="text-lg sm:text-2xl font-bold text-red-500">{stats.terminated}</p>
              <p className="text-[10px] sm:text-xs theme-text-tertiary">Terminated</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search name, email, or position..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="theme-input w-full px-3 sm:px-4 py-2 text-sm sm:text-base"
              />
            </div>
            <div className="flex gap-2 sm:gap-4">
              <select
                value={filterDepartment}
                onChange={(e) => setFilterDepartment(e.target.value)}
                className="theme-input flex-1 sm:flex-initial px-3 sm:px-4 py-2 text-sm sm:text-base"
              >
                <option value="all">All Depts</option>
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
                <option value="all">All Active</option>
                <option value="active">Active</option>
                <option value="on_leave">On Leave</option>
              </select>
              <button
                onClick={() => setShowTempsOnly((v) => !v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${showTempsOnly ? "bg-amber-500 text-white" : isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
              >
                Temps only
              </button>
            </div>
          </div>

          {/* Personnel Table */}
          <div className="theme-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={`border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                    <th className="text-left px-6 py-4 text-sm font-medium theme-text-tertiary">
                      Employee
                    </th>
                    <th className="text-left px-6 py-4 text-sm font-medium theme-text-tertiary">
                      Position
                    </th>
                    <th className="text-left px-6 py-4 text-sm font-medium theme-text-tertiary">
                      Department
                    </th>
                    <th className="text-left px-6 py-4 text-sm font-medium theme-text-tertiary">
                      Location
                    </th>
                    <th className="text-left px-6 py-4 text-sm font-medium theme-text-tertiary">
                      Status
                    </th>
                    <th className="text-center px-6 py-4 text-sm font-medium theme-text-tertiary">
                      Clock
                    </th>
                    <th className="text-left px-6 py-4 text-sm font-medium theme-text-tertiary">
                      Hire Date
                    </th>
                    <th className="text-right px-6 py-4 text-sm font-medium theme-text-tertiary">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPersonnel.map((person) => (
                    <tr
                      key={person._id}
                      className={`border-b cursor-pointer ${isDark ? "border-slate-700/50 hover:bg-slate-700/20" : "border-gray-200 hover:bg-gray-50"}`}
                      onClick={() => router.push(`/personnel/${person._id}`)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold ${isDark ? "bg-gradient-to-br from-cyan-400 to-blue-500" : "bg-gradient-to-br from-blue-500 to-blue-600"}`}>
                            {person.firstName.charAt(0)}{person.lastName.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium theme-text-primary">
                              {person.firstName} {person.lastName}
                            </p>
                            <p className="text-sm theme-text-tertiary">{person.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 theme-text-secondary">
                        {person.position}
                      </td>
                      <td className="px-6 py-4 theme-text-secondary">
                        {person.department}
                      </td>
                      <td className="px-6 py-4">
                        <select
                          value={person.locationId || ""}
                          onClick={(e) => e.stopPropagation()}
                          onChange={async (e) => {
                            e.stopPropagation();
                            const newLocationId = e.target.value;
                            try {
                              if (!user) throw new Error("Not signed in");
                              await updatePersonnel({
                                personnelId: person._id,
                                locationId: newLocationId as Id<"locations">,
                                requestingUserId: user._id,
                              });
                            } catch (error) {
                              console.error("Failed to update location:", error);
                            }
                          }}
                          className="theme-input px-2 py-1 text-sm cursor-pointer"
                        >
                          <option value="">No Location</option>
                          {locations.map((loc) => (
                            <option key={loc._id} value={loc._id}>
                              {loc.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge status={person.status} kind="personnel" />
                          {isTemp(person.employeeType) && (
                            <span className="ui-badge ui-badge-amber">Temp</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {person.status === "active" && (
                          <div className="flex items-center justify-center" title={getClockStatusIndicator(person._id).label}>
                            <div className="relative">
                              <span className={`inline-block w-3 h-3 rounded-full ${getClockStatusIndicator(person._id).dotColor}`}></span>
                              {(clockStatuses[person._id]?.status === "clocked_in" || clockStatuses[person._id]?.status === "on_break") && (
                                <span className={`absolute inset-0 rounded-full animate-ping opacity-75 ${getClockStatusIndicator(person._id).dotColor}`}></span>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm theme-text-tertiary">
                        {new Date(person.hireDate).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/personnel/${person._id}`);
                          }}
                        >
                          View Profile
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredPersonnel.length === 0 && (
                <div className="text-center py-12">
                  <p className="theme-text-tertiary">
                    {activePersonnel.length === 0
                      ? "No active personnel records yet. Hire applicants from the Applications page."
                      : "No personnel found matching your filters."}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Terminated Employees Section (Collapsible) */}
          {terminatedPersonnel.length > 0 && (
            <div className={`rounded-xl overflow-hidden border ${isDark ? "bg-slate-800/20 border-slate-700" : "bg-gray-50/80 border-gray-200"}`}>
              <button
                onClick={() => setShowTerminated(!showTerminated)}
                className={`w-full px-6 py-4 flex items-center justify-between ${isDark ? "hover:bg-slate-700/20" : "hover:bg-gray-100"}`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium theme-text-secondary">
                    Terminated Employees ({filteredTerminated.length})
                  </span>
                  <span className="ui-badge ui-badge-red">Archived</span>
                </div>
                <svg
                  className={`w-5 h-5 transition-transform theme-text-tertiary ${showTerminated ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showTerminated && (
                <div className={`border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                  <table className="w-full">
                    <thead>
                      <tr className={`border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                        <th className="text-left px-6 py-3 text-xs font-medium theme-text-tertiary">
                          Employee
                        </th>
                        <th className="text-left px-6 py-3 text-xs font-medium theme-text-tertiary">
                          Position
                        </th>
                        <th className="text-left px-6 py-3 text-xs font-medium theme-text-tertiary">
                          Department
                        </th>
                        <th className="text-left px-6 py-3 text-xs font-medium theme-text-tertiary">
                          Termination Date
                        </th>
                        <th className="text-right px-6 py-3 text-xs font-medium theme-text-tertiary">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTerminated.map((person) => (
                        <tr
                          key={person._id}
                          className={`border-b cursor-pointer ${isDark ? "border-slate-700/30 hover:bg-slate-700/10" : "border-gray-100 hover:bg-gray-100/70"}`}
                          onClick={() => router.push(`/personnel/${person._id}`)}
                        >
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold ${isDark ? "bg-slate-600" : "bg-gray-400"}`}>
                                {person.firstName.charAt(0)}{person.lastName.charAt(0)}
                              </div>
                              <div>
                                <p className="text-sm font-medium theme-text-secondary">
                                  {person.firstName} {person.lastName}
                                </p>
                                <p className="text-xs theme-text-tertiary">{person.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-3 text-sm theme-text-secondary">
                            {person.position}
                          </td>
                          <td className="px-6 py-3 text-sm theme-text-secondary">
                            {person.department}
                          </td>
                          <td className="px-6 py-3 text-sm theme-text-secondary">
                            {person.terminationDate
                              ? new Date(person.terminationDate).toLocaleDateString()
                              : "N/A"}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/personnel/${person._id}`);
                              }}
                            >
                              View Record
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {filteredTerminated.length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-sm theme-text-tertiary">
                        No terminated employees match your search.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function PersonnelPage() {
  return (
    <Protected minTier={2}>
      <PersonnelContent />
    </Protected>
  );
}
