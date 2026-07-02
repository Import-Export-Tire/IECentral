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

const REQUEST_TYPES = [
  { value: "vacation", label: "Vacation" },
  { value: "sick", label: "Sick" },
  { value: "personal", label: "Personal" },
  { value: "bereavement", label: "Bereavement" },
  { value: "other", label: "Other" },
];

function TimeOffContent() {
  const router = useRouter();
  const { user, canAccessEmployeePortal } = useAuth();
  const personnelId = user?.personnelId;

  const [showForm, setShowForm] = useState(false);
  const [requestType, setRequestType] = useState("vacation");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requests = useQuery(
    api.employeePortal.getMyTimeOffRequests,
    personnelId ? { personnelId } : "skip"
  );

  const submitRequest = useMutation(api.employeePortal.submitTimeOffRequest);
  const cancelRequest = useMutation(api.employeePortal.cancelTimeOffRequest);

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
      if (!startDate || !endDate) {
        throw new Error("Please select start and end dates");
      }

      if (new Date(endDate) < new Date(startDate)) {
        throw new Error("End date must be after start date");
      }

      await submitRequest({
        personnelId,
        requestType,
        startDate,
        endDate,
        reason: reason || undefined,
      });

      setShowForm(false);
      setRequestType("vacation");
      setStartDate("");
      setEndDate("");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit request");
    }

    setIsSubmitting(false);
  };

  const handleCancel = async (requestId: string) => {
    if (!confirm("Are you sure you want to cancel this request?")) return;

    try {
      await cancelRequest({
        requestId: requestId as any,
        personnelId,
      });
    } catch (err) {
      alert("Failed to cancel request");
    }
  };

  const pendingRequests = requests?.filter((r) => r.status === "pending") || [];
  const pastRequests = requests?.filter((r) => r.status !== "pending") || [];

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
              Time Off
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
                New Time Off Request
              </h2>

              {error && (
                <div className="mb-4 p-3 rounded-lg ui-callout-red text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1 theme-text-secondary">
                    Type
                  </label>
                  <select
                    value={requestType}
                    onChange={(e) => setRequestType(e.target.value)}
                    className="theme-input w-full px-4 py-3"
                  >
                    {REQUEST_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1 theme-text-secondary">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      min={new Date().toISOString().split("T")[0]}
                      className="theme-input w-full px-4 py-3"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 theme-text-secondary">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={startDate || new Date().toISOString().split("T")[0]}
                      className="theme-input w-full px-4 py-3"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 theme-text-secondary">
                    Reason (Optional)
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    className="theme-input w-full px-4 py-3"
                    placeholder="Additional details..."
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    onClick={() => setShowForm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    className="flex-1"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Submitting..." : "Submit"}
                  </Button>
                </div>
              </div>
            </Card>
          </form>
        )}

        {/* Pending Requests */}
        {pendingRequests.length > 0 && (
          <div>
            <h2 className="font-semibold mb-3 theme-text-primary">
              Pending Requests
            </h2>
            <div className="space-y-3">
              {pendingRequests.map((req) => (
                <Card key={req._id} padding="sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium capitalize theme-text-primary">
                      {req.requestType}
                    </span>
                    <span className={req.status === "approved" ? "ui-badge ui-badge-green" : req.status === "denied" ? "ui-badge ui-badge-red" : "ui-badge ui-badge-amber"}>
                      {req.status}
                    </span>
                  </div>
                  <p className="text-sm theme-text-tertiary">
                    {new Date(req.startDate + "T00:00:00").toLocaleDateString()} -{" "}
                    {new Date(req.endDate + "T00:00:00").toLocaleDateString()}
                    <span className="ml-2">({req.totalDays} day{req.totalDays > 1 ? "s" : ""})</span>
                  </p>
                  {req.reason && (
                    <p className="text-sm mt-2 theme-text-tertiary">
                      {req.reason}
                    </p>
                  )}
                  <button
                    onClick={() => handleCancel(req._id)}
                    className="mt-3 text-sm font-medium text-red-500 dark:text-red-400"
                  >
                    Cancel Request
                  </button>
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
          {pastRequests.length > 0 ? (
            <div className="space-y-3">
              {pastRequests.map((req) => (
                <Card key={req._id} padding="sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium capitalize theme-text-primary">
                      {req.requestType}
                    </span>
                    <span className={req.status === "approved" ? "ui-badge ui-badge-green" : req.status === "denied" ? "ui-badge ui-badge-red" : "ui-badge ui-badge-amber"}>
                      {req.status}
                    </span>
                  </div>
                  <p className="text-sm theme-text-tertiary">
                    {new Date(req.startDate + "T00:00:00").toLocaleDateString()} -{" "}
                    {new Date(req.endDate + "T00:00:00").toLocaleDateString()}
                  </p>
                  {req.managerNotes && (
                    <p className="text-sm mt-2 italic theme-text-tertiary">
                      Manager: {req.managerNotes}
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

export default function TimeOffPage() {
  return (
    <Protected>
      <TimeOffContent />
    </Protected>
  );
}
