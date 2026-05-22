import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireManagePersonnel, requireSelfOrManager } from "./authGuards";

// Get all announcements (admin view)
export const getAll = query({
  args: {
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let announcements;

    if (args.includeInactive) {
      announcements = await ctx.db
        .query("announcements")
        .order("desc")
        .collect();
    } else {
      announcements = await ctx.db
        .query("announcements")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .order("desc")
        .collect();
    }

    // Filter out expired announcements (unless including inactive)
    const now = Date.now();
    if (!args.includeInactive) {
      announcements = announcements.filter(
        (a) => !a.expiresAt || a.expiresAt > now
      );
    }

    // Get read counts
    const enriched = await Promise.all(
      announcements.map(async (announcement) => {
        const reads = await ctx.db
          .query("announcementReads")
          .withIndex("by_announcement", (q) =>
            q.eq("announcementId", announcement._id)
          )
          .collect();

        return {
          ...announcement,
          readCount: reads.length,
        };
      })
    );

    return enriched;
  },
});

// Get active announcements for employees
export const getActive = query({
  args: {
    personnelId: v.optional(v.id("personnel")),
    department: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    let announcements = await ctx.db
      .query("announcements")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .order("desc")
      .collect();

    // Filter out expired
    announcements = announcements.filter(
      (a) => !a.expiresAt || a.expiresAt > now
    );

    // Filter by targeting
    announcements = announcements.filter((a) => {
      if (a.targetType === "all") return true;

      if (a.targetType === "department" && args.department) {
        return a.targetDepartments?.includes(args.department);
      }

      if (a.targetType === "location" && args.locationId) {
        return a.targetLocationIds?.includes(args.locationId);
      }

      return true;
    });

    // Sort: pinned first, then by priority (urgent first), then by date
    announcements.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      if (a.priority === "urgent" && b.priority !== "urgent") return -1;
      if (a.priority !== "urgent" && b.priority === "urgent") return 1;
      return b.createdAt - a.createdAt;
    });

    // Check read status if personnelId provided
    if (args.personnelId) {
      const enriched = await Promise.all(
        announcements.map(async (announcement) => {
          const read = await ctx.db
            .query("announcementReads")
            .withIndex("by_both", (q) =>
              q
                .eq("announcementId", announcement._id)
                .eq("personnelId", args.personnelId!)
            )
            .first();

          return {
            ...announcement,
            isRead: !!read,
            readAt: read?.readAt,
          };
        })
      );

      return enriched;
    }

    return announcements;
  },
});

// Get unread count for an employee
export const getUnreadCount = query({
  args: {
    personnelId: v.id("personnel"),
    department: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    let announcements = await ctx.db
      .query("announcements")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    // Filter out expired
    announcements = announcements.filter(
      (a) => !a.expiresAt || a.expiresAt > now
    );

    // Filter by targeting
    announcements = announcements.filter((a) => {
      if (a.targetType === "all") return true;

      if (a.targetType === "department" && args.department) {
        return a.targetDepartments?.includes(args.department);
      }

      if (a.targetType === "location" && args.locationId) {
        return a.targetLocationIds?.includes(args.locationId);
      }

      return true;
    });

    // Get read announcements
    const reads = await ctx.db
      .query("announcementReads")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .collect();

    const readIds = new Set(reads.map((r) => r.announcementId));

    const unreadCount = announcements.filter(
      (a) => !readIds.has(a._id)
    ).length;

    return unreadCount;
  },
});

