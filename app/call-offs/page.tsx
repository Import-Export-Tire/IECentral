"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";

const REPORT_VIA_OPTIONS = [
  { value: "app", label: "App" },
  { value: "phone", label: "Phone Call" },
  { value: "text", label: "Text Message" },
  { value: "in_person", label: "In Person" },
  { value: "other", label: "Other" },
];

function CallOffsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
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
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Header */}
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                Call-Offs
              </h1>
              <p className={`text-xs sm:text-sm mt-1 hidden sm:block ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Track and manage employee call-offs
              </p>
            </div>
            <button
              onClick={() => setShowAddForm(true)}
              className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition-colors flex-shrink-0 ${
                isDark
                  ? "bg-cyan-500 hover:bg-cyan-400 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              <span className="hidden sm:inline">Add Call-Off</span>
              <span className="sm:hidden">Add</span>
            </button>
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <div className={`rounded-lg p-2 sm:p-4 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <p className={`text-lg sm:text-2xl font-bold text-amber-400`}>{stats.todayCount}</p>
              <p className={`text-[10px] sm:text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>Today</p>
            </div>
            <div className={`rounded-lg p-2 sm:p-4 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <p className={`text-lg sm:text-2xl font-bold text-red-400`}>{stats.unacknowledgedCount}</p>
              <p className={`text-[10px] sm:text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>Unacknowledged</p>
            </div>
            <div className={`rounded-lg p-2 sm:p-4 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <p className={`text-lg sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{stats.thisWeekCount}</p>
              <p className={`text-[10px] sm:text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>This Week</p>
            </div>
          </div>

          {/* Tabs and Search */}
          <div className={`rounded-lg p-3 sm:p-4 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search by name or department..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${
                    isDark
                      ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400"
                      : "bg-white border-gray-300 text-gray-900 placeholder-gray-500"
                  }`}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab("today")}
                  className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab === "today"
                      ? isDark
                        ? "bg-cyan-500 text-white"
                        : "bg-blue-600 text-white"
                      : isDark
                        ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Today
                  {stats.todayCount > 0 && (
                    <span className="ml-1.5 bg-amber-500 text-white px-1.5 py-0.5 rounded-full text-xs">
                      {stats.todayCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab("unacknowledged")}
                  className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab === "unacknowledged"
                      ? isDark
                        ? "bg-cyan-500 text-white"
                        : "bg-blue-600 text-white"
                      : isDark
                        ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Unacknowledged
                  {stats.unacknowledgedCount > 0 && (
                    <span className="ml-1.5 bg-red-500 text-white px-1.5 py-0.5 rounded-full text-xs">
                      {stats.unacknowledgedCount}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Call-Offs List */}
          <div className={`rounded-lg overflow-hidden ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
            {filteredCallOffs.length === 0 ? (
              <div className="p-8 text-center">
                <svg
                  className={`w-12 h-12 mx-auto mb-3 ${isDark ? "text-slate-600" : "text-gray-300"}`}
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
                <p className={isDark ? "text-slate-400" : "text-gray-500"}>
                  {activeTab === "today" ? "No call-offs today" : "All call-offs acknowledged"}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-700">
                {filteredCallOffs.map((callOff) => (
                  <div
                    key={callOff._id}
                    className={`p-4 ${isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"} transition-colors`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                            {callOff.personnelName}
                          </h3>
                          {!callOff.acknowledgedAt && (
                            <span className="text-xs px-2 py-0.5 rounded-full border bg-red-500/20 text-red-400 border-red-500/30">
                              Unacknowledged
                            </span>
                          )}
                          {callOff.acknowledgedAt && (
                            <span className="text-xs px-2 py-0.5 rounded-full border bg-green-500/20 text-green-400 border-green-500/30">
                              Acknowledged
                            </span>
                          )}
                        </div>
                        <div className={`mt-1 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {callOff.personnelDepartment} &bull; {callOff.personnelPosition}
                        </div>
                        <div className={`mt-2 text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          <span className="font-medium">{formatDate(callOff.date)}</span>
                          <span className={`ml-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            via {REPORT_VIA_OPTIONS.find((r) => r.value === callOff.reportedVia)?.label || callOff.reportedVia}
                          </span>
                        </div>
                        <p className={`mt-2 text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                          {callOff.reason}
                        </p>
                        <p className={`mt-2 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          Reported at {formatTimestamp(callOff.reportedAt)}
                          {callOff.acknowledgedAt && callOff.acknowledgerName && (
                            <>
                              <span> &bull; </span>
                              Acknowledged by {callOff.acknowledgerName}
                            </>
                          )}
                        </p>
                        {callOff.managerNotes && (
                          <p className={`mt-1 text-xs italic ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            Note: {callOff.managerNotes}
                          </p>
                        )}
                      </div>

                      {!callOff.acknowledgedAt && (
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            onClick={() => {
                              setSelectedCallOff(callOff._id);
                              setManagerNotes("");
                            }}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                              isDark
                                ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                                : "bg-green-100 text-green-600 hover:bg-green-200"
                            }`}
                          >
                            Acknowledge
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Acknowledge Modal */}
      {selectedCallOff && selectedCallOffData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className={`w-full max-w-md rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
            <h2 className={`text-lg font-bold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
              Acknowledge Call-Off
            </h2>

            <div className="space-y-3 mb-6">
              <div>
                <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Employee:</span>
                <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                  {selectedCallOffData.personnelName}
                </p>
              </div>
              <div>
                <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Date:</span>
                <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                  {formatDate(selectedCallOffData.date)}
                </p>
              </div>
              <div>
                <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Reason:</span>
                <p className={`${isDark ? "text-white" : "text-gray-900"}`}>
                  {selectedCallOffData.reason}
                </p>
              </div>
            </div>

            <div className="mb-6">
              <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                Manager Notes (optional)
              </label>
              <textarea
                value={managerNotes}
                onChange={(e) => setManagerNotes(e.target.value)}
                rows={3}
                className={`w-full px-3 py-2 rounded-lg border text-sm ${
                  isDark
                    ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400"
                    : "bg-white border-gray-300 text-gray-900 placeholder-gray-500"
                }`}
                placeholder="Add notes about this call-off..."
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSelectedCallOff(null);
                  setManagerNotes("");
                }}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  isDark
                    ? "bg-slate-700 hover:bg-slate-600 text-slate-300"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                }`}
              >
                Cancel
              </button>
              <button
                onClick={() => handleAcknowledge(selectedCallOff)}
                disabled={isProcessing}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  isDark
                    ? "bg-green-500 hover:bg-green-400 text-white"
                    : "bg-green-600 hover:bg-green-700 text-white"
                } disabled:opacity-50`}
              >
                Acknowledge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Manual Call-Off Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className={`w-full max-w-md rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
            <h2 className={`text-lg font-bold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
              Add Call-Off
            </h2>

            <div className="space-y-4 mb-6">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Employee
                </label>
                <select
                  value={newCallOff.personnelId}
                  onChange={(e) => setNewCallOff({ ...newCallOff, personnelId: e.target.value })}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${
                    isDark
                      ? "bg-slate-700 border-slate-600 text-white"
                      : "bg-white border-gray-300 text-gray-900"
                  }`}
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
                <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Date
                </label>
                <input
                  type="date"
                  value={newCallOff.date}
                  onChange={(e) => setNewCallOff({ ...newCallOff, date: e.target.value })}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${
                    isDark
                      ? "bg-slate-700 border-slate-600 text-white"
                      : "bg-white border-gray-300 text-gray-900"
                  }`}
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Reported Via
                </label>
                <select
                  value={newCallOff.reportedVia}
                  onChange={(e) => setNewCallOff({ ...newCallOff, reportedVia: e.target.value })}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${
                    isDark
                      ? "bg-slate-700 border-slate-600 text-white"
                      : "bg-white border-gray-300 text-gray-900"
                  }`}
                >
                  {REPORT_VIA_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Reason
                </label>
                <textarea
                  value={newCallOff.reason}
                  onChange={(e) => setNewCallOff({ ...newCallOff, reason: e.target.value })}
                  rows={2}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${
                    isDark
                      ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400"
                      : "bg-white border-gray-300 text-gray-900 placeholder-gray-500"
                  }`}
                  placeholder="Reason for calling off..."
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Manager Notes (optional)
                </label>
                <textarea
                  value={newCallOff.managerNotes}
                  onChange={(e) => setNewCallOff({ ...newCallOff, managerNotes: e.target.value })}
                  rows={2}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${
                    isDark
                      ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400"
                      : "bg-white border-gray-300 text-gray-900 placeholder-gray-500"
                  }`}
                  placeholder="Additional notes..."
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
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
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  isDark
                    ? "bg-slate-700 hover:bg-slate-600 text-slate-300"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleAddManual}
                disabled={isProcessing || !newCallOff.personnelId || !newCallOff.reason}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  isDark
                    ? "bg-cyan-500 hover:bg-cyan-400 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                } disabled:opacity-50`}
              >
                Add Call-Off
              </button>
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
