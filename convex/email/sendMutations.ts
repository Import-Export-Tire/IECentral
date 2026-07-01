/**
 * Email Send Mutations
 *
 * Non-Node.js mutations for email send queue operations.
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// Email address validator
const emailAddressValidator = v.object({
  name: v.optional(v.string()),
  address: v.string(),
});

/**
 * Insert a new queue entry.
 */
export const insertQueueEntry = internalMutation({
  args: {
    accountId: v.id("emailAccounts"),
    to: v.array(emailAddressValidator),
    cc: v.optional(v.array(emailAddressValidator)),
    bcc: v.optional(v.array(emailAddressValidator)),
    subject: v.string(),
    bodyHtml: v.string(),
    bodyText: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get userId from the account
    const account = await ctx.db.get(args.accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    return await ctx.db.insert("emailSendQueue", {
      accountId: args.accountId,
      userId: account.userId,
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      bodyHtml: args.bodyHtml,
      bodyText: args.bodyText,
      status: "pending",
      attempts: 0,
      scheduledFor: args.scheduledFor || now,
      createdAt: now,
    });
  },
});

/**
 * Update queue entry status.
 */
export const updateQueueStatus = internalMutation({
  args: {
    queueId: v.id("emailSendQueue"),
    status: v.union(
      v.literal("pending"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed")
    ),
    error: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.queueId);
    if (!entry) return;

    const now = Date.now();
    await ctx.db.patch(args.queueId, {
      status: args.status,
      error: args.error,
      messageId: args.messageId,
      attempts: entry.attempts + (args.status === "sending" ? 1 : 0),
      lastAttemptAt: now,
      sentAt: args.status === "sent" ? now : undefined,
    });
  },
});

/**
 * Delete a queue entry.
 */
export const deleteQueueEntry = internalMutation({
  args: {
    queueId: v.id("emailSendQueue"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.queueId);
  },
});

/**
 * Get pending scheduled emails that are due.
 */
export const getDueScheduledEmails = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Get pending emails that are scheduled for now or earlier
    const dueEmails = await ctx.db
      .query("emailSendQueue")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .filter((q) => q.lte(q.field("scheduledFor"), now))
      .take(50);

    // Atomically CLAIM these rows (status -> "sending") within this single
    // serializable mutation before returning them. Without this, an overlapping
    // cron run (slow SMTP) could read the same still-"pending" rows and send each
    // email twice. Claiming here means a second run sees them as "sending" and skips.
    await Promise.all(
      dueEmails.map((e) =>
        ctx.db.patch(e._id, {
          status: "sending",
          attempts: e.attempts + 1,
          lastAttemptAt: now,
        })
      )
    );

    return dueEmails;
  },
});

/**
 * Get failed emails that should be retried.
 */
export const getFailedEmailsForRetry = internalMutation({
  args: {
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxAttempts = args.maxAttempts || 3;
    const now = Date.now();

    // Get failed emails with attempts < max
    const failedEmails = await ctx.db
      .query("emailSendQueue")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .filter((q) => q.lt(q.field("attempts"), maxAttempts))
      .take(50);

    // Only retry if enough time has passed (exponential backoff)
    const eligibleForRetry = failedEmails.filter((email) => {
      if (!email.lastAttemptAt) return true;
      const waitTime = Math.pow(2, email.attempts) * 60 * 1000; // 2^attempts minutes
      return now - email.lastAttemptAt >= waitTime;
    });

    // Atomically CLAIM the eligible rows (status -> "sending") before returning,
    // so an overlapping retry cron can't grab and resend the same ones. (Same
    // double-send guard as getDueScheduledEmails; backoff is computed above on the
    // pre-claim attempts value.)
    await Promise.all(
      eligibleForRetry.map((e) =>
        ctx.db.patch(e._id, {
          status: "sending",
          attempts: e.attempts + 1,
          lastAttemptAt: now,
        })
      )
    );

    return eligibleForRetry;
  },
});

/**
 * Move to retry queue with detailed error info.
 */
export const moveToRetryQueue = internalMutation({
  args: {
    queueId: v.id("emailSendQueue"),
    error: v.string(),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.queueId);
    if (!entry) return;

    const now = Date.now();

    // Calculate next retry time with exponential backoff
    const nextRetryIn = Math.pow(2, entry.attempts + 1) * 60 * 1000;
    const nextRetryAt = now + nextRetryIn;

    await ctx.db.patch(args.queueId, {
      status: "failed",
      error: args.error,
      lastAttemptAt: now,
      attempts: entry.attempts + 1,
      nextRetryAt,
    });
  },
});

/**
 * Reset a failed email for immediate retry.
 */
export const resetForRetry = internalMutation({
  args: {
    queueId: v.id("emailSendQueue"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.queueId, {
      status: "pending",
      error: undefined,
      nextRetryAt: undefined,
    });
  },
});

/**
 * Cancel a scheduled email.
 */
export const cancelScheduledEmail = internalMutation({
  args: {
    queueId: v.id("emailSendQueue"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.queueId);
    if (!entry) {
      throw new Error("Queue entry not found");
    }

    if (entry.userId !== args.userId) {
      throw new Error("Permission denied");
    }

    if (entry.status !== "pending") {
      throw new Error("Cannot cancel email that is not pending");
    }

    await ctx.db.delete(args.queueId);
  },
});

/**
 * Get scheduled emails for a user.
 */
export const getScheduledEmails = internalMutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const scheduled = await ctx.db
      .query("emailSendQueue")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "pending"),
          q.gt(q.field("scheduledFor"), now)
        )
      )
      .collect();

    return scheduled.sort((a, b) => (a.scheduledFor || 0) - (b.scheduledFor || 0));
  },
});

/**
 * Update scheduled time for an email.
 */
export const updateScheduledTime = internalMutation({
  args: {
    queueId: v.id("emailSendQueue"),
    userId: v.id("users"),
    newScheduledFor: v.number(),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.queueId);
    if (!entry) {
      throw new Error("Queue entry not found");
    }

    if (entry.userId !== args.userId) {
      throw new Error("Permission denied");
    }

    if (entry.status !== "pending") {
      throw new Error("Cannot reschedule email that is not pending");
    }

    await ctx.db.patch(args.queueId, {
      scheduledFor: args.newScheduledFor,
    });
  },
});

/**
 * Clean up old sent/failed queue entries.
 */
export const cleanupOldQueueEntries = internalMutation({
  args: {
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const retentionDays = args.retentionDays || 7;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    // Delete old sent entries
    const oldSent = await ctx.db
      .query("emailSendQueue")
      .withIndex("by_status", (q) => q.eq("status", "sent"))
      .filter((q) => q.lt(q.field("sentAt"), cutoff))
      .take(100);

    // Delete old failed entries (beyond max retries)
    const oldFailed = await ctx.db
      .query("emailSendQueue")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .filter((q) =>
        q.and(
          q.gte(q.field("attempts"), 3),
          q.lt(q.field("lastAttemptAt"), cutoff)
        )
      )
      .take(100);

    let deleted = 0;

    for (const entry of [...oldSent, ...oldFailed]) {
      await ctx.db.delete(entry._id);
      deleted++;
    }

    return { deleted };
  },
});
