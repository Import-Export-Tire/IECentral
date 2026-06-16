# Temp Employees + Eligible-for-Hire Tracking — Design

**Date:** 2026-06-16
**Status:** Approved, pending implementation

## Problem

IECentral tracks W-2 employees in the `personnel` system (with hire dates, 90-day
reviews, insurance eligibility, payroll). It has no concept of **temporary workers**
placed through staffing agencies. The business wants to:

1. Put temps on the roster so they can be tracked and evaluated.
2. Track **when each temp becomes eligible for direct hire** (temp-to-hire), and
   surface a report of who's becoming eligible so managers convert good temps in time.

Temps are paid through the staffing agency (not W-2), so they must be **kept out of**
payroll, benefits, insurance, headcount, and the review cycle — while still being
trackable (write-ups/performance notes) and convertible to real employees.

## Architectural Context (current code)

- `personnel` records have `employeeType: v.string()` (`"full_time" | "part_time" |
  "seasonal"`), `status` (`"active" | "on_leave" | "terminated"`), `hireDate` (YYYY-MM-DD),
  `department`, `locationId`, `ninetyDayReview`, `annualReviews`, `excludeFromReviews`.
- **No business logic branches on `employeeType` today** — only `status` is filtered.
  So "temp" exclusions must be added explicitly.
- Eligibility reports (insurance, 90-day) are **client-side**: `useQuery(api.personnel.list,
  { status: "active" })` → `useMemo` date math → windowed table → optional jsPDF export.
- ATS hire flow: `convex/personnel.ts:createFromApplication` + `app/applications/[id]/page.tsx:handleHire`.
- Reports are registered in `lib/reportTypes.ts` (`REPORT_TYPES`), permission-gated by `report.<id>`.

## Decisions (confirmed)

- **Temps are personnel records** with `employeeType: "temp"` + temp-only fields — not a
  separate table. Convert-to-hire is an in-place flip that preserves history.
- **Eligibility basis: days OR hours.** Per temp, choose a mode and value. The eligible
  *date* is computed:
  - `days` → `tempStartDate + value` calendar days.
  - `hours` → `tempStartDate + round(value / 40 * 7)` calendar days (assumes a 40-hr week;
    this is a **projection** — actual worked hours are not summed in v1).
  - A manual `tempEligibleDateOverride` wins when set.
- **Entry points: both** — add a temp directly in Personnel, and hire an applicant as a temp via ATS.
- **Agency: name only** — one optional `staffingAgency` text field.
- **Temps still participate in: write-ups / performance notes** (same record). They are
  **excluded** from payroll/QuickBooks, headcount, insurance eligibility, 90-day & annual
  reviews, tenure check-ins, and scheduling/attendance.

## Components

### 1. Data model — new optional fields on `personnel` (`convex/schema.ts`)

```
staffingAgency: v.optional(v.string()),
tempEligibilityMode: v.optional(v.string()),    // "days" | "hours"
tempEligibilityValue: v.optional(v.number()),   // e.g. 90 (days) or 520 (hours)
tempEligibleDateOverride: v.optional(v.string()), // YYYY-MM-DD, optional manual override
```

`hireDate` stores the **temp start date** while `employeeType === "temp"`. (On convert,
it is set to the real hire date.) `"temp"` is added as a recognized value of the existing
`employeeType` string (no enum change needed at the DB layer; UI/convention add it).

### 2. Eligibility helper (shared)

A pure function (e.g. `lib/tempEligibility.ts`):

```
computeTempEligibleDate(personnel): Date | null
  if tempEligibleDateOverride → parse and return it
  if no hireDate or no mode/value → null
  start = new Date(hireDate)
  if mode === "days"  → start + value days
  if mode === "hours" → start + Math.round(value / 40 * 7) days
```

Plus `tempEligibilityLabel(personnel)` → `"90 days"` / `"520 hrs"` for display.

### 3. Entry points

