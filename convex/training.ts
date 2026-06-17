import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireTrainingAccess } from "./authGuards";

async function userHasTrainingAccess(ctx: any, userId: Id<"users">): Promise<boolean> {
  const user = await ctx.db.get(userId);
  if (!user || user.isActive === false) return false;
  const overrides = (user.permissionOverrides ?? {}) as Record<string, boolean>;
  return user.role === "super_admin" || overrides["menu.training"] === true;
}

// Insert a (personnel, video) completion unless one already exists for that video.
async function upsertCompletion(
  ctx: any,
  args: { personnelId: any; video: any; segmentTitle: string; source: string; certifiedBy?: any; sessionId?: any }
): Promise<void> {
  const existing = await ctx.db
    .query("trainingCompletions")
    .withIndex("by_personnel", (q: any) => q.eq("personnelId", args.personnelId))
    .collect();
  if (existing.some((c: any) => c.videoId === args.video._id)) return;
  await ctx.db.insert("trainingCompletions", {
    personnelId: args.personnelId,
    videoId: args.video._id,
    segmentId: args.video.segmentId,
    segmentTitle: args.segmentTitle,
    videoTitle: args.video.title,
    completedAt: Date.now(),
    source: args.source,
    certifiedBy: args.certifiedBy,
    sessionId: args.sessionId,
  });
}

// Lightweight check used by the API routes (does the user have training access?).
export const hasTrainingAccess = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await userHasTrainingAccess(ctx, args.userId);
  },
});

export const listSegments = query({
  args: { requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await userHasTrainingAccess(ctx, args.requestingUserId))) return [];
    const segments = await ctx.db.query("trainingSegments").withIndex("by_order").collect();
    return segments.sort((a, b) => a.order - b.order);
  },
});

export const createSegment = mutation({
  args: { title: v.string(), description: v.optional(v.string()), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const existing = await ctx.db.query("trainingSegments").collect();
    const maxOrder = existing.reduce((m, s) => Math.max(m, s.order), -1);
    const now = Date.now();
    return await ctx.db.insert("trainingSegments", {
      title: args.title, description: args.description, order: maxOrder + 1,
      isActive: true, createdBy: args.requestingUserId, createdAt: now, updatedAt: now,
    });
  },
});

export const updateSegment = mutation({
  args: { segmentId: v.id("trainingSegments"), title: v.optional(v.string()), description: v.optional(v.string()), order: v.optional(v.number()), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const { segmentId, requestingUserId: _r, ...rest } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(rest)) if (val !== undefined) patch[k] = val;
    await ctx.db.patch(segmentId, patch);
    return segmentId;
  },
});

export const deleteSegment = mutation({
  args: { segmentId: v.id("trainingSegments"), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const vids = await ctx.db.query("trainingVideos").withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId)).collect();
    for (const vid of vids) await ctx.db.delete(vid._id);
    await ctx.db.delete(args.segmentId);
    return { deletedVideos: vids.map((vid) => vid.s3Key) };
  },
});

export const listVideos = query({
  args: { segmentId: v.id("trainingSegments"), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await userHasTrainingAccess(ctx, args.requestingUserId))) return [];
    const vids = await ctx.db.query("trainingVideos").withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId)).collect();
    return vids.sort((a, b) => a.order - b.order);
  },
});

export const addVideo = mutation({
  args: { segmentId: v.id("trainingSegments"), title: v.string(), s3Key: v.string(), durationSec: v.optional(v.number()), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const existing = await ctx.db.query("trainingVideos").withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId)).collect();
    const maxOrder = existing.reduce((m, vid) => Math.max(m, vid.order), -1);
    return await ctx.db.insert("trainingVideos", {
      segmentId: args.segmentId, title: args.title, s3Key: args.s3Key, order: maxOrder + 1,
      durationSec: args.durationSec, createdBy: args.requestingUserId, createdAt: Date.now(),
    });
  },
});

export const updateVideo = mutation({
  args: { videoId: v.id("trainingVideos"), title: v.optional(v.string()), order: v.optional(v.number()), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const { videoId, requestingUserId: _r, ...rest } = args;
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) if (val !== undefined) patch[k] = val;
    await ctx.db.patch(videoId, patch);
    return videoId;
  },
});

export const deleteVideo = mutation({
  args: { videoId: v.id("trainingVideos"), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const vid = await ctx.db.get(args.videoId);
    await ctx.db.delete(args.videoId);
    return { s3Key: vid?.s3Key };
  },
});

