# Scanner Setup — Update Flow, Retail Locations, DataWedge Tab, Lockdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the scanner setup wizard update an existing numbered scanner (software + condition/status/assignment) without renumbering, set up new scanners, show retail locations greyed out, auto-configure DataWedge to emit Tab, and lock devices down to an allowlist driven by a global, editable policy.

**Architecture:** Extend the existing reducer-based wizard (`useSetupSession`) with a `mode` ("new" | "update") and a matched-scanner branch at Detect. New mode keeps the current flow (Detect→Location→Identity→Generate→Install→Verify→Done). Update mode runs Detect→Manage→Install→Verify→Done, reusing `InstallStep` and saving via a new in-place `updateScannerFromSetup`. Install gains two idempotent, policy-driven steps (DataWedge Tab, allowlist lockdown) reading a new global `scannerLockPolicy`. Retail locations render greyed in `LocationStep`.

**Tech Stack:** Next.js (client components), Convex (schema/queries/mutations), WebUSB/ADB (`WebAdbClient`), TypeScript. **No test framework** — verification = `npm run build` + live TC51 run (serial `20192522528692` = scanner `W08-700`). PROD Convex deploy is gated on the user (per session norm).

**Spec:** `docs/superpowers/specs/2026-06-02-scanner-setup-update-flow-design.md`

---

## File Structure

- **Modify** `convex/schema.ts` — add `scannerLockPolicy` table (single-row global policy).
- **Modify** `convex/scannerMdm.ts` — add `getLockPolicy`, `setLockPolicy`, `updateScannerFromSetup`.
- **Modify** `convex/locations.ts` — add `listByType` query.
- **Modify** `app/equipment/scanners/setup/WebAdbClient.ts` — add `listPackages()`, `configureDataWedgeTab()`.
- **Modify** `app/equipment/scanners/setup/useSetupSession.ts` — add `mode`, `existingScanner`, `manage`, `"manage"` step, actions.
- **Modify** `app/equipment/scanners/setup/steps/DeviceDetectStep.tsx` — serial lookup + branch + confirm card.
- **Create** `app/equipment/scanners/setup/steps/ManageStep.tsx` — condition/status/reassign.
- **Modify** `app/equipment/scanners/setup/SetupWizard.tsx` — route `"manage"`, mode-aware breadcrumb.
- **Modify** `app/equipment/scanners/setup/steps/InstallStep.tsx` — DataWedge + allowlist lockdown steps; mode-aware save; update-mode `locationCode`.
- **Modify** `app/equipment/scanners/setup/steps/LocationStep.tsx` — retail locations greyed + "Coming soon".
- **Modify** `app/equipment/scanners/setup/steps/DoneStep.tsx` — update-mode summary.
- **Find + Modify** the scanner MDM admin page — add a "Lock Policy" editor (locate via grep for `upsertMdmConfig`/`listMdmConfigs` usage in `app/`).

ESSENTIAL_SYSTEM allowlist + the 3 IET package constants are defined once in Task 2 and imported where needed.

---

## Task 1: Backend — lock policy, scanner update, retail locations

**Files:** Modify `convex/schema.ts`, `convex/scannerMdm.ts`, `convex/locations.ts`

- [ ] **Step 1: Add `scannerLockPolicy` table to `convex/schema.ts`** (near the `scanners` table, before its closing of the schema object):

```ts
  // Global scanner lock-down policy (single row). Drives the allowlist lockdown
  // + DataWedge/screen settings applied during scanner setup.
  scannerLockPolicy: defineTable({
    allowedPackages: v.array(v.string()), // extra packages to KEEP enabled (beyond essentials + IET apps)
    lockdownEnabled: v.boolean(),
    dataWedgeTab: v.boolean(),
    screenTimeoutMs: v.optional(v.number()),
    screenRotation: v.optional(v.string()), // "portrait" | "landscape"
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  }),
```

- [ ] **Step 2: Add policy + update functions to `convex/scannerMdm.ts`** (append near the other exports; reuse the existing `mutation`/`query`/`v`/`requireAdmin` imports already in the file — verify `requireAdmin` is imported, it is used elsewhere in the file):

