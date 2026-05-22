import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./authGuards";

// Current IRS mileage rate (2026 rate - update annually)
const CURRENT_IRS_RATE = 0.725; // $0.725 per mile for 2026

// Default home location
const DEFAULT_FROM_LOCATION = "Latrobe, PA";

// ============ QUERIES ============

// Get mileage entries - filtered by user unless viewing all (admin only)
export const list = query({
  args: {
    year: v.optional(v.number()),
    month: v.optional(v.number()),
    status: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    showAll: v.optional(v.boolean()), // Admin only - show all users' entries
  },
  handler: async (ctx, args) => {
    let entries = await ctx.db
      .query("mileageEntries")
      .withIndex("by_date")
      .order("desc")
      .collect();

    // Filter by user if provided and not showing all
    if (args.userId && !args.showAll) {
      entries = entries.filter((e) => e.createdBy === args.userId);
    }

    // Filter by year if provided
    if (args.year) {
      entries = entries.filter((e) => {
        const entryYear = new Date(e.date).getFullYear();
        return entryYear === args.year;
      });
    }

    // Filter by month if provided
    if (args.month) {
      entries = entries.filter((e) => {
        const entryMonth = new Date(e.date).getMonth() + 1;
        return entryMonth === args.month;
      });
    }

    // Filter by status if provided
    if (args.status) {
      entries = entries.filter((e) => e.status === args.status);
    }

    return entries;
  },
});

// Get mileage summary for a period
export const getSummary = query({
  args: {
    year: v.optional(v.number()),
    month: v.optional(v.number()),
    userId: v.optional(v.id("users")),
    showAll: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let entries = await ctx.db.query("mileageEntries").collect();

    // Filter by user if provided and not showing all
    if (args.userId && !args.showAll) {
      entries = entries.filter((e) => e.createdBy === args.userId);
    }

    // Filter by year if provided
    if (args.year) {
      entries = entries.filter((e) => {
        const entryYear = new Date(e.date).getFullYear();
        return entryYear === args.year;
      });
    }

    // Filter by month if provided
    if (args.month) {
      entries = entries.filter((e) => {
        const entryMonth = new Date(e.date).getMonth() + 1;
        return entryMonth === args.month;
      });
    }

    const totalMiles = entries.reduce((sum, e) => {
      const miles = e.isRoundTrip ? e.miles * 2 : e.miles;
      return sum + miles;
    }, 0);

    const totalReimbursement = entries.reduce(
      (sum, e) => sum + e.reimbursementAmount,
      0
    );

    const byStatus = {
      pending: entries.filter((e) => e.status === "pending").length,
      submitted: entries.filter((e) => e.status === "submitted").length,
      approved: entries.filter((e) => e.status === "approved").length,
      paid: entries.filter((e) => e.status === "paid").length,
    };

    return {
      totalEntries: entries.length,
      totalMiles,
      totalReimbursement,
      byStatus,
      currentIrsRate: CURRENT_IRS_RATE,
    };
  },
});

// Get current IRS rate
export const getCurrentRate = query({
  args: {},
  handler: async () => {
    return CURRENT_IRS_RATE;
  },
});

// Get single entry by ID
export const getById = query({
  args: { entryId: v.id("mileageEntries") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.entryId);
  },
});

// ============ MUTATIONS ============

// Create a new mileage entry
export const create = mutation({
  args: {
    date: v.string(),
    fromLocation: v.optional(v.string()),
    toLocation: v.string(),
    miles: v.number(),
    isRoundTrip: v.boolean(),
    purpose: v.string(),
    vehicle: v.optional(v.string()),
    notes: v.optional(v.string()),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const fromLoc = args.fromLocation || DEFAULT_FROM_LOCATION;
    const effectiveMiles = args.isRoundTrip ? args.miles * 2 : args.miles;
    const reimbursementAmount = effectiveMiles * CURRENT_IRS_RATE;

    const now = Date.now();

    const entryId = await ctx.db.insert("mileageEntries", {
      date: args.date,
      fromLocation: fromLoc,
      toLocation: args.toLocation,
      miles: args.miles,
      isRoundTrip: args.isRoundTrip,
      purpose: args.purpose,
      vehicle: args.vehicle,
      irsRate: CURRENT_IRS_RATE,
      reimbursementAmount: Math.round(reimbursementAmount * 100) / 100, // Round to cents
      status: "pending",
      notes: args.notes,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now,
    });

    return entryId;
  },
});

// Update a mileage entry
export const update = mutation({
  args: {
    entryId: v.id("mileageEntries"),
    date: v.optional(v.string()),
    fromLocation: v.optional(v.string()),
    toLocation: v.optional(v.string()),
    miles: v.optional(v.number()),
    isRoundTrip: v.optional(v.boolean()),
    purpose: v.optional(v.string()),
    vehicle: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { entryId, ...updates } = args;
    const entry = await ctx.db.get(entryId);
    if (!entry) throw new Error("Entry not found");

    // Recalculate reimbursement if miles or roundTrip changed
    const newMiles = updates.miles ?? entry.miles;
    const newRoundTrip = updates.isRoundTrip ?? entry.isRoundTrip;
    const effectiveMiles = newRoundTrip ? newMiles * 2 : newMiles;
    const reimbursementAmount = effectiveMiles * entry.irsRate;

    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    await ctx.db.patch(entryId, {
      ...filteredUpdates,
      reimbursementAmount: Math.round(reimbursementAmount * 100) / 100,
      updatedAt: Date.now(),
    });

    return entryId;
  },
});

// Update status (submit, approve, mark paid)
export const updateStatus = mutation({
  args: {
    entryId: v.id("mileageEntries"),
    status: v.string(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("Entry not found");

    const now = Date.now();
    const statusUpdates: Record<string, number | undefined> = {};

    if (args.status === "submitted" && entry.status === "pending") {
      statusUpdates.submittedAt = now;
    } else if (args.status === "approved" && entry.status === "submitted") {
      statusUpdates.approvedAt = now;
    } else if (args.status === "paid" && entry.status === "approved") {
      statusUpdates.paidAt = now;
    }

    await ctx.db.patch(args.entryId, {
      status: args.status,
      ...statusUpdates,
      updatedAt: now,
    });

    return args.entryId;
  },
});

// Bulk update status
export const bulkUpdateStatus = mutation({
  args: {
    entryIds: v.array(v.id("mileageEntries")),
    status: v.string(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const now = Date.now();

    for (const entryId of args.entryIds) {
      const entry = await ctx.db.get(entryId);
      if (!entry) continue;

      const statusUpdates: Record<string, number | undefined> = {};

      if (args.status === "submitted") {
        statusUpdates.submittedAt = now;
      } else if (args.status === "approved") {
        statusUpdates.approvedAt = now;
      } else if (args.status === "paid") {
        statusUpdates.paidAt = now;
      }

      await ctx.db.patch(entryId, {
        status: args.status,
        ...statusUpdates,
        updatedAt: now,
      });
    }

    return args.entryIds.length;
  },
});

// Delete a mileage entry
export const remove = mutation({
  args: {
    entryId: v.id("mileageEntries"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    await ctx.db.delete(args.entryId);
    return args.entryId;
  },
});
