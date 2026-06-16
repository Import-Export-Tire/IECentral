# Temp Employees + Eligible-for-Hire Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let IECentral track temporary (staffing-agency) workers on the personnel roster, compute when each becomes eligible for direct hire, surface a "Temp Conversion" report, and convert a temp into a real employee in place — while keeping temps out of payroll/benefits/insurance/reviews/headcount.

**Architecture:** Temps are ordinary `personnel` records with `employeeType: "temp"` plus four optional temp fields. A shared pure helper computes the eligible date (days basis, or hours basis projected at 40 hrs/week). Employee-only systems gain `employeeType !== "temp"` exclusion guards. A new report mirrors the existing client-side insurance-eligibility page. Convert-to-hire flips the type in place, preserving the record (and its write-ups/notes).

**Tech Stack:** Next.js (App Router, client components), Convex (mutations/queries), React, Tailwind, TypeScript, jsPDF/jspdf-autotable (report export).

**Spec:** `docs/superpowers/specs/2026-06-16-temp-employees-eligible-for-hire-design.md`

**Testing note:** This repo has **no automated test harness** (`package.json` scripts are only `dev/build/start/lint`). The automated gate for each task is `npx tsc --noEmit`; behavior is verified manually (Task 9). Tasks follow implement → typecheck → commit.

---

## File Structure

- **Create** `lib/tempEligibility.ts` — pure helpers: `isTemp`, `computeTempEligibleDate`, `tempEligibilityLabel`, `TEMP_TYPE`. One responsibility: temp eligibility math. Imported by report page, personnel pages.
- **Modify** `convex/schema.ts` — add 4 optional fields to the `personnel` table.
- **Modify** `convex/personnel.ts` — accept temp fields in `create`/`createFromApplication`/`update`; add `convertTempToHire` mutation.
- **Modify** `convex/quickbooks.ts` — exclude temps from unmapped-personnel + active count.
- **Modify** `app/reports/insurance-eligibility/page.tsx` & `app/reports/ninety-day-reviews/page.tsx` — exclude temps.
- **Modify** `app/personnel/new/page.tsx` — Temp type + temp fields on the Add form.
- **Modify** `app/applications/[id]/page.tsx` — Temp option + temp fields in the hire modal.
- **Modify** `app/personnel/[id]/page.tsx` — show/edit temp info; Convert-to-hire action.
- **Modify** `app/personnel/page.tsx` — Temp badge, exclude temps from headcount, Temp filter.
- **Create** `app/reports/temp-conversion/page.tsx` — the Temp Conversion report.
- **Modify** `lib/reportTypes.ts` — register the report.

---

## Task 1: Shared eligibility helper + schema fields

**Files:**
- Create: `lib/tempEligibility.ts`
- Modify: `convex/schema.ts` (personnel table)

- [ ] **Step 1: Create the helper**

Create `lib/tempEligibility.ts` with exactly:

```ts
// Temp-to-hire eligibility helpers. A "temp" is a personnel record with
// employeeType === TEMP_TYPE. Its hireDate doubles as the temp start date.

export const TEMP_TYPE = "temp";

export function isTemp(employeeType?: string | null): boolean {
  return employeeType === TEMP_TYPE;
}

export interface TempEligibilityInput {
  hireDate?: string;                 // YYYY-MM-DD; temp start date while a temp
  tempEligibilityMode?: string;      // "days" | "hours"
  tempEligibilityValue?: number;     // e.g. 90 (days) or 520 (hours)
  tempEligibleDateOverride?: string; // YYYY-MM-DD; manual override wins when set
}

// Compute the projected eligible-for-hire date.
// - override wins when present
// - days mode: start + value calendar days
// - hours mode: start + round(value / 40 * 7) calendar days (40-hr week projection)
export function computeTempEligibleDate(p: TempEligibilityInput): Date | null {
  if (p.tempEligibleDateOverride) {
    const d = new Date(p.tempEligibleDateOverride);
    return isNaN(d.getTime()) ? null : d;
  }
  if (!p.hireDate || !p.tempEligibilityMode || !p.tempEligibilityValue) return null;
  const start = new Date(p.hireDate);
  if (isNaN(start.getTime())) return null;
  const days =
    p.tempEligibilityMode === "hours"
      ? Math.round((p.tempEligibilityValue / 40) * 7)
      : p.tempEligibilityValue;
  const elig = new Date(start);
  elig.setDate(elig.getDate() + days);
  return elig;
}

export function tempEligibilityLabel(p: TempEligibilityInput): string {
  if (!p.tempEligibilityMode || !p.tempEligibilityValue) return "—";
  return p.tempEligibilityMode === "hours"
    ? `${p.tempEligibilityValue} hrs`
    : `${p.tempEligibilityValue} days`;
}
```

