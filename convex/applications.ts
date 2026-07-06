import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";

function applicationSearchText(a: {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  appliedJobTitle?: string;
}) {
  // Include the phone both as-entered (so "(951) 555" tokenizes) and as a bare
  // digits-only token (so a search of "9515551234" matches regardless of formatting),
  // plus the applied job title. All lowercased for the full-text index.
  const digits = (a.phone ?? "").replace(/\D/g, "");
  return `${a.firstName} ${a.lastName} ${a.email} ${a.phone ?? ""} ${digits} ${a.appliedJobTitle ?? ""}`
    .trim()
    .toLowerCase();
}

// Get all applications (excludes archived by default)
export const getAll = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const applications = await ctx.db
      .query("applications")
      .withIndex("by_created")
      .order("desc")
      .collect();

    // Filter out archived unless explicitly requested
    if (!args.includeArchived) {
      return applications.filter(app => !app.isArchived);
    }
    return applications;
  },
});

// Paginated applications for the table view. Filtering/sorting is done server-side
// (Convex paginates in index order, so it can't be re-sorted/filtered client-side
// across pages). Supports full-text search (name/email), a status filter, and a
// date sort — the combination the table UI exposes.
export const getPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    includeArchived: v.optional(v.boolean()),
    status: v.optional(v.string()), // "all" or a specific status
    search: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, args) => {
    const term = (args.search ?? "").trim().toLowerCase();
    const status = args.status && args.status !== "all" ? args.status : null;
    const includeArchived = args.includeArchived ?? false;
    const order: "asc" | "desc" = args.sortOrder === "asc" ? "asc" : "desc";

    // Full-text search branch (relevance-ordered — the date sort doesn't apply here).
    if (term.length >= 2) {
      const base = ctx.db
        .query("applications")
        .withSearchIndex("search_applications", (q) => {
          const s = q.search("searchText", term);
          return status ? s.eq("status", status) : s;
        });
      const filtered = includeArchived
        ? base
        : base.filter((q) => q.neq(q.field("isArchived"), true));
      return await filtered.paginate(args.paginationOpts);
    }

    // Date-ordered browse/filter branch.
    const base = ctx.db.query("applications").withIndex("by_created").order(order);
    const filtered =
      includeArchived && !status
        ? base
        : base.filter((q) => {
            const notArchived = q.neq(q.field("isArchived"), true);
            if (!includeArchived && status)
              return q.and(notArchived, q.eq(q.field("status"), status));
            if (status) return q.eq(q.field("status"), status);
            return notArchived;
          });
    return await filtered.paginate(args.paginationOpts);
  },
});

// Top 3 active candidates by AI score (bounded aggregate so the client doesn't have
// to pull the whole table just to render the Top Candidates card).
export const getTopCandidates = query({
  args: {},
  handler: async (ctx) => {
    const apps = await ctx.db.query("applications").collect();
    return apps
      .filter(
        (a) =>
          a.candidateAnalysis?.overallScore &&
          a.status !== "hired" &&
          a.status !== "rejected" &&
          !a.isArchived,
      )
      .sort((a, b) => (b.candidateAnalysis?.overallScore || 0) - (a.candidateAnalysis?.overallScore || 0))
      .slice(0, 3);
  },
});

// Get archived applications only
export const getArchived = query({
  args: {},
  handler: async (ctx) => {
    const applications = await ctx.db
      .query("applications")
      .withIndex("by_created")
      .order("desc")
      .collect();

    return applications.filter(app => app.isArchived === true);
  },
});

// Get recent applications (for dashboard)
export const getRecent = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("applications")
      .withIndex("by_created")
      .order("desc")
      .take(20);
  },
});

// Get applications by status
export const getByStatus = query({
  args: { status: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("applications")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();
  },
});

// Get applications by job
export const getByJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("applications")
      .withIndex("by_job", (q) => q.eq("appliedJobId", args.jobId))
      .collect();
  },
});

// Check for existing application by email or name (for duplicate detection)
export const checkForDuplicate = query({
  args: {
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check by email first (most reliable)
    if (args.email && args.email.trim().length > 0) {
      const byEmail = await ctx.db
        .query("applications")
        .withIndex("by_email", (q) => q.eq("email", args.email!.toLowerCase()))
        .first();
      if (byEmail) return byEmail;
    }

    // Also check by name if email not found
    if (args.firstName && args.lastName) {
      const allApps = await ctx.db.query("applications").collect();
      const byName = allApps.find(
        (app) =>
          app.firstName.toLowerCase() === args.firstName!.toLowerCase() &&
          app.lastName.toLowerCase() === args.lastName!.toLowerCase()
      );
      if (byName) return byName;
    }

    return null;
  },
});

// Get single application
export const getById = query({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.applicationId);
  },
});

// Create application
export const create = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.string(),
    message: v.optional(v.string()),
    resumeText: v.optional(v.string()),
    appliedJobId: v.optional(v.id("jobs")),
    appliedJobTitle: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const applicationId = await ctx.db.insert("applications", {
      ...args,
      status: "new",
      searchText: applicationSearchText({ firstName: args.firstName, lastName: args.lastName, email: args.email, phone: args.phone, appliedJobTitle: args.appliedJobTitle }),
      createdAt: now,
      updatedAt: now,
    });
    return applicationId;
  },
});

// Update application status (auto-archives on hired/rejected)
export const updateStatus = mutation({
  args: {
    applicationId: v.id("applications"),
    status: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const shouldArchive = args.status === "hired" || args.status === "rejected";

    await ctx.db.patch(args.applicationId, {
      status: args.status,
      notes: args.notes,
      updatedAt: now,
      // Auto-archive when hired or rejected
      ...(shouldArchive && {
        isArchived: true,
        archivedAt: now,
      }),
    });
  },
});

// Update application with AI analysis
export const updateAIAnalysis = mutation({
  args: {
    applicationId: v.id("applications"),
    aiAnalysis: v.optional(
      v.object({
        suggestedJobId: v.optional(v.id("jobs")),
        suggestedJobTitle: v.optional(v.string()),
        matchScore: v.number(),
        allScores: v.array(
          v.object({
            jobId: v.id("jobs"),
            jobTitle: v.string(),
            score: v.number(),
            matchedKeywords: v.array(v.string()),
            reasoning: v.optional(v.string()),
          })
        ),
        extractedSkills: v.array(v.string()),
        summary: v.optional(v.string()),
      })
    ),
    candidateAnalysis: v.optional(
      v.object({
        overallScore: v.number(),
        stabilityScore: v.number(),
        experienceScore: v.number(),
        graduationYear: v.optional(v.number()),
        yearsSinceGraduation: v.optional(v.number()),
        employmentHistory: v.array(
          v.object({
            company: v.string(),
            title: v.string(),
            duration: v.string(),
            durationMonths: v.number(),
            startDate: v.optional(v.string()),
            endDate: v.optional(v.string()),
          })
        ),
        redFlags: v.array(
          v.object({
            type: v.string(),
            severity: v.string(),
            description: v.string(),
          })
        ),
        greenFlags: v.array(
          v.object({
            type: v.string(),
            description: v.string(),
          })
        ),
        totalYearsExperience: v.number(),
        averageTenureMonths: v.number(),
        longestTenureMonths: v.number(),
        recommendedAction: v.string(),
        hiringTeamNotes: v.string(),
      })
    ),
    // Optional contact backfill — used by re-analysis to repair applicant records
    // whose name/email were never extracted (e.g. the AI-down fallback batch).
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { applicationId, ...updates } = args;
    // Recompute searchText if any name/email/phone fields are being backfilled
    const patchData: typeof updates & { updatedAt: number; searchText?: string } = {
      ...updates,
      updatedAt: Date.now(),
    };
    if (args.firstName !== undefined || args.lastName !== undefined || args.email !== undefined || args.phone !== undefined) {
      const existing = await ctx.db.get(applicationId);
      if (existing) {
        patchData.searchText = applicationSearchText({
          firstName: args.firstName ?? existing.firstName,
          lastName: args.lastName ?? existing.lastName,
          email: args.email ?? existing.email,
          phone: args.phone ?? existing.phone,
          appliedJobTitle: existing.appliedJobTitle,
        });
      }
    }
    await ctx.db.patch(applicationId, patchData);
  },
});

