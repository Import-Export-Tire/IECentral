import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Default cards for different roles
const DEFAULT_CARDS_BY_ROLE: Record<string, string[]> = {
  super_admin: ["projects", "applications", "websiteMessages", "hiringAnalytics", "activityFeed", "tenureCheckIns", "safetyReports"],
  admin: ["projects", "applications", "websiteMessages", "hiringAnalytics", "activityFeed", "tenureCheckIns"],
  office_manager: ["projects", "activityFeed"],
  warehouse_manager: ["projects", "activityFeed"],
  department_manager: [], // Uses department portal
  employee: [], // Uses employee portal
};

// Card display info
export const DASHBOARD_CARDS = [
  { id: "projects", label: "Active Projects", description: "Your active and recent projects" },
  { id: "applications", label: "Recent Applications", description: "New job applications" },
  { id: "websiteMessages", label: "Website Messages", description: "Contact forms and dealer inquiries" },
  { id: "hiringAnalytics", label: "Hiring Analytics", description: "Hiring metrics and upcoming interviews" },
  { id: "activityFeed", label: "Activity Feed", description: "Recent system activity" },
  { id: "tenureCheckIns", label: "Tenure Check-ins", description: "Due employee milestone reviews" },
];

// Get user's dashboard settings
export const getSettings = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("userDashboardSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    return settings;
  },
});

// Get user's dashboard settings with defaults
export const getSettingsWithDefaults = query({
  args: {
    userId: v.id("users"),
    userRole: v.string(),
  },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("userDashboardSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (settings) {
      return {
        enabledCards: settings.enabledCards,
        cardOrder: settings.cardOrder || settings.enabledCards,
        hasCustomSettings: true,
      };
    }

    // Return defaults based on role
    const defaultCards = DEFAULT_CARDS_BY_ROLE[args.userRole] || DEFAULT_CARDS_BY_ROLE.admin;
    return {
      enabledCards: defaultCards,
      cardOrder: defaultCards,
      hasCustomSettings: false,
    };
  },
});

// Save user's dashboard settings
export const saveSettings = mutation({
  args: {
    userId: v.id("users"),
    enabledCards: v.array(v.string()),
    cardOrder: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userDashboardSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabledCards: args.enabledCards,
        cardOrder: args.cardOrder,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("userDashboardSettings", {
      userId: args.userId,
      enabledCards: args.enabledCards,
      cardOrder: args.cardOrder,
      updatedAt: Date.now(),
    });
  },
});

// Reset user's dashboard to defaults
export const resetToDefaults = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userDashboardSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// Toggle a single card on/off
export const toggleCard = mutation({
  args: {
    userId: v.id("users"),
    userRole: v.string(),
    cardId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userDashboardSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    let currentCards: string[];

    if (existing) {
      currentCards = existing.enabledCards;
    } else {
      // Get defaults
      currentCards = DEFAULT_CARDS_BY_ROLE[args.userRole] || DEFAULT_CARDS_BY_ROLE.admin;
    }

    // Toggle the card
    const isEnabled = currentCards.includes(args.cardId);
    const newCards = isEnabled
      ? currentCards.filter((c) => c !== args.cardId)
      : [...currentCards, args.cardId];

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabledCards: newCards,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("userDashboardSettings", {
        userId: args.userId,
        enabledCards: newCards,
        updatedAt: Date.now(),
      });
    }
  },
});
