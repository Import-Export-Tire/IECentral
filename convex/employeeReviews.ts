import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireManagePersonnel } from "./authGuards";

// ── Scoring helpers (mirrors lib/reviewQuestions.ts; kept inline so the Convex
//    bundler doesn't need to resolve the shared module). Keep the bands in sync. ──
function averageOf(ratings: { rating: number }[]): number {
  const vals = ratings.map((r) => r.rating).filter((r) => typeof r === "number" && r >= 1 && r <= 5);
  if (vals.length === 0) return 0;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}
function recommendedIncrease(avg: number, type: string): string {
  if (avg < 2.5) return type === "annual" ? "0%" : "0% (PIP / extended probation)";
  if (avg < 3.5) return type === "annual" ? "2.0 – 2.5%" : "1.0%";
  if (avg < 4.5) return type === "annual" ? "3.0 – 3.5%" : "2.0 – 2.5%";
  return type === "annual" ? "4.0 – 5.0%" : "3.0%";
}
function periodLabel(type: string): string {
  return type === "annual" ? "Annual Review" : "90-Day Review";
}
function daysSince(dateStr: string): number {
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86_400_000);
}

const RATING = v.object({ questionId: v.string(), section: v.string(), rating: v.number() });

// ── Eligibility ────────────────────────────────────────────────────────────────
// 90-day: active, ~80+ days since hire, no 90-day review on file yet.
// annual: active, ~330+ days since hire, no annual review created in the last ~330 days.
export const listEligible = query({
  args: { requestingUserId: v.id("users"), reviewType: v.string() },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const people = (await ctx.db.query("personnel").collect()).filter((p) => p.status === "active");
    const reviews = await ctx.db
      .query("employeeReviews")
      .withIndex("by_type_status", (q) => q.eq("reviewType", args.reviewType))
      .collect();
    const byPerson = new Map<string, typeof reviews>();
    for (const r of reviews) {
      const k = r.personnelId as unknown as string;
      (byPerson.get(k) ?? byPerson.set(k, []).get(k)!).push(r);
    }
    const out: { personnelId: string; name: string; position: string; department: string; hireDate: string; daysSinceHire: number; existingReviewId: string | null; existingStatus: string | null }[] = [];
    for (const p of people) {
      const days = daysSince(p.hireDate);
      const existing = byPerson.get(p._id as unknown as string) ?? [];
      if (args.reviewType === "90_day") {
        if (days < 80) continue;
        if (existing.length > 0) {
          // already has one — surface it only if still open (not decided)
          const open = existing.find((r) => r.status !== "decided");
          if (!open) continue;
          out.push(row(p, days, open));
          continue;
        }
        out.push(row(p, days, null));
      } else {
        if (days < 330) continue;
        const recent = existing.find((r) => r.createdAt > Date.now() - 330 * 86_400_000);
        if (recent) {
          if (recent.status === "decided") continue;
          out.push(row(p, days, recent));
          continue;
        }
        out.push(row(p, days, null));
      }
    }
    out.sort((a, b) => b.daysSinceHire - a.daysSinceHire);
    return out;

    function row(p: any, days: number, ex: any) {
      return {
        personnelId: p._id, name: `${p.firstName} ${p.lastName}`, position: p.position,
        department: p.department, hireDate: p.hireDate, daysSinceHire: days,
        existingReviewId: ex?._id ?? null, existingStatus: ex?.status ?? null,
      };
    }
  },
});

