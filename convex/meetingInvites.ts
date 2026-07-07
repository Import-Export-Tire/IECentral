import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// ============ HELPERS ============

function generateInviteToken(): string {
  // Cryptographically secure — Math.random() is a recoverable PRNG, letting an
  // attacker predict other invitees' tokens (which leak email/name via getByToken).
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(bytes[i] % chars.length);
  }
  return token;
}

// ============ QUERIES ============

export const getByMeeting = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("meetingInvites")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();
  },
});

export const getByToken = query({
  args: { inviteToken: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("meetingInvites")
      .withIndex("by_token", (q) => q.eq("inviteToken", args.inviteToken))
      .first();

    if (!invite) return null;

    const meeting = await ctx.db.get(invite.meetingId);
    return {
      ...invite,
      meetingTitle: meeting?.title ?? "Unknown Meeting",
      meetingHostName: meeting?.hostName ?? "Unknown",
      meetingStatus: meeting?.status ?? "ended",
      meetingJoinCode: meeting?.joinCode ?? "",
    };
  },
});

// ============ MUTATIONS ============

export const createInvite = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");

    const now = Date.now();
    const inviteToken = generateInviteToken();

    await ctx.db.insert("meetingInvites", {
      meetingId: args.meetingId,
      email: args.email.toLowerCase().trim(),
      name: args.name?.trim(),
      inviteToken,
      status: "sent",
      sentAt: now,
      createdAt: now,
    });

    return {
      inviteToken,
      meetingTitle: meeting.title,
      hostName: meeting.hostName,
      joinCode: meeting.joinCode,
    };
  },
});

export const updateStatus = mutation({
  args: {
    inviteToken: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    // Bound the status to known values so a token holder can't write arbitrary
    // free-text into another person's invite record.
    const ALLOWED_STATUSES = ["sent", "opened", "joined", "declined"];
    if (!ALLOWED_STATUSES.includes(args.status)) {
      throw new Error("Invalid invite status");
    }
    const invite = await ctx.db
      .query("meetingInvites")
      .withIndex("by_token", (q) => q.eq("inviteToken", args.inviteToken))
      .first();

    if (!invite) throw new Error("Invite not found");

    await ctx.db.patch(invite._id, { status: args.status });
    return invite._id;
  },
});
