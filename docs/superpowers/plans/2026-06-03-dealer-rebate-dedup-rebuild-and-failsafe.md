# Dealer-Rebate Dedup Rebuild + Upload Fail-Safe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make dealer-rebate monthly numbers authoritative regardless of source filenames (complete + de-duplicated), and reject+notify on uploads that aren't valid OEA07V (no parseable date / bad headers / not CSV).

**Architecture:** A new `dealerRebateMonthly` table is the deduped source of truth for stats, rebuilt per month from ALL of that month's S3 OEA07V files (dedup by SKU+dealer-id+invoice+date, latest-file-wins) via a Vercel `rebuild-month` route. Stats read the table, falling back to the legacy per-upload sum for months with no rows (March). A validation gate in `reports/process` blocks + notifies on invalid OEA07V uploads.

**Tech Stack:** Next.js API routes (Vercel, S3 creds present), Convex (schema/queries/mutations), `@aws-sdk/client-s3`, the shared `lib/dealerRebates/aggregate.ts`, `convex/notifications.create`. **No test framework** — verify via `npm run build`, `npx tsx` unit checks, and a gated live run (TC51/JMK reconcile + fail-safe). Prod deploy gated on user; reconciliation needs AWS creds at run time.

**Spec:** `docs/superpowers/specs/2026-06-03-dealer-rebate-dedup-rebuild-and-upload-failsafe-design.md`

---

## File Structure
- **Modify** `convex/schema.ts` — add `dealerRebateMonthly` table.
- **Modify** `convex/dealerRebates.ts` — add `setRebateMonthly`; rewrite `getStats` + `getDealerMonthlyTotals` to read the monthly table w/ upload fallback.
- **Create** `lib/dealerRebates/dedup.ts` — pure dedup+aggregate-to-monthly helper (shared by route + test).
- **Create** `lib/dealerRebates/dedup.test.ts` — `npx tsx` unit test.
- **Create** `app/api/dealer-rebates/rebuild-month/route.ts` — S3 read → dedup → `setRebateMonthly`.
- **Modify** `app/api/reports/process/route.ts` — OEA07V validation gate (reject+notify) + trigger `rebuild-month` after rebate.
- **Modify** `app/reports/upload/page.tsx` — block OEA07V uploads with zero parseable dates.

---

## Task 1: Schema + `setRebateMonthly` mutation

**Files:** Modify `convex/schema.ts`, `convex/dealerRebates.ts`

- [ ] **Step 1: Add table to `convex/schema.ts`** (after the `dealerRebateUploads` table block, before the next table):

```ts
  // Deduped per-(program, dealer, activity-month) net tires — source of truth for rebate stats.
  // Rebuilt from all of a month's S3 OEA07V files by /api/dealer-rebates/rebuild-month.
  dealerRebateMonthly: defineTable({
    month: v.string(),        // "YYYY-MM"
    program: v.string(),      // "falken" | "milestar"
    jmk: v.string(),
    name: v.string(),
    fanaticId: v.optional(v.number()),
    dealerNumber: v.optional(v.string()),
    qty: v.number(),          // NET tires
    rowCount: v.number(),
    updatedAt: v.number(),
  })
    .index("by_month", ["month"])
    .index("by_month_program", ["month", "program"]),
```

- [ ] **Step 2: Add `setRebateMonthly` to `convex/dealerRebates.ts`** (near the other mutations):

```ts
export const setRebateMonthly = mutation({
  args: {
    month: v.string(), // "YYYY-MM"
    rows: v.array(v.object({
      program: v.string(), jmk: v.string(), name: v.string(),
      fanaticId: v.optional(v.number()), dealerNumber: v.optional(v.string()),
      qty: v.number(), rowCount: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dealerRebateMonthly")
      .withIndex("by_month", (q) => q.eq("month", args.month))
      .collect();
    for (const e of existing) await ctx.db.delete(e._id);
    const now = Date.now();
    for (const r of args.rows) {
      await ctx.db.insert("dealerRebateMonthly", { month: args.month, ...r, updatedAt: now });
    }
    return { month: args.month, written: args.rows.length };
  },
});
```

