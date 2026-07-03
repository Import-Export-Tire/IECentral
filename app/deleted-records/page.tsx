"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../auth-context";
import { Id } from "@/convex/_generated/dataModel";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

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
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Header */}
        <header className="sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">
                Deleted Records
              </h1>
              <p className="text-xs sm:text-sm mt-1 theme-text-secondary">
                Review and restore deleted records
              </p>
            </div>
            <div className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-slate-800">
              <span className="text-sm font-medium theme-text-secondary">
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
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                !selectedTable
                  ? "bg-[#007AFF]/10 text-[#007AFF] border-[#007AFF]/20"
                  : "bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500"
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
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    selectedTable === key
                      ? "bg-[#007AFF]/10 text-[#007AFF] border-[#007AFF]/20"
                      : "bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500"
                  }`}
                >
                  {label} ({count})
                </button>
              );
            })}
          </div>

          {/* Records list */}
          {!deletedRecords ? (
            <div className="text-center py-12 theme-text-secondary">
              Loading...
            </div>
          ) : deletedRecords.length === 0 ? (
            <Card padding="md" className="text-center">
              <svg className="w-12 h-12 mx-auto mb-4 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <p className="theme-text-secondary">
                No deleted records found
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {deletedRecords.map((record) => (
                <Card key={record._id} padding="sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300">
                          {TABLE_LABELS[record.tableName] || record.tableName}
                        </span>
                        <h3 className="font-medium theme-text-primary">
                          {record.recordSummary}
                        </h3>
                      </div>
                      <div className="text-sm theme-text-secondary">
                        <p>Deleted by <span className="font-medium">{record.deletedByName}</span> on {formatDate(record.deletedAt)}</p>
                        {record.reason && (
                          <p className="mt-1">Reason: {record.reason}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {confirmingRestore === record._id ? (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleRestore(record._id)}
                            className="text-green-600 dark:text-green-400 bg-green-500/10 hover:bg-green-500/20 border-0"
                          >
                            Confirm Restore
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setConfirmingRestore(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : confirmingDelete === record._id ? (
                        <>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handlePermanentDelete(record._id)}
                          >
                            Confirm Delete
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setConfirmingDelete(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setConfirmingRestore(record._id)}
                            className="text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 border-0"
                          >
                            Restore
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setConfirmingDelete(record._id)}
                          >
                            Permanently Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
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
