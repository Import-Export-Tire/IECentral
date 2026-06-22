import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";

export const getByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("zoomAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();
    if (!account) return null;
    // Don't return encrypted tokens to client
    return {
      _id: account._id,
      userId: account.userId,
      zoomEmail: account.zoomEmail,
      displayName: account.displayName,
      isActive: account.isActive,
      lastSyncAt: account.lastSyncAt,
      syncError: account.syncError,
      createdAt: account.createdAt,
    };
  },
});

export const createOrUpdate = mutation({
  args: {
    userId: v.id("users"),
    zoomUserId: v.string(),
    zoomEmail: v.string(),
    displayName: v.optional(v.string()),
    accessToken: v.string(),
    refreshToken: v.string(),
    tokenExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check for existing account
    const existing = await ctx.db
      .query("zoomAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        zoomUserId: args.zoomUserId,
        zoomEmail: args.zoomEmail,
        displayName: args.displayName,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        tokenExpiresAt: args.tokenExpiresAt,
        isActive: true,
        syncError: undefined,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("zoomAccounts", {
      ...args,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const disconnect = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("zoomAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (account) {
      await ctx.db.patch(account._id, {
        isActive: false,
        updatedAt: Date.now(),
      });
    }
  },
});

// Internal: update tokens after refresh
export const updateTokens = internalMutation({
  args: {
    accountId: v.id("zoomAccounts"),
    accessToken: v.string(),
    refreshToken: v.string(),
    tokenExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.accountId, {
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      tokenExpiresAt: args.tokenExpiresAt,
      updatedAt: Date.now(),
    });
  },
});

// Internal: get account with encrypted OAuth tokens (for actions).
// SECURITY: internalQuery — a public query here leaks any user's Zoom tokens.
export const getWithCredentials = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("zoomAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();
  },
});