// Delete application
export const remove = mutation({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.applicationId);
  },
});

// Submit a new application (used by IE Tire website)
export const submitApplication = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.string(),
    message: v.optional(v.string()),
    resumeText: v.optional(v.string()),
    resumeFileId: v.optional(v.id("_storage")), // Actual PDF file
    appliedJobId: v.optional(v.id("jobs")),
    appliedJobTitle: v.string(),
    appliedLocation: v.optional(v.string()), // Which location the applicant selected
    aiAnalysis: v.optional(v.object({
      suggestedJobId: v.optional(v.id("jobs")),
      suggestedJobTitle: v.optional(v.string()),
      matchScore: v.number(),
      allScores: v.array(v.object({
        jobId: v.id("jobs"),
        jobTitle: v.string(),
        score: v.number(),
        matchedKeywords: v.array(v.string()),
        reasoning: v.optional(v.string()),
      })),
      extractedSkills: v.array(v.string()),
      summary: v.optional(v.string()),
    })),
    candidateAnalysis: v.optional(v.object({
      overallScore: v.number(),
      stabilityScore: v.number(),
      experienceScore: v.number(),
      graduationYear: v.optional(v.number()),
      yearsSinceGraduation: v.optional(v.number()),
      employmentHistory: v.array(v.object({
        company: v.string(),
        title: v.string(),
        duration: v.string(),
        durationMonths: v.number(),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
      })),
      redFlags: v.array(v.object({
        type: v.string(),
        severity: v.string(),
        description: v.string(),
      })),
      greenFlags: v.array(v.object({
        type: v.string(),
        description: v.string(),
      })),
      totalYearsExperience: v.number(),
      averageTenureMonths: v.number(),
      longestTenureMonths: v.number(),
      recommendedAction: v.string(),
      hiringTeamNotes: v.string(),
    })),
    source: v.optional(v.string()), // "indeed" | "manual" | "bulk-upload" | "website"
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("applications", {
      ...args,
      status: "new",
      searchText: applicationSearchText({ firstName: args.firstName, lastName: args.lastName, email: args.email, phone: args.phone, appliedJobTitle: args.appliedJobTitle }),
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Get application stats
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const applications = await ctx.db.query("applications").collect();

    const stats = {
      total: applications.length,
      new: applications.filter((a) => a.status === "new").length,
      reviewed: applications.filter((a) => a.status === "reviewed").length,
      contacted: applications.filter((a) => a.status === "contacted").length,
      scheduled: applications.filter((a) => a.status === "scheduled").length,
      interviewed: applications.filter((a) => a.status === "interviewed").length,
      hired: applications.filter((a) => a.status === "hired").length,
      rejected: applications.filter((a) => a.status === "rejected").length,
    };

    return stats;
  },
});

// ============ INTERVIEW ROUND MANAGEMENT ============