- [ ] **Step 2: Add schema fields**

In `convex/schema.ts`, find the `personnel: defineTable({ ... })` block. After the line
`notes: v.optional(v.string()),` (inside the personnel table), add:

```ts
    // Temp / staffing-agency fields (employeeType === "temp"). hireDate is the temp start date.
    staffingAgency: v.optional(v.string()),
    tempEligibilityMode: v.optional(v.string()),      // "days" | "hours"
    tempEligibilityValue: v.optional(v.number()),     // e.g. 90 days or 520 hours
    tempEligibleDateOverride: v.optional(v.string()), // YYYY-MM-DD manual override
```

(Convex schema is permissive about new optional fields; existing records are unaffected.)

- [ ] **Step 3: Typecheck**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/tempEligibility.ts convex/schema.ts
git commit -m "feat(temp): add temp eligibility helper + personnel schema fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Convex mutations accept temp fields + convert-to-hire

**Files:**
- Modify: `convex/personnel.ts`

- [ ] **Step 1: Add temp args to `create`**

In `convex/personnel.ts`, the `create` mutation's `args` ends with `notes: v.optional(v.string()),`
followed by `userId`/`requestingUserId`. Add these four args right after `notes: v.optional(v.string()),`:

```ts
    staffingAgency: v.optional(v.string()),
    tempEligibilityMode: v.optional(v.string()),
    tempEligibilityValue: v.optional(v.number()),
    tempEligibleDateOverride: v.optional(v.string()),
```

Then in the same mutation's `ctx.db.insert("personnel", { ... })`, add after `notes: args.notes,`:

```ts
      staffingAgency: args.staffingAgency,
      tempEligibilityMode: args.tempEligibilityMode,
      tempEligibilityValue: args.tempEligibilityValue,
      tempEligibleDateOverride: args.tempEligibleDateOverride,
```

- [ ] **Step 2: Add temp args to `createFromApplication`**

In `createFromApplication`, add the same four args after `notes: v.optional(v.string()),`:

```ts
    staffingAgency: v.optional(v.string()),
    tempEligibilityMode: v.optional(v.string()),
    tempEligibilityValue: v.optional(v.number()),
    tempEligibleDateOverride: v.optional(v.string()),
```

And in its `ctx.db.insert("personnel", { ... })`, add after `notes: args.notes,`:

```ts
      staffingAgency: args.staffingAgency,
      tempEligibilityMode: args.tempEligibilityMode,
      tempEligibilityValue: args.tempEligibilityValue,
      tempEligibleDateOverride: args.tempEligibleDateOverride,
```

- [ ] **Step 3: Add temp args to `update`**

In the `update` mutation `args`, after `notes: v.optional(v.string()),` add:

```ts
    staffingAgency: v.optional(v.string()),
    tempEligibilityMode: v.optional(v.string()),
    tempEligibilityValue: v.optional(v.number()),
    tempEligibleDateOverride: v.optional(v.string()),
```

The `update` handler already spreads `...updates` and patches every defined field, so no handler
change is needed — the new args flow through automatically.

- [ ] **Step 4: Add the `convertTempToHire` mutation**

Add this new mutation at the end of `convex/personnel.ts` (top-level export):

