"use node";

/**
 * Exit-interview actions that call Claude.
 *
 * Split out of exitInterviews.ts because the Claude client reaches Bedrock through
 * @anthropic-ai/bedrock-sdk, which pulls in the AWS SigV4 credential chain
 * (@aws-sdk/credential-provider-*, @smithy/*) and therefore Node built-ins
 * (assert, stream, node:fs, node:os, node:http). Those exist only in Convex's Node
 * runtime, and a "use node" module may contain actions but NOT queries or
 * mutations — so these two actions cannot sit alongside the ~20 queries and
 * mutations in exitInterviews.ts.
 *
 * Leaving them there failed `convex deploy` outright, and since the production
 * build command is `npx convex deploy --cmd 'next build'`, it failed every
 * IECentral Vercel deploy. Same split as meetingNotes.ts / meetingNoteActions.ts.
 *
 * assertSuperAdmin and getCompletedInterviews stay in exitInterviews.ts: they are
 * internalQuery, which a "use node" file cannot host. They are reached here via
 * internal.exitInterviews.* exactly as before.
 */

import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { getClaude, claudeText } from "./lib/aiClient";

// ============ EXECUTIVE BRIEF ============
//
// Narrative + themes + actions for the leadership-facing PDF
// (/reports/exit-interviews → "Executive PDF").
//
// Differs from generateAISummary below in three ways that matter:
//   1. It is auth-guarded (super_admin only). Exit-interview responses are
//      confidential; see docs/iecentral/SECURITY-FINDINGS.md:86.
//   2. It forces a strict tool call, so themes/actions come back as validated
//      arrays instead of being regex-scraped out of prose. (@anthropic-ai/sdk
//      0.71.2 has no output_config.format — its BetaOutputConfig carries only
//      `effort` — but beta tool definitions do support `strict: true`, which
//      gives the same guarantee that the input validates against the schema.)
//   3. It never throws. Callers get { ok: false, reason } and the PDF falls
//      back to printing verbatim employee comments.

const BRIEF_SCHEMA = {
  type: "object" as const,
  properties: {
    narrative: {
      type: "string" as const,
      description:
        "2-3 short paragraphs, separated by blank lines, addressed to a CEO. " +
        "Lead with the single most important finding. Plain language, no jargon, " +
        "no bullet points. Cite concrete counts where you have them.",
    },
    sentiment: {
      type: "string" as const,
      description: "One short phrase: overall sentiment and what drives it.",
    },
    themes: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "3-5 recurring themes. Each one a single sentence.",
    },
    actions: {
      type: "array" as const,
      items: { type: "string" as const },
      description:
        "3-5 specific, actionable retention recommendations, most important first. " +
        "Each one a single sentence starting with a verb.",
    },
  },
  required: ["narrative", "sentiment", "themes", "actions"],
  additionalProperties: false,
};

export const generateExecutiveBrief = action({
  args: {
    requestingUserId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; narrative: string; sentiment: string; themes: string[]; actions: string[] }
    | { ok: false; reason: string }
  > => {
    // Guard before we read a single response or spend a single token.
    await ctx.runQuery(internal.exitInterviews.assertSuperAdmin, {
      requestingUserId: args.requestingUserId,
    });

    const claude = getClaude();
    if (!claude) {
      return { ok: false, reason: "No AI provider is configured" };
    }

    const all = await ctx.runQuery(internal.exitInterviews.getCompletedInterviews, {});
    const interviews = all.filter(
      (i: { terminationDate: string }) =>
        i.terminationDate >= args.startDate && i.terminationDate <= args.endDate,
    );

    if (interviews.length === 0) {
      return { ok: false, reason: "No completed exit interviews in this period" };
    }

    // Names are deliberately omitted — the brief is about patterns, not people.
    // interviewerNotes carries what was actually said during the interview; it
    // is usually the richest field on the record, so the brief must see it.
    const payload = interviews.map((i) => ({
      department: i.department,
      position: i.position,
      terminationDate: i.terminationDate,
      leavingCategory: i.leavingCategory,
      responses: i.responses,
      interviewerNotes: i.interviewerNotes,
    }));

    try {
      const response = await claude.beta.messages.create({
        model: claude.model("reasoning"),
        max_tokens: 8192,
        // Bedrock requires thinking to be off when tool_choice is forced.
        // Opus 4.8 permits disabling it; the direct API does not require this,
        // which is why the flag was previously absent.
        thinking: { type: "disabled" },
        tools: [
          {
            name: "emit_brief",
            description: "Return the executive brief.",
            strict: true,
            input_schema: BRIEF_SCHEMA,
          },
        ],
        tool_choice: { type: "tool", name: "emit_brief" },
        messages: [
          {
            role: "user",
            content: `You are analyzing exit interview data for Import Export Tire Co and writing a brief for the CEO.

There are ${interviews.length} completed exit interviews below. Ratings are 1-5, where 1 = Poor and 5 = Excellent.

The single most important thing you can do is reconcile two signals that often disagree:
  (a) \`primaryReason\` — single-select, so it captures only each person's TOP reason.
  (b) the 1-5 ratings — every person rates every dimension.

A dimension can be rated poor by nearly everyone while almost nobody names it as their primary reason. When that happens, SAY SO EXPLICITLY and lead with it. A low rating given by most departing employees is a stronger finding than a reason category's share, because the reason category structurally undercounts any cause that wasn't someone's single top answer. Report the share who rated each dimension 1 or 2, not just the average — an average of 2.0 hides whether that is everyone at 2 or a split of 1s and 3s.

Weight the free-text comments most heavily — \`interviewerNotes\` (what was said during the interview), \`whatCouldImprove\`, and \`additionalComments\`. Those carry the substance. The \`primaryReason\` and \`terminationReason\` fields are free-text boxes that often contain only a word or an interviewer's name; do not treat a terse entry there as the person's real reason for leaving. Note that \`whatLikedMost\` records positives — never read a manager mentioned there as a complaint.

Ground every claim in the data. Do not speculate about causes the data does not support. If the sample is small, say so rather than overstating a pattern. Reference actual feedback where it is illuminating, but never name an individual.

Exit interview data:
${JSON.stringify(payload, null, 2)}`,
          },
        ],
      });

      const block = response.content.find((b) => b.type === "tool_use");
      if (!block || block.type !== "tool_use") {
        return { ok: false, reason: "AI service did not return the expected brief" };
      }

      const parsed = block.input as {
        narrative: string;
        sentiment: string;
        themes: string[];
        actions: string[];
      };

      return {
        ok: true,
        narrative: parsed.narrative,
        sentiment: parsed.sentiment,
        themes: parsed.themes.slice(0, 5),
        actions: parsed.actions.slice(0, 5),
      };
    } catch (error) {
      console.error("Executive brief generation failed:", error);
      return { ok: false, reason: String(error) };
    }
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
    const claude = getClaude();
    if (!claude) {
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

    try {
      const response = await claude.messages.create({
        model: claude.model("fast"),
        // Shares the budget with Sonnet 5's always-on thinking.
        max_tokens: 8192,
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

      const text = claudeText(response);
      if (!text) {
        return { success: false, error: "Unexpected AI response format" };
      }

      // Parse the AI response to extract sections
      const fullText = text;

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
