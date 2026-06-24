import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireRole } from "./authGuards";
import Anthropic from "@anthropic-ai/sdk";

// ============ QUERIES ============

// Get all exit interviews
export const list = query({
  args: {
    status: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let interviews;

    if (args.status) {
      interviews = await ctx.db
        .query("exitInterviews")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      interviews = await ctx.db.query("exitInterviews").collect();
    }

    // Filter by date range
    if (args.startDate) {
      interviews = interviews.filter(i => i.terminationDate >= args.startDate!);
    }
    if (args.endDate) {
      interviews = interviews.filter(i => i.terminationDate <= args.endDate!);
    }

    return interviews.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Get a single exit interview
export const getById = query({
  args: { interviewId: v.string() },
  handler: async (ctx, args) => {
    // Validate that the ID looks like a valid Convex ID
    if (!args.interviewId || args.interviewId.length < 10) {
      return null;
    }
    try {
      const id = args.interviewId as Id<"exitInterviews">;
      return await ctx.db.get(id);
    } catch {
      return null;
    }
  },
});

// Get exit interview by personnel
export const getByPersonnel = query({
  args: { personnelId: v.id("personnel") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("exitInterviews")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .first();
  },
});

// Get pending exit interviews
export const getPending = query({
  handler: async (ctx) => {
    const interviews = await ctx.db
      .query("exitInterviews")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    return interviews.sort((a, b) => a.terminationDate.localeCompare(b.terminationDate));
  },
});

// Get exit interview analytics
export const getAnalytics = query({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let interviews = await ctx.db
      .query("exitInterviews")
      .filter((q) => q.eq(q.field("status"), "completed"))
      .collect();

    // Filter by date range
    if (args.startDate) {
      interviews = interviews.filter(i => i.terminationDate >= args.startDate!);
    }
    if (args.endDate) {
      interviews = interviews.filter(i => i.terminationDate <= args.endDate!);
    }

    if (interviews.length === 0) {
      return {
        totalCompleted: 0,
        avgSatisfaction: null,
        avgManagement: null,
        avgWorkLifeBalance: null,
        avgCompensation: null,
        avgGrowthOpportunity: null,
        wouldReturn: { yes: 0, no: 0, maybe: 0 },
        wouldRecommend: { yes: 0, no: 0, maybe: 0 },
        topReasons: [],
        byDepartment: [],
      };
    }

    // Calculate averages
    const withResponses = interviews.filter(i => i.responses);

    const calcAvg = (field: keyof NonNullable<typeof interviews[0]['responses']>) => {
      const values = withResponses
        .map(i => i.responses?.[field])
        .filter((v): v is number => typeof v === 'number');
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
    };

    const avgSatisfaction = calcAvg('satisfactionRating');
    const avgManagement = calcAvg('managementRating');
    const avgWorkLifeBalance = calcAvg('workLifeBalanceRating');
    const avgCompensation = calcAvg('compensationRating');
    const avgGrowthOpportunity = calcAvg('growthOpportunityRating');

    // Would return/recommend counts
    const wouldReturn = { yes: 0, no: 0, maybe: 0 };
    const wouldRecommend = { yes: 0, no: 0, maybe: 0 };

    withResponses.forEach(i => {
      if (i.responses?.wouldReturn) {
        wouldReturn[i.responses.wouldReturn as keyof typeof wouldReturn]++;
      }
      if (i.responses?.wouldRecommend) {
        wouldRecommend[i.responses.wouldRecommend as keyof typeof wouldRecommend]++;
      }
    });

    // Top reasons for leaving
    const reasonCounts: Record<string, number> = {};
    withResponses.forEach(i => {
      if (i.responses?.primaryReason) {
        const reason = i.responses.primaryReason;
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      }
    });
    const topReasons = Object.entries(reasonCounts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // By department
    const deptData: Record<string, { count: number, satisfaction: number[] }> = {};
    interviews.forEach(i => {
      if (!deptData[i.department]) {
        deptData[i.department] = { count: 0, satisfaction: [] };
      }
      deptData[i.department].count++;
      if (i.responses?.satisfactionRating) {
        deptData[i.department].satisfaction.push(i.responses.satisfactionRating);
      }
    });
    const byDepartment = Object.entries(deptData)
      .map(([department, data]) => ({
        department,
        count: data.count,
        avgSatisfaction: data.satisfaction.length > 0
          ? data.satisfaction.reduce((a, b) => a + b, 0) / data.satisfaction.length
          : null,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      totalCompleted: interviews.length,
      avgSatisfaction,
      avgManagement,
      avgWorkLifeBalance,
      avgCompensation,
      avgGrowthOpportunity,
      wouldReturn,
      wouldRecommend,
      topReasons,
      byDepartment,
    };
  },
});

// ============ MUTATIONS ============

// Create an exit interview (typically auto-created when terminating)
export const create = mutation({
  args: {
    personnelId: v.id("personnel"),
    terminationDate: v.string(),
    terminationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const personnel = await ctx.db.get(args.personnelId);
    if (!personnel) throw new Error("Personnel not found");

    // Check if exit interview already exists
    const existing = await ctx.db
      .query("exitInterviews")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .first();

    if (existing) {
      return existing._id;
    }

    const now = Date.now();

    const interviewId = await ctx.db.insert("exitInterviews", {
      personnelId: args.personnelId,
      personnelName: `${personnel.firstName} ${personnel.lastName}`,
      department: personnel.department,
      position: personnel.position,
      hireDate: personnel.hireDate,
      terminationDate: args.terminationDate,
      terminationReason: args.terminationReason,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    return interviewId;
  },
});

// Schedule an exit interview
export const schedule = mutation({
  args: {
    interviewId: v.id("exitInterviews"),
    scheduledDate: v.string(),
    scheduledTime: v.string(),
    conductedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const interview = await ctx.db.get(args.interviewId);
    if (!interview) throw new Error("Exit interview not found");

    const user = await ctx.db.get(args.conductedBy);
    if (!user) throw new Error("User not found");

    await ctx.db.patch(args.interviewId, {
      status: "scheduled",
      scheduledDate: args.scheduledDate,
      scheduledTime: args.scheduledTime,
      conductedBy: args.conductedBy,
      conductedByName: user.name,
      updatedAt: Date.now(),
    });

    return args.interviewId;
  },
});

// Complete an exit interview with responses
export const complete = mutation({
  args: {
    interviewId: v.id("exitInterviews"),
    responses: v.object({
      primaryReason: v.optional(v.string()),
      wouldReturn: v.optional(v.string()),
      wouldRecommend: v.optional(v.string()),
      satisfactionRating: v.optional(v.number()),
      managementRating: v.optional(v.number()),
      workLifeBalanceRating: v.optional(v.number()),
      compensationRating: v.optional(v.number()),
      growthOpportunityRating: v.optional(v.number()),
      whatLikedMost: v.optional(v.string()),
      whatCouldImprove: v.optional(v.string()),
      additionalComments: v.optional(v.string()),
    }),
    interviewerNotes: v.optional(v.string()),
    conductedBy: v.id("users"),
    // 5/27 extension: structured reason + HR handoff fields
    leavingCategory: v.optional(v.string()),
    rehireEligible: v.optional(v.boolean()),
    severancePaid: v.optional(v.boolean()),
    finalPaycheckDate: v.optional(v.string()),
    hrNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.conductedBy, ["super_admin"]);
    const interview = await ctx.db.get(args.interviewId);
    if (!interview) throw new Error("Exit interview not found");

    const user = await ctx.db.get(args.conductedBy);
    if (!user) throw new Error("User not found");

    const now = Date.now();

    const patch: Record<string, unknown> = {
      status: "completed",
      responses: args.responses,
      interviewerNotes: args.interviewerNotes,
      conductedBy: args.conductedBy,
      conductedByName: user.name,
      completedAt: now,
      updatedAt: now,
    };
    if (args.leavingCategory !== undefined) patch.leavingCategory = args.leavingCategory;
    if (args.rehireEligible !== undefined) patch.rehireEligible = args.rehireEligible;
    if (args.severancePaid !== undefined) patch.severancePaid = args.severancePaid;
    if (args.finalPaycheckDate !== undefined) patch.finalPaycheckDate = args.finalPaycheckDate;
    if (args.hrNotes !== undefined) patch.hrNotes = args.hrNotes;
    await ctx.db.patch(args.interviewId, patch);

    return args.interviewId;
  },
});

// Sign-off on the termination. Moves status from pending_signoff → scheduled
// (interview still pending) or → completed (if conducting now). Records who
// acknowledged and when. Super-admin only.
export const signOff = mutation({
  args: {
    interviewId: v.id("exitInterviews"),
    signedOffByUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.signedOffByUserId, ["super_admin"]);
    const interview = await ctx.db.get(args.interviewId);
    if (!interview) throw new Error("Exit interview not found");
    if (interview.status === "reversed") {
      throw new Error("Cannot sign off on a reversed termination");
    }
    await ctx.db.patch(args.interviewId, {
      status: interview.status === "completed" ? "completed" : "scheduled",
      signedOffByUserId: args.signedOffByUserId,
      signedOffAt: Date.now(),
      updatedAt: Date.now(),
    });
    return args.interviewId;
  },
});

// Reverse the termination — within the 7-day window only. Flips personnel
// back to active, cancels the calendar event, and records the reversal.
// Super-admin only.
export const reverse = mutation({
  args: {
    interviewId: v.id("exitInterviews"),
    reversedByUserId: v.id("users"),
    reversedReason: v.string(),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.reversedByUserId, ["super_admin"]);
    const interview = await ctx.db.get(args.interviewId);
    if (!interview) throw new Error("Exit interview not found");
    const now = Date.now();
    if (interview.reversibleUntil && now > interview.reversibleUntil) {
      throw new Error(
        `Reversal window expired on ${new Date(interview.reversibleUntil).toLocaleDateString()}. Use the Rehire flow instead.`,
      );
    }
    if (interview.status === "reversed") throw new Error("Already reversed");

    // Flip the personnel record back to active and clear termination fields.
    await ctx.db.patch(interview.personnelId, {
      status: "active",
      terminationDate: undefined,
      terminationReason: undefined,
      updatedAt: now,
    });

    // Cancel the calendar event if one was created.
    if (interview.calendarEventId) {
      await ctx.db.patch(interview.calendarEventId, {
        isCancelled: true,
        cancelledAt: now,
        cancelledBy: args.reversedByUserId,
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.interviewId, {
      status: "reversed",
      reversedAt: now,
      reversedByUserId: args.reversedByUserId,
      reversedReason: args.reversedReason,
      updatedAt: now,
    });

    return args.interviewId;
  },
});

// Mark as declined (employee refused exit interview)
export const decline = mutation({
  args: {
    interviewId: v.id("exitInterviews"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.interviewId, {
      status: "declined",
      interviewerNotes: args.notes,
      updatedAt: Date.now(),
    });

    return args.interviewId;
  },
});

// Delete an exit interview
export const remove = mutation({
  args: { interviewId: v.id("exitInterviews") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.interviewId);
    return { success: true };
  },
});

// Reset an exit interview back to pending (admin only)
export const resetToPending = mutation({
  args: { interviewId: v.id("exitInterviews") },
  handler: async (ctx, args) => {
    const interview = await ctx.db.get(args.interviewId);
    if (!interview) throw new Error("Exit interview not found");

    await ctx.db.patch(args.interviewId, {
      status: "pending",
      responses: undefined,
      completedAt: undefined,
      updatedAt: Date.now(),
    });

    return { success: true, previousStatus: interview.status };
  },
});

// Reset ALL exit interviews to pending (admin only - use with caution)
export const resetAllToPending = mutation({
  handler: async (ctx) => {
    const interviews = await ctx.db.query("exitInterviews").collect();
    let reset = 0;

    for (const interview of interviews) {
      if (interview.status === "completed") {
        await ctx.db.patch(interview._id, {
          status: "pending",
          responses: undefined,
          completedAt: undefined,
          updatedAt: Date.now(),
        });
        reset++;
      }
    }

    return { reset, total: interviews.length };
  },
});

// Standard exit interview reasons (for dropdown)
export const getReasonOptions = query({
  handler: async () => {
    return [
      "Better opportunity elsewhere",
      "Higher compensation",
      "Career advancement",
      "Relocation",
      "Family/personal reasons",
      "Work-life balance",
      "Management issues",
      "Company culture",
      "Lack of growth opportunities",
      "Job duties changed",
      "Retirement",
      "Health reasons",
      "Going back to school",
      "Starting own business",
      "Contract ended",
      "Other",
    ];
  },
});

// Submit exit interview survey (self-service - no auth required)
// This is used by terminated employees via email link
export const submitSelfService = mutation({
  args: {
    interviewId: v.id("exitInterviews"),
    responses: v.object({
      primaryReason: v.optional(v.string()),
      wouldReturn: v.optional(v.string()),
      wouldRecommend: v.optional(v.string()),
      satisfactionRating: v.optional(v.number()),
      managementRating: v.optional(v.number()),
      workLifeBalanceRating: v.optional(v.number()),
      compensationRating: v.optional(v.number()),
      growthOpportunityRating: v.optional(v.number()),
      whatLikedMost: v.optional(v.string()),
      whatCouldImprove: v.optional(v.string()),
      additionalComments: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const interview = await ctx.db.get(args.interviewId);
    if (!interview) throw new Error("Exit interview not found");
    if (interview.status === "completed") {
      throw new Error("This survey has already been submitted");
    }

    const now = Date.now();

    await ctx.db.patch(args.interviewId, {
      status: "completed",
      responses: args.responses,
      completedAt: now,
      updatedAt: now,
    });

    return { success: true };
  },
});

// Send exit interview emails to all terminated employees who haven't received one
export const sendBulkExitInterviewEmails = action({
  args: {},
  handler: async (ctx): Promise<{ sent: number; skipped: number; errors: string[] }> => {
    // Get all terminated personnel
    const terminatedPersonnel = await ctx.runQuery(internal.exitInterviews.getTerminatedPersonnelForBulkEmail);

    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const person of terminatedPersonnel) {
      try {
        // Check if they have an exit interview already
        let exitInterviewId = person.exitInterviewId;

        // Create exit interview if doesn't exist
        if (!exitInterviewId) {
          exitInterviewId = await ctx.runMutation(internal.exitInterviews.createForBulkEmail, {
            personnelId: person._id,
            personnelName: `${person.firstName} ${person.lastName}`,
            department: person.department,
            position: person.position,
            hireDate: person.hireDate,
            terminationDate: person.terminationDate || new Date().toISOString().split("T")[0],
            terminationReason: person.terminationReason || "Unknown",
          });
        }

        // Send email
        if (person.email && exitInterviewId) {
          await ctx.runAction(internal.emails.sendExitInterviewEmail, {
            employeeName: `${person.firstName} ${person.lastName}`,
            employeeEmail: person.email,
            exitInterviewId: exitInterviewId,
            terminationDate: person.terminationDate || new Date().toISOString().split("T")[0],
            position: person.position,
            department: person.department,
          });
          sent++;
        } else {
          skipped++;
        }
      } catch (error) {
        errors.push(`${person.firstName} ${person.lastName}: ${String(error)}`);
      }
    }

    return { sent, skipped, errors };
  },
});

// Internal query to get terminated personnel for bulk email
export const getTerminatedPersonnelForBulkEmail = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Get all terminated personnel
    const terminated = await ctx.db
      .query("personnel")
      .filter((q) => q.eq(q.field("status"), "terminated"))
      .collect();

    // Get all existing exit interviews
    const exitInterviews = await ctx.db.query("exitInterviews").collect();
    const interviewByPersonnelId = new Map(
      exitInterviews.map((ei) => [ei.personnelId.toString(), ei])
    );

    // Return personnel with their exit interview status
    return terminated.map((person) => {
      const existingInterview = interviewByPersonnelId.get(person._id.toString());
      return {
        ...person,
        exitInterviewId: existingInterview?._id,
        exitInterviewStatus: existingInterview?.status,
      };
    }).filter((person) => {
      // Only include if:
      // 1. No exit interview exists, OR
      // 2. Exit interview exists but is still pending
      return !person.exitInterviewStatus || person.exitInterviewStatus === "pending";
    });
  },
});

// Internal mutation to create exit interview for bulk email
export const createForBulkEmail = internalMutation({
  args: {
    personnelId: v.id("personnel"),
    personnelName: v.string(),
    department: v.optional(v.string()),
    position: v.optional(v.string()),
    hireDate: v.optional(v.string()),
    terminationDate: v.string(),
    terminationReason: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const interviewId = await ctx.db.insert("exitInterviews", {
      personnelId: args.personnelId,
      personnelName: args.personnelName,
      department: args.department || "Unknown",
      position: args.position || "Unknown",
      hireDate: args.hireDate || "Unknown",
      terminationDate: args.terminationDate,
      terminationReason: args.terminationReason,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    return interviewId;
  },
});

// AI-generated summary of exit interview responses
export const generateAISummary = action({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    summary?: string;
    keyThemes?: string[];
    actionItems?: string[];
    sentimentOverview?: string;
    error?: string;
  }> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { success: false, error: "AI service not configured" };
    }

    // Get completed exit interviews
    let interviews = await ctx.runQuery(internal.exitInterviews.getCompletedInterviews, {});

    // Filter by date range if provided
    if (args.startDate) {
      interviews = interviews.filter((i: { terminationDate: string }) => i.terminationDate >= args.startDate!);
    }
    if (args.endDate) {
      interviews = interviews.filter((i: { terminationDate: string }) => i.terminationDate <= args.endDate!);
    }

    if (interviews.length === 0) {
      return {
        success: true,
        summary: "No completed exit interviews found for the specified period.",
        keyThemes: [],
        actionItems: [],
        sentimentOverview: "N/A"
      };
    }

    // Format interviews for AI analysis
    const interviewData = interviews.map((i: {
      personnelName: string;
      department?: string;
      position?: string;
      terminationDate: string;
      responses?: {
        primaryReason?: string;
        satisfactionRating?: number;
        managementRating?: number;
        workLifeBalanceRating?: number;
        compensationRating?: number;
        growthOpportunityRating?: number;
        wouldReturn?: string;
        wouldRecommend?: string;
        whatLikedMost?: string;
        whatCouldImprove?: string;
        additionalComments?: string;
      };
    }) => ({
      department: i.department,
      position: i.position,
      terminationDate: i.terminationDate,
      responses: i.responses,
    }));

    const anthropic = new Anthropic({ apiKey });

    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: `You are an HR analytics expert analyzing exit interview data for Import Export Tire Co.

Analyze the following ${interviews.length} exit interview responses and provide:

1. **Executive Summary** (2-3 paragraphs): Overall patterns, trends, and key insights from the exit interviews.

2. **Key Themes** (bullet points): The main recurring themes or issues mentioned by departing employees.

3. **Sentiment Overview**: Overall sentiment (positive/negative/mixed) and what's driving it.

4. **Action Items** (prioritized list): Specific, actionable recommendations for management to improve retention.

5. **Departmental Insights**: Any department-specific patterns or concerns.

Exit Interview Data:
${JSON.stringify(interviewData, null, 2)}

Rating Scale: 1 = Poor, 5 = Excellent
Please be specific and reference actual feedback where relevant. Focus on actionable insights.`
          }
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        return { success: false, error: "Unexpected AI response format" };
      }

      // Parse the AI response to extract sections
      const fullText = content.text;

      // Extract key themes (look for bullet points after "Key Themes")
      const themesMatch = fullText.match(/Key Themes[:\s]*\n([\s\S]*?)(?=\n\n|\n\d\.|\n\*\*)/i);
      const keyThemes = themesMatch
        ? themesMatch[1].split('\n').filter(line => line.trim().startsWith('-') || line.trim().startsWith('•')).map(line => line.replace(/^[-•*]\s*/, '').trim())
        : [];

      // Extract action items
      const actionsMatch = fullText.match(/Action Items[:\s]*\n([\s\S]*?)(?=\n\n\*\*|\n\n\d\.|\n\*\*[A-Z]|$)/i);
      const actionItems = actionsMatch
        ? actionsMatch[1].split('\n').filter(line => line.trim().startsWith('-') || line.trim().startsWith('•') || /^\d\./.test(line.trim())).map(line => line.replace(/^[-•*\d.]\s*/, '').trim())
        : [];

      // Extract sentiment
      const sentimentMatch = fullText.match(/Sentiment Overview[:\s]*\n([\s\S]*?)(?=\n\n|\n\*\*)/i);
      const sentimentOverview = sentimentMatch ? sentimentMatch[1].trim() : "See full summary";

      return {
        success: true,
        summary: fullText,
        keyThemes: keyThemes.slice(0, 10),
        actionItems: actionItems.slice(0, 10),
        sentimentOverview,
      };
    } catch (error) {
      console.error("AI summary generation failed:", error);
      return { success: false, error: String(error) };
    }
  },
});

// Internal query to get completed interviews for AI analysis
export const getCompletedInterviews = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("exitInterviews")
      .filter((q) => q.eq(q.field("status"), "completed"))
      .collect();
  },
});
