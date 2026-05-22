import { v } from "convex/values";
import { mutation, query, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireManagePersonnel } from "./authGuards";

// Get all call-offs (admin view)
export const getAll = query({
  args: {
    date: v.optional(v.string()),
    personnelId: v.optional(v.id("personnel")),
  },
  handler: async (ctx, args) => {
    let callOffs;

    if (args.date) {
      callOffs = await ctx.db
        .query("callOffs")
        .withIndex("by_date", (q) => q.eq("date", args.date!))
        .order("desc")
        .collect();
    } else if (args.personnelId) {
      callOffs = await ctx.db
        .query("callOffs")
        .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId!))
        .order("desc")
        .collect();
    } else {
      callOffs = await ctx.db
        .query("callOffs")
        .order("desc")
        .take(100); // Limit to recent
    }

    // Enrich with personnel data
    const enriched = await Promise.all(
      callOffs.map(async (callOff) => {
        const personnel = await ctx.db.get(callOff.personnelId);
        const acknowledger = callOff.acknowledgedBy
          ? await ctx.db.get(callOff.acknowledgedBy)
          : null;
        return {
          ...callOff,
          personnelName: personnel
            ? `${personnel.firstName} ${personnel.lastName}`
            : "Unknown",
          personnelDepartment: personnel?.department,
          personnelPosition: personnel?.position,
          acknowledgerName: acknowledger?.name,
        };
      })
    );

    return enriched;
  },
});

// Get today's call-offs
export const getToday = query({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().split("T")[0];

    const callOffs = await ctx.db
      .query("callOffs")
      .withIndex("by_date", (q) => q.eq("date", today))
      .order("desc")
      .collect();

    const enriched = await Promise.all(
      callOffs.map(async (callOff) => {
        const personnel = await ctx.db.get(callOff.personnelId);
        const acknowledger = callOff.acknowledgedBy
          ? await ctx.db.get(callOff.acknowledgedBy)
          : null;
        return {
          ...callOff,
          personnelName: personnel
            ? `${personnel.firstName} ${personnel.lastName}`
            : "Unknown",
          personnelDepartment: personnel?.department,
          personnelPosition: personnel?.position,
          personnelPhone: personnel?.phone,
          acknowledgerName: acknowledger?.name,
        };
      })
    );

    return enriched;
  },
});

// Get unacknowledged call-offs
export const getUnacknowledged = query({
  args: {},
  handler: async (ctx) => {
    const callOffs = await ctx.db
      .query("callOffs")
      .order("desc")
      .filter((q) => q.eq(q.field("acknowledgedAt"), undefined))
      .collect();

    const enriched = await Promise.all(
      callOffs.map(async (callOff) => {
        const personnel = await ctx.db.get(callOff.personnelId);
        return {
          ...callOff,
          personnelName: personnel
            ? `${personnel.firstName} ${personnel.lastName}`
            : "Unknown",
          personnelDepartment: personnel?.department,
          personnelPosition: personnel?.position,
          personnelLocationId: personnel?.locationId,
          acknowledgerName: undefined as string | undefined,
        };
      })
    );

    return enriched;
  },
});

// Get call-offs for a specific employee
export const getMyCallOffs = query({
  args: {
    personnelId: v.id("personnel"),
  },
  handler: async (ctx, args) => {
    const callOffs = await ctx.db
      .query("callOffs")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .order("desc")
      .take(50);

    return callOffs;
  },
});

// Submit a call-off (employee action)
export const submit = mutation({
  args: {
    personnelId: v.id("personnel"),
    date: v.string(),
    reason: v.string(),
    reportedVia: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.reason.length > 2000) {
      throw new Error("Reason must be 2,000 characters or fewer.");
    }

    const now = Date.now();

    const callOffId = await ctx.db.insert("callOffs", {
      personnelId: args.personnelId,
      date: args.date,
      reason: args.reason,
      reportedAt: now,
      reportedVia: args.reportedVia || "app",
      createdAt: now,
    });

    // Get personnel to find their location manager
    const personnel = await ctx.db.get(args.personnelId);
    const employeeName = personnel
      ? `${personnel.firstName} ${personnel.lastName}`
      : "Unknown Employee";

    let locationManagerId: any = undefined;

    if (personnel?.locationId) {
      const location = await ctx.db.get(personnel.locationId);
      if (location?.managerId) {
        locationManagerId = location.managerId;

        // Create notification for manager (in-app)
        await ctx.db.insert("notifications", {
          userId: location.managerId,
          type: "call_off",
          title: "Employee Call-Off",
          message: `${employeeName} called off for ${args.date}: ${args.reason}`,
          link: `/call-offs`,
          relatedPersonnelId: args.personnelId,
          relatedId: callOffId,
          isRead: false,
          isDismissed: false,
          createdAt: now,
        });

        // Update call-off with notification timestamp
        await ctx.db.patch(callOffId, {
          managerNotifiedAt: now,
        });
      }
    }

    // Send push notifications to managers (location manager + directors + admins)
    await ctx.scheduler.runAfter(0, internal.callOffs.sendCallOffPush, {
      employeeName,
      date: args.date,
      reason: args.reason,
      locationManagerId,
    });

    return callOffId;
  },
});

