# 04 — Reports & Data Platform

Internal reporting and data platform for **Import-Export Tire (IET)**, a tire
distributor. Stack: **Next.js 15 (App Router)** front end + API route handlers,
**Convex** (`outstanding-dalmatian-787.convex.cloud`) for transactional/state
data, and **AWS** (S3 + a SAM-deployed Lambda stack + API Gateway) for heavy file
processing, SFTP delivery, and the OEIVAL inventory cache.

The platform ingests JMK ERP report exports (chiefly the **OEA07V** daily sales
extract and the **OEIVAL** inventory snapshot), parses/aggregates them, and drives
a family of reports and vendor-submission tools.

> Scope note: this document covers the Reports & Data Platform cluster only.
> Areas: Reports hub & ingestion, OEIVAL inventory cache, brand sourcing, dealer
> rebates, Dunlop sellout reporter, WTD commission, JMK uploads & CIR, and tire
> search / label printing.

---

## Table of contents

1. [S3 layout (buckets & key prefixes)](#1-s3-layout-buckets--key-prefixes)
2. [Shared conventions](#2-shared-conventions)
3. [Reports hub & data ingestion](#3-reports-hub--data-ingestion)
4. [OEIVAL inventory cache (two-cache split)](#4-oeival-inventory-cache-two-cache-split)
5. [Brand sourcing for inventory adjustments](#5-brand-sourcing-for-inventory-adjustments)
6. [Dealer rebates](#6-dealer-rebates)
7. [Dunlop sellout reporter](#7-dunlop-sellout-reporter)
8. [WTD commission](#8-wtd-commission)
9. [JMK uploads & CIR](#9-jmk-uploads--cir)
10. [Tire search / catalog helpers & label printing](#10-tire-search--catalog-helpers--label-printing)
11. [Cross-cutting gotchas](#11-cross-cutting-gotchas)

---

## 1. S3 layout (buckets & key prefixes)

There are several S3 buckets, all in `us-east-1`. The **primary** bucket is
`ietires-dunlop-jmk-uploads`; it holds raw uploads **and** the OEIVAL caches.

### Bucket: `ietires-dunlop-jmk-uploads` (raw inputs + OEIVAL caches + outputs)

| Key prefix / key | Contents | Written by | Read by |
|---|---|---|---|
| `jmk-uploads/{YYYYMM}/iet-oea07v*.csv` | Daily/monthly OEA07V sales extracts | upload page (presigned PUT), `auto-process`, FTP sync | sales-by-day, sales-history-data, custom-data, WTD daily-run, dealer-rebates, Dunlop monthly-run |
| `jmk-uploads/{YYYYMM}/iet-art24t*.csv`, `iet-art30s*.csv` | Other JMK reports (tracked, not auto-processed) | upload page | custom-data |
| `jmk-uploads/{YYYYMM}/IET-oea07v-monthly-combined.csv` | Deduped monthly combine | `dunlop/monthly-run` | Dunlop run |
| `jmk-uploads/oeival/{YYYYMM}/...csv` | Raw OEIVAL inventory snapshots (data source) | upload page (`oeival` data source) | OEIVAL processor Lambda (S3 trigger) |
| `jmk-uploads/oeival/_cache/latest.meta.json` | REPORTING snapshot meta (latest upload only) | `oeival_processor` Lambda | inventory-data, custom-data |
| `jmk-uploads/oeival/_cache/latest.items.ndjson.gz` | REPORTING snapshot items (gzip NDJSON) | `oeival_processor` Lambda | inventory-data, custom-data (streamed) |
| `jmk-uploads/oeival/_cache/lookup.meta.json` | COLLECTIVE tire-label index meta (cumulative) | `oeival_processor` Lambda | `lib/oeivalBrandIndex.ts` |
| `jmk-uploads/oeival/_cache/lookup.items.ndjson.gz` | COLLECTIVE tire-label index (cumulative union by itemId, never shrinks) | `oeival_processor` Lambda | `lib/oeivalBrandIndex.ts` → resolve-brand, tire-search, heal |
| `jmk-uploads/tires/tires-*.csv` | Tire catalog (descriptions, FET) data source | upload page (`tires`) | custom-data, sales-history-data, WTD, dealer-rebates enrichment |
| `dealer-rebates/falken/Falken_Fanatic_{YYYY-MM-DD}.csv` | Falken Fanatic submission CSV (one per activity day) | dealer-rebates auto-process / regenerate-outputs | dealer-rebates list, monthly-report |
| `dealer-rebates/milestar/Milestar_Momentum_{YYYY-MM-DD}.csv` | Milestar Momentum submission CSV | dealer-rebates | dealer-rebates list, monthly-report |
| `brand-logos/{slug}.png` | Brand logo PNGs for labels | (manual) | `/api/brand-logo` |

### Bucket: `ietires-sales-data` (shared; processed sales + archives)

| Key prefix | Contents | Written by | Read by |
|---|---|---|---|
| `processed/{YYYYMM}.json` | Processed monthly sales aggregates | `transform_and_upload` Lambda | `fetch_sales` Lambda (sales dashboard) |
| `cir-reports/{LOCATION}/{date}_{ts}.pdf` | Archived Controller Inventory Report PDFs | `/api/reports/cir/upload-url` | `/api/reports/cir/download-url` |
| `wtd-commission-reports/{customerNumber}/{date}_{ts}.json` | Saved WTD commission reports | WTD daily-run / save-report | WTD reports route |

### Bucket: `ietires-dunlop-output-csvs` (Dunlop SFTP outputs)

| Key prefix | Contents |
|---|---|
| `output-csvs/ImportExportTireCo_{month}_Sellout.csv` | Generated Dunlop sellout CSV (also SFTP'd to Dunlop) |

### Bucket: `ietires-dunlop-run-logs`

| Key prefix | Contents |
|---|---|
| `run-logs/{month}_{timestamp}.json` | Dunlop run logs (history) |

### Other

- `ietires-scanner-assets` — exists but the Vercel S3 credentials do **not** have
  access to it (noted in `app/api/brand-logo/route.ts`).

---

## 2. Shared conventions

- **S3 client (TS routes):** `region: S3_REGION || "us-east-1"`, optional creds
  `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
- **Convex URL:** `NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud"`.
- **App URL:** `NEXT_PUBLIC_APP_URL || "https://www.iecentral.com"`.
- **Cron auth:** routes guard on `Authorization: Bearer ${CRON_SECRET}` when set.
- **OEA07V column map** (zero-based, recurs across routes): `ITEM_ID 0`,
  `DESCRIPTION 1`, `PRODUCT_TYPE 3`, `MFG_ID 4` (brand code), `MFG_ITEM_ID 5`,
  `LOC_ID 8`, `TRN_PUR 9` (Sld/ReS), `QTY 10`, `UNIT_COST 11`, `EXT_COST 12`,
  `UNIT_SELL 13`, `EXT_SELL 14`, `ACCOUNT_ID 15`, `INV_ID 16`, `ACTIVITY_DATE 18`,
  `CUSTOMER_NAME 19`.
- **OEA07V sign convention:** sales are stored as **negative** quantities/costs;
  routes negate to get positive volume. Returns (`ReS`, or `R##W##` accounts) carry
  the opposite sign and subtract.
- **Tire product filter:** keep rows whose `PRODUCT_TYPE` starts with `T` but is
  not exactly `"T"`.
- **D-class suffix:** trailing item-ID characters (`.` `^` `[` `]` `:` `~` `-` `<`)
  encode product ownership/class; stripped or matched via `endsWith` depending on
  the use.
- **Vercel crons** (`vercel.json`): `/api/sales/refresh` `0 10 * * *`;
  `/api/reports/auto-process` `0 9 * * 1-5`; `/api/dunlop/monthly-run` `0 14 1 * *`.
  Notably **WTD daily-run and dealer-rebates have no dedicated cron** — they are
  fanned out from `/api/reports/process`.

---

## 3. Reports hub & data ingestion

**Purpose:** Card-based hub listing every report, plus the upload/ingest pipeline
that lands JMK exports in S3 and triggers downstream processing.

### Pages

| Route | File | Purpose |
|---|---|---|
| `/reports` | `app/reports/page.tsx` | Hub; cards from `lib/reportTypes.ts`, per-card permission gating (`report.<id>`); renders some HR/ops views inline via `convex/reports.ts` |
| `/reports/custom` | `app/reports/custom/page.tsx` | Custom report builder → POSTs `/api/reports/custom-data` |
| `/reports/inventory` | `app/reports/inventory/page.tsx` | Inventory report → `/api/reports/inventory-data` |
| `/reports/inventory/filtered` | `app/reports/inventory/filtered/page.tsx` | Controller Inventory Report (CIR); brand-resolve + PDF archive |
| `/reports/sales-by-day` | `app/reports/sales-by-day/page.tsx` | Sales by day & location |
| `/reports/sales-dashboard` | `app/reports/sales-dashboard/page.tsx` | Sales dashboard (charts, delta pills) |
| `/reports/sales-history` | `app/reports/sales-history/page.tsx` | Per-item monthly sales history |
| `/reports/saved/[configId]` | `app/reports/saved/[configId]/page.tsx` | Saved custom-config run/detail |
| `/reports/upload` | `app/reports/upload/page.tsx` | Upload orchestration + FTP connection management |
| `/reports/upload-status` | `app/reports/upload-status/page.tsx` | Coverage calendar |

`lib/reportTypes.ts` is the central registry of report cards (id, title, href,
group, `external?`, `superAdminOnly?`); groups: hr, operations, inventory, sales,
saved, vendor, admin.

### Two ingestion architectures (important)

1. **S3-direct (primary).** Upload page presigns via `/api/reports/upload-url`,
   `PUT`s straight to S3, records metadata via `jmkUploads.recordUpload`
   (`jmkUploadHistory` table). Report routes then read/parse the raw CSV (or the
   OEIVAL cache) from S3 on demand.
2. **Convex-table (legacy/secondary).** `/api/reports/ingest` parses the file
   server-side and writes into the `tireCatalog` / `inventoryItems` / `salesHistory`
   tables via `convex/reportData.ts`. This path uses full `XLSX.read` and is the
   OOM-prone pattern the streaming OEIVAL cache replaced.

### API routes

| Route | Method | Purpose / key logic |
|---|---|---|
| `app/api/reports/validate/route.ts` | POST | Header-presence check vs `EXPECTED_HEADERS` for OEA07V/ART24T/ART30S; data sources skip validation. Pure compute. |
| `app/api/reports/upload-url/route.ts` | POST | Presigned PUT (`expiresIn: 900`). Data-source keys → `jmk-uploads/<typeFolder>/<month>/<file>`; others → `jmk-uploads/<month>/<file>`. Filename sanitized `[^a-zA-Z0-9._() -] → _`. |
| `app/api/reports/upload-status/route.ts` | GET | Scans S3 for OEA07V/oeival/tires; for OEA07V downloads + parses each CSV to mark covered business days. |
| `app/api/reports/ingest/route.ts` | POST | Legacy Convex-table path. `XLSX.read` whole workbook (**OOM-prone**); batch inserts (size 100); deletes prior upload's rows. |
| `app/api/reports/process/route.ts` | POST | OEA07V-only. Downloads CSV, fail-safe header/date validation (→ 422 + `report_rejected` notification on fail). On pass, fires in parallel: `/api/sales/refresh`, `/api/wtd-commission/daily-run`, `/api/dealer-rebates/auto-process`; then fire-and-forget `dealer-rebates/rebuild-month` for month + prev month. |
| `app/api/reports/auto-process/route.ts` | GET (cron) | Weekday cron. Scans current+prev month folders, matches `iet-oea07v/art24t/art30s`, dedupes vs upload history, records + processes; also runs `autoRun` saved configs. |
| `app/api/reports/custom-data/route.ts` | POST | Most complex. Per-source column-index maps; OEA07V valid-row filter (excludes 700/7001/7002, transfers `^[WR]\d{2}[WR]\d{2}$`, `^[WR]\d{2}$`, INV*/99-*); brand mapping + tire-catalog enrichment; **OEIVAL streamed from `latest.*` NDJSON.gz** (`streamOeivalCache`); fusion joins memory-bounded by a Set; 50k-row cap. |
| `app/api/reports/inventory-data/route.ts` | GET (`maxDuration=60`) | Streams `latest.items.ndjson.gz` line-by-line applying filters; maps brand codes; `staleWarning` if cache missing. |
| `app/api/reports/sales-by-day/route.ts` | GET | Aggregates OEA07V daily CSVs → per-day/week/month per-location qty + dollars; `CONCURRENCY=8`; dedup key `date|invoice|item|location|account`; ReS returns tracked separately; IET-house customers skipped. |
| `app/api/reports/sales-history-data/route.ts` | GET | OEA07V → per-item monthly sales map; 10k-item cap; `debugItemId` mode. |

### Convex backend

- `convex/reports.ts` — read-only queries for inline hub views (personnel,
  applications, hiring, equipment, attendance). Not part of the JMK/S3 path.
- `convex/reportData.ts` — legacy Convex-table ingestion + query layer (upload
  tracking, batch inserts building `computedDescription`/D-class decode, report
  queries joining inventory/sales to `tireCatalog` by `itemId`).
  `WAREHOUSES = {R10:Latrobe, EXP:Export/Everson, R30:Chestnut Ridge}`.
- `convex/savedReports.ts` — CRUD over `savedReportConfigs` (`list`, `get`,
  `getAutoRunConfigs`, `create`, `update`, `remove`).

### Schema tables

| Table | Key fields | Indexes |
|---|---|---|
| `savedReportConfigs` | name, sources[], selectedColumns[], filter*, dateRangeType, autoRun, lastRunAt, createdBy | `by_created`, `by_autoRun` |
| `reportDataUploads` | uploadedBy?, sourceType, fileName, rowCount, status, replacedUploadId? | `by_sourceType`, `by_status` |
| `tireCatalog` | uploadId, itemId, mfgItemId?, mfgName, model, size, productType, computedDescription (+ many spec fields) | `by_itemId`, `by_mfgName`, `by_productType`, `by_uploadId` |
| `inventoryItems` | uploadId, location, productType, dclass, manufacturerCode/Name, itemId, qtyOnHand/Committed/Available, prices, costs, extendedValue | `by_location`, `by_mfgName`, `by_productType`, `by_itemId`, `by_uploadId` |
| `salesHistory` | uploadId, warehouse, itemId, dclass, manufacturerName, monthlySales (JSON), total, isColonRow | `by_warehouse`, `by_mfgName`, `by_productType`, `by_itemId`, `by_uploadId` |
| `reportUploadAccess` | userIds[], updatedBy, updatedAt (singleton) | — |

**OOM gotcha:** `XLSX.read(buffer)` materializes the whole sheet — flagged in
comments as OOM-killing the 2048 MB function on the ~474K-row OEIVAL dataset. The
streaming NDJSON cache (below) is the fix.

---

## 4. OEIVAL inventory cache (two-cache split)

**This is the most important and most recently changed area.** The
`oeival_processor` Lambda writes **two** distinct cache sets under
`jmk-uploads/oeival/_cache/`, read by different code paths.

**Backend file:** `aws/dunlop-reporter/lambdas/oeival_processor.py`
**Reader (TS):** `lib/oeivalBrandIndex.ts` (lookup cache);
`app/api/reports/inventory-data/route.ts` + `custom-data/route.ts` (latest cache).

### The split

| Cache | S3 keys | Semantics | Read by |
|---|---|---|---|
| **REPORTING snapshot** | `_cache/latest.meta.json`, `_cache/latest.items.ndjson.gz` | **Latest upload only**, overwritten every run | inventory-data, custom-data |
| **COLLECTIVE lookup index** | `_cache/lookup.meta.json`, `_cache/lookup.items.ndjson.gz` | **Cumulative union by itemId** (newest wins, **never shrinks**) | `lib/oeivalBrandIndex.ts` → resolve-brand, tire-search, heal-adjustment-brands |

### Why the split exists

Verbatim from `oeival_processor.py`:

> REPORTING snapshot (latest.\*): the latest OEIVAL only … so reports always
> reflect the most recent file (even a partial/single-location export).
> LOOKUP collective index (lookup.\*): a cumulative union of every OEIVAL ever
> processed, keyed by itemId (newest wins, NEVER shrinks) … so a partial upload
> such as "IET-oeival R20 ONLY.csv" can refresh the report snapshot without
> erasing coverage for every other tire. This is what fixes "tire label not found".

So a partial **"R20 ONLY"** upload correctly replaces the reporting snapshot but
does **not** wipe tire-label lookups for every other size.

### Union/merge logic (`update_lookup_index`)

The Lambda loads the existing gzipped lookup index from S3, overlays this upload's
items keyed by uppercased `itemId` (newest wins), and writes it back. Only slim
fields are kept: `LOOKUP_FIELDS = ("itemId", "manufacturerName", "description",
"model", "mfgItemId")`. The merge is wrapped non-fatally so a lookup failure does
not break the (already-written) reporting snapshot.

### Reading pattern (stream, never XLSX.read)

`custom-data/route.ts` `streamOeivalCache` comment is explicit:

> Avoids XLSX.read of the full workbook, which materializes the whole sheet in
> memory and OOM-kills the 2048MB (Hobby-cap) function.

Readers pipe the S3 body through `createGunzip()` + `readline.createInterface`,
processing one NDJSON line at a time and projecting only needed keys.
`lib/oeivalBrandIndex.ts` caches the built map in-module keyed on `meta.generatedAt`
with `TTL_MS = 10min` and an in-flight build guard; first write per itemId wins;
`manufacturerName` is normalized via `brandCodeToName`.

### Lambda triggers/guards

- S3 PUT trigger on `jmk-uploads/oeival/...`.
- Skips `_cache` keys; only `oeival` keys; only `.csv` (`.xlsx`/`.xls` skipped — no
  openpyxl layer); tires only (Product Type starts with `T`).
- Memory 2048 MB. After writing caches, fires a best-effort POST to
  `IECENTRAL_URL + /api/reports/heal-adjustment-brands` to self-heal brand-less
  adjustments. Env: `S3_JMK_UPLOADS_BUCKET`, `IECENTRAL_URL`.

---

## 5. Brand sourcing for inventory adjustments

**Purpose:** Resolve a friendly brand name (and description) for an inventory
adjustment from just its item-ID, and backfill historical blanks.

### Resolver chain (itemId → brand)

1. `resolveBrand(itemId)` in `lib/oeivalBrandIndex.ts` — uppercases/trims, looks
   up the in-memory map built from the **collective lookup cache**. `manufacturerName`
   is already passed through `brandCodeToName` at build time.
2. `app/api/reports/resolve-brand/route.ts` — `GET ?itemId=` →
   `{found, itemId, manufacturerName, description, model, mfgItemId}`.

### Backfill / heal

- `convex/inventoryAdjustments.ts` — `add` (accepts pre-resolved
  `manufacturerName`/`description`), `listMissingBrand` (blank-brand rows),
  `backfillBrands` (idempotent patch; skips rows that already have a brand).
- `app/api/reports/heal-adjustment-brands/route.ts` — `POST`: lists missing,
  `resolveBrand` each, calls `backfillBrands`. Returns
  `{scanned, resolved, patched, unresolvedCount, unresolved}`.
- **On-upload hook:** `oeival_processor.py` POSTs this route after every OEIVAL
  upload, so fresh inventory data self-heals prior adjustments.

### Brand mapping / normalization / filter / logo

| File | Role |
|---|---|
| `lib/brandMapping.ts` | `BRAND_MAP` (~250 OEIVAL code → name); `brandCodeToName` (passthrough if unknown, idempotent); `normalizeBrandName` (stale-spelling fixes); `bestBrandLabel(rawCode, catalogMfgName?)` precedence: curated > catalog > raw |
| `lib/brandFilter.ts` | `isReportableBrand` — drops junk via `EXCLUDE_PATTERNS` (internal prefixes `^iet/^trd/^aws/^impwh`, ledger/fee labels, distributor words, services, non-tire products) |
| `lib/brandLogo.ts` | `brandLogoSlug` (lowercase, non-alnum → `-`); `brandLogoSrc` → `/api/brand-logo?slug=...&v=2` |
| `app/api/brand-logo/route.ts` | Serves `brand-logos/{slug}.png` from `ietires-dunlop-jmk-uploads`; 404 → text fallback; cached |

---

## 6. Dealer rebates

**Purpose:** Convert the daily OEA07V extract into vendor dealer-rebate submission
files for two programs — **Falken Fanatic** and **Milestar Momentum** — matching
IET's internal JMK account numbers to enrolled dealers. Dunlop **BLUE RESPONSE A/S**
SKUs are folded into Falken.

### Pages & routes

| Route | File | Purpose |
|---|---|---|
| `/dealer-rebates` | `app/dealer-rebates/page.tsx` | Tabs: Dealer Management, Upload History, Reports, Stats. (A `UploadTab` manual uploader exists but is **not** wired into `TABS`.) |
| `app/api/dealer-rebates/auto-process/route.ts` | POST `{s3Key}` | Daily pipeline: download OEA07V → load dealers → `aggregate()` → write per-program daily CSVs → `saveUploadAuto` |
| `app/api/dealer-rebates/list/route.ts` | GET | List output CSVs with presigned download URLs |
| `app/api/dealer-rebates/monthly-report/route.ts` | GET | Consolidated per-program-per-quarter CSV |
| `app/api/dealer-rebates/rebuild-month/route.ts` | POST `{month}` | Rebuild deduped `dealerRebateMonthly` (stats source of truth) |
| `app/api/dealer-rebates/regenerate-outputs/route.ts` | POST `{month, cleanupLegacy?}` | Rewrite deduped daily CSVs to S3 |

### Backend & calc

- `convex/dealerRebates.ts` — dealer CRUD (1 JMK per Fanatic/Momentum ID),
  `saveUpload`/`saveUploadAuto` (**idempotent by `s3Key`+`program`** via
  `by_s3key_program`), `getStats`, `getDealerMonthlyTotals`, `setRebateMonthly`.
- `lib/dealerRebates/aggregate.ts` — pure calc (shared client/server). `rebateBrand`
  eligibility (tire types; `FAL`/`MIL`; `DUN` only if MFG part in
  `BLUE_RESPONSE_AS_FALKEN_PARTS`). Aggregation keyed by
  `${jmk}|${id}|${activityMonth}` summing net tires.
- `lib/dealerRebates/dedup.ts` — `buildMonthlyRows`/`buildDedupedLines` run files
  oldest→newest, dedup by composite line key (newest wins → amended quantities
  overwrite), filter to target month, sum per (program, dealer).

**Stats precedence:** reads deduped `dealerRebateMonthly` first; raw
`dealerRebateUploads` only fill months not present there (`monthsWithData` guard) —
a month is never double-counted.

### Store-transfer Account ID format (`W08R##` = sale, `R##W08` = return)

Two pieces of `aggregate.ts`:

```js
const STORE_ACCOUNTS = {
  "w08r20":"w08r20","r20w08":"w08r20",
  "w08r25":"w08r25","r25w08":"w08r25",
  "w08r35":"w08r35","r35w08":"w08r35",
};
// normalizeAcct: both directions canonicalize to one key (e.g. "w08r20")
```

```js
const rawAcct = (cols[COL.ACCOUNT_ID] ?? "").trim().toLowerCase();
const isReturn = /^r\d{2}w\d{2}$/.test(rawAcct);   // R##W08 order → RETURN
const rawQty = parseFloat(cols[COL.QTY]) || 0;
const signedQty = isReturn ? rawQty : rawQty * -1; // sale: flip negative→positive
```

- `W08R##` and ordinary accounts → **sale**: `rawQty` (negative in OEA07V) is
  flipped to positive net tires.
- `R##W08` → **return**: raw qty kept as-is (opposite sign), so it **subtracts**.
- Detection uses the **raw** account; matching uses the **normalized** account, so
  both transfer directions can match one dealer while only `R##W08` is a return.

### Schema tables

| Table | Key fields | Indexes |
|---|---|---|
| `dealerRebateMonthly` | month, program, jmk, name, fanaticId?, dealerNumber?, qty (net), rowCount | `by_month`, `by_month_program` |
| `dealerRebateDealers` | jmk, name, fanaticId?, dealerNumber?, programs[], primSec?, isActive | `by_jmk`, `by_fanatic_id`, `by_dealer_number`, `by_active` |
| `dealerRebateUploads` | program, matchedQty (net), dealerBreakdown[], resultData (CSV), s3Key?, uploadedBy? | `by_date`, `by_program`, `by_uploaded_by`, `by_s3key_program` |

**Gotchas:** `UploadTab` is unreachable in the UI (ingestion runs server-side).
Seeded store dealers use JMK `r20`/`r25` while transfer rows normalize to
`w08r20`/`w08r25`, and no `w08r35`/`r35` dealer is seeded (relates to the "Advantage
R35" open item) — so `w08r35` transfers currently match nothing. `BLUE RESPONSE A/S`
is a hardcoded SKU allowlist; new sizes silently miss until added.

---

## 7. Dunlop sellout reporter

**Purpose:** Automated monthly "sellout" reporting to SRNA/Dunlop. Filters OEA07V
to Falken/Dunlop tires sold from IET warehouses, transforms to Dunlop's CSV spec,
and **SFTPs** to Dunlop. Backfill Jan 2024–Feb 2026 baked into the UI.

### Front end & API routes

- Page: `app/dunlop-reporting/page.tsx` (Run History, Status/Backfill, Settings
  [super-admin only]). Shows static IP `54.163.176.67` for the SFTP whitelist.
- Routes under `app/api/dunlop/` are thin proxies to API Gateway
  (`DUNLOP_API_GATEWAY_URL || https://jzdhz2de88.execute-api.us-east-1.amazonaws.com/prod`):

| Route | Purpose |
|---|---|
| `run/route.ts` | POST → fetches Falken Fanatic exclusion JMKs from Convex, POSTs `/dunlop/run` |
| `monthly-run/route.ts` (cron target) | Finds/combines monthly OEA07V (dedup `itemId|account|invoice|date`), writes `IET-oea07v-monthly-combined.csv`, calls `/dunlop/run`. **Aborts 502 if it cannot load the Fanatic exclusion list** (avoids over-reporting). Sends `month` as `YYYYMM`. |
| `run-monthly/route.ts` | Older variant, **not scheduled** (superseded by `monthly-run`) |
| `history/route.ts`, `settings/route.ts`, `upload-url/route.ts` | Proxy history / SFTP settings / presigned upload+download |

**Live trigger:** Vercel cron `/api/dunlop/monthly-run` at `0 14 1 * *`. The
EventBridge `MonthlyTriggerRule` in SAM is **DISABLED**.

### AWS SAM stack — `aws/dunlop-reporter/template.yaml`

- Region us-east-1, `python3.12`, default Timeout 300 / Mem 512.
- **Buckets:** `ietires-dunlop-jmk-uploads`, `ietires-dunlop-output-csvs`,
  `ietires-dunlop-run-logs`, plus shared `ietires-sales-data`.
- **Secrets Manager:** `dunlop-reporter/sftp-credentials` (dev/prod SFTP),
  `dunlop-reporter/imap-relay-secret`.
- **VPC + NAT Gateway + Elastic IP** → fixed egress IP for the SFTP whitelist (the
  `54.163.176.67` shown in the UI). The IMAP relay shares this static IP.
- **ParamikoLayer** (`paramiko-layer`, content `layers/paramiko/`) attached only to
  `transform_and_upload` for SFTP.
- **API Gateway** `dunlop-reporter-api`, stage `prod`, CORS `*` → the
  `jzdhz2de88…` URL.
- SNS alarm topic emails `andy@ietires.com` on transform errors.

| Lambda | Handler | API path |
|---|---|---|
| `dunlop-generate-presigned-url` | `generate_presigned_url.handler` | POST `/dunlop/upload-url` |
| `dunlop-transform-and-upload` (VPC, Mem 1024, paramiko) | `transform_and_upload.handler` | POST `/dunlop/run` |
| `dunlop-fetch-history` | `fetch_history.handler` | GET/DELETE `/dunlop/history` |
| `dunlop-manage-settings` | `manage_settings.handler` | GET/PUT `/dunlop/settings` |
| `dunlop-imap-relay` (VPC) | `imap_relay.handler` | POST `/imap/fetch`, `/imap/fetch-one`, `/imap/folders` |
| `dunlop-fetch-sales` (Mem 1024) | `fetch_sales.handler` | GET `/dunlop/sales` |
| `dunlop-oeival-processor` (Mem 2048) | `oeival_processor.handler` | (S3 event; see §4) |

### transform_and_upload.py highlights

- `CUSTOMER_NUMBER = "20118"`, `VALID_BRANDS = {"FAL","DUN"}`, exclude
  `Trn Pur ∈ {700,7001,7002}`. **`VALID_LOCATIONS` includes W07/W08/W09/R10** even
  though the docstring says "W07, W08, R10 only" — W09 passes.
- Pipeline: keep `Trn Pur == "Sld"` → drop zero price → location filter → brand
  filter → month filter (skipped for backfill) → **Fanatic exclusion** (drop FAL
  rows whose account id is in `fanatic_jmks`; DUN always passes). Qty/price `abs()`'d.
- Outputs `output-csvs/ImportExportTireCo_{month}_Sellout.csv`, SFTPs the same
  content, writes run log JSON, best-effort `processed/{month}.json` to sales bucket.

Other lambdas: `fetch_sales` reads `processed/{month}.json` for the sales
dashboard (excludes house brands `IET-P/IET-G/IET-T`); `fetch_history` lists run
logs; `imap_relay` is the VPC-resident IMAP relay used by the in-app email client
(auth via `X-Relay-Secret`).

### `convex/ftpConnections.ts` + FTP routes

Generic **plain-FTP** ingestion (basic-ftp, `secure:false`) — distinct from the
Dunlop SFTP path. Table `ftpConnections` stores host/path/pattern/sourceType and an
encrypted password (masked in `list`/`get`; real in `getWithCredentials`).

| Route | Purpose |
|---|---|
| `app/api/reports/ftp-test/route.ts` | Ad-hoc connection test with raw creds |
| `app/api/reports/ftp-list/route.ts` | List a connection's remote path (decrypts password) |
| `app/api/reports/ftp-sync/route.ts` | GET full sync (cron-auth) / POST manual: pick newest matching file per active connection, dedupe vs `lastSyncFileName`, push to `/api/reports/upload-url` → S3 |

**Gotcha:** despite the "hourly cron" comment, ftp-sync has **no** vercel.json
entry — manual/external trigger only.

---

## 8. WTD commission

**Purpose:** Daily commission reports for wholesale-tire-dealer ("WTD") customers.
Per configured customer account, filters the prior day's qualifying tire sales and
computes a commission per line.

### Routes

| Route | File | Purpose |
|---|---|---|
| `/tools/wtd-commission` | `app/tools/wtd-commission/page.tsx` | Report viewer; month picker; PDF (jspdf) / Excel (xlsx) export |
| `/tools/wtd-commission/setup` | `app/tools/wtd-commission/setup/page.tsx` | Customer + access config (T5 only edits) |
| `app/api/wtd-commission/daily-run/route.ts` | GET (cron-auth) | Primary daily job |
| `app/api/wtd-commission/reports/route.ts` | GET/POST/DELETE | List/fetch/delete saved reports from S3 |
| `app/api/wtd-commission/s3-data/route.ts` | POST | Manual ad-hoc OEA07V range parse |
| `app/api/wtd-commission/save-report/route.ts` | POST | Manual report save |

### Backend & schema — `convex/wtdCommission.ts`

Customer CRUD (`requireAdmin`), access overrides (`wtdCommissionAccess` singleton,
`checkAccess`), reports (`saveReport` idempotent per
(customerNumber, startDate, endDate), 12-month `expiresAt`, `cleanupExpiredReports`).

| Table | Key fields | Indexes |
|---|---|---|
| `wtdCommissionCustomers` | customerNumber, qualifyingDclasses[], qualifyingBrands[] (incl "ALL"), commissionType, commissionValue, isActive | `by_customer_number`, `by_active` |
| `wtdCommissionAccess` | userIds[], updatedBy (singleton) | — |
| `wtdCommissionReports` | customer*, startDate, endDate, commissionType/Value, lineItems[], grandTotal, expiresAt | `by_customer`, `by_created`, `by_expires` |

### Daily-run & commission math

Flow: auth → compute yesterday → search current then prev month folders for
OEA07V → download (skip >50 MB) → bucket rows by activity date (dedup
`date|inv|item|qty`) → build tire-catalog lookup (incl. per-unit FET) → for each
(date × customer) filter qualifying rows, compute, write to Convex (`saveReport`)
and S3.

Qualifying filter: account matches customer; tire product type; exclude
700/7001/7002 + `^[WR]\d{2}[WR]\d{2}$` transfers + `^[WR]\d{2}$`; `qualifyingDclasses`
matched as item-ID **trailing chars** via `endsWith`; brand match unless `"ALL"`.

Commission (verbatim essentials):

```ts
const qty = -rawQty;            // sold (-8) → 8; return (2) → -2
const extCost = -rawExtCost;
const extCostExFet = extCost - perUnitFet * qty;   // back FET out
commissionAmount = commissionType === "percentage"
  ? extCostExFet * (commissionValue / 100)
  : qty * commissionValue;       // flat $/unit
// symmetric $2.50 per-line floor
```

- Percentage mode is on ext-cost-minus-FET (FET from tire catalog, default 0).
- Flat mode = `qty × value`. `$2.50` floor applied symmetrically (returns clawback).

**Scheduling gotcha:** the UI says "4 AM EST," but there is **no** WTD cron.
`daily-run` is fanned out from `/api/reports/process` (alongside `sales/refresh`
and `dealer-rebates/auto-process`) whenever an OEA07V upload is processed.
**Access:** view = `tier >= 5 || checkAccess`; edit = `tier >= 5`; Convex mutations
enforce `requireAdmin` (except `saveReport`, called by the server).

---

## 9. JMK uploads & CIR

### JMK uploads — `convex/jmkUploads.ts`

Catalog of JMK report types + upload-history ledger that feeds the S3/Lambda
pipelines.

- Report types: `listReportTypes`, `getReportType`, `seedReportType`.
- Upload history: `recordUpload` (sets `processingStatus:"complete"` immediately
  for `oeival`/`oea07v-sales`/`tires`, else `"pending"`), `updateProcessing`,
  `deleteUpload`, `listUploadHistory`, `getUpload`, `getLatestByType`.
- Access: singleton `reportUploadAccess` (`checkUploadAccess`, `setUploadAccess`).

### CIR (Controller Inventory Report)

Archives generated CIR PDFs and logs runs for a coverage tracker.

- `app/api/reports/cir/upload-url/route.ts` — presigned PUT to
  `cir-reports/{LOCATION}/{date}_{ts}.pdf` in `ietires-sales-data`.
- `app/api/reports/cir/download-url/route.ts` — presigned GET (key must start
  `cir-reports/`).
- `convex/cirReportRuns.ts` — `logRun`, `listSince`, `listByLocation`, `removeRun`.

### Schema tables

| Table | Key fields | Indexes |
|---|---|---|
| `jmkReportTypes` | reportCode, displayName, expectedColumns[], filePattern, acceptedFormats[], s3Prefix, processingTriggers[], isActive | `by_code`, `by_active` |
| `jmkUploadHistory` | reportType, fileName, s3Key, reportingMonth, reportDate?, validationStatus, processingStatus, processingResults[], uploadedBy? | `by_report_type`, `by_month`, `by_created` |
| `cirReportRuns` | locationCode, brands[], generatedBy?, s3Key?, rowCount? | `by_location_created`, `by_created` |

---

## 10. Tire search / catalog helpers & label printing

### Tire search & size helpers

| File | Role |
|---|---|
| `lib/tireSearch.ts` | `tireSizeMatchesQuery` — match separator-stripped size query (e.g. `2656018`) against a description via `/(\d{2,3})\/(\d{2,3})Z?R(\d{2})/i`; bidirectional substring |
| `lib/tireSize.ts` | `parseTireDims` + `tireSortKey(description) → [rim, width, aspect]` for stable sort |
| `lib/tireDescriptions.ts` | `formatTireSize` (digits → `205/55R17`); `buildTireDescription` (Size + Load/Speed + Brand + Model + …) |
| `components/TireSearchBox.tsx` | 300ms-debounced type-ahead → `GET /api/reports/tire-search` (used only by bin-labels Tire mode) |
| `app/api/reports/tire-search/route.ts` | Calls `searchTires(q, 40)` (AND-match across terms, plain or separator-stripped substring) |

**Search data source (gotcha):** the catalog is the **collective/cumulative OEIVAL
lookup index** (`lookup.*` NDJSON.gz streamed via `lib/oeivalBrandIndex.ts`), not
the latest snapshot. `resolveBrand(itemId)` backs the bin-labels "Look up" button.

### Bin labels vs tire labels — `app/bin-labels/page.tsx`

Single page (`/bin-labels`), mode toggle `bin | tire`; both use JsBarcode (CODE128).

- **Bin labels** (6"×2" thermal): global `copies` count; **printing is CSS-based**
  (`window.print()` + a `createPortal` `#print-root` and `@page { size: 6in 2in }`).
- **Tire labels** (4"×6" shipping): per-label `qty`; fill via `TireSearchBox`,
  item-ID "Look up" (`/api/reports/resolve-brand`), or manual. **Printing is
  jsPDF-based** (`printTireLabelsPdf`): `new jsPDF({unit:"in", format:[4,6]})`,
  brand logo (re-encoded white-backed PNG to avoid black-block bug) + brand/model/
  size text + CODE128 barcode rasterized to PNG (value = MPN ?? itemId) + footer
  `Created {date} · {user}`; output printed via a hidden iframe (popup-blocker safe).

### `convex/labelWorkOrders.ts`

Tire-mode batch save/print: `create` (labelType `"tire"`, status `"open"`), `list`
(`by_status_created` / `by_created`), `get`, `markPrinted`, `remove`. Schema
`labelWorkOrders` indexes `by_status_created`, `by_created`.

**Gotcha:** the persisted label object omits `mpn`, so reloaded work orders lose a
manually-entered MPN and the barcode falls back to itemId.

---

## 11. Cross-cutting gotchas

- **OEIVAL must be streamed, never `XLSX.read`-ed** — the raw workbook (~474K rows)
  OOM-kills the 2048 MB serverless function. Use the NDJSON.gz caches.
- **Two OEIVAL caches** with different lifecycles: `latest.*` (reporting, latest
  only) vs `lookup.*` (cumulative, never shrinks). A partial upload must not be
  allowed to shrink lookups.
- **WTD daily-run and dealer-rebates have no dedicated cron** — they fan out from
  `/api/reports/process`. The only Vercel crons are sales/refresh,
  reports/auto-process, and dunlop/monthly-run.
- **Two Dunlop monthly-run implementations** — `monthly-run` (live, Convex-abort
  safety guard) vs `run-monthly` (older, unscheduled). EventBridge monthly rule is
  DISABLED; live trigger is the Vercel cron.
- **W09 location inconsistency** — `transform_and_upload.py` docstring says
  W07/W08/R10 only, but `VALID_LOCATIONS` includes W09 (it passes).
- **Idempotency everywhere:** dealer-rebate uploads keyed by `s3Key+program`; WTD
  `saveReport` by (customer, start, end); brand backfill skips already-populated
  rows; upload-history dedup by `s3Key`.
- **Plaintext dev SFTP password** lives in `template.yaml`; prod creds are `TBD`
  placeholders managed via Secrets Manager / the Settings tab.
- **Two ingestion architectures** coexist — S3-direct (primary) and the legacy
  Convex-table `ingest` path (`XLSX.read`, OOM-prone).
- **Store-transfer accounts** canonicalize both directions to one key, but the
  return flag is detected on the **raw** `R##W08` form only.

---

### Key file index

| Concern | Primary files |
|---|---|
| Hub & registry | `app/reports/page.tsx`, `lib/reportTypes.ts` |
| Ingestion routes | `app/api/reports/{validate,upload-url,upload-status,ingest,process,auto-process,custom-data,inventory-data,sales-by-day,sales-history-data}/route.ts` |
| Convex report layer | `convex/reportData.ts`, `convex/reports.ts`, `convex/savedReports.ts`, `convex/jmkUploads.ts`, `convex/cirReportRuns.ts` |
| OEIVAL cache | `aws/dunlop-reporter/lambdas/oeival_processor.py`, `lib/oeivalBrandIndex.ts` |
| Brand sourcing | `lib/{brandMapping,brandFilter,brandLogo,oeivalBrandIndex}.ts`, `convex/inventoryAdjustments.ts`, `app/api/reports/{resolve-brand,heal-adjustment-brands}/route.ts`, `app/api/brand-logo/route.ts` |
| Dealer rebates | `app/dealer-rebates/page.tsx`, `convex/dealerRebates.ts`, `lib/dealerRebates/{aggregate,dedup}.ts`, `app/api/dealer-rebates/*` |
| Dunlop reporter | `app/dunlop-reporting/page.tsx`, `app/api/dunlop/*`, `aws/dunlop-reporter/{template.yaml,lambdas/*.py}`, `convex/ftpConnections.ts` |
| WTD commission | `app/tools/wtd-commission/*`, `app/api/wtd-commission/*`, `convex/wtdCommission.ts` |
| Tire search & labels | `lib/{tireSearch,tireSize,tireDescriptions}.ts`, `components/TireSearchBox.tsx`, `app/bin-labels/page.tsx`, `convex/labelWorkOrders.ts`, `app/api/reports/tire-search/route.ts` |
