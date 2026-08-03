import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

// ─── REPORT TYPES ───────────────────────────────────────────────────────────

export const listReportTypes = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("jmkReportTypes")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
  },
});

export const getReportType = query({
  args: { reportCode: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("jmkReportTypes")
      .withIndex("by_code", (q) => q.eq("reportCode", args.reportCode))
      .first();
  },
});

export const seedReportType = mutation({
  args: {
    reportCode: v.string(),
    displayName: v.string(),
    description: v.string(),
    expectedColumns: v.array(v.string()),
    filePattern: v.string(),
    acceptedFormats: v.array(v.string()),
    s3Prefix: v.string(),
    processingTriggers: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("jmkReportTypes")
      .withIndex("by_code", (q) => q.eq("reportCode", args.reportCode))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }

    return await ctx.db.insert("jmkReportTypes", {
      ...args,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ─── UPLOAD HISTORY ─────────────────────────────────────────────────────────

export const recordUpload = mutation({
  args: {
    reportType: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    s3Key: v.string(),
    reportingMonth: v.string(),
    reportDate: v.optional(v.string()),
    rowCount: v.optional(v.number()),
    dateRangeStart: v.optional(v.string()),
    dateRangeEnd: v.optional(v.string()),
    validationStatus: v.string(),
    validationErrors: v.optional(v.array(v.string())),
    uploadedBy: v.optional(v.id("users")),
    uploadedByName: v.string(),
  },
  handler: async (ctx, args) => {
    const dataSources = ["oeival", "oea07v-sales", "tires"];
    return await ctx.db.insert("jmkUploadHistory", {
      ...args,
      processingStatus: dataSources.includes(args.reportType) ? "complete" : "pending",
      createdAt: Date.now(),
    });
  },
});

export const updateProcessing = mutation({
  args: {
    uploadId: v.id("jmkUploadHistory"),
    processingStatus: v.string(),
    processingResults: v.optional(v.array(v.object({
      trigger: v.string(),
      status: v.string(),
      message: v.optional(v.string()),
      completedAt: v.optional(v.number()),
    }))),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadId, {
      processingStatus: args.processingStatus,
      processingResults: args.processingResults,
    });
  },
});

/**
 * Correct a stored upload date range.
 *
 * Maintenance only. Until 2026-08-03, /reports/upload computed an OEA07V's range by
 * regex-scanning each row for the first date-shaped token anywhere in the line, so it
 * could latch onto some other dated column. IET-oea07v_July 2026.csv was stored as
 * "Jun 12, 2026 - Jul 31, 2026" though every Activity Date in it is July. The reader
 * now parses COL.ACTIVITY_DATE positionally, but already-written records do not
 * recompute — they are persisted history.
 *
 * internalMutation deliberately: this rewrites audit metadata, so it is reachable
 * from `npx convex run` with a deploy key and not from any client.
 *
 * Format must match what the uploader writes:
 *   toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
 * i.e. "Jul 1, 2026".
 */
export const correctDateRange = internalMutation({
  args: {
    uploadId: v.id("jmkUploadHistory"),
    dateRangeStart: v.string(),
    dateRangeEnd: v.string(),
  },
  handler: async (ctx, args) => {
    const before = await ctx.db.get(args.uploadId);
    if (!before) throw new Error(`No jmkUploadHistory record ${args.uploadId}`);
    await ctx.db.patch(args.uploadId, {
      dateRangeStart: args.dateRangeStart,
      dateRangeEnd: args.dateRangeEnd,
    });
    return {
      fileName: before.fileName,
      from: { start: before.dateRangeStart, end: before.dateRangeEnd },
      to: { start: args.dateRangeStart, end: args.dateRangeEnd },
    };
  },
});

export const deleteUpload = mutation({
  args: { id: v.id("jmkUploadHistory") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const listUploadHistory = query({
  args: {
    reportType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db.query("jmkUploadHistory").withIndex("by_created").order("desc");

    const results = await q.collect();

    let filtered = results;
    if (args.reportType) {
      filtered = results.filter((r) => r.reportType === args.reportType);
    }

    return filtered.slice(0, args.limit ?? 50);
  },
});

export const getUpload = query({
  args: { uploadId: v.id("jmkUploadHistory") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.uploadId);
  },
});

export const getLatestByType = query({
  args: { reportType: v.string() },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("jmkUploadHistory")
      .withIndex("by_created")
      .order("desc")
      .collect();
    return all.find((r) => r.reportType === args.reportType) ?? null;
  },
});

// ─── ACCESS CONTROL ─────────────────────────────────────────────────────────

export const checkUploadAccess = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const records = await ctx.db.query("reportUploadAccess").collect();
    if (!records[0]) return false;
    return records[0].userIds.includes(args.userId);
  },
});

export const getUploadAccessWithNames = query({
  handler: async (ctx) => {
    const records = await ctx.db.query("reportUploadAccess").collect();
    const record = records[0];
    if (!record) return { userIds: [], users: [] };

    const users = await Promise.all(
      record.userIds.map(async (userId) => {
        const user = await ctx.db.get(userId);
        return user ? { _id: user._id, name: user.name, email: user.email } : null;
      })
    );

    return {
      userIds: record.userIds,
      users: users.filter(Boolean),
    };
  },
});

export const setUploadAccess = mutation({
  args: {
    userIds: v.array(v.id("users")),
    updatedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("reportUploadAccess").collect();
    const now = Date.now();

    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, {
        userIds: args.userIds,
        updatedBy: args.updatedBy,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("reportUploadAccess", {
        userIds: args.userIds,
        updatedBy: args.updatedBy,
        updatedAt: now,
      });
    }
  },
});
