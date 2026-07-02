"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "../auth-context";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

const REPORT_VIA_OPTIONS = [
  { value: "app", label: "App" },
  { value: "phone", label: "Phone Call" },
  { value: "text", label: "Text Message" },
  { value: "in_person", label: "In Person" },
  { value: "other", label: "Other" },
];

function CallOffsContent() {
  const { user, canManageCallOffs } = useAuth();

  const todayCallOffs = useQuery(api.callOffs.getToday) || [];
  const unacknowledged = useQuery(api.callOffs.getUnacknowledged) || [];
  const stats = useQuery(api.callOffs.getStats) || {
    todayCount: 0,
    unacknowledgedCount: 0,
    thisWeekCount: 0,
  };
  const personnel = useQuery(api.personnel.listAll, {}) || [];

  const acknowledgeMutation = useMutation(api.callOffs.acknowledge);
  const addManualMutation = useMutation(api.callOffs.addManual);

  const [activeTab, setActiveTab] = useState<"today" | "unacknowledged">("today");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCallOff, setSelectedCallOff] = useState<Id<"callOffs"> | null>(null);
  const [managerNotes, setManagerNotes] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Manual call-off form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCallOff, setNewCallOff] = useState({
    personnelId: "",
    date: new Date().toISOString().split("T")[0],
    reason: "",
    reportedVia: "phone",
    managerNotes: "",
  });

  // Redirect if user doesn't have permission
  if (!canManageCallOffs) {
    return (
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold theme-text-primary">
              Access Denied
            </h1>
            <p className="mt-2 theme-text-tertiary">
              You don&apos;t have permission to view this page.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const displayedCallOffs = activeTab === "today" ? todayCallOffs : unacknowledged;

  const filteredCallOffs = displayedCallOffs.filter((callOff) => {
    const matchesSearch =
      searchTerm === "" ||
      callOff.personnelName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      callOff.personnelDepartment?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  const handleAcknowledge = async (callOffId: Id<"callOffs">) => {
    if (!user) return;
    setIsProcessing(true);
    try {
      await acknowledgeMutation({
        callOffId,
        acknowledgedBy: user._id,
        managerNotes: managerNotes || undefined,
      });
      setSelectedCallOff(null);
      setManagerNotes("");
    } catch (error) {
      console.error("Failed to acknowledge call-off:", error);
    }
    setIsProcessing(false);
  };

  const handleAddManual = async () => {
    if (!user || !newCallOff.personnelId) return;
    setIsProcessing(true);
    try {
      await addManualMutation({
        personnelId: newCallOff.personnelId as Id<"personnel">,
        date: newCallOff.date,
        reason: newCallOff.reason,
        reportedVia: newCallOff.reportedVia,
        acknowledgedBy: user._id,
        managerNotes: newCallOff.managerNotes || undefined,
      });
      setShowAddForm(false);
      setNewCallOff({
        personnelId: "",
        date: new Date().toISOString().split("T")[0],
        reason: "",
        reportedVia: "phone",
        managerNotes: "",
      });
    } catch (error) {
      console.error("Failed to add call-off:", error);
    }
    setIsProcessing(false);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const selectedCallOffData = selectedCallOff
    ? displayedCallOffs.find((c) => c._id === selectedCallOff)
    : null;

  // Sort personnel alphabetically
  const sortedPersonnel = [...personnel]
    .filter((p) => p.status === "active")
    .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-[var(--theme-border-secondary)] px-4 sm:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">
                Call-Offs
              </h1>
              <p className="text-xs sm:text-sm mt-1 hidden sm:block theme-text-tertiary">
                Track and manage employee call-offs
              </p>
            </div>
            <Button
              variant="primary"
              onClick={() => setShowAddForm(true)}
              className="flex-shrink-0"
            >
              <span className="hidden sm:inline">Add Call-Off</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <Card padding="sm">
              <p className="text-lg sm:text-2xl font-bold text-amber-500 text-center">{stats.todayCount}</p>
              <p className="text-[10px] sm:text-xs theme-text-tertiary text-center">Today</p>
            </Card>
            <Card padding="sm">
              <p className="text-lg sm:text-2xl font-bold text-red-500 text-center">{stats.unacknowledgedCount}</p>
              <p className="text-[10px] sm:text-xs theme-text-tertiary text-center">Unacknowledged</p>
            </Card>
            <Card padding="sm">
              <p className="text-lg sm:text-2xl font-bold theme-text-primary text-center">{stats.thisWeekCount}</p>
              <p className="text-[10px] sm:text-xs theme-text-tertiary text-center">This Week</p>
            </Card>
          </div>

          {/* Tabs and Search */}
          <Card padding="sm">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search by name or department..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant={activeTab === "today" ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setActiveTab("today")}
                  className="whitespace-nowrap"
                >
                  Today
                  {stats.todayCount > 0 && (
                    <span className="ml-1.5 bg-amber-500 text-white px-1.5 py-0.5 rounded-full text-xs">
                      {stats.todayCount}
                    </span>
                  )}
                </Button>
                <Button
                  variant={activeTab === "unacknowledged" ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setActiveTab("unacknowledged")}
                  className="whitespace-nowrap"
                >
                  Unacknowledged
                  {stats.unacknowledgedCount > 0 && (
                    <span className="ml-1.5 bg-red-500 text-white px-1.5 py-0.5 rounded-full text-xs">
                      {stats.unacknowledgedCount}
                    </span>
                  )}
                </Button>
              </div>
            </div>
          </Card>

          {/* Call-Offs List */}
          <Card padding="sm" className="overflow-hidden p-0">
            {filteredCallOffs.length === 0 ? (
              <div className="p-8 text-center">
                <svg
                  className="w-12 h-12 mx-auto mb-3 theme-text-tertiary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
                </svg>
                <p className="theme-text-tertiary">
                  {activeTab === "today" ? "No call-offs today" : "All call-offs acknowledged"}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--theme-border-secondary)]">
                {filteredCallOffs.map((callOff) => (
                  <div
                    key={callOff._id}
                    className="p-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium theme-text-primary">
                            {callOff.personnelName}
                          </h3>
                          {!callOff.acknowledgedAt && (
                            <span className="ui-badge ui-badge-red">Unacknowledged</span>
                          )}
                          {callOff.acknowledgedAt && (
                            <span className="ui-badge ui-badge-green">Acknowledged</span>
                          )}
                        </div>
                        <div className="mt-1 text-sm theme-text-tertiary">
                          {callOff.personnelDepartment} &bull; {callOff.personnelPosition}
                        </div>
                        <div className="mt-2 text-sm theme-text-secondary">
                          <span className="font-medium">{formatDate(callOff.date)}</span>
                          <span className="ml-2 theme-text-tertiary">
                            via {REPORT_VIA_OPTIONS.find((r) => r.value === callOff.reportedVia)?.label || callOff.reportedVia}
                          </span>
                        </div>
                        <p className="mt-2 text-sm theme-text-secondary">
                          {callOff.reason}
                        </p>
                        <p className="mt-2 text-xs theme-text-tertiary">
                          Reported at {formatTimestamp(callOff.reportedAt)}
                          {callOff.acknowledgedAt && callOff.acknowledgerName && (
                            <>
                              <span> &bull; </span>
                              Acknowledged by {callOff.acknowledgerName}
                            </>
                          )}
                        </p>
                        {callOff.managerNotes && (
                          <p className="mt-1 text-xs italic theme-text-tertiary">
                            Note: {callOff.managerNotes}
                          </p>
                        )}
                      </div>

                      {!callOff.acknowledgedAt && (
                        <div className="flex gap-2 flex-shrink-0">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setSelectedCallOff(callOff._id);
                              setManagerNotes("");
                            }}
                          >
                            Acknowledge
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </main>

      {/* Acknowledge Modal */}
      {selectedCallOff && selectedCallOffData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="theme-card w-full max-w-md">
            <div className="p-5 border-b border-[var(--theme-border-secondary)]">
              <h2 className="text-lg font-bold theme-text-primary">
                Acknowledge Call-Off
              </h2>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <span className="text-sm theme-text-tertiary">Employee:</span>
                <p className="font-medium theme-text-primary">
                  {selectedCallOffData.personnelName}
                </p>
              </div>
              <div>
                <span className="text-sm theme-text-tertiary">Date:</span>
                <p className="font-medium theme-text-primary">
                  {formatDate(selectedCallOffData.date)}
                </p>
              </div>
              <div>
                <span className="text-sm theme-text-tertiary">Reason:</span>
                <p className="theme-text-primary">
                  {selectedCallOffData.reason}
                </p>
              </div>

              <div className="pt-2">
                <label className="block ui-section-label mb-1.5">
                  Manager Notes (optional)
                </label>
                <textarea
                  value={managerNotes}
                  onChange={(e) => setManagerNotes(e.target.value)}
                  rows={3}
                  className="theme-input w-full px-3 py-2 text-sm"
                  placeholder="Add notes about this call-off..."
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setSelectedCallOff(null);
                    setManagerNotes("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => handleAcknowledge(selectedCallOff)}
                  disabled={isProcessing}
                >
                  Acknowledge
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Manual Call-Off Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="theme-card w-full max-w-md">
            <div className="p-5 border-b border-[var(--theme-border-secondary)]">
              <h2 className="text-lg font-bold theme-text-primary">
                Add Call-Off
              </h2>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block ui-section-label mb-1.5">Employee</label>
                <select
                  value={newCallOff.personnelId}
                  onChange={(e) => setNewCallOff({ ...newCallOff, personnelId: e.target.value })}
                  className="theme-input w-full px-3 py-2 text-sm"
                >
                  <option value="">Select employee...</option>
                  {sortedPersonnel.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.lastName}, {p.firstName} - {p.department}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block ui-section-label mb-1.5">Date</label>
                <input
                  type="date"
                  value={newCallOff.date}
                  onChange={(e) => setNewCallOff({ ...newCallOff, date: e.target.value })}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block ui-section-label mb-1.5">Reported Via</label>
                <select
                  value={newCallOff.reportedVia}
                  onChange={(e) => setNewCallOff({ ...newCallOff, reportedVia: e.target.value })}
                  className="theme-input w-full px-3 py-2 text-sm"
                >
                  {REPORT_VIA_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block ui-section-label mb-1.5">Reason</label>
                <textarea
                  value={newCallOff.reason}
                  onChange={(e) => setNewCallOff({ ...newCallOff, reason: e.target.value })}
                  rows={2}
                  className="theme-input w-full px-3 py-2 text-sm"
                  placeholder="Reason for calling off..."
                />
              </div>

              <div>
                <label className="block ui-section-label mb-1.5">Manager Notes (optional)</label>
                <textarea
                  value={newCallOff.managerNotes}
                  onChange={(e) => setNewCallOff({ ...newCallOff, managerNotes: e.target.value })}
                  rows={2}
                  className="theme-input w-full px-3 py-2 text-sm"
                  placeholder="Additional notes..."
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewCallOff({
                      personnelId: "",
                      date: new Date().toISOString().split("T")[0],
                      reason: "",
                      reportedVia: "phone",
                      managerNotes: "",
                    });
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleAddManual}
                  disabled={isProcessing || !newCallOff.personnelId || !newCallOff.reason}
                >
                  Add Call-Off
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CallOffsPage() {
  return (
    <Protected>
      <CallOffsContent />
    </Protected>
  );
}