// ── Reads ────────────────────────────────────────────────────────────────────
export const get = query({
  args: { id: v.id("employeeReviews") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

export const listForPersonnel = query({
  args: { personnelId: v.id("personnel") },
  handler: async (ctx, args) =>
    ctx.db.query("employeeReviews").withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId)).order("desc").collect(),
});

// Management list / batch summary (Terry's view includes money).
export const list = query({
  args: { requestingUserId: v.id("users"), reviewType: v.optional(v.string()), status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    let rows = await ctx.db.query("employeeReviews").order("desc").collect();
    if (args.reviewType) rows = rows.filter((r) => r.reviewType === args.reviewType);
    if (args.status) rows = rows.filter((r) => r.status === args.status);
    return rows;
  },
});

// ── Writes ───────────────────────────────────────────────────────────────────
export const generate = mutation({
  args: { requestingUserId: v.id("users"), personnelId: v.id("personnel"), reviewType: v.string(), createdByName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const p = await ctx.db.get(args.personnelId);
    if (!p) throw new Error("Employee not found");

    // Reuse an existing open (not-decided) review of this type rather than duplicate.
    const existing = (await ctx.db
      .query("employeeReviews")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .collect()).find((r) => r.reviewType === args.reviewType && r.status !== "decided");
    if (existing) return { id: existing._id, reused: true };

    const label = args.reviewType === "annual" ? `Annual Review ${new Date().getFullYear()}` : periodLabel(args.reviewType);
    const now = Date.now();
    const id = await ctx.db.insert("employeeReviews", {
      personnelId: args.personnelId,
      reviewType: args.reviewType,
      employeeName: `${p.firstName} ${p.lastName}`,
      position: p.position,
      department: p.department,
      hireDate: p.hireDate,
      reviewPeriodLabel: label,
      ratings: [],
      decision: "pending",
      status: "generated",
      createdByName: args.createdByName,
      createdAt: now,
      updatedAt: now,
    });
    return { id, reused: false };
  },
});

export const generateBatch = mutation({
  args: { requestingUserId: v.id("users"), personnelIds: v.array(v.id("personnel")), reviewType: v.string(), createdByName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const ids: string[] = [];
    for (const pid of args.personnelIds) {
      const p = await ctx.db.get(pid);
      if (!p) continue;
      const existing = (await ctx.db
        .query("employeeReviews")
        .withIndex("by_personnel", (q) => q.eq("personnelId", pid))
        .collect()).find((r) => r.reviewType === args.reviewType && r.status !== "decided");
      if (existing) { ids.push(existing._id); continue; }
      const label = args.reviewType === "annual" ? `Annual Review ${new Date().getFullYear()}` : periodLabel(args.reviewType);
      const now = Date.now();
      const id = await ctx.db.insert("employeeReviews", {
        personnelId: pid, reviewType: args.reviewType, employeeName: `${p.firstName} ${p.lastName}`,
        position: p.position, department: p.department, hireDate: p.hireDate, reviewPeriodLabel: label,
        ratings: [], decision: "pending", status: "generated", createdByName: args.createdByName, createdAt: now, updatedAt: now,
      });
      ids.push(id);
    }
    return { ids, count: ids.length };
  },
});

export const saveScores = mutation({
  args: {
    requestingUserId: v.id("users"),
    id: v.id("employeeReviews"),
    ratings: v.array(RATING),
    reviewerName: v.optional(v.string()),
    generalComments: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const review = await ctx.db.get(args.id);
    if (!review) throw new Error("Review not found");
    const avg = averageOf(args.ratings);
    await ctx.db.patch(args.id, {
      ratings: args.ratings,
      averageScore: avg,
      recommendedIncrease: recommendedIncrease(avg, review.reviewType),
      reviewerName: args.reviewerName ?? review.reviewerName,
      generalComments: args.generalComments ?? review.generalComments,
      status: review.status === "decided" ? "decided" : "scored",
      updatedAt: Date.now(),
    });
    return { averageScore: avg, recommendedIncrease: recommendedIncrease(avg, review.reviewType) };
  },
});

export const setDecision = mutation({
  args: {
    requestingUserId: v.id("users"),
    id: v.id("employeeReviews"),
    decision: v.string(), // "approved" | "denied"
    approvedIncrease: v.optional(v.string()),
    decidedByName: v.string(),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const review = await ctx.db.get(args.id);
    if (!review) throw new Error("Review not found");
    await ctx.db.patch(args.id, {
      decision: args.decision,
      approvedIncrease: args.decision === "approved" ? (args.approvedIncrease ?? "") : undefined,
      decidedByName: args.decidedByName,
      decidedAt: Date.now(),
      status: "decided",
      updatedAt: Date.now(),
    });

    // Mirror onto the personnel profile timeline (ninetyDayReview / annualReviews).
    const p = await ctx.db.get(review.personnelId);
    if (p) {
      const noteParts = [
        `${review.reviewPeriodLabel}: avg ${review.averageScore ?? "—"}/5`,
        `rec ${review.recommendedIncrease ?? "—"}`,
        `${args.decision}${args.decision === "approved" && args.approvedIncrease ? ` (${args.approvedIncrease})` : ""}`,
      ];
      const note = noteParts.join(" · ");
      if (review.reviewType === "annual") {
        const arr = (p as any).annualReviews ?? [];
        arr.push({ cycleYear: new Date().getFullYear(), completedAt: Date.now(), completedBy: args.requestingUserId, completedByName: args.decidedByName, notes: note });
        await ctx.db.patch(review.personnelId, { annualReviews: arr } as any);
      } else {
        await ctx.db.patch(review.personnelId, {
          ninetyDayReview: { completedAt: Date.now(), completedBy: args.requestingUserId, completedByName: args.decidedByName, notes: note },
        } as any);
      }
    }
    return { success: true };
  },
});

export const remove = mutation({
  args: { requestingUserId: v.id("users"), id: v.id("employeeReviews") },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    await ctx.db.delete(args.id);
    return { success: true };
  },
});