// Create an announcement (admin action)
export const create = mutation({
  args: {
    title: v.string(),
    content: v.string(),
    priority: v.string(),
    targetType: v.string(),
    targetDepartments: v.optional(v.array(v.string())),
    targetLocationIds: v.optional(v.array(v.id("locations"))),
    expiresAt: v.optional(v.number()),
    isPinned: v.optional(v.boolean()),
    sendPush: v.optional(v.boolean()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.createdBy);
    const user = await ctx.db.get(args.createdBy);
    const now = Date.now();

    const announcementId = await ctx.db.insert("announcements", {
      title: args.title,
      content: args.content,
      priority: args.priority,
      targetType: args.targetType,
      targetDepartments: args.targetDepartments,
      targetLocationIds: args.targetLocationIds,
      createdBy: args.createdBy,
      createdByName: user?.name || "Unknown",
      expiresAt: args.expiresAt,
      isPinned: args.isPinned || false,
      isActive: true,
      pushSent: false,
      createdAt: now,
      updatedAt: now,
    });

    // If sendPush is true, schedule push notifications to targeted employees
    if (args.sendPush) {
      await ctx.scheduler.runAfter(0, internal.announcements.sendAnnouncementPush, {
        announcementId,
        title: args.title,
        priority: args.priority,
        targetType: args.targetType,
        targetDepartments: args.targetDepartments,
        targetLocationIds: args.targetLocationIds,
      });
    }

    return announcementId;
  },
});

