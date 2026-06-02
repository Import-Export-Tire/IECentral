import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./authGuards";

// ============ DEALER CRUD ============

export const listDealers = query({
  args: {
    program: v.optional(v.string()),
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let dealers = await ctx.db.query("dealerRebateDealers").collect();

    if (args.activeOnly !== false) {
      dealers = dealers.filter(d => d.isActive);
    }

    if (args.program) {
      dealers = dealers.filter(d => d.programs.includes(args.program!));
    }

    return dealers.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getDealersByJmk = query({
  args: { jmk: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dealerRebateDealers")
      .withIndex("by_jmk", (q) => q.eq("jmk", args.jmk))
      .collect();
  },
});

export const createDealer = mutation({
  args: {
    jmk: v.string(),
    name: v.string(),
    fanaticId: v.optional(v.number()),
    dealerNumber: v.optional(v.string()),
    programs: v.array(v.string()),
    primSec: v.optional(v.number()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    // Check: 1 JMK per Fanatic ID / Momentum number
    if (args.jmk) {
      const existingByJmk = await ctx.db
        .query("dealerRebateDealers")
        .withIndex("by_jmk", (q) => q.eq("jmk", args.jmk))
        .collect();
      const activeWithJmk = existingByJmk.filter(d => d.isActive);

      if (args.fanaticId && args.programs.includes("falken")) {
        const existing = activeWithJmk.find(d => d.fanaticId && d.fanaticId !== args.fanaticId && d.programs.includes("falken"));
        if (existing) {
          return { success: false, error: `JMK ${args.jmk} already has a Fanatic ID (${existing.fanaticId}) assigned to "${existing.name}"` };
        }
      }

      if (args.dealerNumber && args.programs.includes("milestar")) {
        const existing = activeWithJmk.find(d => d.dealerNumber && d.dealerNumber !== args.dealerNumber && d.programs.includes("milestar"));
        if (existing) {
          return { success: false, error: `JMK ${args.jmk} already has a Momentum # (${existing.dealerNumber}) assigned to "${existing.name}"` };
        }
      }
    }

    const id = await ctx.db.insert("dealerRebateDealers", {
      jmk: args.jmk,
      name: args.name,
      fanaticId: args.fanaticId,
      dealerNumber: args.dealerNumber,
      programs: args.programs,
      primSec: args.primSec,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { success: true, id };
  },
});

export const updateDealer = mutation({
  args: {
    id: v.id("dealerRebateDealers"),
    jmk: v.optional(v.string()),
    name: v.optional(v.string()),
    fanaticId: v.optional(v.number()),
    dealerNumber: v.optional(v.string()),
    programs: v.optional(v.array(v.string())),
    primSec: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const { id, requestingUserId: _ignored, ...updates } = args;

    // Check: 1 JMK per Fanatic ID / Momentum number (excluding self)
    const current = await ctx.db.get(id);
    const jmk = updates.jmk ?? current?.jmk;
    const fanaticId = updates.fanaticId ?? current?.fanaticId;
    const dealerNumber = updates.dealerNumber ?? current?.dealerNumber;
    const programs = updates.programs ?? current?.programs ?? [];

    if (jmk) {
      const existingByJmk = await ctx.db
        .query("dealerRebateDealers")
        .withIndex("by_jmk", (q) => q.eq("jmk", jmk))
        .collect();
      const activeWithJmk = existingByJmk.filter(d => d.isActive && d._id !== id);

      if (fanaticId && programs.includes("falken")) {
        const existing = activeWithJmk.find(d => d.fanaticId && d.fanaticId !== fanaticId && d.programs.includes("falken"));
        if (existing) {
          return { success: false, error: `JMK ${jmk} already has a Fanatic ID (${existing.fanaticId}) assigned to "${existing.name}"` };
        }
      }

      if (dealerNumber && programs.includes("milestar")) {
        const existing = activeWithJmk.find(d => d.dealerNumber && d.dealerNumber !== dealerNumber && d.programs.includes("milestar"));
        if (existing) {
          return { success: false, error: `JMK ${jmk} already has a Momentum # (${existing.dealerNumber}) assigned to "${existing.name}"` };
        }
      }
    }

    const cleanUpdates: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) cleanUpdates[key] = value;
    }
    await ctx.db.patch(id, cleanUpdates);
    return { success: true };
  },
});

export const deleteDealer = mutation({
  args: {
    id: v.id("dealerRebateDealers"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    await ctx.db.patch(args.id, { isActive: false, updatedAt: Date.now() });
    return { success: true };
  },
});

// ============ UPLOAD HISTORY ============

// Shared breakdown validator: one entry per (dealer, activity-month). qty is NET tires.
const dealerBreakdownValidator = v.array(v.object({
  jmk: v.string(),
  name: v.string(),
  fanaticId: v.optional(v.number()),
  dealerNumber: v.optional(v.string()),
  month: v.optional(v.string()),
  qty: v.optional(v.number()),
  rowCount: v.number(),
}));

export const saveUpload = mutation({
  args: {
    fileName: v.string(),
    program: v.string(),
    totalInputRows: v.number(),
    filteredRows: v.number(),
    matchedRows: v.number(),
    matchedQty: v.optional(v.number()), // optional for backward-compat with already-deployed client
    dealersMatched: v.number(),
    resultData: v.string(),
    dealerBreakdown: dealerBreakdownValidator,
    uploadedBy: v.id("users"),
    dateRangeStart: v.optional(v.string()),
    dateRangeEnd: v.optional(v.string()),
    s3Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.uploadedBy);
    // Idempotency: replace any prior upload for the same source file + program
    // so re-processing / backfill never double-counts.
    if (args.s3Key) {
      const existing = await ctx.db
        .query("dealerRebateUploads")
        .withIndex("by_s3key_program", (q) => q.eq("s3Key", args.s3Key).eq("program", args.program))
        .collect();
      for (const e of existing) await ctx.db.delete(e._id);
    }
    const id = await ctx.db.insert("dealerRebateUploads", {
      uploadDate: Date.now(),
      fileName: args.fileName,
      program: args.program,
      totalInputRows: args.totalInputRows,
      filteredRows: args.filteredRows,
      matchedRows: args.matchedRows,
      matchedQty: args.matchedQty,
      dealersMatched: args.dealersMatched,
      resultData: args.resultData,
      dealerBreakdown: args.dealerBreakdown,
      uploadedBy: args.uploadedBy,
      dateRangeStart: args.dateRangeStart,
      dateRangeEnd: args.dateRangeEnd,
      s3Key: args.s3Key,
      createdAt: Date.now(),
    });
    return { success: true, id };
  },
});

export const getUploads = query({
  args: {
    program: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let uploads = await ctx.db
      .query("dealerRebateUploads")
      .order("desc")
      .collect();

    if (args.program) {
      uploads = uploads.filter(u => u.program === args.program);
    }

    // Don't return resultData in list view (can be large)
    return uploads.map(u => ({
      _id: u._id,
      uploadDate: u.uploadDate,
      fileName: u.fileName,
      program: u.program,
      totalInputRows: u.totalInputRows,
      filteredRows: u.filteredRows,
      matchedRows: u.matchedRows,
      dealersMatched: u.dealersMatched,
      dealerBreakdown: u.dealerBreakdown,
      uploadedBy: u.uploadedBy,
      createdAt: u.createdAt,
    }));
  },
});

export const getUploadById = query({
  args: { id: v.id("dealerRebateUploads") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Helpers shared by the stats queries below.
// Net tires for a breakdown entry, with legacy fallback to row count.
function breakdownQty(b: { qty?: number; rowCount: number }): number {
  return b.qty ?? b.rowCount;
}
// Activity month for an entry, with legacy fallback to the upload month.
function breakdownMonth(b: { month?: string }, uploadDate: number): string {
  return b.month ?? new Date(uploadDate).toISOString().slice(0, 7);
}

// #3 — Dealer search: combined monthly totals for the matched dealer(s) + the per-file list.
export const searchUploadsByDealer = query({
  args: { searchTerm: v.string() },
  handler: async (ctx, args) => {
    const term = args.searchTerm.toLowerCase().trim();
    if (!term) return { monthly: [], uploads: [] };

    const uploads = await ctx.db.query("dealerRebateUploads").order("desc").collect();
    const match = (d: { jmk: string; name: string; fanaticId?: number; dealerNumber?: string }) =>
      d.jmk.toLowerCase().includes(term) ||
      d.name.toLowerCase().includes(term) ||
      (d.fanaticId != null && String(d.fanaticId).includes(term)) ||
      (d.dealerNumber != null && d.dealerNumber.toLowerCase().includes(term));

    const monthMap: Record<string, { falken: number; milestar: number }> = {};
    const matchedUploads: Array<{
      _id: typeof uploads[number]["_id"]; uploadDate: number; fileName: string;
      program: string; matchedDealers: typeof uploads[number]["dealerBreakdown"];
    }> = [];

    for (const u of uploads) {
      const hits = u.dealerBreakdown.filter(match);
      if (hits.length === 0) continue;
      for (const b of hits) {
        const month = breakdownMonth(b, u.uploadDate);
        const bucket = (monthMap[month] ??= { falken: 0, milestar: 0 });
        if (u.program === "falken") bucket.falken += breakdownQty(b);
        else bucket.milestar += breakdownQty(b);
      }
      matchedUploads.push({
        _id: u._id, uploadDate: u.uploadDate, fileName: u.fileName,
        program: u.program, matchedDealers: hits,
      });
    }

    const monthly = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, falken: v.falken, milestar: v.milestar, total: v.falken + v.milestar }));
    return { monthly, uploads: matchedUploads };
  },
});

// Stats: aggregate by ACTIVITY month + NET tire qty (replaces upload-time/row-count bucketing).
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const uploads = await ctx.db.query("dealerRebateUploads").collect();
    const monthMap: Record<string, { falken: number; milestar: number }> = {};
    const dealerMap: Record<string, { name: string; falken: number; milestar: number }> = {};
    for (const u of uploads) {
      for (const b of u.dealerBreakdown) {
        const month = breakdownMonth(b, u.uploadDate);
        const qty = breakdownQty(b);
        const mb = (monthMap[month] ??= { falken: 0, milestar: 0 });
        const db = (dealerMap[b.name] ??= { name: b.name, falken: 0, milestar: 0 });
        if (u.program === "falken") { mb.falken += qty; db.falken += qty; }
        else { mb.milestar += qty; db.milestar += qty; }
      }
    }
    return { monthMap, dealers: Object.values(dealerMap) };
  },
});

// #1 — Per-dealer monthly totals (net tires) for the compare-to-JMK view.
export const getDealerMonthlyTotals = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const term = (args.search ?? "").toLowerCase().trim();
    const uploads = await ctx.db.query("dealerRebateUploads").collect();
    const map: Record<string, { jmk: string; name: string; months: Record<string, { falken: number; milestar: number }> }> = {};
    for (const u of uploads) {
      for (const b of u.dealerBreakdown) {
        if (term && !(b.name.toLowerCase().includes(term) || b.jmk.toLowerCase().includes(term))) continue;
        const month = breakdownMonth(b, u.uploadDate);
        const qty = breakdownQty(b);
        const d = (map[b.name] ??= { jmk: b.jmk, name: b.name, months: {} });
        const mm = (d.months[month] ??= { falken: 0, milestar: 0 });
        if (u.program === "falken") mm.falken += qty;
        else mm.milestar += qty;
      }
    }
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  },
});

