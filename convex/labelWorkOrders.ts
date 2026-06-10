import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const LABEL = v.object({ itemId: v.string(), brand: v.string(), model: v.string(), sizeDesc: v.string(), qty: v.optional(v.number()) });

export const create = mutation({
  args: {
    title: v.string(),
    labels: v.array(LABEL),
    copies: v.number(),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
    createdByName: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("labelWorkOrders", {
      title: args.title.trim() || "Untitled",
      labelType: "tire",
      labels: args.labels,
      copies: Math.max(1, args.copies || 1),
      notes: args.notes,
      status: "open",
      createdBy: args.createdBy,
      createdByName: args.createdByName,
      createdAt: Date.now(),
    });
    return { id };
  },
});

export const list = query({
  args: { status: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    let rows;
    if (args.status) {
      rows = await ctx.db.query("labelWorkOrders")
        .withIndex("by_status_created", (q) => q.eq("status", args.status!))
        .order("desc").take(args.limit ?? 100);
    } else {
      rows = await ctx.db.query("labelWorkOrders")
        .withIndex("by_created").order("desc").take(args.limit ?? 100);
    }
    return rows;
  },
});

export const get = query({
  args: { id: v.id("labelWorkOrders") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

export const markPrinted = mutation({
  args: { id: v.id("labelWorkOrders"), printedByName: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "printed", printedAt: Date.now(), printedByName: args.printedByName });
    return { success: true };
  },
});

export const remove = mutation({
  args: { id: v.id("labelWorkOrders") },
  handler: async (ctx, args) => { await ctx.db.delete(args.id); return { success: true }; },
});
