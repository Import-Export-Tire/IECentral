import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireMinTier } from "./authGuards";

// Supported tables for soft delete
const SUPPORTED_TABLES = [
  "personnel",
  "users",
  "jobs",
  "applications",
  "announcements",
  "events",
  "documents",
  "projects",
  "equipment",
] as const;

type SupportedTable = (typeof SUPPORTED_TABLES)[number];

// Roles that can delete records (archived)
const DELETE_ROLES = ["super_admin", "admin"];

// Roles that can restore deleted records
const RESTORE_ROLES = ["super_admin"];

// Get all deleted records for admin review.
// SECURITY: each row's recordData is a full JSON snapshot of a deleted record
// (incl. user/equipment secrets), so this must be gated. Tier 4+ matches the
// /deleted-records page's <Protected minTier={4}>.
export const getDeletedRecords = query({
  args: {
    requestingUserId: v.id("users"),
    tableName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMinTier(ctx, args.requestingUserId, 4);
    let records;

    if (args.tableName) {
      records = await ctx.db
        .query("deletedRecords")
        .withIndex("by_table", (q) => q.eq("tableName", args.tableName as string))
        .order("desc")
        .collect();
    } else {
      records = await ctx.db
        .query("deletedRecords")
        .order("desc")
        .collect();
    }

    // Filter out already restored records
    return records.filter((r) => !r.restoredAt);
  },
});

// Get deletion audit log (all deletions including restored).
// SECURITY: returns recordData snapshots — gate to tier 4+.
export const getDeletionAuditLog = query({
  args: {
    requestingUserId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMinTier(ctx, args.requestingUserId, 4);
    const limit = args.limit || 100;
    const records = await ctx.db
      .query("deletedRecords")
      .withIndex("by_deleted_at")
      .order("desc")
      .take(limit);

    return records;
  },
});

// Soft delete a record (admin+)
export const softDeleteRecord = mutation({
  args: {
    tableName: v.string(),
    recordId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get current user from session
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Find user by email
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", identity.email!))
      .first();

    if (!user || !DELETE_ROLES.includes(user.role)) {
      throw new Error("Permission denied: Only admins can delete records");
    }

    // Validate table name
    if (!SUPPORTED_TABLES.includes(args.tableName as SupportedTable)) {
      throw new Error(`Unsupported table: ${args.tableName}`);
    }

    // Get the original record
    const originalRecord = await ctx.db.get(args.recordId as any);
    if (!originalRecord) {
      throw new Error("Record not found");
    }

    // Create a summary for the record
    let recordSummary = "";
    switch (args.tableName) {
      case "personnel":
        recordSummary = `${(originalRecord as any).name || "Unknown"} - Personnel`;
        break;
      case "users":
        recordSummary = `${(originalRecord as any).name || (originalRecord as any).email || "Unknown"} - User`;
        break;
      case "jobs":
        recordSummary = `${(originalRecord as any).title || "Unknown"} - Job Listing`;
        break;
      case "applications":
        recordSummary = `${(originalRecord as any).applicantName || "Unknown"} - Application`;
        break;
      case "announcements":
        recordSummary = `${(originalRecord as any).title || "Unknown"} - Announcement`;
        break;
      case "events":
        recordSummary = `${(originalRecord as any).title || "Unknown"} - Calendar Event`;
        break;
      case "documents":
        recordSummary = `${(originalRecord as any).name || "Unknown"} - Document`;
        break;
      case "projects":
        recordSummary = `${(originalRecord as any).name || "Unknown"} - Project`;
        break;
      case "equipment":
        recordSummary = `${(originalRecord as any).name || "Unknown"} - Equipment`;
        break;
      default:
        recordSummary = `Record from ${args.tableName}`;
    }

    // Archive the record
    await ctx.db.insert("deletedRecords", {
      tableName: args.tableName,
      originalId: args.recordId,
      recordData: JSON.stringify(originalRecord),
      recordSummary,
      deletedBy: user._id,
      deletedByName: user.name,
      deletedAt: Date.now(),
      reason: args.reason,
    });

    // Delete the original record
    await ctx.db.delete(args.recordId as any);

    // Log to audit
    await ctx.db.insert("auditLogs", {
      action: "soft_delete",
      actionType: "delete",
      resourceType: args.tableName,
      resourceId: args.recordId,
      userId: user._id,
      userEmail: user.email || "unknown",
      details: `Deleted ${recordSummary}${args.reason ? ` - Reason: ${args.reason}` : ""}`,
      timestamp: Date.now(),
    });

    return { success: true, recordSummary };
  },
});