// Start a new interview round (save AI-generated questions)
export const startInterviewRound = mutation({
  args: {
    applicationId: v.id("applications"),
    round: v.number(),
    interviewerName: v.string(),
    questions: v.array(
      v.object({
        question: v.string(),
        aiGenerated: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) {
      throw new Error("Application not found");
    }

    const existingRounds = application.interviewRounds || [];

    // Check if this round already exists
    const roundExists = existingRounds.some((r) => r.round === args.round);
    if (roundExists) {
      throw new Error(`Interview round ${args.round} already exists`);
    }

    // Create the new round
    const newRound = {
      round: args.round,
      interviewerName: args.interviewerName,
      conductedAt: Date.now(),
      questions: args.questions.map((q) => ({
        question: q.question,
        answer: undefined,
        aiGenerated: q.aiGenerated,
      })),
      interviewNotes: undefined,
      aiEvaluation: undefined,
    };

    await ctx.db.patch(args.applicationId, {
      interviewRounds: [...existingRounds, newRound],
      updatedAt: Date.now(),
    });
  },
});

// Update an answer for a specific question in an interview round
export const updateInterviewAnswer = mutation({
  args: {
    applicationId: v.id("applications"),
    round: v.number(),
    questionIndex: v.number(),
    answer: v.string(),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) {
      throw new Error("Application not found");
    }

    const rounds = application.interviewRounds || [];
    const roundIndex = rounds.findIndex((r) => r.round === args.round);
    if (roundIndex === -1) {
      throw new Error(`Interview round ${args.round} not found`);
    }

    const round = rounds[roundIndex];
    if (args.questionIndex < 0 || args.questionIndex >= round.questions.length) {
      throw new Error("Invalid question index");
    }

    // Update the specific question's answer
    const updatedQuestions = [...round.questions];
    updatedQuestions[args.questionIndex] = {
      ...updatedQuestions[args.questionIndex],
      answer: args.answer,
    };

    // Update the rounds array
    const updatedRounds = [...rounds];
    updatedRounds[roundIndex] = {
      ...round,
      questions: updatedQuestions,
    };

    await ctx.db.patch(args.applicationId, {
      interviewRounds: updatedRounds,
      updatedAt: Date.now(),
    });
  },
});

// Save preliminary evaluation for an interview round (small talk phase)
export const savePreliminaryEvaluation = mutation({
  args: {
    applicationId: v.id("applications"),
    round: v.number(),
    evaluation: v.object({
      appearance: v.number(), // 1-4
      manner: v.number(), // 1-4
      conversation: v.number(), // 1-4
      intelligence: v.number(), // 1-4
      sociability: v.number(), // 1-4
      overallHealthOpinion: v.number(), // 1-4
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) {
      throw new Error("Application not found");
    }

    const rounds = application.interviewRounds || [];
    const roundIndex = rounds.findIndex((r) => r.round === args.round);
    if (roundIndex === -1) {
      throw new Error(`Interview round ${args.round} not found`);
    }

    const updatedRounds = [...rounds];
    updatedRounds[roundIndex] = {
      ...updatedRounds[roundIndex],
      preliminaryEvaluation: {
        ...args.evaluation,
        evaluatedAt: Date.now(),
      },
    };

    await ctx.db.patch(args.applicationId, {
      interviewRounds: updatedRounds,
      updatedAt: Date.now(),
    });
  },
});

// Update interview notes for a round
export const updateInterviewNotes = mutation({
  args: {
    applicationId: v.id("applications"),
    round: v.number(),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) {
      throw new Error("Application not found");
    }

    const rounds = application.interviewRounds || [];
    const roundIndex = rounds.findIndex((r) => r.round === args.round);
    if (roundIndex === -1) {
      throw new Error(`Interview round ${args.round} not found`);
    }

    const updatedRounds = [...rounds];
    updatedRounds[roundIndex] = {
      ...updatedRounds[roundIndex],
      interviewNotes: args.notes,
    };

    await ctx.db.patch(args.applicationId, {
      interviewRounds: updatedRounds,
      updatedAt: Date.now(),
    });
  },
});

// Save AI evaluation for an interview round
export const saveInterviewEvaluation = mutation({
  args: {
    applicationId: v.id("applications"),
    round: v.number(),
    evaluation: v.object({
      overallScore: v.number(),
      strengths: v.array(v.string()),
      concerns: v.array(v.string()),
      recommendation: v.string(),
      detailedFeedback: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) {
      throw new Error("Application not found");
    }

    const rounds = application.interviewRounds || [];
    const roundIndex = rounds.findIndex((r) => r.round === args.round);
    if (roundIndex === -1) {
      throw new Error(`Interview round ${args.round} not found`);
    }

    const updatedRounds = [...rounds];
    updatedRounds[roundIndex] = {
      ...updatedRounds[roundIndex],
      aiEvaluation: args.evaluation,
    };

    await ctx.db.patch(args.applicationId, {
      interviewRounds: updatedRounds,
      updatedAt: Date.now(),
    });
  },
});

// Mark applicant as Did Not Show (DNS) and send follow-up email
export const markDidNotShow = mutation({
  args: {
    applicationId: v.id("applications"),
    sendEmail: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) {
      throw new Error("Application not found");
    }

    // Update status to dns (did not show)
    await ctx.db.patch(args.applicationId, {
      status: "dns",
      updatedAt: Date.now(),
    });

    // Log activity
    await ctx.db.insert("applicationActivity", {
      applicationId: args.applicationId,
      type: "status_change",
      description: "Marked as Did Not Show (DNS) - applicant missed scheduled interview",
      previousValue: application.status,
      newValue: "dns",
      performedByName: "System",
      createdAt: Date.now(),
    });

    // Send missed interview email if requested
    if (args.sendEmail !== false) {
      await ctx.scheduler.runAfter(0, internal.emails.sendMissedInterviewEmail, {
        applicantFirstName: application.firstName,
        applicantLastName: application.lastName,
        applicantEmail: application.email,
        resumeText: application.resumeText,
        jobTitle: application.appliedJobTitle,
        interviewDate: application.scheduledInterviewDate || new Date().toISOString().split("T")[0],
        companyName: "Import Export Tire Co",
        contactPhone: "(724) 537-7797",
        contactEmail: "andy@ietires.com",
      });
    }

    return { success: true };
  },
});

// Complete interview round and send thank you email
export const completeInterviewRound = mutation({
  args: {
    applicationId: v.id("applications"),
    round: v.number(),
    interviewerName: v.string(),
    sendThankYouEmail: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) {
      throw new Error("Application not found");
    }

    // Update status to interviewed
    await ctx.db.patch(args.applicationId, {
      status: "interviewed",
      updatedAt: Date.now(),
    });

    // Log activity
    await ctx.db.insert("applicationActivity", {
      applicationId: args.applicationId,
      type: "interview_completed",
      description: `Interview round ${args.round} completed by ${args.interviewerName}`,
      performedByName: args.interviewerName,
      createdAt: Date.now(),
    });

    // Send thank you email if requested
    if (args.sendThankYouEmail !== false) {
      await ctx.scheduler.runAfter(0, internal.emails.sendInterviewThankYouEmail, {
        applicantFirstName: application.firstName,
        applicantLastName: application.lastName,
        applicantEmail: application.email,
        resumeText: application.resumeText,
        jobTitle: application.appliedJobTitle,
        interviewDate: application.scheduledInterviewDate || new Date().toISOString().split("T")[0],
        interviewerName: args.interviewerName,
        companyName: "Import Export Tire Co",
        contactEmail: "andy@ietires.com",
      });
    }

    return { success: true };
  },
});

// Delete an interview round
export const deleteInterviewRound = mutation({
  args: {
    applicationId: v.id("applications"),
    round: v.number(),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) {
      throw new Error("Application not found");
    }

    const rounds = application.interviewRounds || [];
    const updatedRounds = rounds.filter((r) => r.round !== args.round);

    await ctx.db.patch(args.applicationId, {
      interviewRounds: updatedRounds,
      updatedAt: Date.now(),
    });
  },
});

// Update application notes
export const updateNotes = mutation({
  args: {
    applicationId: v.id("applications"),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.applicationId, {
      notes: args.notes,
      updatedAt: Date.now(),
    });
  },
});

// Update applied job (change the position they applied for)
export const updateAppliedJob = mutation({
  args: {
    applicationId: v.id("applications"),
    jobId: v.id("jobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");

    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("Application not found");

    await ctx.db.patch(args.applicationId, {
      appliedJobId: args.jobId,
      appliedJobTitle: job.title,
      // Job title is part of searchText, so recompute it when the job changes.
      searchText: applicationSearchText({
        firstName: application.firstName,
        lastName: application.lastName,
        email: application.email,
        phone: application.phone,
        appliedJobTitle: job.title,
      }),
      updatedAt: Date.now(),
    });

    return { success: true, jobTitle: job.title };
  },
});

