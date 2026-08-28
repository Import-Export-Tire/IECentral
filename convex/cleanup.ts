import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const deleteOldMessages = internalMutation({
  args: {
    batchSize: v.number(),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 500;
    const cutoff = Date.now() - SEVEN_DAYS_MS;

    // If you're using Convex's built-in _creationTime:
    const oldDocs = await ctx.db
        .query("messages")
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
        .take(batchSize); // batch size

    for (const doc of oldDocs) {
      await ctx.db.delete(doc._id);
    }

    return { deleted: oldDocs.length };
  },
});

export const deleteOldEmailSyncLogs = internalMutation({
  args: {
    batchSize: v.number(),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 4000;
    const cutoff = Date.now() - THREE_DAYS_MS;

    const oldDocs = await ctx.db
        .query("emailSyncLogs")
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
        .take(batchSize); // batch size

    for (const doc of oldDocs) {
      await ctx.db.delete(doc._id);
    }

    return { deleted: oldDocs.length, hasMore: oldDocs.length === 500 };
  },
});

export const deleteOldEmails = internalMutation({
  args: {
    batchSize: v.number(),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 50;
    const cutoff = Date.now() - SEVEN_DAYS_MS;

    const oldDocs = await ctx.db
        .query("emails")
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
        .take(batchSize); // batch size

    for (const doc of oldDocs) {
      await ctx.db.delete(doc._id);
    }

    return { deleted: oldDocs.length, hasMore: oldDocs.length === 500 };
  },
});

export const deleteOldEmailAttachments = internalMutation({
  args: {
    batchSize: v.number(),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 500;
    const cutoff = Date.now() - SEVEN_DAYS_MS;

    const oldDocs = await ctx.db
        .query("emailAttachments")
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
        .take(batchSize); // batch size

    for (const doc of oldDocs) {
      await ctx.db.delete(doc._id);
    }

    return { deleted: oldDocs.length, hasMore: oldDocs.length === 500 };
  },
});

export const deleteOldApplications = internalMutation({
  args: {
    batchSize: v.number(),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 50;
    const cutoff = Date.now() - SEVEN_DAYS_MS;

    const oldDocs = await ctx.db
        .query("applications")
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
        .take(batchSize); // batch size

    for (const doc of oldDocs) {
      await ctx.db.delete(doc._id);
    }

    return { deleted: oldDocs.length, hasMore: oldDocs.length === 500 };
  },
});

export const deleteOldAuditLogs = internalMutation({
  args: {
    batchSize: v.number(),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 50;
    const cutoff = Date.now() - SEVEN_DAYS_MS;

    const oldDocs = await ctx.db
        .query("auditLogs")
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
        .take(batchSize); // batch size

    for (const doc of oldDocs) {
      await ctx.db.delete(doc._id);
    }

    return { deleted: oldDocs.length, hasMore: oldDocs.length === 500 };
  },
});

export const deleteOldScannerSetupLogs = internalMutation({
  args: {
    batchSize: v.number(),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 50;
    const cutoff = Date.now() - SEVEN_DAYS_MS;

    const oldDocs = await ctx.db
        .query("scannerSetupLogs")
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
        .take(batchSize); // batch size

    for (const doc of oldDocs) {
      await ctx.db.delete(doc._id);
    }

    return { deleted: oldDocs.length, hasMore: oldDocs.length === 500 };
  },
});

export const deleteOldInventoryAdjustments = internalMutation({
  args: {
    batchSize: v.number(),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 50;
    const cutoff = Date.now() - SEVEN_DAYS_MS;

    const oldDocs = await ctx.db
        .query("inventoryAdjustments")
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
        .take(batchSize); // batch size

    for (const doc of oldDocs) {
      await ctx.db.delete(doc._id);
    }

    return { deleted: oldDocs.length, hasMore: oldDocs.length === 500 };
  },
});