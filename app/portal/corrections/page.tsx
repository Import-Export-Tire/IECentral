"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Protected from "../../protected";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../../auth-context";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

const ENTRY_TYPES = [
  { value: "clock_in", label: "Clock In" },
  { value: "clock_out", label: "Clock Out" },
  { value: "break_start", label: "Break Start" },
  { value: "break_end", label: "Break End" },
];

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function CorrectionsContent() {
  const router = useRouter();
  const { user, canAccessEmployeePortal } = useAuth();
  const personnelId = user?.personnelId;

  const [showForm, setShowForm] = useState(false);
  const [requestType, setRequestType] = useState<"add_missed" | "edit">("add_missed");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [entryType, setEntryType] = useState("clock_in");
  const [requestedTime, setRequestedTime] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const corrections = useQuery(
    api.employeePortal.getMyTimeCorrections,
    personnelId ? { personnelId } : "skip"
  );

  const submitCorrection = useMutation(api.timeClock.requestCorrection);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (!date || !requestedTime || !reason.trim()) {
        throw new Error("Please fill in all required fields");
      }

      // Convert time to timestamp
      const [hours, minutes] = requestedTime.split(":").map(Number);
      const dateObj = new Date(date + "T00:00:00");
      dateObj.setHours(hours, minutes, 0, 0);
      const requestedTimestamp = dateObj.getTime();

      await submitCorrection({
        personnelId,
        date,
        requestType,
        requestedTimestamp,
        requestedType: entryType,
        reason: reason.trim(),
      });

      setShowForm(false);
      setRequestType("add_missed");
      setDate(new Date().toISOString().split("T")[0]);
      setEntryType("clock_in");
      setRequestedTime("");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit correction");
    }

    setIsSubmitting(false);
  };

  const pendingCorrections = corrections?.filter((c) => c.status === "pending") || [];
  const pastCorrections = corrections?.filter((c) => c.status !== "pending") || [];

  return (
    <div className="min-h-screen bg-[#f2f2f7] dark:bg-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur-sm border-b px-4 py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/portal"
              className="p-2 -ml-2 rounded-lg theme-text-primary hover:bg-gray-100 dark:hover:bg-slate-700"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold theme-text-primary">
              Time Corrections
            </h1>
          </div>
          {!showForm && (
            <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
              Request
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Request Form */}
        {showForm && (
          <form onSubmit={handleSubmit}>
            <Card padding="md">
              <h2 className="text-lg font-semibold mb-4 theme-text-primary">
                Request Time Correction
              </h2>

              {error && (
                <div className="mb-4 p-3 rounded-lg ui-callout-red text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1 theme-text-secondary">
                    Correction Type
                  </label>
                  <select
                    value={requestType}
                    onChange={(e) => setRequestType(e.target.value as "add_missed" | "edit")}
                    className="theme-input w-full px-4 py-3"
                  >
                    <option value="add_missed">Add Missed Punch</option>
                    <option value="edit">Edit Existing Entry</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 theme-text-secondary">
                    Date
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    max={new Date().toISOString().split("T")[0]}
                    className="theme-input w-full px-4 py-3"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 theme-text-secondary">
                    Entry Type
                  </label>
                  <select
                    value={entryType}
                    onChange={(e) => setEntryType(e.target.value)}
                    className="theme-input w-full px-4 py-3"
                  >
                    {ENTRY_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 theme-text-secondary">
                    Requested Time
                  </label>
                  <input
                    type="time"
                    value={requestedTime}
                    onChange={(e) => setRequestedTime(e.target.value)}
                    className="theme-input w-full px-4 py-3"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 theme-text-secondary">
                    Reason
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    required
                    className="theme-input w-full px-4 py-3"
                    placeholder="Explain why this correction is needed..."
                  />
                </div>

                <div className="flex gap-3">
                  <Button variant="secondary" className="flex-1" type="button" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" className="flex-1" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Submitting..." : "Submit"}
                  </Button>
                </div>
              </div>
            </Card>
          </form>
        )}

        {/* Pending Requests */}
        {pendingCorrections.length > 0 && (
          <div>
            <h2 className="font-semibold mb-3 theme-text-primary">
              Pending Requests
            </h2>
            <div className="space-y-3">
              {pendingCorrections.map((corr) => (
                <Card key={corr._id} padding="sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium theme-text-primary">
                      {new Date(corr.date + "T00:00:00").toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className={corr.status === "approved" ? "ui-badge ui-badge-green" : corr.status === "denied" ? "ui-badge ui-badge-red" : "ui-badge ui-badge-amber capitalize"}>
                      {corr.status}
                    </span>
                  </div>
                  <p className="text-sm theme-text-tertiary">
                    {corr.requestType === "add_missed" ? "Add Missed:" : "Edit:"}{" "}
                    {corr.requestedType?.replace("_", " ")}{" "}
                    {corr.requestedTimestamp && `at ${formatTime(corr.requestedTimestamp)}`}
                  </p>
                  <p className="text-sm mt-1 theme-text-tertiary">
                    {corr.reason}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Past Requests */}
        <div>
          <h2 className="font-semibold mb-3 theme-text-primary">
            Request History
          </h2>
          {pastCorrections.length > 0 ? (
            <div className="space-y-3">
              {pastCorrections.map((corr) => (
                <Card key={corr._id} padding="sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium theme-text-primary">
                      {new Date(corr.date + "T00:00:00").toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className={corr.status === "approved" ? "ui-badge ui-badge-green" : corr.status === "denied" ? "ui-badge ui-badge-red" : "ui-badge ui-badge-amber capitalize"}>
                      {corr.status}
                    </span>
                  </div>
                  <p className="text-sm theme-text-tertiary">
                    {corr.requestedType?.replace("_", " ")}{" "}
                    {corr.requestedTimestamp && `at ${formatTime(corr.requestedTimestamp)}`}
                  </p>
                  {corr.reviewNotes && (
                    <p className="text-sm mt-2 italic theme-text-tertiary">
                      Manager: {corr.reviewNotes}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          ) : (
            <Card padding="md" className="text-center">
              <p className="theme-text-tertiary">No previous requests</p>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

export default function CorrectionsPage() {
  return (
    <Protected>
      <CorrectionsContent />
    </Protected>
  );
}
