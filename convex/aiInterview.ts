"use node";

import { action, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { getClaude, claudeText } from "./lib/aiClient";
import { Id } from "./_generated/dataModel";

// Generate interview questions based on candidate profile and job
export const generateInterviewQuestions = action({
  args: {
    applicationId: v.id("applications"),
    round: v.number(),
    interviewerName: v.string(),
  },
  handler: async (ctx, args): Promise<{
    questions: Array<{
      question: string;
      aiGenerated: boolean;
    }>;
    error?: string;
  }> => {
    const { applicationId, round, interviewerName } = args;

    // Get application details
    const application = await ctx.runQuery(api.applications.getById, { applicationId });
    if (!application) {
      return { questions: [], error: "Application not found" };
    }

    // Get job details if available
    let job = null;
    if (application.appliedJobId) {
      job = await ctx.runQuery(api.jobs.getById, { jobId: application.appliedJobId });
    }

    // Check for previous interview rounds to avoid repeating questions
    const previousQuestions: string[] = [];
    if (application.interviewRounds) {
      for (const existingRound of application.interviewRounds) {
        for (const q of existingRound.questions) {
          previousQuestions.push(q.question);
        }
      }
    }

    // Claude routes through Bedrock; null means no provider is configured.
    const claude = getClaude();
    if (!claude) {
      return {
        questions: getFallbackQuestions(round, job?.positionType || "hourly"),
        error: "AI unavailable - using standard questions",
      };
    }

    const candidateName = `${application.firstName} ${application.lastName}`;
    const jobTitle = application.appliedJobTitle || "General Position";
    const positionType = job?.positionType || "hourly";

    // Build context about the candidate
    let candidateContext = `Candidate: ${candidateName}\nApplied Position: ${jobTitle}\nPosition Type: ${positionType}`;

    if (application.resumeText) {
      candidateContext += `\n\nResume Summary:\n${application.resumeText.substring(0, 2000)}`;
    }

    if (application.candidateAnalysis) {
      const analysis = application.candidateAnalysis;
      candidateContext += `\n\nCandidate Analysis:`;
      candidateContext += `\n- Overall Score: ${analysis.overallScore}/100`;
      candidateContext += `\n- Stability Score: ${analysis.stabilityScore}/100`;
      candidateContext += `\n- Experience Score: ${analysis.experienceScore}/100`;
      candidateContext += `\n- Total Years Experience: ${analysis.totalYearsExperience}`;
      candidateContext += `\n- Average Tenure: ${analysis.averageTenureMonths} months`;

      if (analysis.redFlags.length > 0) {
        candidateContext += `\n\nRed Flags to Address:`;
        analysis.redFlags.forEach((flag) => {
          candidateContext += `\n- [${flag.severity}] ${flag.type}: ${flag.description}`;
        });
      }

      if (analysis.greenFlags.length > 0) {
        candidateContext += `\n\nStrengths to Explore:`;
        analysis.greenFlags.forEach((flag) => {
          candidateContext += `\n- ${flag.type}: ${flag.description}`;
        });
      }
    }

    const previousQuestionsContext = previousQuestions.length > 0
      ? `\n\nPREVIOUSLY ASKED QUESTIONS (DO NOT REPEAT THESE):\n${previousQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      : '';

    const prompt = `You are an experienced HR manager at IE Tire, a tire wholesale company. Generate ${getQuestionCount(round, positionType)} interview questions for Round ${round} of the interview process.

${candidateContext}
${previousQuestionsContext}

INTERVIEW ROUND GUIDELINES:
- Round 1: Initial screening - Focus on basic qualifications, availability, work history verification, and general fit
- Round 2: Technical/skills assessment - Focus on job-specific knowledge, problem-solving, and situational questions
- Round 3: Final/management interview - Focus on leadership potential, long-term goals, cultural fit, and compensation expectations

POSITION TYPE CONTEXT:
${positionType === 'management'
  ? '- This is a MANAGEMENT position. Focus on leadership experience, team management, strategic thinking, and handling difficult situations.'
  : positionType === 'salaried'
  ? '- This is a SALARIED position. Focus on professional experience, specialized skills, and career development goals.'
  : '- This is an HOURLY position. Focus on reliability, attendance, physical capability, teamwork, and practical skills.'}

JOB SPECIFIC CONTEXT:
${job ? `- Department: ${job.department}\n- Description: ${job.description}\n- Key Skills: ${job.keywords.join(', ')}` : '- General warehouse/tire distribution position'}

IMPORTANT RULES:
1. Generate exactly ${getQuestionCount(round, positionType)} questions
2. NEVER repeat any previously asked questions
3. Make questions specific to the candidate and position
4. Include at least one behavioral question ("Tell me about a time...")
5. For management roles, include leadership scenarios
6. Address any red flags from the candidate analysis diplomatically
7. Keep questions professional and legal (no age, religion, marital status, etc.)

Return ONLY a JSON array of question strings, no other text:
["Question 1?", "Question 2?", ...]`;

    try {
      const response = await claude.messages.create({
        model: claude.model("fast"),
        // Shares the budget with Sonnet 5's always-on thinking.
        max_tokens: 8192,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const text = claudeText(response);
      if (!text) {
        throw new Error('Unexpected response type');
      }

      // Parse the JSON response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('Could not parse questions from response');
      }

      const questions = JSON.parse(jsonMatch[0]) as string[];

      return {
        questions: questions.map(q => ({
          question: q,
          aiGenerated: true,
        })),
      };
    } catch (error) {
      console.error("AI question generation failed:", error);
      return {
        questions: getFallbackQuestions(round, positionType),
        error: "AI generation failed - using standard questions",
      };
    }
  },
});

// Evaluate interview answers
export const evaluateInterview = action({
  args: {
    applicationId: v.id("applications"),
    round: v.number(),
  },
  handler: async (ctx, args): Promise<{
    overallScore: number;
    strengths: string[];
    concerns: string[];
    recommendation: string;
    detailedFeedback: string;
    error?: string;
  }> => {
    const { applicationId, round } = args;

    // Get application details
    const application = await ctx.runQuery(api.applications.getById, { applicationId });
    if (!application) {
      return {
        overallScore: 0,
        strengths: [],
        concerns: [],
        recommendation: "Unable to evaluate - application not found",
        detailedFeedback: "",
        error: "Application not found",
      };
    }

    // Find the specific round
    const interviewRound = application.interviewRounds?.find(r => r.round === round);
    if (!interviewRound) {
      return {
        overallScore: 0,
        strengths: [],
        concerns: [],
        recommendation: "Unable to evaluate - interview round not found",
        detailedFeedback: "",
        error: "Interview round not found",
      };
    }

    // Check if all questions have answers
    const unansweredCount = interviewRound.questions.filter(q => !q.answer || q.answer.trim() === '').length;
    if (unansweredCount > 0) {
      return {
        overallScore: 0,
        strengths: [],
        concerns: [],
        recommendation: `Please complete all answers - ${unansweredCount} questions remaining`,
        detailedFeedback: "",
        error: "Interview incomplete",
      };
    }

    // Claude routes through Bedrock; null means no provider is configured.
    const claude = getClaude();
    if (!claude) {
      return getFallbackEvaluation(interviewRound.questions);
    }

    // Get job details
    let job = null;
    if (application.appliedJobId) {
      job = await ctx.runQuery(api.jobs.getById, { jobId: application.appliedJobId });
    }

    const candidateName = `${application.firstName} ${application.lastName}`;
    const jobTitle = application.appliedJobTitle || "General Position";
    const positionType = job?.positionType || "hourly";

    // Format Q&A pairs
    const qaContent = interviewRound.questions.map((q, i) =>
      `Q${i + 1}: ${q.question}\nA${i + 1}: ${q.answer || 'No answer provided'}`
    ).join('\n\n');

    // Include preliminary evaluation if available
    let preliminaryContext = '';
    if (interviewRound.preliminaryEvaluation) {
      const prelim = interviewRound.preliminaryEvaluation;
      const avgScore = (prelim.appearance + prelim.manner + prelim.conversation +
                        prelim.intelligence + prelim.sociability + prelim.overallHealthOpinion) / 6;
      preliminaryContext = `
PRELIMINARY EVALUATION (Small Talk Phase - Scores 1-4):
- Appearance: ${prelim.appearance}/4
- Manner: ${prelim.manner}/4
- Conversation: ${prelim.conversation}/4
- Intelligence: ${prelim.intelligence}/4
- Sociability: ${prelim.sociability}/4
- Health Opinion: ${prelim.overallHealthOpinion}/4
- Average: ${avgScore.toFixed(1)}/4
${prelim.notes ? `- Notes: ${prelim.notes}` : ''}

IMPORTANT: Factor these preliminary scores into your overall evaluation. A preliminary average of:
- 3.5-4.0: Strong first impression, boost overall score by ~10 points
- 2.5-3.4: Average first impression, neutral impact
- 1.5-2.4: Below average first impression, reduce overall score by ~10 points
- 1.0-1.4: Poor first impression, reduce overall score by ~15-20 points
`;
    }

    const prompt = `You are an experienced HR manager at IE Tire evaluating a Round ${round} interview. Analyze the following interview Q&A and provide an evaluation.

CANDIDATE: ${candidateName}
POSITION: ${jobTitle} (${positionType})
INTERVIEWER: ${interviewRound.interviewerName}
${job ? `DEPARTMENT: ${job.department}` : ''}
${preliminaryContext}
IMPORTANT NOTE ABOUT ANSWER FORMAT:
The answers below are the INTERVIEWER'S NOTES, not verbatim transcriptions. Interviewers typically:
- Write brief summaries or key points
- Use shorthand like "yes", "no", "good", "2 years"
- Note their impressions rather than exact words
- Abbreviate longer responses to essential information

DO NOT penalize candidates for short or summarized answers. A one-word answer like "yes" or a brief note like "forklift certified, 3 years exp" is completely valid - it means the interviewer captured the key information. Focus on the SUBSTANCE of what was communicated, not the length or format of the notes.

INTERVIEW Q&A:
${qaContent}

${interviewRound.interviewNotes ? `INTERVIEWER NOTES: ${interviewRound.interviewNotes}` : ''}

EVALUATION CRITERIA:
1. Relevant experience and qualifications (based on what was communicated)
2. Cultural fit for a warehouse/distribution environment
3. Red flags (inconsistencies, evasive answers, concerning attitudes - but NOT short answers)
4. ${positionType === 'management' ? 'Leadership capability and management experience' : 'Reliability and work ethic indicators'}

DO NOT flag as a concern:
- Short or abbreviated answers (these are interviewer notes, not verbatim transcripts)
- Answers that are just "yes", "no", or brief phrases (this is normal note-taking)
- Lack of detail (the interviewer captured what was important)

Provide your evaluation in the following JSON format:
{
  "overallScore": <number 0-100>,
  "strengths": ["strength 1", "strength 2", ...],
  "concerns": ["concern 1", "concern 2", ...],
  "recommendation": "<STRONG YES / YES / MAYBE / NO / STRONG NO> - Brief explanation",
  "detailedFeedback": "<2-3 paragraph detailed assessment>"
}`;

    try {
      const response = await claude.messages.create({
        model: claude.model("fast"),
        // Shares the budget with Sonnet 5's always-on thinking.
        max_tokens: 8192,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const text = claudeText(response);
      if (!text) {
        throw new Error('Unexpected response type');
      }

      // Parse the JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Could not parse evaluation from response');
      }

      const evaluation = JSON.parse(jsonMatch[0]);

      return {
        overallScore: evaluation.overallScore || 50,
        strengths: evaluation.strengths || [],
        concerns: evaluation.concerns || [],
        recommendation: evaluation.recommendation || "Unable to provide recommendation",
        detailedFeedback: evaluation.detailedFeedback || "",
      };
    } catch (error) {
      console.error("AI evaluation failed:", error);
      return getFallbackEvaluation(interviewRound.questions);
    }
  },
});

// Helper function to get question count based on round and position type
function getQuestionCount(round: number, positionType: string): number {
  if (positionType === 'management') {
    return round === 1 ? 6 : round === 2 ? 8 : 6;
  }
  return round === 1 ? 5 : round === 2 ? 6 : 5;
}

// Fallback questions when AI is unavailable
function getFallbackQuestions(round: number, positionType: string): Array<{ question: string; aiGenerated: boolean }> {
  const hourlyRound1 = [
    "Tell me about your previous work experience.",
    "Why are you interested in working at IE Tire?",
    "Are you available to work the required schedule, including weekends if needed?",
    "How do you handle physically demanding work?",
    "Describe a time when you had to work as part of a team.",
  ];

  const hourlyRound2 = [
    "Describe a challenging situation at work and how you handled it.",
    "How do you prioritize tasks when you have multiple deadlines?",
    "Tell me about a time you went above and beyond for a customer or coworker.",
    "How do you stay organized in a fast-paced environment?",
    "What would you do if you noticed a safety hazard?",
    "How do you handle repetitive tasks while maintaining accuracy?",
  ];

  const hourlyRound3 = [
    "Where do you see yourself in 2-3 years?",
    "What motivates you to perform your best at work?",
    "How do you handle feedback or criticism?",
    "What questions do you have about the role or our company?",
    "What are your salary expectations?",
  ];

  const managementRound1 = [
    "Tell me about your management experience.",
    "What attracted you to this leadership role at IE Tire?",
    "Describe your management style.",
    "How do you handle underperforming team members?",
    "Tell me about a time you had to make a difficult decision.",
    "How do you balance meeting goals with team morale?",
  ];

  const managementRound2 = [
    "Describe a time you successfully led a team through a challenging project.",
    "How do you handle conflict between team members?",
    "Tell me about a process improvement you implemented.",
    "How do you motivate a team during busy or stressful periods?",
    "Describe your approach to training and developing employees.",
    "How do you handle competing priorities from different stakeholders?",
    "Tell me about a time you had to deliver negative feedback.",
    "How do you ensure your team meets safety and quality standards?",
  ];

  const managementRound3 = [
    "What is your long-term career vision?",
    "How would you describe your leadership philosophy?",
    "What do you consider your greatest leadership achievement?",
    "How do you stay current with industry trends and best practices?",
    "What are your salary and benefits expectations?",
    "What questions do you have about our company culture and expectations?",
  ];

  let questions: string[];
  if (positionType === 'management') {
    questions = round === 1 ? managementRound1 : round === 2 ? managementRound2 : managementRound3;
  } else {
    questions = round === 1 ? hourlyRound1 : round === 2 ? hourlyRound2 : hourlyRound3;
  }

  return questions.map(q => ({ question: q, aiGenerated: false }));
}

// Fallback evaluation when AI is unavailable
function getFallbackEvaluation(questions: Array<{ question: string; answer?: string }>): {
  overallScore: number;
  strengths: string[];
  concerns: string[];
  recommendation: string;
  detailedFeedback: string;
  error?: string;
} {
  const answeredCount = questions.filter(q => q.answer && q.answer.trim() !== '').length;
  const totalCount = questions.length;
  const completionRate = (answeredCount / totalCount) * 100;

  // Basic scoring based on answer length and completion
  let totalLength = 0;
  questions.forEach(q => {
    if (q.answer) totalLength += q.answer.length;
  });
  const avgLength = totalLength / answeredCount;

  // Simple heuristic scoring
  let score = 50;
  if (completionRate === 100) score += 10;
  if (avgLength > 100) score += 10;
  if (avgLength > 200) score += 10;
  if (avgLength > 300) score += 5;

  return {
    overallScore: Math.min(score, 85), // Cap at 85 for fallback
    strengths: ["Completed all interview questions"],
    concerns: ["AI evaluation unavailable - manual review recommended"],
    recommendation: "MAYBE - Manual review required as AI evaluation was unavailable",
    detailedFeedback: `The candidate completed ${answeredCount} of ${totalCount} questions. Average answer length was ${Math.round(avgLength)} characters. Please review the responses manually to make a hiring decision.`,
    error: "AI evaluation unavailable",
  };
}
