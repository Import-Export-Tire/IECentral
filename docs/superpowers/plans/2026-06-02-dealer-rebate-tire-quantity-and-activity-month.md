# Dealer Rebate Tool — Tire-Quantity & Activity-Month Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Dealer Rebate Tool count real tire **quantity** (not invoice lines), bucket by **activity month** (not upload time), auto-populate stats from the daily pipeline, and add per-dealer monthly totals + a combined monthly report in Upload-History search.

**Architecture:** Introduce ONE shared pure aggregation module (`lib/dealerRebates/aggregate.ts`) used by the client uploader, the server auto-process route, and the backfill — eliminating the current two-parser drift. Normalize stored data to **per-(dealer, activity-month)** rows carrying summed net `qty` and `rowCount`. All stats/queries/UI derive from that. Backfill rebuilds history from `jmkUploadHistory` S3 files (the system of record for daily OEA07V uploads), recomputing qty + month from each file's contents.

**Tech Stack:** Next.js (App Router, client component), Convex (queries/mutations/schema), AWS S3 (`@aws-sdk/client-s3`), TypeScript. **No test framework exists** (package.json scripts = dev/build/start/lint), so verification uses one-off scripts: `npx convex run ...` against a deployment and Node parse-checks against real stored CSVs.

---

## Root-cause summary (from investigation — do not re-derive)

- **#4 numbers too low:** `StatsTab` sums `matchedRows` (`app/dealer-rebates/page.tsx:1477-1478,1503,1506,1520,1523`) and `dealerBreakdown.rowCount` (`:1534-1535`). Both are *output-row counts*. The real `Quantity` (`:332,:352`) is never summed. Verified: one April file = 47 rows but **185 net tires** (~4× undercount). Dashboard 193/100/293 = exact `matchedRows` sums.
- **#2 May/June empty:** (a) Stats are only populated by manual UI uploads (`saveUpload` at `page.tsx:392,432`); the automated pipeline `reports/process → dealer-rebates/auto-process` (`app/api/reports/process/route.ts:41`) generates CSVs to S3 but **never calls saveUpload**. Manual uploads stopped April 6. (b) Months are bucketed by `uploadDate` (`page.tsx:1474`), not activity date. **`jmkUploadHistory` holds 28 May + 1 June OEA07V files in S3, all `complete`** — source data exists.
- **#1 / #3** need per-dealer per-activity-month summed quantities, which the model does not store today (and `dateRangeStart/End` is null on all 30 historical `dealerRebateUploads`).

## ⚠️ OPEN DECISION — confirm before Task 9 (backfill)

April activity exists in **both** the 30 manual `dealerRebateUploads` (files like `IET-oea07v_040326.csv`, uploaded Mar 19–Apr 6) **and** `jmkUploadHistory` reportingMonth `202604` (27 files). Backfilling from both double-counts April. March daily files are **not** in `jmkUploadHistory` (only 202604/202605/202606 exist), so March lives only in the manual uploads.

**Recommended resolution (encoded in Task 9):** Treat `jmkUploadHistory` as the single source of truth for **April onward** (delete manual `dealerRebateUploads` for April+, ingest 202604/202605/202606 from S3), and **recompute March-only** manual uploads in place from their stored `resultData`. Confirm with Andy that the `jmkUploadHistory` April files are complete before deleting the manual April rows.

---

## File Structure

