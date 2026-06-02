import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireAdmin } from "./authGuards";

// ─── CUSTOMER CONFIG QUERIES ────────────────────────────────────────────────

export const listCustomers = query({
  handler: async (ctx) => {
    return await ctx.db.query("wtdCommissionCustomers").collect();
  },
});

export const getActiveCustomers = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("wtdCommissionCustomers")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
  },
});

export const getCustomer = query({
  args: { id: v.id("wtdCommissionCustomers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ─── CUSTOMER CONFIG MUTATIONS ──────────────────────────────────────────────

export const createCustomer = mutation({
  args: {
    customerName: v.string(),
    customerNumber: v.string(),
    qualifyingDclasses: v.array(v.string()),
    qualifyingBrands: v.array(v.string()),
    commissionType: v.string(),
    commissionValue: v.number(),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.createdBy);
    const now = Date.now();
    return await ctx.db.insert("wtdCommissionCustomers", {
      ...args,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateCustomer = mutation({
  args: {
    id: v.id("wtdCommissionCustomers"),
    customerName: v.optional(v.string()),
    customerNumber: v.optional(v.string()),
    qualifyingDclasses: v.optional(v.array(v.string())),
    qualifyingBrands: v.optional(v.array(v.string())),
    commissionType: v.optional(v.string()),
    commissionValue: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const { id, requestingUserId: _ignored, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Customer config not found");
    await ctx.db.patch(id, { ...updates, updatedAt: Date.now() });
  },
});

export const deleteCustomer = mutation({
  args: {
    id: v.id("wtdCommissionCustomers"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    await ctx.db.delete(args.id);
  },
});

// ─── ACCESS OVERRIDE QUERIES ────────────────────────────────────────────────

export const getAccessOverrides = query({
  handler: async (ctx) => {
    const records = await ctx.db.query("wtdCommissionAccess").collect();
    return records[0] ?? null;
  },
});

export const getAccessOverridesWithNames = query({
  handler: async (ctx) => {
    const records = await ctx.db.query("wtdCommissionAccess").collect();
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

// ─── ACCESS OVERRIDE MUTATIONS ──────────────────────────────────────────────

export const setAccessOverrides = mutation({
  args: {
    userIds: v.array(v.id("users")),
    updatedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.updatedBy);
    const existing = await ctx.db.query("wtdCommissionAccess").collect();
    const now = Date.now();

    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, {
        userIds: args.userIds,
        updatedBy: args.updatedBy,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("wtdCommissionAccess", {
        userIds: args.userIds,
        updatedBy: args.updatedBy,
        updatedAt: now,
      });
    }
  },
});

// ─── CHECK ACCESS ───────────────────────────────────────────────────────────

export const checkAccess = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const records = await ctx.db.query("wtdCommissionAccess").collect();
    if (!records[0]) return false;
    return records[0].userIds.includes(args.userId);
  },
});

// ─── REPORT HISTORY ─────────────────────────────────────────────────────────

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

export const saveReport = mutation({
  args: {
    customerName: v.string(),
    customerNumber: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    commissionType: v.string(),
    commissionValue: v.number(),
    lineItems: v.array(
      v.object({
        orderNo: v.string(),
        brand: v.string(),
        mfgItemId: v.string(),
        description: v.string(),
        qty: v.number(),
        unitCost: v.number(),
        commissionAmount: v.number(),
      })
    ),
    grandTotal: v.number(),
    generatedBy: v.optional(v.id("users")),
    generatedByName: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Idempotency: one report per (customer, period). Replace any prior report
    // for the same customerNumber + date range so a retried or concurrent daily
    // run cannot create duplicate commission records. (Convex mutations are
    // serializable, so a true race resolves to a single surviving row.)
    const existing = await ctx.db.query("wtdCommissionReports").collect();
    for (const r of existing) {
      if (
        r.customerNumber === args.customerNumber &&
        r.startDate === args.startDate &&
        r.endDate === args.endDate
      ) {
        await ctx.db.delete(r._id);
      }
    }
    return await ctx.db.insert("wtdCommissionReports", {
      ...args,
      lineItemCount: args.lineItems.length,
      createdAt: now,
      expiresAt: now + TWELVE_MONTHS_MS,
    });
  },
});

export const listReports = query({
  handler: async (ctx) => {
    const reports = await ctx.db
      .query("wtdCommissionReports")
      .withIndex("by_created")
      .order("desc")
      .collect();
    // Return without lineItems for the list view (smaller payload)
    return reports.map((r) => ({
      _id: r._id,
      customerName: r.customerName,
      customerNumber: r.customerNumber,
      startDate: r.startDate,
      endDate: r.endDate,
      commissionType: r.commissionType,
      commissionValue: r.commissionValue,
      grandTotal: r.grandTotal,
      lineItemCount: r.lineItemCount,
      generatedByName: r.generatedByName,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    }));
  },
});

export const getReport = query({
  args: { id: v.id("wtdCommissionReports") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const updateReportLineItems = mutation({
  args: {
    reportId: v.id("wtdCommissionReports"),
    lineItems: v.array(
      v.object({
        orderNo: v.string(),
        brand: v.string(),
        mfgItemId: v.string(),
        description: v.string(),
        qty: v.number(),
        unitCost: v.number(),
        commissionAmount: v.number(),
      })
    ),
    grandTotal: v.number(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    await ctx.db.patch(args.reportId, {
      lineItems: args.lineItems,
      grandTotal: args.grandTotal,
    });
  },
});

export const deleteReport = mutation({
  args: {
    id: v.id("wtdCommissionReports"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    await ctx.db.delete(args.id);
  },
});

export const cleanupExpiredReports = mutation({
  args: { requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const now = Date.now();
    const expired = await ctx.db
      .query("wtdCommissionReports")
      .withIndex("by_expires")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();
    for (const report of expired) {
      await ctx.db.delete(report._id);
    }
    return { deleted: expired.length };
  },
});
