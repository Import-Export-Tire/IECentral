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

const STATUS_OPTIONS = [
  { value: "active", label: "Active", color: "green" },
  { value: "on_leave", label: "On Leave", color: "amber" },
  { value: "terminated", label: "Terminated", color: "red" },
];

const statusColors: Record<string, string> = {
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  on_leave: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  terminated: "bg-red-500/20 text-red-400 border-red-500/30",
};

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

  // Helper to get location name
  const getLocationName = (locationId: string | undefined) => {
    if (!locationId) return "—";
    const location = locations.find(l => l._id === locationId);
    return location?.name || "—";
  };

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
    return matchesDepartment && matchesStatus && matchesSearch;
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
    active: personnel.filter((p) => p.status === "active").length,
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
              <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Personnel</h1>
              <p className={`text-xs sm:text-sm mt-1 hidden sm:block ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Manage employees and their records
              </p>
            </div>
            {canManagePersonnel && (
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => router.push("/reports/ninety-day-reviews")}
                  className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition-colors ${
                    isDark
                      ? "bg-orange-500/20 hover:bg-orange-500/30 text-orange-300"
                      : "bg-orange-100 hover:bg-orange-200 text-orange-700"
                  }`}
                  title="90-day & annual performance reviews"
                >
                  Reviews
                </button>
                <button
                  onClick={() => router.push("/personnel/import")}
                  className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition-colors ${
                    isDark
                      ? "bg-slate-700 hover:bg-slate-600 text-slate-200"
                      : "bg-gray-200 hover:bg-gray-300 text-gray-800"
                  }`}
                  title="Bulk upload personnel from an XLSX file"
                >
                  <span className="hidden sm:inline">Import XLSX</span>
                  <span className="sm:hidden">Import</span>
                </button>
                <button
                  onClick={() => router.push("/personnel/new")}
                  className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition-colors ${
                    isDark
                      ? "bg-cyan-500 hover:bg-cyan-400 text-white"
                      : "bg-blue-600 hover:bg-blue-700 text-white"
                  }`}
                >
                  <span className="hidden sm:inline">Add Employee</span>
                  <span className="sm:hidden">Add</span>
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
            <div className={`rounded-lg p-2 sm:p-4 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <p className={`text-lg sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{stats.total}</p>
              <p className={`text-[10px] sm:text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>Total</p>
            </div>
            <div className={`rounded-lg p-2 sm:p-4 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <p className={`text-lg sm:text-2xl font-bold text-green-400`}>{stats.active}</p>
              <p className={`text-[10px] sm:text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>Active</p>
            </div>
            <div className={`rounded-lg p-2 sm:p-4 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <p className={`text-lg sm:text-2xl font-bold text-amber-400`}>{stats.onLeave}</p>
              <p className={`text-[10px] sm:text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>On Leave</p>
            </div>
            <div className={`rounded-lg p-2 sm:p-4 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <p className={`text-lg sm:text-2xl font-bold text-red-400`}>{stats.terminated}</p>
              <p className={`text-[10px] sm:text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>Terminated</p>
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
                className={`w-full px-3 sm:px-4 py-2 text-sm sm:text-base rounded-lg focus:outline-none ${isDark ? "bg-slate-800/50 border border-slate-700 text-white placeholder-slate-500 focus:border-cyan-500" : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-600"}`}
              />
            </div>
            <div className="flex gap-2 sm:gap-4">
              <select
                value={filterDepartment}
                onChange={(e) => setFilterDepartment(e.target.value)}
                className={`flex-1 sm:flex-initial px-3 sm:px-4 py-2 text-sm sm:text-base rounded-lg focus:outline-none ${isDark ? "bg-slate-800/50 border border-slate-700 text-white focus:border-cyan-500" : "bg-white border border-gray-200 text-gray-900 focus:border-blue-600"}`}
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
                className={`flex-1 sm:flex-initial px-3 sm:px-4 py-2 text-sm sm:text-base rounded-lg focus:outline-none ${isDark ? "bg-slate-800/50 border border-slate-700 text-white focus:border-cyan-500" : "bg-white border border-gray-200 text-gray-900 focus:border-blue-600"}`}
              >
                <option value="all">All Active</option>
                <option value="active">Active</option>
                <option value="on_leave">On Leave</option>
              </select>
            </div>
          </div>

          {/* Personnel Table */}
          <div className={`rounded-xl overflow-hidden ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={`border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                    <th className={`text-left px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Employee
                    </th>
                    <th className={`text-left px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Position
                    </th>
                    <th className={`text-left px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Department
                    </th>
                    <th className={`text-left px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Location
                    </th>
                    <th className={`text-left px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Status
                    </th>
                    <th className={`text-center px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Clock
                    </th>
                    <th className={`text-left px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Hire Date
                    </th>
                    <th className={`text-right px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
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
                            <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              {person.firstName} {person.lastName}
                            </p>
                            <p className={`text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>{person.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className={`px-6 py-4 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        {person.position}
                      </td>
                      <td className={`px-6 py-4 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        {person.department}
                      </td>
                      <td className={`px-6 py-4 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
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
                          className={`px-2 py-1 text-sm rounded border cursor-pointer ${
                            isDark
                              ? "bg-slate-700 border-slate-600 text-white hover:border-cyan-500 focus:border-cyan-500"
                              : "bg-white border-gray-300 text-gray-900 hover:border-blue-500 focus:border-blue-500"
                          } focus:outline-none`}
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
                        <span
                          className={`px-3 py-1 text-xs font-medium rounded border ${statusColors[person.status] || statusColors.active}`}
                        >
                          {STATUS_OPTIONS.find((s) => s.value === person.status)?.label || person.status}
                        </span>
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
                      <td className={`px-6 py-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        {new Date(person.hireDate).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/personnel/${person._id}`);
                          }}
                          className={`text-sm ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
                        >
                          View Profile
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredPersonnel.length === 0 && (
                <div className="text-center py-12">
                  <p className={isDark ? "text-slate-500" : "text-gray-500"}>
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
            <div className={`rounded-xl overflow-hidden ${isDark ? "bg-slate-800/30 border border-slate-700/50" : "bg-gray-50 border border-gray-200"}`}>
              <button
                onClick={() => setShowTerminated(!showTerminated)}
                className={`w-full px-6 py-4 flex items-center justify-between ${isDark ? "hover:bg-slate-700/20" : "hover:bg-gray-100"}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                    Terminated Employees ({filteredTerminated.length})
                  </span>
                  <span className={`px-2 py-0.5 text-xs rounded ${isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-600"}`}>
                    Archived
                  </span>
                </div>
                <svg
                  className={`w-5 h-5 transition-transform ${showTerminated ? "rotate-180" : ""} ${isDark ? "text-slate-400" : "text-gray-500"}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showTerminated && (
                <div className={`border-t ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
                  <table className="w-full">
                    <thead>
                      <tr className={`border-b ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
                        <th className={`text-left px-6 py-3 text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                          Employee
                        </th>
                        <th className={`text-left px-6 py-3 text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                          Position
                        </th>
                        <th className={`text-left px-6 py-3 text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                          Department
                        </th>
                        <th className={`text-left px-6 py-3 text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                          Termination Date
                        </th>
                        <th className={`text-right px-6 py-3 text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTerminated.map((person) => (
                        <tr
                          key={person._id}
                          className={`border-b cursor-pointer ${isDark ? "border-slate-700/30 hover:bg-slate-700/10" : "border-gray-100 hover:bg-gray-50"}`}
                          onClick={() => router.push(`/personnel/${person._id}`)}
                        >
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold opacity-60 ${isDark ? "bg-slate-600" : "bg-gray-400"}`}>
                                {person.firstName.charAt(0)}{person.lastName.charAt(0)}
                              </div>
                              <div>
                                <p className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                                  {person.firstName} {person.lastName}
                                </p>
                                <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>{person.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className={`px-6 py-3 text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                            {person.position}
                          </td>
                          <td className={`px-6 py-3 text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                            {person.department}
                          </td>
                          <td className={`px-6 py-3 text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                            {person.terminationDate
                              ? new Date(person.terminationDate).toLocaleDateString()
                              : "N/A"}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/personnel/${person._id}`);
                              }}
                              className={`text-xs ${isDark ? "text-slate-500 hover:text-slate-400" : "text-gray-500 hover:text-gray-600"}`}
                            >
                              View Record
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {filteredTerminated.length === 0 && (
                    <div className="text-center py-8">
                      <p className={`text-sm ${isDark ? "text-slate-600" : "text-gray-400"}`}>
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
