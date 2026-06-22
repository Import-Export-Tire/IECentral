"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { Id } from "@/convex/_generated/dataModel";

const TABLE_LABELS: Record<string, string> = {
  personnel: "Personnel",
  users: "Users",
  jobs: "Job Listings",
  applications: "Applications",
  announcements: "Announcements",
  events: "Calendar Events",
  documents: "Documents",
  projects: "Projects",
  equipment: "Equipment",
};

function DeletedRecordsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();

  const [selectedTable, setSelectedTable] = useState<string | undefined>(undefined);
  const [confirmingRestore, setConfirmingRestore] = useState<Id<"deletedRecords"> | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<Id<"deletedRecords"> | null>(null);

  const deletedRecords = useQuery(
    api.deletedRecords.getDeletedRecords,
    user ? { requestingUserId: user._id, tableName: selectedTable } : "skip",
  );
  const counts = useQuery(
    api.deletedRecords.getDeletedRecordCounts,
    user ? { requestingUserId: user._id } : "skip",
  );

  const restoreRecord = useMutation(api.deletedRecords.restoreRecord);
  const permanentlyDelete = useMutation(api.deletedRecords.permanentlyDelete);

  const handleRestore = async (id: Id<"deletedRecords">) => {
    try {
      await restoreRecord({ deletedRecordId: id });
      setConfirmingRestore(null);
    } catch (error) {
      console.error("Failed to restore:", error);
      alert("Failed to restore record");
    }
  };

  const handlePermanentDelete = async (id: Id<"deletedRecords">) => {
    try {
      await permanentlyDelete({ deletedRecordId: id });
      setConfirmingDelete(null);
    } catch (error) {
      console.error("Failed to delete:", error);
      alert("Failed to permanently delete record");
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Header */}
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 ${
          isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                Deleted Records
              </h1>
              <p className={`text-xs sm:text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Review and restore deleted records
              </p>
            </div>
            <div className={`px-4 py-2 rounded-lg ${isDark ? "bg-slate-800" : "bg-gray-100"}`}>
              <span className={`text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                {counts?.total || 0} deleted records
              </span>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8">
          {/* Filter tabs */}
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => setSelectedTable(undefined)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                !selectedTable
                  ? isDark
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                    : "bg-blue-50 text-blue-600 border border-blue-200"
                  : isDark
                    ? "bg-slate-800 text-slate-400 hover:text-white"
                    : "bg-white text-gray-600 hover:text-gray-900 border border-gray-200"
              }`}
            >
              All ({counts?.total || 0})
            </button>
            {Object.entries(TABLE_LABELS).map(([key, label]) => {
              const count = counts?.byTable[key] || 0;
              if (count === 0) return null;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedTable(key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    selectedTable === key
                      ? isDark
                        ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                        : "bg-blue-50 text-blue-600 border border-blue-200"
                      : isDark
                        ? "bg-slate-800 text-slate-400 hover:text-white"
                        : "bg-white text-gray-600 hover:text-gray-900 border border-gray-200"
                  }`}
                >
                  {label} ({count})
                </button>
              );
            })}
          </div>

          {/* Records list */}
          {!deletedRecords ? (
            <div className={`text-center py-12 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Loading...
            </div>
          ) : deletedRecords.length === 0 ? (
            <div className={`text-center py-12 rounded-xl border ${
              isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"
            }`}>
              <svg className={`w-12 h-12 mx-auto mb-4 ${isDark ? "text-slate-600" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <p className={`${isDark ? "text-slate-400" : "text-gray-500"}`}>
                No deleted records found
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {deletedRecords.map((record) => (
                <div
                  key={record._id}
                  className={`p-4 rounded-xl border ${
                    isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                          isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600"
                        }`}>
                          {TABLE_LABELS[record.tableName] || record.tableName}
                        </span>
                        <h3 className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                          {record.recordSummary}
                        </h3>
                      </div>
                      <div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        <p>Deleted by <span className="font-medium">{record.deletedByName}</span> on {formatDate(record.deletedAt)}</p>
                        {record.reason && (
                          <p className="mt-1">Reason: {record.reason}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {confirmingRestore === record._id ? (
                        <>
                          <button
                            onClick={() => handleRestore(record._id)}
                            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30"
                          >
                            Confirm Restore
                          </button>
                          <button
                            onClick={() => setConfirmingRestore(null)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
                              isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            Cancel
                          </button>
                        </>
                      ) : confirmingDelete === record._id ? (
                        <>
                          <button
                            onClick={() => handlePermanentDelete(record._id)}
                            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30"
                          >
                            Confirm Delete
                          </button>
                          <button
                            onClick={() => setConfirmingDelete(null)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
                              isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setConfirmingRestore(record._id)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                              isDark
                                ? "bg-green-500/10 text-green-400 hover:bg-green-500/20"
                                : "bg-green-50 text-green-600 hover:bg-green-100"
                            }`}
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => setConfirmingDelete(record._id)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                              isDark
                                ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                : "bg-red-50 text-red-600 hover:bg-red-100"
                            }`}
                          >
                            Permanently Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function DeletedRecordsPage() {
  return (
    <Protected minTier={4}>
      <DeletedRecordsContent />
    </Protected>
  );
}