// Server-side ingest for the automated daily pipeline (no admin user). Idempotent by
// s3Key+program so re-processing the same file never double-counts. Public (called from
// /api/dealer-rebates/auto-process via ConvexHttpClient) — matches the existing jmkUploads
// server-write pattern. Not user-facing.
export const saveUploadAuto = mutation({
  args: {
    fileName: v.string(),
    program: v.string(),
    totalInputRows: v.number(),
    filteredRows: v.number(),
    matchedRows: v.number(),
    matchedQty: v.number(),
    dealersMatched: v.number(),
    resultData: v.string(),
    dealerBreakdown: dealerBreakdownValidator,
    dateRangeStart: v.optional(v.string()),
    dateRangeEnd: v.optional(v.string()),
    s3Key: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dealerRebateUploads")
      .withIndex("by_s3key_program", (q) => q.eq("s3Key", args.s3Key).eq("program", args.program))
      .collect();
    for (const e of existing) await ctx.db.delete(e._id);
    const id = await ctx.db.insert("dealerRebateUploads", {
      uploadDate: Date.now(),
      ...args,
      createdAt: Date.now(),
    });
    return { success: true, id };
  },
});

export const deleteUpload = mutation({
  args: {
    id: v.id("dealerRebateUploads"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

// Cleanup old uploads (> 12 months)
export const deleteOldUploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const twelveMonthsAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const oldUploads = await ctx.db
      .query("dealerRebateUploads")
      .collect();

    let deleted = 0;
    for (const upload of oldUploads) {
      if (upload.createdAt < twelveMonthsAgo) {
        await ctx.db.delete(upload._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

// ============ BACKFILL / MAINTENANCE ============
// One-off maintenance mutations for the qty/activity-month migration. Idempotent
// where noted. resultData CSV columns contain no embedded commas (toCSV only quotes
// fields with commas, and none of the rebate columns have them), so split(",") is safe.

// Recompute matchedQty + per-(dealer,month) breakdown for legacy uploads (those saved
// before qty/month existed) by re-deriving from their stored resultData CSV.
// Skips rows that already have matchedQty, so it is safe to re-run.
export const recomputeLegacyResultData = mutation({
  args: {},
  handler: async (ctx) => {
    const uploads = await ctx.db.query("dealerRebateUploads").collect();
    let patched = 0;
    for (const u of uploads) {
      if (u.matchedQty != null) continue;
      const lines = (u.resultData || "").split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        await ctx.db.patch(u._id, { matchedQty: 0 });
        patched++;
        continue;
      }
      const hdr = lines[0].split(",");
      const qi = hdr.indexOf("Quantity");
      const di = u.program === "falken" ? hdr.indexOf("Date") : hdr.indexOf("InvoiceDate");
      const idi = u.program === "falken"
        ? hdr.indexOf("FANATIC_Dealer_Account_Number")
        : hdr.indexOf("DealerNumber");

      // Map dealer-id -> existing breakdown entry (for name/jmk lookup).
      const byId = new Map<string, (typeof u.dealerBreakdown)[number]>();
      for (const b of u.dealerBreakdown) {
        const id = u.program === "falken" ? String(b.fanaticId ?? "") : String(b.dealerNumber ?? "");
        if (id) byId.set(id, b);
      }

      const groups = new Map<string, { id: string; month: string; qty: number; rowCount: number }>();
      let totalQty = 0;
      for (const ln of lines.slice(1)) {
        const p = ln.split(",");
        const q = parseFloat(p[qi] ?? "0") || 0;
        totalQty += q;
        const dm = (p[di] ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        let month = "";
        if (dm) {
          const mm = String(parseInt(dm[1], 10)).padStart(2, "0");
          let y = parseInt(dm[3], 10);
          if (y < 100) y += 2000;
          month = `${y}-${mm}`;
        }
        const id = (p[idi] ?? "").trim();
        const key = `${id}|${month}`;
        const g = groups.get(key) ?? { id, month, qty: 0, rowCount: 0 };
        g.qty += q;
        g.rowCount += 1;
        groups.set(key, g);
      }

      const newBreakdown = [...groups.values()].map((g) => {
        const orig = byId.get(g.id);
        return {
          jmk: orig?.jmk ?? "",
          name: orig?.name ?? "",
          fanaticId: orig?.fanaticId,
          dealerNumber: orig?.dealerNumber,
          month: g.month || undefined,
          qty: g.qty,
          rowCount: g.rowCount,
        };
      });
      await ctx.db.patch(u._id, { matchedQty: totalQty, dealerBreakdown: newBreakdown });
      patched++;
    }
    return { patched };
  },
});

// Delete MANUAL uploads (no s3Key) whose activity month >= fromMonth ("YYYY-MM").
// Used when re-ingesting those months from S3 as the source of truth (avoids double count).
// Leaves S3-ingested rows (those with s3Key) and earlier manual months untouched.
export const deleteManualUploadsFromMonth = mutation({
  args: { fromMonth: v.string() },
  handler: async (ctx, args) => {
    const uploads = await ctx.db.query("dealerRebateUploads").collect();
    const deleted: string[] = [];
    for (const u of uploads) {
      if (u.s3Key) continue; // keep S3-ingested rows
      const months = (u.dealerBreakdown.map((b) => b.month).filter(Boolean) as string[]).sort();
      const rowMonth = months[months.length - 1];
      if (rowMonth && rowMonth >= args.fromMonth) {
        await ctx.db.delete(u._id);
        deleted.push(`${u.fileName} (${u.program}, ${rowMonth})`);
      }
    }
    return { deletedCount: deleted.length, deleted };
  },
});

// ============ SEED DATA ============

export const seedDealers = mutation({
  args: { requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    // Check if already seeded
    const existing = await ctx.db.query("dealerRebateDealers").first();
    if (existing) {
      return { success: false, error: "Dealers already seeded" };
    }

    const now = Date.now();

    // Falken dealers
    const falkenDealers = [
      { jmk: "125", name: "Dumbauld's Tire Service Inc.", fanaticId: 31489, primSec: 2 },
      { jmk: "257", name: "Phil's Tire & Auto Repair", fanaticId: 18502, primSec: 1 },
      { jmk: "482", name: "Bruce Brothers Tire", fanaticId: 17861, primSec: 2 },
      { jmk: "499", name: "Camarote Service, LLC", fanaticId: 30534, primSec: 1 },
      { jmk: "704", name: "Don's Auto Service", fanaticId: 29179, primSec: 1 },
      { jmk: "763", name: "McCullough Tire", fanaticId: 30538, primSec: 2 },
      { jmk: "1075", name: "Bubnash Service", fanaticId: 28699, primSec: 2 },
      { jmk: "1110", name: "Parts Plus", fanaticId: 31462, primSec: 1 },
      { jmk: "1110", name: "Parts Plus", fanaticId: 31461, primSec: 1 },
      { jmk: "1153", name: "All About Auto", fanaticId: 30537, primSec: 2 },
      { jmk: "1270", name: "Barnes Garage Inc", fanaticId: 19090, primSec: 1 },
      { jmk: "1318", name: "R Tire Shop", fanaticId: 38387, primSec: 1 },
      { jmk: "1341", name: "Auto Land Hyundai", fanaticId: 18501, primSec: 1 },
      { jmk: "1382", name: "Himes Bros Tires", fanaticId: 20540, primSec: 2 },
      { jmk: "1580", name: "Peaslee's Service Center LLC", fanaticId: 37972, primSec: 1 },
      { jmk: "1713", name: "Collins Tire and Auto Sales", fanaticId: 31229, primSec: 2 },
      { jmk: "1898", name: "JACL, Inc.", fanaticId: 30527, primSec: 2 },
      { jmk: "1929", name: "Denny's Tire Service, LLC", fanaticId: 30560, primSec: 1 },
      { jmk: "1946", name: "Copelli's Auto Service", fanaticId: 29149, primSec: 1 },
      { jmk: "2235", name: "Cliff's Airway Auto LLC", fanaticId: 37581, primSec: 1 },
      { jmk: "2260", name: "Randy Redinger & Sons Llc", fanaticId: 18789, primSec: 1 },
      { jmk: "2578", name: "Mike's Auto Repair & Sales, Inc", fanaticId: 36347, primSec: 1 },
      { jmk: "2759", name: "Driftwood Auto Sales", fanaticId: 31048, primSec: 2 },
      { jmk: "2784", name: "Wheel Connection", fanaticId: 18465, primSec: 1 },
      { jmk: "3058", name: "Birch Street Garage", fanaticId: 18374, primSec: 1 },
      { jmk: "3214", name: "Hetrick's Service LLC", fanaticId: 38719, primSec: 2 },
      { jmk: "3335", name: "Auto Tech Plus", fanaticId: 28692, primSec: 1 },
      { jmk: "3389", name: "Clark Motorworks, LLC", fanaticId: 30533, primSec: 1 },
      { jmk: "3390", name: "Interstate Tire & Auto LLC", fanaticId: 36324, primSec: 1 },
      { jmk: "3406", name: "Dubois Auto Repair", fanaticId: 28274, primSec: 1 },
      { jmk: "3598", name: "The Tire Man's Garage", fanaticId: 30810, primSec: 2 },
      { jmk: "3655", name: "Hite's Garage", fanaticId: 21366, primSec: 2 },
      { jmk: "3682", name: "Tate's Auto Repair", fanaticId: 37985, primSec: 1 },
      { jmk: "3730", name: "Auto Specialties of Beaver County", fanaticId: 39319, primSec: 2 },
      { jmk: "3736", name: "Tire Agent Corp", fanaticId: 20280, primSec: 2 },
      { jmk: "3737", name: "Limitless Customs", fanaticId: 28936, primSec: 2 },
      { jmk: "3755", name: "Offroad Concepts LLC", fanaticId: 36883, primSec: 2 },
      { jmk: "3909", name: "G & D Tire & Auto Repair", fanaticId: 38857, primSec: 2 },
      { jmk: "3925", name: "Train Station Auto Inc.", fanaticId: 37579, primSec: 1 },
      { jmk: "3942", name: "K and M Treads, LLC", fanaticId: 35048, primSec: 2 },
      { jmk: "3978", name: "Pecks Auto Repair", fanaticId: 35307, primSec: 2 },
      { jmk: "3989", name: "Wilson Tire & Wheel", fanaticId: 35297, primSec: 2 },
      { jmk: "4017", name: "Woodheads Truck Repair Service, LLC", fanaticId: 35051, primSec: 2 },
      { jmk: "4060", name: "ATO Incorporated", fanaticId: 38021, primSec: 1 },
      { jmk: "4074", name: "Jimmy's Auto Center LLC", fanaticId: 35720, primSec: 1 },
      { jmk: "4124", name: "High Strung Motorsports Inc", fanaticId: 38754, primSec: 2 },
      { jmk: "4137", name: "Griff's Tire Supply, LLC", fanaticId: 42182, primSec: 1 },
      { jmk: "4163", name: "Action Auto Works LLC", fanaticId: 38003, primSec: 1 },
      { jmk: "4258", name: "Deans Auto Repair and Towing", fanaticId: 28621, primSec: 2 },
      { jmk: "4335", name: "Chris' Tire Service Inc.", fanaticId: 31225, primSec: 2 },
      { jmk: "4335", name: "Chris' Tire Service Inc.", fanaticId: 31224, primSec: 2 },
      { jmk: "4364", name: "Van's Tire of Medina Rd", fanaticId: 31341, primSec: 1 },
      { jmk: "r20", name: "Essey Tire Center", fanaticId: 17566, primSec: 1 },
      { jmk: "r25", name: "Command Trax, LLC", fanaticId: 18807, primSec: 1 },
      // Standalone Fanatic dealers (no JMK)
      { jmk: "", name: "Diesel'S Towing Recovery & Auto", fanaticId: 18442, primSec: 1 },
      { jmk: "", name: "Maverick Auto Service", fanaticId: 19045, primSec: 2 },
    ];

    // Milestar dealers
    const milestarDealers = [
      { jmk: "1412", name: "Auto Tech Auto Service Center", dealerNumber: "21051" },
      { jmk: "1946", name: "Copelli's Auto Service", dealerNumber: "21718" },
      { jmk: "3390", name: "Interstate Tire & Auto LLC", dealerNumber: "21841" },
      { jmk: "3406", name: "Dubois Auto Repair", dealerNumber: "20994" },
      { jmk: "3598", name: "Joe Hice LLC", dealerNumber: "21006" },
      { jmk: "3677", name: "H & H Offroad LLC", dealerNumber: "21004" },
      { jmk: "3859", name: "Sockaci Garage", dealerNumber: "22552" },
      { jmk: "3942", name: "K & M Treads LLC", dealerNumber: "21839" },
      { jmk: "3959", name: "AJ's Wide Range Diesel + Auto Repairs Corp", dealerNumber: "21005" },
      { jmk: "3960", name: "Glessner's Auto LLC", dealerNumber: "23439" },
      { jmk: "4074", name: "Jimmy's Auto Center LLC", dealerNumber: "21717" },
      { jmk: "4137", name: "Griffs Tire Supply LLC", dealerNumber: "21547" },
      { jmk: "4286", name: "Chris and Bob's Auto Shop LLC", dealerNumber: "23018" },
      { jmk: "r20", name: "TRD Tire, LLC", dealerNumber: "21008" },
      { jmk: "r25", name: "Command Trax, LLC", dealerNumber: "21007" },
      { jmk: "1898", name: "R N R", dealerNumber: "23724" },
    ];

    // Track which JMKs have Milestar enrollment
    const milestarByJmk = new Map<string, { dealerNumber: string }>();
    for (const d of milestarDealers) {
      milestarByJmk.set(d.jmk.toLowerCase(), { dealerNumber: d.dealerNumber });
    }

    // Insert Falken dealers, merging Milestar enrollment where JMK matches
    const insertedJmks = new Set<string>();
    for (const d of falkenDealers) {
      const jmkLower = d.jmk.toLowerCase();
      const milestar = milestarByJmk.get(jmkLower);
      const programs = milestar ? ["falken", "milestar"] : ["falken"];

      await ctx.db.insert("dealerRebateDealers", {
        jmk: d.jmk,
        name: d.name,
        fanaticId: d.fanaticId,
        dealerNumber: milestar?.dealerNumber,
        programs,
        primSec: d.primSec,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      if (milestar) insertedJmks.add(jmkLower);
    }

    // Insert Milestar-only dealers (not already inserted via Falken)
    for (const d of milestarDealers) {
      if (!insertedJmks.has(d.jmk.toLowerCase())) {
        await ctx.db.insert("dealerRebateDealers", {
          jmk: d.jmk,
          name: d.name,
          dealerNumber: d.dealerNumber,
          programs: ["milestar"],
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return { success: true, message: `Seeded ${falkenDealers.length} Falken + ${milestarDealers.length} Milestar dealers` };
  },
});