export const listSessions = query({
  args: { requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await userHasTrainingAccess(ctx, args.requestingUserId))) return [];
    const sessions = await ctx.db.query("trainingSessions").withIndex("by_date").collect();
    return sessions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  },
});

export const logSession = mutation({
  args: {
    segmentId: v.id("trainingSegments"),
    date: v.string(),
    videoIds: v.array(v.id("trainingVideos")),
    personnelAttendees: v.array(v.id("personnel")),
    guestAttendees: v.array(v.string()),
    notes: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const segment = await ctx.db.get(args.segmentId);
    if (!segment) throw new Error("Segment not found");
    const presenter = await ctx.db.get(args.requestingUserId);
    const now = Date.now();

    const sessionId = await ctx.db.insert("trainingSessions", {
      segmentId: args.segmentId, segmentTitle: segment.title, date: args.date,
      presenterId: args.requestingUserId, presenterName: presenter?.name ?? "Unknown",
      personnelAttendees: args.personnelAttendees, guestAttendees: args.guestAttendees,
      videoIds: args.videoIds, notes: args.notes, createdAt: now,
    });

    const videos = (await Promise.all(args.videoIds.map((id) => ctx.db.get(id)))).filter(Boolean);
    for (const personnelId of args.personnelAttendees) {
      const p = await ctx.db.get(personnelId);
      if (!p) continue;
      for (const video of videos) {
        await upsertCompletion(ctx, {
          personnelId, video, segmentTitle: segment.title,
          source: "session", certifiedBy: args.requestingUserId, sessionId,
        });
      }
    }
    return sessionId;
  },
});

// Completions + assignments for one employee, grouped by segment (for the profile panel).
export const personnelTrainingProgress = query({
  args: { personnelId: v.id("personnel"), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await userHasTrainingAccess(ctx, args.requestingUserId))) return [];
    const completions = await ctx.db.query("trainingCompletions")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId)).collect();
    const assignments = await ctx.db.query("trainingAssignments")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId)).collect();
    const completedVideoIds = new Set(completions.map((c) => c.videoId));
    const assignedVideoIds = new Set(assignments.map((a) => a.videoId));
    const segIds = Array.from(new Set([...completions.map((c) => c.segmentId), ...assignments.map((a) => a.segmentId)]));
    const out = [];
    for (const segId of segIds) {
      const seg = await ctx.db.get(segId);
      if (!seg) continue;
      const vids = await ctx.db.query("trainingVideos").withIndex("by_segment", (q) => q.eq("segmentId", segId)).collect();
      vids.sort((a, b) => a.order - b.order);
      out.push({
        segmentId: segId, title: seg.title, totalVideos: vids.length,
        videos: vids.map((v2) => ({
          videoId: v2._id, title: v2.title,
          completed: completedVideoIds.has(v2._id),
          assigned: assignedVideoIds.has(v2._id),
          completedAt: completions.find((c) => c.videoId === v2._id)?.completedAt ?? null,
        })),
        completedCount: vids.filter((v2) => completedVideoIds.has(v2._id)).length,
        assignedCount: vids.filter((v2) => assignedVideoIds.has(v2._id)).length,
      });
    }
    return out;
  },
});

// Per-segment roster: every non-terminated personnel with any assignment or completion in the segment.
export const segmentRoster = query({
  args: { segmentId: v.id("trainingSegments"), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await userHasTrainingAccess(ctx, args.requestingUserId))) return [];
    const vids = await ctx.db.query("trainingVideos").withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId)).collect();
    const total = vids.length;
    const completions = await ctx.db.query("trainingCompletions").withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId)).collect();
    const segAssignments = await ctx.db.query("trainingAssignments").withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId)).collect();
    const byPersonnel = new Map<string, { completed: Set<string>; assigned: number }>();
    for (const c of completions) {
      const e = byPersonnel.get(c.personnelId) ?? { completed: new Set<string>(), assigned: 0 };
      e.completed.add(c.videoId); byPersonnel.set(c.personnelId, e);
    }
    for (const a of segAssignments) {
      const e = byPersonnel.get(a.personnelId) ?? { completed: new Set<string>(), assigned: 0 };
      e.assigned += 1; byPersonnel.set(a.personnelId, e);
    }
    const rows = [];
    for (const [personnelId, e] of byPersonnel) {
      const p = await ctx.db.get(personnelId as any);
      if (!p || (p as any).status === "terminated") continue;
      rows.push({ personnelId, name: `${(p as any).lastName}, ${(p as any).firstName}`, completed: e.completed.size, total });
    }
    rows.sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
    return rows;
  },
});