```ts
const LOCK_POLICY_DEFAULTS = {
  allowedPackages: [] as string[],
  lockdownEnabled: true,
  dataWedgeTab: true,
  screenTimeoutMs: 1800000,
  screenRotation: "portrait",
};

export const getLockPolicy = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("scannerLockPolicy").first();
    if (!row) return { ...LOCK_POLICY_DEFAULTS, _id: null as null };
    return row;
  },
});

export const setLockPolicy = mutation({
  args: {
    allowedPackages: v.array(v.string()),
    lockdownEnabled: v.boolean(),
    dataWedgeTab: v.boolean(),
    screenTimeoutMs: v.optional(v.number()),
    screenRotation: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const { requestingUserId, ...fields } = args;
    const existing = await ctx.db.query("scannerLockPolicy").first();
    if (existing) {
      await ctx.db.patch(existing._id, { ...fields, updatedAt: Date.now(), updatedBy: requestingUserId });
      return existing._id;
    }
    return await ctx.db.insert("scannerLockPolicy", { ...fields, updatedAt: Date.now(), updatedBy: requestingUserId });
  },
});

// In-place update for the "update existing scanner" setup flow. Never changes
// number / locationId / IoT identity. No duplicate guard (it's an update).
export const updateScannerFromSetup = mutation({
  args: {
    scannerId: v.id("scanners"),
    installedApps: v.optional(v.object({
      tireTrack: v.optional(v.string()),
      rtLocator: v.optional(v.string()),
      scannerAgent: v.optional(v.string()),
    })),
    agentVersion: v.optional(v.string()),
    androidVersion: v.optional(v.string()),
    conditionNotes: v.optional(v.string()),
    status: v.optional(v.string()),
    assignedTo: v.optional(v.union(v.id("personnel"), v.null())),
  },
  handler: async (ctx, args) => {
    const scanner = await ctx.db.get(args.scannerId);
    if (!scanner) throw new Error("Scanner not found");
    const now = Date.now();
    const patch: Record<string, unknown> = { updatedAt: now };
    if (args.installedApps) { patch.installedApps = args.installedApps; patch.mdmStatus = "provisioned"; patch.provisionedAt = now; }
    if (args.agentVersion !== undefined) patch.agentVersion = args.agentVersion;
    if (args.androidVersion !== undefined) patch.androidVersion = args.androidVersion;
    if (args.conditionNotes !== undefined) patch.conditionNotes = args.conditionNotes;
    if (args.status !== undefined) patch.status = args.status;
    if (args.assignedTo !== undefined) {
      patch.assignedTo = args.assignedTo ?? undefined;
      patch.assignedAt = args.assignedTo ? now : undefined;
    }
    await ctx.db.patch(args.scannerId, patch);
    return { scannerId: args.scannerId, number: scanner.number };
  },
});
```

