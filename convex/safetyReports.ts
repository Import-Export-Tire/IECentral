import { mutation, query, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { QueryCtx, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Anonymous reports can be sensitive (harassment/theft), so access is intentionally
// tight: super_admin by default. Individual non-super-admins can be granted the
// SSS inbox WITHOUT a full role bump via permissionOverrides["safetyReports.review"].
// (Same three-state grant/deny mechanism as menu.training.)
const REVIEW_PERMISSION = "safetyReports.review";

/** True if the user may review SSS reports: super_admin, or explicitly granted the override. */
function canReviewSafetyReports(user: { role?: string; permissionOverrides?: Record<string, boolean> | null } | null): boolean {
  if (!user) return false;
  const override = (user.permissionOverrides ?? {})[REVIEW_PERMISSION];
  if (override !== undefined) return override; // explicit grant OR explicit deny wins
  return user.role === "super_admin";
}

/**
 * Guard for every reviewer-only SSS endpoint. Replaces requireRole(super_admin):
 * honors the per-user override so Travis-style scoped grants work.
 */
async function requireSafetyReviewer(ctx: QueryCtx | MutationCtx, requestingUserId: Id<"users">): Promise<void> {
  const user = await ctx.db.get(requestingUserId);
  if (!canReviewSafetyReports(user)) {
    throw new Error("Unauthorized: reviewing anonymous reports requires super_admin or the See Something, Say Something reviewer permission");
  }
}

/**
 * Admin utility: grant or revoke the SSS reviewer permission for exactly one
 * person, resolved by name or email. Internal-only (callable via `npx convex run`
 * with a deploy key, never from a client).
 *
 * Safety by design:
 *  - Refuses unless EXACTLY ONE active user matches — never guesses between
 *    two people, because the wrong grant leaks harassment/theft reports.
 *  - MERGES into existing permissionOverrides (updateUser replaces wholesale;
 *    this must not wipe a user's other grants).
 *  - Returns the resolved identity + before/after so the caller can verify.
 */
export const setReviewerAccess = internalMutation({
  args: { query: v.string(), grant: v.boolean() },
  handler: async (ctx, args) => {
    const needle = args.query.trim().toLowerCase();
    if (!needle) throw new Error("query is required (a name or email)");

    const all = await ctx.db.query("users").collect();
    const matches = all.filter(
      (u) =>
        u.isActive !== false &&
        ((u.name ?? "").trim().toLowerCase() === needle ||
          (u.email ?? "").trim().toLowerCase() === needle),
    );

    if (matches.length === 0) {
      throw new Error(`No active user matches "${args.query}". Nothing changed.`);
    }
    if (matches.length > 1) {
      const who = matches.map((u) => `${u.name} <${u.email ?? "no email"}> [${u._id}]`).join("; ");
      throw new Error(
        `Ambiguous: ${matches.length} active users match "${args.query}" — ${who}. ` +
          `Re-run with the exact email to disambiguate. Nothing changed.`,
      );
    }

    const user = matches[0];
    const before = { ...(user.permissionOverrides ?? {}) };
    const after = { ...before, ["safetyReports.review"]: args.grant };
    await ctx.db.patch(user._id, { permissionOverrides: after });

    return {
      changed: true,
      action: args.grant ? "GRANTED" : "REVOKED",
      userId: user._id,
      name: user.name,
      email: user.email ?? null,
      role: user.role,
      before,
      after,
    };
  },
});

const CATEGORY_LABELS: Record<string, string> = {
  safety: "Safety hazard",
  security: "Security / suspicious activity",
  theft: "Theft",
  harassment: "Harassment / misconduct",
  other: "Other",
};

// Reference code shown to the (anonymous) reporter so they can reference the report later.
function makeReferenceCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let suffix = "";
  // Date.now() is allowed in mutations; mix it with the table's own randomness-free entropy.
  let n = Date.now();
  for (let i = 0; i < 5; i++) {
    suffix += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length) + (i + 1) * 7;
  }
  return `SR-${suffix}`;
}

/**
 * Public, UNAUTHENTICATED submission from the /report poster form. Stores only what the
 * reporter types (no IP/identifiers). Schedules a best-effort notification fan-out.
 */