- [ ] **Step 3: Typecheck** — `set -a && . ./.env.prod && set +a && npx convex codegen` then `npm run build`. Expected: compiles; `api.dealerRebates.setRebateMonthly` resolves. (codegen regenerates types; it does not deploy functions live — verified prior in this project.)
- [ ] **Step 4: Commit** — `git add convex/ && git commit -m "feat(rebate): dealerRebateMonthly table + setRebateMonthly"`

---

## Task 2: Dedup helper + unit test

**Files:** Create `lib/dealerRebates/dedup.ts`, `lib/dealerRebates/dedup.test.ts`

- [ ] **Step 1: Create `lib/dealerRebates/dedup.ts`** — takes per-file aggregate results + file order, dedups matched lines, returns per-(program,dealer) monthly rows for a target month. Operates on the aggregator's `outRows` (already matched to enrolled dealers).

```ts
// lib/dealerRebates/dedup.ts
import { aggregate, type RebateDealer, activityMonth } from "./aggregate";

export interface MonthlyRow {
  program: string; jmk: string; name: string;
  fanaticId?: number; dealerNumber?: string; qty: number; rowCount: number;
}

// Dedup key for a matched output line (uniquely identifies an invoice line for a dealer).
function lineKey(program: string, r: Record<string, string | number>): string {
  if (program === "falken")
    return `f|${r.SKU}|${r.FANATIC_Dealer_Account_Number}|${r.Invoice_Number}|${r.Date}`;
  return `m|${r.ProductCode}|${r.DealerNumber}|${r.InvoiceNumber}|${r.InvoiceDate}`;
}
function lineDate(program: string, r: Record<string, string | number>): string {
  return String(program === "falken" ? r.Date : r.InvoiceDate);
}

// files: [{ csvText, sortIndex }] oldest→newest (newest wins on duplicate key).
export function buildMonthlyRows(
  files: { csvText: string }[],
  dealers: RebateDealer[],
  targetMonth: string, // "YYYY-MM"
): MonthlyRow[] {
  // key -> {program, row, breakdownMeta}
  const seen = new Map<string, { program: string; qty: number; jmk: string; name: string; fanaticId?: number; dealerNumber?: string }>();
  for (const f of files) {
    const res = aggregate(f.csvText, dealers);
    for (const prog of ["falken", "milestar"] as const) {
      const pr = res[prog];
      // map dealer id -> breakdown meta (jmk/name) for this file
      const metaById = new Map<string, { jmk: string; name: string; fanaticId?: number; dealerNumber?: string }>();
      for (const b of pr.breakdown) {
        const id = prog === "falken" ? String(b.fanaticId ?? "") : String(b.dealerNumber ?? "");
        metaById.set(id, { jmk: b.jmk, name: b.name, fanaticId: b.fanaticId, dealerNumber: b.dealerNumber });
      }
      for (const row of pr.outRows) {
        if (activityMonth(lineDate(prog, row)) !== targetMonth) continue;
        const id = String(prog === "falken" ? row.FANATIC_Dealer_Account_Number : row.DealerNumber);
        const meta = metaById.get(id);
        if (!meta) continue;
        const qty = parseFloat(String(row.Quantity)) || 0;
        seen.set(lineKey(prog, row), { program: prog, qty, ...meta }); // last (newest) wins
      }
    }
  }
  // aggregate deduped lines per (program, dealer)
  const agg = new Map<string, MonthlyRow>();
  for (const v of seen.values()) {
    const k = `${v.program}|${v.jmk}|${v.fanaticId ?? v.dealerNumber ?? ""}`;
    const cur = agg.get(k) ?? { program: v.program, jmk: v.jmk, name: v.name, fanaticId: v.fanaticId, dealerNumber: v.dealerNumber, qty: 0, rowCount: 0 };
    cur.qty += v.qty; cur.rowCount += 1;
    agg.set(k, cur);
  }
  return [...agg.values()];
}
```

- [ ] **Step 2: Create `lib/dealerRebates/dedup.test.ts`**:

```ts
// Run: npx tsx lib/dealerRebates/dedup.test.ts
import { buildMonthlyRows } from "./dedup";
import type { RebateDealer } from "./aggregate";
import assert from "node:assert";

const dealers: RebateDealer[] = [
  { jmk: "125", name: "D1", fanaticId: 31489, programs: ["falken"], isActive: true },
];
const pad = (o: Record<number, string>) => { const a = Array(19).fill(""); for (const k in o) a[+k] = o[k]; return a.join(","); };
const sale = (sku: string, qty: string, inv: string, date: string) =>
  pad({ 3: "T1", 4: "FAL", 5: sku, 10: qty, 15: "125", 16: inv, 18: date });

// Same invoice line in two files (e.g. daily + re-export) → counted ONCE.
const fileA = ["H", sale("SKU1", "-4", "INV1", "05/07/26")].join("\n");
const fileB = ["H", sale("SKU1", "-4", "INV1", "05/07/26"), sale("SKU2", "-2", "INV2", "05/08/26")].join("\n");
let rows = buildMonthlyRows([{ csvText: fileA }, { csvText: fileB }], dealers, "2026-05");
let d1 = rows.find(r => r.program === "falken")!;
assert.equal(d1.qty, 6, "dedup: 4 (INV1 once) + 2 (INV2) = 6"); // not 10

// Amended qty: same key, newer file wins.
const f1 = ["H", sale("SKU1", "-4", "INV1", "05/07/26")].join("\n");
const f2 = ["H", sale("SKU1", "-2", "INV1", "05/07/26")].join("\n"); // corrected to 2
rows = buildMonthlyRows([{ csvText: f1 }, { csvText: f2 }], dealers, "2026-05");
assert.equal(rows[0].qty, 2, "amendment: newest wins -> 2");

// Out-of-month lines excluded.
rows = buildMonthlyRows([{ csvText: ["H", sale("S","-4","I","04/30/26")].join("\n") }], dealers, "2026-05");
assert.equal(rows.length, 0, "april line excluded from may");
console.log("OK: dedup.test.ts passed");
```

- [ ] **Step 3: Run, expect PASS** — `npx --yes tsx lib/dealerRebates/dedup.test.ts` → `OK: dedup.test.ts passed`. Fix `dedup.ts` until it passes.
- [ ] **Step 4: Commit** — `git add lib/dealerRebates/dedup.ts lib/dealerRebates/dedup.test.ts && git commit -m "feat(rebate): deduped monthly aggregation helper + test"`

---

## Task 3: `rebuild-month` route

**Files:** Create `app/api/dealer-rebates/rebuild-month/route.ts`

- [ ] **Step 1: Create the route.** Lists the month + next-month S3 folders, downloads each OEA07V CSV (skipping oversized dumps), builds deduped monthly rows, writes via `setRebateMonthly`.