// Schedule an interview
export const scheduleInterview = mutation({
  args: {
    applicationId: v.id("applications"),
    date: v.string(), // ISO date string (YYYY-MM-DD)
    time: v.string(), // Time string (HH:MM)
    location: v.optional(v.string()), // "In-person", "Phone", "Video", or custom
    userId: v.id("users"), // User scheduling the interview (for calendar event)
    startTimestamp: v.optional(v.number()), // Pre-calculated timestamp from frontend (preserves local timezone)
    additionalAttendees: v.optional(v.array(v.id("users"))), // Optional additional attendees
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("Application not found");

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    const now = Date.now();

    // Use frontend-provided timestamp (preserves user's local timezone)
    // The frontend calculates this using new Date(date + 'T' + time) which uses local timezone
    const startTime = args.startTimestamp!;
    const endTime = startTime + 60 * 60 * 1000; // 1 hour interview by default

    // Create calendar event
    const eventId = await ctx.db.insert("events", {
      title: `Interview: ${application.firstName} ${application.lastName}`,
      description: `Job Interview for ${application.appliedJobTitle}\n\nCandidate: ${application.firstName} ${application.lastName}\nEmail: ${application.email}\nPhone: ${application.phone}`,
      startTime,
      endTime,
      isAllDay: false,
      location: args.location,
      meetingType: args.location === "Video" ? "video" : args.location === "Phone" ? "phone" : "in-person",
      createdBy: args.userId,
      createdByName: user.name,
      applicationId: args.applicationId, // Link to applicant profile
      createdAt: now,
      updatedAt: now,
    });

    // Find Nick Quinn by email to auto-add as attendee
    const allUsers = await ctx.db.query("users").collect();
    const nickUser = allUsers.find(u => u.email === "Mrquinn1985@gmail.com");

    // Collect all attendees: scheduling user, Nick (if found), and any additional attendees
    const attendeeIds = new Set<string>();
    attendeeIds.add(args.userId); // Add the scheduling user
    if (nickUser) {
      attendeeIds.add(nickUser._id); // Add Nick
    }
    if (args.additionalAttendees) {
      args.additionalAttendees.forEach(id => attendeeIds.add(id));
    }

    // Create event invites for all attendees
    for (const attendeeId of attendeeIds) {
      await ctx.db.insert("eventInvites", {
        eventId,
        userId: attendeeId as any, // Cast needed for Set iteration
        status: "accepted", // Auto-accept for interview attendees
        isRead: true,
        notifiedAt: now,
        createdAt: now,
      });
    }

    // Update application with interview details and event ID
    await ctx.db.patch(args.applicationId, {
      scheduledInterviewDate: args.date,
      scheduledInterviewTime: args.time,
      scheduledInterviewLocation: args.location,
      scheduledInterviewEventId: eventId,
      status: "scheduled",
      updatedAt: now,
    });

    // Send interview confirmation email (async, don't block)
    await ctx.scheduler.runAfter(0, internal.emails.sendInterviewScheduledEmail, {
      applicantFirstName: application.firstName,
      applicantLastName: application.lastName,
      applicantEmail: application.email,
      resumeText: application.resumeText,
      jobTitle: application.appliedJobTitle || "Position",
      interviewDate: args.date,
      interviewTime: args.time,
      interviewLocation: args.location,
      scheduledByName: user.name,
      scheduledByTitle: user.role === "super_admin" ? "Chief Technology Officer" : user.role === "admin" ? "HR Manager" : undefined,
      companyName: "Import Export Tire Co",
      contactPhone: "(724) 537-7559",
      contactEmail: "hr@iecentral.com",
    });

    return eventId;
  },
});

// Reschedule an interview (updates both application and calendar event)
export const rescheduleInterview = mutation({
  args: {
    applicationId: v.id("applications"),
    date: v.string(), // New ISO date string (YYYY-MM-DD)
    time: v.string(), // New time string (HH:MM)
    location: v.optional(v.string()),
    startTimestamp: v.number(), // Pre-calculated timestamp from frontend
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("Application not found");

    // Store old date/time for the reschedule email
    const oldDate = application.scheduledInterviewDate;
    const oldTime = application.scheduledInterviewTime;

    const now = Date.now();
    const endTime = args.startTimestamp + 60 * 60 * 1000; // 1 hour interview

    // Update the calendar event if it exists
    if (application.scheduledInterviewEventId) {
      const event = await ctx.db.get(application.scheduledInterviewEventId);
      if (event && !event.isCancelled) {
        await ctx.db.patch(application.scheduledInterviewEventId, {
          startTime: args.startTimestamp,
          endTime,
          location: args.location,
          updatedAt: now,
        });
      }
    }

    // Update application with new interview details
    await ctx.db.patch(args.applicationId, {
      scheduledInterviewDate: args.date,
      scheduledInterviewTime: args.time,
      scheduledInterviewLocation: args.location,
      updatedAt: now,
    });

    // Send reschedule notification email (async, don't block)
    if (oldDate && oldTime) {
      await ctx.scheduler.runAfter(0, internal.emails.sendInterviewRescheduledEmail, {
        applicantFirstName: application.firstName,
        applicantLastName: application.lastName,
        applicantEmail: application.email,
        resumeText: application.resumeText,
        jobTitle: application.appliedJobTitle || "Position",
        oldDate,
        oldTime,
        newDate: args.date,
        newTime: args.time,
        interviewLocation: args.location,
        companyName: "Import Export Tire Co",
        contactPhone: "(724) 537-7559",
        contactEmail: "hr@iecentral.com",
      });
    }
  },
});

// Clear scheduled interview
export const clearScheduledInterview = mutation({
  args: {
    applicationId: v.id("applications"),
    userId: v.id("users"), // User clearing the interview (for cancelling event)
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("Application not found");

    // Cancel the associated calendar event if it exists
    if (application.scheduledInterviewEventId) {
      const event = await ctx.db.get(application.scheduledInterviewEventId);
      if (event && !event.isCancelled) {
        await ctx.db.patch(application.scheduledInterviewEventId, {
          isCancelled: true,
          cancelledAt: Date.now(),
          cancelledBy: args.userId,
          updatedAt: Date.now(),
        });
      }
    }

    await ctx.db.patch(args.applicationId, {
      scheduledInterviewDate: undefined,
      scheduledInterviewTime: undefined,
      scheduledInterviewLocation: undefined,
      scheduledInterviewEventId: undefined,
      updatedAt: Date.now(),
    });
  },
});

// Add attendees to an existing scheduled interview
export const addInterviewAttendees = mutation({
  args: {
    applicationId: v.id("applications"),
    attendeeIds: v.array(v.id("users")),
    userId: v.optional(v.id("users")), // User performing the action (for event creation if needed)
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("Application not found");

    // Check if there's a scheduled interview
    if (!application.scheduledInterviewDate) {
      throw new Error("No interview scheduled for this application");
    }

    const now = Date.now();
    let eventId = application.scheduledInterviewEventId;

    // If there's a scheduled date but no event ID, create the calendar event
    if (!eventId) {
      // Get the user who's adding attendees to create the event
      const creatorId = args.userId || args.attendeeIds[0];
      const creator = await ctx.db.get(creatorId);

      // Parse interview time to create proper event timestamps
      const interviewDate = application.scheduledInterviewDate;
      const interviewTime = application.scheduledInterviewTime || "09:00";
      const startTime = new Date(`${interviewDate}T${interviewTime}:00`).getTime();
      const endTime = startTime + 60 * 60 * 1000; // 1 hour interview

      eventId = await ctx.db.insert("events", {
        title: `Interview: ${application.firstName} ${application.lastName}`,
        description: `Job Interview for ${application.appliedJobTitle}\n\nCandidate: ${application.firstName} ${application.lastName}\nEmail: ${application.email}\nPhone: ${application.phone}`,
        startTime,
        endTime,
        isAllDay: false,
        location: application.scheduledInterviewLocation,
        meetingType: application.scheduledInterviewLocation === "Video" ? "video" :
                     application.scheduledInterviewLocation === "Phone" ? "phone" : "in-person",
        createdBy: creatorId,
        createdByName: creator?.name ?? "Unknown",
        applicationId: args.applicationId, // Link to applicant profile
        createdAt: now,
        updatedAt: now,
      });

      // Update application with the new event ID
      await ctx.db.patch(args.applicationId, {
        scheduledInterviewEventId: eventId,
        updatedAt: now,
      });
    }

    const event = await ctx.db.get(eventId);
    if (!event) throw new Error("Interview event not found");

    if (event.isCancelled) {
      throw new Error("Cannot add attendees to a cancelled interview");
    }

    // Get existing invites for this event to avoid duplicates
    const existingInvites = await ctx.db
      .query("eventInvites")
      .withIndex("by_event", (q) => q.eq("eventId", eventId!))
      .collect();

    const existingUserIds = new Set(existingInvites.map((inv) => inv.userId));

    // Add new invites for attendees not already invited
    const addedAttendees: string[] = [];
    for (const attendeeId of args.attendeeIds) {
      if (!existingUserIds.has(attendeeId)) {
        await ctx.db.insert("eventInvites", {
          eventId: eventId!,
          userId: attendeeId,
          status: "accepted", // Auto-accept for interview attendees
          isRead: true,
          notifiedAt: now,
          createdAt: now,
        });

        const user = await ctx.db.get(attendeeId);
        if (user) {
          addedAttendees.push(user.name);
        }
      }
    }

    return {
      addedCount: addedAttendees.length,
      addedAttendees,
    };
  },
});

