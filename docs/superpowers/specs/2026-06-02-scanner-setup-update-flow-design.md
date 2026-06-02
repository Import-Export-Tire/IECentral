# Scanner Setup — Update Existing, Retail Locations, DataWedge Tab — Design

**Date:** 2026-06-02
**Status:** Approved (design); pending spec review → implementation plan

## Problem

The scanner setup wizard (`app/equipment/scanners/setup/`) only supports **creating new** scanners. Re-running it on an already-registered device fails: `createScannerFromSetup` throws *"Serial number … already registered as scanner W08-700"* (this is the "Server Error" reported on 2026-06-02). Operators need to:

1. **Update software on an existing numbered scanner** without renumbering it.
2. **Update its condition** (notes), **status**, and **assignment** during that update.
3. Still **set up new** scanners (unchanged).
4. See **retail locations** in the location picker (greyed out, "Coming soon") — a retail scanning program is coming.
5. Have setup configure **DataWedge to send a Tab key after each scan** (keystroke output + Tab suffix), for both new and update flows.

## Current architecture (for context)

- **State machine:** `useSetupSession.ts` — reducer with `step: "detect" | "location" | "identity" | "generate" | "install" | "verify" | "done" | "error"` and fields (`connection`, `locationCode/Name`, `scannerNumber`, `scannerId`, `provisionCode`, `pin`, `installProgress`, `installedVersions`).
- **Wizard:** `SetupWizard.tsx` renders the step for `state.step`; `steps/` has one component per step.
- **ADB:** `WebAdbClient.ts` (WebUSB) — runs shell commands on the device; reads serial/model.
- **Location step:** `LocationStep.tsx` lists `api.scannerMdm.listMdmConfigs` (per-location MDM configs), not the `locations` table.
- **Backend:** `convex/scannerMdm.ts` — `createScannerFromSetup` (new record + dup guards), `markScannerSetupComplete` (updates an existing scanner's `installedApps`/`mdmStatus`), `getScannerBySerialNumber`, `getNextScannerNumber`, `logScannerSetupStep`. `convex/personnel.ts` has `list`. `scanners` table already has `conditionNotes`, `status`, `assignedTo`, `installedApps`, `agentVersion`, `androidVersion`, IoT fields.
- `locations` table has `locationType: "warehouse" | "retail" | "office" | "distribution"`.

## Design

### 1. Detect = branch point (auto-detect, then confirm)

`DeviceDetectStep`, after ADB connect reads the serial, calls `getScannerBySerialNumber(serial)`:
- **Match** → set `mode: "update"`, store the matched scanner in session, and render a **confirm card** in the detect step:
  > **This is W08-700** · <location> · status: <status> · assigned to: <name or "Unassigned">
  > **[Update this scanner]**   **[Not this one — set up new →]**
  - "Update this scanner" → `goToStep("manage")`.
  - "Not this one" → fall through to New mode (continue to `location`). (Edge case: serial physically belongs to a unit registered under a stale number; operator can still proceed as new — but the new-create will still hit the serial dup guard, so "Not this one" instead routes to a **non-fatal notice** explaining the serial is already registered; primary path is Update. See Open Questions.)
- **No match** → `mode: "new"`, continue to `location` (unchanged).

### 2. Two flows

- **New (unchanged):** `detect → location → identity → generate → install → verify → done` → `createScannerFromSetup`.
- **Update:** `detect → manage → install → verify → done` → `updateScannerFromSetup`. Skips location/identity/generate; keeps the scanner's number, location, IoT thing/cert, and provisioning.

`StepBreadcrumb` shows the steps for the active `mode` (New: Detect/Location/Identity/Generate/Install/Verify; Update: Detect/Manage/Install/Verify).

### 3. New "Manage" step (`steps/ManageStep.tsx`, update flow only)

Pre-filled from the matched scanner; lets the operator edit:
- **Condition notes** (free text, `conditionNotes`).
- **Status** — select: available / maintenance / lost / retired (`status`).
- **Assignment** — person dropdown from `api.personnel.list` (+ "Unassigned"); sets `assignedTo`/clears it. Setting an assignment stamps `assignedAt`.

These are held in session (`manage: { conditionNotes, status, assignedTo }`) and written at Done by `updateScannerFromSetup`. Continue → `install`.

### 4. Install step + DataWedge Tab (both flows)

`InstallStep` runs its existing sequence (APKs, RT config push, permissions, device-admin, bloatware, etc.). **Add a DataWedge configuration step** that enables **Keystroke Output with a Tab key after each scan** on the device's active DataWedge profile, logged as setup step `datawedge`.

Mechanism (to finalize in the plan, validated against the connected TC51): configure DataWedge via its intent API over ADB — `adb shell am broadcast -a com.symbol.datawedge.api.ACTION` with `SET_CONFIG` enabling the Keystroke Output plugin and a Tab key-event suffix (or push a DataWedge auto-import profile to `/enterprise/device/settings/datawedge/autoimport/`). Idempotent (re-applying is safe), so it runs in both flows.

### 5. Location step — retail locations greyed out (new flow)

`LocationStep` keeps the selectable warehouse MDM-config entries (`listMdmConfigs`) and additionally renders **retail** locations from a new query `api.locations.listByType({ type: "retail" })` (or a `listForScannerSetup` that returns both groups) as **disabled** cards with a **"Coming soon"** badge — visible but non-clickable. Retail entries are not selectable until the retail scanning program ships.

### 6. Backend changes (`convex/scannerMdm.ts`, `convex/locations.ts`)

- **`updateScannerFromSetup`** (new mutation): args `{ scannerId, installedApps?, agentVersion?, androidVersion?, conditionNotes?, status?, assignedTo? (id | null) }`. Patches the existing record in place: sets `installedApps`/versions, `mdmStatus: "provisioned"`, `provisionedAt`/`updatedAt`, and any provided condition/status/assignment (clearing `assignedTo` when null, stamping `assignedAt` when set). **Never** changes `number`, `locationId`, or IoT identity. No dup guard (it's an update).
- **Retail locations query:** `locations.listByType({ type })` (or extend an existing locations query) returning `{ _id, name, locationCode?, locationType }` for `locationType === type` and active.
- Reuse `getScannerBySerialNumber` (detect branch) and `personnel.list` (Manage assignment).

### 7. Session-state changes (`useSetupSession.ts`)

- Add `mode: "new" | "update"` (default `"new"`).
- Add `existingScanner: { _id, number, locationName?, status, conditionNotes?, assignedTo? } | null`.
- Add `manage: { conditionNotes: string; status: string; assignedTo: Id<"personnel"> | null }`.
- Add `StepName` `"manage"`.
- Add actions/reducer cases: `SET_MODE_UPDATE(scanner)`, `SET_MANAGE(partial)`.

## Out of scope (YAGNI)

- A standalone "pick any scanner from a list" picker (entry is auto-detect-by-serial only, per decision).
- Building the retail scanning program itself (retail locations are display-only "Coming soon").
- Changing a scanner's number or location during update.

## Testing / verification

- No formal test framework in repo → verify via: (a) `npm run build` type-check; (b) live run against the connected TC51 (serial `20192522528692`, registered as W08-700) — confirm Detect recognizes it, Update flow skips numbering, software re-installs, DataWedge emits Tab after a scan (scan into a text field, cursor tabs), and condition/status/assignment persist via `updateScannerFromSetup`; (c) confirm new-scanner flow still works on an unregistered serial; (d) confirm retail locations appear greyed with "Coming soon" and are non-clickable.

## Open questions (resolve during plan)

1. **DataWedge exact mechanism** — intent `SET_CONFIG` vs auto-import profile; confirm against the TC51's DataWedge version. (Both are ADB-feasible; pick the more reliable on-device.)
2. **"Not this one" branch** — simplest is to show a notice that the serial is already registered and steer to Update, rather than allowing a new-create that will fail the dup guard. Confirm acceptable.