```ts
import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { buildMonthlyRows } from "@/lib/dealerRebates/dedup";
import type { RebateDealer } from "@/lib/dealerRebates/aggregate";

const BUCKET = "ietires-dunlop-jmk-uploads";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";
const MAX_FILE_BYTES = 50 * 1024 * 1024; // skip full-year dumps (~400k rows); month filter would drop them anyway
const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } } : {}),
});

function nextMonth(yyyymm: string): string {
  const y = +yyyymm.slice(0, 4), m = +yyyymm.slice(4, 6);
  const d = new Date(y, m, 1); // m is 1-based -> Date month index m = next month
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function POST(request: NextRequest) {
  try {
    const { month } = await request.json(); // "YYYYMM"
    if (!month || !/^\d{6}$/.test(month)) return NextResponse.json({ error: "month YYYYMM required" }, { status: 400 });
    const targetMonth = `${month.slice(0, 4)}-${month.slice(4, 6)}`; // "YYYY-MM"

    const convex = new ConvexHttpClient(CONVEX_URL);
    const dealers = (await convex.query(api.dealerRebates.listDealers, {})) as RebateDealer[];

    const prefixes = [`jmk-uploads/${month}/`, `jmk-uploads/${nextMonth(month)}/`];
    const objs: { Key: string; LastModified?: Date; Size?: number }[] = [];
    for (const Prefix of prefixes) {
      let token: string | undefined;
      do {
        const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix, ContinuationToken: token }));
        for (const o of r.Contents || []) {
          const k = (o.Key || "").toLowerCase();
          if (k.includes("iet-oea07v") && k.endsWith(".csv")) objs.push({ Key: o.Key!, LastModified: o.LastModified, Size: o.Size });
        }
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
    }
    objs.sort((a, b) => (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0));

    const files: { csvText: string }[] = [];
    const skipped: string[] = [];
    for (const o of objs) {
      if ((o.Size ?? 0) > MAX_FILE_BYTES) { skipped.push(o.Key); continue; }
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: o.Key }));
      const body = await res.Body?.transformToString("utf-8");
      if (body) files.push({ csvText: body });
    }

    const rows = buildMonthlyRows(files, dealers, targetMonth);
    await convex.mutation(api.dealerRebates.setRebateMonthly, { month: targetMonth, rows });

    return NextResponse.json({
      status: "success", month: targetMonth,
      filesProcessed: files.length, filesSkipped: skipped,
      dealerRows: rows.length, totalQty: rows.reduce((s, r) => s + r.qty, 0),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "rebuild failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build** — `npm run build`. Expected: compiles.
- [ ] **Step 3: Commit** — `git commit -am "feat(rebate): rebuild-month route (S3 dedup -> dealerRebateMonthly)"`

---

## Task 4: Stats read from `dealerRebateMonthly` (with March fallback)

**Files:** Modify `convex/dealerRebates.ts` (`getStats`, `getDealerMonthlyTotals`)

- [ ] **Step 1: Rewrite `getStats`** to build from `dealerRebateMonthly`, falling back to `dealerRebateUploads` for months that have no monthly rows:

```ts
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const monthly = await ctx.db.query("dealerRebateMonthly").collect();
    const monthsWithData = new Set(monthly.map((m) => m.month));
    const monthMap: Record<string, { falken: number; milestar: number }> = {};
    const dealerMap: Record<string, { name: string; falken: number; milestar: number }> = {};
    const add = (month: string, program: string, name: string, qty: number) => {
      const mb = (monthMap[month] ??= { falken: 0, milestar: 0 });
      const db = (dealerMap[name] ??= { name, falken: 0, milestar: 0 });
      if (program === "falken") { mb.falken += qty; db.falken += qty; }
      else { mb.milestar += qty; db.milestar += qty; }
    };
    for (const r of monthly) add(r.month, r.program, r.name, r.qty);
    // Fallback: months with NO monthly rows (e.g. March, manual-only) come from uploads.
    const uploads = await ctx.db.query("dealerRebateUploads").collect();
    for (const u of uploads) {
      for (const b of u.dealerBreakdown) {
        const month = b.month ?? new Date(u.uploadDate).toISOString().slice(0, 7);
        if (monthsWithData.has(month)) continue;
        add(month, u.program, b.name, b.qty ?? b.rowCount);
      }
    }
    return { monthMap, dealers: Object.values(dealerMap) };
  },
});
```

- [ ] **Step 2: Rewrite `getDealerMonthlyTotals`** analogously (build `name -> month -> {falken,milestar}` from `dealerRebateMonthly`, fallback to uploads for months not in `monthsWithData`, apply the `search` filter on `name`/`jmk`). Keep the same return shape (`Array<{ jmk, name, months }>`).

```ts
export const getDealerMonthlyTotals = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const term = (args.search ?? "").toLowerCase().trim();
    const monthly = await ctx.db.query("dealerRebateMonthly").collect();
    const monthsWithData = new Set(monthly.map((m) => m.month));
    const map: Record<string, { jmk: string; name: string; months: Record<string, { falken: number; milestar: number }> }> = {};
    const add = (jmk: string, name: string, month: string, program: string, qty: number) => {
      if (term && !(name.toLowerCase().includes(term) || jmk.toLowerCase().includes(term))) return;
      const d = (map[name] ??= { jmk, name, months: {} });
      const mm = (d.months[month] ??= { falken: 0, milestar: 0 });
      if (program === "falken") mm.falken += qty; else mm.milestar += qty;
    };
    for (const r of monthly) add(r.jmk, r.name, r.month, r.program, r.qty);
    const uploads = await ctx.db.query("dealerRebateUploads").collect();
    for (const u of uploads) for (const b of u.dealerBreakdown) {
      const month = b.month ?? new Date(u.uploadDate).toISOString().slice(0, 7);
      if (monthsWithData.has(month)) continue;
      add(b.jmk, b.name, month, u.program, b.qty ?? b.rowCount);
    }
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  },
});
```

- [ ] **Step 3: Typecheck** — `npx convex codegen` + `npm run build`.
- [ ] **Step 4: Commit** — `git commit -am "feat(rebate): stats read dealerRebateMonthly with upload fallback"`

---

## Task 5: Validation gate + rebuild trigger in `reports/process`

**Files:** Modify `app/api/reports/process/route.ts`

- [ ] **Step 1: Add S3 + validation at the top of the OEA07V branch.** Before running the 3 triggers, download the file, validate headers + a parseable activity date; on failure mark rejected, notify the uploader, and return without processing.

```ts
// imports
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
const BUCKET = "ietires-dunlop-jmk-uploads";
const s3 = new S3Client({ region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } } : {}) });
const OEA07V_HEADER_COLS = ["Item Id", "Product Type", "MFG Id"];