- [ ] **Step 3: Add `listByType` to `convex/locations.ts`** (follow the file's existing query style; it has a `locations` table with `locationType` and an `isActive`-like field — check the table for the active flag, e.g. `isActive`):

```ts
export const listByType = query({
  args: { type: v.string() },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("locations").collect();
    return all
      .filter((l) => l.locationType === args.type)
      .map((l) => ({ _id: l._id, name: l.name, locationType: l.locationType }));
  },
});
```

- [ ] **Step 4: Typecheck** — `cd ~/IECentral && npx convex codegen` (regenerates `_generated`; no prod push) and `npm run build`. Expected: compiles; `api.scannerMdm.getLockPolicy/setLockPolicy/updateScannerFromSetup` and `api.locations.listByType` resolve.

- [ ] **Step 5: Commit** — `git add convex/ && git commit -m "feat(scanner-setup): lock policy + updateScannerFromSetup + locations.listByType"`

---

## Task 2: WebAdbClient — listPackages + DataWedge Tab + lockdown constants

**Files:** Modify `app/equipment/scanners/setup/WebAdbClient.ts`

- [ ] **Step 1: Export package constants + essential allowlist** (top of file, after imports):

```ts
export const IET_PACKAGES = {
  tireTrack: "com.importexporttire.tiretrack",
  rtLocator: "com.rt_systems.rtlhandsfree",
  scannerAgent: "com.ietires.scanneragent",
};

// System packages that must NEVER be disabled (device stays usable). Prefixes + exact ids.
// Disabling launcher/SystemUI/IME/Settings/DataWedge can brick usability — keep these.
export const ESSENTIAL_SYSTEM_PREFIXES = [
  "com.android.", "android", "com.qualcomm.", "com.zebra.", "com.symbol.",
  "com.google.android.packageinstaller", "com.android.systemui",
  "com.android.settings", "com.android.inputmethod", "com.google.android.inputmethod",
];
export const ESSENTIAL_SYSTEM_EXACT = [
  "com.symbol.datawedge", "com.android.launcher3", "com.android.settings",
  "com.android.systemui", "com.android.shell", "com.android.providers.settings",
];
```

- [ ] **Step 2: Add `listPackages()` method** (inside the `WebAdbClient` class):

```ts
  async listPackages(): Promise<string[]> {
    const out = await this.shell("pm list packages");
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("package:"))
      .map((l) => l.slice("package:".length).trim())
      .filter(Boolean);
  }
```

- [ ] **Step 3: Add `configureDataWedgeTab()` method** (inside the class). This sends the DataWedge intent to enable Keystroke Output with a Tab key-event after each scan on the active/default profile. (Validate exact keys against the TC51 during Task 11; this is the documented DataWedge API shape.)

```ts
  // Enable DataWedge Keystroke Output with a Tab key after each scanned barcode.
  // Uses the DataWedge intent API. The "send_tab_as" / key_event_send approach
  // appends an Android KEYCODE_TAB after the data.
  async configureDataWedgeTab(): Promise<void> {
    // Ensure DataWedge is enabled, then set keystroke output + tab suffix on Profile0 (Default).
    await this.shell(
      `am broadcast -a com.symbol.datawedge.api.ACTION --es com.symbol.datawedge.api.SET_CONFIG ` +
      `'{"PROFILE_NAME":"Profile0 (default)","PROFILE_ENABLED":"true","CONFIG_MODE":"UPDATE",` +
      `"PLUGIN_CONFIG":{"PLUGIN_NAME":"KEYSTROKE","RESET_CONFIG":"true",` +
      `"PARAM_LIST":{"keystroke_output_enabled":"true","keystroke_action_char_set":"1",` +
      `"keystroke_key_event_send_mode":"1","keystroke_send_tab":"true"}}}'`
    );
  }
```
> NOTE for implementer: DataWedge's `SET_CONFIG` JSON via `am broadcast --es` is finicky with quoting over ADB shell. If the single-broadcast form fails on the TC51, fall back to the **auto-import profile** approach: write a DataWedge profile file to `/enterprise/device/settings/datawedge/autoimport/` (see Task 11 validation). Keep the method name `configureDataWedgeTab` either way.

- [ ] **Step 4: Build** — `npm run build`. Expected: compiles.
- [ ] **Step 5: Commit** — `git commit -am "feat(scanner-setup): WebAdbClient listPackages + DataWedge Tab + lockdown constants"`

---

## Task 3: Session state — mode, existingScanner, manage, "manage" step

**Files:** Modify `app/equipment/scanners/setup/useSetupSession.ts`

- [ ] **Step 1: Extend `StepName` and `SetupState`:**

```ts
export type StepName =
  | "detect" | "location" | "identity" | "generate"
  | "manage" | "install" | "verify" | "done" | "error";

export type ExistingScanner = {
  _id: Id<"scanners">;
  number: string;
  locationCode: string | null;   // derived for InstallStep (mdmConfig / apk urls)
  locationName: string | null;
  status: string;
  conditionNotes: string | null;
  assignedTo: Id<"personnel"> | null;
};

export type ManageFields = {
  conditionNotes: string;
  status: string;
  assignedTo: Id<"personnel"> | null;
};
```
Add to `SetupState`: `mode: "new" | "update";  existingScanner: ExistingScanner | null;  manage: ManageFields;`

- [ ] **Step 2: Add actions/reducer cases.** New `Action` variants:

```ts
  | { type: "SET_UPDATE_MODE"; scanner: ExistingScanner }
  | { type: "SET_MANAGE"; fields: Partial<ManageFields> }
