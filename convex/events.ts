import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin, requireSelfOrManager } from "./authGuards";

// ============ QUERIES ============

// Get all events for a date range
export const listByDateRange = query({
  args: {
    startDate: v.number(), // Unix timestamp
    endDate: v.number(), // Unix timestamp
  },
  handler: async (ctx, args) => {
    // Overlap semantics: an event is in the window if it starts before the
    // window ends AND ends after the window begins. Filtering by startTime
    // alone hides multi-day events on every day except their first.
    const events = await ctx.db
      .query("events")
      .withIndex("by_start")
      .filter((q) =>
        q.and(
          q.lte(q.field("startTime"), args.endDate),
          q.gte(q.field("endTime"), args.startDate),
          q.neq(q.field("isCancelled"), true)
        )
      )
      .collect();

    // Enrich with invite counts
    const enrichedEvents = await Promise.all(
      events.map(async (event) => {
        const invites = await ctx.db
          .query("eventInvites")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .collect();

        const acceptedCount = invites.filter((i) => i.status === "accepted").length;
        const pendingCount = invites.filter((i) => i.status === "pending").length;
        const declinedCount = invites.filter((i) => i.status === "declined").length;

        return {
          ...event,
          inviteStats: {
            total: invites.length,
            accepted: acceptedCount,
            pending: pendingCount,
            declined: declinedCount,
          },
        };
      })
    );

    return enrichedEvents;
  },
});

// Get events for current user (where they are invited or created)
export const listMyEvents = query({
  args: {
    userId: v.id("users"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get events user created
    const createdEvents = await ctx.db
      .query("events")
      .withIndex("by_created_by", (q) => q.eq("createdBy", args.userId))
      .filter((q) => q.neq(q.field("isCancelled"), true))
      .collect();

    // Get events user is invited to
    const invites = await ctx.db
      .query("eventInvites")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const invitedEventIds = new Set(invites.map((i) => i.eventId));
    const invitedEvents = await Promise.all(
      [...invitedEventIds].map((id) => ctx.db.get(id))
    );

    // Combine and deduplicate
    const allEventIds = new Set<string>();
    const allEvents = [];

    for (const event of [...createdEvents, ...invitedEvents.filter(Boolean)]) {
      if (event && !allEventIds.has(event._id) && !event.isCancelled) {
        allEventIds.add(event._id);
        allEvents.push(event);
      }
    }

    // Filter by date range if provided — overlap semantics so multi-day
    // events appear on every day they span, not just their first.
    let filtered = allEvents;
    if (args.endDate !== undefined) {
      filtered = filtered.filter((e) => e.startTime <= args.endDate!);
    }
    if (args.startDate !== undefined) {
      filtered = filtered.filter((e) => e.endTime >= args.startDate!);
    }

    // Enrich with user's invite status
    const enriched = await Promise.all(
      filtered.map(async (event) => {
        const invite = invites.find((i) => i.eventId === event._id);
        const allInvites = await ctx.db
          .query("eventInvites")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .collect();

        // Get invitee details
        const inviteeDetails = await Promise.all(
          allInvites.map(async (inv) => {
            const user = await ctx.db.get(inv.userId);
            return {
              ...inv,
              userName: user?.name || "Unknown",
              userEmail: user?.email || "",
            };
          })
        );

        // Prioritize organizer status over invite status - creator should always see organizer controls
        const isOrganizer = event.createdBy === args.userId;
        return {
          ...event,
          myInviteStatus: isOrganizer ? "organizer" : (invite?.status || null),
          invitees: inviteeDetails,
        };
      })
    );

    // Sort by start time
    return enriched.sort((a, b) => a.startTime - b.startTime);
  },
});

// Get single event by ID
export const getById = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return null;

    // Get all invites with user details
    const invites = await ctx.db
      .query("eventInvites")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    const inviteeDetails = await Promise.all(
      invites.map(async (inv) => {
        const user = await ctx.db.get(inv.userId);
        return {
          ...inv,
          userName: user?.name || "Unknown",
          userEmail: user?.email || "",
        };
      })
    );

    return {
      ...event,
      invitees: inviteeDetails,
    };
  },
});

// Get pending event invites for a user (for notification badge)
export const getPendingInvites = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const invites = await ctx.db
      .query("eventInvites")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "pending")
      )
      .collect();

    const now = Date.now();

    // Get event details for each invite
    const enriched = await Promise.all(
      invites.map(async (inv) => {
        const event = await ctx.db.get(inv.eventId);
        return {
          ...inv,
          event,
        };
      })
    );

    // Filter out cancelled events and past events
    return enriched.filter(
      (inv) => inv.event && !inv.event.isCancelled && inv.event.startTime > now
    );
  },
});

