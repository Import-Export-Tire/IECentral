"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { usePaginatedList } from "@/components/ui/usePaginatedList";
import { Skeleton } from "@/components/ui/Skeleton";

const actionTypeColors: Record<string, { bg: string; text: string }> = {
  create: { bg: "bg-green-500/20", text: "text-green-400" },
  update: { bg: "bg-cyan-500/20", text: "text-cyan-400" },
  delete: { bg: "bg-red-500/20", text: "text-red-400" },
  view: { bg: "bg-slate-500/20", text: "text-slate-400" },
  login: { bg: "bg-purple-500/20", text: "text-purple-400" },
  export: { bg: "bg-amber-500/20", text: "text-amber-400" },
};

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function AuditLogContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [actionTypeFilter, setActionTypeFilter] = useState("all");
  const [resourceTypeFilter, setResourceTypeFilter] = useState("all");
  const [userFilter, setUserFilter] = useState<Id<"users"> | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Cursor-based paginated query; changing any filter arg resets pagination automatically (Convex behavior).
  const audit = usePaginatedList(
    api.auditLogs.getAll,
    {
      actionType: actionTypeFilter === "all" ? undefined : actionTypeFilter,
      resourceType: resourceTypeFilter === "all" ? undefined : resourceTypeFilter,
      userId: userFilter || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    },
    { initialNumItems: 25 }
  );

  const actionTypes = useQuery(api.auditLogs.getActionTypes);
  const resourceTypes = useQuery(api.auditLogs.getResourceTypes);
  const users = useQuery(api.auditLogs.getUsers);

  const logs = audit.results;

  const clearFilters = () => {
    setActionTypeFilter("all");
    setResourceTypeFilter("all");
    setUserFilter("");
    setStartDate("");
    setEndDate("");
  };

  return (
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Header */}
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                Audit Log
              </h1>
              <p className={`text-xs sm:text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Track all system activity and changes
              </p>
            </div>
            <span className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              {audit.status === "LoadingFirstPage"
                ? "Loading…"
                : `${logs.length}${audit.status !== "Exhausted" ? "+" : ""} loaded`}
            </span>
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-6">
          {/* Filters */}
          <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                Filters
              </h3>
              <button
                onClick={clearFilters}
                className={`text-sm ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
              >
                Clear all
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className={`block text-sm mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                  Action Type
                </label>
                <select
                  value={actionTypeFilter}
                  onChange={(e) => setActionTypeFilter(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}
                >
                  <option value="all">All Actions</option>
                  {actionTypes?.map((type) => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={`block text-sm mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                  Resource Type
                </label>
                <select
                  value={resourceTypeFilter}
                  onChange={(e) => setResourceTypeFilter(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}
                >
                  <option value="all">All Resources</option>
                  {resourceTypes?.map((type) => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={`block text-sm mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                  User
                </label>
                <select
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value as Id<"users"> | "")}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}
                >
                  <option value="">All Users</option>
                  {users?.map((user) => user && (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={`block text-sm mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}
                />
              </div>
              <div>
                <label className={`block text-sm mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}
                />
              </div>
            </div>
          </div>

          {/* Logs Table */}
          <div className={`border rounded-xl overflow-hidden ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
            {audit.status === "LoadingFirstPage" ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : logs.length === 0 ? (
              <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                <svg
                  className={`w-16 h-16 mx-auto mb-4 ${isDark ? "text-slate-600" : "text-gray-300"}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-lg font-medium mb-1">No audit logs found</p>
                <p className="text-sm">
                  {actionTypeFilter !== "all" || resourceTypeFilter !== "all" || userFilter || startDate || endDate
                    ? "Try adjusting your filters"
                    : "System activity will appear here"}
                </p>
              </div>
            ) : (
              <>
                {/* Mobile card list (phones) */}
                <div className="sm:hidden divide-y divide-slate-700/30">
                  {logs.map((log) => {
                    const colors = actionTypeColors[log.actionType] || actionTypeColors.view;
                    return (
                      <div key={log._id} className={`p-4 space-y-2 ${isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-50"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${colors.bg} ${colors.text}`}>
                            {log.actionType}
                          </span>
                          <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            {formatTimestamp(log.timestamp)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-medium ${
                            isDark ? "bg-slate-700 text-slate-300" : "bg-gray-200 text-gray-600"
                          }`}>
                            {log.userEmail.charAt(0).toUpperCase()}
                          </div>
                          <span className={`text-sm truncate ${isDark ? "text-white" : "text-gray-900"}`}>{log.userEmail}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-700"}`}>
                            {log.resourceType}
                          </span>
                        </div>
                        {log.details && (
                          <p className={`text-xs truncate ${isDark ? "text-slate-400" : "text-gray-600"}`}>{log.details}</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className={isDark ? "bg-slate-900/50" : "bg-gray-50"}>
                      <tr className={isDark ? "text-slate-400" : "text-gray-500"}>
                        <th className="text-left py-3 px-4 font-medium">Timestamp</th>
                        <th className="text-left py-3 px-4 font-medium">User</th>
                        <th className="text-left py-3 px-4 font-medium">Action</th>
                        <th className="text-left py-3 px-4 font-medium">Resource</th>
                        <th className="text-left py-3 px-4 font-medium">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {logs.map((log) => {
                        const colors = actionTypeColors[log.actionType] || actionTypeColors.view;

                        return (
                          <tr
                            key={log._id}
                            className={`transition-colors ${isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-50"}`}
                          >
                            <td className={`py-3 px-4 whitespace-nowrap ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                              {formatTimestamp(log.timestamp)}
                            </td>
                            <td className={`py-3 px-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                              <div className="flex items-center gap-2">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                                  isDark ? "bg-slate-700 text-slate-300" : "bg-gray-200 text-gray-600"
                                }`}>
                                  {log.userEmail.charAt(0).toUpperCase()}
                                </div>
                                <span className="truncate max-w-[120px]">{log.userEmail}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${colors.bg} ${colors.text}`}>
                                {log.actionType}
                              </span>
                            </td>
                            <td className={`py-3 px-4 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                              <span className={`text-xs px-2 py-0.5 rounded ${isDark ? "bg-slate-700" : "bg-gray-100"}`}>
                                {log.resourceType}
                              </span>
                            </td>
                            <td className={`py-3 px-4 max-w-xs truncate ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                              {log.details}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Load more / spinner — rendered outside table so no invalid DOM nesting */}
            {audit.status !== "LoadingFirstPage" && logs.length > 0 && (
              <div className={`flex items-center justify-between px-4 py-3 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <p className={`text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                  Showing {logs.length}{audit.status !== "Exhausted" ? "+" : ""}
                </p>
                {audit.status === "CanLoadMore" && (
                  <button
                    onClick={() => audit.loadMore(25)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                      isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    Load more
                  </button>
                )}
                {audit.status === "LoadingMore" && (
                  <div className="w-6 h-6 border-2 border-t-transparent border-cyan-500 rounded-full animate-spin" />
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function AuditLogPage() {
  return (
    <Protected minTier={4}>
      <AuditLogContent />
    </Protected>
  );
}