```ts
// Convert a temp (employeeType === "temp") into a real employee in place.
// Flips the type, sets the real hire date, clears temp-only eligibility fields
// (keeps staffingAgency for history), and writes an audit log entry.
export const convertTempToHire = mutation({
  args: {
    personnelId: v.id("personnel"),
    hireDate: v.string(),        // actual W-2 hire date (YYYY-MM-DD)
    employeeType: v.string(),    // "full_time" | "part_time"
    userId: v.optional(v.id("users")),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const existing = await ctx.db.get(args.personnelId);
    if (!existing) throw new Error("Personnel not found");
    if (existing.employeeType !== "temp") {
      throw new Error("This person is not a temp");
    }
    const now = Date.now();
    await ctx.db.patch(args.personnelId, {
      employeeType: args.employeeType,
      hireDate: args.hireDate,
      tempEligibilityMode: undefined,
      tempEligibilityValue: undefined,
      tempEligibleDateOverride: undefined,
      updatedAt: now,
    });
    if (args.userId) {
      const user = await ctx.db.get(args.userId);
      if (user) {
        await ctx.db.insert("auditLogs", {
          action: "Converted temp to employee",
          actionType: "update",
          resourceType: "personnel",
          resourceId: args.personnelId,
          userId: args.userId,
          userEmail: user.email || "unknown",
          details: `Converted ${existing.firstName} ${existing.lastName} from temp to ${args.employeeType} (hire date ${args.hireDate})`,
          timestamp: now,
        });
      }
    }
    return args.personnelId;
  },
});
```

(Verify the file already imports `mutation` and `v` — it does, since the existing mutations use them. `requireManagePersonnel` is the same guard the other mutations use.)

- [ ] **Step 5: Typecheck**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add convex/personnel.ts
git commit -m "feat(temp): personnel mutations accept temp fields + convertTempToHire

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Exclude temps from employee-only systems

**Files:**
- Modify: `convex/quickbooks.ts`, `convex/personnel.ts`, `app/reports/insurance-eligibility/page.tsx`, `app/reports/ninety-day-reviews/page.tsx`, `app/personnel/page.tsx`

The rule everywhere: a record is a temp when `employeeType === "temp"`. Exclude those.

- [ ] **Step 1: QuickBooks — exclude temps**

In `convex/quickbooks.ts`, `getUnmappedPersonnel` (~line 197) queries active personnel.
After it collects the active personnel array (the `.filter`/`.collect` that uses `status === "active"`),
add `.filter((p) => p.employeeType !== "temp")` to the resulting array, or add the condition inline
to the existing filter. Concretely, wherever it currently filters `p.status === "active"`, change to
`p.status === "active" && p.employeeType !== "temp"`.

Do the same for the dashboard `activePersonnel` count (~line 731): change the active filter to also
require `p.employeeType !== "temp"`.

- [ ] **Step 2: Tenure check-ins — exclude temps**

In `convex/personnel.ts`, `getPendingTenureCheckIns` (~line 143) iterates active personnel. Where it
filters/iterates active records, skip temps: add `if (p.employeeType === "temp") continue;` inside the
loop (or `&& p.employeeType !== "temp"` to the active filter).

- [ ] **Step 3: Insurance-eligibility report — exclude temps**

In `app/reports/insurance-eligibility/page.tsx`, the `rows` useMemo begins with
`return personnel.filter((p) => !locationFilter || p.locationId === locationFilter)`. Change that first
filter to also drop temps:

```ts
    return personnel
      .filter((p) => p.employeeType !== "temp")
      .filter((p) => !locationFilter || p.locationId === locationFilter)
```

- [ ] **Step 4: 90-day reviews report — exclude temps**

In `app/reports/ninety-day-reviews/page.tsx`, the `ninetyRows` memo (~line 156) maps active personnel.
Add a `.filter((p) => p.employeeType !== "temp")` to the personnel array before the mapping that
computes review buckets (mirror the placement used in Step 3).

- [ ] **Step 5: Personnel list headcount — exclude temps**

In `app/personnel/page.tsx` (~lines 102, 135–137), the active-employee stat is computed as
`personnel.filter((p) => p.status === "active").length`. Change those headcount computations to
`personnel.filter((p) => p.status === "active" && p.employeeType !== "temp").length`. (The roster table
itself still lists temps — only the stat cards exclude them. Task 7 adds the badge/filter.)

- [ ] **Step 6: Typecheck**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add convex/quickbooks.ts convex/personnel.ts app/reports/insurance-eligibility/page.tsx app/reports/ninety-day-reviews/page.tsx app/personnel/page.tsx
git commit -m "feat(temp): exclude temps from payroll, reviews, insurance, tenure, headcount

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Personnel "Add" form — Temp type + fields

