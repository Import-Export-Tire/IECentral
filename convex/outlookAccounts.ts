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

// ============ PHASE 2: PULL (Outlook -> IECentral) internal DB helpers ============
// These live in this (non-node) module because Convex query/mutation handlers
// cannot run in a "use node" file. The `convex/outlookSync.ts` action calls them
// via `internal.outlookAccounts.*`.

const STALE_SYNC_MS = 10 * 60 * 1000; // a "syncing" lock older than this is stale

// Active accounts for the cron. Returns userIds only (no tokens).
export const listActiveAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("outlookAccounts")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
    return rows.map((r) => ({
      userId: r.userId,
      syncStatus: r.syncStatus,
      syncStartedAt: r.syncStartedAt,
    }));
  },
});

// Overlap guard: atomically claim the sync lock for an account. Returns true if
// the caller acquired the lock (safe to proceed), false if a sync is already in
// flight (and not stale). Mirrors the email-sync "syncing" status approach.
export const tryClaimSync = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("outlookAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();
    if (!account) return false;
    const now = Date.now();
    if (
      account.syncStatus === "syncing" &&
      account.syncStartedAt &&
      now - account.syncStartedAt < STALE_SYNC_MS
    ) {
      return false; // already syncing, not stale
    }
    await ctx.db.patch(account._id, { syncStatus: "syncing", syncStartedAt: now });
    return true;
  },
});

// Release the sync lock.
export const releaseSync = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("outlookAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (account) {
      await ctx.db.patch(account._id, { syncStatus: "idle" });
    }
  },
});

// Update sync status/error. When reconnect is required, also deactivate the
// account so the pull stays dormant until the user reconnects.
export const setSyncStatus = internalMutation({
  args: {
    userId: v.id("users"),
    lastSyncAt: v.optional(v.number()),
    syncError: v.optional(v.string()),
    deactivate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("outlookAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (!account) return;
    const patch: Record<string, unknown> = {
      syncError: args.syncError,
      updatedAt: Date.now(),
    };
    if (args.lastSyncAt !== undefined) patch.lastSyncAt = args.lastSyncAt;
    if (args.deactivate) patch.isActive = false;
    await ctx.db.patch(account._id, patch);
  },
});

// Upsert a single Outlook-sourced event. NEVER touches IECentral-origin events:
// dedup is by (createdBy = userId) + outlookEventId via the by_outlook_event
// index, and we only ever patch/insert rows with syncSource === "outlook".
export const upsertPulledEvent = internalMutation({
  args: {
    userId: v.id("users"),
    outlookEventId: v.string(),
    outlookICalUId: v.optional(v.string()),
    outlookWeblink: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
    isAllDay: v.boolean(),
    location: v.optional(v.string()),
    meetingLink: v.optional(v.string()),
    isCancelled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Find any existing event with this Graph event id, scoped to this user.
    const candidates = await ctx.db
      .query("events")
      .withIndex("by_outlook_event", (q) => q.eq("outlookEventId", args.outlookEventId))
      .collect();
    const existing = candidates.find(
      (e) => e.createdBy === args.userId && e.syncSource === "outlook"
    );

    if (existing) {
      // Guard: only ever patch outlook-sourced rows.
      if (existing.syncSource !== "outlook") return;
      await ctx.db.patch(existing._id, {
        title: args.title,
        description: args.description,
        startTime: args.startTime,
        endTime: args.endTime,
        isAllDay: args.isAllDay,
        location: args.location,
        meetingLink: args.meetingLink,
        meetingType: args.meetingLink ? "other" : undefined,
        outlookICalUId: args.outlookICalUId,
        outlookWeblink: args.outlookWeblink,
        isCancelled: args.isCancelled ? true : existing.isCancelled,
        cancelledAt: args.isCancelled && !existing.isCancelled ? now : existing.cancelledAt,
        updatedAt: now,
      });
      return;
    }

    // Skip inserting brand-new events that already arrive cancelled.
    if (args.isCancelled) return;

    const user = await ctx.db.get(args.userId);
    await ctx.db.insert("events", {
      title: args.title,
      description: args.description,
      startTime: args.startTime,
      endTime: args.endTime,
      isAllDay: args.isAllDay,
      location: args.location,
      meetingLink: args.meetingLink,
      meetingType: args.meetingLink ? "other" : undefined,
      isReminder: false,
      isPrivate: false,
      createdBy: args.userId,
      createdByName: user?.name ?? "Outlook",
      outlookEventId: args.outlookEventId,
      outlookICalUId: args.outlookICalUId,
      outlookWeblink: args.outlookWeblink,
      syncSource: "outlook",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Return the set of outlookEventIds we currently hold (outlook-sourced, not
// cancelled) for this user that overlap the [start,end] window — used to detect
// events deleted in Outlook.
export const listPulledIdsInWindow = internalQuery({
  args: { userId: v.id("users"), start: v.number(), end: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("events")
      .withIndex("by_created_by", (q) => q.eq("createdBy", args.userId))
      .collect();
    return rows
      .filter(
        (e) =>
          e.syncSource === "outlook" &&
          !!e.outlookEventId &&
          !e.isCancelled &&
          // overlaps the window
          e.startTime <= args.end &&
          e.endTime >= args.start
      )
      .map((e) => e.outlookEventId as string);
  },
});

// Soft-cancel an outlook-sourced event that was deleted in Outlook.
export const markPulledCancelled = internalMutation({
  args: { userId: v.id("users"), outlookEventId: v.string() },
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("events")
      .withIndex("by_outlook_event", (q) => q.eq("outlookEventId", args.outlookEventId))
      .collect();
    const target = candidates.find(
      (e) => e.createdBy === args.userId && e.syncSource === "outlook" && !e.isCancelled
    );
    if (!target) return;
    await ctx.db.patch(target._id, {
      isCancelled: true,
      cancelledAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
