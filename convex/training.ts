import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireTrainingAccess } from "./authGuards";

// Lightweight check used by the API routes (does the user have training access?).
export const hasTrainingAccess = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.isActive === false) return false;
    const overrides = (user.permissionOverrides ?? {}) as Record<string, boolean>;
    return overrides["menu.training"] === true;
  },
});

export const listSegments = query({
  args: {},
  handler: async (ctx) => {
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
  args: { segmentId: v.id("trainingSegments") },
  handler: async (ctx, args) => {
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
