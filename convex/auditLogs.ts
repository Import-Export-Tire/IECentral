import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, mutation } from "./_generated/server";

// Get audit logs with cursor-based pagination and filtering.
// Filters (actionType, resourceType, userId) are applied via .filter() on the
// time-ordered index range. This may read extra rows to fill a page when filters
// are selective, but audit log browsing is admin-facing and low-frequency — the
// simplicity of keeping consistent time-desc order outweighs the extra reads.
export const getAll = query({
  args: {
    paginationOpts: paginationOptsValidator,
    actionType: v.optional(v.string()),
    resourceType: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Build a time-bounded index range (desc) then apply field filters.
    let q = ctx.db
      .query("auditLogs")
      .withIndex("by_timestamp", (idx) => {
        if (args.startDate && args.endDate) {
          return idx
            .gte("timestamp", new Date(args.startDate).getTime())
            .lte("timestamp", new Date(args.endDate).getTime() + 86400000);
        } else if (args.startDate) {
          return idx.gte("timestamp", new Date(args.startDate).getTime());
        } else if (args.endDate) {
          return idx.lte("timestamp", new Date(args.endDate).getTime() + 86400000);
        }
        return idx;
      })
      .order("desc");

    // Chain .filter() for field-level predicates after the index range.
    if (args.actionType && args.actionType !== "all") {
      q = q.filter((f) => f.eq(f.field("actionType"), args.actionType));
    }
    if (args.resourceType && args.resourceType !== "all") {
      q = q.filter((f) => f.eq(f.field("resourceType"), args.resourceType));
    }
    if (args.userId) {
      q = q.filter((f) => f.eq(f.field("userId"), args.userId));
    }

    return await q.paginate(args.paginationOpts);
  },
});

// Get distinct action types for filtering
// TODO(pagination follow-up): distinct-value scan — replace full collect() with a proper distinct index approach
export const getActionTypes = query({
  args: {},
  handler: async (ctx) => {
    const logs = await ctx.db.query("auditLogs").collect();
    const types = [...new Set(logs.map((log) => log.actionType))];
    return types.sort();
  },
});

// Get distinct resource types for filtering
// TODO(pagination follow-up): distinct-value scan — replace full collect() with a proper distinct index approach
export const getResourceTypes = query({
  args: {},
  handler: async (ctx) => {
    const logs = await ctx.db.query("auditLogs").collect();
    const types = [...new Set(logs.map((log) => log.resourceType))];
    return types.sort();
  },
});

// Get audit logs for a specific resource
export const getByResource = query({
  args: {
    resourceType: v.string(),
    resourceId: v.string(),
  },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_timestamp")
      .order("desc")
      .collect();

    return logs.filter(
      (log) =>
        log.resourceType === args.resourceType &&
        log.resourceId === args.resourceId
    );
  },
});

// Log an action
export const log = mutation({
  args: {
    action: v.string(),
    actionType: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    userId: v.id("users"),
    userEmail: v.string(),
    details: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("auditLogs", {
      action: args.action,
      actionType: args.actionType,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      userId: args.userId,
      userEmail: args.userEmail,
      details: args.details,
      timestamp: Date.now(),
    });
  },
});

// Get users who have audit entries
// TODO(pagination follow-up): distinct-value scan — replace full collect() with a proper distinct index approach
export const getUsers = query({
  args: {},
  handler: async (ctx) => {
    const logs = await ctx.db.query("auditLogs").collect();
    const userIds = [...new Set(logs.map((log) => log.userId))];

    const users = await Promise.all(
      userIds.map(async (id) => {
        const user = await ctx.db.get(id);
        return user ? { id: user._id, name: user.name, email: user.email } : null;
      })
    );

    return users.filter(Boolean);
  },
});