**Files:**
- Modify: `app/personnel/new/page.tsx`

- [ ] **Step 1: Add the Temp type option**

In `app/personnel/new/page.tsx`, the `EMPLOYEE_TYPES` constant (~lines 13–18) lists the dropdown
options. Add a Temp entry:

```ts
  { value: "temp", label: "Temp (staffing agency)" },
```

- [ ] **Step 2: Add temp form state**

In the component's form state (the `useState` holding the new-personnel form fields), add fields:
`staffingAgency: ""`, `tempEligibilityMode: "days"`, `tempEligibilityValue: ""`,
`tempEligibleDateOverride: ""`. If the form uses a single state object, add these keys; if it uses
discrete `useState`s, add four `useState`s with those defaults.

- [ ] **Step 3: Render temp fields when Temp is selected**

After the existing `employeeType` dropdown and `hireDate` field in the JSX, add a conditional block
shown only when the selected type is `"temp"`. Relabel the hire-date field to "Temp start date" when
temp (or add a helper caption). Add the block:

```tsx
{form.employeeType === "temp" && (
  <div className="space-y-4 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Staffing Agency</label>
      <input
        type="text"
        value={form.staffingAgency}
        onChange={(e) => setForm({ ...form, staffingAgency: e.target.value })}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
        placeholder="e.g. Express Employment"
      />
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Eligible after</label>
        <input
          type="number"
          min={1}
          value={form.tempEligibilityValue}
          onChange={(e) => setForm({ ...form, tempEligibilityValue: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          placeholder="e.g. 90"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Basis</label>
        <select
          value={form.tempEligibilityMode}
          onChange={(e) => setForm({ ...form, tempEligibilityMode: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="days">Days</option>
          <option value="hours">Hours (at 40/wk)</option>
        </select>
      </div>
    </div>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Override eligible date (optional)
      </label>
      <input
        type="date"
        value={form.tempEligibleDateOverride}
        onChange={(e) => setForm({ ...form, tempEligibleDateOverride: e.target.value })}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
      />
    </div>
  </div>
)}
```

Adapt the `form`/`setForm` references to the file's actual state variable names (read the file first).

- [ ] **Step 4: Pass temp fields to the create mutation**

In the submit handler that calls `api.personnel.create`, include the temp fields (only meaningful when
temp, but harmless otherwise — send them when `employeeType === "temp"`, else omit):

```ts
        ...(form.employeeType === "temp"
          ? {
              staffingAgency: form.staffingAgency || undefined,
              tempEligibilityMode: form.tempEligibilityMode,
              tempEligibilityValue: form.tempEligibilityValue ? Number(form.tempEligibilityValue) : undefined,
              tempEligibleDateOverride: form.tempEligibleDateOverride || undefined,
            }
          : {}),
```

- [ ] **Step 5: Typecheck**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/personnel/new/page.tsx
git commit -m "feat(temp): add Temp type + eligibility/agency fields to Add Personnel form

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: ATS hire modal — hire as Temp

**Files:**
- Modify: `app/applications/[id]/page.tsx`

- [ ] **Step 1: Add Temp to the hire-type dropdown**

In `app/applications/[id]/page.tsx`, the hire modal's employee-type `<select>` (~lines 1818–1821)
lists `full_time`, `part_time`, `contract`, `seasonal`. Add:

```tsx
                <option value="temp">Temp (staffing agency)</option>
```

- [ ] **Step 2: Add temp fields state + conditional UI**

Add temp state to the hire-modal form state (`staffingAgency: ""`, `tempEligibilityMode: "days"`,
`tempEligibilityValue: ""`, `tempEligibleDateOverride: ""`). After the type dropdown in the modal,
render the SAME conditional temp block from Task 4 Step 3 (Staffing Agency, Eligible-after value, Basis
select, Override date), wired to this modal's state setters. Show it only when the selected type is
`"temp"`.

- [ ] **Step 3: Pass temp fields to `createFromApplication`**

In `handleHire` (~line 276), where it calls `api.personnel.createFromApplication`, add the temp fields
when temp (same shape as Task 4 Step 4):