- **Create** `lib/dealerRebates/aggregate.ts` — shared pure parser+aggregator (no React, no Convex, no Node-only APIs). Single source of truth for OEA07V → rebate rows + per-(dealer,month) breakdown.
- **Create** `lib/dealerRebates/aggregate.test.ts` — node-runnable assertions (run with `npx tsx`).
- **Modify** `convex/schema.ts:2408-2431` — extend `dealerRebateUploads` (qty fields, per-(dealer,month) breakdown, `s3Key`, index).
- **Modify** `convex/dealerRebates.ts` — `saveUpload` (store new fields, idempotent by s3Key+program), new `getStats`, `getDealerMonthlyTotals`, rework `searchUploadsByDealer`; add `internalMutation recomputeFromResultData` + `internalMutation ingestParsed` for backfill.
- **Create** `convex/dealerRebatesBackfill.ts` — `internalAction backfillFromJmkHistory` (reads S3, calls shared aggregator, writes via internal mutations).
- **Modify** `app/dealer-rebates/page.tsx` — use shared aggregator in `processData`; pass new fields to `saveUpload`; rewrite `StatsTab` math + render; add per-dealer monthly view (#1); add combined monthly report to Upload-History search (#3).
- **Modify** `app/api/dealer-rebates/auto-process/route.ts` — use shared aggregator; call `saveUpload` so automated runs populate stats.

---

## Task 1: Shared aggregation module (single source of truth)

**Files:**
- Create: `lib/dealerRebates/aggregate.ts`
- Test: `lib/dealerRebates/aggregate.test.ts`

This module replaces the duplicated logic in `page.tsx` (`COL`, `STORE_ACCOUNTS`, `normalizeAcct`, `parsePositionalCSV`, the FAL/MIL filter, and the per-row push loop) and in `auto-process/route.ts`. It must reproduce the **client** behavior (which is what current stats are based on): `normalizeAcct` strips leading zeros and drops `E#`/blank accounts; tire filter = PRODUCT_TYPE starts with "T" (not exactly "T") AND brand is FAL/MIL; qty = `isReturn ? rawQty : rawQty * -1` where `isReturn = /^r\d{2}w\d{2}$/`.

- [ ] **Step 1: Write the module**

```typescript
// lib/dealerRebates/aggregate.ts
// Shared, pure OEA07V → dealer-rebate aggregator.
// Used by: app/dealer-rebates/page.tsx (client), app/api/dealer-rebates/auto-process (server),
// and convex/dealerRebatesBackfill (backfill). No React / Convex / Node-only APIs.

export const COL = {
  ITEM_ID: 0, PRODUCT_TYPE: 3, MFG_ID: 4, MFG_ITEM_ID: 5,
  LOC_ID: 8, QTY: 10, SELL_PRICE: 13, ACCOUNT_ID: 15,
  INV_ID: 16, ACTIVITY_DATE: 18,
} as const;

export const IE_FALKEN = { distributorAccount: "20118", address: "400 Unity St.  STE. 100", city: "Latrobe", state: "PA", zip: "15650" };
export const IE_MILESTAR = { parentDistributor: "119662", distributorCenter: "119662:0" };

const STORE_ACCOUNTS: Record<string, string> = {
  "w08r20": "w08r20", "r20w08": "w08r20",
  "w08r25": "w08r25", "r25w08": "w08r25",
  "w08r35": "w08r35", "r35w08": "w08r35",
};

export interface RebateDealer {
  jmk: string; name: string; fanaticId?: number; dealerNumber?: string;
  programs: string[]; isActive: boolean;
}

export interface OutputRow { [k: string]: string | number; }

// One normalized aggregate per (dealer, activity-month) within a single file.
export interface DealerMonthAgg {
  jmk: string; name: string; fanaticId?: number; dealerNumber?: string;
  month: string;      // "YYYY-MM" from ACTIVITY_DATE
  qty: number;        // NET tires (sales positive, returns negative)
  rowCount: number;   // invoice lines (kept for reference/debugging)
}

export interface ProgramResult {
  outRows: OutputRow[];          // exact CSV rows for the program upload file
  breakdown: DealerMonthAgg[];   // per (dealer, month)
  matchedQty: number;            // sum of breakdown.qty
  matchedRows: number;           // sum of breakdown.rowCount
  dealersMatched: number;        // distinct dealers
}

export interface AggregateResult {
  falken: ProgramResult;
  milestar: ProgramResult;
  totalInputRows: number;
  filteredRows: number;
  dateRangeStart?: string;       // earliest ACTIVITY_DATE (MM/DD/YY)
  dateRangeEnd?: string;         // latest ACTIVITY_DATE (MM/DD/YY)
}

function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { fields.push(cur); cur = ""; }
    else cur += c;
  }
  fields.push(cur);
  return fields;
}

export function parsePositionalCSV(text: string): string[][] {
  const cleaned = text.replace(/^﻿/, "").replace(/\0/g, "");
  const lines = cleaned.trim().split(/\r?\n/);
  return lines.slice(1).filter(l => l.trim()).map(parseCSVRow);
}

export function normalizeAcct(raw: string): string {
  let s = raw.trim().toLowerCase();
  if (!s) return "xxx";
  if (s.match(/^e\d/)) return "xxx";
  if (STORE_ACCOUNTS[s]) return STORE_ACCOUNTS[s];
  s = s.replace(/^\s+/, '').replace(/^0+/, '') || 'xxx';
  return s;
}

// "MM/DD/YY" (or M/D/YY) -> "YYYY-MM". Returns "" if unparseable.
export function activityMonth(dateRaw: string): string {
  const m = dateRaw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  const mm = String(parseInt(m[1], 10)).padStart(2, "0");
  let yr = parseInt(m[3], 10);
  if (yr < 100) yr += 2000;
  return `${yr}-${mm}`;
}

export function aggregate(csvText: string, dealers: RebateDealer[]): AggregateResult {
  const allRows = parsePositionalCSV(csvText);

  const filtered = allRows.filter(cols => {
    const pt = (cols[COL.PRODUCT_TYPE] ?? "").trim();
    if (!pt.startsWith("T") || pt === "T") return false;
    const brand = (cols[COL.MFG_ID] ?? "").trim().toUpperCase();
    return brand === "FAL" || brand === "MIL";
  });

  const falkenByJmk: Record<string, RebateDealer[]> = {};
  const milestarByJmk: Record<string, RebateDealer> = {};
  for (const d of dealers) {
    if (!d.isActive) continue;
    const key = d.jmk.toLowerCase().trim();
    if (!key || key === "0" || key === "xxx") continue;
    if (d.programs.includes("falken")) (falkenByJmk[key] ??= []).push(d);
    if (d.programs.includes("milestar")) milestarByJmk[key] = d;
  }

  const falkenOut: OutputRow[] = [];
  const milestarOut: OutputRow[] = [];
  // key = `${program}|${jmk}|${id}|${month}`
  const falkenAgg = new Map<string, DealerMonthAgg>();
  const milestarAgg = new Map<string, DealerMonthAgg>();

  const bump = (map: Map<string, DealerMonthAgg>, base: Omit<DealerMonthAgg, "qty" | "rowCount">, qty: number) => {
    const k = `${base.jmk}|${base.fanaticId ?? base.dealerNumber ?? ""}|${base.month}`;
    const cur = map.get(k) ?? { ...base, qty: 0, rowCount: 0 };
    cur.qty += qty; cur.rowCount += 1;
    map.set(k, cur);
  };

  for (const cols of filtered) {
    const jmk = normalizeAcct(cols[COL.ACCOUNT_ID] ?? "");
    const invoice = (cols[COL.INV_ID] ?? "").trim();
    const dateRaw = (cols[COL.ACTIVITY_DATE] ?? "").trim();
    const month = activityMonth(dateRaw);
    const brand = (cols[COL.MFG_ID] ?? "").trim().toUpperCase();
    const mfrPartNumber = (cols[COL.MFG_ITEM_ID] ?? "").trim();
    const rawAcct = (cols[COL.ACCOUNT_ID] ?? "").trim().toLowerCase();
    const isReturn = /^r\d{2}w\d{2}$/.test(rawAcct);
    const rawQty = parseFloat((cols[COL.QTY] ?? "0").trim()) || 0;
    const signedQty = isReturn ? rawQty : rawQty * -1;
    const qty = String(signedQty);
    const price = (cols[COL.SELL_PRICE] ?? "").trim();

    if (brand === "FAL" && falkenByJmk[jmk]) {
      for (const dealer of falkenByJmk[jmk]) {
        if (!dealer.fanaticId) continue;
        falkenOut.push({
          Falken_Distributor_Account_Number: IE_FALKEN.distributorAccount,
          FANATIC_Dealer_Account_Number: dealer.fanaticId,
          Distributor_Center_Address: IE_FALKEN.address, Distributor_Center_City: IE_FALKEN.city,
          Distributor_Center_State: IE_FALKEN.state, Distributor_Center_Postal_Code: IE_FALKEN.zip,
          Invoice_Number: invoice, SKU: mfrPartNumber, Date: dateRaw, Quantity: qty, Price_Per_Tire: price,
        });
        bump(falkenAgg, { jmk: dealer.jmk, name: dealer.name, fanaticId: dealer.fanaticId, month }, signedQty);
      }
    }
    if (brand === "MIL" && milestarByJmk[jmk]) {
      const dealer = milestarByJmk[jmk];
      if (dealer.dealerNumber) {
        milestarOut.push({
          ParentDistributorNumber: IE_MILESTAR.parentDistributor, DistributorCenterNumber: IE_MILESTAR.distributorCenter,
          DealerNumber: dealer.dealerNumber, InvoiceNumber: invoice, InvoiceDate: dateRaw,
          ProductCode: mfrPartNumber, Quantity: qty, SellPricePerTire: price,
        });
        bump(milestarAgg, { jmk: dealer.jmk, name: dealer.name, dealerNumber: dealer.dealerNumber, month }, signedQty);
      }
    }
  }

  const toProgram = (out: OutputRow[], agg: Map<string, DealerMonthAgg>): ProgramResult => {
    const breakdown = [...agg.values()];
    return {
      outRows: out, breakdown,
      matchedQty: breakdown.reduce((s, b) => s + b.qty, 0),
      matchedRows: breakdown.reduce((s, b) => s + b.rowCount, 0),
      dealersMatched: new Set(breakdown.map(b => b.jmk)).size,
    };
  };

  const allDates = filtered.map(c => (c[COL.ACTIVITY_DATE] ?? "").trim()).filter(Boolean).sort();
  return {
    falken: toProgram(falkenOut, falkenAgg),
    milestar: toProgram(milestarOut, milestarAgg),
    totalInputRows: allRows.length,
    filteredRows: filtered.length,
    dateRangeStart: allDates[0],
    dateRangeEnd: allDates[allDates.length - 1],
  };
}
```

- [ ] **Step 2: Write verification script** (no jest in repo — use a runnable assert file)

```typescript
// lib/dealerRebates/aggregate.test.ts
// Run: npx tsx lib/dealerRebates/aggregate.test.ts
import { aggregate, activityMonth, type RebateDealer } from "./aggregate";
import assert from "node:assert";

assert.equal(activityMonth("03/31/26"), "2026-03");
assert.equal(activityMonth("4/1/2026"), "2026-04");
assert.equal(activityMonth(""), "");

const dealers: RebateDealer[] = [
  { jmk: "125", name: "Test Falken", fanaticId: 31489, programs: ["falken"], isActive: true },
  { jmk: "r20", name: "Test Milestar", dealerNumber: "21008", programs: ["milestar"], isActive: true },
];
// header row + 3 data rows. Columns padded to index 18 (ACTIVITY_DATE).
const pad = (o: Record<number, string>) => { const a = Array(19).fill(""); for (const k in o) a[+k] = o[k]; return a.join(","); };
const csv = [
  "HEADER",
  pad({ 3: "T1", 4: "FAL", 5: "SKU1", 10: "-4", 15: "125", 16: "INV1", 18: "03/15/26" }), // sale 4 tires
  pad({ 3: "T1", 4: "FAL", 5: "SKU2", 10: "-2", 15: "0125", 16: "INV2", 18: "04/02/26" }), // leading-zero acct, April
  pad({ 3: "T1", 4: "MIL", 5: "SKU3", 10: "-8", 15: "r20", 16: "INV3", 18: "04/05/26" }), // milestar 8 tires
].join("\n");

const r = aggregate(csv, dealers);
assert.equal(r.falken.matchedQty, 6, "falken qty 4+2");
assert.equal(r.falken.matchedRows, 2, "falken 2 lines");
assert.equal(r.milestar.matchedQty, 8, "milestar qty");
const marchFal = r.falken.breakdown.find(b => b.month === "2026-03");
const aprFal = r.falken.breakdown.find(b => b.month === "2026-04");
assert.equal(marchFal?.qty, 4); assert.equal(aprFal?.qty, 2);
console.log("OK: aggregate.test.ts passed");
```

- [ ] **Step 3: Run it, expect FAIL** (module not yet importable / logic gap)

Run: `cd ~/IECentral && npx tsx lib/dealerRebates/aggregate.test.ts`
Expected before Step 1 exists: error. After Step 1: `OK: aggregate.test.ts passed`.

- [ ] **Step 4: Run it, expect PASS** — fix `aggregate.ts` until output is `OK: aggregate.test.ts passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/dealerRebates/aggregate.ts lib/dealerRebates/aggregate.test.ts
git commit -m "feat(dealer-rebates): shared OEA07V aggregator (qty + activity-month)"
```

---

## Task 2: Schema — qty + per-(dealer,month) breakdown + s3Key

**Files:**
- Modify: `convex/schema.ts:2408-2431` (the `dealerRebateUploads` table)

- [ ] **Step 1: Replace the table definition**

```typescript
  dealerRebateUploads: defineTable({
    uploadDate: v.number(),
    fileName: v.string(),
    program: v.string(), // "falken" | "milestar"
    totalInputRows: v.number(),
    filteredRows: v.number(),
    matchedRows: v.number(),     // invoice lines (kept for reference)
    matchedQty: v.optional(v.number()), // NET tires — the real volume
    dealersMatched: v.number(),
    resultData: v.string(),
    // Normalized per (dealer, activity-month). qty is NET tires.
    dealerBreakdown: v.array(v.object({
      jmk: v.string(),
      name: v.string(),
      fanaticId: v.optional(v.number()),
      dealerNumber: v.optional(v.string()),
      month: v.optional(v.string()), // "YYYY-MM" (optional: legacy rows lack it)
      qty: v.optional(v.number()),   // optional: legacy rows lack it
      rowCount: v.number(),
    })),
    uploadedBy: v.id("users"),
    dateRangeStart: v.optional(v.string()),
    dateRangeEnd: v.optional(v.string()),
    s3Key: v.optional(v.string()), // source file key (idempotency for auto/backfill)
    createdAt: v.number(),
  })
    .index("by_date", ["uploadDate"])
    .index("by_program", ["program"])
    .index("by_uploaded_by", ["uploadedBy"])
    .index("by_s3key_program", ["s3Key", "program"]),
```

- [ ] **Step 2: Push schema to a dev/preview deployment, expect success**

Run: `cd ~/IECentral && set -a && . ./.env.prod && set +a && npx convex deploy --dry-run` (validate types compile). For real push use the agreed deployment. Expected: "No indexes are deleted by this push" + new `by_s3key_program` added.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(dealer-rebates): add matchedQty + (dealer,month) breakdown + s3Key to uploads"
```

---

## Task 3: `saveUpload` — store qty/month, idempotent by s3Key+program

**Files:**
- Modify: `convex/dealerRebates.ts:155-194` (`saveUpload`)

- [ ] **Step 1: Replace `saveUpload`**

```typescript
export const saveUpload = mutation({
  args: {
    fileName: v.string(),
    program: v.string(),
    totalInputRows: v.number(),
    filteredRows: v.number(),
    matchedRows: v.number(),
    matchedQty: v.number(),
    dealersMatched: v.number(),
    resultData: v.string(),
    dealerBreakdown: v.array(v.object({
      jmk: v.string(), name: v.string(),
      fanaticId: v.optional(v.number()), dealerNumber: v.optional(v.string()),
      month: v.optional(v.string()), qty: v.optional(v.number()), rowCount: v.number(),
    })),
    uploadedBy: v.id("users"),
    dateRangeStart: v.optional(v.string()),
    dateRangeEnd: v.optional(v.string()),
    s3Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.uploadedBy);
    // Idempotency: if this s3Key+program was already saved, replace it (avoid double counting).
    if (args.s3Key) {
      const existing = await ctx.db
        .query("dealerRebateUploads")
        .withIndex("by_s3key_program", (q) => q.eq("s3Key", args.s3Key).eq("program", args.program))
        .collect();
      for (const e of existing) await ctx.db.delete(e._id);
    }
    const id = await ctx.db.insert("dealerRebateUploads", {
      uploadDate: Date.now(),
      ...args,
      createdAt: Date.now(),
    });
    return { success: true, id };
  },
});
```

- [ ] **Step 2: Verify it deploys** — `npx convex deploy --dry-run` compiles.
- [ ] **Step 3: Commit** — `git commit -am "feat(dealer-rebates): saveUpload stores qty/month, idempotent by s3Key"`

---

## Task 4: Client uploader uses shared aggregator

**Files:**
- Modify: `app/dealer-rebates/page.tsx` — replace local `COL`/`STORE_ACCOUNTS`/`normalizeAcct`/`parsePositionalCSV`/`IE_*` (`:13-77`) with imports from `@/lib/dealerRebates/aggregate`; replace the parse loop in `processData` (`:280-360`) and the `saveUpload` calls (`:374-456`) to use `aggregate()` output.

- [ ] **Step 1: Add import, remove duplicated constants/helpers**

```typescript
import { aggregate, COL, IE_FALKEN, IE_MILESTAR, type RebateDealer } from "@/lib/dealerRebates/aggregate";
```
Delete the local `IE_FALKEN`, `IE_MILESTAR`, `COL`, `STORE_ACCOUNTS`, `normalizeAcct`, `parseCSVRow`, `parsePositionalCSV` definitions (`:13-77`). Keep `cleanSku`, `toCSV`, `downloadCSV`, `todayStamp`, `formatDate`.

- [ ] **Step 2: Rewrite `handleFile` + `processData` to call `aggregate`**

Replace the body that builds `falkenOut/milestarOut` with:

```typescript
const result = aggregate(rawText, (dealers ?? []).map(d => ({
  jmk: d.jmk, name: d.name, fanaticId: d.fanaticId, dealerNumber: d.dealerNumber,
  programs: d.programs, isActive: d.isActive,
})) as RebateDealer[]);
// keep raw text in component state from FileReader so re-processing uses the same parser
```
Then for each program with `result[program].outRows.length > 0`, build the CSV via existing `toCSV(headers, result[program].outRows)` and call `saveUpload`:

```typescript
await saveUpload({
  fileName, program: "falken",
  totalInputRows: result.totalInputRows,
  filteredRows: result.filteredRows,
  matchedRows: result.falken.matchedRows,
  matchedQty: result.falken.matchedQty,
  dealersMatched: result.falken.dealersMatched,
  resultData: falkenCsv,
  dealerBreakdown: result.falken.breakdown,
  uploadedBy: userId,
  dateRangeStart: result.dateRangeStart,
  dateRangeEnd: result.dateRangeEnd,
});
```
(Repeat for milestar with `milestarHeaders` and `result.milestar`.) The on-screen preview tables (`:682-754`) keep showing `r.Quantity` per row — unchanged.

- [ ] **Step 3: Build, expect success** — `npm run build` compiles with no type errors in `page.tsx`.
- [ ] **Step 4: Manual verify** — upload one known OEA07V via UI; confirm preview row counts match before, and Upload History now shows a qty.
- [ ] **Step 5: Commit** — `git commit -am "refactor(dealer-rebates): client uploader uses shared aggregator + saves qty/month"`

---

## Task 5: `getStats` query + StatsTab uses activity-month & qty

**Files:**
- Modify: `convex/dealerRebates.ts` — add `getStats` query (server-side aggregation by activity month + qty).
- Modify: `app/dealer-rebates/page.tsx:1459-1559` (`StatsTab` `useMemo`) to consume `getStats`; render unchanged (`:1583-1818`) since it already reads `months/currentYear/topDealers`.

- [ ] **Step 1: Add `getStats` to `convex/dealerRebates.ts`**

```typescript
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const uploads = await ctx.db.query("dealerRebateUploads").collect();
    // month -> {falken, milestar} in NET tires, bucketed by ACTIVITY month
    const monthMap: Record<string, { falken: number; milestar: number }> = {};
    const dealerMap: Record<string, { name: string; falken: number; milestar: number }> = {};
    for (const u of uploads) {
      for (const b of u.dealerBreakdown) {
        const month = b.month ?? new Date(u.uploadDate).toISOString().slice(0, 7);
        const qty = b.qty ?? b.rowCount; // legacy fallback
        (monthMap[month] ??= { falken: 0, milestar: 0 })[u.program === "falken" ? "falken" : "milestar"] += qty;
        const dm = (dealerMap[b.name] ??= { name: b.name, falken: 0, milestar: 0 });
        dm[u.program === "falken" ? "falken" : "milestar"] += qty;
      }
    }
    return { monthMap, dealers: Object.values(dealerMap) };
  },
});
```

- [ ] **Step 2: Rewrite `StatsTab` `useMemo`** to call `useQuery(api.dealerRebates.getStats, {})` and build `months` (last 12 by activity month from `monthMap`), `currentYear/lastYear/cyToDate/lyToDate/currentMonth/lastMonth` from `monthMap` keyed by `YYYY-MM`, and `topDealers` from `dealers` sorted by `falken+milestar`. (Replaces the `uploadDate` bucketing at `:1474` and all `matchedRows`/`rowCount` sums with month+qty.) Keep the returned shape identical so JSX `:1583-1818` is unchanged.

- [ ] **Step 3: Verify against real data**

Run after deploy + backfill (Task 9): `npx convex run dealerRebates:getStats '{}'` and assert `monthMap["2026-03"].falken` etc. are ~4× the old row counts and that `2026-05` is populated.

- [ ] **Step 4: Commit** — `git commit -am "feat(dealer-rebates): stats by activity month + net tire qty"`

---

## Task 6: Per-dealer monthly totals (#1)

**Files:**
- Modify: `convex/dealerRebates.ts` — add `getDealerMonthlyTotals`.
- Modify: `app/dealer-rebates/page.tsx` — add a "Per-Dealer Monthly" panel in `StatsTab` (after the Top Dealers grid, before YoY at `:1750`).

- [ ] **Step 1: Add query**

```typescript
export const getDealerMonthlyTotals = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const term = (args.search ?? "").toLowerCase().trim();
    const uploads = await ctx.db.query("dealerRebateUploads").collect();
    // key dealer -> month -> {falken, milestar}
    const map: Record<string, { jmk: string; name: string; months: Record<string, { falken: number; milestar: number }> }> = {};
    for (const u of uploads) {
      for (const b of u.dealerBreakdown) {
        if (term && !(b.name.toLowerCase().includes(term) || b.jmk.toLowerCase().includes(term))) continue;
        const month = b.month ?? new Date(u.uploadDate).toISOString().slice(0, 7);
        const qty = b.qty ?? b.rowCount;
        const d = (map[b.name] ??= { jmk: b.jmk, name: b.name, months: {} });
        const mm = (d.months[month] ??= { falken: 0, milestar: 0 });
        mm[u.program === "falken" ? "falken" : "milestar"] += qty;
      }
    }
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  },
});
```

- [ ] **Step 2: Add the panel** — a table: rows = dealers, columns = last N activity months, cells = total net tires (Falken+Milestar), with a search box bound to `getDealerMonthlyTotals({ search })`. This is the "monthly total per dealer I can compare to my report" (#1).

- [ ] **Step 3: Build + manual verify** — `npm run build`; open Stats, confirm a known dealer's monthly tires match a JMK report row.
- [ ] **Step 4: Commit** — `git commit -am "feat(dealer-rebates): per-dealer monthly totals panel (#1)"`

---

## Task 7: Upload-History dealer search → combined monthly report (#3)

**Files:**
- Modify: `convex/dealerRebates.ts:234-268` (`searchUploadsByDealer`) — return combined monthly totals for the matched dealer(s) in addition to per-upload matches.
- Modify: `app/dealer-rebates/page.tsx` — Upload-History search results render a monthly-totals summary card on top of the per-file list.

- [ ] **Step 1: Replace `searchUploadsByDealer`**

```typescript
export const searchUploadsByDealer = query({
  args: { searchTerm: v.string() },
  handler: async (ctx, args) => {
    const term = args.searchTerm.toLowerCase().trim();
    if (!term) return { monthly: [], uploads: [] };
    const uploads = await ctx.db.query("dealerRebateUploads").order("desc").collect();
    const match = (d: { jmk: string; name: string; fanaticId?: number; dealerNumber?: string }) =>
      d.jmk.toLowerCase().includes(term) || d.name.toLowerCase().includes(term) ||
      (d.fanaticId != null && String(d.fanaticId).includes(term)) ||
      (d.dealerNumber != null && d.dealerNumber.toLowerCase().includes(term));

    const monthMap: Record<string, { falken: number; milestar: number }> = {};
    const matchedUploads: any[] = [];
    for (const u of uploads) {
      const hits = u.dealerBreakdown.filter(match);
      if (hits.length === 0) continue;
      for (const b of hits) {
        const month = b.month ?? new Date(u.uploadDate).toISOString().slice(0, 7);
        (monthMap[month] ??= { falken: 0, milestar: 0 })[u.program === "falken" ? "falken" : "milestar"] += (b.qty ?? b.rowCount);
      }
      matchedUploads.push({ _id: u._id, uploadDate: u.uploadDate, fileName: u.fileName, program: u.program, matchedDealers: hits });
    }
    const monthly = Object.entries(monthMap).sort().map(([month, v]) => ({ month, ...v, total: v.falken + v.milestar }));
    return { monthly, uploads: matchedUploads };
  },
});
```

- [ ] **Step 2: Update the Upload-History search UI** to consume `{ monthly, uploads }` (currently expects a flat array) — render a monthly-totals table first, then the existing per-file list from `uploads`.
- [ ] **Step 3: Build + manual verify** — search a dealer; confirm combined monthly tire totals appear (#3).
- [ ] **Step 4: Commit** — `git commit -am "feat(dealer-rebates): combined monthly report in dealer search (#3)"`

---

## Task 8: Automated pipeline records stats (#2 going forward)

**Files:**
- Modify: `app/api/dealer-rebates/auto-process/route.ts` — replace the inline parser with the shared `aggregate()`, and after building CSVs, persist to stats so automated daily runs populate the dashboard.

- [ ] **Step 1: Use shared aggregator** — delete the route's local `COL`, `STORE_ACCOUNTS`, `normalizeAcct`, `parseCSV`, and the row loop (`:12-159`); call `aggregate(body, dealers)`. Build CSVs from `result.<program>.outRows`.

- [ ] **Step 2: Persist stats** — add an `internalMutation saveUploadAuto` in `convex/dealerRebates.ts` (same as `saveUpload` but without `requireAdmin`, since this is a trusted server route), called via `ConvexHttpClient`/internal for each program with `s3Key` set. Idempotent by s3Key+program (Task 3). Pass `dateRangeStart/End`, `matchedQty`, per-(dealer,month) `breakdown`.

```typescript
// convex/dealerRebates.ts
export const saveUploadAuto = internalMutation({
  args: { /* identical to saveUpload args minus uploadedBy, plus uploadedByLabel handling */ },
  handler: async (ctx, args) => { /* same body as saveUpload without requireAdmin; set uploadedBy to a system user id passed in args or stored config */ },
});
```
Note: `dealerRebateUploads.uploadedBy` is `v.id("users")` (required). Decide a system user id (pass via env `REBATE_SYSTEM_USER_ID`, or relax the field to optional in Task 2). **If relaxing:** make `uploadedBy: v.optional(v.id("users"))` in schema and `saveUpload`.

- [ ] **Step 3: Verify** — POST a known May `s3Key` to `/api/dealer-rebates/auto-process` against a dev deployment; confirm a `dealerRebateUploads` row appears with correct `matchedQty` and `month`, and re-POSTing the same key does **not** double it.
- [ ] **Step 4: Commit** — `git commit -am "feat(dealer-rebates): auto-process records stats (qty/month, idempotent) (#2)"`

---

## Task 9: Backfill history (April/May/June from S3; recompute March)

> ⚠️ Resolve the OPEN DECISION above with Andy first. Plan assumes: jmkUploadHistory is source-of-truth for April+, March recomputed from manual uploads' resultData.

**Files:**
- Create: `convex/dealerRebatesBackfill.ts` — `internalAction backfillFromJmkHistory`.
- Modify: `convex/dealerRebates.ts` — add `internalMutation deleteUploadsFromMonth` (delete April+ manual rows) and reuse `saveUploadAuto`; add `internalMutation recomputeLegacyResultData` (for March-only manual rows: re-parse stored `resultData`'s `Date`/`Quantity` into qty+month and patch in place).

- [ ] **Step 1: `recomputeLegacyResultData`** — for each existing `dealerRebateUploads` with `matchedQty == null`: parse `resultData` (CSV already has `Date` + `Quantity` columns), recompute `matchedQty` (sum of `Quantity`) and a per-(dealer,month) `dealerBreakdown` (group by the `_dealer`/`FANATIC_Dealer_Account_Number`/`DealerNumber` + activityMonth(Date)), patch the row. (March rows become correct without S3.)

```typescript
export const recomputeLegacyResultData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const uploads = await ctx.db.query("dealerRebateUploads").collect();
    let patched = 0;
    for (const u of uploads) {
      if (u.matchedQty != null) continue;
      const lines = (u.resultData || "").split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) continue;
      const hdr = lines[0].split(",");
      const qi = hdr.indexOf("Quantity");
      const di = u.program === "falken" ? hdr.indexOf("Date") : hdr.indexOf("InvoiceDate");
      // group qty by month; dealer identity from existing dealerBreakdown rowCount is not per-row,
      // so for legacy we recompute only matchedQty + monthly split (dealer-month best-effort = single month per file).
      let qty = 0; const monthQty: Record<string, number> = {};
      for (const ln of lines.slice(1)) {
        const p = ln.split(",");
        const q = parseFloat(p[qi] ?? "0") || 0;
        qty += q;
        const m = (p[di] ?? "").match(/^(\d{1,2})\/\d{1,2}\/(\d{2,4})$/);
        if (m) { const mm = String(+m[1]).padStart(2,"0"); let y=+m[2]; if (y<100) y+=2000; monthQty[`${y}-${mm}`] = (monthQty[`${y}-${mm}`]||0)+q; }
      }
      const primaryMonth = Object.entries(monthQty).sort((a,b)=>b[1]-a[1])[0]?.[0];
      await ctx.db.patch(u._id, {
        matchedQty: qty,
        dealerBreakdown: u.dealerBreakdown.map(b => ({ ...b, month: b.month ?? primaryMonth, qty: b.qty ?? undefined })),
      });
      patched++;
    }
    return { patched };
  },
});
```
*(Per-dealer-per-row qty isn't recoverable from legacy `resultData` because it lacks the dealer name column; acceptable since Task 9 then re-ingests April+ from S3 with full fidelity, and March is small. If March per-dealer qty fidelity is required, re-ingest March source files too if Andy can provide them.)*

- [ ] **Step 2: `backfillFromJmkHistory` internalAction** — list `jmkUploadHistory` where reportType `OEA07V`; for each, S3 `GetObject(s3Key)`, load active dealers, `aggregate()`, then `saveUploadAuto` per program with `s3Key` (idempotent). Process months April(202604)/May(202605)/June(202606).

- [ ] **Step 3: Delete double-counting manual April rows** — `deleteUploadsFromMonth` removes manual `dealerRebateUploads` whose activity month ≥ 2026-04 before/after backfill (since S3 ingest now owns April+). Run order: recompute March (Step 1) → delete manual April+ → backfill April+ from S3.

- [ ] **Step 4: Run backfill against PROD (with Andy's go-ahead)** and verify:

```bash
npx convex run dealerRebates:recomputeLegacyResultData '{}'
npx convex run dealerRebatesBackfill:backfillFromJmkHistory '{}'   # internalAction → use internal runner
npx convex run dealerRebates:getStats '{}'
```
Expected: `2026-05` and `2026-06` populated; April not doubled; totals ~4× prior row counts.

- [ ] **Step 5: Commit** — `git commit -am "feat(dealer-rebates): backfill qty/month history from jmkUploadHistory + recompute legacy"`

---

## Task 10: Verify against a real JMK report

- [ ] **Step 1:** Pick one dealer + one month where Andy has the JMK actual. Compare `getDealerMonthlyTotals({search})` cell to the JMK number. They should match (net tires).
- [ ] **Step 2:** If off, check: (a) returns sign on that dealer, (b) dealer not enrolled / wrong JMK mapping, (c) store-transfer accounts (r20/r25/w08*) inclusion. Document any residual delta.
- [ ] **Step 3:** Confirm dashboard `THIS MONTH` is non-zero once June files are ingested.

---

## Self-Review notes

- **Spec coverage:** #4 → Tasks 1,3,4,5 (+9 backfill). #2 → Tasks 5 (bucketing), 8 (auto pipeline), 9 (May/June backfill). #1 → Task 6. #3 → Task 7. ✓
- **Type consistency:** `DealerMonthAgg`/`breakdown` shape (Task 1) matches `dealerBreakdown` schema (Task 2) and `saveUpload` args (Task 3) and consumers (Tasks 5–7). `matchedQty` used consistently. ✓
- **Idempotency:** `by_s3key_program` index (Task 2) + delete-then-insert in `saveUpload`/`saveUploadAuto` (Tasks 3,8) prevents double counting on re-runs/backfill. ✓
- **Known limitation flagged:** legacy `resultData` lacks per-row dealer name → legacy per-dealer-per-month qty is best-effort for March; April+ re-ingested from S3 at full fidelity (Task 9 Step 1 note). ✓
- **Decision flagged:** April dedup source-of-truth (top of doc + Task 9). ✓