// Restore a deleted record (super_admin only)
export const restoreRecord = mutation({
  args: {
    deletedRecordId: v.id("deletedRecords"),
  },
  handler: async (ctx, args) => {
    // Get current user from session
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Find user by email
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", identity.email!))
      .first();

    if (!user || !RESTORE_ROLES.includes(user.role)) {
      throw new Error("Permission denied: Only super admins can restore records");
    }

    // Get the deleted record
    const deletedRecord = await ctx.db.get(args.deletedRecordId);
    if (!deletedRecord) {
      throw new Error("Deleted record not found");
    }

    if (deletedRecord.restoredAt) {
      throw new Error("Record has already been restored");
    }

    // Parse the original record data
    const originalData = JSON.parse(deletedRecord.recordData);

    // Remove the _id and _creationTime from the original data (Convex will assign new ones)
    const { _id, _creationTime, ...dataToRestore } = originalData;

    // Insert the record back into the original table
    // Note: We use any here because we're dynamically inserting into different tables
    const tableName = deletedRecord.tableName as SupportedTable;
    let newRecordId: any;

    switch (tableName) {
      case "personnel":
        newRecordId = await ctx.db.insert("personnel", dataToRestore);
        break;
      case "users":
        newRecordId = await ctx.db.insert("users", dataToRestore);
        break;
      case "jobs":
        newRecordId = await ctx.db.insert("jobs", dataToRestore);
        break;
      case "applications":
        newRecordId = await ctx.db.insert("applications", dataToRestore);
        break;
      case "announcements":
        newRecordId = await ctx.db.insert("announcements", dataToRestore);
        break;
      case "events":
        newRecordId = await ctx.db.insert("events", dataToRestore);
        break;
      case "documents":
        newRecordId = await ctx.db.insert("documents", dataToRestore);
        break;
      case "projects":
        newRecordId = await ctx.db.insert("projects", dataToRestore);
        break;
      case "equipment":
        newRecordId = await ctx.db.insert("equipment", dataToRestore);
        break;
      default:
        throw new Error(`Cannot restore records from table: ${tableName}`);
    }

    // Mark the deleted record as restored
    await ctx.db.patch(args.deletedRecordId, {
      restoredAt: Date.now(),
      restoredBy: user._id,
    });

    // Log to audit
    await ctx.db.insert("auditLogs", {
      action: "restore_record",
      actionType: "restore",
      resourceType: deletedRecord.tableName,
      resourceId: String(newRecordId),
      userId: user._id,
      userEmail: user.email || "unknown",
      details: `Restored ${deletedRecord.recordSummary} (original ID: ${deletedRecord.originalId})`,
      timestamp: Date.now(),
    });

    return { success: true, newRecordId, recordSummary: deletedRecord.recordSummary };
  },
});

// Permanently delete a record (super_admin only - for GDPR/compliance)
export const permanentlyDelete = mutation({
  args: {
    deletedRecordId: v.id("deletedRecords"),
  },
  handler: async (ctx, args) => {
    // Get current user from session
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Find user by email
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", identity.email!))
      .first();

    if (!user || user.role !== "super_admin") {
      throw new Error("Permission denied: Only super admins can permanently delete records");
    }

    // Get the deleted record
    const deletedRecord = await ctx.db.get(args.deletedRecordId);
    if (!deletedRecord) {
      throw new Error("Deleted record not found");
    }

    // Log before permanent deletion
    await ctx.db.insert("auditLogs", {
      action: "permanent_delete",
      actionType: "permanent_delete",
      resourceType: deletedRecord.tableName,
      resourceId: deletedRecord.originalId,
      userId: user._id,
      userEmail: user.email || "unknown",
      details: `Permanently deleted ${deletedRecord.recordSummary}`,
      timestamp: Date.now(),
    });

    // Delete the archive record
    await ctx.db.delete(args.deletedRecordId);

    return { success: true };
  },
});

// Get count of deleted records by table (counts only, but gate to match the page).
export const getDeletedRecordCounts = query({
  args: { requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireMinTier(ctx, args.requestingUserId, 4);
    const records = await ctx.db
      .query("deletedRecords")
      .filter((q) => q.eq(q.field("restoredAt"), undefined))
      .collect();

    const counts: Record<string, number> = {};
    for (const record of records) {
      counts[record.tableName] = (counts[record.tableName] || 0) + 1;
    }

    return {
      total: records.length,
      byTable: counts,
    };
  },
});
