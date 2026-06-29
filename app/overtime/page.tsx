"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";

// Get next Saturday
function getNextSaturday(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
  const nextSaturday = new Date(today);
  nextSaturday.setDate(today.getDate() + daysUntilSaturday);
  return nextSaturday.toISOString().split("T")[0];
}

function OvertimeContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<Id<"overtimeOffers"> | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Form state
  const [offerForm, setOfferForm] = useState({
    date: getNextSaturday(),
    title: "",
    description: "",
    startTime: "06:00",
    endTime: "14:30",
    maxSlots: "",
    targetType: "all" as "all" | "department" | "location",
    department: "",
    locationId: "" as string,
    sendNotification: true,
  });

  const [isCreating, setIsCreating] = useState(false);

  // Queries
  const offers = useQuery(api.overtime.listOffers, {
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const selectedOfferDetails = useQuery(
    api.overtime.getOfferById,
    selectedOffer ? { offerId: selectedOffer } : "skip"
  );
  const locations = useQuery(api.locations.list);
  const departments = ["Shipping", "Receiving", "Inventory", "Purchases", "Janitorial", "Warehouse", "Ecommerce", "Retail"];

  // Mutations
  const createOffer = useMutation(api.overtime.createOffer);
  const closeOffer = useMutation(api.overtime.closeOffer);
  const cancelOffer = useMutation(api.overtime.cancelOffer);
  const reopenOffer = useMutation(api.overtime.reopenOffer);
  const deleteOffer = useMutation(api.overtime.deleteOffer);
  const sendReminders = useMutation(api.overtime.sendReminders);

  // Generate default title based on date
  const generateTitle = (date: string) => {
    const d = new Date(date + "T12:00:00");
    return `Saturday Overtime - ${d.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`;
  };

  // Handle form date change
  const handleDateChange = (date: string) => {
    setOfferForm({
      ...offerForm,
      date,
      title: offerForm.title || generateTitle(date),
    });
  };

  // Handle create
  const handleCreate = async () => {
    if (!user) return;
    setIsCreating(true);
    try {
      await createOffer({
        date: offerForm.date,
        title: offerForm.title || generateTitle(offerForm.date),
        description: offerForm.description || undefined,
        startTime: offerForm.startTime,
        endTime: offerForm.endTime,
        maxSlots: offerForm.maxSlots ? parseInt(offerForm.maxSlots) : undefined,
        targetType: offerForm.targetType,
        department: offerForm.targetType === "department" ? offerForm.department : undefined,
        locationId: offerForm.targetType === "location" ? offerForm.locationId as Id<"locations"> : undefined,
        sendNotification: offerForm.sendNotification,
        userId: user._id,
      });
      setShowCreateModal(false);
      setOfferForm({
        date: getNextSaturday(),
        title: "",
        description: "",
        startTime: "06:00",
        endTime: "14:30",
        maxSlots: "",
        targetType: "all",
        department: "",
        locationId: "",
        sendNotification: true,
      });
    } catch (error) {
      console.error("Failed to create offer:", error);
      alert("Failed to create overtime offer");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className={`flex min-h-screen ${isDark ? "bg-[#0f172a]" : "bg-gray-50"}`}>
      <Sidebar />
      <main className="flex-1">
        <MobileHeader />
        <div className="p-4 lg:p-8">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                Saturday Overtime
              </h1>
              <p className={`mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Offer optional overtime and track employee responses
              </p>
            </div>
            <button
              onClick={() => {
                setOfferForm({
                  ...offerForm,
                  date: getNextSaturday(),
                  title: generateTitle(getNextSaturday()),
                });
                setShowCreateModal(true);
              }}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                isDark
                  ? "bg-cyan-500 hover:bg-cyan-400 text-white"
                  : "bg-cyan-600 hover:bg-cyan-700 text-white"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Create Overtime Offer
            </button>
          </div>

          {/* Filters */}
          <div className="mb-6">
            <div className="flex flex-wrap gap-2">
              {["all", "open", "closed", "cancelled"].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === status
                      ? isDark
                        ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/50"
                        : "bg-cyan-100 text-cyan-700 border border-cyan-300"
                      : isDark
                        ? "bg-slate-800 text-slate-400 hover:bg-slate-700"
                        : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
                  }`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Main Content - Split View */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Offers List */}
            <div className="lg:col-span-1">
              <div className={`rounded-xl ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                <div className={`p-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                  <h2 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                    Overtime Offers
                  </h2>
                </div>
                <div className="max-h-[600px] overflow-y-auto">
                  {offers && offers.length > 0 ? (
                    <div className="divide-y divide-slate-700/50">
                      {offers.map((offer) => (
                        <button
                          key={offer._id}
                          onClick={() => setSelectedOffer(offer._id)}
                          className={`w-full p-4 text-left transition-colors ${
                            selectedOffer === offer._id
                              ? isDark
                                ? "bg-cyan-500/10 border-l-2 border-cyan-500"
                                : "bg-cyan-50 border-l-2 border-cyan-500"
                              : isDark
                                ? "hover:bg-slate-700/50"
                                : "hover:bg-gray-50"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              {new Date(offer.date + "T12:00:00").toLocaleDateString("en-US", {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              offer.status === "open"
                                ? "bg-green-500/20 text-green-400"
                                : offer.status === "closed"
                                  ? "bg-slate-500/20 text-slate-400"
                                  : "bg-red-500/20 text-red-400"
                            }`}>
                              {offer.status}
                            </span>
                          </div>
                          <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            {offer.startTime} - {offer.endTime}
                          </p>
                          <div className={`mt-2 flex gap-3 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            <span className="text-green-400">{offer.responseStats.accepted} accepted</span>
                            <span className="text-red-400">{offer.responseStats.declined} declined</span>
                            <span className="text-amber-400">{offer.responseStats.pending} pending</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className={`p-8 text-center ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p>No overtime offers found</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Selected Offer Details */}
            <div className="lg:col-span-2">
              {selectedOfferDetails ? (
                <div className={`rounded-xl ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                  {/* Header */}
                  <div className={`p-6 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <h2 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                          {selectedOfferDetails.title}
                        </h2>
                        <p className={`mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {new Date(selectedOfferDetails.date + "T12:00:00").toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {selectedOfferDetails.status === "open" && (
                          <>
                            <button
                              onClick={async () => {
                                if (confirm("Send reminder to employees who haven't responded?")) {
                                  await sendReminders({ offerId: selectedOfferDetails._id, userId: user!._id });
                                  alert("Reminders sent!");
                                }
                              }}
                              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                                isDark
                                  ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                                  : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                              }`}
                            >
                              Send Reminders
                            </button>
                            <button
                              onClick={async () => {
                                if (confirm("Close this offer? No more responses will be accepted.")) {
                                  await closeOffer({ offerId: selectedOfferDetails._id, userId: user!._id });
                                }
                              }}
                              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                                isDark
                                  ? "bg-slate-600 text-white hover:bg-slate-500"
                                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                              }`}
                            >
                              Close
                            </button>
                          </>
                        )}
                        {selectedOfferDetails.status === "closed" && (
                          <button
                            onClick={async () => {
                              await reopenOffer({ offerId: selectedOfferDetails._id, userId: user!._id });
                            }}
                            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                              isDark
                                ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                                : "bg-green-100 text-green-700 hover:bg-green-200"
                            }`}
                          >
                            Reopen
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            if (confirm("Delete this overtime offer? This cannot be undone.")) {
                              await deleteOffer({ offerId: selectedOfferDetails._id, userId: user!._id });
                              setSelectedOffer(null);
                            }
                          }}
                          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                            isDark
                              ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                              : "bg-red-100 text-red-700 hover:bg-red-200"
                          }`}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Details */}
                  <div className={`p-6 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <p className={`text-xs uppercase tracking-wide ${isDark ? "text-slate-500" : "text-gray-400"}`}>Time</p>
                        <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                          {selectedOfferDetails.startTime} - {selectedOfferDetails.endTime}
                        </p>
                      </div>
                      <div>
                        <p className={`text-xs uppercase tracking-wide ${isDark ? "text-slate-500" : "text-gray-400"}`}>Max Slots</p>
                        <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                          {selectedOfferDetails.maxSlots || "Unlimited"}
                        </p>
                      </div>
                      <div>
                        <p className={`text-xs uppercase tracking-wide ${isDark ? "text-slate-500" : "text-gray-400"}`}>Target</p>
                        <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                          {selectedOfferDetails.targetType === "all" ? "All Employees" :
                           selectedOfferDetails.targetType === "department" ? selectedOfferDetails.department :
                           selectedOfferDetails.locationName || "Specific"}
                        </p>
                      </div>
                    </div>
                    <p className={`mt-3 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      Overtime rate: 1.5x for hours over 40/week
                    </p>
                    {selectedOfferDetails.description && (
                      <p className={`mt-4 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                        {selectedOfferDetails.description}
                      </p>
                    )}
                  </div>

                  {/* Response Stats */}
                  <div className={`p-6 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                    <div className="grid grid-cols-3 gap-4">
                      <div className={`p-4 rounded-lg ${isDark ? "bg-green-500/10" : "bg-green-50"}`}>
                        <p className={`text-2xl font-bold text-green-500`}>
                          {selectedOfferDetails.responses.filter(r => r.response === "accepted").length}
                        </p>
                        <p className={`text-sm ${isDark ? "text-green-400/70" : "text-green-600"}`}>Accepted</p>
                      </div>
                      <div className={`p-4 rounded-lg ${isDark ? "bg-red-500/10" : "bg-red-50"}`}>
                        <p className={`text-2xl font-bold text-red-500`}>
                          {selectedOfferDetails.responses.filter(r => r.response === "declined").length}
                        </p>
                        <p className={`text-sm ${isDark ? "text-red-400/70" : "text-red-600"}`}>Declined</p>
                      </div>
                      <div className={`p-4 rounded-lg ${isDark ? "bg-amber-500/10" : "bg-amber-50"}`}>
                        <p className={`text-2xl font-bold text-amber-500`}>
                          {selectedOfferDetails.responses.filter(r => r.response === "pending").length}
                        </p>
                        <p className={`text-sm ${isDark ? "text-amber-400/70" : "text-amber-600"}`}>Pending</p>
                      </div>
                    </div>
                  </div>

                  {/* Responses List */}
                  <div className="p-6">
                    <h3 className={`font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                      Employee Responses
                    </h3>
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {selectedOfferDetails.responses.map((response) => (
                        <div
                          key={response._id}
                          className={`p-3 rounded-lg flex items-center justify-between ${
                            isDark ? "bg-slate-700/50" : "bg-gray-50"
                          }`}
                        >
                          <div>
                            <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              {response.personnelName}
                            </p>
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {response.personnelDepartment}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            {response.respondedAt && (
                              <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                                {new Date(response.respondedAt).toLocaleDateString()}
                              </span>
                            )}
                            <span className={`px-3 py-1 text-sm rounded-full font-medium ${
                              response.response === "accepted"
                                ? "bg-green-500/20 text-green-400"
                                : response.response === "declined"
                                  ? "bg-red-500/20 text-red-400"
                                  : "bg-amber-500/20 text-amber-400"
                            }`}>
                              {response.response}
                            </span>
                          </div>
                        </div>
                      ))}
                      {selectedOfferDetails.responses.length === 0 && (
                        <p className={`text-center py-4 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          No responses yet
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`rounded-xl p-12 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <svg className={`w-16 h-16 mx-auto mb-4 ${isDark ? "text-slate-600" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className={`text-lg font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Select an overtime offer to view details
                  </p>
                  <p className={`mt-2 text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Or create a new one to get started
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Create Overtime Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className={`w-full max-w-xl rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <div className="flex items-center justify-between mb-6">
                <h2 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Create Overtime Offer
                </h2>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                {/* Date */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Date
                  </label>
                  <input
                    type="date"
                    value={offerForm.date}
                    onChange={(e) => handleDateChange(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    className={`w-full px-4 py-2 rounded-lg border ${
                      isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"
                    }`}
                  />
                </div>

                {/* Title */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Title
                  </label>
                  <input
                    type="text"
                    value={offerForm.title}
                    onChange={(e) => setOfferForm({ ...offerForm, title: e.target.value })}
                    placeholder="e.g., Saturday Overtime - January 18th"
                    className={`w-full px-4 py-2 rounded-lg border ${
                      isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400" : "bg-white border-gray-300 text-gray-900"
                    }`}
                  />
                </div>

                {/* Time */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Start Time
                    </label>
                    <input
                      type="time"
                      value={offerForm.startTime}
                      onChange={(e) => setOfferForm({ ...offerForm, startTime: e.target.value })}
                      className={`w-full px-4 py-2 rounded-lg border ${
                        isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"
                      }`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      End Time
                    </label>
                    <input
                      type="time"
                      value={offerForm.endTime}
                      onChange={(e) => setOfferForm({ ...offerForm, endTime: e.target.value })}
                      className={`w-full px-4 py-2 rounded-lg border ${
                        isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"
                      }`}
                    />
                  </div>
                </div>

                {/* Max Slots */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Max Slots (optional)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={offerForm.maxSlots}
                    onChange={(e) => setOfferForm({ ...offerForm, maxSlots: e.target.value })}
                    placeholder="Unlimited"
                    className={`w-full px-4 py-2 rounded-lg border ${
                      isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400" : "bg-white border-gray-300 text-gray-900"
                    }`}
                  />
                  <p className={`mt-1 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Overtime is calculated as 1.5x for hours over 40/week
                  </p>
                </div>

                {/* Target */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Who should receive this offer?
                  </label>
                  <select
                    value={offerForm.targetType}
                    onChange={(e) => setOfferForm({ ...offerForm, targetType: e.target.value as "all" | "department" | "location" })}
                    className={`w-full px-4 py-2 rounded-lg border ${
                      isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"
                    }`}
                  >
                    <option value="all">All Employees</option>
                    <option value="department">Specific Department</option>
                    <option value="location">Specific Location</option>
                  </select>
                </div>

                {/* Department selector */}
                {offerForm.targetType === "department" && (
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Department
                    </label>
                    <select
                      value={offerForm.department}
                      onChange={(e) => setOfferForm({ ...offerForm, department: e.target.value })}
                      className={`w-full px-4 py-2 rounded-lg border ${
                        isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"
                      }`}
                    >
                      <option value="">Select department...</option>
                      {departments.map((dept) => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Location selector */}
                {offerForm.targetType === "location" && (
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Location
                    </label>
                    <select
                      value={offerForm.locationId}
                      onChange={(e) => setOfferForm({ ...offerForm, locationId: e.target.value })}
                      className={`w-full px-4 py-2 rounded-lg border ${
                        isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"
                      }`}
                    >
                      <option value="">Select location...</option>
                      {locations?.map((loc) => (
                        <option key={loc._id} value={loc._id}>{loc.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Description */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Description (optional)
                  </label>
                  <textarea
                    value={offerForm.description}
                    onChange={(e) => setOfferForm({ ...offerForm, description: e.target.value })}
                    placeholder="Additional details about the overtime shift..."
                    rows={3}
                    className={`w-full px-4 py-2 rounded-lg border ${
                      isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400" : "bg-white border-gray-300 text-gray-900"
                    }`}
                  />
                </div>

                {/* Send Notification Toggle */}
                <div className={`p-4 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={offerForm.sendNotification}
                      onChange={(e) => setOfferForm({ ...offerForm, sendNotification: e.target.checked })}
                      className="w-5 h-5 rounded border-slate-500 text-cyan-500 focus:ring-cyan-500"
                    />
                    <div>
                      <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                        Send push notification
                      </p>
                      <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Notify employees immediately via mobile app
                      </p>
                    </div>
                  </label>
                </div>

                {/* Commitment Notice */}
                <div className={`p-4 rounded-lg border ${isDark ? "bg-amber-500/10 border-amber-500/30" : "bg-amber-50 border-amber-200"}`}>
                  <div className="flex gap-3">
                    <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${isDark ? "text-amber-400" : "text-amber-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <p className={`text-sm font-medium ${isDark ? "text-amber-300" : "text-amber-800"}`}>
                        Commitment Policy
                      </p>
                      <p className={`text-xs mt-1 ${isDark ? "text-amber-400/80" : "text-amber-700"}`}>
                        Employees will be shown a notice that accepting overtime is a commitment.
                        Not showing up for an accepted shift will be treated as a No Call/No Show.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                    isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={isCreating || !offerForm.date}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                    isDark
                      ? "bg-cyan-500 hover:bg-cyan-400 text-white disabled:opacity-50"
                      : "bg-cyan-600 hover:bg-cyan-700 text-white disabled:opacity-50"
                  }`}
                >
                  {isCreating ? "Creating..." : "Create Offer"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function OvertimePage() {
  return (
    <Protected>
      <OvertimeContent />
    </Protected>
  );
}
