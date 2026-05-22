import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./authGuards";

// ============ QUERIES ============

// List all expense reports (with optional filters)
export const list = query({
  args: {
    status: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let reports;

    if (args.status) {
      reports = await ctx.db
        .query("expenseReports")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else if (args.createdBy) {
      reports = await ctx.db
        .query("expenseReports")
        .withIndex("by_created_by", (q) => q.eq("createdBy", args.createdBy!))
        .collect();
    } else {
      reports = await ctx.db.query("expenseReports").collect();
    }

    // Filter by year if specified
    if (args.year) {
      const yearStr = args.year.toString();
      reports = reports.filter((r) => r.reportDate.startsWith(yearStr));
    }

    // Sort by date descending
    return reports.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Get my expense reports (for current user)
export const listMine = query({
  args: {
    userId: v.id("users"),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let reports = await ctx.db
      .query("expenseReports")
      .withIndex("by_created_by", (q) => q.eq("createdBy", args.userId))
      .collect();

    if (args.status) {
      reports = reports.filter((r) => r.status === args.status);
    }

    return reports.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Get a single expense report by ID
export const getById = query({
  args: { reportId: v.id("expenseReports") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.reportId);
  },
});

// Get expense reports pending approval (for admins)
export const getPendingApproval = query({
  handler: async (ctx) => {
    const reports = await ctx.db
      .query("expenseReports")
      .withIndex("by_status", (q) => q.eq("status", "submitted"))
      .collect();

    return reports.sort((a, b) => a.submittedAt! - b.submittedAt!);
  },
});

// Get summary stats
export const getSummary = query({
  args: {
    userId: v.optional(v.id("users")),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let reports;

    if (args.userId) {
      reports = await ctx.db
        .query("expenseReports")
        .withIndex("by_created_by", (q) => q.eq("createdBy", args.userId!))
        .collect();
    } else {
      reports = await ctx.db.query("expenseReports").collect();
    }

    // Filter by year
    if (args.year) {
      const yearStr = args.year.toString();
      reports = reports.filter((r) => r.reportDate.startsWith(yearStr));
    }

    const draft = reports.filter((r) => r.status === "draft");
    const submitted = reports.filter((r) => r.status === "submitted");
    const approved = reports.filter((r) => r.status === "approved");
    const paid = reports.filter((r) => r.status === "paid");
    const rejected = reports.filter((r) => r.status === "rejected");

    return {
      total: reports.length,
      draftCount: draft.length,
      draftAmount: draft.reduce((sum, r) => sum + r.totalAmount, 0),
      submittedCount: submitted.length,
      submittedAmount: submitted.reduce((sum, r) => sum + r.totalAmount, 0),
      approvedCount: approved.length,
      approvedAmount: approved.reduce((sum, r) => sum + r.totalAmount, 0),
      paidCount: paid.length,
      paidAmount: paid.reduce((sum, r) => sum + r.totalAmount, 0),
      rejectedCount: rejected.length,
    };
  },
});

// ============ MUTATIONS ============

// Create a new expense report (as draft or submitted)
export const create = mutation({
  args: {
    employeeName: v.string(),
    department: v.string(),
    reportDate: v.string(),
    periodStart: v.string(),
    periodEnd: v.string(),
    purpose: v.optional(v.string()),
    items: v.array(
      v.object({
        date: v.string(),
        description: v.string(),
        category: v.string(),
        amount: v.number(),
        hasReceipt: v.boolean(),
      })
    ),
    notes: v.optional(v.string()),
    userId: v.id("users"),
    personnelId: v.optional(v.id("personnel")),
    submitImmediately: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    const now = Date.now();
    const totalAmount = args.items.reduce((sum, item) => sum + item.amount, 0);

    const reportId = await ctx.db.insert("expenseReports", {
      employeeName: args.employeeName,
      department: args.department,
      reportDate: args.reportDate,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      purpose: args.purpose,
      items: args.items,
      totalAmount,
      status: args.submitImmediately ? "submitted" : "draft",
      submittedAt: args.submitImmediately ? now : undefined,
      notes: args.notes,
      createdBy: args.userId,
      createdByName: user.name,
      personnelId: args.personnelId,
      createdAt: now,
      updatedAt: now,
    });

    return reportId;
  },
});

// Update a draft expense report
export const update = mutation({
  args: {
    reportId: v.id("expenseReports"),
    employeeName: v.optional(v.string()),
    department: v.optional(v.string()),
    reportDate: v.optional(v.string()),
    periodStart: v.optional(v.string()),
    periodEnd: v.optional(v.string()),
    purpose: v.optional(v.string()),
    items: v.optional(
      v.array(
        v.object({
          date: v.string(),
          description: v.string(),
          category: v.string(),
          amount: v.number(),
          hasReceipt: v.boolean(),
        })
      )
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");
    if (report.status !== "draft") {
      throw new Error("Can only edit draft reports");
    }

    const { reportId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    // Recalculate total if items changed
    if (args.items) {
      (filteredUpdates as any).totalAmount = args.items.reduce(
        (sum, item) => sum + item.amount,
        0
      );
    }

    await ctx.db.patch(args.reportId, {
      ...filteredUpdates,
      updatedAt: Date.now(),
    });

    return args.reportId;
  },
});

// Submit a draft report for approval
export const submit = mutation({
  args: { reportId: v.id("expenseReports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");
    if (report.status !== "draft") {
      throw new Error("Can only submit draft reports");
    }

    await ctx.db.patch(args.reportId, {
      status: "submitted",
      submittedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return args.reportId;
  },
});

// Approve a submitted report
export const approve = mutation({
  args: {
    reportId: v.id("expenseReports"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.userId);
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");
    if (report.status !== "submitted") {
      throw new Error("Can only approve submitted reports");
    }

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    await ctx.db.patch(args.reportId, {
      status: "approved",
      approvedAt: Date.now(),
      approvedBy: args.userId,
      approvedByName: user.name,
      updatedAt: Date.now(),
    });

    return args.reportId;
  },
});

// Reject a submitted report
export const reject = mutation({
  args: {
    reportId: v.id("expenseReports"),
    userId: v.id("users"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.userId);
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");
    if (report.status !== "submitted") {
      throw new Error("Can only reject submitted reports");
    }

    await ctx.db.patch(args.reportId, {
      status: "rejected",
      rejectedAt: Date.now(),
      rejectedBy: args.userId,
      rejectionReason: args.reason,
      updatedAt: Date.now(),
    });

    return args.reportId;
  },
});

// Mark an approved report as paid
export const markPaid = mutation({
  args: {
    reportId: v.id("expenseReports"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.userId);
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");
    if (report.status !== "approved") {
      throw new Error("Can only mark approved reports as paid");
    }

    await ctx.db.patch(args.reportId, {
      status: "paid",
      paidAt: Date.now(),
      paidBy: args.userId,
      updatedAt: Date.now(),
    });

    return args.reportId;
  },
});

// Delete a draft report
export const remove = mutation({
  args: {
    reportId: v.id("expenseReports"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");
    if (report.status !== "draft") {
      throw new Error("Can only delete draft reports");
    }

    await ctx.db.delete(args.reportId);
    return true;
  },
});

// Revert a rejected report to draft (so user can edit and resubmit)
export const revertToDraft = mutation({
  args: { reportId: v.id("expenseReports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");
    if (report.status !== "rejected") {
      throw new Error("Can only revert rejected reports to draft");
    }

    await ctx.db.patch(args.reportId, {
      status: "draft",
      rejectedAt: undefined,
      rejectedBy: undefined,
      rejectionReason: undefined,
      submittedAt: undefined,
      updatedAt: Date.now(),
    });

    return args.reportId;
  },
});
