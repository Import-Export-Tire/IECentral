import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// ============ QUERIES ============

// List all participants for a meeting (real-time subscription)
export const getByMeeting = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();

    // Enrich with user info where available
    const enriched = await Promise.all(
      participants.map(async (p) => {
        const user = p.userId ? await ctx.db.get(p.userId) : null;
        return {
          ...p,
          email: user?.email || p.guestEmail || null,
        };
      })
    );

    return enriched;
  },
});

// Get current user's participant record for a meeting
export const getMyParticipant = query({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const participant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();

    return participant || null;
  },
});

// ============ MUTATIONS ============

// Join a meeting (create participant record)
// Is this user the host or a participant of the meeting? Used to gate access to
// meeting recordings (the audio presign route).
export const isMember = query({
  args: { meetingId: v.id("meetings"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return false;
    if (meeting.hostId === args.userId) return true;
    const participant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();
    return !!participant;
  },
});

export const join = mutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.optional(v.id("users")),
    guestName: v.optional(v.string()),
    guestEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");

    let displayName = "Guest";

    if (args.userId) {
      // Registered user — look up name
      const user = await ctx.db.get(args.userId);
      if (!user) throw new Error("User not found");
      displayName = user.name;

      // Check if user already has an active participant record
      const existing = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
        .filter((q) =>
          q.and(
            q.eq(q.field("userId"), args.userId),
            q.neq(q.field("status"), "disconnected"),
            q.neq(q.field("status"), "removed")
          )
        )
        .first();

      if (existing) {
        // Rejoin — update existing record
        await ctx.db.patch(existing._id, {
          status: meeting.hostId === args.userId ? "connected" : "lobby",
          joinedAt: Date.now(),
          leftAt: undefined,
          updatedAt: Date.now(),
        });
        return existing._id;
      }
    } else if (args.guestName) {
      displayName = args.guestName;
    }

    const now = Date.now();

    // Host goes straight to "connected", others go to "lobby"
    const status = args.userId && meeting.hostId === args.userId ? "connected" : "lobby";

    const participantId = await ctx.db.insert("meetingParticipants", {
      meetingId: args.meetingId,
      userId: args.userId,
      guestName: args.guestName,
      guestEmail: args.guestEmail,
      displayName,
      status,
      joinedAt: now,
      isMuted: false,
      isCameraOff: false,
      isScreenSharing: false,
      createdAt: now,
      updatedAt: now,
    });

    return participantId;
  },
});

// Leave a meeting
export const leave = mutation({
  args: { participantId: v.id("meetingParticipants") },
  handler: async (ctx, args) => {
    const participant = await ctx.db.get(args.participantId);
    if (!participant) throw new Error("Participant not found");

    const now = Date.now();

    await ctx.db.patch(args.participantId, {
      status: "disconnected",
      leftAt: now,
      updatedAt: now,
    });

    return args.participantId;
  },
});

// Update media state (mute, camera, screen sharing)
export const updateMediaState = mutation({
  args: {
    participantId: v.id("meetingParticipants"),
    isMuted: v.optional(v.boolean()),
    isCameraOff: v.optional(v.boolean()),
    isScreenSharing: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const participant = await ctx.db.get(args.participantId);
    if (!participant) throw new Error("Participant not found");

    const updates: Record<string, boolean | number> = {
      updatedAt: Date.now(),
    };

    if (args.isMuted !== undefined) updates.isMuted = args.isMuted;
    if (args.isCameraOff !== undefined) updates.isCameraOff = args.isCameraOff;
    if (args.isScreenSharing !== undefined) updates.isScreenSharing = args.isScreenSharing;

    await ctx.db.patch(args.participantId, updates);

    return args.participantId;
  },
});

// Admit a participant from lobby (host only)
export const admitFromLobby = mutation({
  args: {
    participantId: v.id("meetingParticipants"),
    hostUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const participant = await ctx.db.get(args.participantId);
    if (!participant) throw new Error("Participant not found");

    // Verify the caller is the host
    const meeting = await ctx.db.get(participant.meetingId);
    if (!meeting) throw new Error("Meeting not found");
    if (meeting.hostId !== args.hostUserId) {
      throw new Error("Only the host can admit participants");
    }

    if (participant.status !== "lobby") {
      throw new Error("Participant is not in the lobby");
    }

    await ctx.db.patch(args.participantId, {
      status: "connected",
      joinedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return args.participantId;
  },
});
