import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const add = mutation({
  args: {
    locationCode: v.string(),
    itemId: v.string(),
    manufacturerName: v.optional(v.string()),
    description: v.optional(v.string()),
    qtyChange: v.number(),
    notes: v.optional(v.string()),
    enteredBy: v.optional(v.id("users")),
    enteredByName: v.string(),
  },
  handler: async (ctx, args) => {
    const code = args.locationCode.trim().toUpperCase();
    const itemId = args.itemId.trim();
    if (!code) throw new Error("Location is required");
    if (!itemId) throw new Error("Item ID is required");
    if (!Number.isFinite(args.qtyChange) || args.qtyChange === 0) {
      throw new Error("Qty change must be non-zero");
    }
    return await ctx.db.insert("inventoryAdjustments", {
      ...args,
      locationCode: code,
      itemId,
      notes: args.notes?.trim() || undefined,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("inventoryAdjustments") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// Display query for the adjustments log. Bounded primarily by date
// (`since`) so the caller can pull a full date range rather than an
// arbitrary tail; `limit` remains as a safety cap against Convex's
// per-query row/bandwidth limits on very large histories.
export const listByLocation = query({
  args: {
    locationCode: v.string(),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const code = args.locationCode.trim().toUpperCase();
    const q = ctx.db
      .query("inventoryAdjustments")
      .withIndex("by_location_created", (q) =>
        // createdAt is always a positive epoch ms, so `0` is an
        // effective "no lower bound" while keeping one code path.
        q.eq("locationCode", code).gte("createdAt", args.since ?? 0)
      )
      .order("desc");
    if (args.limit !== undefined) {
      return await q.take(args.limit);
    }
    return await q.collect();
  },
});

// Stats query — bounded by date instead of count so MoM/repeat/
// consecutive-month aggregations stay accurate. Pass a recent
// timestamp (e.g. ~6 months ago) for safe bandwidth.
export const listByLocationSince = query({
  args: {
    locationCode: v.string(),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    const code = args.locationCode.trim().toUpperCase();
    return await ctx.db
      .query("inventoryAdjustments")
      .withIndex("by_location_created", (q) =>
        q.eq("locationCode", code).gte("createdAt", args.since)
      )
      .order("desc")
      .collect();
  },
});

// Maintenance query — lists adjustments missing a brand across ALL
// locations so they can be backfilled. Returns minimal identifying
// fields only.
export const listMissingBrand = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("inventoryAdjustments").collect();
    return all
      .filter((a) => !(a.manufacturerName ?? "").trim())
      .map((a) => ({ id: a._id, locationCode: a.locationCode, itemId: a.itemId }));
  },
});

// Backfill mutation — patches brand + optional description on the given
// records. Idempotent: skips any record that already has a brand so it
// won't clobber existing values.
export const backfillBrands = mutation({
  args: {
    entries: v.array(
      v.object({
        id: v.id("inventoryAdjustments"),
        manufacturerName: v.string(),
        description: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    let patched = 0;
    for (const e of args.entries) {
      const row = await ctx.db.get(e.id);
      if (!row) continue;
      if ((row.manufacturerName ?? "").trim()) continue; // don't clobber existing
      await ctx.db.patch(e.id, {
        manufacturerName: e.manufacturerName,
        ...(e.description !== undefined ? { description: e.description } : {}),
      });
      patched++;
    }
    return { patched };
  },
});