// Get count of unread event invites (for badge)
export const getUnreadInviteCount = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const invites = await ctx.db
      .query("eventInvites")
      .withIndex("by_user_unread", (q) =>
        q.eq("userId", args.userId).eq("isRead", false)
      )
      .collect();

    const now = Date.now();

    // Filter for pending status only and exclude cancelled/past events
    const validInvites = await Promise.all(
      invites
        .filter((i) => i.status === "pending")
        .map(async (invite) => {
          const event = await ctx.db.get(invite.eventId);
          // Only count if event exists, not cancelled, and not in the past
          if (event && !event.isCancelled && event.startTime > now) {
            return invite;
          }
          return null;
        })
    );

    return validInvites.filter(Boolean).length;
  },
});

// ============ MUTATIONS ============

// Create a new event
export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
    isAllDay: v.boolean(),
    location: v.optional(v.string()),
    meetingLink: v.optional(v.string()),
    meetingType: v.optional(v.string()),
    inviteeIds: v.array(v.id("users")),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Creating an event "as yourself" is the common path; managers
    // can also create events for anyone. Either way, gate via the
    // shared owner-or-manager helper.
    await requireSelfOrManager(ctx, args.userId, args.userId);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    const now = Date.now();

    // Create the event
    const eventId = await ctx.db.insert("events", {
      title: args.title,
      description: args.description,
      startTime: args.startTime,
      endTime: args.endTime,
      isAllDay: args.isAllDay,
      location: args.location,
      meetingLink: args.meetingLink,
      meetingType: args.meetingType,
      createdBy: args.userId,
      createdByName: user.name,
      createdAt: now,
      updatedAt: now,
    });

    // Create invites for all invitees
    for (const inviteeId of args.inviteeIds) {
      await ctx.db.insert("eventInvites", {
        eventId,
        userId: inviteeId,
        status: "pending",
        isRead: false,
        notifiedAt: now,
        createdAt: now,
      });
    }

    return eventId;
  },
});

