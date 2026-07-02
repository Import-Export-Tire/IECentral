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

function CallOffContent() {
  const router = useRouter();
  const { user, canAccessEmployeePortal } = useAuth();
  const personnelId = user?.personnelId;

  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const callOffs = useQuery(
    api.employeePortal.getMyCallOffs,
    personnelId ? { personnelId } : "skip"
  );

  const submitCallOff = useMutation(api.employeePortal.submitCallOff);

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
      if (!date) {
        throw new Error("Please select a date");
      }

      if (!reason.trim()) {
        throw new Error("Please provide a reason");
      }

      await submitCallOff({
        personnelId,
        date,
        reason: reason.trim(),
      });

      setSuccess(true);
      setTimeout(() => {
        setShowForm(false);
        setReason("");
        setSuccess(false);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit call off");
    }

    setIsSubmitting(false);
  };

  // Recent call offs (last 30 days)
  const recentCallOffs = callOffs?.slice(0, 10) || [];

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
              Call Off
            </h1>
          </div>
          {!showForm && (
            <Button variant="danger" size="sm" onClick={() => setShowForm(true)}>
              Call Off
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Call Off Form */}
        {showForm && (
          <form onSubmit={handleSubmit}>
            <Card padding="md">
              <h2 className="text-lg font-semibold mb-4 theme-text-primary">
                Report Call Off
              </h2>

              {success ? (
                <Card tone="green" padding="md" className="text-center">
                  <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-green-700 dark:text-green-400">Call off submitted successfully!</p>
                </Card>
              ) : (
                <>
                  {error && (
                    <div className="mb-4 p-3 rounded-lg ui-callout-red text-sm">
                      {error}
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1 theme-text-secondary">
                        Date
                      </label>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
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
                        rows={4}
                        required
                        className="theme-input w-full px-4 py-3"
                        placeholder="Please provide a reason for calling off..."
                      />
                    </div>

                    <Card tone="amber" padding="sm">
                      <p className="text-sm text-amber-800 dark:text-amber-300">
                        <strong>Important:</strong> Please call off as early as possible to allow for shift coverage.
                      </p>
                    </Card>

                    <div className="flex gap-3">
                      <Button variant="secondary" className="flex-1" type="button" onClick={() => setShowForm(false)}>
                        Cancel
                      </Button>
                      <Button variant="danger" className="flex-1" type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Submitting..." : "Submit Call Off"}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </form>
        )}

        {/* Recent Call Offs */}
        <div>
          <h2 className="font-semibold mb-3 theme-text-primary">
            Recent Call Offs
          </h2>
          {recentCallOffs.length > 0 ? (
            <div className="space-y-3">
              {recentCallOffs.map((co) => (
                <Card key={co._id} padding="sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium theme-text-primary">
                      {new Date(co.date + "T00:00:00").toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className={co.acknowledgedBy ? "ui-badge ui-badge-green" : "ui-badge ui-badge-amber"}>
                      {co.acknowledgedBy ? "Acknowledged" : "Pending"}
                    </span>
                  </div>
                  <p className="text-sm theme-text-tertiary">
                    {co.reason}
                  </p>
                  <p className="text-xs mt-2 theme-text-tertiary">
                    Submitted: {new Date(co.reportedAt).toLocaleString()}
                  </p>
                </Card>
              ))}
            </div>
          ) : (
            <Card padding="md" className="text-center">
              <p className="theme-text-tertiary">No call offs on record</p>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

export default function CallOffPage() {
  return (
    <Protected>
      <CallOffContent />
    </Protected>
  );
}