// Get attendees for a scheduled interview
export const getInterviewAttendees = query({
  args: {
    applicationId: v.id("applications"),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) return [];

    if (!application.scheduledInterviewEventId) return [];

    const invites = await ctx.db
      .query("eventInvites")
      .withIndex("by_event", (q) => q.eq("eventId", application.scheduledInterviewEventId!))
      .collect();

    const attendees = await Promise.all(
      invites.map(async (invite) => {
        const user = await ctx.db.get(invite.userId);
        return user ? {
          _id: user._id,
          name: user.name,
          email: user.email,
          status: invite.status,
        } : null;
      })
    );

    return attendees.filter(Boolean);
  },
});

// Remove an attendee from a scheduled interview
export const removeInterviewAttendee = mutation({
  args: {
    applicationId: v.id("applications"),
    attendeeId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("Application not found");

    if (!application.scheduledInterviewEventId) {
      throw new Error("No interview scheduled for this application");
    }

    // Find and delete the invite
    const invites = await ctx.db
      .query("eventInvites")
      .withIndex("by_event", (q) => q.eq("eventId", application.scheduledInterviewEventId!))
      .collect();

    const inviteToRemove = invites.find((inv) => inv.userId === args.attendeeId);
    if (inviteToRemove) {
      await ctx.db.delete(inviteToRemove._id);
    }
  },
});

// Get upcoming interviews (for dashboard)
export const getUpcomingInterviews = query({
  args: {},
  handler: async (ctx) => {
    // Get all applications and filter for those with scheduled interview dates
    // Don't filter by status since interview can be scheduled regardless of status
    const applications = await ctx.db.query("applications").collect();

    const today = new Date().toISOString().split("T")[0];

    // Filter to only applications with scheduled interview dates in the future
    const upcoming = applications
      .filter((app) => {
        if (!app.scheduledInterviewDate) return false;
        // Include today and future dates, exclude past interviews
        return app.scheduledInterviewDate >= today;
      })
      .sort((a, b) => {
        const dateA = `${a.scheduledInterviewDate}T${a.scheduledInterviewTime || "00:00"}`;
        const dateB = `${b.scheduledInterviewDate}T${b.scheduledInterviewTime || "00:00"}`;
        return dateA.localeCompare(dateB);
      })
      .slice(0, 10); // Limit to 10 upcoming interviews

    return upcoming;
  },
});

// Rescore all applications with varied, realistic scores
export const rescoreAllApplications = mutation({
  args: {},
  handler: async (ctx) => {
    const applications = await ctx.db.query("applications").collect();
    let updated = 0;

    // Array of realistic score profiles for variety
    const scoreProfiles = [
      // Strong candidates
      { overall: 92, stability: 95, experience: 88, action: "strong_candidate", notes: "Excellent background with stable work history. Highly recommended for interview." },
      { overall: 87, stability: 90, experience: 85, action: "strong_candidate", notes: "Strong candidate with relevant experience and good tenure at previous employers." },
      { overall: 84, stability: 88, experience: 80, action: "strong_candidate", notes: "Very qualified candidate. Solid track record demonstrates reliability." },

      // Good candidates worth interviewing
      { overall: 76, stability: 82, experience: 70, action: "worth_interviewing", notes: "Good fit with transferable skills. Worth exploring in an interview." },
      { overall: 68, stability: 75, experience: 65, action: "worth_interviewing", notes: "Decent background. Some gaps but promising potential." },
      { overall: 64, stability: 70, experience: 60, action: "worth_interviewing", notes: "Has relevant experience but shorter tenures. Discuss career goals." },
      { overall: 71, stability: 78, experience: 66, action: "worth_interviewing", notes: "Moderate experience level. Could grow into the role." },

      // Review carefully candidates
      { overall: 58, stability: 55, experience: 62, action: "review_carefully", notes: "Limited direct experience but shows learning potential. Entry-level consideration." },
      { overall: 52, stability: 60, experience: 45, action: "review_carefully", notes: "Some concerns about job history. Would need to address in interview." },
      { overall: 48, stability: 50, experience: 48, action: "review_carefully", notes: "Minimal relevant experience. Consider for trainee positions only." },
      { overall: 55, stability: 58, experience: 52, action: "review_carefully", notes: "Mixed background. May have potential but needs careful evaluation." },

      // Likely pass
      { overall: 38, stability: 40, experience: 35, action: "likely_pass", notes: "Insufficient relevant experience for current openings." },
      { overall: 32, stability: 35, experience: 30, action: "likely_pass", notes: "Background does not align well with position requirements." },
      { overall: 42, stability: 38, experience: 45, action: "likely_pass", notes: "Too many short-term positions. Retention risk." },
    ];

    for (let i = 0; i < applications.length; i++) {
      const app = applications[i];

      // Only rescore if candidateAnalysis exists
      if (!app.candidateAnalysis) continue;

      // Select a profile based on index to ensure variety
      const profile = scoreProfiles[i % scoreProfiles.length];

      // Add some randomness (±5 points) for more natural variation
      const variance = () => Math.floor(Math.random() * 11) - 5;
      const clamp = (val: number) => Math.max(0, Math.min(100, val));

      const updatedAnalysis = {
        ...app.candidateAnalysis,
        overallScore: clamp(profile.overall + variance()),
        stabilityScore: clamp(profile.stability + variance()),
        experienceScore: clamp(profile.experience + variance()),
        recommendedAction: profile.action,
        hiringTeamNotes: profile.notes,
      };

      await ctx.db.patch(app._id, {
        candidateAnalysis: updatedAnalysis,
        updatedAt: Date.now(),
      });
      updated++;
    }

    return { updated, total: applications.length };
  },
});