// Create a recurring series: the first occurrence plus N-1 more
// occurrences spaced by the recurrence kind. Returns all event IDs.
export const createRecurring = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
    isAllDay: v.boolean(),
    location: v.optional(v.string()),
    meetingLink: v.optional(v.string()),
    meetingType: v.optional(v.string()),
    inviteeIds: v.array(v.id("users")),
    userId: v.id("users"),
    recurrence: v.string(), // "daily" | "weekly" | "monthly"
    count: v.number(),
  },
  handler: async (ctx, args) => {
    await requireSelfOrManager(ctx, args.userId, args.userId);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    const now = Date.now();
    const safeCount = Math.max(1, Math.min(Math.floor(args.count), 60));
    const rule = `FREQ=${args.recurrence.toUpperCase()}`;
    // Shared anchor for every event in this series — used by
    // cancelSeries / updateSeries / "edit all in series" UI.
    const seriesId = `srs_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    const shift = (ms: number, n: number) => {
      const d = new Date(ms);
      if (args.recurrence === "daily") d.setDate(d.getDate() + n);
      else if (args.recurrence === "weekly") d.setDate(d.getDate() + n * 7);
      else if (args.recurrence === "monthly") d.setMonth(d.getMonth() + n);
      return d.getTime();
    };

    const ids: string[] = [];
    for (let n = 0; n < safeCount; n++) {
      const eventId = await ctx.db.insert("events", {
        title: args.title,
        description: args.description,
        startTime: shift(args.startTime, n),
        endTime: shift(args.endTime, n),
        isAllDay: args.isAllDay,
        location: args.location,
        meetingLink: args.meetingLink,
        meetingType: args.meetingType,
        createdBy: args.userId,
        createdByName: user.name,
        isRecurring: true,
        recurrenceRule: rule,
        seriesId,
        createdAt: now,
        updatedAt: now,
      });
      for (const inviteeId of args.inviteeIds) {
        await ctx.db.insert("eventInvites", {
          eventId,
          userId: inviteeId,
          status: "pending",
          isRead: false,
          notifiedAt: now,
          createdAt: now,
        });
      }
      ids.push(eventId);
    }
    return { ids, seriesId };
  },
});

// Cancel every occurrence in a series (soft-cancel via isCancelled flag).
export const cancelSeries = mutation({
  args: { seriesId: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    const siblings = await ctx.db
      .query("events")
      .withIndex("by_series", (q) => q.eq("seriesId", args.seriesId))
      .collect();
    // Use the first occurrence's creator to determine ownership.
    const ownerId = siblings[0]?.createdBy ?? null;
    await requireSelfOrManager(ctx, args.userId, ownerId);
    const now = Date.now();
    for (const e of siblings) {
      if (!e.isCancelled) {
        await ctx.db.patch(e._id, {
          isCancelled: true,
          cancelledAt: now,
          cancelledBy: args.userId,
          updatedAt: now,
        });
      }
    }
    return siblings.length;
  },
});

// Apply field changes to every occurrence in a series. Date/time
// changes are intentionally NOT propagated — each occurrence keeps
// its own schedule, so the user can only bulk-edit metadata-style
// fields (title, description, location, link, meeting type, all-day).
export const updateSeries = mutation({
  args: {
    seriesId: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    isAllDay: v.optional(v.boolean()),
    location: v.optional(v.string()),
    meetingLink: v.optional(v.string()),
    meetingType: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { seriesId, requestingUserId, ...rest } = args;
    const updates = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(updates).length === 0) return 0;
    const siblings = await ctx.db
      .query("events")
      .withIndex("by_series", (q) => q.eq("seriesId", seriesId))
      .collect();
    const ownerId = siblings[0]?.createdBy ?? null;
    await requireSelfOrManager(ctx, requestingUserId, ownerId);
    const now = Date.now();
    for (const e of siblings) {
      await ctx.db.patch(e._id, { ...updates, updatedAt: now });
    }
    return siblings.length;
  },
});

// Update an event
export const update = mutation({
  args: {
    eventId: v.id("events"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    isAllDay: v.optional(v.boolean()),
    location: v.optional(v.string()),
    meetingLink: v.optional(v.string()),
    meetingType: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { eventId, requestingUserId, ...updates } = args;
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error("Event not found");
    await requireSelfOrManager(ctx, requestingUserId, event.createdBy);

    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    await ctx.db.patch(eventId, {
      ...filteredUpdates,
      updatedAt: Date.now(),
    });

    return eventId;
  },
});

// Delete an event permanently
export const deleteEvent = mutation({
  args: {
    eventId: v.id("events"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    // Delete invites first
    const invites = await ctx.db.query("eventInvites").withIndex("by_event", (q) => q.eq("eventId", args.eventId)).collect();
    for (const inv of invites) await ctx.db.delete(inv._id);
    await ctx.db.delete(args.eventId);
  },
});

// Cancel an event
export const cancel = mutation({
  args: {
    eventId: v.id("events"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Event not found");
    await requireSelfOrManager(ctx, args.userId, event.createdBy);

    await ctx.db.patch(args.eventId, {
      isCancelled: true,
      cancelledAt: Date.now(),
      cancelledBy: args.userId,
      updatedAt: Date.now(),
    });

    return args.eventId;
  },
});

// Add invitees to an existing event
export const addInvitees = mutation({
  args: {
    eventId: v.id("events"),
    inviteeIds: v.array(v.id("users")),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Event not found");
    await requireSelfOrManager(ctx, args.requestingUserId, event.createdBy);

    const now = Date.now();

    // Get existing invites
    const existingInvites = await ctx.db
      .query("eventInvites")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    const existingUserIds = new Set(existingInvites.map((i) => i.userId));

    // Add new invites
    for (const inviteeId of args.inviteeIds) {
      if (!existingUserIds.has(inviteeId)) {
        await ctx.db.insert("eventInvites", {
          eventId: args.eventId,
          userId: inviteeId,
          status: "pending",
          isRead: false,
          notifiedAt: now,
          createdAt: now,
        });
      }
    }

    return args.eventId;
  },
});

// Remove an invitee from an event
export const removeInvitee = mutation({
  args: {
    eventId: v.id("events"),
    userId: v.id("users"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Event not found");
    await requireSelfOrManager(ctx, args.requestingUserId, event.createdBy);
    const invite = await ctx.db
      .query("eventInvites")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();

    if (invite) {
      await ctx.db.delete(invite._id);
    }

    return args.eventId;
  },
});

// Respond to an event invite
export const respondToInvite = mutation({
  args: {
    eventId: v.id("events"),
    userId: v.id("users"),
    status: v.string(), // "accepted" | "declined" | "maybe"
  },
  handler: async (ctx, args) => {
    // Self-action — must be a real, active user. Identity is bound by
    // the userId arg matching the invite row below.
    await requireSelfOrManager(ctx, args.userId, args.userId);
    const invite = await ctx.db
      .query("eventInvites")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();

    if (!invite) throw new Error("Invite not found");

    await ctx.db.patch(invite._id, {
      status: args.status,
      respondedAt: Date.now(),
      isRead: true,
    });

    return invite._id;
  },
});

// Mark invite as read
export const markInviteRead = mutation({
  args: {
    eventId: v.id("events"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireSelfOrManager(ctx, args.userId, args.userId);
    const invite = await ctx.db
      .query("eventInvites")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();

    if (invite && !invite.isRead) {
      await ctx.db.patch(invite._id, { isRead: true });
    }

    return true;
  },
});

// Mark all invites as read for a user
export const markAllInvitesRead = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireSelfOrManager(ctx, args.userId, args.userId);
    const invites = await ctx.db
      .query("eventInvites")
      .withIndex("by_user_unread", (q) =>
        q.eq("userId", args.userId).eq("isRead", false)
      )
      .collect();

    for (const invite of invites) {
      await ctx.db.patch(invite._id, { isRead: true });
    }

    return invites.length;
  },
});

// ============ CALENDAR SHARING ============

// Get calendars shared with me
export const getSharedWithMe = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const shares = await ctx.db
      .query("calendarShares")
      .withIndex("by_shared_with", (q) => q.eq("sharedWithId", args.userId))
      .collect();

    // Get owner details
    const enriched = await Promise.all(
      shares.map(async (share) => {
        const owner = await ctx.db.get(share.ownerId);
        return {
          ...share,
          ownerName: owner?.name || "Unknown",
          ownerEmail: owner?.email || "",
        };
      })
    );

    return enriched;
  },
});

// Get who I've shared my calendar with
export const getMyShares = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const shares = await ctx.db
      .query("calendarShares")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.userId))
      .collect();

    // Get shared user details
    const enriched = await Promise.all(
      shares.map(async (share) => {
        const user = await ctx.db.get(share.sharedWithId);
        return {
          ...share,
          sharedWithName: user?.name || "Unknown",
          sharedWithEmail: user?.email || "",
        };
      })
    );

    return enriched;
  },
});

// Share my calendar with someone
export const shareCalendar = mutation({
  args: {
    ownerId: v.id("users"),
    sharedWithId: v.id("users"),
    permission: v.string(), // "view" | "edit"
  },
  handler: async (ctx, args) => {
    // Only the calendar owner (or a manager) can share their calendar.
    await requireSelfOrManager(ctx, args.ownerId, args.ownerId);
    // Check if already shared
    const existing = await ctx.db
      .query("calendarShares")
      .withIndex("by_owner_shared", (q) =>
        q.eq("ownerId", args.ownerId).eq("sharedWithId", args.sharedWithId)
      )
      .first();

    if (existing) {
      // Update permission
      await ctx.db.patch(existing._id, { permission: args.permission });
      return existing._id;
    }

    // Create new share
    const shareId = await ctx.db.insert("calendarShares", {
      ownerId: args.ownerId,
      sharedWithId: args.sharedWithId,
      permission: args.permission,
      createdAt: Date.now(),
    });

    return shareId;
  },
});

// Remove calendar share
export const removeCalendarShare = mutation({
  args: {
    shareId: v.id("calendarShares"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const share = await ctx.db.get(args.shareId);
    if (!share) throw new Error("Share not found");
    await requireSelfOrManager(ctx, args.requestingUserId, share.ownerId);
    await ctx.db.delete(args.shareId);
    return args.shareId;
  },
});

// Get events from shared calendars (for viewing other people's events)
export const getSharedCalendarEvents = query({
  args: {
    userId: v.id("users"),
    sharedOwnerId: v.id("users"), // The person whose calendar we're viewing
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Verify we have access to this calendar
    const share = await ctx.db
      .query("calendarShares")
      .withIndex("by_owner_shared", (q) =>
        q.eq("ownerId", args.sharedOwnerId).eq("sharedWithId", args.userId)
      )
      .first();

    if (!share) {
      throw new Error("You don't have access to this calendar");
    }

    // Get events created by the owner
    const createdEvents = await ctx.db
      .query("events")
      .withIndex("by_created_by", (q) => q.eq("createdBy", args.sharedOwnerId))
      .filter((q) => q.neq(q.field("isCancelled"), true))
      .collect();

    // Get events the owner is invited to and accepted
    const invites = await ctx.db
      .query("eventInvites")
      .withIndex("by_user", (q) => q.eq("userId", args.sharedOwnerId))
      .filter((q) => q.eq(q.field("status"), "accepted"))
      .collect();

    const invitedEventIds = new Set(invites.map((i) => i.eventId));
    const invitedEvents = await Promise.all(
      [...invitedEventIds].map((id) => ctx.db.get(id))
    );

    // Combine and deduplicate
    const allEventIds = new Set<string>();
    const allEvents = [];

    for (const event of [...createdEvents, ...invitedEvents.filter(Boolean)]) {
      if (event && !allEventIds.has(event._id) && !event.isCancelled) {
        allEventIds.add(event._id);
        allEvents.push(event);
      }
    }

    // Filter by date range if provided — overlap semantics so multi-day
    // events appear on every day they span, not just their first.
    let filtered = allEvents;
    if (args.endDate !== undefined) {
      filtered = filtered.filter((e) => e.startTime <= args.endDate!);
    }
    if (args.startDate !== undefined) {
      filtered = filtered.filter((e) => e.endTime >= args.startDate!);
    }

    // Sort by start time
    return filtered.sort((a, b) => a.startTime - b.startTime);
  },
});