```ts
        ...(hireForm.employeeType === "temp"
          ? {
              staffingAgency: hireForm.staffingAgency || undefined,
              tempEligibilityMode: hireForm.tempEligibilityMode,
              tempEligibilityValue: hireForm.tempEligibilityValue ? Number(hireForm.tempEligibilityValue) : undefined,
              tempEligibleDateOverride: hireForm.tempEligibleDateOverride || undefined,
            }
          : {}),
```

Adapt variable names to the file's actual hire-form state (read the file first).

- [ ] **Step 4: Typecheck**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/applications/[id]/page.tsx
git commit -m "feat(temp): allow hiring an applicant as a Temp from the ATS hire modal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Personnel detail — temp info, edit, Convert-to-hire

**Files:**
- Modify: `app/personnel/[id]/page.tsx`

- [ ] **Step 1: Import the helper**

At the top of `app/personnel/[id]/page.tsx`, add:

```ts
import { isTemp, computeTempEligibleDate, tempEligibilityLabel } from "@/lib/tempEligibility";
```

- [ ] **Step 2: Show a temp summary card**

In the detail view, when `isTemp(personnel.employeeType)`, render a summary card near the top (adapt
class names to the page's style):

```tsx
{personnel && isTemp(personnel.employeeType) && (
  <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 mb-4">
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="text-sm text-gray-800">
        <span className="font-semibold text-amber-700">TEMP</span>
        {personnel.staffingAgency ? ` · ${personnel.staffingAgency}` : ""}
        {" · eligible "}
        {(() => {
          const d = computeTempEligibleDate(personnel);
          return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
        })()}
        {` (${tempEligibilityLabel(personnel)})`}
      </div>
      <button
        onClick={() => setShowConvertModal(true)}
        className="px-3 py-1.5 rounded-full text-xs font-semibold text-white"
        style={{ backgroundColor: "#007AFF" }}
      >
        Convert to hire
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 3: Add convert-modal state + mutation hook**

Add `const [showConvertModal, setShowConvertModal] = useState(false);` and
`const [convertForm, setConvertForm] = useState({ hireDate: new Date().toISOString().split("T")[0], employeeType: "full_time" });`
near the other modal state. Add the mutation hook with the other mutations:
`const convertTempToHire = useMutation(api.personnel.convertTempToHire);`

- [ ] **Step 4: Render the convert modal**

Add this modal (adapt the wrapper classes to match the page's existing modals; read one for the pattern):

```tsx
{showConvertModal && personnel && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
      <h3 className="text-lg font-semibold mb-4">Convert {personnel.firstName} to employee</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Hire date</label>
          <input type="date" value={convertForm.hireDate}
            onChange={(e) => setConvertForm({ ...convertForm, hireDate: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Employee type</label>
          <select value={convertForm.employeeType}
            onChange={(e) => setConvertForm({ ...convertForm, employeeType: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg">
            <option value="full_time">Full Time</option>
            <option value="part_time">Part Time</option>
          </select>
        </div>
        <p className="text-xs text-gray-500">
          Reviews and insurance eligibility will start from this hire date. The staffing agency is kept for history; their write-ups/notes are retained.
        </p>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={() => setShowConvertModal(false)}
          className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-100">Cancel</button>
        <button
          onClick={async () => {
            if (!currentUser) return;
            await convertTempToHire({
              personnelId: personnel._id,
              hireDate: convertForm.hireDate,
              employeeType: convertForm.employeeType,
              userId: currentUser._id,
              requestingUserId: currentUser._id,
            });
            setShowConvertModal(false);
          }}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ backgroundColor: "#007AFF" }}
        >
          Convert
        </button>
      </div>
    </div>
  </div>
)}
```

Use the page's existing current-user variable in place of `currentUser` (read the file — it already
calls personnel mutations with a requesting user id; reuse that same value for `userId`/`requestingUserId`).

- [ ] **Step 5: Add temp fields to the edit modal (optional edits)**

The standard edit modal (`editPersonnelForm`, ~line 463) lacks `employeeType` and temp fields. Add to
its state: `staffingAgency`, `tempEligibilityMode`, `tempEligibilityValue`, `tempEligibleDateOverride`,
initialized from `personnel` when the modal opens. When `isTemp(personnel.employeeType)`, render the
same temp fields block (Task 4 Step 3) inside the edit modal, and include the four fields in the
`api.personnel.update` call. (This lets you fix a temp's agency/eligibility after creation.)

- [ ] **Step 6: Typecheck**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add app/personnel/[id]/page.tsx
git commit -m "feat(temp): temp summary + edit + Convert-to-hire on personnel detail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Personnel list — Temp badge + filter

**Files:**
- Modify: `app/personnel/page.tsx`

- [ ] **Step 1: Import the helper**

Add at the top: `import { isTemp } from "@/lib/tempEligibility";`

- [ ] **Step 2: Render a Temp badge**

In the roster row/card rendering, where role/status badges are shown for each person, add (when temp):

```tsx
{isTemp(p.employeeType) && (
  <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-100 text-amber-700">Temp</span>
)}
```

- [ ] **Step 3: Add a Temp filter toggle**

Where the existing status/role filters are rendered, add a control to filter to temps. Add state
`const [showTempsOnly, setShowTempsOnly] = useState(false);` and, in the list-filtering logic, when
`showTempsOnly` is true keep only `isTemp(p.employeeType)`. Add a small toggle button near the other
filters:

```tsx
<button
  onClick={() => setShowTempsOnly((v) => !v)}
  className={`px-3 py-1.5 text-xs font-medium rounded-full ${showTempsOnly ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-700"}`}
>
  Temps only
</button>
```

- [ ] **Step 4: Typecheck**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/personnel/page.tsx
git commit -m "feat(temp): Temp badge + 'Temps only' filter on personnel roster

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Temp Conversion report

**Files:**
- Modify: `lib/reportTypes.ts`
- Create: `app/reports/temp-conversion/page.tsx`

- [ ] **Step 1: Register the report**

In `lib/reportTypes.ts`, inside the `REPORT_TYPES` array in the HR group (near the
`insurance-eligibility` and `ninety-day-reviews` entries), add:

```ts
  {
    id: "temp-conversion",
    title: "Temp Conversion",
    description: "Temps becoming eligible for direct hire",
    icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7zM20 8v6M23 11h-6",
    href: "/reports/temp-conversion",
    group: "hr",
    external: true,
  },
```

- [ ] **Step 2: Create the report page**

Create `app/reports/temp-conversion/page.tsx` with exactly:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";
import { isTemp, computeTempEligibleDate, tempEligibilityLabel } from "@/lib/tempEligibility";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function formatDateShort(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function TempConversionContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const personnel = useQuery(api.personnel.list, { status: "active" });
  const locations = useQuery(api.locations.list) || [];

  const [daysBefore, setDaysBefore] = useState(30);
  const [daysAfter, setDaysAfter] = useState(30);
  const [locationFilter, setLocationFilter] = useState<Id<"locations"> | "">("");
  const [generating, setGenerating] = useState(false);

  const rows = useMemo(() => {
    if (!personnel) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return personnel
      .filter((p) => isTemp(p.employeeType))
      .filter((p) => !locationFilter || p.locationId === locationFilter)
      .map((p) => {
        const eligDate = computeTempEligibleDate(p);
        const daysToEligibility = eligDate
          ? Math.ceil((eligDate.getTime() - today.getTime()) / MS_PER_DAY)
          : null;
        const location = locations.find((l) => l._id === p.locationId);
        const phase: "approaching" | "crossed" =
          daysToEligibility !== null && daysToEligibility > 0 ? "approaching" : "crossed";
        return {
          id: p._id,
          name: `${p.lastName}, ${p.firstName}`,
          agency: p.staffingAgency || "—",
          startDate: p.hireDate,
          basis: tempEligibilityLabel(p),
          locationName: location?.name || "—",
          eligibilityDate: formatDateShort(eligDate),
          daysToEligibility,
          phase,
        };
      })
      .filter((r) => r.daysToEligibility !== null && r.daysToEligibility >= -daysAfter && r.daysToEligibility <= daysBefore)
      .sort((a, b) => (a.daysToEligibility ?? 0) - (b.daysToEligibility ?? 0));
  }, [personnel, locations, locationFilter, daysBefore, daysAfter]);

  const approachingCount = rows.filter((r) => r.phase === "approaching").length;
  const crossedCount = rows.filter((r) => r.phase === "crossed").length;

  const handleGeneratePDF = async () => {
    if (rows.length === 0) return;
    setGenerating(true);
    try {
      const { jsPDF } = await import("jspdf");
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = (autoTableModule.default || autoTableModule) as typeof import("jspdf-autotable").default;

      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const now = new Date();
      const ranDate = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${String(now.getFullYear()).slice(2)}`;
      const title = "Temp Conversion Eligibility";
      const subtitle = `${approachingCount} approaching · ${crossedCount} eligible now  ·  Window: ${daysBefore}d before / ${daysAfter}d after  ·  Ran: ${ranDate}`;

      const body = rows.map((r) => [
        r.phase === "approaching" ? "→" : "✓",
        r.name,
        r.agency,
        new Date(r.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
        r.basis,
        r.eligibilityDate,
        r.daysToEligibility !== null && r.daysToEligibility > 0 ? `in ${r.daysToEligibility}d` : `${Math.abs(r.daysToEligibility ?? 0)}d ago`,
      ]);

      autoTable(doc, {
        head: [["", "Name", "Agency", "Start", "Basis", "Eligible Date", "When"]],
        body,
        startY: 76,
        margin: { top: 76, bottom: 50, left: 28, right: 28 },
        styles: { fontSize: 9, cellPadding: 4, overflow: "linebreak" },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "left" },
        didDrawPage: () => {
          doc.setFontSize(13); doc.setFont("helvetica", "bold");
          doc.text(title, pageWidth / 2, 40, { align: "center" });
          doc.setFontSize(9); doc.setFont("helvetica", "normal");
          doc.text(subtitle, pageWidth / 2, 56, { align: "center" });
        },
      });
      doc.save(`temp_conversion_${ranDate.replace(/\//g, "")}.pdf`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center gap-3">
            <Link href="/reports" className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Temp Conversion</h1>
              <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Temps becoming eligible for direct hire</p>
            </div>
          </div>
        </header>

        <div className="p-8 max-w-5xl">
          <div className={`rounded-2xl border p-5 mb-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Location</label>
                <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value as Id<"locations"> | "")}
                  className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}>
                  <option value="">All locations</option>
                  {locations.map((loc) => (<option key={loc._id} value={loc._id}>{loc.name}</option>))}
                </select>
              </div>
              <div>
                <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Days before</label>
                <input type="number" min={0} max={365} value={daysBefore}
                  onChange={(e) => setDaysBefore(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
                  className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`} />
              </div>
              <div>
                <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Days after</label>
                <input type="number" min={0} max={365} value={daysAfter}
                  onChange={(e) => setDaysAfter(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
                  className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`} />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
              <div className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                <span className="font-semibold">{rows.length}</span> in window
                <span className={`ml-3 ${isDark ? "text-slate-500" : "text-gray-500"}`}>· {approachingCount} approaching · {crossedCount} eligible now</span>
              </div>
              <button onClick={handleGeneratePDF} disabled={rows.length === 0 || generating}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "#007AFF" }}>
                {generating ? "Generating…" : "Print PDF"}
              </button>
            </div>
          </div>

          <div className={`rounded-2xl border overflow-hidden ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
            {personnel === undefined ? (
              <div className={`p-8 text-center text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>Loading…</div>
            ) : rows.length === 0 ? (
              <div className={`p-8 text-center text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>No temps in the {daysBefore}-day / +{daysAfter}-day window.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={isDark ? "bg-slate-900/60" : "bg-gray-50"}>
                    <tr className={isDark ? "text-slate-400" : "text-gray-600"}>
                      <th className="text-left px-4 py-2 font-medium w-8"></th>
                      <th className="text-left px-4 py-2 font-medium">Name</th>
                      <th className="text-left px-4 py-2 font-medium">Agency</th>
                      <th className="text-left px-4 py-2 font-medium">Start</th>
                      <th className="text-left px-4 py-2 font-medium">Basis</th>
                      <th className="text-left px-4 py-2 font-medium">Eligible Date</th>
                      <th className="text-center px-4 py-2 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const approaching = r.phase === "approaching";
                      return (
                        <tr key={r.id} className={`border-t ${isDark ? "border-slate-700/40" : "border-gray-100"}`}>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${approaching ? (isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700") : (isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700")}`}>
                              {approaching ? "→" : "✓"}
                            </span>
                          </td>
                          <td className={`px-4 py-2 font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                            <Link href={`/personnel/${r.id}`} className={isDark ? "hover:text-cyan-400" : "hover:text-blue-600"}>{r.name}</Link>
                          </td>
                          <td className={`px-4 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{r.agency}</td>
                          <td className={`px-4 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{new Date(r.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
                          <td className={`px-4 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{r.basis}</td>
                          <td className={`px-4 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{r.eligibilityDate}</td>
                          <td className={`px-4 py-2 text-center font-semibold ${approaching ? (isDark ? "text-amber-400" : "text-amber-700") : (isDark ? "text-green-400" : "text-green-700")}`}>
                            {r.daysToEligibility !== null && r.daysToEligibility > 0 ? `in ${r.daysToEligibility}d` : `${Math.abs(r.daysToEligibility ?? 0)}d ago`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function TempConversionPage() {
  return (
    <Protected minTier={3}>
      <TempConversionContent />
    </Protected>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/reportTypes.ts app/reports/temp-conversion/page.tsx
git commit -m "feat(temp): add Temp Conversion eligibility report

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: End-to-end manual verification

**Files:** none (verification only — run `npm run dev` and exercise the flows)

- [ ] **Step 1: Production build sanity**

Run: `cd /Users/andybarrows/IECentral && npx next build 2>&1 | tail -15`
Expected: build completes, no errors. (Confirms all pages compile.)

- [ ] **Step 2: Add a temp (days basis)**

`npm run dev` → Personnel → Add → choose **Temp**, set start date, Staffing Agency, "Eligible after 90 days". Save.
Confirm: the record shows a **Temp** badge; it is **absent** from the active-headcount stat cards.

- [ ] **Step 3: Add a temp (hours basis)**

Add another temp with "Eligible after 520 hours". On the detail page confirm the eligible date is
≈ start + 91 days (520/40×7 = 91).

- [ ] **Step 4: Hire an applicant as Temp**

Applications → open one → Hire → type **Temp** + temp fields → confirm a temp personnel record is created.

- [ ] **Step 5: Verify exclusions**

Confirm temps do NOT appear in: `/reports/insurance-eligibility`, `/reports/ninety-day-reviews`,
QuickBooks unmapped personnel, and active headcount counts.

- [ ] **Step 6: Verify the report**

`/reports/temp-conversion` → temps appear with agency, basis, eligible date, days-to-eligible; adjust
the before/after window; Print PDF works.

- [ ] **Step 7: Convert a temp**

On a temp's detail page → **Convert to hire** → set hire date + Full Time → confirm: type flips,
hire date set, temp fields cleared, an audit-log entry is written (`/audit-log`), the person now appears
in the 90-day review tracker computed from the new hire date, and is gone from the Temp Conversion report.

- [ ] **Step 8: Override eligible date**

Edit a temp → set an override date → confirm the Temp Conversion report uses the override.

---

## Self-Review Notes

- **Spec coverage:** data model (T1) ✓ helper days/hours math (T1) ✓ mutations accept temp fields (T2) ✓ convertTempToHire (T2/T6) ✓ exclusions: QB/payroll, headcount, insurance, 90-day, tenure check-ins (T3) ✓ Add-form entry (T4) ✓ ATS entry (T5) ✓ detail display/edit/convert (T6) ✓ roster badge/filter (T7) ✓ Temp Conversion report + registry + tier (T8) ✓ manual test plan (T9) ✓. Write-ups/notes need no work (temps are personnel — they get notes for free).
- **Type consistency:** field names `staffingAgency`, `tempEligibilityMode`, `tempEligibilityValue`, `tempEligibleDateOverride` are identical across schema (T1), mutations (T2), forms (T4/T5/T6), helper input (T1), and report (T8). `convertTempToHire` signature matches its call site (T6). `isTemp`/`computeTempEligibleDate`/`tempEligibilityLabel` are used exactly as exported.
- **Scheduling/attendance exclusion** is intentionally light in v1 (spec out-of-scope note) — temps simply aren't actively scheduled; no dedicated guard added beyond the headcount/report ones. If temps later surface in a scheduling picker, add an `isTemp` filter there.
