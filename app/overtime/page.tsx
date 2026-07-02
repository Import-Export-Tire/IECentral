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

  // Status filter badge map
  const statusBadgeClass: Record<string, string> = {
    open: "ui-badge ui-badge-green",
    closed: "ui-badge ui-badge-gray",
    cancelled: "ui-badge ui-badge-red",
  };

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Sticky iOS-style page header */}
        <header className="flex-shrink-0 sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary truncate">
                Saturday Overtime
              </h1>
              <p className="text-xs sm:text-sm mt-0.5 hidden sm:block theme-text-tertiary">
                Offer optional overtime and track employee responses
              </p>
            </div>
            <Button
              variant="primary"
              onClick={() => {
                setOfferForm({
                  ...offerForm,
                  date: getNextSaturday(),
                  title: generateTitle(getNextSaturday()),
                });
                setShowCreateModal(true);
              }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              <span className="hidden sm:inline">Create Overtime Offer</span>
              <span className="sm:hidden">Create</span>
            </Button>
          </div>

          {/* Status filter tabs */}
          <div className="flex flex-wrap gap-2 mt-3">
            {["all", "open", "closed", "cancelled"].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-[9px] text-[13px] font-semibold transition-colors ${
                  statusFilter === status
                    ? "theme-btn-primary"
                    : "ui-btn-ghost"
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        </header>

        <div className="p-4 sm:p-6">
          {/* Main Content - Split View */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Offers List */}
            <div className="lg:col-span-1">
              <Card padding="sm" className="overflow-hidden">
                <div className="px-4 py-3 border-b theme-border-secondary">
                  <h2 className="font-semibold text-[15px] theme-text-primary">Overtime Offers</h2>
                </div>
                <div className="max-h-[600px] overflow-y-auto">
                  {offers && offers.length > 0 ? (
                    <div className="divide-y theme-border-secondary">
                      {offers.map((offer) => (
                        <button
                          key={offer._id}
                          onClick={() => setSelectedOffer(offer._id)}
                          className={`w-full p-4 text-left transition-colors ${
                            selectedOffer === offer._id
                              ? "bg-[#007AFF]/10 border-l-2 border-[#007AFF]"
                              : "hover:bg-gray-50 dark:hover:bg-slate-700/50"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-sm theme-text-primary">
                              {new Date(offer.date + "T12:00:00").toLocaleDateString("en-US", {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                            <span className={statusBadgeClass[offer.status] ?? "ui-badge ui-badge-gray"}>
                              {offer.status}
                            </span>
                          </div>
                          <p className="text-sm theme-text-tertiary">
                            {offer.startTime} – {offer.endTime}
                          </p>
                          <div className="mt-2 flex gap-3 text-xs">
                            <span className="text-green-500 dark:text-green-400">{offer.responseStats.accepted} accepted</span>
                            <span className="text-red-500 dark:text-red-400">{offer.responseStats.declined} declined</span>
                            <span className="text-amber-500 dark:text-amber-400">{offer.responseStats.pending} pending</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center theme-text-tertiary">
                      <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-sm">No overtime offers found</p>
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* Selected Offer Details */}
            <div className="lg:col-span-2">
              {selectedOfferDetails ? (
                <Card padding="sm" className="overflow-hidden">
                  {/* Header */}
                  <div className="px-5 py-4 border-b theme-border-secondary">
                    <SectionHeader
                      title={selectedOfferDetails.title}
                      actions={
                        <div className="flex gap-2 flex-wrap">
                          {selectedOfferDetails.status === "open" && (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={async () => {
                                  if (confirm("Send reminder to employees who haven't responded?")) {
                                    await sendReminders({ offerId: selectedOfferDetails._id, userId: user!._id });
                                    alert("Reminders sent!");
                                  }
                                }}
                              >
                                Send Reminders
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={async () => {
                                  if (confirm("Close this offer? No more responses will be accepted.")) {
                                    await closeOffer({ offerId: selectedOfferDetails._id, userId: user!._id });
                                  }
                                }}
                              >
                                Close
                              </Button>
                            </>
                          )}
                          {selectedOfferDetails.status === "closed" && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={async () => {
                                await reopenOffer({ offerId: selectedOfferDetails._id, userId: user!._id });
                              }}
                            >
                              Reopen
                            </Button>
                          )}
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={async () => {
                              if (confirm("Delete this overtime offer? This cannot be undone.")) {
                                await deleteOffer({ offerId: selectedOfferDetails._id, userId: user!._id });
                                setSelectedOffer(null);
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      }
                    />
                    <p className="text-sm theme-text-tertiary mt-0.5">
                      {new Date(selectedOfferDetails.date + "T12:00:00").toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>

                  {/* Details */}
                  <div className="px-5 py-4 border-b theme-border-secondary">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <p className="ui-section-label">Time</p>
                        <p className="font-medium text-sm theme-text-primary mt-0.5">
                          {selectedOfferDetails.startTime} – {selectedOfferDetails.endTime}
                        </p>
                      </div>
                      <div>
                        <p className="ui-section-label">Max Slots</p>
                        <p className="font-medium text-sm theme-text-primary mt-0.5">
                          {selectedOfferDetails.maxSlots || "Unlimited"}
                        </p>
                      </div>
                      <div>
                        <p className="ui-section-label">Target</p>
                        <p className="font-medium text-sm theme-text-primary mt-0.5">
                          {selectedOfferDetails.targetType === "all" ? "All Employees" :
                           selectedOfferDetails.targetType === "department" ? selectedOfferDetails.department :
                           selectedOfferDetails.locationName || "Specific"}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs theme-text-tertiary">
                      Overtime rate: 1.5x for hours over 40/week
                    </p>
                    {selectedOfferDetails.description && (
                      <p className="mt-3 text-sm theme-text-secondary">
                        {selectedOfferDetails.description}
                      </p>
                    )}
                  </div>

                  {/* Response Stats */}
                  <div className="px-5 py-4 border-b theme-border-secondary">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="ui-callout-green rounded-xl p-4 text-center">
                        <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                          {selectedOfferDetails.responses.filter(r => r.response === "accepted").length}
                        </p>
                        <p className="text-sm text-green-700 dark:text-green-400/80 mt-0.5">Accepted</p>
                      </div>
                      <div className="ui-callout-red rounded-xl p-4 text-center">
                        <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                          {selectedOfferDetails.responses.filter(r => r.response === "declined").length}
                        </p>
                        <p className="text-sm text-red-700 dark:text-red-400/80 mt-0.5">Declined</p>
                      </div>
                      <div className="ui-callout-amber rounded-xl p-4 text-center">
                        <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                          {selectedOfferDetails.responses.filter(r => r.response === "pending").length}
                        </p>
                        <p className="text-sm text-amber-700 dark:text-amber-400/80 mt-0.5">Pending</p>
                      </div>
                    </div>
                  </div>

                  {/* Responses List */}
                  <div className="px-5 py-4">
                    <h3 className="font-semibold text-[15px] theme-text-primary mb-3">Employee Responses</h3>
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {selectedOfferDetails.responses.map((response) => (
                        <div
                          key={response._id}
                          className="px-3 py-3 rounded-xl bg-gray-50 dark:bg-slate-700/50 flex items-center justify-between"
                        >
                          <div>
                            <p className="font-medium text-sm theme-text-primary">
                              {response.personnelName}
                            </p>
                            <p className="text-xs theme-text-tertiary mt-0.5">
                              {response.personnelDepartment}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            {response.respondedAt && (
                              <span className="text-xs theme-text-tertiary">
                                {new Date(response.respondedAt).toLocaleDateString()}
                              </span>
                            )}
                            <span className={
                              response.response === "accepted"
                                ? "ui-badge ui-badge-green"
                                : response.response === "declined"
                                  ? "ui-badge ui-badge-red"
                                  : "ui-badge ui-badge-amber"
                            }>
                              {response.response}
                            </span>
                          </div>
                        </div>
                      ))}
                      {selectedOfferDetails.responses.length === 0 && (
                        <p className="text-center py-4 text-sm theme-text-tertiary">
                          No responses yet
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              ) : (
                <Card>
                  <div className="py-12 text-center">
                    <svg className="w-16 h-16 mx-auto mb-4 theme-text-tertiary opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-[17px] font-semibold theme-text-secondary">
                      Select an overtime offer to view details
                    </p>
                    <p className="mt-1 text-sm theme-text-tertiary">
                      Or create a new one to get started
                    </p>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </div>

        {/* Create Overtime Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-xl rounded-2xl border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
              <div className="flex items-center justify-between px-5 py-4 border-b theme-border-secondary">
                <h2 className="text-[17px] font-semibold theme-text-primary">Create Overtime Offer</h2>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="p-2 rounded-lg theme-text-tertiary hover:theme-text-primary hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
                {/* Date */}
                <div>
                  <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">Date</label>
                  <input
                    type="date"
                    value={offerForm.date}
                    onChange={(e) => handleDateChange(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    className="theme-input w-full px-3 py-2.5 text-sm"
                  />
                </div>

                {/* Title */}
                <div>
                  <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">Title</label>
                  <input
                    type="text"
                    value={offerForm.title}
                    onChange={(e) => setOfferForm({ ...offerForm, title: e.target.value })}
                    placeholder="e.g., Saturday Overtime - January 18th"
                    className="theme-input w-full px-3 py-2.5 text-sm"
                  />
                </div>

                {/* Time */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">Start Time</label>
                    <input
                      type="time"
                      value={offerForm.startTime}
                      onChange={(e) => setOfferForm({ ...offerForm, startTime: e.target.value })}
                      className="theme-input w-full px-3 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">End Time</label>
                    <input
                      type="time"
                      value={offerForm.endTime}
                      onChange={(e) => setOfferForm({ ...offerForm, endTime: e.target.value })}
                      className="theme-input w-full px-3 py-2.5 text-sm"
                    />
                  </div>
                </div>

                {/* Max Slots */}
                <div>
                  <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">Max Slots (optional)</label>
                  <input
                    type="number"
                    min="1"
                    value={offerForm.maxSlots}
                    onChange={(e) => setOfferForm({ ...offerForm, maxSlots: e.target.value })}
                    placeholder="Unlimited"
                    className="theme-input w-full px-3 py-2.5 text-sm"
                  />
                  <p className="mt-1 text-xs theme-text-tertiary">
                    Overtime is calculated as 1.5x for hours over 40/week
                  </p>
                </div>

                {/* Target */}
                <div>
                  <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">
                    Who should receive this offer?
                  </label>
                  <select
                    value={offerForm.targetType}
                    onChange={(e) => setOfferForm({ ...offerForm, targetType: e.target.value as "all" | "department" | "location" })}
                    className="theme-input w-full px-3 py-2.5 text-sm"
                  >
                    <option value="all">All Employees</option>
                    <option value="department">Specific Department</option>
                    <option value="location">Specific Location</option>
                  </select>
                </div>

                {/* Department selector */}
                {offerForm.targetType === "department" && (
                  <div>
                    <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">Department</label>
                    <select
                      value={offerForm.department}
                      onChange={(e) => setOfferForm({ ...offerForm, department: e.target.value })}
                      className="theme-input w-full px-3 py-2.5 text-sm"
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
                    <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">Location</label>
                    <select
                      value={offerForm.locationId}
                      onChange={(e) => setOfferForm({ ...offerForm, locationId: e.target.value })}
                      className="theme-input w-full px-3 py-2.5 text-sm"
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
                  <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">Description (optional)</label>
                  <textarea
                    value={offerForm.description}
                    onChange={(e) => setOfferForm({ ...offerForm, description: e.target.value })}
                    placeholder="Additional details about the overtime shift..."
                    rows={3}
                    className="theme-input w-full px-3 py-2.5 text-sm"
                  />
                </div>

                {/* Send Notification Toggle */}
                <div className="theme-card p-4 rounded-xl">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={offerForm.sendNotification}
                      onChange={(e) => setOfferForm({ ...offerForm, sendNotification: e.target.checked })}
                      className="w-5 h-5 rounded border-slate-500 text-[#007AFF] focus:ring-[#007AFF]"
                    />
                    <div>
                      <p className="font-medium text-sm theme-text-primary">Send push notification</p>
                      <p className="text-xs theme-text-tertiary mt-0.5">Notify employees immediately via mobile app</p>
                    </div>
                  </label>
                </div>

                {/* Commitment Notice */}
                <div className="ui-callout-amber rounded-xl p-4">
                  <div className="flex gap-3">
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Commitment Policy</p>
                      <p className="text-xs mt-1 text-amber-700 dark:text-amber-400/80">
                        Employees will be shown a notice that accepting overtime is a commitment.
                        Not showing up for an accepted shift will be treated as a No Call/No Show.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 px-5 py-4 border-t theme-border-secondary">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleCreate}
                  disabled={isCreating || !offerForm.date}
                >
                  {isCreating ? "Creating..." : "Create Offer"}
                </Button>
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