// inside POST, when reportType === "OEA07V", BEFORE Promise.allSettled:
const body = (await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }))).Body?.transformToString("utf-8")) || "";
const lines = body.replace(/^﻿/, "").replace(/\0/g, "").split(/\r?\n/).filter((l) => l.trim());
const header = (lines[0] || "").toLowerCase();
const headersOk = OEA07V_HEADER_COLS.every((c) => header.includes(c.toLowerCase()));
const hasDate = lines.slice(1, 2000).some((l) => /(?:^|,)\s*"?\d{1,2}\/\d{1,2}\/\d{2,4}"?/.test(l.split(",")[18] ?? l));
const reason = lines.length < 2 ? "File is empty or not a CSV"
  : !headersOk ? "Missing expected OEA07V columns (Item Id / Product Type / MFG Id)"
  : !hasDate ? "No rows with a parseable Activity Date (column S, MM/DD/YY)"
  : null;
if (reason) {
  const upload = await convex.query(api.jmkUploads.getUpload, { uploadId: uploadId as Id<"jmkUploadHistory"> });
  await convex.mutation(api.jmkUploads.updateProcessing, {
    uploadId: uploadId as Id<"jmkUploadHistory">, processingStatus: "rejected",
    processingResults: [{ trigger: "validation", status: "failed", message: reason, completedAt: Date.now() }],
  });
  if (upload?.uploadedBy) {
    await convex.mutation(api.notifications.create, {
      userId: upload.uploadedBy, type: "report_rejected",
      title: "OEA07V upload rejected",
      message: `${upload.fileName || s3Key}: ${reason}`, link: "/reports/upload",
    });
  }
  return NextResponse.json({ status: "rejected", reason }, { status: 422 });
}
```
*(Column-18 access: `l.split(",")[18]` is a cheap heuristic; the regex also falls back to scanning the whole line for an MM/DD/YY token. Confirm against a real file in Task 7.)*

- [ ] **Step 2: Trigger rebuild after the rebate result.** After the `Promise.allSettled` triggers complete (rebate included), fire `rebuild-month` for the file's month + prior month (fire-and-forget; don't block the response):

```ts
const mNum = (month && /^\d{6}$/.test(month)) ? month : undefined;
const monthsToRebuild = mNum ? [mNum, prevMonthOf(mNum)] : [];
await Promise.allSettled(monthsToRebuild.map((mm) =>
  fetch(`${APP_URL}/api/dealer-rebates/rebuild-month`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: mm }),
  }),
));
// helper:
function prevMonthOf(yyyymm: string): string { const y=+yyyymm.slice(0,4),m=+yyyymm.slice(4,6); const d=new Date(y,m-2,1); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; }
```
*(If `month` isn't passed in the body, derive from the file's dates — but `reports/process` already receives `month`; confirm and use it.)*

- [ ] **Step 3: Build** — `npm run build`.
- [ ] **Step 4: Commit** — `git commit -am "feat(reports): reject+notify invalid OEA07V; trigger rebate rebuild-month"`

---

## Task 6: Upload-screen immediate error for no-date OEA07V

**Files:** Modify `app/reports/upload/page.tsx`

- [ ] **Step 1:** The validate handler already scans OEA07V dates into a local `dates` array (around lines 119-165). After that scan, if `reportType === "OEA07V"` and `dates.length === 0`, treat as invalid: set `uploadState` to `"error"`, `errorMsg` to "No rows with a parseable Activity Date — this doesn't look like an OEA07V export.", and ensure the upload button is blocked when `uploadState === "error"` / validation invalid. (Headers-invalid path already blocks; extend the same gate to the no-date case.) Keep the existing valid path unchanged.

- [ ] **Step 2: Build + manual check** — `npm run build`; on the upload page, selecting a CSV with no dates shows the inline error and the upload is blocked.
- [ ] **Step 3: Commit** — `git commit -am "feat(reports): upload screen rejects OEA07V with no parseable dates"`

---

## Task 7: Deploy + gated reconciliation + verification

- [ ] **Step 1: Deploy** — merge `feature/rebate-dedup-rebuild` → `main` (Vercel deploys frontend + `convex deploy`). **Gated on user.**
- [ ] **Step 2: Reconcile (needs AWS creds for the route to read S3 — the route uses Vercel's creds, so just POST):** for each month, `curl -s -X POST https://www.iecentral.com/api/dealer-rebates/rebuild-month -H 'Content-Type: application/json' -d '{"month":"202604"}'` (then `202605`, `202606`). March (`202603`) has no S3 folder → served by the upload-fallback automatically.
- [ ] **Step 3: Verify dedup correctness:**
  - `npx convex run dealerRebates:getDealerMonthlyTotals '{"search":"TRD"}'` → **TRD May Falken = 224** (the May-7 generic file is now absorbed via S3 listing).
  - `getStats` May Falken total is sensible and not doubled vs the prior per-upload number.
  - Spot-check one more dealer/month against a JMK report.
