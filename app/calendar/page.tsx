"use client";

import { useState, useMemo, useCallback } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import CalendarHelpModal from "@/components/CalendarHelpModal";

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDateForInput(date: Date): string {
  // Use local time instead of UTC for datetime-local input
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

const MEETING_TYPES = [
  { value: "iecentral", label: "IECentral Meeting", icon: "🎯" },
  { value: "zoom", label: "Zoom", icon: "📹" },
  { value: "teams", label: "Microsoft Teams", icon: "💼" },
  { value: "meet", label: "Google Meet", icon: "🎥" },
  { value: "in_person", label: "In Person", icon: "🏢" },
  { value: "phone", label: "Phone Call", icon: "📞" },
  { value: "other", label: "Other", icon: "🔗" },
];

function CalendarContent() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isDark = theme === "dark";

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"month" | "week" | "day">("month");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Form state for creating/editing events
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    startTime: formatDateForInput(new Date()),
    endTime: formatDateForInput(new Date(Date.now() + 60 * 60 * 1000)),
    isAllDay: false,
    location: "",
    meetingLink: "",
    meetingType: "iecentral",
    inviteeIds: [] as Id<"users">[],
    repeat: "none" as "none" | "daily" | "weekly" | "monthly",
    applyToSeries: false, // when editing a recurring event, also patch siblings
  });
  // When set, the modal is editing this event instead of creating a new one
  const [editingEventId, setEditingEventId] = useState<Id<"events"> | null>(null);
  // Seriesid of the event being edited, if it belongs to a recurring series
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);

  // Get date range for current view
  const dateRange = useMemo(() => {
    const start = new Date(selectedDate);
    const end = new Date(selectedDate);

    if (viewMode === "month") {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(end.getMonth() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
    } else if (viewMode === "week") {
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      start.setHours(0, 0, 0, 0);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    }

    return { start: start.getTime(), end: end.getTime() };
  }, [selectedDate, viewMode]);

  // Queries
  const myEvents = useQuery(
    api.events.listMyEvents,
    user
      ? {
          userId: user._id as Id<"users">,
          startDate: dateRange.start,
          endDate: dateRange.end,
        }
      : "skip"
  );

  const pendingInvites = useQuery(
    api.events.getPendingInvites,
    user ? { userId: user._id as Id<"users"> } : "skip"
  );

  const allUsers = useQuery(api.auth.getAllUsers);
  // Zoom account query
  const zoomAccount = useQuery(api.zoomAccounts.getByUser, user?._id ? { userId: user._id } : "skip");

  // Mutations
  const createEvent = useMutation(api.events.create);
  const createRecurring = useMutation(api.events.createRecurring);
  const cancelSeries = useMutation(api.events.cancelSeries);
  const updateSeries = useMutation(api.events.updateSeries);
  const attachZoomToEvent = useAction(api.zoomMeetings.attachZoomToEvent);
  const updateEvent = useMutation(api.events.update);
  const cancelEvent = useMutation(api.events.cancel);
  const respondToInvite = useMutation(api.events.respondToInvite);
  const markInviteRead = useMutation(api.events.markInviteRead);
  const addInvitees = useMutation(api.events.addInvitees);
  const createMeeting = useMutation(api.meetings.create);

  const [isCreatingEvent, setIsCreatingEvent] = useState(false);

  // State for adding invitees to existing events
  const [showAddInviteesModal, setShowAddInviteesModal] = useState(false);
  const [selectedInviteeIds, setSelectedInviteeIds] = useState<Id<"users">[]>([]);
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedDayDate, setSelectedDayDate] = useState<Date | null>(null);

  // Calendar sharing state
  const [showShareModal, setShowShareModal] = useState(false);
  const [zoomSyncing, setZoomSyncing] = useState(false);
  const [zoomSyncResult, setZoomSyncResult] = useState<{ synced: number; message?: string } | null>(null);

  const handleZoomSync = useCallback(async () => {
    if (!user?._id) return;
    setZoomSyncing(true);
    setZoomSyncResult(null);
    try {
      const res = await fetch("/api/calendar/zoom-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user._id }),
      });
      const data = await res.json();
      setZoomSyncResult({
        synced: data.synced || 0,
        message: data.error || (data.synced > 0 ? `${data.synced} meeting${data.synced > 1 ? "s" : ""} added` : "No new Zoom meetings found"),
      });
    } catch {
      setZoomSyncResult({ synced: 0, message: "Sync failed" });
    } finally {
      setZoomSyncing(false);
    }
  }, [user]);
  const [shareUserId, setShareUserId] = useState<Id<"users"> | "">("");
  const [viewingSharedCalendar, setViewingSharedCalendar] = useState<Id<"users"> | null>(null);

  // Calendar sharing queries
  const sharedWithMe = useQuery(
    api.events.getSharedWithMe,
    user ? { userId: user._id as Id<"users"> } : "skip"
  );
  const myShares = useQuery(
    api.events.getMyShares,
    user ? { userId: user._id as Id<"users"> } : "skip"
  );
  const sharedCalendarEvents = useQuery(
    api.events.getSharedCalendarEvents,
    user && viewingSharedCalendar
      ? {
          userId: user._id as Id<"users">,
          sharedOwnerId: viewingSharedCalendar,
          startDate: dateRange.start,
          endDate: dateRange.end,
        }
      : "skip"
  );

  // Calendar sharing mutations
  const shareCalendar = useMutation(api.events.shareCalendar);
  const removeCalendarShare = useMutation(api.events.removeCalendarShare);

  // Calendar grid for month view
  const calendarDays = useMemo(() => {
    const days = [];
    const firstDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const lastDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    const startPadding = firstDay.getDay();

    // Add padding for previous month
    for (let i = startPadding - 1; i >= 0; i--) {
      const d = new Date(firstDay);
      d.setDate(d.getDate() - i - 1);
      days.push({ date: d, isCurrentMonth: false });
    }

    // Add days of current month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({
        date: new Date(selectedDate.getFullYear(), selectedDate.getMonth(), i),
        isCurrentMonth: true,
      });
    }

    // Add padding for next month
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(lastDay);
      d.setDate(d.getDate() + i);
      days.push({ date: d, isCurrentMonth: false });
    }

    return days;
  }, [selectedDate]);

  // Get events for a specific day — overlap semantics so a multi-day event
  // appears on every day it spans, not just its start day.
  const getEventsForDay = (date: Date) => {
    const events = viewingSharedCalendar ? sharedCalendarEvents : myEvents;
    if (!events) return [];
    const dayStart = new Date(date).setHours(0, 0, 0, 0);
    const dayEnd = new Date(date).setHours(23, 59, 59, 999);
    return events.filter(
      (e: any) => e.startTime <= dayEnd && e.endTime >= dayStart
    );
  };

  const handleStartEdit = (event: any) => {
    setEditingEventId(event._id);
    setEditingSeriesId(event.seriesId || null);
    setFormData({
      title: event.title || "",
      description: event.description || "",
      startTime: formatDateForInput(new Date(event.startTime)),
      endTime: formatDateForInput(new Date(event.endTime)),
      isAllDay: !!event.isAllDay,
      location: event.location || "",
      meetingLink: event.meetingLink || "",
      meetingType: event.meetingType || "in_person",
      inviteeIds: (event.invitees || []).map((inv: any) => inv.userId as Id<"users">),
      repeat: "none", // editing one occurrence, not the series
      applyToSeries: false,
    });
    setShowEventModal(false);
    setShowCreateModal(true);
  };

  const handleSubmitEvent = async () => {
    if (!user || !formData.title) return;

    setIsCreatingEvent(true);
    try {
      const startTimestamp = new Date(formData.startTime).getTime();
      const endTimestamp = new Date(formData.endTime).getTime();

      // EDIT MODE — patch the existing event and exit
      if (editingEventId) {
        await updateEvent({
          eventId: editingEventId,
          title: formData.title,
          description: formData.description || undefined,
          startTime: startTimestamp,
          endTime: endTimestamp,
          isAllDay: formData.isAllDay,
          location: formData.location || undefined,
          meetingLink: formData.meetingLink || undefined,
          meetingType: formData.meetingType || undefined,
          requestingUserId: user._id as Id<"users">,
        });
        // Also propagate metadata fields to every other occurrence in the
        // series — start/end stay per-occurrence so each instance keeps
        // its own schedule.
        if (editingSeriesId && formData.applyToSeries) {
          await updateSeries({
            seriesId: editingSeriesId,
            title: formData.title,
            description: formData.description || undefined,
            isAllDay: formData.isAllDay,
            location: formData.location || undefined,
            meetingLink: formData.meetingLink || undefined,
            meetingType: formData.meetingType || undefined,
            requestingUserId: user._id as Id<"users">,
          });
        }
        setShowCreateModal(false);
        resetForm();
        return;
      }

      let meetingLink = formData.meetingLink || undefined;
      let meetingType = formData.meetingType || undefined;
      const isRepeating = formData.repeat !== "none";
      // Default series length: 30 for daily, 12 for weekly/monthly
      const repeatCount =
        formData.repeat === "daily" ? 30 :
        formData.repeat === "weekly" ? 12 :
        formData.repeat === "monthly" ? 12 : 1;

      // If IECentral Meeting is selected, create a meeting room first.
      // For recurring series, every occurrence shares one room.
      if (formData.meetingType === "iecentral") {
        const eventId = await createEvent({
          title: formData.title,
          description: formData.description || undefined,
          startTime: startTimestamp,
          endTime: endTimestamp,
          isAllDay: formData.isAllDay,
          location: formData.location || undefined,
          meetingLink: undefined,
          meetingType: "iecentral",
          inviteeIds: formData.inviteeIds,
          userId: user._id as Id<"users">,
        });

        const meetingId = await createMeeting({
          title: formData.title,
          userId: user._id as Id<"users">,
          scheduledStart: startTimestamp,
          scheduledEnd: endTimestamp,
          isNotedMeeting: false,
          eventId: eventId,
        });

        const roomLink = `/meetings/room/${meetingId}`;
        await updateEvent({ eventId, meetingLink: roomLink, requestingUserId: user._id as Id<"users"> });

        // Generate sibling occurrences — shift start/end one period forward
        // so the series begins AFTER the event we just inserted.
        if (isRepeating && repeatCount > 1) {
          const shift = (ms: number) => {
            const d = new Date(ms);
            if (formData.repeat === "daily") d.setDate(d.getDate() + 1);
            else if (formData.repeat === "weekly") d.setDate(d.getDate() + 7);
            else if (formData.repeat === "monthly") d.setMonth(d.getMonth() + 1);
            return d.getTime();
          };
          await createRecurring({
            title: formData.title,
            description: formData.description || undefined,
            startTime: shift(startTimestamp),
            endTime: shift(endTimestamp),
            isAllDay: formData.isAllDay,
            location: formData.location || undefined,
            meetingLink: roomLink,
            meetingType: "iecentral",
            inviteeIds: formData.inviteeIds,
            userId: user._id as Id<"users">,
            recurrence: formData.repeat,
            count: repeatCount - 1,
          });
        }

        setShowCreateModal(false);
        resetForm();
        setIsCreatingEvent(false);
        return;
      }

      const wantsZoomAuto = formData.meetingType === "zoom" && !!zoomAccount;
      let createdEventIds: Id<"events">[] = [];

      if (isRepeating) {
        const res = (await createRecurring({
          title: formData.title,
          description: formData.description || undefined,
          startTime: startTimestamp,
          endTime: endTimestamp,
          isAllDay: formData.isAllDay,
          location: formData.location || undefined,
          // When Zoom auto-create runs, every occurrence gets its own link
          // patched in below, so don't seed them with the manual one.
          meetingLink: wantsZoomAuto ? undefined : meetingLink,
          meetingType,
          inviteeIds: formData.inviteeIds,
          userId: user._id as Id<"users">,
          recurrence: formData.repeat,
          count: repeatCount,
        })) as { ids: Id<"events">[]; seriesId: string } | Id<"events">[];
        createdEventIds = Array.isArray(res) ? res : res.ids;
      } else {
        const id = await createEvent({
          title: formData.title,
          description: formData.description || undefined,
          startTime: startTimestamp,
          endTime: endTimestamp,
          isAllDay: formData.isAllDay,
          location: formData.location || undefined,
          meetingLink: wantsZoomAuto ? undefined : meetingLink,
          meetingType,
          inviteeIds: formData.inviteeIds,
          userId: user._id as Id<"users">,
        });
        createdEventIds = [id as Id<"events">];
      }

      // Fire-and-forget: create a unique Zoom meeting per occurrence and
      // patch its meetingLink. Links populate reactively as each API call
      // resolves; user isn't blocked from closing the modal.
      if (wantsZoomAuto && createdEventIds.length > 0) {
        for (const eventId of createdEventIds) {
          attachZoomToEvent({ eventId, userId: user._id as Id<"users"> }).catch((err) => {
            console.error("Zoom attach failed for event", eventId, err);
          });
        }
      }

      setShowCreateModal(false);
      resetForm();
    } catch (err) {
      console.error("Failed to save event:", err);
    } finally {
      setIsCreatingEvent(false);
    }
  };

  const handleRespondToInvite = async (eventId: Id<"events">, status: string) => {
    if (!user) return;
    try {
      await respondToInvite({
        eventId,
        userId: user._id as Id<"users">,
        status,
      });
    } catch (err) {
      console.error("Failed to respond:", err);
    }
  };

  const handleCancelEvent = async (eventId: Id<"events">) => {
    if (!user || !confirm("Are you sure you want to cancel this event?")) return;
    try {
      await cancelEvent({ eventId, userId: user._id as Id<"users"> });
      setShowEventModal(false);
      setSelectedEvent(null);
    } catch (err) {
      console.error("Failed to cancel:", err);
    }
  };

  const handleCancelSeries = async (seriesId: string) => {
    if (!user) return;
    if (!confirm("Cancel EVERY occurrence in this recurring series? This cannot be undone from the UI.")) return;
    try {
      await cancelSeries({ seriesId, userId: user._id as Id<"users"> });
      setShowEventModal(false);
      setSelectedEvent(null);
    } catch (err) {
      console.error("Failed to cancel series:", err);
    }
  };

  const handleAddInvitees = async () => {
    if (!selectedEvent || selectedInviteeIds.length === 0) return;
    if (!user) return;
    try {
      await addInvitees({
        eventId: selectedEvent._id,
        inviteeIds: selectedInviteeIds,
        requestingUserId: user._id as Id<"users">,
      });
      setShowAddInviteesModal(false);
      setSelectedInviteeIds([]);
    } catch (err) {
      console.error("Failed to add invitees:", err);
    }
  };

  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      startTime: formatDateForInput(new Date()),
      endTime: formatDateForInput(new Date(Date.now() + 60 * 60 * 1000)),
      isAllDay: false,
      location: "",
      meetingLink: "",
      meetingType: "iecentral",
      inviteeIds: [],
      repeat: "none",
      applyToSeries: false,
    });
    setEditingEventId(null);
    setEditingSeriesId(null);
  };

  const openEventDetails = async (event: any) => {
    setSelectedEvent(event);
    setShowEventModal(true);
    // Mark as read if it's an invite
    if (user && (event as any).myInviteStatus === "pending") {
      await markInviteRead({
        eventId: event._id,
        userId: user._id as Id<"users">,
      });
    }
  };

  const navigateMonth = (delta: number) => {
    const newDate = new Date(selectedDate);
    newDate.setMonth(newDate.getMonth() + delta);
    setSelectedDate(newDate);
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Mobile Header */}
        <MobileHeader />

        {/* Header */}
        <header
          className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-4 ${
            isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                {viewingSharedCalendar
                  ? `${sharedWithMe?.find((s) => s.ownerId === viewingSharedCalendar)?.ownerName}'s Calendar`
                  : "My Calendar"}
              </h1>
              {pendingInvites && pendingInvites.length > 0 && !viewingSharedCalendar && (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                  {pendingInvites.length} pending
                </span>
              )}
              {/* Shared calendars dropdown */}
              {sharedWithMe && sharedWithMe.length > 0 && (
                <select
                  value={viewingSharedCalendar || ""}
                  onChange={(e) =>
                    setViewingSharedCalendar(
                      e.target.value ? (e.target.value as Id<"users">) : null
                    )
                  }
                  className={`px-3 py-1.5 text-sm rounded-lg border ${
                    isDark
                      ? "bg-slate-800 border-slate-600 text-white"
                      : "bg-white border-gray-300 text-gray-900"
                  }`}
                >
                  <option value="">My Calendar</option>
                  {sharedWithMe.map((share) => (
                    <option key={share._id} value={share.ownerId}>
                      {share.ownerName}&apos;s Calendar
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Zoom Sync */}
              <button
                onClick={handleZoomSync}
                disabled={zoomSyncing}
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 ${
                  isDark ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" : "bg-blue-100 text-blue-700 hover:bg-blue-200"
                }`}
                title="Sync Zoom meetings from email"
              >
                <svg className={`w-4 h-4 ${zoomSyncing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {zoomSyncing ? "Syncing..." : "Sync Zoom"}
              </button>
              {zoomSyncResult && (
                <span className={`text-xs ${zoomSyncResult.synced > 0 ? (isDark ? "text-emerald-400" : "text-emerald-600") : (isDark ? "text-slate-400" : "text-gray-500")}`}>
                  {zoomSyncResult.message}
                </span>
              )}
              {/* Help Button */}
              <CalendarHelpModal isDark={isDark} />
              <button
                onClick={() => setShowShareModal(true)}
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                  isDark
                    ? "bg-slate-700 text-white hover:bg-slate-600"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
                title="Share Calendar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share
              </button>
              {!viewingSharedCalendar && (
                <button
                  onClick={() => {
                    resetForm();
                    setShowCreateModal(true);
                  }}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                    isDark
                      ? "bg-cyan-500 text-white hover:bg-cyan-600"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  + New Event
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8">
          {/* Pending Invites Section */}
          {pendingInvites && pendingInvites.length > 0 && (
            <div className={`mb-6 p-4 rounded-xl border ${isDark ? "bg-amber-500/10 border-amber-500/30" : "bg-amber-50 border-amber-200"}`}>
              <h2 className={`font-semibold mb-3 ${isDark ? "text-amber-400" : "text-amber-800"}`}>
                Pending Invitations
              </h2>
              <div className="space-y-2">
                {pendingInvites.map((invite) => (
                  <div
                    key={invite._id}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      isDark ? "bg-slate-800" : "bg-white"
                    }`}
                  >
                    <div>
                      <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                        {invite.event?.title}
                      </p>
                      <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        {invite.event && formatDate(invite.event.startTime)} at{" "}
                        {invite.event && formatTime(invite.event.startTime)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRespondToInvite(invite.eventId, "accepted")}
                        className="px-3 py-1 text-sm font-medium rounded bg-green-500/20 text-green-400 hover:bg-green-500/30"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleRespondToInvite(invite.eventId, "declined")}
                        className="px-3 py-1 text-sm font-medium rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Calendar Navigation */}
          <div className={`flex items-center justify-between mb-4 p-4 rounded-xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigateMonth(-1)}
                className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-600"}`}
              >
                &larr;
              </button>
              <h2 className={`text-lg font-semibold text-center ${isDark ? "text-white" : "text-gray-900"}`}>
                {selectedDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </h2>
              <button
                onClick={() => navigateMonth(1)}
                className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-600"}`}
              >
                &rarr;
              </button>
            </div>
            <button
              onClick={() => setSelectedDate(new Date())}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            >
              Today
            </button>
          </div>

          {/* Calendar Grid */}
          <div className="overflow-x-auto">
          <div className={`rounded-xl border overflow-hidden min-w-[640px] ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
            {/* Day headers */}
            <div className="grid grid-cols-7">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div
                  key={day}
                  className={`p-2 text-center text-sm font-medium border-b ${isDark ? "bg-slate-700 text-slate-300 border-slate-600" : "bg-gray-50 text-gray-600 border-gray-200"}`}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar days */}
            <div className="grid grid-cols-7">
              {calendarDays.map((day, idx) => {
                const dayEvents = getEventsForDay(day.date);
                const today = isToday(day.date);
                const maxVisibleEvents = 2; // Show 2 events max, then "+X more"
                const hasMore = dayEvents.length > maxVisibleEvents;

                return (
                  <div
                    key={idx}
                    className={`h-[110px] p-1 border-b border-r cursor-pointer transition-colors overflow-hidden ${
                      isDark ? "border-slate-700" : "border-gray-100"
                    } ${
                      day.isCurrentMonth
                        ? isDark ? "bg-slate-800" : "bg-white"
                        : isDark ? "bg-slate-800/50" : "bg-gray-50"
                    } ${
                      today ? (isDark ? "ring-2 ring-cyan-500 ring-inset" : "ring-2 ring-blue-500 ring-inset") : ""
                    } hover:${isDark ? "bg-slate-700" : "bg-gray-50"}`}
                    onClick={() => {
                      if (dayEvents.length > 0) {
                        // If there are events, show day detail modal
                        setSelectedDayDate(day.date);
                        setShowDayModal(true);
                      } else {
                        // If no events, open create modal
                        const newDate = new Date(day.date);
                        setFormData({
                          ...formData,
                          startTime: formatDateForInput(newDate),
                          endTime: formatDateForInput(new Date(newDate.getTime() + 60 * 60 * 1000)),
                        });
                        setShowCreateModal(true);
                      }
                    }}
                  >
                    <div
                      className={`text-sm font-medium mb-1 ${
                        today
                          ? "text-cyan-500"
                          : day.isCurrentMonth
                          ? isDark ? "text-white" : "text-gray-900"
                          : isDark ? "text-slate-600" : "text-gray-400"
                      }`}
                    >
                      {day.date.getDate()}
                    </div>
                    <div className="space-y-0.5 flex flex-col">
                      {dayEvents.slice(0, maxVisibleEvents).map((event) => (
                        <div
                          key={event._id}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEventDetails(event);
                          }}
                          className={`text-xs px-1 py-0.5 rounded truncate cursor-pointer flex-shrink-0 ${
                            (event as any).myInviteStatus === "pending"
                              ? "bg-amber-500/20 text-amber-400"
                              : (event as any).myInviteStatus === "organizer"
                              ? isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-700"
                              : viewingSharedCalendar
                              ? isDark ? "bg-purple-500/20 text-purple-400" : "bg-purple-100 text-purple-700"
                              : isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"
                          }`}
                        >
                          {formatTime(event.startTime)} {event.title}
                        </div>
                      ))}
                      {hasMore && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDayDate(day.date);
                            setShowDayModal(true);
                          }}
                          className={`text-xs font-medium py-0.5 px-1 rounded text-left flex-shrink-0 transition-colors ${
                            isDark
                              ? "text-cyan-400 hover:bg-cyan-500/20"
                              : "text-blue-600 hover:bg-blue-100"
                          }`}
                        >
                          +{dayEvents.length - maxVisibleEvents} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          </div>
        </div>

        {/* Create Event Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`w-full max-w-lg rounded-xl border max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className={`p-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  {editingEventId ? "Edit Event" : "Create Event"}
                </h2>
              </div>

              <div className="p-4 space-y-4">
                {/* Title */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Title *
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                    placeholder="Event title"
                  />
                </div>

                {/* Date/Time */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Start
                    </label>
                    <input
                      type="datetime-local"
                      value={formData.startTime}
                      onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                      className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      End
                    </label>
                    <input
                      type="datetime-local"
                      value={formData.endTime}
                      onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                      className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                    />
                  </div>
                </div>

                {/* Meeting Type */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Meeting Type
                  </label>
                  <select
                    value={formData.meetingType}
                    onChange={(e) => setFormData({ ...formData, meetingType: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                  >
                    {MEETING_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.icon} {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Apply-to-series toggle — only when editing a recurring event */}
                {editingEventId && editingSeriesId && (
                  <label className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer ${isDark ? "bg-slate-900/60 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
                    <input
                      type="checkbox"
                      checked={formData.applyToSeries}
                      onChange={(e) => setFormData({ ...formData, applyToSeries: e.target.checked })}
                      className="mt-0.5 rounded"
                    />
                    <span className={`text-sm ${isDark ? "text-slate-200" : "text-gray-700"}`}>
                      Apply these changes to every event in this recurring series
                      <span className={`block text-xs mt-0.5 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                        Title, location, link, description &amp; meeting type only. Date and time stay per-occurrence.
                      </span>
                    </span>
                  </label>
                )}

                {/* Repeat — only visible when creating, not when editing one occurrence */}
                {!editingEventId && (
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Repeat
                    </label>
                    <select
                      value={formData.repeat}
                      onChange={(e) => setFormData({ ...formData, repeat: e.target.value as typeof formData.repeat })}
                      className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                    >
                      <option value="none">Doesn&apos;t repeat</option>
                      <option value="daily">Daily (next 30 days)</option>
                      <option value="weekly">Weekly (next 12 weeks)</option>
                      <option value="monthly">Monthly (next 12 months)</option>
                    </select>
                  </div>
                )}

                {/* Meeting Link / IECentral Meeting Info / Zoom Auto-Create */}
                {formData.meetingType === "iecentral" ? (
                  <div className={`p-3 rounded-lg border ${isDark ? "bg-cyan-500/10 border-cyan-500/20" : "bg-blue-50 border-blue-100"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <p className={`text-sm font-medium ${isDark ? "text-cyan-400" : "text-blue-700"}`}>
                        IECentral Meeting
                      </p>
                    </div>
                    <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      A meeting room with a unique join code will be automatically created when you save this event. Invitees can join directly from the event.
                    </p>
                  </div>
                ) : formData.meetingType === "zoom" && zoomAccount ? (
                  <div className={`p-3 rounded-lg border ${isDark ? "bg-blue-500/10 border-blue-500/20" : "bg-blue-50 border-blue-100"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">📹</span>
                      <p className={`text-sm font-medium ${isDark ? "text-blue-400" : "text-blue-700"}`}>
                        Zoom Meeting
                      </p>
                    </div>
                    <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      A Zoom meeting link will be automatically created. Connected as {zoomAccount.zoomEmail}.
                    </p>
                  </div>
                ) : formData.meetingType === "zoom" && !zoomAccount ? (
                  <div className={`p-3 rounded-lg border ${isDark ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50 border-amber-100"}`}>
                    <p className={`text-xs mb-2 ${isDark ? "text-amber-400" : "text-amber-700"}`}>
                      Connect your Zoom account to auto-generate meeting links.
                    </p>
                    <button
                      type="button"
                      onClick={() => window.location.assign(`/api/zoom/oauth?userId=${user?._id}`)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium ${isDark ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" : "bg-blue-100 text-blue-700 hover:bg-blue-200"}`}
                    >
                      Connect Zoom
                    </button>
                    <div className="mt-2">
                      <input
                        type="url"
                        value={formData.meetingLink}
                        onChange={(e) => setFormData({ ...formData, meetingLink: e.target.value })}
                        className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                        placeholder="Or paste a Zoom link manually"
                      />
                    </div>
                  </div>
                ) : formData.meetingType !== "in_person" && formData.meetingType !== "phone" ? (
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Meeting Link
                    </label>
                    <input
                      type="url"
                      value={formData.meetingLink}
                      onChange={(e) => setFormData({ ...formData, meetingLink: e.target.value })}
                      className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                      placeholder="https://zoom.us/j/..."
                    />
                  </div>
                ) : null}

                {/* Location */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Location
                  </label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                    placeholder="Conference Room A, or virtual"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    className={`w-full px-3 py-2 rounded-lg border resize-none ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                    placeholder="Event details..."
                  />
                </div>

                {/* Invite Users */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Invite Users
                  </label>
                  <div className={`border rounded-lg max-h-40 overflow-y-auto ${isDark ? "border-slate-600" : "border-gray-300"}`}>
                    {allUsers
                      ?.filter((u) => u._id !== user?._id)
                      .map((u) => (
                        <label
                          key={u._id}
                          className={`flex items-center gap-2 p-2 cursor-pointer hover:${isDark ? "bg-slate-700" : "bg-gray-50"}`}
                        >
                          <input
                            type="checkbox"
                            checked={formData.inviteeIds.includes(u._id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData({
                                  ...formData,
                                  inviteeIds: [...formData.inviteeIds, u._id],
                                });
                              } else {
                                setFormData({
                                  ...formData,
                                  inviteeIds: formData.inviteeIds.filter((id) => id !== u._id),
                                });
                              }
                            }}
                            className="rounded"
                          />
                          <span className={isDark ? "text-white" : "text-gray-900"}>{u.name}</span>
                          <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            {u.email}
                          </span>
                        </label>
                      ))}
                  </div>
                  {formData.inviteeIds.length > 0 && (
                    <p className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      {formData.inviteeIds.length} user(s) will be invited
                    </p>
                  )}
                </div>
              </div>

              <div className={`p-4 border-t flex gap-3 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    resetForm();
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitEvent}
                  disabled={!formData.title || isCreatingEvent}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium disabled:opacity-50 ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                >
                  {isCreatingEvent
                    ? (editingEventId ? "Saving..." : "Creating...")
                    : (editingEventId ? "Save Changes" : "Create Event")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Event Details Modal */}
        {showEventModal && selectedEvent && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`w-full max-w-lg rounded-xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className={`p-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                      {selectedEvent.title}
                    </h2>
                    <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      {formatDate(selectedEvent.startTime)} at {formatTime(selectedEvent.startTime)} - {formatTime(selectedEvent.endTime)}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowEventModal(false);
                      setSelectedEvent(null);
                    }}
                    className={`p-1 rounded hover:${isDark ? "bg-slate-700" : "bg-gray-100"}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Applicant Link (for interview events) */}
                {selectedEvent.applicationId && (
                  <div className={`p-3 rounded-lg ${isDark ? "bg-cyan-500/10 border border-cyan-500/20" : "bg-blue-50 border border-blue-100"}`}>
                    <p className={`text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Applicant Profile</p>
                    <Link
                      href={`/applications/${selectedEvent.applicationId}`}
                      className={`inline-flex items-center gap-2 font-medium ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      View Applicant Profile
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </Link>
                  </div>
                )}

                {/* Meeting Link / Join Meeting */}
                {selectedEvent.meetingType === "iecentral" && selectedEvent.meetingLink ? (
                  <div>
                    <p className={`text-sm font-medium mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>IECentral Meeting</p>
                    <Link
                      href={selectedEvent.meetingLink}
                      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                        isDark
                          ? "bg-cyan-500 text-white hover:bg-cyan-600"
                          : "bg-blue-600 text-white hover:bg-blue-700"
                      }`}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Join Meeting
                    </Link>
                  </div>
                ) : selectedEvent.meetingLink ? (
                  <div>
                    <p className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>Meeting Link</p>
                    <a
                      href={selectedEvent.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-500 hover:underline break-all"
                    >
                      {selectedEvent.meetingLink}
                    </a>
                  </div>
                ) : null}

                {/* Location */}
                {selectedEvent.location && (
                  <div>
                    <p className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>Location</p>
                    <p className={isDark ? "text-white" : "text-gray-900"}>{selectedEvent.location}</p>
                  </div>
                )}

                {/* Description */}
                {selectedEvent.description && (
                  <div>
                    <p className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>Description</p>
                    <p className={isDark ? "text-white" : "text-gray-900"}>{selectedEvent.description}</p>
                  </div>
                )}

                {/* Organizer */}
                <div>
                  <p className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>Organizer</p>
                  <p className={isDark ? "text-white" : "text-gray-900"}>{selectedEvent.createdByName}</p>
                </div>

                {/* Invitees */}
                {selectedEvent.invitees && selectedEvent.invitees.length > 0 && (
                  <div>
                    <p className={`text-sm font-medium mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Invitees</p>
                    <div className="space-y-1">
                      {selectedEvent.invitees.map((inv: any) => (
                        <div key={inv._id} className="flex items-center justify-between text-sm">
                          <span className={isDark ? "text-white" : "text-gray-900"}>{inv.userName}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-xs ${
                              inv.status === "accepted"
                                ? "bg-green-500/20 text-green-400"
                                : inv.status === "declined"
                                ? "bg-red-500/20 text-red-400"
                                : "bg-amber-500/20 text-amber-400"
                            }`}
                          >
                            {inv.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Response buttons for invitees */}
                {selectedEvent.myInviteStatus === "pending" && (
                  <div className={`pt-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                    <p className={`text-sm font-medium mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Your Response</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          handleRespondToInvite(selectedEvent._id, "accepted");
                          setShowEventModal(false);
                        }}
                        className="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => {
                          handleRespondToInvite(selectedEvent._id, "maybe");
                          setShowEventModal(false);
                        }}
                        className="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                      >
                        Maybe
                      </button>
                      <button
                        onClick={() => {
                          handleRespondToInvite(selectedEvent._id, "declined");
                          setShowEventModal(false);
                        }}
                        className="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                )}

                {/* Organizer actions */}
                {selectedEvent.myInviteStatus === "organizer" && (
                  <div className={`pt-4 border-t space-y-2 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                    <button
                      onClick={() => handleStartEdit(selectedEvent)}
                      className={`w-full px-3 py-2 text-sm font-medium rounded-lg ${
                        isDark
                          ? "bg-slate-700 text-white hover:bg-slate-600"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      Edit Event
                    </button>
                    <button
                      onClick={() => {
                        setSelectedInviteeIds([]);
                        setShowAddInviteesModal(true);
                      }}
                      className={`w-full px-3 py-2 text-sm font-medium rounded-lg ${
                        isDark
                          ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30"
                          : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                      }`}
                    >
                      + Add Invitees
                    </button>
                    <button
                      onClick={() => handleCancelEvent(selectedEvent._id)}
                      className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30"
                    >
                      Cancel This Event
                    </button>
                    {selectedEvent.seriesId && (
                      <button
                        onClick={() => handleCancelSeries(selectedEvent.seriesId)}
                        className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-red-500/30 text-red-400 hover:bg-red-500/40"
                      >
                        Cancel Entire Series
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Day Detail Modal */}
        {showDayModal && selectedDayDate && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`w-full max-w-md rounded-xl border max-h-[80vh] flex flex-col ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className={`p-4 border-b flex-shrink-0 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                      {selectedDayDate.toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })}
                    </h2>
                    <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      {getEventsForDay(selectedDayDate).length} event(s)
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowDayModal(false);
                      setSelectedDayDate(null);
                    }}
                    className={`p-1 rounded hover:${isDark ? "bg-slate-700" : "bg-gray-100"}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-4 overflow-y-auto flex-1">
                {getEventsForDay(selectedDayDate).length === 0 ? (
                  <p className={`text-center py-8 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    No events scheduled
                  </p>
                ) : (
                  <div className="space-y-2">
                    {getEventsForDay(selectedDayDate).map((event) => (
                      <div
                        key={event._id}
                        onClick={() => {
                          setShowDayModal(false);
                          openEventDetails(event);
                        }}
                        className={`p-3 rounded-lg cursor-pointer transition-colors ${
                          isDark ? "bg-slate-700 hover:bg-slate-600" : "bg-gray-50 hover:bg-gray-100"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                              {event.title}
                            </p>
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {formatTime(event.startTime)} - {formatTime(event.endTime)}
                            </p>
                            {event.location && (
                              <p className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                                📍 {event.location}
                              </p>
                            )}
                            {/* Show applicant link for interview events */}
                            {(event as any).applicationId && (
                              <Link
                                href={`/applications/${(event as any).applicationId}`}
                                onClick={(e) => e.stopPropagation()}
                                className={`inline-flex items-center gap-1 text-xs mt-1 ${
                                  isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"
                                }`}
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                View Applicant
                              </Link>
                            )}
                          </div>
                          <span
                            className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium ${
                              (event as any).myInviteStatus === "pending"
                                ? "bg-amber-500/20 text-amber-400"
                                : (event as any).myInviteStatus === "organizer"
                                ? isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-700"
                                : viewingSharedCalendar
                                ? isDark ? "bg-purple-500/20 text-purple-400" : "bg-purple-100 text-purple-700"
                                : isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"
                            }`}
                          >
                            {viewingSharedCalendar
                              ? "Shared"
                              : (event as any).myInviteStatus === "organizer"
                              ? "Organizer"
                              : (event as any).myInviteStatus === "pending"
                              ? "Pending"
                              : (event as any).myInviteStatus || "Accepted"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={`p-4 border-t flex-shrink-0 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <button
                  onClick={() => {
                    setShowDayModal(false);
                    const newDate = new Date(selectedDayDate);
                    setFormData({
                      ...formData,
                      startTime: formatDateForInput(newDate),
                      endTime: formatDateForInput(new Date(newDate.getTime() + 60 * 60 * 1000)),
                    });
                    setShowCreateModal(true);
                  }}
                  className={`w-full px-4 py-2 rounded-lg font-medium ${
                    isDark
                      ? "bg-cyan-500 text-white hover:bg-cyan-600"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  + Add Event
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Invitees Modal */}
        {showAddInviteesModal && selectedEvent && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className={`w-full max-w-md rounded-xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className={`p-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <div className="flex items-center justify-between">
                  <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                    Add Invitees
                  </h2>
                  <button
                    onClick={() => {
                      setShowAddInviteesModal(false);
                      setSelectedInviteeIds([]);
                    }}
                    className={`p-1 rounded-lg ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Select users to invite to: {selectedEvent.title}
                </p>
              </div>

              <div className="p-4 max-h-80 overflow-y-auto">
                <div className="space-y-2">
                  {allUsers
                    ?.filter((u) => {
                      // Filter out users already invited
                      const existingInviteeIds = selectedEvent.invitees?.map((i: any) => i.userId) || [];
                      return !existingInviteeIds.includes(u._id) && u._id !== selectedEvent.createdBy;
                    })
                    .map((u) => (
                      <label
                        key={u._id}
                        className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                          isDark
                            ? selectedInviteeIds.includes(u._id as Id<"users">)
                              ? "bg-cyan-500/20"
                              : "hover:bg-slate-700"
                            : selectedInviteeIds.includes(u._id as Id<"users">)
                            ? "bg-blue-50"
                            : "hover:bg-gray-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedInviteeIds.includes(u._id as Id<"users">)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedInviteeIds([...selectedInviteeIds, u._id as Id<"users">]);
                            } else {
                              setSelectedInviteeIds(selectedInviteeIds.filter((id) => id !== u._id));
                            }
                          }}
                          className="rounded"
                        />
                        <div className="flex-1">
                          <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                            {u.name}
                          </p>
                          <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            {u.email}
                          </p>
                        </div>
                      </label>
                    ))}
                </div>
              </div>

              <div className={`p-4 border-t flex gap-2 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <button
                  onClick={() => {
                    setShowAddInviteesModal(false);
                    setSelectedInviteeIds([]);
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${
                    isDark
                      ? "bg-slate-700 text-white hover:bg-slate-600"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddInvitees}
                  disabled={selectedInviteeIds.length === 0}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium disabled:opacity-50 ${
                    isDark
                      ? "bg-cyan-500 text-white hover:bg-cyan-600"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  Add {selectedInviteeIds.length > 0 ? `(${selectedInviteeIds.length})` : ""}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Share Calendar Modal */}
        {showShareModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className={`w-full max-w-md rounded-xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className={`p-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <div className="flex items-center justify-between">
                  <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                    Share Calendar
                  </h2>
                  <button
                    onClick={() => setShowShareModal(false)}
                    className={`p-1 rounded hover:${isDark ? "bg-slate-700" : "bg-gray-100"}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Current shares */}
                {myShares && myShares.length > 0 && (
                  <div>
                    <h3 className={`text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Shared with
                    </h3>
                    <div className="space-y-2">
                      {myShares.map((share) => (
                        <div
                          key={share._id}
                          className={`flex items-center justify-between p-2 rounded-lg ${
                            isDark ? "bg-slate-700" : "bg-gray-100"
                          }`}
                        >
                          <div>
                            <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              {share.sharedWithName}
                            </p>
                            <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {share.sharedWithEmail} - {share.permission} access
                            </p>
                          </div>
                          <button
                            onClick={async () => {
                              if (!user) return;
                              await removeCalendarShare({ shareId: share._id, requestingUserId: user._id as Id<"users"> });
                            }}
                            className={`p-1 rounded ${isDark ? "hover:bg-red-500/20 text-red-400" : "hover:bg-red-100 text-red-600"}`}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add new share */}
                <div>
                  <h3 className={`text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Share with someone new
                  </h3>
                  <select
                    value={shareUserId}
                    onChange={(e) => setShareUserId(e.target.value as Id<"users"> | "")}
                    className={`w-full px-3 py-2 rounded-lg border ${
                      isDark
                        ? "bg-slate-900 border-slate-600 text-white"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                  >
                    <option value="">Select a person...</option>
                    {allUsers
                      ?.filter(
                        (u) =>
                          u._id !== user?._id &&
                          !myShares?.some((s) => s.sharedWithId === u._id)
                      )
                      .map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.name} ({u.email})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className={`p-4 border-t flex gap-2 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <button
                  onClick={() => {
                    setShowShareModal(false);
                    setShareUserId("");
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${
                    isDark
                      ? "bg-slate-700 text-white hover:bg-slate-600"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Close
                </button>
                <button
                  onClick={async () => {
                    if (user && shareUserId) {
                      await shareCalendar({
                        ownerId: user._id as Id<"users">,
                        sharedWithId: shareUserId as Id<"users">,
                        permission: "view",
                      });
                      setShareUserId("");
                    }
                  }}
                  disabled={!shareUserId}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium disabled:opacity-50 ${
                    isDark
                      ? "bg-cyan-500 text-white hover:bg-cyan-600"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  Share
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Help Modal is now rendered inline by CalendarHelpModal component */}
      </main>
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Protected>
      <CalendarContent />
    </Protected>
  );
}
