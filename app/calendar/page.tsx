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
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import TimeGrid from "@/components/calendar/TimeGrid";
import { useNowMinute } from "@/components/calendar/useNowMinute";

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
  const now = useNowMinute(); // browser-local "now", ticks each minute for the now-line
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
    isReminder: false, // personal time-block; only on my own calendar
    isPrivate: false,  // show as "Busy" on shared calendars
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
      isReminder: !!event.isReminder,
      isPrivate: !!event.isPrivate,
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
          isReminder: formData.isReminder,
          isPrivate: formData.isReminder ? false : formData.isPrivate,
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

      // REMINDER SHORT-CIRCUIT — a reminder is a personal time-block: no
      // meeting room, no Zoom, no invitees. It never reaches the
      // iecentral/zoom/invite logic below. Reminders may repeat.
      if (formData.isReminder) {
        if (isRepeating && repeatCount > 1) {
          await createRecurring({
            title: formData.title,
            description: formData.description || undefined,
            startTime: startTimestamp,
            endTime: endTimestamp,
            isAllDay: formData.isAllDay,
            location: formData.location || undefined,
            isReminder: true,
            isPrivate: false,
            meetingLink: undefined,
            meetingType: formData.meetingType || undefined,
            inviteeIds: [],
            userId: user._id as Id<"users">,
            recurrence: formData.repeat,
            count: repeatCount,
          });
        } else {
          await createEvent({
            title: formData.title,
            description: formData.description || undefined,
            startTime: startTimestamp,
            endTime: endTimestamp,
            isAllDay: formData.isAllDay,
            location: formData.location || undefined,
            isReminder: true,
            isPrivate: false,
            meetingLink: undefined,
            meetingType: formData.meetingType || undefined,
            inviteeIds: [],
            userId: user._id as Id<"users">,
          });
        }
        setShowCreateModal(false);
        resetForm();
        setIsCreatingEvent(false);
        return;
      }

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
          isReminder: false,
          isPrivate: formData.isPrivate,
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
            isReminder: false,
            isPrivate: formData.isPrivate,
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
          isReminder: false,
          isPrivate: formData.isPrivate,
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
          isReminder: false,
          isPrivate: formData.isPrivate,
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
      isReminder: false,
      isPrivate: false,
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

  // Unified nav that respects the active view: month ±1 month, week ±7 days,
  // day ±1 day.
  const navigate = (delta: number) => {
    const newDate = new Date(selectedDate);
    if (viewMode === "month") newDate.setMonth(newDate.getMonth() + delta);
    else if (viewMode === "week") newDate.setDate(newDate.getDate() + delta * 7);
    else newDate.setDate(newDate.getDate() + delta);
    setSelectedDate(newDate);
  };

  // The 7 local-midnight days (Sun..Sat) of the week containing selectedDate.
  const weekDays = useMemo(() => {
    const start = new Date(selectedDate);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [selectedDate]);

  // Single local-midnight day for day view.
  const dayViewDays = useMemo(() => {
    const d = new Date(selectedDate);
    d.setHours(0, 0, 0, 0);
    return [d];
  }, [selectedDate]);

  // Header date label reflects the active view.
  const headerLabel = useMemo(() => {
    if (viewMode === "month") {
      return selectedDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
    if (viewMode === "day") {
      return selectedDate.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
    // week — "Jul 6 – 12, 2026" (crossing months/years shown in full)
    const first = weekDays[0];
    const last = weekDays[6];
    const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
    if (sameMonth) {
      return `${first.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${last.getDate()}, ${last.getFullYear()}`;
    }
    return `${first.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${last.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${last.getFullYear()}`;
  }, [viewMode, selectedDate, weekDays]);

  // Empty-slot click in Day/Week grid → open create modal prefilled for that
  // day + hour, mirroring the month click-to-create flow.
  const handleSlotClick = (dayDate: Date, hour: number) => {
    const start = new Date(dayDate);
    start.setHours(hour, 0, 0, 0);
    setFormData({
      ...formData,
      startTime: formatDateForInput(start),
      endTime: formatDateForInput(new Date(start.getTime() + 60 * 60 * 1000)),
    });
    setShowCreateModal(true);
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  // Event chip color classes (data-driven — kept as explicit classes)
  const eventChipClass = (event: any) => {
    if ((event as any).myInviteStatus === "pending") return "bg-amber-500/20 text-amber-500";
    if ((event as any).myInviteStatus === "organizer") return isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-700";
    if (viewingSharedCalendar) return isDark ? "bg-purple-500/20 text-purple-400" : "bg-purple-100 text-purple-700";
    return isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700";
  };

  // Invitee status badge classes
  const inviteStatusClass = (status: string) => {
    if (status === "accepted") return "bg-green-500/20 text-green-400";
    if (status === "declined") return "bg-red-500/20 text-red-400";
    return "bg-amber-500/20 text-amber-400";
  };

  void showHelp; // reserved

  return (
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Mobile Header */}
        <MobileHeader />

        {/* Sticky iOS-style page header */}
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary truncate">
                  {viewingSharedCalendar
                    ? `${sharedWithMe?.find((s) => s.ownerId === viewingSharedCalendar)?.ownerName}'s Calendar`
                    : "My Calendar"}
                </h1>
              </div>
              {pendingInvites && pendingInvites.length > 0 && !viewingSharedCalendar && (
                <span className="ui-badge ui-badge-red flex-shrink-0">
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
                  className="theme-input px-3 py-1.5 text-sm"
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

            <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
              {/* Zoom Sync */}
              <Button
                variant="ghost"
                onClick={handleZoomSync}
                disabled={zoomSyncing}
                title="Sync Zoom meetings from email"
              >
                <svg className={`w-4 h-4 ${zoomSyncing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="hidden sm:inline">{zoomSyncing ? "Syncing..." : "Sync Zoom"}</span>
              </Button>
              {zoomSyncResult && (
                <span className={`text-xs ${zoomSyncResult.synced > 0 ? (isDark ? "text-emerald-400" : "text-emerald-600") : "theme-text-tertiary"}`}>
                  {zoomSyncResult.message}
                </span>
              )}

              {/* Help Button */}
              <CalendarHelpModal isDark={isDark} />

              <Button
                variant="ghost"
                onClick={() => setShowShareModal(true)}
                title="Share Calendar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                <span className="hidden sm:inline">Share</span>
              </Button>

              {!viewingSharedCalendar && (
                <Button
                  variant="primary"
                  onClick={() => {
                    resetForm();
                    setShowCreateModal(true);
                  }}
                >
                  + New Event
                </Button>
              )}
            </div>
          </div>
        </header>

        <div className="px-4 sm:px-6 lg:px-8 py-5 space-y-4">

          {/* Pending Invites Section */}
          {pendingInvites && pendingInvites.length > 0 && (
            <Card tone="amber" padding="sm">
              <h2 className="font-semibold mb-3 text-amber-600 dark:text-amber-400 text-[15px]">
                Pending Invitations
              </h2>
              <div className="space-y-2">
                {pendingInvites.map((invite) => (
                  <div
                    key={invite._id}
                    className="theme-card p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium theme-text-primary truncate">
                        {invite.event?.title}
                      </p>
                      <p className="text-sm theme-text-secondary mt-0.5">
                        {invite.event && formatDate(invite.event.startTime)} at{" "}
                        {invite.event && formatTime(invite.event.startTime)}
                      </p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRespondToInvite(invite.eventId, "accepted")}
                        className="text-emerald-500 hover:bg-emerald-500/10"
                      >
                        Accept
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRespondToInvite(invite.eventId, "declined")}
                        className="text-red-500 hover:bg-red-500/10"
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Calendar Navigation */}
          <div className="theme-card p-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(-1)}
                aria-label="Previous"
              >
                &#8592;
              </Button>
              <h2 className="text-base sm:text-lg font-semibold theme-text-primary px-2 min-w-[160px] text-center">
                {headerLabel}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(1)}
                aria-label="Next"
              >
                &#8594;
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {/* Day / Week / Month switcher */}
              <div className="flex items-center gap-1">
                {(["day", "week", "month"] as const).map((mode) => (
                  <Button
                    key={mode}
                    variant={viewMode === mode ? "primary" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode(mode)}
                    aria-pressed={viewMode === mode}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </Button>
                ))}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedDate(new Date())}
              >
                Today
              </Button>
            </div>
          </div>

          {/* ── Week / Day time-grid views ── */}
          {viewMode === "week" && (
            <div className={`rounded-xl border overflow-hidden ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <TimeGrid
                days={weekDays}
                getEventsForDay={getEventsForDay}
                eventChipClass={eventChipClass}
                onEventClick={openEventDetails}
                onSlotClick={handleSlotClick}
                isToday={isToday}
                now={now}
              />
            </div>
          )}

          {viewMode === "day" && (
            <div className={`rounded-xl border overflow-hidden ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <TimeGrid
                days={dayViewDays}
                getEventsForDay={getEventsForDay}
                eventChipClass={eventChipClass}
                onEventClick={openEventDetails}
                onSlotClick={handleSlotClick}
                isToday={isToday}
                now={now}
              />
            </div>
          )}

          {/* Calendar Grid — overflow-x-auto prevents body-level horizontal scroll on mobile */}
          {viewMode === "month" && (
          <div className="overflow-x-auto">
            <div className={`rounded-xl border overflow-hidden min-w-[640px] ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              {/* Day headers */}
              <div className="grid grid-cols-7">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                  <div
                    key={day}
                    className={`p-2 text-center border-b ${isDark ? "bg-slate-700/60 border-slate-600" : "bg-gray-50 border-gray-200"}`}
                  >
                    <span className="ui-section-label">{day}</span>
                  </div>
                ))}
              </div>

              {/* Calendar days */}
              <div className="grid grid-cols-7">
                {calendarDays.map((day, idx) => {
                  const dayEvents = getEventsForDay(day.date);
                  const today = isToday(day.date);
                  const maxVisibleEvents = 2;
                  const hasMore = dayEvents.length > maxVisibleEvents;

                  return (
                    <div
                      key={idx}
                      className={`h-[110px] p-1 border-b border-r cursor-pointer transition-colors overflow-hidden theme-border-secondary ${
                        day.isCurrentMonth
                          ? isDark ? "bg-slate-800" : "bg-white"
                          : isDark ? "bg-slate-800/50" : "bg-gray-50/80"
                      } ${
                        // today highlight — data-driven, kept explicit
                        today ? (isDark ? "ring-2 ring-cyan-500 ring-inset" : "ring-2 ring-blue-500 ring-inset") : ""
                      } ${isDark ? "hover:bg-slate-700/60" : "hover:bg-blue-50/40"}`}
                      onClick={() => {
                        if (dayEvents.length > 0) {
                          setSelectedDayDate(day.date);
                          setShowDayModal(true);
                        } else {
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
                        className={`text-sm font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                          today
                            ? "bg-[#007AFF] text-white"
                            : day.isCurrentMonth
                            ? "theme-text-primary"
                            : "theme-text-tertiary"
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
                            className={`text-[11px] px-1 py-0.5 rounded truncate cursor-pointer flex-shrink-0 font-medium ${eventChipClass(event)}`}
                          >
                            {(event as any).isReminder ? "⏰ " : (event as any).isPrivate ? "🔒 " : ""}{formatTime(event.startTime)} {event.title}
                          </div>
                        ))}
                        {hasMore && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDayDate(day.date);
                              setShowDayModal(true);
                            }}
                            className="text-[11px] font-medium py-0.5 px-1 rounded text-left flex-shrink-0 transition-colors theme-accent-primary hover:underline"
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
          )}
        </div>

        {/* ── Create / Edit Event Modal ── */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`w-full max-w-lg rounded-2xl border max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              {/* Modal header */}
              <div className={`px-5 py-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <h2 className="text-[17px] font-semibold theme-text-primary">
                  {editingEventId ? "Edit Event" : "Create Event"}
                </h2>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Title */}
                <div>
                  <label className="block text-xs font-medium mb-1 theme-text-tertiary">Title *</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="theme-input w-full px-3 py-2 text-sm"
                    placeholder="Event title"
                  />
                </div>

                {/* Date/Time */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1 theme-text-tertiary">Start</label>
                    <input
                      type="datetime-local"
                      value={formData.startTime}
                      onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                      className="theme-input w-full px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1 theme-text-tertiary">End</label>
                    <input
                      type="datetime-local"
                      value={formData.endTime}
                      onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                      className="theme-input w-full px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                {/* Visibility — Reminder / Private */}
                <div className="space-y-2">
                  <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer ${isDark ? "bg-slate-900/60 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
                    <input
                      type="checkbox"
                      checked={formData.isReminder}
                      onChange={(e) => setFormData({ ...formData, isReminder: e.target.checked })}
                      className="mt-0.5 rounded"
                    />
                    <span className="text-sm theme-text-primary">
                      ⏰ Reminder (only on my calendar)
                      <span className="block text-xs mt-0.5 theme-text-tertiary">
                        A personal time-block — no attendees or meeting, and never shown on calendars shared with you.
                      </span>
                    </span>
                  </label>

                  {!formData.isReminder && (
                    <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer ${isDark ? "bg-slate-900/60 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
                      <input
                        type="checkbox"
                        checked={formData.isPrivate}
                        onChange={(e) => setFormData({ ...formData, isPrivate: e.target.checked })}
                        className="mt-0.5 rounded"
                      />
                      <span className="text-sm theme-text-primary">
                        🔒 Private — show as &quot;Busy&quot; on shared calendars
                        <span className="block text-xs mt-0.5 theme-text-tertiary">
                          Others viewing your shared calendar see only a &quot;Busy&quot; block; the title and all details are hidden.
                        </span>
                      </span>
                    </label>
                  )}
                </div>

                {/* Meeting Type — a reminder has no meeting */}
                {!formData.isReminder && (
                <div>
                  <label className="block text-xs font-medium mb-1 theme-text-tertiary">Meeting Type</label>
                  <select
                    value={formData.meetingType}
                    onChange={(e) => setFormData({ ...formData, meetingType: e.target.value })}
                    className="theme-input w-full px-3 py-2 text-sm"
                  >
                    {MEETING_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.icon} {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                )}

                {/* Apply-to-series toggle — only when editing a recurring event */}
                {editingEventId && editingSeriesId && (
                  <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer ${isDark ? "bg-slate-900/60 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
                    <input
                      type="checkbox"
                      checked={formData.applyToSeries}
                      onChange={(e) => setFormData({ ...formData, applyToSeries: e.target.checked })}
                      className="mt-0.5 rounded"
                    />
                    <span className="text-sm theme-text-primary">
                      Apply these changes to every event in this recurring series
                      <span className="block text-xs mt-0.5 theme-text-tertiary">
                        Title, location, link, description &amp; meeting type only. Date and time stay per-occurrence.
                      </span>
                    </span>
                  </label>
                )}

                {/* Repeat — only visible when creating */}
                {!editingEventId && (
                  <div>
                    <label className="block text-xs font-medium mb-1 theme-text-tertiary">Repeat</label>
                    <select
                      value={formData.repeat}
                      onChange={(e) => setFormData({ ...formData, repeat: e.target.value as typeof formData.repeat })}
                      className="theme-input w-full px-3 py-2 text-sm"
                    >
                      <option value="none">Doesn&apos;t repeat</option>
                      <option value="daily">Daily (next 30 days)</option>
                      <option value="weekly">Weekly (next 12 weeks)</option>
                      <option value="monthly">Monthly (next 12 months)</option>
                    </select>
                  </div>
                )}

                {/* Meeting Link / IECentral info / Zoom auto-create — hidden for reminders */}
                {!formData.isReminder && (formData.meetingType === "iecentral" ? (
                  <Card tone="accent" padding="sm" className="!rounded-xl">
                    <div className="flex items-center gap-2 mb-1">
                      <svg className="w-4 h-4 theme-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <p className="text-sm font-medium theme-accent-primary">IECentral Meeting</p>
                    </div>
                    <p className="text-xs theme-text-tertiary">
                      A meeting room with a unique join code will be automatically created when you save this event. Invitees can join directly from the event.
                    </p>
                  </Card>
                ) : formData.meetingType === "zoom" && zoomAccount ? (
                  <div className={`p-3 rounded-xl border ${isDark ? "bg-blue-500/10 border-blue-500/20" : "bg-blue-50 border-blue-100"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">📹</span>
                      <p className={`text-sm font-medium ${isDark ? "text-blue-400" : "text-blue-700"}`}>Zoom Meeting</p>
                    </div>
                    <p className="text-xs theme-text-tertiary">
                      A Zoom meeting link will be automatically created. Connected as {zoomAccount.zoomEmail}.
                    </p>
                  </div>
                ) : formData.meetingType === "zoom" && !zoomAccount ? (
                  <Card tone="amber" padding="sm" className="!rounded-xl">
                    <p className="text-xs mb-2 text-amber-600 dark:text-amber-400">
                      Connect your Zoom account to auto-generate meeting links.
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.location.assign(`/api/zoom/oauth?userId=${user?._id}`)}
                    >
                      Connect Zoom
                    </Button>
                    <div className="mt-2">
                      <input
                        type="url"
                        value={formData.meetingLink}
                        onChange={(e) => setFormData({ ...formData, meetingLink: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm mt-2"
                        placeholder="Or paste a Zoom link manually"
                      />
                    </div>
                  </Card>
                ) : formData.meetingType !== "in_person" && formData.meetingType !== "phone" ? (
                  <div>
                    <label className="block text-xs font-medium mb-1 theme-text-tertiary">Meeting Link</label>
                    <input
                      type="url"
                      value={formData.meetingLink}
                      onChange={(e) => setFormData({ ...formData, meetingLink: e.target.value })}
                      className="theme-input w-full px-3 py-2 text-sm"
                      placeholder="https://zoom.us/j/..."
                    />
                  </div>
                ) : null)}

                {/* Location */}
                <div>
                  <label className="block text-xs font-medium mb-1 theme-text-tertiary">Location</label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="theme-input w-full px-3 py-2 text-sm"
                    placeholder="Conference Room A, or virtual"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-medium mb-1 theme-text-tertiary">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    className="theme-input w-full px-3 py-2 text-sm resize-none"
                    placeholder="Event details..."
                  />
                </div>

                {/* Invite Users — a reminder is personal, no attendees */}
                {!formData.isReminder && (
                <div>
                  <label className="block text-xs font-medium mb-1 theme-text-tertiary">Invite Users</label>
                  <div className={`border rounded-xl max-h-40 overflow-y-auto ${isDark ? "border-slate-600" : "border-gray-200"}`}>
                    {allUsers
                      ?.filter((u) => u._id !== user?._id)
                      .map((u) => (
                        <label
                          key={u._id}
                          className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-50"}`}
                        >
                          <input
                            type="checkbox"
                            checked={formData.inviteeIds.includes(u._id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData({ ...formData, inviteeIds: [...formData.inviteeIds, u._id] });
                              } else {
                                setFormData({ ...formData, inviteeIds: formData.inviteeIds.filter((id) => id !== u._id) });
                              }
                            }}
                            className="rounded"
                          />
                          <span className="theme-text-primary text-sm">{u.name}</span>
                          <span className="text-xs theme-text-tertiary">{u.email}</span>
                        </label>
                      ))}
                  </div>
                  {formData.inviteeIds.length > 0 && (
                    <p className="text-xs mt-1 theme-text-tertiary">
                      {formData.inviteeIds.length} user(s) will be invited
                    </p>
                  )}
                </div>
                )}
              </div>

              <div className={`px-5 py-4 border-t flex gap-3 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => { setShowCreateModal(false); resetForm(); }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleSubmitEvent}
                  disabled={!formData.title || isCreatingEvent}
                >
                  {isCreatingEvent
                    ? (editingEventId ? "Saving..." : "Creating...")
                    : (editingEventId ? "Save Changes" : "Create Event")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Event Details Modal ── */}
        {showEventModal && selectedEvent && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`w-full max-w-lg rounded-2xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              {/* Modal header */}
              <div className={`px-5 py-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[17px] font-semibold theme-text-primary truncate">
                      {selectedEvent.title}
                    </h2>
                    <p className="text-sm theme-text-secondary mt-0.5">
                      {formatDate(selectedEvent.startTime)} at {formatTime(selectedEvent.startTime)} – {formatTime(selectedEvent.endTime)}
                    </p>
                  </div>
                  <button
                    onClick={() => { setShowEventModal(false); setSelectedEvent(null); }}
                    className="p-1.5 rounded-lg theme-text-tertiary hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Applicant Link (for interview events) */}
                {selectedEvent.applicationId && (
                  <div className={`p-3 rounded-xl border ${isDark ? "bg-cyan-500/10 border-cyan-500/20" : "bg-blue-50 border-blue-100"}`}>
                    <p className="text-xs font-medium mb-1 theme-text-tertiary">Applicant Profile</p>
                    <Link
                      href={`/applications/${selectedEvent.applicationId}`}
                      className="inline-flex items-center gap-2 text-sm font-medium theme-accent-primary hover:underline"
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
                    <p className="text-xs font-medium mb-2 theme-text-tertiary">IECentral Meeting</p>
                    <Link
                      href={selectedEvent.meetingLink}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[9px] font-semibold text-sm theme-btn-primary transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Join Meeting
                    </Link>
                  </div>
                ) : selectedEvent.meetingLink ? (
                  <div>
                    <p className="text-xs font-medium theme-text-tertiary mb-1">Meeting Link</p>
                    <a
                      href={selectedEvent.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="theme-accent-primary hover:underline break-all text-sm"
                    >
                      {selectedEvent.meetingLink}
                    </a>
                  </div>
                ) : null}

                {/* Location */}
                {selectedEvent.location && (
                  <div>
                    <p className="text-xs font-medium theme-text-tertiary mb-0.5">Location</p>
                    <p className="text-sm theme-text-primary">{selectedEvent.location}</p>
                  </div>
                )}

                {/* Description */}
                {selectedEvent.description && (
                  <div>
                    <p className="text-xs font-medium theme-text-tertiary mb-0.5">Description</p>
                    <p className="text-sm theme-text-primary">{selectedEvent.description}</p>
                  </div>
                )}

                {/* Organizer */}
                <div>
                  <p className="text-xs font-medium theme-text-tertiary mb-0.5">Organizer</p>
                  <p className="text-sm theme-text-primary">{selectedEvent.createdByName}</p>
                </div>

                {/* Invitees */}
                {selectedEvent.invitees && selectedEvent.invitees.length > 0 && (
                  <div>
                    <p className="text-xs font-medium theme-text-tertiary mb-2">Invitees</p>
                    <div className="space-y-1">
                      {selectedEvent.invitees.map((inv: any) => (
                        <div key={inv._id} className="flex items-center justify-between text-sm gap-2">
                          <span className="theme-text-primary">{inv.userName}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${inviteStatusClass(inv.status)}`}>
                            {inv.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Response buttons for invitees */}
                {selectedEvent.myInviteStatus === "pending" && (
                  <div className={`pt-4 border-t theme-border-secondary`}>
                    <p className="text-xs font-medium theme-text-tertiary mb-2">Your Response</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { handleRespondToInvite(selectedEvent._id, "accepted"); setShowEventModal(false); }}
                        className="flex-1 px-3 py-2 text-sm font-semibold rounded-[9px] bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition-colors"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => { handleRespondToInvite(selectedEvent._id, "maybe"); setShowEventModal(false); }}
                        className="flex-1 px-3 py-2 text-sm font-semibold rounded-[9px] bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 transition-colors"
                      >
                        Maybe
                      </button>
                      <button
                        onClick={() => { handleRespondToInvite(selectedEvent._id, "declined"); setShowEventModal(false); }}
                        className="flex-1 px-3 py-2 text-sm font-semibold rounded-[9px] bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-colors"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                )}

                {/* Organizer actions */}
                {selectedEvent.myInviteStatus === "organizer" && (
                  <div className={`pt-4 border-t theme-border-secondary space-y-2`}>
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={() => handleStartEdit(selectedEvent)}
                    >
                      Edit Event
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full"
                      onClick={() => { setSelectedInviteeIds([]); setShowAddInviteesModal(true); }}
                    >
                      + Add Invitees
                    </Button>
                    <Button
                      variant="danger"
                      className="w-full"
                      onClick={() => handleCancelEvent(selectedEvent._id)}
                    >
                      Cancel This Event
                    </Button>
                    {selectedEvent.seriesId && (
                      <Button
                        variant="danger"
                        className="w-full opacity-80"
                        onClick={() => handleCancelSeries(selectedEvent.seriesId)}
                      >
                        Cancel Entire Series
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Day Detail Modal ── */}
        {showDayModal && selectedDayDate && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`w-full max-w-md rounded-2xl border max-h-[80vh] flex flex-col ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className={`px-5 py-4 border-b flex-shrink-0 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[17px] font-semibold theme-text-primary truncate">
                      {selectedDayDate.toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })}
                    </h2>
                    <p className="text-sm theme-text-tertiary mt-0.5">
                      {getEventsForDay(selectedDayDate).length} event(s)
                    </p>
                  </div>
                  <button
                    onClick={() => { setShowDayModal(false); setSelectedDayDate(null); }}
                    className="p-1.5 rounded-lg theme-text-tertiary hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="px-5 py-3 overflow-y-auto flex-1">
                {getEventsForDay(selectedDayDate).length === 0 ? (
                  <p className="text-center py-8 theme-text-tertiary">No events scheduled</p>
                ) : (
                  <div className="space-y-2">
                    {getEventsForDay(selectedDayDate).map((event) => (
                      <div
                        key={event._id}
                        onClick={() => { setShowDayModal(false); openEventDetails(event); }}
                        className={`p-3 rounded-xl cursor-pointer transition-colors ${isDark ? "bg-slate-700/60 hover:bg-slate-700" : "bg-gray-50 hover:bg-gray-100"}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate theme-text-primary text-sm">{event.title}</p>
                            <p className="text-xs theme-text-secondary mt-0.5">
                              {formatTime(event.startTime)} – {formatTime(event.endTime)}
                            </p>
                            {event.location && (
                              <p className="text-xs mt-0.5 theme-text-tertiary">
                                📍 {event.location}
                              </p>
                            )}
                            {/* Show applicant link for interview events */}
                            {(event as any).applicationId && (
                              <Link
                                href={`/applications/${(event as any).applicationId}`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-xs mt-1 theme-accent-primary hover:underline"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                View Applicant
                              </Link>
                            )}
                          </div>
                          <span className={`flex-shrink-0 px-2 py-0.5 rounded text-[11px] font-medium ${eventChipClass(event)}`}>
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

              <div className={`px-5 py-4 border-t flex-shrink-0 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <Button
                  variant="primary"
                  className="w-full"
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
                >
                  + Add Event
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Add Invitees Modal ── */}
        {showAddInviteesModal && selectedEvent && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className={`w-full max-w-md rounded-2xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className={`px-5 py-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[17px] font-semibold theme-text-primary">Add Invitees</h2>
                    <p className="text-sm theme-text-tertiary mt-0.5 truncate">
                      Select users to invite to: {selectedEvent.title}
                    </p>
                  </div>
                  <button
                    onClick={() => { setShowAddInviteesModal(false); setSelectedInviteeIds([]); }}
                    className="p-1.5 rounded-lg theme-text-tertiary hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="px-5 py-3 max-h-80 overflow-y-auto">
                <div className="space-y-1">
                  {allUsers
                    ?.filter((u) => {
                      const existingInviteeIds = selectedEvent.invitees?.map((i: any) => i.userId) || [];
                      return !existingInviteeIds.includes(u._id) && u._id !== selectedEvent.createdBy;
                    })
                    .map((u) => (
                      <label
                        key={u._id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors ${
                          selectedInviteeIds.includes(u._id as Id<"users">)
                            ? isDark ? "bg-cyan-500/20" : "bg-blue-50"
                            : isDark ? "hover:bg-slate-700" : "hover:bg-gray-50"
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
                        <div className="flex-1 min-w-0">
                          <p className="font-medium theme-text-primary text-sm">{u.name}</p>
                          <p className="text-xs theme-text-tertiary">{u.email}</p>
                        </div>
                      </label>
                    ))}
                </div>
              </div>

              <div className={`px-5 py-4 border-t flex gap-3 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => { setShowAddInviteesModal(false); setSelectedInviteeIds([]); }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleAddInvitees}
                  disabled={selectedInviteeIds.length === 0}
                >
                  Add {selectedInviteeIds.length > 0 ? `(${selectedInviteeIds.length})` : ""}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Share Calendar Modal ── */}
        {showShareModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className={`w-full max-w-md rounded-2xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className={`px-5 py-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[17px] font-semibold theme-text-primary">Share Calendar</h2>
                  <button
                    onClick={() => setShowShareModal(false)}
                    className="p-1.5 rounded-lg theme-text-tertiary hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Current shares */}
                {myShares && myShares.length > 0 && (
                  <div>
                    <p className="ui-section-label mb-2">Shared with</p>
                    <div className="space-y-2">
                      {myShares.map((share) => (
                        <div
                          key={share._id}
                          className={`flex items-center justify-between p-3 rounded-xl gap-3 ${isDark ? "bg-slate-700/60" : "bg-gray-50"}`}
                        >
                          <div className="min-w-0">
                            <p className="font-medium theme-text-primary text-sm">{share.sharedWithName}</p>
                            <p className="text-xs theme-text-tertiary mt-0.5">
                              {share.sharedWithEmail} · {share.permission} access
                            </p>
                          </div>
                          <button
                            onClick={async () => {
                              if (!user) return;
                              await removeCalendarShare({ shareId: share._id, requestingUserId: user._id as Id<"users"> });
                            }}
                            className="p-1.5 rounded-lg flex-shrink-0 text-red-500 hover:bg-red-500/10 transition-colors"
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
                  <p className="ui-section-label mb-2">Share with someone new</p>
                  <select
                    value={shareUserId}
                    onChange={(e) => setShareUserId(e.target.value as Id<"users"> | "")}
                    className="theme-input w-full px-3 py-2 text-sm"
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

              <div className={`px-5 py-4 border-t flex gap-3 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => { setShowShareModal(false); setShareUserId(""); }}
                >
                  Close
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!shareUserId}
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
                >
                  Share
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Help Modal is rendered inline by CalendarHelpModal component */}
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
