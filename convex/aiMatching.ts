"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import Anthropic from "@anthropic-ai/sdk";

export const analyzeResume = action({
  args: {
    resumeText: v.string(),
  },
  handler: async (ctx, args): Promise<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    extractedSkills: string[];
    summary: string;
    jobMatches: Array<{
      jobId: string;
      jobTitle: string;
      score: number;
      matchedKeywords: string[];
      reasoning: string;
    }>;
    missingFields: string[];
    candidateAnalysis: {
      overallScore: number;
      stabilityScore: number;
      experienceScore: number;
      graduationYear?: number;
      yearsSinceGraduation?: number;
      employmentHistory: Array<{
        company: string;
        title: string;
        duration: string;
        durationMonths: number;
        startDate?: string;
        endDate?: string;
      }>;
      redFlags: Array<{
        type: string;
        severity: string;
        description: string;
      }>;
      greenFlags: Array<{
        type: string;
        description: string;
      }>;
      totalYearsExperience: number;
      averageTenureMonths: number;
      longestTenureMonths: number;
      recommendedAction: string;
      hiringTeamNotes: string;
    };
  }> => {
    const { resumeText } = args;

    // Get all active jobs from database
    const jobs = await ctx.runQuery(api.jobs.getActiveJobs);

    console.log(`Found ${jobs.length} active jobs`);
    console.log(`Resume text length: ${resumeText.length} characters`);

    // Check if Anthropic API key is configured
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY not configured - using fallback analysis");
      return fallbackAnalysis(resumeText, jobs);
    }

    console.log(`API key found, length: ${apiKey.length}, starts with: ${apiKey.substring(0, 10)}...`);

    const anthropic = new Anthropic({
      apiKey: apiKey,
    });

    // Create a simple job list for the AI with indices
    const jobList = jobs.map((job, index) => ({
      index: index + 1,
      id: job._id,
      title: job.title,
      description: job.description,
      department: job.department,
      keywords: job.keywords,
    }));

    // Get current date for context
    const currentDate = new Date();
    const currentMonth = currentDate.toLocaleString('default', { month: 'long' });
    const currentYear = currentDate.getFullYear();

    const prompt = `Analyze this resume and match it against our job positions. Return scores for ALL ${jobs.length} jobs.

TODAY'S DATE: ${currentMonth} ${currentYear}

RESUME TEXT (this is the ONLY information you have about the candidate):
---
${resumeText}
---

JOB POSITIONS (you must score ALL of these):
${jobList.map(job => `
Job #${job.index}: "${job.title}"
Department: ${job.department}
Description: ${job.description}
Required Skills: ${job.keywords.join(", ")}
`).join("\n")}

Return JSON in this exact format (no other text, just JSON):
{
  "firstName": "first name EXACTLY as written in resume",
  "lastName": "last name EXACTLY as written in resume",
  "email": "email EXACTLY as written in resume",
  "phone": "phone number EXACTLY as written in resume",
  "extractedSkills": ["skill1", "skill2", "skill3", "skill4", "skill5"],
  "summary": "1-2 sentence summary based ONLY on what is written in the resume",
  "jobMatches": [
    {"jobIndex": 1, "score": 85, "matchedKeywords": ["warehouse", "forklift"], "reasoning": "Based on your experience at [ACTUAL COMPANY FROM RESUME], you have relevant skills."}
  ],
  "candidateAnalysis": {
    "overallScore": 75,
    "stabilityScore": 80,
    "experienceScore": 70,
    "graduationYear": 2018,
    "yearsSinceGraduation": 8,
    "employmentHistory": [
      {"company": "Company Name", "title": "Job Title", "duration": "2 years 3 months", "durationMonths": 27, "startDate": "Jan 2022", "endDate": "Apr 2024"}
    ],
    "redFlags": [
      {"type": "job_hopping", "severity": "medium", "description": "3 jobs in 2 years indicates potential retention issues"}
    ],
    "greenFlags": [
      {"type": "long_tenure", "description": "5 years at XYZ Company shows strong commitment"}
    ],
    "totalYearsExperience": 8.5,
    "averageTenureMonths": 24,
    "longestTenureMonths": 60,
    "recommendedAction": "worth_interviewing",
    "hiringTeamNotes": "Candidate shows strong warehouse experience but has recent job changes. Recommend asking about reasons for leaving recent positions."
  }
}

=== CANDIDATE ANALYSIS INSTRUCTIONS ===
You MUST populate the candidateAnalysis section with detailed analysis:

1. EMPLOYMENT HISTORY: Extract ALL jobs from the resume with:
   - Company name, job title, duration (estimate if only years given)
   - Calculate durationMonths for each position

2. RED FLAGS to detect (be specific and honest):
   - "job_hopping": 3+ jobs in 2 years, or pattern of leaving before 1 year (NOT applicable to owners/founders)
   - "employment_gap": Gaps of 6+ months between jobs
   - "short_tenure": Multiple positions under 12 months at companies where they were EMPLOYEES (NOT applicable to business owners, founders, or self-employed - entrepreneurship is NOT a red flag)
   - "inconsistency": Conflicting dates or unexplained career changes - BUT use today's date (${currentMonth} ${currentYear}) as reference. Dates in the current month or recent past are NOT "future dates"
   - "no_experience": Applying for role with zero relevant background
   - "overqualified": Senior manager applying for entry-level (flight risk)

   IMPORTANT: Being a business owner, founder, CEO of own company, or self-employed is NOT a red flag, even if the tenure was short. Entrepreneurship shows initiative and should be noted positively. Only flag short tenure for traditional W-2 employment roles.

3. GREEN FLAGS to highlight:
   - "long_tenure": 3+ years at any single employer
   - "promotion": Internal promotions show growth
   - "relevant_experience": Direct experience in our industry
   - "certifications": Forklift cert, CDL, IT certs, etc.
   - "leadership": Team lead, supervisor, management experience
   - "education": College degree, technical certifications, or relevant training
   - "entrepreneurship": Founded or owned a business (shows initiative and leadership)
   - "technical_skills": Software development, IT, analytics, or technical expertise

=== POSITION-SPECIFIC SCORING ===

TIRE TECHNICIAN - RETAIL - EXPORT POSITIONS:
When scoring for "Tire Technician", "Tire Technician - Retail - Export", "Tire Changer", or similar tire service positions, apply these specific criteria:

HIGH VALUE EXPERIENCE (+20-30 bonus points):
- Previous tire shop experience (Discount Tire, Tire Kingdom, Big O Tires, Les Schwab, local tire shops)
- Automotive service technician or mechanic experience
- Lube tech, oil change technician experience
- Auto body shop experience

MODERATE VALUE EXPERIENCE (+10-15 bonus points):
- General automotive interest or background
- Warehouse/physical labor jobs (shows ability to handle physical work)
- Retail customer service (will interact with customers at retail locations)
- Any job requiring hand tools or mechanical aptitude

REQUIRED SKILLS TO LOOK FOR:
- Physical fitness/ability to lift heavy tires (40-80 lbs repeatedly)
- Ability to stand for long periods
- Basic mechanical aptitude
- Customer service skills (retail locations = customer-facing)
- Reliability and punctuality (critical for retail shifts)

RED FLAGS specific to Tire Changer:
- No physical labor experience at all
- History of attendance issues
- Only office/desk job experience with no indication of physical capability
- Overqualified (e.g., software engineer applying - likely a flight risk)

GREEN FLAGS specific to Tire Changer:
- TIA (Tire Industry Association) certification
- ASE certification
- Any automotive certifications
- Experience with tire equipment (changers, balancers, TPMS)
- Bilingual (bonus for customer service)

4. EDUCATION SCORING (add bonus points):
   - Bachelor's degree: +10 to experienceScore
   - Master's/MBA: +15 to experienceScore
   - PhD: +20 to experienceScore
   - Technical certifications (CDL, forklift, IT certs): +5 each
   - Education should be noted as a green flag if present

5. SCORING:
   - overallScore: Weighted combination (30% experience, 30% stability, 20% skills fit, 10% education, 10% career stage fit)
   - stabilityScore: Based on average tenure and job hopping patterns
   - experienceScore: How relevant is their background + education bonus

6. CAREER STAGE SCORING (for physical/warehouse roles):
   - Extract graduation year (high school, GED, or most recent education) from the resume
   - Calculate years since graduation: ${currentYear} - graduation_year
   - Add to candidateAnalysis: "graduationYear" (the year, or null if not found)
   - Add to candidateAnalysis: "yearsSinceGraduation" (number of years, or null)
   - Career stage bonus for warehouse/physical roles:
     * Graduated 0-5 years ago: +10 points to overall (early career, high energy)
     * Graduated 6-10 years ago: +7 points (prime working years)
     * Graduated 11-15 years ago: +4 points (experienced but active)
     * Graduated 16-20 years ago: +2 points (seasoned worker)
     * Graduated 20+ years ago or unknown: +0 points (focus on experience instead)
   - Note: This is about career stage and typical physical stamina for demanding roles, NOT age discrimination

6. RECOMMENDED ACTION:
   - "strong_candidate": 80+ overall, no major red flags
   - "worth_interviewing": 60-79 overall, minor concerns
   - "review_carefully": 40-59 overall, significant concerns to discuss
   - "likely_pass": Under 40, or major red flags

7. HIRING TEAM NOTES: Write 2-3 sentences specifically for the hiring manager about this candidate's strengths, concerns, and suggested interview questions.

CRITICAL RULES:
1. ONLY use information that is EXPLICITLY written in the resume above
2. NEVER invent or assume company names, job titles, or experiences
3. If the resume doesn't clearly state something, say "based on your resume" instead of making up specifics

SCORING RULES:
- 80-100: Direct experience in this exact role or very closely related
- 60-79: Similar/related experience that transfers well
- 40-59: Some transferable skills, could learn quickly
- 20-39: Limited background but potential to learn
- 10-19: Minimal relevant experience

Return ALL ${jobs.length} jobs in the jobMatches array, sorted by score descending.
Return ONLY valid JSON, no markdown code blocks, no other text.`;

    // Retry helper with exponential backoff for rate limits
    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 3000,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
        });

        const responseText = message.content[0].type === 'text' ? message.content[0].text : "{}";
      console.log("Claude Response received, length:", responseText.length);

      // Parse the AI response
      let aiResponse;
      try {
        const cleanedResponse = responseText
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
        aiResponse = JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error("Failed to parse Claude response:", responseText.substring(0, 500));
        return fallbackAnalysis(resumeText, jobs);
      }

      // Map AI job matches using jobIndex to our actual jobs
      const aiMatches = aiResponse.jobMatches || [];
      console.log(`Claude returned ${aiMatches.length} job matches`);

      // Create a map of AI scores by job index
      const scoreMap = new Map<number, { score: number; keywords: string[]; reasoning: string }>();
      for (const match of aiMatches) {
        const index = Number(match.jobIndex);
        if (index >= 1 && index <= jobs.length) {
          scoreMap.set(index, {
            score: Math.min(100, Math.max(0, Number(match.score) || 0)),
            keywords: match.matchedKeywords || [],
            reasoning: match.reasoning || ""
          });
        }
      }

      // Build final job matches ensuring ALL jobs are included
      const jobMatches = jobs.map((job, index) => {
        const jobIndex = index + 1;
        const aiMatch = scoreMap.get(jobIndex);

        return {
          jobId: job._id,
          jobTitle: job.title,
          score: aiMatch?.score ?? 10,
          matchedKeywords: aiMatch?.keywords ?? [],
          reasoning: aiMatch?.reasoning ?? "Limited match based on resume analysis.",
        };
      });

      // Sort by score descending
      jobMatches.sort((a, b) => b.score - a.score);

      // Check for missing fields
      const missingFields: string[] = [];
      if (!aiResponse.firstName && !aiResponse.lastName) missingFields.push("name");
      if (!aiResponse.email) missingFields.push("email");
      if (!aiResponse.phone) missingFields.push("phone");

      // Extract and validate candidate analysis
      const rawAnalysis = aiResponse.candidateAnalysis || {};

      // Extract graduation year and calculate years since graduation
      const graduationYear = rawAnalysis.graduationYear ? Number(rawAnalysis.graduationYear) : undefined;
      const yearsSinceGraduation = rawAnalysis.yearsSinceGraduation
        ? Number(rawAnalysis.yearsSinceGraduation)
        : (graduationYear ? currentYear - graduationYear : undefined);

      const candidateAnalysis = {
        overallScore: Math.min(100, Math.max(0, Number(rawAnalysis.overallScore) || 50)),
        stabilityScore: Math.min(100, Math.max(0, Number(rawAnalysis.stabilityScore) || 50)),
        experienceScore: Math.min(100, Math.max(0, Number(rawAnalysis.experienceScore) || 50)),
        graduationYear,
        yearsSinceGraduation,
        employmentHistory: (rawAnalysis.employmentHistory || []).map((job: any) => ({
          company: job.company || "Unknown",
          title: job.title || "Unknown",
          duration: job.duration || "Unknown",
          durationMonths: Number(job.durationMonths) || 0,
          startDate: job.startDate,
          endDate: job.endDate,
        })),
        redFlags: (rawAnalysis.redFlags || []).map((flag: any) => ({
          type: flag.type || "inconsistency",
          severity: flag.severity || "low",
          description: flag.description || "",
        })),
        greenFlags: (rawAnalysis.greenFlags || []).map((flag: any) => ({
          type: flag.type || "relevant_experience",
          description: flag.description || "",
        })),
        totalYearsExperience: Number(rawAnalysis.totalYearsExperience) || 0,
        averageTenureMonths: Number(rawAnalysis.averageTenureMonths) || 0,
        longestTenureMonths: Number(rawAnalysis.longestTenureMonths) || 0,
        recommendedAction: rawAnalysis.recommendedAction || "review_carefully",
        hiringTeamNotes: rawAnalysis.hiringTeamNotes || "Manual review recommended.",
      };

      return {
        firstName: aiResponse.firstName || "",
        lastName: aiResponse.lastName || "",
        email: aiResponse.email || "",
        phone: aiResponse.phone || "",
        extractedSkills: aiResponse.extractedSkills || [],
        summary: aiResponse.summary || "Resume analyzed successfully.",
        jobMatches,
        missingFields,
        candidateAnalysis,
      };
      } catch (error: any) {
        lastError = error;
        console.error(`=== Anthropic API Error Details (attempt ${attempt}/${maxRetries}) ===`);
        console.error("Error message:", error?.message);
        console.error("Error status:", error?.status);
        console.error("Error type:", error?.error?.type);
        console.error("Error code:", error?.error?.error?.type);
        console.error("Full error:", JSON.stringify(error, null, 2));

        const isRateLimit = error?.status === 429 || error?.message?.includes('rate') || error?.message?.includes('overloaded');
        const isCredits = error?.status === 400 && error?.message?.includes('credit');

        if (isRateLimit && attempt < maxRetries) {
          // Exponential backoff: 2s, 4s, 8s
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`Rate limited (attempt ${attempt}/${maxRetries}), waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        if (isCredits) {
          console.error("OUT OF CREDITS - need to add more credits to Anthropic account");
        }

        if (attempt === maxRetries) {
          console.error("All retry attempts exhausted, using fallback analysis");
          return fallbackAnalysis(resumeText, jobs);
        }
      }
    }

    // If we somehow exit the loop without returning, use fallback
    console.error("Unexpected exit from retry loop, using fallback");
    return fallbackAnalysis(resumeText, jobs);
  },
});

// Reanalyze a single application with AI
export const reanalyzeApplication = action({
  args: {
    applicationId: v.id("applications"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string; overallScore?: number; recommendedAction?: string }> => {
    // Get the application
    const application = await ctx.runQuery(api.applications.getById, {
      applicationId: args.applicationId,
    }) as any;

    if (!application) {
      throw new Error("Application not found");
    }

    if (!application.resumeText || application.resumeText.trim().length < 50) {
      return { success: false, error: "No resume text available for analysis" };
    }

    // Run the AI analysis
    const analysis = await ctx.runAction(api.aiMatching.analyzeResume, {
      resumeText: application.resumeText,
    }) as any;

    // Build the AI analysis object for storage
    const topMatch = analysis.jobMatches[0];
    const aiAnalysis = topMatch
      ? {
          suggestedJobId: topMatch.jobId as any,
          suggestedJobTitle: topMatch.jobTitle,
          matchScore: topMatch.score,
          allScores: analysis.jobMatches.map((m: any) => ({
            jobId: m.jobId as any,
            jobTitle: m.jobTitle,
            score: m.score,
            matchedKeywords: m.matchedKeywords,
            reasoning: m.reasoning,
          })),
          extractedSkills: analysis.extractedSkills,
          summary: analysis.summary,
        }
      : undefined;

    // Update the application with the new analysis
    await ctx.runMutation(api.applications.updateAIAnalysis, {
      applicationId: args.applicationId,
      aiAnalysis,
      candidateAnalysis: analysis.candidateAnalysis,
    });

    return {
      success: true,
      overallScore: analysis.candidateAnalysis.overallScore,
      recommendedAction: analysis.candidateAnalysis.recommendedAction,
    };
  },
});

// Reanalyze all applications that have resume text
export const reanalyzeAllApplications = action({
  args: {},
  handler: async (ctx): Promise<{ total: number; processed: number; skipped: number; errors: number; scores: { name: string; score: number; action: string }[] }> => {
    // Get all applications
    const applications = await ctx.runQuery(api.applications.getAll, { includeArchived: true }) as any[];

    const results: { total: number; processed: number; skipped: number; errors: number; scores: { name: string; score: number; action: string }[] } = {
      total: applications.length,
      processed: 0,
      skipped: 0,
      errors: 0,
      scores: [],
    };

    for (const app of applications) {
      // Skip if no resume text
      if (!app.resumeText || app.resumeText.trim().length < 50) {
        results.skipped++;
        continue;
      }

      try {
        const result = await ctx.runAction(api.aiMatching.reanalyzeApplication, {
          applicationId: app._id,
        }) as { success: boolean; overallScore?: number; recommendedAction?: string };

        if (result.success) {
          results.processed++;
          results.scores.push({
            name: `${app.firstName} ${app.lastName}`,
            score: result.overallScore!,
            action: result.recommendedAction!,
          });
        } else {
          results.skipped++;
        }
      } catch (error) {
        console.error(`Error reanalyzing ${app.firstName} ${app.lastName}:`, error);
        results.errors++;
      }
    }

    return results;
  },
});

// Fallback analysis without AI (basic regex extraction)
function fallbackAnalysis(resumeText: string, jobs: any[]) {
  // Extract contact information using regex patterns
  const emailMatch = resumeText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = resumeText.match(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);

  // Try to extract name
  const lines = resumeText.split('\n').filter(line => line.trim());
  let firstName = "";
  let lastName = "";

  for (const line of lines.slice(0, 5)) {
    const cleaned = line.trim();
    if (cleaned.includes('@') || cleaned.match(/^\d/) || cleaned.length > 50) continue;

    const nameParts = cleaned.split(/\s+/).filter(p =>
      p.length > 1 &&
      !p.includes('@') &&
      !p.match(/^\d/) &&
      p.match(/^[A-Za-z'-]+$/)
    );

    if (nameParts.length >= 2) {
      firstName = nameParts[0];
      lastName = nameParts[nameParts.length - 1];
      break;
    }
  }

  // Basic keyword matching as fallback
  const jobMatches = jobs.map(job => ({
    jobId: job._id,
    jobTitle: job.title,
    score: 25,
    matchedKeywords: [],
    reasoning: "AI analysis unavailable - manual review recommended.",
  }));

  const missingFields: string[] = [];
  if (!firstName || !lastName) missingFields.push("name");
  if (!emailMatch) missingFields.push("email");
  if (!phoneMatch) missingFields.push("phone");

  const candidateAnalysis = {
    overallScore: 50,
    stabilityScore: 50,
    experienceScore: 50,
    employmentHistory: [],
    redFlags: [{
      type: "inconsistency",
      severity: "low",
      description: "AI analysis unavailable - manual review required",
    }],
    greenFlags: [],
    totalYearsExperience: 0,
    averageTenureMonths: 0,
    longestTenureMonths: 0,
    recommendedAction: "review_carefully",
    hiringTeamNotes: "AI analysis was unavailable for this resume. Please review manually and extract employment history.",
  };

  return {
    firstName,
    lastName,
    email: emailMatch?.[0] || "",
    phone: phoneMatch?.[0] || "",
    extractedSkills: [],
    summary: "Basic resume analysis (AI unavailable). Please review manually.",
    jobMatches,
    missingFields,
    candidateAnalysis,
  };
}
