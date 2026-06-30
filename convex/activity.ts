import { v } from "convex/values";
import { query } from "./_generated/server";

// Tier per role (mirrors lib/permissions.ts getTier). Inlined here so this Convex
// function does NOT import lib/permissions — that file uses "@/" path aliases the
// Convex typecheck can't resolve, which breaks `convex deploy`.
const ROLE_TIER: Record<string, number> = {
  super_admin: 5, admin: 4, warehouse_director: 3,
  warehouse_manager: 2, office_manager: 2, retail_manager: 2, retail_store_manager: 2,
  department_manager: 1, shift_lead: 1, retail_associate: 1,
  member: 0, employee: 0,
};

// Get recent activity
export const getRecentActivity = query({
  args: {
    limit: v.optional(v.number()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Gate by the caller's resolved Activity Feed permission (tier default + any
    // per-user override). Denied users get nothing, even if the widget somehow renders.
    const u = await ctx.db.get(args.requestingUserId);
    if (!u) return [];
    // Resolve dashboard.activityFeed: per-user override wins, else tier >= 2 default.
    const override = u.permissionOverrides?.["dashboard.activityFeed"];
    const allowed = override !== undefined ? override : (ROLE_TIER[u.role] ?? 0) >= 2;
    if (!allowed) return [];

    const limit = args.limit || 50;

    // For now, we'll construct activity from existing data
    // In a production app, you'd have an activity table
    const activities: Array<{
      id: string;
      type: string;
      title: string;
      description: string;
      entityType?: string;
      entityId?: string;
      createdAt: number;
      icon: string;
      color: string;
    }> = [];

    // Get recent applications
    const applications = await ctx.db
      .query("applications")
      .order("desc")
      .take(10);

    for (const app of applications) {
      activities.push({
        id: `app-${app._id}`,
        type: "application_created",
        title: "New Application",
        description: `${app.firstName} ${app.lastName} applied for ${app.appliedJobTitle || "a position"}`,
        entityType: "application",
        entityId: app._id,
        createdAt: app.createdAt || Date.now(),
        icon: "document",
        color: "purple",
      });

      if (app.status === "hired") {
        activities.push({
          id: `app-hired-${app._id}`,
          type: "application_hired",
          title: "Applicant Hired",
          description: `${app.firstName} ${app.lastName} was hired`,
          entityType: "application",
          entityId: app._id,
          createdAt: (app.createdAt || Date.now()) + 1000,
          icon: "check",
          color: "green",
        });
      }

      if (app.scheduledInterviewDate) {
        activities.push({
          id: `app-interview-${app._id}`,
          type: "interview_scheduled",
          title: "Interview Scheduled",
          description: `Interview scheduled with ${app.firstName} ${app.lastName}`,
          entityType: "application",
          entityId: app._id,
          createdAt: (app.createdAt || Date.now()) + 500,
          icon: "calendar",
          color: "orange",
        });
      }
    }

    // Get recent projects
    const projects = await ctx.db
      .query("projects")
      .order("desc")
      .take(10);

    for (const project of projects) {
      activities.push({
        id: `proj-${project._id}`,
        type: "project_created",
        title: "Project Created",
        description: `"${project.name}" was created`,
        entityType: "project",
        entityId: project._id,
        createdAt: project.createdAt || Date.now(),
        icon: "folder",
        color: "cyan",
      });

      if (project.status === "done") {
        activities.push({
          id: `proj-done-${project._id}`,
          type: "project_completed",
          title: "Project Completed",
          description: `"${project.name}" was marked as done`,
          entityType: "project",
          entityId: project._id,
          createdAt: (project.createdAt || Date.now()) + 1000,
          icon: "check-circle",
          color: "green",
        });
      }
    }

    // Get recent personnel
    const personnel = await ctx.db
      .query("personnel")
      .order("desc")
      .take(10);

    for (const person of personnel) {
      activities.push({
        id: `person-${person._id}`,
        type: "personnel_created",
        title: "Personnel Added",
        description: `${person.firstName} ${person.lastName} joined ${person.department || "the team"}`,
        entityType: "personnel",
        entityId: person._id,
        createdAt: person.hireDate ? new Date(person.hireDate).getTime() : Date.now(),
        icon: "user-add",
        color: "blue",
      });
    }

    // Get recent safety checks
    const safetyChecks = await ctx.db
      .query("safetyChecklistCompletions")
      .order("desc")
      .take(10);

    for (const check of safetyChecks) {
      activities.push({
        id: `safety-${check._id}`,
        type: "safety_check_completed",
        title: "Safety Check Completed",
        description: `${check.personnelName} completed safety check for ${check.equipmentType} #${check.equipmentNumber}`,
        entityType: "safetyCheck",
        entityId: check._id,
        createdAt: check.completedAt || Date.now(),
        icon: "shield-check",
        color: "green",
      });
    }

    // Get recent messages (group chats)
    const messages = await ctx.db
      .query("messages")
      .order("desc")
      .take(5);

    for (const msg of messages) {
      if (!msg.content?.startsWith("[#")) { // Skip link messages
        activities.push({
          id: `msg-${msg._id}`,
          type: "message_sent",
          title: "Message Sent",
          description: `New message in chat`,
          entityType: "message",
          entityId: msg._id,
          createdAt: msg.createdAt || Date.now(),
          icon: "chat",
          color: "slate",
        });
      }
    }

    // Sort by createdAt desc and limit
    return activities
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },
});

// Get activity by entity
export const getEntityActivity = query({
  args: {
    entityType: v.string(),
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    // This would query from an activity table in production
    // For now, return empty array
    return [];
  },
});