- **`app/personnel/new/page.tsx`**: add `{ value: "temp", label: "Temp" }` to `EMPLOYEE_TYPES`.
  When Temp is selected: relabel `hireDate` → "Temp start date" and reveal temp fields
  (Staffing Agency text; eligibility mode toggle days/hours; value number; optional override
  date). `create` mutation gains the new optional args and stores them.
- **`app/applications/[id]/page.tsx` hire modal**: add "Temp" to the type dropdown; when
  Temp, show the same temp fields. `convex/personnel.ts:createFromApplication` gains the
  new optional args.

### 4. Segregation — add `employeeType !== "temp"` guards

Each of these currently filters only on `status: "active"` and must also exclude temps:

- `convex/quickbooks.ts:getUnmappedPersonnel` (~L197) and the dashboard active count (~L731)
- `app/personnel/page.tsx` active **headcount** stats (~L102, L135–137)
- `app/reports/insurance-eligibility/page.tsx` (~L39, L50–81)
- `app/reports/ninety-day-reviews/page.tsx` (~L108, L156–191) — and annual reviews
- `convex/personnel.ts:getPendingTenureCheckIns` (~L143–201)
- scheduling/attendance lists that enumerate active personnel (filter temps out)

The general personnel CSV export (`convex/reports.ts:getPersonnelExport`) keeps temps but
the `employeeType` column already distinguishes them.

### 5. Roster display (`app/personnel/page.tsx`)

- Show a **"Temp"** badge on temp rows.
- Optional "Temp" filter alongside the existing status/role filters.
- Active-employee stat cards exclude temps (per §4); optionally a small "Temps: N" stat.

### 6. Convert to hire (`app/personnel/[id]/page.tsx` + `convex/personnel.ts`)

- Detail page shows, for temps: agency, basis, computed eligible date, days-to-eligible,
  and a **"Convert to hire"** button.
- New mutation `convex/personnel.ts:convertTempToHire({ personnelId, hireDate, employeeType, userId })`:
  sets `employeeType` to the chosen real type (`full_time`/`part_time`), sets `hireDate` to
  the actual hire date, clears `tempEligibilityMode/Value/Override` (keeps `staffingAgency`
  for history), writes an audit log entry. Reviews/insurance now compute from the new hireDate.
- Temp eligibility/agency are editable on the detail page (the standard edit modal gains the
  temp fields when the record is a temp).

### 7. "Temp Conversion" report

- **`lib/reportTypes.ts`**: add `{ id: "temp-conversion", title: "Temp Conversion",
  description: "Temps becoming eligible for direct hire", group: "hr", external: true,
  href: "/reports/temp-conversion" }`. Default permission tier: **T3+** (matches the
  90-day review report), via `report.temp-conversion` in `lib/permissions.ts`.
- **`app/reports/temp-conversion/page.tsx`**: mirrors `insurance-eligibility/page.tsx` —
  `useQuery(api.personnel.list, { status: "active" })`, filter to `employeeType === "temp"`,
  compute each eligible date via the shared helper, window (default 30 days before / after,
  adjustable), sortable table + jsPDF export. Columns: Name, Agency, Start date, Basis,
  Eligible date, Days-to-eligible, link to the temp's detail page (Convert).

## Out of Scope (v1)

- Agency bill rate / cost tracking.
- Summing *actual* worked hours (hours basis is a 40-hr/week projection).
- Temps in scheduling/attendance.
- Bulk convert.

## Testing (manual — no UI test harness)

1. Add a temp (days basis) → appears with Temp badge; excluded from headcount.
2. Add a temp (hours basis, 520) → eligible date ≈ start + 91 days; shows in Temp Conversion report when in window.
3. Hire an applicant as Temp via ATS → temp record created with temp fields.
4. Verify temp is absent from: insurance-eligibility, 90-day reviews, QuickBooks unmapped, active headcount.
5. Add a write-up / performance note to a temp → succeeds.
6. Convert temp → hire: type flips to full_time, hireDate set, temp fields cleared, audit log written, now appears in review/insurance trackers from the new hire date; prior notes retained.
7. Override eligible date → report uses the override.
