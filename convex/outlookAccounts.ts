import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";

/**
 * Outlook / M365 calendar account module.
 *
 * Mirrors `convex/zoomAccounts.ts`. OAuth tokens are stored AES-256-GCM
 * encrypted (format `iv:authTag:ciphertext`, hex) using the shared
 * `EMAIL_ENCRYPTION_KEY`. Encryption happens in the OAuth callback route via
 * `lib/email/encryption.ts` (same as the Zoom callback + email OAuth accounts):
 * Convex's default mutation runtime cannot use Node crypto, so `createOrUpdate`
 * receives already-encrypted tokens and `getWithCredentials` returns them still
 * encrypted for a "use node" server action (Phase 2) to decrypt.
 *
 * SECURITY: `getByUser` is the only public read and returns NO tokens.
 */

// Public status query — returns a non-secret status object ONLY.
// NEVER returns access/refresh tokens to the client.
export const getByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("outlookAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();
    if (!account) return { connected: false };
    return {
      connected: true,
      outlookEmail: account.outlookEmail,
      lastSyncAt: account.lastSyncAt,
      syncError: account.syncError,
      syncDirection: account.syncDirection ?? "both",
    };
  },
});

// Upsert an Outlook account. Tokens arrive ALREADY encrypted (the callback
// route encrypts via lib/email/encryption before calling this).
export const createOrUpdate = mutation({
  args: {
    userId: v.id("users"),
    outlookEmail: v.string(),
    accessToken: v.string(),  // AES-256-GCM encrypted
    refreshToken: v.string(), // AES-256-GCM encrypted
    tokenExpiresAt: v.number(),
    scope: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const existing = await ctx.db
      .query("outlookAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        outlookEmail: args.outlookEmail,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        tokenExpiresAt: args.tokenExpiresAt,
        scope: args.scope,
        isActive: true,
        syncError: undefined,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("outlookAccounts", {
      userId: args.userId,
      outlookEmail: args.outlookEmail,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      tokenExpiresAt: args.tokenExpiresAt,
      scope: args.scope,
      syncDirection: "both",
      isActive: true,
      connectedAt: now,
      updatedAt: now,
    });
  },
});

export const disconnect = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("outlookAccounts")
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

// Internal: update encrypted tokens after refresh (Phase 2). Tokens arrive
// already encrypted from the refreshing "use node" action.
export const updateTokens = internalMutation({
  args: {
    accountId: v.id("outlookAccounts"),
    accessToken: v.string(),  // AES-256-GCM encrypted
    refreshToken: v.string(), // AES-256-GCM encrypted
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

// Internal: get account row with (still-encrypted) OAuth tokens — for server
// actions only. The consuming "use node" action decrypts.
// SECURITY: internalQuery — a public query here would leak any user's tokens.
export const getWithCredentials = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("outlookAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();
  },
});
