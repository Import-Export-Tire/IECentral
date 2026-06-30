import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./authGuards";

// Get all active groups
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("groups")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .order("desc")
      .collect();
  },
});

// Get a single group by ID
export const getById = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.groupId);
  },
});

// Get all groups a user is a member of
export const getForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const allGroups = await ctx.db
      .query("groups")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
    return allGroups.filter((g) => g.memberIds.includes(args.userId));
  },
});

// Create a new group (admin+ only — group membership controls Doc Hub folder access)
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    memberIds: v.array(v.id("users")),
    createdBy: v.id("users"),
    createdByName: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.createdBy);
    const now = Date.now();
    return await ctx.db.insert("groups", {
      ...args,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update group name/description/color (admin+ only)
export const update = mutation({
  args: {
    groupId: v.id("groups"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const { groupId, requestingUserId: _r, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(groupId, {
      ...filteredUpdates,
      updatedAt: Date.now(),
    });
  },
});

// Add members to a group (admin+ only)
export const addMembers = mutation({
  args: {
    groupId: v.id("groups"),
    userIds: v.array(v.id("users")),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const group = await ctx.db.get(args.groupId);
    if (!group) throw new Error("Group not found");
    const merged = [...new Set([...group.memberIds, ...args.userIds])];
    await ctx.db.patch(args.groupId, {
      memberIds: merged,
      updatedAt: Date.now(),
    });
  },
});

// Remove a member from a group (admin+ only)
export const removeMember = mutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const group = await ctx.db.get(args.groupId);
    if (!group) throw new Error("Group not found");
    await ctx.db.patch(args.groupId, {
      memberIds: group.memberIds.filter((id) => id !== args.userId),
      updatedAt: Date.now(),
    });
  },
});

// Archive a group (admin+ only)
export const archive = mutation({
  args: { groupId: v.id("groups"), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    await ctx.db.patch(args.groupId, {
      isActive: false,
      updatedAt: Date.now(),
    });
  },
});