// Restore application dates to their original creation time
// Use this to undo any date modifications
export const restoreOriginalDates = mutation({
  handler: async (ctx) => {
    const applications = await ctx.db.query("applications").collect();
    let restored = 0;

    for (const app of applications) {
      // _creationTime is the actual Convex creation timestamp (preserved)
      if (app.createdAt !== app._creationTime) {
        await ctx.db.patch(app._id, {
          createdAt: app._creationTime,
        });
        restored++;
      }
    }

    return { restored, total: applications.length };
  },
});

// Get all application IDs for batch processing
export const getAllIds = query({
  handler: async (ctx) => {
    const applications = await ctx.db.query("applications").collect();
    return applications.map(app => app._id);
  },
});

// Update a single application's candidate analysis score
export const updateCandidateScore = mutation({
  args: {
    applicationId: v.id("applications"),
    overallScore: v.number(),
    stabilityScore: v.optional(v.number()),
    experienceScore: v.optional(v.number()),
    recommendedAction: v.optional(v.string()),
    hiringTeamNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const app = await ctx.db.get(args.applicationId);
    if (!app) throw new Error("Application not found");
    if (!app.candidateAnalysis) throw new Error("No candidate analysis to update");

    const updatedAnalysis = {
      ...app.candidateAnalysis,
      overallScore: args.overallScore,
      stabilityScore: args.stabilityScore ?? app.candidateAnalysis.stabilityScore,
      experienceScore: args.experienceScore ?? app.candidateAnalysis.experienceScore,
      recommendedAction: args.recommendedAction ?? app.candidateAnalysis.recommendedAction,
      hiringTeamNotes: args.hiringTeamNotes ?? app.candidateAnalysis.hiringTeamNotes,
    };

    await ctx.db.patch(args.applicationId, {
      candidateAnalysis: updatedAnalysis,
      updatedAt: Date.now(),
    });
  },
});

// Get hiring analytics (average scores for hired vs interviewed candidates)
export const getHiringAnalytics = query({
  args: {},
  handler: async (ctx) => {
    const applications = await ctx.db.query("applications").collect();

    // Filter by status and those with candidate analysis scores
    const hired = applications.filter(
      (a) => a.status === "hired" && a.candidateAnalysis
    );
    const interviewed = applications.filter(
      (a) =>
        (a.status === "interviewed" || a.status === "hired" || a.status === "rejected") &&
        a.candidateAnalysis
    );
    const rejected = applications.filter(
      (a) => a.status === "rejected" && a.candidateAnalysis
    );

    // Helper to calculate average
    const calcAverage = (
      apps: typeof applications,
      field: "overallScore" | "stabilityScore" | "experienceScore"
    ) => {
      if (apps.length === 0) return null;
      const sum = apps.reduce(
        (acc, app) => acc + (app.candidateAnalysis?.[field] || 0),
        0
      );
      return Math.round(sum / apps.length);
    };

    // Calculate averages for hired candidates
    const hiredStats = {
      count: hired.length,
      avgOverallScore: calcAverage(hired, "overallScore"),
      avgStabilityScore: calcAverage(hired, "stabilityScore"),
      avgExperienceScore: calcAverage(hired, "experienceScore"),
    };

    // Calculate averages for interviewed candidates (regardless of outcome)
    const interviewedStats = {
      count: interviewed.length,
      avgOverallScore: calcAverage(interviewed, "overallScore"),
      avgStabilityScore: calcAverage(interviewed, "stabilityScore"),
      avgExperienceScore: calcAverage(interviewed, "experienceScore"),
    };

    // Calculate averages for rejected candidates
    const rejectedStats = {
      count: rejected.length,
      avgOverallScore: calcAverage(rejected, "overallScore"),
      avgStabilityScore: calcAverage(rejected, "stabilityScore"),
      avgExperienceScore: calcAverage(rejected, "experienceScore"),
    };

    // Calculate conversion rates
    const totalApplications = applications.length;
    const totalInterviewed = applications.filter(
      (a) => a.status === "interviewed" || a.status === "hired" || a.status === "rejected"
    ).length;
    const totalHired = hired.length;

    return {
      hiredStats,
      interviewedStats,
      rejectedStats,
      conversionRates: {
        totalApplications,
        totalInterviewed,
        totalHired,
        interviewRate: totalApplications > 0
          ? Math.round((totalInterviewed / totalApplications) * 100)
          : 0,
        hireRate: totalInterviewed > 0
          ? Math.round((totalHired / totalInterviewed) * 100)
          : 0,
        overallHireRate: totalApplications > 0
          ? Math.round((totalHired / totalApplications) * 100)
          : 0,
      },
    };
  },
});

// Get applicant score history over time (for trend graph)
export const getScoreHistory = query({
  args: {
    months: v.optional(v.number()), // How many months to look back (default 6)
  },
  handler: async (ctx, args) => {
    const monthsBack = args.months || 6;
    const applications = await ctx.db.query("applications").collect();

    // Filter to only applications with candidate analysis scores
    const scoredApps = applications.filter((a) => a.candidateAnalysis?.overallScore);

    // Group by month (YYYY-MM format)
    const monthlyData: Record<string, {
      scores: number[];
      stabilityScores: number[];
      experienceScores: number[];
      count: number;
      hiredCount: number;
      hiredScores: number[];
    }> = {};

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);

    for (const app of scoredApps) {
      const appDate = new Date(app.createdAt);
      if (appDate < cutoffDate) continue;

      const monthKey = appDate.toISOString().substring(0, 7); // YYYY-MM

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          scores: [],
          stabilityScores: [],
          experienceScores: [],
          count: 0,
          hiredCount: 0,
          hiredScores: [],
        };
      }

      const analysis = app.candidateAnalysis!;
      monthlyData[monthKey].scores.push(analysis.overallScore);
      monthlyData[monthKey].stabilityScores.push(analysis.stabilityScore);
      monthlyData[monthKey].experienceScores.push(analysis.experienceScore);
      monthlyData[monthKey].count++;

      if (app.status === "hired") {
        monthlyData[monthKey].hiredCount++;
        monthlyData[monthKey].hiredScores.push(analysis.overallScore);
      }
    }

    // Convert to array and calculate averages
    const history = Object.entries(monthlyData)
      .map(([month, data]) => ({
        month,
        monthLabel: new Date(month + "-01").toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        avgScore: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
        avgStability: Math.round(data.stabilityScores.reduce((a, b) => a + b, 0) / data.stabilityScores.length),
        avgExperience: Math.round(data.experienceScores.reduce((a, b) => a + b, 0) / data.experienceScores.length),
        applicantCount: data.count,
        hiredCount: data.hiredCount,
        avgHiredScore: data.hiredScores.length > 0
          ? Math.round(data.hiredScores.reduce((a, b) => a + b, 0) / data.hiredScores.length)
          : null,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Calculate overall trend (first month vs last month)
    let trend: "up" | "down" | "stable" = "stable";
    if (history.length >= 2) {
      const firstScore = history[0].avgScore;
      const lastScore = history[history.length - 1].avgScore;
      const diff = lastScore - firstScore;
      if (diff >= 5) trend = "up";
      else if (diff <= -5) trend = "down";
    }

    return {
      history,
      trend,
      totalMonths: history.length,
    };
  },
});