// Update an announcement
export const update = mutation({
  args: {
    announcementId: v.id("announcements"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    priority: v.optional(v.string()),
    targetType: v.optional(v.string()),
    targetDepartments: v.optional(v.array(v.string())),
    targetLocationIds: v.optional(v.array(v.id("locations"))),
    expiresAt: v.optional(v.number()),
    isPinned: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const { announcementId, requestingUserId: _ignored, ...updates } = args;

    await ctx.db.patch(announcementId, {
      ...updates,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Delete an announcement
export const remove = mutation({
  args: {
    announcementId: v.id("announcements"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    // Delete all read receipts first
    const reads = await ctx.db
      .query("announcementReads")
      .withIndex("by_announcement", (q) =>
        q.eq("announcementId", args.announcementId)
      )
      .collect();

    for (const read of reads) {
      await ctx.db.delete(read._id);
    }

    // Delete the announcement
    await ctx.db.delete(args.announcementId);

    return { success: true };
  },
});

// Mark an announcement as read (employee action)
export const markAsRead = mutation({
  args: {
    announcementId: v.id("announcements"),
    personnelId: v.id("personnel"),
  },
  handler: async (ctx, args) => {
    // Check if already read
    const existing = await ctx.db
      .query("announcementReads")
      .withIndex("by_both", (q) =>
        q
          .eq("announcementId", args.announcementId)
          .eq("personnelId", args.personnelId)
      )
      .first();

    if (existing) {
      return { success: true, alreadyRead: true };
    }

    await ctx.db.insert("announcementReads", {
      announcementId: args.announcementId,
      personnelId: args.personnelId,
      readAt: Date.now(),
    });

    return { success: true, alreadyRead: false };
  },
});

// Mark all announcements as read for an employee
export const markAllAsRead = mutation({
  args: {
    personnelId: v.id("personnel"),
    department: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    let announcements = await ctx.db
      .query("announcements")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    // Filter out expired
    announcements = announcements.filter(
      (a) => !a.expiresAt || a.expiresAt > now
    );

    // Filter by targeting
    announcements = announcements.filter((a) => {
      if (a.targetType === "all") return true;

      if (a.targetType === "department" && args.department) {
        return a.targetDepartments?.includes(args.department);
      }

      if (a.targetType === "location" && args.locationId) {
        return a.targetLocationIds?.includes(args.locationId);
      }

      return true;
    });

    // Get already read
    const reads = await ctx.db
      .query("announcementReads")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .collect();

    const readIds = new Set(reads.map((r) => r.announcementId));

    // Mark unread as read
    let markedCount = 0;
    for (const announcement of announcements) {
      if (!readIds.has(announcement._id)) {
        await ctx.db.insert("announcementReads", {
          announcementId: announcement._id,
          personnelId: args.personnelId,
          readAt: now,
        });
        markedCount++;
      }
    }

    return { success: true, markedCount };
  },
});

// Get announcement by ID
export const getById = query({
  args: {
    announcementId: v.id("announcements"),
    personnelId: v.optional(v.id("personnel")),
  },
  handler: async (ctx, args) => {
    const announcement = await ctx.db.get(args.announcementId);
    if (!announcement) return null;

    let isRead = false;
    let readAt = null;

    if (args.personnelId) {
      const personnelId = args.personnelId;
      const read = await ctx.db
        .query("announcementReads")
        .withIndex("by_both", (q) =>
          q
            .eq("announcementId", args.announcementId)
            .eq("personnelId", personnelId)
        )
        .first();

      if (read) {
        isRead = true;
        readAt = read.readAt;
      }
    }

    return {
      ...announcement,
      isRead,
      readAt,
    };
  },
});

// ============ PUSH NOTIFICATIONS ============

// Internal action to send push notifications for announcements
export const sendAnnouncementPush = internalAction({
  args: {
    announcementId: v.id("announcements"),
    title: v.string(),
    priority: v.string(),
    targetType: v.string(),
    targetDepartments: v.optional(v.array(v.string())),
    targetLocationIds: v.optional(v.array(v.id("locations"))),
  },
  handler: async (ctx, args) => {
    // Get all active personnel that match the targeting
    let personnel = await ctx.runQuery(internal.announcements.getTargetedPersonnel, {
      targetType: args.targetType,
      targetDepartments: args.targetDepartments,
      targetLocationIds: args.targetLocationIds,
    });

    // Get users with push tokens for these personnel
    const usersWithTokens = await ctx.runQuery(internal.announcements.getUsersWithPushTokens, {
      personnelIds: personnel.map((p: any) => p._id),
    });

    // Send push notifications
    let sentCount = 0;
    for (const user of usersWithTokens) {
      if (user.expoPushToken) {
        try {
          await sendExpoPush(
            user.expoPushToken,
            args.priority === "urgent" ? `🚨 ${args.title}` : args.title,
            args.priority === "urgent" ? "URGENT: Tap to read" : "New announcement - tap to read",
            { type: "announcement", announcementId: args.announcementId }
          );
          sentCount++;
        } catch (error) {
          console.error(`Failed to send push to ${user.email}:`, error);
        }
      }
    }

    // Update announcement with push sent status
    await ctx.runMutation(internal.announcements.markPushSent, {
      announcementId: args.announcementId,
      sentCount,
    });

    return { sentCount };
  },
});

// Helper function to send Expo push notification
async function sendExpoPush(
  expoPushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  const message = {
    to: expoPushToken,
    sound: "default",
    title,
    body,
    data,
  };

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  return await response.json();
}

// Internal query to get personnel matching targeting criteria
export const getTargetedPersonnel = internalQuery({
  args: {
    targetType: v.string(),
    targetDepartments: v.optional(v.array(v.string())),
    targetLocationIds: v.optional(v.array(v.id("locations"))),
  },
  handler: async (ctx, args) => {
    let personnel = await ctx.db
      .query("personnel")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    // Filter by targeting
    if (args.targetType === "department" && args.targetDepartments) {
      personnel = personnel.filter((p) =>
        args.targetDepartments!.includes(p.department)
      );
    } else if (args.targetType === "location" && args.targetLocationIds) {
      personnel = personnel.filter((p) =>
        p.locationId && args.targetLocationIds!.includes(p.locationId)
      );
    }
    // "all" - return all active personnel

    return personnel;
  },
});

// Internal query to get users with push tokens for specific personnel
export const getUsersWithPushTokens = internalQuery({
  args: {
    personnelIds: v.array(v.id("personnel")),
  },
  handler: async (ctx, args) => {
    const personnelIdSet = new Set(args.personnelIds);

    const users = await ctx.db.query("users").collect();

    return users.filter(
      (u) =>
        u.expoPushToken &&
        u.personnelId &&
        personnelIdSet.has(u.personnelId)
    );
  },
});

// Internal mutation to mark announcement as push sent
export const markPushSent = internalMutation({
  args: {
    announcementId: v.id("announcements"),
    sentCount: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.announcementId, {
      pushSent: true,
      pushSentAt: Date.now(),
    });
  },
});
