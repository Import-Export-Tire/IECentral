# Dealer-Rebate Dedup Rebuild + Upload Fail-Safe — Design

**Date:** 2026-06-03
**Status:** Approved (design); pending spec review → implementation plan

## Problem

The dealer-rebate stats are built by **summing per-file uploads** (`dealerRebateUploads.dealerBreakdown`) with **no cross-file de-duplication**, and ingestion only picks up **date-stamped daily files** (`IET-oea07v_MMDDYY.csv`). Two failure modes result:

1. **Silent under-count** — a day exported under a non-date-stamped name is skipped entirely. Confirmed live: TRD Tire's May Falken read **220 vs the JMK actual 224** because the **May 7 export was saved as the generic `IET-oea07v.csv`**, so all of May 7 was missing. (Fixed manually by ingesting that one file; April is worse — partial generic dailies overlapping each other + 2025 full-year dumps.)
2. **Double-count risk** — the same invoice line appearing in two files (daily + a re-export/rollup) is counted twice, because the per-file sums never de-duplicate.

Plus there's **no guard at upload**: a file with no parseable date, wrong headers, or wrong type is processed (or silently produces nothing) with no feedback to the uploader.

## Goals

- Make every month's rebate numbers **authoritative regardless of filenames** — complete (catch generic/ad-hoc day files) AND non-duplicating (collapse overlapping exports/re-exports).
- **Fail-safe at upload**: reject + notify the uploader when a file can't be a valid OEA07V (no parseable date, bad headers, or not a CSV).

## Current architecture (context)

- Upload flow: `app/reports/upload/page.tsx` → `jmkUploads.recordUpload` (`jmkUploadHistory`, fields incl. `s3Key`, `uploadedBy`, `processingStatus`) → `POST /api/reports/process` (fans out to sales-refresh, WTD, and `dealer-rebates/auto-process`).
- `dealer-rebates/auto-process` uses the shared aggregator `lib/dealerRebates/aggregate.ts` (`aggregate(csvText, dealers)` → per-program `{ outRows, breakdown:[{jmk,name,fanaticId?,dealerNumber?,month,qty,rowCount}], matchedQty, ... }`) and records a `dealerRebateUploads` row via `saveUploadAuto` (idempotent by `s3Key+program`).
- Stats today: `dealerRebates.getStats` / `getDealerMonthlyTotals` aggregate `dealerRebateUploads.dealerBreakdown` (sum, no dedup).
- `app/api/reports/validate` validates header columns per report type. `convex/notifications.create({ userId, type, title, message, link? })` is the in-app notification channel.
- S3 bucket `ietires-dunlop-jmk-uploads`, prefix `jmk-uploads/{YYYYMM}/`. Vercel functions have S3 creds (`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`).

## A) Dedup rebuild — authoritative monthly numbers

### A1. New table `dealerRebateMonthly` (deduped source of truth for stats)
`convex/schema.ts`:
```
dealerRebateMonthly: defineTable({
  month: v.string(),        // "YYYY-MM" (activity month)
  program: v.string(),      // "falken" | "milestar"
  jmk: v.string(),
  name: v.string(),
  fanaticId: v.optional(v.number()),
  dealerNumber: v.optional(v.string()),
  qty: v.number(),          // NET tires for this (program, dealer, month)
  rowCount: v.number(),     // deduped invoice lines (reference)
  updatedAt: v.number(),
})
  .index("by_month", ["month"])
  .index("by_month_program", ["month", "program"])
```

### A2. Rebuild route `POST /api/dealer-rebates/rebuild-month` (Vercel, S3 access)
Body `{ month: "YYYYMM" }`. Steps:
1. `ListObjectsV2` on `jmk-uploads/{YYYYMM}/` **and** `jmk-uploads/{nextYYYYMM}/` (catch end-of-month activity exported early next month). Filter to `*.csv` containing `iet-oea07v` (case-insensitive).
2. Load active dealers (`api.dealerRebates.listDealers`).
3. For each file (sorted oldest→newest by `LastModified`): download, `aggregate(body, dealers)`. For each program's `outRows`, key each line `item(SKU)|account-or-dealer-id|invoice|date`; keep the **latest** occurrence (newest file wins on amended qty); keep only lines whose **activity date** bucket equals the target `YYYY-MM`.
   - *Note:* the aggregator's `outRows` carry `SKU`, `Invoice_Number`, `Date`, `Quantity`, and the dealer id (FANATIC/DealerNumber); the dedup key uses those + the dealer id. (Account form isn't on `outRows`; the dealer id + invoice + sku + date uniquely identify a matched line.)
4. Aggregate deduped lines → per `(program, jmk, dealer, month)` net qty + line count.
5. Call `api.dealerRebates.setRebateMonthly({ month: "YYYY-MM", rows: [...] })`.

Skip-optimization: ignore files whose size is implausibly large for a daily export (e.g. > ~50 MB / the 2025 full-year dumps) — they're filtered out by activity month anyway, but skipping avoids parsing 400k-row dumps. (Confirm threshold in plan.)