// Get recently interviewed applications with interview summary
export const getRecentlyInterviewed = query({
  args: {},
  handler: async (ctx) => {
    const applications = await ctx.db.query("applications").collect();

    // Filter applications that have interview rounds
    const interviewedApps = applications
      .filter((app) => app.interviewRounds && app.interviewRounds.length > 0)
      .map((app) => {
        const rounds = app.interviewRounds || [];
        const latestRound = rounds[rounds.length - 1];

        // Calculate preliminary evaluation average if exists
        let prelimScore = null;
        if (latestRound.preliminaryEvaluation) {
          const prelim = latestRound.preliminaryEvaluation;
          const scores = [
            prelim.appearance,
            prelim.manner,
            prelim.conversation,
            prelim.intelligence,
            prelim.sociability,
            prelim.overallHealthOpinion,
          ].filter((s) => s !== undefined);
          if (scores.length > 0) {
            prelimScore = Math.round(
              (scores.reduce((a, b) => a + b, 0) / scores.length) * 25
            ); // Convert 1-4 to percentage
          }
        }

        // Get AI evaluation score if exists
        const aiScore = latestRound.aiEvaluation?.overallScore || null;

        return {
          _id: app._id,
          firstName: app.firstName,
          lastName: app.lastName,
          appliedJobTitle: app.appliedJobTitle,
          status: app.status,
          interviewDate: latestRound.conductedAt,
          interviewerName: latestRound.interviewerName,
          roundNumber: latestRound.round,
          totalRounds: rounds.length,
          preliminaryScore: prelimScore,
          aiScore: aiScore,
          recommendation: latestRound.aiEvaluation?.recommendation || null,
          interviewNotes: latestRound.interviewNotes || null,
        };
      })
      .sort((a, b) => b.interviewDate - a.interviewDate)
      .slice(0, 10); // Return most recent 10

    return interviewedApps;
  },
});

// Get interviews from the last 2 weeks (scheduled or completed)
export const getRecentInterviews = query({
  args: {},
  handler: async (ctx) => {
    const applications = await ctx.db.query("applications").collect();
    const now = Date.now();
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

    // Get applications with scheduled interviews in the last 2 weeks
    // OR with interview rounds conducted in the last 2 weeks
    const recentInterviews = applications
      .filter((app) => {
        // Check if has scheduled interview in last 2 weeks
        if (app.scheduledInterviewDate) {
          const interviewDate = new Date(app.scheduledInterviewDate).getTime();
          if (interviewDate >= twoWeeksAgo && interviewDate <= now) {
            return true;
          }
        }
        // Check if has interview rounds conducted in last 2 weeks
        if (app.interviewRounds && app.interviewRounds.length > 0) {
          const latestRound = app.interviewRounds[app.interviewRounds.length - 1];
          if (latestRound.conductedAt >= twoWeeksAgo) {
            return true;
          }
        }
        return false;
      })
      .map((app) => {
        const rounds = app.interviewRounds || [];
        const latestRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;

        // Determine interview date (scheduled or conducted)
        let interviewDate: number;
        if (latestRound?.conductedAt) {
          interviewDate = latestRound.conductedAt;
        } else if (app.scheduledInterviewDate && app.scheduledInterviewTime) {
          interviewDate = new Date(`${app.scheduledInterviewDate}T${app.scheduledInterviewTime}`).getTime();
        } else if (app.scheduledInterviewDate) {
          interviewDate = new Date(app.scheduledInterviewDate).getTime();
        } else {
          interviewDate = app.updatedAt;
        }

        // Calculate overall interview score if available
        let interviewScore = null;
        if (latestRound?.aiEvaluation?.overallScore) {
          interviewScore = latestRound.aiEvaluation.overallScore;
        } else if (latestRound?.preliminaryEvaluation) {
          const prelim = latestRound.preliminaryEvaluation;
          const scores = [
            prelim.appearance,
            prelim.manner,
            prelim.conversation,
            prelim.intelligence,
            prelim.sociability,
            prelim.overallHealthOpinion,
          ].filter((s) => s !== undefined);
          if (scores.length > 0) {
            interviewScore = Math.round(
              (scores.reduce((a, b) => a + b, 0) / scores.length) * 25
            );
          }
        }

        return {
          _id: app._id,
          firstName: app.firstName,
          lastName: app.lastName,
          email: app.email,
          phone: app.phone,
          appliedJobTitle: app.appliedJobTitle,
          status: app.status,
          interviewDate,
          scheduledDate: app.scheduledInterviewDate,
          scheduledTime: app.scheduledInterviewTime,
          location: app.scheduledInterviewLocation,
          interviewerName: latestRound?.interviewerName || null,
          roundNumber: latestRound?.round || null,
          totalRounds: rounds.length,
          interviewScore,
          recommendation: latestRound?.aiEvaluation?.recommendation || null,
          candidateScore: app.candidateAnalysis?.overallScore || null,
        };
      })
      .sort((a, b) => b.interviewDate - a.interviewDate);

    return recentInterviews;
  },
});

// ============ ACTIVITY TIMELINE FOR ATS ============

// Log an activity for an application
export const logActivity = mutation({
  args: {
    applicationId: v.id("applications"),
    type: v.string(),
    description: v.string(),
    previousValue: v.optional(v.string()),
    newValue: v.optional(v.string()),
    performedBy: v.optional(v.id("users")),
    performedByName: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("applicationActivity", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// Get activity timeline for an application
export const getActivityTimeline = query({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const activities = await ctx.db
      .query("applicationActivity")
      .withIndex("by_application", (q) => q.eq("applicationId", args.applicationId))
      .order("desc")
      .collect();

    return activities;
  },
});

// Get applications grouped by status for Kanban view (excludes archived)
export const getByStatusGrouped = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const allApplications = await ctx.db
      .query("applications")
      .withIndex("by_created")
      .order("desc")
      .collect();

    // Filter out archived unless explicitly requested
    const applications = args.includeArchived
      ? allApplications
      : allApplications.filter(app => !app.isArchived);

    // Group by status
    const grouped: Record<string, typeof applications> = {
      new: [],
      reviewed: [],
      contacted: [],
      scheduled: [],
      interviewed: [],
      hired: [],
      rejected: [],
    };

    for (const app of applications) {
      if (grouped[app.status]) {
        grouped[app.status].push(app);
      }
    }

    return grouped;
  },
});

// ============ RESUME FILE STORAGE ============

// Generate upload URL for resume PDF
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Get download URL for a resume file
export const getResumeUrl = query({
  args: { fileId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.fileId);
  },
});

// Update application with resume file
export const updateResumeFile = mutation({
  args: {
    applicationId: v.id("applications"),
    resumeFileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.applicationId, {
      resumeFileId: args.resumeFileId,
      updatedAt: Date.now(),
    });
  },
});