// Acknowledge a call-off (manager action)
export const acknowledge = mutation({
  args: {
    callOffId: v.id("callOffs"),
    acknowledgedBy: v.id("users"),
    managerNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.acknowledgedBy);
    const callOff = await ctx.db.get(args.callOffId);
    if (!callOff) throw new Error("Call-off not found");

    const now = Date.now();

    await ctx.db.patch(args.callOffId, {
      acknowledgedBy: args.acknowledgedBy,
      acknowledgedAt: now,
      managerNotes: args.managerNotes,
    });

    return { success: true };
  },
});

// Add a call-off manually (admin action - for phone/text reports)
export const addManual = mutation({
  args: {
    personnelId: v.id("personnel"),
    date: v.string(),
    reason: v.string(),
    reportedVia: v.string(),
    acknowledgedBy: v.id("users"),
    managerNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.acknowledgedBy);
    const now = Date.now();

    const callOffId = await ctx.db.insert("callOffs", {
      personnelId: args.personnelId,
      date: args.date,
      reason: args.reason,
      reportedAt: now,
      reportedVia: args.reportedVia,
      acknowledgedBy: args.acknowledgedBy,
      acknowledgedAt: now,
      managerNotes: args.managerNotes,
      managerNotifiedAt: now, // Already acknowledged
      createdAt: now,
    });

    return callOffId;
  },
});

// Get stats for dashboard
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().split("T")[0];

    const todayCallOffs = await ctx.db
      .query("callOffs")
      .withIndex("by_date", (q) => q.eq("date", today))
      .collect();

    const unacknowledged = await ctx.db
      .query("callOffs")
      .filter((q) => q.eq(q.field("acknowledgedAt"), undefined))
      .collect();

    // Get this week's call-offs
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split("T")[0];

    const thisWeek = await ctx.db
      .query("callOffs")
      .withIndex("by_date")
      .filter((q) => q.gte(q.field("date"), weekStartStr))
      .collect();

    return {
      todayCount: todayCallOffs.length,
      unacknowledgedCount: unacknowledged.length,
      thisWeekCount: thisWeek.length,
    };
  },
});

// Get call-offs by date range
export const getByDateRange = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const callOffs = await ctx.db
      .query("callOffs")
      .withIndex("by_date")
      .filter((q) =>
        q.and(
          q.gte(q.field("date"), args.startDate),
          q.lte(q.field("date"), args.endDate)
        )
      )
      .collect();

    const enriched = await Promise.all(
      callOffs.map(async (callOff) => {
        const personnel = await ctx.db.get(callOff.personnelId);
        return {
          ...callOff,
          personnelName: personnel
            ? `${personnel.firstName} ${personnel.lastName}`
            : "Unknown",
          personnelDepartment: personnel?.department,
        };
      })
    );

    return enriched;
  },
});

// ============ PUSH NOTIFICATIONS ============

// Get users who should receive call-off alerts
export const getCallOffAlertRecipients = internalQuery({
  args: {
    locationManagerId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // Get all users who should receive call-off alerts
    // 1. Location manager
    // 2. Warehouse directors
    // 3. Admins/super_admins (owner oversight)
    const users = await ctx.db.query("users").collect();

    const recipientRoles = ["super_admin", "admin", "warehouse_director", "coo"];

    const recipients = users.filter((u) => {
      // Include if they have a notification role
      if (recipientRoles.includes(u.role) && u.isActive && u.expoPushToken) {
        return true;
      }
      // Include if they are the location manager
      if (args.locationManagerId && u._id === args.locationManagerId && u.expoPushToken) {
        return true;
      }
      return false;
    });

    return recipients.map((u) => ({
      userId: u._id,
      name: u.name,
      expoPushToken: u.expoPushToken!,
      role: u.role,
    }));
  },
});

// Send push notification for call-off
export const sendCallOffPush = internalAction({
  args: {
    employeeName: v.string(),
    date: v.string(),
    reason: v.string(),
    locationManagerId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // Get recipients
    const recipients = await ctx.runQuery(internal.callOffs.getCallOffAlertRecipients, {
      locationManagerId: args.locationManagerId,
    });

    if (recipients.length === 0) {
      console.log("No recipients with push tokens for call-off alert");
      return { sentCount: 0 };
    }

    // Format date for display
    const dateObj = new Date(args.date + "T12:00:00");
    const formattedDate = dateObj.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    // Send push to each recipient
    let sentCount = 0;
    for (const recipient of recipients) {
      try {
        const message = {
          to: recipient.expoPushToken,
          sound: "default",
          title: "📞 Employee Call-Off",
          body: `${args.employeeName} called off for ${formattedDate}: ${args.reason}`,
          data: { type: "call_off" },
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

        if (response.ok) {
          sentCount++;
        }
      } catch (error) {
        console.error(`Failed to send call-off push to ${recipient.name}:`, error);
      }
    }

    return { sentCount };
  },
});