- [ ] **Step 4: Verify fail-safe live:** upload (a) a non-CSV, (b) a CSV with OEA07V headers but blanked Activity Date column, (c) a wrong-header CSV → each rejected (not processed; `jmkUploadHistory.processingStatus = "rejected"`), an in-app notification appears for the uploader, and the upload screen shows the error. A valid daily OEA07V still processes AND triggers a rebuild (TRD/others update).

---

## Self-Review

- **Spec coverage:** A1 table → T1; A2 rebuild route → T3 (+ dedup helper T2); A3 setRebateMonthly → T1; A4 stats rewire → T4; A5 stay-current trigger → T5 step 2; A6 reconciliation → T7; A7 March fallback → T4 (fallback to uploads for monthsWithoutData). B1 reject gate → T5 step 1; B2 upload-screen error → T6; B3 validate (the UI already scans dates — reused, no separate route change needed). ✓
- **Type consistency:** `MonthlyRow` (T2) matches `setRebateMonthly.rows` (T1) and `getStats`/`getDealerMonthlyTotals` consumption (T4). `buildMonthlyRows(files, dealers, targetMonth)` signature used identically in T2/T3. `notifications.create({userId,type,title,message,link})` matches the real signature. ✓
- **Dedup correctness:** key = SKU/ProductCode + dealer-id + invoice + date; latest-file-wins (Map overwrite, files sorted oldest→newest); month filter on the line's own date — covered by the T2 unit test (overlap→once, amendment→newest, out-of-month→excluded). ✓
- **No double-count with uploads:** stats use `dealerRebateMonthly` for any month that has rows; uploads are fallback ONLY for months with no monthly rows — so a month can't be counted from both sources. ✓
- **Placeholders:** the column-18 date heuristic + "confirm `month` is passed" are flagged with concrete fallbacks and a Task-7 verification, not gaps. ✓