export const submit = mutation({
  args: {
    category: v.string(),
    locationId: v.optional(v.id("locations")),
    locationName: v.optional(v.string()),
    description: v.string(),
    occurredAt: v.optional(v.string()),
    photoFileId: v.optional(v.id("_storage")),
    reporterName: v.optional(v.string()),
    reporterPhone: v.optional(v.string()),
    reporterEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const description = (args.description || "").trim();
    if (!description) throw new Error("A description is required");
    const category = CATEGORY_LABELS[args.category] ? args.category : "other";
    const referenceCode = makeReferenceCode();
    const now = Date.now();

    // Resolve a location name snapshot if an id was given but no name.
    let locationName = args.locationName;
    if (!locationName && args.locationId) {
      const loc = await ctx.db.get(args.locationId);
      locationName = loc?.name;
    }

    const reportId = await ctx.db.insert("safetyReports", {
      category,
      locationId: args.locationId,
      locationName,
      description,
      occurredAt: args.occurredAt?.trim() || undefined,
      photoFileId: args.photoFileId,
      reporterName: args.reporterName?.trim() || undefined,
      reporterPhone: args.reporterPhone?.trim() || undefined,
      reporterEmail: args.reporterEmail?.trim() || undefined,
      referenceCode,
      status: "new",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.safetyReports.notifyNewReport, { reportId });
    return { referenceCode };
  },
});

/**
 * Returns a storage upload URL for an optional report photo. Secret-gated so only our
 * server route (/api/safety-reports/photo, which strips EXIF first) can store images —
 * the public form never touches storage directly.
 */
export const generatePhotoUploadUrl = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    if (!process.env.PREVIEW_PDF_SECRET || args.secret !== process.env.PREVIEW_PDF_SECRET) {
      throw new Error("unauthorized");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/** Admin-guarded: signed URL for a report's photo (for the review inbox). */
export const getPhotoUrl = query({
  args: { requestingUserId: v.id("users"), reportId: v.id("safetyReports") },
  handler: async (ctx, args): Promise<string | null> => {
    await requireSafetyReviewer(ctx, args.requestingUserId);
    const report = await ctx.db.get(args.reportId);
    if (!report || !report.photoFileId) return null;
    return await ctx.storage.getUrl(report.photoFileId);
  },
});

/** Internal: load a report + the recipient users (admins) for the notification fan-out. */
export const _notifyData = internalQuery({
  args: { reportId: v.id("safetyReports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return null;
    const users = await ctx.db.query("users").collect();
    // Same predicate as the review guard, so override-granted reviewers (e.g. a
    // scoped grant) receive new-report alerts too — not just super_admins.
    const recipients = users
      .filter((u) => canReviewSafetyReports(u) && u.isActive !== false)
      .map((u) => ({ id: u._id, email: u.email as string | undefined }));
    return { report, recipients };
  },
});

/**
 * Internal action: fan out a new-report alert to admins via in-app notification (+web push,
 * handled inside notifications.create) and an email. Best-effort — one channel failing must
 * not block the others; the report is already committed before this runs.
 */
export const notifyNewReport = internalAction({
  args: { reportId: v.id("safetyReports") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.safetyReports._notifyData, { reportId: args.reportId });
    if (!data) return;
    const { report, recipients } = data;
    const catLabel = CATEGORY_LABELS[report.category] || report.category;
    const where = report.locationName ? ` at ${report.locationName}` : "";
    const title = "New anonymous report";
    const message = `${catLabel}${where} — ${report.referenceCode}`;

    // In-app notification + push, one per recipient.
    for (const r of recipients) {
      try {
        await ctx.runMutation(api.notifications.create, {
          userId: r.id,
          type: "safety_report",
          title,
          message,
          link: "/safety-reports",
          relatedId: args.reportId,
        });
      } catch (e) {
        console.error("[safetyReports] in-app notify failed for", r.id, e);
      }
    }

    // Email alert.
    try {
      const to = recipients.map((r) => r.email).filter((e): e is string => !!e);
      if (to.length) {
        await ctx.runAction(internal.safetyReports.sendReportEmail, {
          to,
          category: catLabel,
          locationName: report.locationName,
          description: report.description,
          occurredAt: report.occurredAt,
          referenceCode: report.referenceCode,
          hasContact: !!(report.reporterName || report.reporterPhone || report.reporterEmail),
        });
      }
    } catch (e) {
      console.error("[safetyReports] email alert failed", e);
    }
  },
});

/** Internal action: send the new-report alert email via Resend (mirrors convex/emails.ts). */
export const sendReportEmail = internalAction({
  args: {
    to: v.array(v.string()),
    category: v.string(),
    locationName: v.optional(v.string()),
    description: v.string(),
    occurredAt: v.optional(v.string()),
    referenceCode: v.string(),
    hasContact: v.boolean(),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("[safetyReports] RESEND_API_KEY not configured");
      return { success: false };
    }
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.iecentral.com";
    const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c));
    const rows = [
      ["Category", args.category],
      ["Location", args.locationName || "Not specified"],
      ["When", args.occurredAt || "Not specified"],
      ["Reference", args.referenceCode],
      ["Reporter contact", args.hasContact ? "Provided (see report)" : "Anonymous"],
    ]
      .map(
        ([k, val]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;">${k}</td><td style="padding:4px 0;font-size:13px;color:#111827;">${esc(val)}</td></tr>`,
      )
      .join("");
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">
        <h2 style="color:#b91c1c;margin:0 0 4px;">New anonymous report</h2>
        <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">Submitted via the "See Something, Say Something" form.</p>
        <table style="border-collapse:collapse;margin-bottom:16px;">${rows}</table>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;">
          <div style="color:#6b7280;font-size:12px;margin-bottom:4px;">Description</div>
          <div style="font-size:14px;color:#111827;white-space:pre-wrap;">${esc(args.description)}</div>
        </div>
        <p style="margin:20px 0 0;"><a href="${appUrl}/safety-reports" style="background:#b91c1c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;">Review in IE Central</a></p>
      </div>`;
    try {
      const result = await resend.emails.send({
        from: "Import Export Tire Co <alerts@notifications.iecentral.com>",
        replyTo: "andy@ietires.com",
        to: args.to,
        subject: `New anonymous report — ${args.category} (${args.referenceCode})`,
        html,
        text: `New anonymous report\nCategory: ${args.category}\nLocation: ${args.locationName || "Not specified"}\nWhen: ${args.occurredAt || "Not specified"}\nReference: ${args.referenceCode}\n\n${args.description}\n\nReview: ${appUrl}/safety-reports`,
      });
      return { success: true, emailId: result.data?.id };
    } catch (error) {
      console.error("[safetyReports] Resend send failed", error);
      return { success: false, error: String(error) };
    }
  },
});

// ============ ADMIN: review inbox ============

export const list = query({
  args: {
    requestingUserId: v.id("users"),
    status: v.optional(v.string()),
    category: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
  },
  handler: async (ctx, args) => {
    await requireSafetyReviewer(ctx, args.requestingUserId);
    let reports = await ctx.db.query("safetyReports").withIndex("by_created").order("desc").collect();
    if (args.status) reports = reports.filter((r) => r.status === args.status);
    if (args.category) reports = reports.filter((r) => r.category === args.category);
    if (args.locationId) reports = reports.filter((r) => r.locationId === args.locationId);
    return reports;
  },
});

export const counts = query({
  args: { requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireSafetyReviewer(ctx, args.requestingUserId);
    const reports = await ctx.db.query("safetyReports").collect();
    return {
      total: reports.length,
      new: reports.filter((r) => r.status === "new").length,
      in_review: reports.filter((r) => r.status === "in_review").length,
    };
  },
});

export const updateStatus = mutation({
  args: {
    requestingUserId: v.id("users"),
    reportId: v.id("safetyReports"),
    status: v.optional(v.string()),
    reviewNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSafetyReviewer(ctx, args.requestingUserId);
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");
    const user = await ctx.db.get(args.requestingUserId);
    await ctx.db.patch(args.reportId, {
      updatedAt: Date.now(),
      reviewedBy: args.requestingUserId,
      reviewedByName: user?.name,
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.reviewNotes !== undefined ? { reviewNotes: args.reviewNotes } : {}),
    });
  },
});
