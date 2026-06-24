"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Process a single resume - checks for existing personnel first
export const processResume = action({
  args: {
    resumeText: v.string(),
    fileName: v.string(),
    resumeFileId: v.optional(v.id("_storage")), // Optional: actual PDF file stored in Convex
    selectedJobId: v.optional(v.id("jobs")), // Optional: pre-selected job to assign
    skipAiMatching: v.optional(v.boolean()), // Skip AI job matching when job is pre-selected
    requestingUserId: v.id("users"), // Operator running the bulk upload
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    error?: string;
    type?: "new_application" | "personnel_update";
    applicationId?: string;
    personnelId?: string;
    candidateName?: string;
    matchedJob?: string;
    overallScore?: number;
    currentPosition?: string;
  }> => {
    const { resumeText, fileName, selectedJobId, skipAiMatching } = args;

    if (!resumeText || resumeText.trim().length < 50) {
      return {
        success: false,
        error: "Resume text too short or empty",
      };
    }

    try {
      // If a job is pre-selected, fetch its details
      let selectedJob: { _id: Id<"jobs">; title: string } | null = null;
      if (selectedJobId) {
        selectedJob = await ctx.runQuery(api.jobs.getById, { jobId: selectedJobId });
        if (!selectedJob) {
          return {
            success: false,
            error: "Selected job not found",
          };
        }
      }

      // Run the AI analysis (always needed for contact info extraction)
      const analysis = await ctx.runAction(api.aiMatching.analyzeResume, {
        resumeText,
      }) as any;

      // Extract contact info from analysis
      const firstName = analysis.firstName || "";
      const lastName = analysis.lastName || "";
      const email = analysis.email || "";

      // Check if this person already exists in personnel
      const existingPersonnel = await ctx.runQuery(api.personnel.searchByEmailOrName, {
        email: email || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
      });

      // Get the best matching job - use selected job if provided, otherwise use AI match
      const topMatch = selectedJob
        ? { jobId: selectedJob._id, jobTitle: selectedJob.title, score: 100 }
        : analysis.jobMatches?.[0];

      if (existingPersonnel) {
        // This is an existing employee - update their record with resume and job analysis
        const jobMatchAnalysis = {
          suggestedPositions: analysis.jobMatches?.map((m: any) => ({
            jobId: m.jobId as Id<"jobs"> | undefined,
            jobTitle: m.jobTitle,
            score: m.score,
            matchedKeywords: m.matchedKeywords || [],
            reasoning: m.reasoning || "",
          })) || [],
          extractedSkills: analysis.extractedSkills || [],
          summary: analysis.summary || "",
          analyzedAt: Date.now(),
        };

        await ctx.runMutation(api.personnel.updateResumeAndAnalysis, {
          personnelId: existingPersonnel._id,
          resumeText,
          jobMatchAnalysis,
          requestingUserId: args.requestingUserId,
        });

        return {
          success: true,
          type: "personnel_update",
          personnelId: existingPersonnel._id,
          candidateName: `${existingPersonnel.firstName} ${existingPersonnel.lastName}`,
          matchedJob: topMatch?.jobTitle,
          overallScore: analysis.candidateAnalysis?.overallScore,
          currentPosition: existingPersonnel.position,
        };
      }

      // No existing personnel - check for duplicate application
      const existingApplication = await ctx.runQuery(api.applications.checkForDuplicate, {
        email: email || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
      });

      if (existingApplication) {
        // The applicant already exists (e.g. came in via Indeed/website as text-only).
        // If THIS upload carries a resume PDF and the existing record has none, attach
        // it instead of discarding the upload — this is how re-uploading a batch fills
        // in missing resume PDFs. Otherwise it's a true duplicate.
        if (args.resumeFileId && !existingApplication.resumeFileId) {
          await ctx.runMutation(api.applications.updateResumeFile, {
            applicationId: existingApplication._id,
            resumeFileId: args.resumeFileId,
          });
          return {
            success: true,
            type: "duplicate_pdf_attached",
            candidateName: `${existingApplication.firstName} ${existingApplication.lastName}`,
            message: `Attached resume PDF to existing applicant ${existingApplication.firstName} ${existingApplication.lastName}`,
          };
        }
        return {
          success: false,
          error: `Duplicate: Application already exists for ${existingApplication.firstName} ${existingApplication.lastName} (${existingApplication.email})`,
        };
      }

      // Create a new application
      if (!topMatch) {
        return {
          success: false,
          error: "No job matches found",
        };
      }

      // Build the AI analysis object for storage
      const aiAnalysis = selectedJob
        ? {
            // When job is pre-selected, store minimal analysis
            suggestedJobId: selectedJob._id,
            suggestedJobTitle: selectedJob.title,
            matchScore: 100,
            allScores: [{ jobId: selectedJob._id, jobTitle: selectedJob.title, score: 100, matchedKeywords: [], reasoning: "Manually assigned" }],
            extractedSkills: analysis.extractedSkills || [],
            summary: analysis.summary,
          }
        : {
            suggestedJobId: topMatch.jobId,
            suggestedJobTitle: topMatch.jobTitle,
            matchScore: topMatch.score,
            allScores: analysis.jobMatches.map((m: any) => ({
              jobId: m.jobId,
              jobTitle: m.jobTitle,
              score: m.score,
              matchedKeywords: m.matchedKeywords,
              reasoning: m.reasoning,
            })),
            extractedSkills: analysis.extractedSkills || [],
            summary: analysis.summary,
          };

      // Create the application with the best matching job
      const applicationId = await ctx.runMutation(api.applications.submitApplication, {
        firstName: firstName || "Unknown",
        lastName: lastName || `(${fileName})`,
        email: email || "",
        phone: analysis.phone || "",
        resumeText,
        resumeFileId: args.resumeFileId, // Include actual PDF if provided
        appliedJobId: topMatch.jobId,
        appliedJobTitle: topMatch.jobTitle,
        aiAnalysis,
        candidateAnalysis: analysis.candidateAnalysis,
      });

      return {
        success: true,
        type: "new_application",
        applicationId,
        candidateName: `${firstName || "Unknown"} ${lastName || ""}`.trim(),
        matchedJob: topMatch.jobTitle,
        overallScore: analysis.candidateAnalysis?.overallScore,
      };
    } catch (error: any) {
      console.error("Error processing resume:", error);
      return {
        success: false,
        error: error?.message || "Unknown error processing resume",
      };
    }
  },
});
