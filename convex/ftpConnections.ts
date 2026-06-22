import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  handler: async (ctx) => {
    const connections = await ctx.db.query("ftpConnections").collect();
    // Don't return encrypted passwords to client
    return connections.map((c) => ({
      ...c,
      password: "••••••••",
    }));
  },
});

export const get = query({
  args: { id: v.id("ftpConnections") },
  handler: async (ctx, args) => {
    const conn = await ctx.db.get(args.id);
    if (!conn) return null;
    return { ...conn, password: "••••••••" };
  },
});

// Get with stored (encrypted) password for server-side sync routes.
// SECURITY TODO: still a PUBLIC query — callable by the external Convex client
// from app/api/reports/ftp-{sync,list}. It returns the encrypted password +
// host/user (not plaintext; routes decrypt server-side), but should be locked
// behind a shared service secret and the ftp-list route should require auth.
export const getWithCredentials = query({
  args: { id: v.id("ftpConnections") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getActiveBySourceType = query({
  args: { sourceType: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ftpConnections")
      .withIndex("by_sourceType", (q) => q.eq("sourceType", args.sourceType))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    host: v.string(),
    port: v.number(),
    username: v.string(),
    password: v.string(), // Already encrypted by client
    remotePath: v.string(),
    filePattern: v.string(),
    sourceType: v.string(),
    warehouse: v.optional(v.string()),
    frequency: v.string(),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("ftpConnections", {
      ...args,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("ftpConnections"),
    name: v.optional(v.string()),
    host: v.optional(v.string()),
    port: v.optional(v.number()),
    username: v.optional(v.string()),
    password: v.optional(v.string()),
    remotePath: v.optional(v.string()),
    filePattern: v.optional(v.string()),
    frequency: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const filtered = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
    await ctx.db.patch(id, { ...filtered, updatedAt: Date.now() });
  },
});

export const updateSyncStatus = mutation({
  args: {
    id: v.id("ftpConnections"),
    lastSyncStatus: v.string(),
    lastSyncError: v.optional(v.string()),
    lastSyncFileName: v.optional(v.string()),
    lastSyncRowCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, {
      ...updates,
      lastSyncAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("ftpConnections") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