```
`initialState` adds: `mode: "new", existingScanner: null, manage: { conditionNotes: "", status: "available", assignedTo: null }`.
Reducer cases:
```ts
    case "SET_UPDATE_MODE":
      return {
        ...state,
        mode: "update",
        existingScanner: action.scanner,
        scannerId: action.scanner._id,
        locationCode: action.scanner.locationCode,
        locationName: action.scanner.locationName,
        scannerNumber: action.scanner.number,
        manage: {
          conditionNotes: action.scanner.conditionNotes ?? "",
          status: action.scanner.status,
          assignedTo: action.scanner.assignedTo,
        },
      };
    case "SET_MANAGE":
      return { ...state, manage: { ...state.manage, ...action.fields } };
```
Add to `actions`: `setUpdateMode: (scanner: ExistingScanner) => dispatch({ type: "SET_UPDATE_MODE", scanner })` and `setManage: (fields: Partial<ManageFields>) => dispatch({ type: "SET_MANAGE", fields })`. `RESET` returns `initialState` (already mode:"new").

- [ ] **Step 3: Build** — `npm run build`. Expected: compiles (consumers unaffected; new optional state).
- [ ] **Step 4: Commit** — `git commit -am "feat(scanner-setup): session state for update mode + manage"`

---

## Task 4: DeviceDetectStep — serial lookup + branch + confirm card

**Files:** Modify `app/equipment/scanners/setup/steps/DeviceDetectStep.tsx`

- [ ] **Step 1: Use an imperative Convex client to look up the serial after connect, then branch.** Replace `handleConnect` and add a confirm UI. Key changes:
  - `import { useConvex } from "convex/react"; import { api } from "@/convex/_generated/api";`
  - After `setConnection(conn)`, call `const existing = await convex.query(api.scannerMdm.getScannerBySerialNumber, { serialNumber: conn.serial });`
  - If `existing`: derive `locationCode` from the number prefix (e.g. `W08-700` → `W08`): `const locationCode = existing.number.split("-")[0] || null;`. Resolve `locationName` via `api.scannerMdm.getMdmConfigByCode({ locationCode })` (or leave null). Store a pending match in local state and render the confirm card (do NOT auto-advance).
  - If no match: `session.actions.goToStep("location")` (unchanged new flow).

Confirm card (rendered when a match is pending): shows `This is {number}`, status, assigned-to, with two buttons:
  - **Update this scanner** → `session.actions.setUpdateMode({ _id, number, locationCode, locationName, status, conditionNotes, assignedTo })` then `session.actions.goToStep("manage")`.
  - **Not this one** → show an inline notice: *"This serial is already registered as {number}. To re-register under a different number, retire {number} first in Scanner Management."* (Per spec Open Q #2 — do NOT route to new-create, which would fail the dup guard.)

- [ ] **Step 2: Build** — `npm run build`.
- [ ] **Step 3: Manual check (after Task 1 deployed):** connect the TC51 → confirm it recognizes `W08-700` and shows the confirm card. (Full flow tested in Task 11.)
- [ ] **Step 4: Commit** — `git commit -am "feat(scanner-setup): detect branches to update mode on known serial"`

---

## Task 5: SetupWizard — route "manage" + mode-aware breadcrumb

**Files:** Modify `app/equipment/scanners/setup/SetupWizard.tsx`

- [ ] **Step 1:** Import `ManageStep` and render it: add `{session.state.step === "manage" && <ManageStep session={session} />}` next to the other steps.
- [ ] **Step 2:** Make the breadcrumb mode-aware. Replace the single `STEP_ORDER` with two and select by `session.state.mode`:

```ts
const NEW_STEPS = [
  { key: "detect", label: "Detect" }, { key: "location", label: "Location" },
  { key: "identity", label: "Identity" }, { key: "generate", label: "Generate" },
  { key: "install", label: "Install" }, { key: "verify", label: "Verify" }, { key: "done", label: "Done" },
];
const UPDATE_STEPS = [
  { key: "detect", label: "Detect" }, { key: "manage", label: "Manage" },
  { key: "install", label: "Install" }, { key: "verify", label: "Verify" }, { key: "done", label: "Done" },
];
```
Pass `mode` into `StepBreadcrumb` and pick the array. Update the header title to reflect mode: `{session.state.mode === "update" ? "Update Scanner" : "New Scanner Setup"}`.

- [ ] **Step 3: Build** — `npm run build`.
- [ ] **Step 4: Commit** — `git commit -am "feat(scanner-setup): wizard routes manage step + mode-aware breadcrumb"`

---

## Task 6: ManageStep — condition / status / reassign

**Files:** Create `app/equipment/scanners/setup/steps/ManageStep.tsx`

- [ ] **Step 1: Create the component.** Reads `api.personnel.list` for the assignment dropdown; edits `session.state.manage` via `setManage`; Continue → `install`; Back → `detect`.

```tsx
"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession } from "../useSetupSession";
import { Id } from "@/convex/_generated/dataModel";

