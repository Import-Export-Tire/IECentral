import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// ============ HELPERS ============

function generateRandomCode(): string {
  // Cryptographically secure — Math.random() is a recoverable PRNG, letting an
  // attacker predict other meetings' join codes.
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(bytes[i] % chars.length);
  }
  return code;
}

// ============ QUERIES ============

// Get a single meeting by ID
export const get = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    return meeting || null;
  },
});

// Find meeting by join code
export const getByJoinCode = query({
  args: { joinCode: v.string() },
  handler: async (ctx, args) => {
    const meeting = await ctx.db
      .query("meetings")
      .withIndex("by_join_code", (q) => q.eq("joinCode", args.joinCode.toUpperCase()))
      .first();

    return meeting || null;
  },
});

// List scheduled/active meetings for a user (as host or participant)
export const listUpcoming = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Get meetings where user is host
    const hostedMeetings = await ctx.db
      .query("meetings")
      .withIndex("by_host", (q) => q.eq("hostId", args.userId))
      .collect();

    const now = Date.now();
    const activeHosted = hostedMeetings.filter(
      (m) =>
        (m.status === "lobby" || m.status === "active") ||
        (m.status === "scheduled" && (m.scheduledStart === undefined || m.scheduledStart > now - 3600000)) // 1hr grace period
    );

    // Get meetings where user is a participant
    const participantRecords = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const participantMeetingIds = new Set(participantRecords.map((p) => p.meetingId));

    const participantMeetings = await Promise.all(
      [...participantMeetingIds].map((id) => ctx.db.get(id))
    );

    const activeParticipant = participantMeetings.filter(
      (m) =>
        m &&
        ((m.status === "lobby" || m.status === "active") ||
          (m.status === "scheduled" && (m.scheduledStart === undefined || m.scheduledStart > now - 3600000))) &&
        m.hostId !== args.userId // Avoid duplicates with hosted
    );

    // Combine and sort by scheduledStart (or createdAt as fallback)
    const allMeetings = [...activeHosted, ...activeParticipant.filter(Boolean)] as Array<
      NonNullable<(typeof participantMeetings)[number]>
    >;

    return allMeetings.sort(
      (a, b) => (a.scheduledStart || a.createdAt) - (b.scheduledStart || b.createdAt)
    );
  },
});

// List ended meetings for a user
export const listPast = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Get ended meetings where user is host
    const hostedMeetings = await ctx.db
      .query("meetings")
      .withIndex("by_host", (q) => q.eq("hostId", args.userId))
      .collect();

    const endedHosted = hostedMeetings.filter((m) => m.status === "ended");

    // Get ended meetings where user was a participant
    const participantRecords = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const participantMeetingIds = new Set(participantRecords.map((p) => p.meetingId));

    const participantMeetings = await Promise.all(
      [...participantMeetingIds].map((id) => ctx.db.get(id))
    );

    const endedParticipant = participantMeetings.filter(
      (m) => m && m.status === "ended" && m.hostId !== args.userId
    );

    // Combine and sort by endedAt descending (most recent first)
    const allMeetings = [...endedHosted, ...endedParticipant.filter(Boolean)] as Array<
      NonNullable<(typeof participantMeetings)[number]>
    >;

    return allMeetings.sort((a, b) => (b.endedAt || b.createdAt) - (a.endedAt || a.createdAt));
  },
});

// ============ MUTATIONS ============

// Create a new meeting
export const create = mutation({
  args: {
    title: v.string(),
    userId: v.id("users"),
    scheduledStart: v.optional(v.number()),
    scheduledEnd: v.optional(v.number()),
    isNotedMeeting: v.optional(v.boolean()),
    eventId: v.optional(v.id("events")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    // Generate unique join code
    let joinCode = generateRandomCode();
    let existing = await ctx.db
      .query("meetings")
      .withIndex("by_join_code", (q) => q.eq("joinCode", joinCode))
      .first();

    while (existing) {
      joinCode = generateRandomCode();
      existing = await ctx.db
        .query("meetings")
        .withIndex("by_join_code", (q) => q.eq("joinCode", joinCode))
        .first();
    }

    const now = Date.now();
    const status = args.scheduledStart ? "scheduled" : "lobby";

    const meetingId = await ctx.db.insert("meetings", {
      eventId: args.eventId,
      title: args.title,
      joinCode,
      hostId: args.userId,
      hostName: user.name,
      scheduledStart: args.scheduledStart,
      scheduledEnd: args.scheduledEnd,
      status,
      isNotedMeeting: args.isNotedMeeting ?? false,
      createdAt: now,
      updatedAt: now,
    });

    return meetingId;
  },
});

// Start a meeting (set status to active)
export const start = mutation({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");

    const now = Date.now();

    await ctx.db.patch(args.meetingId, {
      status: "active",
      startedAt: now,
      updatedAt: now,
    });

    return args.meetingId;
  },
});

// End a meeting
export const end = mutation({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");

    const now = Date.now();

    await ctx.db.patch(args.meetingId, {
      status: "ended",
      endedAt: now,
      updatedAt: now,
    });

    return args.meetingId;
  },
});

// Toggle isNotedMeeting on/off
export const updateNotedMeeting = mutation({
  args: {
    meetingId: v.id("meetings"),
    isNotedMeeting: v.boolean(),
  },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");

    await ctx.db.patch(args.meetingId, {
      isNotedMeeting: args.isNotedMeeting,
      updatedAt: Date.now(),
    });

    return args.meetingId;
  },
});
