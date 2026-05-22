import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { requireManagePersonnel, requireSelfOrManager } from "./authGuards";

// Create a new project suggestion
export const create = mutation({
  args: {
    suggestedTo: v.id("users"),
    title: v.string(),
    description: v.string(),
    priority: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // For now, we'll use a placeholder for suggestedBy - in production this would come from auth
    // We'll need to pass the current user ID from the client
    const suggestionId = await ctx.db.insert("projectSuggestions", {
      suggestedBy: args.suggestedTo, // Will be overwritten by client passing real user ID
      suggestedTo: args.suggestedTo,
      title: args.title,
      description: args.description,
      priority: args.priority || "medium",
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return suggestionId;
  },
});

// Create suggestion with explicit suggestedBy
export const createWithUser = mutation({
  args: {
    suggestedBy: v.id("users"),
    suggestedTo: v.id("users"),
    title: v.string(),
    description: v.string(),
    priority: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Any active user can suggest a project to anyone (it has to be
    // approved by the suggestedTo or a manager anyway).
    await requireSelfOrManager(ctx, args.suggestedBy, args.suggestedBy);
    const suggestionId = await ctx.db.insert("projectSuggestions", {
      suggestedBy: args.suggestedBy,
      suggestedTo: args.suggestedTo,
      title: args.title,
      description: args.description,
      priority: args.priority || "medium",
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return suggestionId;
  },
});

// Approve a suggestion (creates a project)
export const approve = mutation({
  args: {
    suggestionId: v.id("projectSuggestions"),
    reviewedBy: v.id("users"),
    estimatedTimeline: v.string(),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion) throw new Error("Suggestion not found");
    if (suggestion.status !== "pending") throw new Error("Suggestion already reviewed");
    // The person it was suggested to can approve their own; managers can too.
    await requireSelfOrManager(ctx, args.reviewedBy, suggestion.suggestedTo);

    // Create the project from the suggestion
    const projectId = await ctx.db.insert("projects", {
      name: suggestion.title,
      description: suggestion.description,
      status: "backlog",
      priority: suggestion.priority || "medium",
      createdBy: suggestion.suggestedBy,
      assignedTo: suggestion.suggestedTo,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Update the suggestion
    await ctx.db.patch(args.suggestionId, {
      status: "approved",
      reviewedBy: args.reviewedBy,
      reviewedAt: Date.now(),
      estimatedTimeline: args.estimatedTimeline,
      projectId: projectId,
      updatedAt: Date.now(),
    });

    return { suggestionId: args.suggestionId, projectId };
  },
});

// Deny a suggestion
export const deny = mutation({
  args: {
    suggestionId: v.id("projectSuggestions"),
    reviewedBy: v.id("users"),
    denialReason: v.string(),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion) throw new Error("Suggestion not found");
    if (suggestion.status !== "pending") throw new Error("Suggestion already reviewed");
    await requireSelfOrManager(ctx, args.reviewedBy, suggestion.suggestedTo);

    await ctx.db.patch(args.suggestionId, {
      status: "denied",
      reviewedBy: args.reviewedBy,
      reviewedAt: Date.now(),
      denialReason: args.denialReason,
      updatedAt: Date.now(),
    });

    return args.suggestionId;
  },
});

// Get suggestions sent TO a specific user (inbox)
export const getInbox = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const suggestions = await ctx.db
      .query("projectSuggestions")
      .withIndex("by_suggested_to", (q) => q.eq("suggestedTo", args.userId))
      .order("desc")
      .collect();

    // Enrich with user data
    const enriched = await Promise.all(
      suggestions.map(async (suggestion) => {
        const suggestedBy = await ctx.db.get(suggestion.suggestedBy);
        const reviewedBy = suggestion.reviewedBy
          ? await ctx.db.get(suggestion.reviewedBy)
          : null;
        return {
          ...suggestion,
          suggestedByUser: suggestedBy,
          reviewedByUser: reviewedBy,
        };
      })
    );

    return enriched;
  },
});

// Get suggestions sent BY a specific user (outbox)
export const getOutbox = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const suggestions = await ctx.db
      .query("projectSuggestions")
      .withIndex("by_suggested_by", (q) => q.eq("suggestedBy", args.userId))
      .order("desc")
      .collect();

    // Enrich with user data
    const enriched = await Promise.all(
      suggestions.map(async (suggestion) => {
        const suggestedTo = await ctx.db.get(suggestion.suggestedTo);
        const reviewedBy = suggestion.reviewedBy
          ? await ctx.db.get(suggestion.reviewedBy)
          : null;
        return {
          ...suggestion,
          suggestedToUser: suggestedTo,
          reviewedByUser: reviewedBy,
        };
      })
    );

    return enriched;
  },
});

// Get all pending suggestions (for admin dashboard)
export const getAllPending = query({
  args: {},
  handler: async (ctx) => {
    const suggestions = await ctx.db
      .query("projectSuggestions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .collect();

    // Enrich with user data
    const enriched = await Promise.all(
      suggestions.map(async (suggestion) => {
        const suggestedBy = await ctx.db.get(suggestion.suggestedBy);
        const suggestedTo = await ctx.db.get(suggestion.suggestedTo);
        return {
          ...suggestion,
          suggestedByUser: suggestedBy,
          suggestedToUser: suggestedTo,
        };
      })
    );

    return enriched;
  },
});

// Get a single suggestion by ID
export const getById = query({
  args: { suggestionId: v.id("projectSuggestions") },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion) return null;

    const suggestedBy = await ctx.db.get(suggestion.suggestedBy);
    const suggestedTo = await ctx.db.get(suggestion.suggestedTo);
    const reviewedBy = suggestion.reviewedBy
      ? await ctx.db.get(suggestion.reviewedBy)
      : null;
    const project = suggestion.projectId
      ? await ctx.db.get(suggestion.projectId)
      : null;

    return {
      ...suggestion,
      suggestedByUser: suggestedBy,
      suggestedToUser: suggestedTo,
      reviewedByUser: reviewedBy,
      project,
    };
  },
});

// Delete a suggestion (only if pending and by the creator)
export const remove = mutation({
  args: {
    suggestionId: v.id("projectSuggestions"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion) throw new Error("Suggestion not found");
    if (suggestion.status !== "pending") throw new Error("Cannot delete reviewed suggestions");
    // Self-only (or manager) — must also be an active user.
    await requireSelfOrManager(ctx, args.userId, suggestion.suggestedBy);

    await ctx.db.delete(args.suggestionId);
    return args.suggestionId;
  },
});