type Session = ReturnType<typeof useSetupSession>;
const STATUSES = ["available", "maintenance", "lost", "retired"];

export function ManageStep({ session }: { session: Session }) {
  const personnel = useQuery(api.personnel.list, {}) ?? [];
  const { existingScanner, manage } = session.state;
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Update {existingScanner?.number}</h3>
      <p className="text-xs opacity-70">Software will be reinstalled/updated. Number, location and identity stay the same.</p>

      <label className="block text-sm">
        <span className="opacity-70">Status</span>
        <select value={manage.status} onChange={(e) => session.actions.setManage({ status: e.target.value })}
          className="mt-1 w-full rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <label className="block text-sm">
        <span className="opacity-70">Assigned to</span>
        <select value={manage.assignedTo ?? ""}
          onChange={(e) => session.actions.setManage({ assignedTo: e.target.value ? (e.target.value as Id<"personnel">) : null })}
          className="mt-1 w-full rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm">
          <option value="">Unassigned</option>
          {personnel.map((p: { _id: string; name: string }) => <option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
      </label>

      <label className="block text-sm">
        <span className="opacity-70">Condition notes</span>
        <textarea value={manage.conditionNotes} onChange={(e) => session.actions.setManage({ conditionNotes: e.target.value })}
          rows={3} className="mt-1 w-full rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm" />
      </label>

      <div className="flex gap-2">
        <button onClick={() => session.actions.goToStep("detect")} className="text-xs opacity-60 hover:opacity-100">← Back</button>
        <button onClick={() => session.actions.goToStep("install")}
          className="ml-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
          Continue to install →
        </button>
      </div>
    </div>
  );
}
```
> Verify `api.personnel.list` arg shape (it may take `{}` or filters) and that items expose `_id`/`name`; adjust the map accordingly.

- [ ] **Step 2: Build** — `npm run build`.
- [ ] **Step 3: Commit** — `git commit -am "feat(scanner-setup): ManageStep (condition/status/reassign)"`

---

## Task 7: InstallStep — DataWedge + allowlist lockdown + mode-aware save

**Files:** Modify `app/equipment/scanners/setup/steps/InstallStep.tsx`

- [ ] **Step 1: Read the global policy + import constants.** Add:
```ts
import { IET_PACKAGES, ESSENTIAL_SYSTEM_PREFIXES, ESSENTIAL_SYSTEM_EXACT } from "../WebAdbClient";
const lockPolicy = useQuery(api.scannerMdm.getLockPolicy, {});
const updateScanner = useMutation(api.scannerMdm.updateScannerFromSetup);
```
Add `lockPolicy` to the effect's gate/deps (don't start until `lockPolicy` is loaded): change the early-return to `if (!mdmConfig || !lockPolicy || started) return;` — BUT in update mode `mdmConfig` may be derivable; if `locationCode` is null in update mode, default `mdmConfig` handling already uses fallbacks. Ensure the effect still runs in update mode: gate on `(mode === "update" || mdmConfig) && lockPolicy`.

- [ ] **Step 2: Replace the `bloatware` step (lines ~234-238) with a DataWedge step + an allowlist lockdown step:**

```ts
        // DataWedge: emit Tab after each scan (policy-gated)
        if (lockPolicy.dataWedgeTab) {
          await runStep("datawedge", "Configuring DataWedge (Tab)", async () => {
            await client.configureDataWedgeTab();
          });
        }

        // Lockdown: disable every non-allowlisted user package (policy-gated)
        if (lockPolicy.lockdownEnabled) {
          await runStep("lockdown", "Locking down to allowlist", async () => {
            const installed = await client.listPackages();
            const keep = new Set<string>([
              ...Object.values(IET_PACKAGES),
              ...ESSENTIAL_SYSTEM_EXACT,
              ...lockPolicy.allowedPackages,
            ]);
            const isEssential = (pkg: string) =>
              keep.has(pkg) || ESSENTIAL_SYSTEM_PREFIXES.some((p) => pkg === p || pkg.startsWith(p));
            const toDisable = installed.filter((pkg) => !isEssential(pkg));
            // Dry-run record: log the list before disabling (recoverable via pm enable).
            log("lockdown", "started", undefined, `disabling ${toDisable.length}: ${toDisable.join(",")}`.slice(0, 4000));
            await client.disablePackages(toDisable);
          });
        }
```
(Remove the old `BLOATWARE`-based `bloatware` step. The `BLOATWARE` const can be deleted.)

- [ ] **Step 3: Make the final save mode-aware.** Replace the `markComplete({...})` call (lines ~246-254) with:

```ts
        const installedApps = {
          tireTrack: state.installedVersions.tireTrack ?? apks!.versions.tireTrack,
          rtLocator: state.installedVersions.rtLocator ?? apks!.versions.rtLocator,
          scannerAgent: state.installedVersions.scannerAgent ?? apks!.versions.scannerAgent,
        };
        if (state.mode === "update") {
          await updateScanner({
            scannerId: state.scannerId!,
            installedApps,
            androidVersion: state.connection?.androidVersion,
            conditionNotes: state.manage.conditionNotes,
            status: state.manage.status,
            assignedTo: state.manage.assignedTo,
          });
        } else {
          await markComplete({ scannerId: state.scannerId!, installedApps, actingUserId: user!._id });
        }
```

- [ ] **Step 4: Handle `getApkUrls` / `mdmConfig` in update mode.** `getApkUrls({ locationCode })` and `getMdmConfigByCode` need `locationCode`. In update mode `state.locationCode` is set from the scanner number prefix (Task 4). If `getApkUrls` requires a valid code and the prefix-derived code has no MDM config, fall back to a default — confirm `getApkDownloadUrls` tolerates a generic code, else pass the matched scanner's actual location code. Keep the existing `if (!state.locationCode) throw` but ensure update mode populates it.

- [ ] **Step 5: Build** — `npm run build`.
- [ ] **Step 6: Commit** — `git commit -am "feat(scanner-setup): InstallStep DataWedge + allowlist lockdown + update save"`

---

## Task 8: LocationStep — retail locations greyed + "Coming soon"

**Files:** Modify `app/equipment/scanners/setup/steps/LocationStep.tsx`

- [ ] **Step 1:** Add `const retail = useQuery(api.locations.listByType, { type: "retail" }) ?? [];` and render retail entries after the warehouse configs, as **disabled** cards with a "Coming soon" badge:

```tsx
        {retail.map((l) => (
          <div key={l._id}
            className="px-4 py-3 rounded-lg border border-current/10 opacity-50 cursor-not-allowed text-left relative">
            <div className="font-semibold">{l.name}</div>
            <div className="text-xs opacity-70 mt-0.5">Retail</div>
            <span className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600">Coming soon</span>
          </div>
        ))}
```
Place inside the same grid, after the `configs.map(...)`.

- [ ] **Step 2: Build** — `npm run build`.
- [ ] **Step 3: Commit** — `git commit -am "feat(scanner-setup): show retail locations greyed (coming soon)"`

---

## Task 9: DoneStep — update-mode summary

**Files:** Modify `app/equipment/scanners/setup/steps/DoneStep.tsx`

- [ ] **Step 1:** Branch on `session.state.mode`. In update mode, show "✓ Software updated" with the existing number, status, and assignment (no PIN, no "record the PIN" warning, and the DataWedge manual step is removed since it's now automated). Keep the new-mode output unchanged.

```tsx
  const isUpdate = session.state.mode === "update";
  // ... header: isUpdate ? "✓ Scanner updated" : "✓ Setup complete"
  // summary: show scannerNumber always; PIN block + manual-steps block only when !isUpdate.
```
Also remove the now-automated DataWedge line from the manual-steps list in new mode (it's configured by Task 7).

- [ ] **Step 2: Build** — `npm run build`.
- [ ] **Step 3: Commit** — `git commit -am "feat(scanner-setup): DoneStep update-mode summary"`

---

## Task 10: MDM Admin — Lock Policy editor

**Files:** Find the scanner MDM admin page (grep `app/` for `listMdmConfigs`, `upsertMdmConfig`, or "MDM" in `app/equipment` / a tiretrack-admin area) and add a "Lock Policy" section.

- [ ] **Step 1: Locate the admin page** — `grep -rl "upsertMdmConfig\|listMdmConfigs" app/ | grep -v setup`. Add a card/section to that page.
- [ ] **Step 2: Add the editor** reading `getLockPolicy` and saving via `setLockPolicy` (pass the current admin `userId` as `requestingUserId`):
  - Toggle: **Lockdown enabled** (`lockdownEnabled`).
  - Toggle: **DataWedge Tab** (`dataWedgeTab`).
  - Number: screen timeout (ms); select: rotation portrait/landscape.
  - Allowlist editor: list of package strings with add/remove (textarea of newline-separated package names is acceptable for v1 → parsed to `allowedPackages`).
  - Save button → `setLockPolicy({...fields, requestingUserId})`.
- [ ] **Step 3: Build** — `npm run build`.
- [ ] **Step 4: Commit** — `git commit -am "feat(scanner-setup): MDM admin lock-policy editor"`

---

## Task 11: Deploy + live verification (gated)

- [ ] **Step 1: Deploy** — merge `feature/scanner-setup-update-flow` to `main` (Vercel deploys frontend + runs `convex deploy`). **Gated on user OK** (per session norm).
- [ ] **Step 2: Seed/confirm lock policy** — open MDM Admin → Lock Policy; confirm defaults (lockdown on, DataWedge tab on); set any extra allowed packages; save.
- [ ] **Step 3: New-scanner flow** — on an UNREGISTERED serial (or a spare device), run Detect→Location (confirm retail greyed/"Coming soon")→Identity→Generate→Install→Verify→Done. Confirm DataWedge Tab + lockdown ran (check the `lockdown` setup log lists disabled packages), device still usable.
- [ ] **Step 4: Update flow on TC51 `W08-700`** — connect, confirm Detect shows the confirm card, choose Update, set condition/status/assignment in Manage, run install. Confirm: no renumber (still `W08-700`), software reinstalled, `updateScannerFromSetup` persisted condition/status/assignment (check the scanner record), DataWedge emits **Tab** (scan into a text field — cursor tabs), non-essential apps disabled, home screen/keyboard/Settings/the 3 apps still work.
- [ ] **Step 5: Recoverability** — confirm a disabled app re-enables via `pm enable <pkg>` (so lockdown isn't destructive).
- [ ] **Step 6: DataWedge validation** — if `configureDataWedgeTab`'s broadcast form didn't take, switch to the auto-import profile approach (Task 2 note) and re-verify Tab.

---

## Self-Review

- **Spec coverage:** update flow → Tasks 3,4,5,6,7,9; new flow preserved → Task 7 (mode branch); retail greyed → Task 8; DataWedge Tab → Tasks 2,7; lockdown allowlist → Tasks 2,7; global configurable policy → Tasks 1,10; condition/status/reassign → Tasks 1(update mutation),6. ✓
- **Type consistency:** `IET_PACKAGES`/`ESSENTIAL_SYSTEM_*` defined in Task 2, imported in Task 7; `ExistingScanner`/`ManageFields`/`setUpdateMode`/`setManage` defined in Task 3, used in Tasks 4,6,7,9; `getLockPolicy`/`setLockPolicy`/`updateScannerFromSetup`/`listByType` defined in Task 1, used in Tasks 7,8,10. ✓
- **Placeholders:** DataWedge exact intent keys flagged with a concrete fallback (auto-import profile) + a validation step (Task 11.6) — a known technical unknown with a resolution path, not a gap. `personnel.list` and `locations` active-flag shapes flagged for the implementer to confirm against the actual files (they exist). ✓
- **Safety:** lockdown uses reversible `pm disable-user`, never `uninstall`; bounded by `ESSENTIAL_SYSTEM_*`; logs the to-disable list before acting; verified recoverable (Task 11.5). ✓