// Update status with activity logging (auto-archives on hired/rejected)
export const updateStatusWithActivity = mutation({
  args: {
    applicationId: v.id("applications"),
    newStatus: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("Application not found");

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    const previousStatus = application.status;
    const now = Date.now();
    const shouldArchive = args.newStatus === "hired" || args.newStatus === "rejected";

    // Update the status (auto-archive on hired/rejected)
    await ctx.db.patch(args.applicationId, {
      status: args.newStatus,
      updatedAt: now,
      // Auto-archive when hired or rejected
      ...(shouldArchive && {
        isArchived: true,
        archivedAt: now,
      }),
    });

    // Log the activity
    await ctx.db.insert("applicationActivity", {
      applicationId: args.applicationId,
      type: "status_change",
      description: `Status changed from ${previousStatus} to ${args.newStatus}${shouldArchive ? " (auto-archived)" : ""}`,
      previousValue: previousStatus,
      newValue: args.newStatus,
      performedBy: args.userId,
      performedByName: user.name,
      createdAt: now,
    });

    return args.applicationId;
  },
});

// Archive a single application
export const archive = mutation({
  args: {
    applicationId: v.id("applications"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.applicationId, {
      isArchived: true,
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

// Unarchive a single application
export const unarchive = mutation({
  args: {
    applicationId: v.id("applications"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.applicationId, {
      isArchived: false,
      archivedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

// Archive all rejected applications
export const archiveRejected = mutation({
  args: {},
  handler: async (ctx) => {
    const applications = await ctx.db
      .query("applications")
      .withIndex("by_status", (q) => q.eq("status", "rejected"))
      .collect();

    let archived = 0;
    const now = Date.now();

    for (const app of applications) {
      if (!app.isArchived) {
        await ctx.db.patch(app._id, {
          isArchived: true,
          archivedAt: now,
          updatedAt: now,
        });
        archived++;
      }
    }

    return { archived, total: applications.length };
  },
});

// Archive all hired applications
export const archiveHired = mutation({
  args: {},
  handler: async (ctx) => {
    const applications = await ctx.db
      .query("applications")
      .withIndex("by_status", (q) => q.eq("status", "hired"))
      .collect();

    let archived = 0;
    const now = Date.now();

    for (const app of applications) {
      if (!app.isArchived) {
        await ctx.db.patch(app._id, {
          isArchived: true,
          archivedAt: now,
          updatedAt: now,
        });
        archived++;
      }
    }

    return { archived, total: applications.length };
  },
});

// One-time migration to backfill applicationId on existing interview events
// Also creates calendar events for applications that have scheduled info but no event
export const backfillInterviewEventApplicationIds = mutation({
  args: {},
  handler: async (ctx) => {
    // Get all applications
    const applications = await ctx.db
      .query("applications")
      .collect();

    // Get first admin user to set as creator for backfilled events
    const adminUser = await ctx.db
      .query("users")
      .filter((q) => q.or(
        q.eq(q.field("role"), "admin"),
        q.eq(q.field("role"), "super_admin")
      ))
      .first();

    if (!adminUser) {
      return { success: false, message: "No admin user found to create events" };
    }

    let updatedExisting = 0;
    let createdNew = 0;
    let skipped = 0;
    const now = Date.now();

    for (const application of applications) {
      // Case 1: Has event ID - just add applicationId if missing
      if (application.scheduledInterviewEventId) {
        const event = await ctx.db.get(application.scheduledInterviewEventId);

        if (event && !event.applicationId) {
          await ctx.db.patch(application.scheduledInterviewEventId, {
            applicationId: application._id,
          });
          updatedExisting++;
        } else if (event?.applicationId) {
          skipped++;
        }
      }
      // Case 2: Has scheduled interview info but no event - create the event
      else if (application.scheduledInterviewDate && !application.scheduledInterviewEventId) {
        const interviewDate = application.scheduledInterviewDate;
        const interviewTime = application.scheduledInterviewTime || "09:00";
        const startTime = new Date(`${interviewDate}T${interviewTime}:00`).getTime();
        const endTime = startTime + 60 * 60 * 1000; // 1 hour interview

        // Create the calendar event
        const eventId = await ctx.db.insert("events", {
          title: `Interview: ${application.firstName} ${application.lastName}`,
          description: `Job Interview for ${application.appliedJobTitle}\n\nCandidate: ${application.firstName} ${application.lastName}\nEmail: ${application.email}\nPhone: ${application.phone}`,
          startTime,
          endTime,
          isAllDay: false,
          location: application.scheduledInterviewLocation,
          meetingType: application.scheduledInterviewLocation === "Video" ? "video" :
                       application.scheduledInterviewLocation === "Phone" ? "phone" : "in-person",
          createdBy: adminUser._id,
          createdByName: adminUser.name,
          applicationId: application._id,
          createdAt: now,
          updatedAt: now,
        });

        // Update application with the new event ID
        await ctx.db.patch(application._id, {
          scheduledInterviewEventId: eventId,
          updatedAt: now,
        });

        createdNew++;
      }
    }

    return {
      success: true,
      updatedExisting,
      createdNew,
      skipped,
      message: `Updated ${updatedExisting} existing events, created ${createdNew} new events, skipped ${skipped}`,
    };
  },
});

// ============ AUTO-EXPIRE OLD APPLICATIONS ============

// Auto-archive applications older than 45 days that are still in early stages
// Statuses considered "stagnant" and eligible for auto-expire:
// - new: Never reviewed
// - reviewed: Reviewed but no contact made
// - contacted: Contacted but no interview scheduled
// - dns: Did not show and no follow-up
export const autoExpireOldApplications = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const fortyFiveDaysAgo = now - 45 * 24 * 60 * 60 * 1000;

    // Statuses that are considered stagnant/inactive
    const stagnantStatuses = ["new", "reviewed", "contacted", "dns"];

    // Get all applications
    const applications = await ctx.db.query("applications").collect();

    let expired = 0;

    for (const app of applications) {
      // Skip if already archived
      if (app.isArchived) continue;

      // Skip if status is not stagnant (hired, rejected, scheduled, interviewed are active)
      if (!stagnantStatuses.includes(app.status)) continue;

      // Skip if created within last 45 days
      if (app.createdAt > fortyFiveDaysAgo) continue;

      // Auto-archive this application
      await ctx.db.patch(app._id, {
        isArchived: true,
        archivedAt: now,
        status: "expired", // Mark as expired rather than just archiving
        updatedAt: now,
      });

      // Log the activity
      await ctx.db.insert("applicationActivity", {
        applicationId: app._id,
        type: "status_change",
        description: "Application auto-expired after 45 days of inactivity",
        previousValue: app.status,
        newValue: "expired",
        performedByName: "System (Auto-Expire)",
        createdAt: now,
      });

      expired++;
    }

    console.log(`Auto-expire job completed: ${expired} applications expired`);
    return { expired };
  },
});

// One-time backfill: populate searchText on all existing applications.
// Run once post-deploy: npx convex run applications:backfillApplicationSearchText
export const backfillApplicationSearchText = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("applications").collect();
    for (const a of all) {
      await ctx.db.patch(a._id, { searchText: applicationSearchText(a) });
    }
    return { updated: all.length };
  },
});