### A3. Mutation `setRebateMonthly(month, rows)` (`convex/dealerRebates.ts`)
Replace-in-place: delete existing `dealerRebateMonthly` rows for `month`, insert the provided rows. Idempotent.

### A4. Stats read from `dealerRebateMonthly`
Rewrite `getStats` and `getDealerMonthlyTotals` to aggregate `dealerRebateMonthly` (by `month` / `name`) instead of `dealerRebateUploads.dealerBreakdown`. Output shape unchanged so the StatsTab/panels are untouched. `dealerRebateUploads` remains for Upload-History detail + CSV `resultData` and the per-file search (#3).

### A5. Stay-current trigger
After `auto-process` records an upload, `reports/process` (or auto-process) calls `rebuild-month` for the upload's **activity month** (derived from the file's `dateRangeStart`/rows) and the **prior month**. So every ingest re-derives the deduped truth for the affected month(s).

### A6. One-time reconciliation (gated, needs AWS creds at run time)
Run `rebuild-month` for `202603, 202604, 202605, 202606`. Verify e.g. TRD May Falken = 224. (March has no S3 folder — handled by A7.)

### A7. March (manual-only, no S3 folder)
March activity exists only in the manual `dealerRebateUploads` (recomputed earlier), not in S3. The rebuild can't source March from S3. Options (decide in plan): (a) seed `dealerRebateMonthly` for 2026-03 from the existing recomputed `dealerRebateUploads` breakdown (deduped), or (b) leave March sourced from uploads in `getStats` as a fallback when no `dealerRebateMonthly` rows exist for a month. **Chosen:** (b) — `getStats` uses `dealerRebateMonthly` for any month that has rows, and falls back to summing `dealerRebateUploads` for months with none (covers March without S3).

## B) Upload fail-safe + notify

### B1. Validation gate in `reports/process` (covers manual + automated)
At the start of `POST /api/reports/process`, for `reportType === "OEA07V"`, download the file from S3 and validate:
- **Parseable CSV** with a header row.
- **Headers** match OEA07V (reuse the `EXPECTED_HEADERS.OEA07V` check from `reports/validate`).
- **≥1 row with a parseable activity date** (col 18, `M/D/YY`).

If **any** fail → **reject**:
- `jmkUploads.updateProcessing(uploadId, "rejected", [{ trigger: "validation", status: "failed", message: <reason> }])`.
- Do **not** run the sales/WTD/rebate triggers.
- `notifications.create({ userId: <uploadedBy>, type: "report_rejected", title: "OEA07V upload rejected", message: <reason incl. fileName>, link: "/reports/upload" })`.
- Return `{ status: "rejected", reason }` (non-2xx so the caller/UI surfaces it).

Other anomalies (valid file but 0 matched dealers, etc.) → process normally but create a **warning** notification (`type: "report_warning"`); do not block.

`jmkUploads.updateProcessing` args already allow arbitrary `processingStatus` strings, so `"rejected"` needs no schema change.

### B2. Immediate upload-screen error
`app/reports/upload/page.tsx` already calls `reports/validate` for header feedback. Extend that path so that, before/at submit, the same three checks run (headers + parseable-date + CSV) and a failure shows an inline error and blocks the upload (no `recordUpload`). For files that pass the UI check but fail server-side (edge), the `reports/process` rejection + notification is the backstop.

### B3. `reports/validate` enhancement
Add an optional `sampleDates: string[]` (or `hasParseableDate: boolean`) input/derivation so the UI can check the activity-date presence in one call. (Plan decides whether the UI parses client-side or sends a sample.)

## Out of scope (YAGNI)
- Email/push notification (in-app only, per decision).
- Re-architecting `dealerRebateUploads` (kept as-is for history/CSV).
- Auto-fixing mis-named files in S3 (we read them regardless of name; we don't rename).

## Testing / verification
No test framework → verify via:
- `npm run build` typecheck; `npx tsx` unit check of the dedup key logic on a synthetic two-file overlap (same invoice line in two files → counted once; an amended qty → latest wins).
- After deploy + gated reconciliation: `getStats` / `getDealerMonthlyTotals` show **TRD May Falken = 224**; spot-check another dealer/month vs a JMK report; confirm a deliberately duplicated line isn't double-counted.
- Fail-safe: upload (a) a non-CSV, (b) a CSV with OEA07V headers but no date column values, (c) a wrong-header CSV → each is rejected, not processed, and produces an in-app notification + an upload-screen error. A valid file still processes.

## Open questions (resolve in plan)
1. Exact dedup tie-break field set on `outRows` (SKU + dealer id + invoice + date) — confirm these uniquely identify a matched line on the TC51 data.
2. Large-dump skip threshold (size vs. a name denylist for `monthly-combined`/`prefiltered`/`(95)`).
3. Whether the daily-pipeline `rebuild-month` trigger runs inline (may approach function timeout on a heavy month) or fire-and-forget.
