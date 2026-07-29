# Scanner MDM Hardening — Stages B & C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scanner setup wizard produce a provably correct device — one RT config
with a validated per-location `DEVICEID`, a trustworthy installed-version label, and a
post-install audit that blocks handing out a bad scanner — and land the three USB-only
enablers that must exist before the new TC51 batch is programmed.

**Architecture:** Two pure TypeScript modules (`lib/scanners/rtConfig.ts` for config
generation and validation, `lib/scanners/verify.ts` for parsing device readback) hold all
the logic and all the tests. The wizard's `InstallStep` and the agent's claim path both
consume `buildRtConfig` so they write byte-identical XML. A new `scannerVerifications`
Convex table records what the device actually reported, and the wizard refuses to reach
Done on a hard-check failure.

**Tech Stack:** Next.js 15 App Router, React 19, Convex, vitest, `@yume-chan/adb`
(WebUSB ADB), Python 3 AWS Lambdas (boto3 + stdlib only), Zebra TC51 / Android 8.1 (API 27).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-29-scanner-mdm-hardening-design.md`. Stage A
  (cert retirement) is **already shipped in `63f6512`** — do not reimplement it.
- **RT `DEVICEID` is constant per location, never per scanner.** Confirmed with the user.
- **`tsc` is the gate, not eslint.** Verify with `npx tsc --noEmit` before every commit.
- **Tests are vitest** (`npm test` → `vitest run`), written `describe`/`it`/`expect` in the
  style of `app/jobs/jobListingFormat.test.ts`. Do **not** copy the `node:assert` +
  `npx tsx` style of `lib/dealerRebates/*.test.ts`.
- **Convex auth is `requestingUserId`-arg based.** Use the existing helpers in
  `convex/authGuards.ts` (`requireAdmin`, `requireRole`). There is no `ctx.auth`.
- **Lambdas are single-file, boto3 + stdlib only.** Deploy code-only changes with
  `aws lambda update-function-code`; no SAM build needed.
- **Do not override git `user.email`.** This repo commits as
  `Andy Barrows <andy.barrows@gmail.com>`; just `git commit`.
- **Android agent is debug-signed** (`CN=Android Debug`, `~/.android/debug.keystore`).
  Build: `JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=~/Library/Android/sdk ./gradlew :app:assembleDebug`
- **Device under test:** W08-001 (serial `19058522500842`) is Device Owner and account-free.
- **Chrome WebUSB requires no running ADB server** — `adb kill-server` first.

## File Structure

| File | Responsibility |
|---|---|
| `lib/scanners/rtConfig.ts` | **Create.** Pure RT config builder + validator. Single source of truth. |
| `lib/scanners/rtConfig.test.ts` | **Create.** Unit tests for the above. |
| `lib/scanners/verify.ts` | **Create.** Pure parsers for `dumpsys`/`settings`/`pm` output + check-list definition. |
| `lib/scanners/verify.test.ts` | **Create.** Unit tests with captured device output. |
| `convex/schema.ts` | **Modify.** Add `scannerMdmConfigs.rtDeviceId`; add `scannerVerifications` table. |
| `convex/scannerMdm.ts` | **Modify.** Delete the bad RT fallback at ~763; use `buildRtConfig`; add verification queries/mutations. |
| `app/equipment/scanners/setup/WebAdbClient.ts` | **Modify.** Add readback + enabler shell helpers. |
| `app/equipment/scanners/setup/steps/InstallStep.tsx` | **Modify.** Use `buildRtConfig`; add enabler steps; run the audit. |
| `app/equipment/scanners/setup/steps/IdentityStep.tsx` | **Modify.** Remove the RT Device ID input. |
| `app/equipment/scanners/setup/useSetupSession.ts` | **Modify.** Drop `rtDeviceId`; add `verification`. |
| `app/equipment/scanners/setup/steps/VerifyStep.tsx` | **Modify.** Render the audit result; gate Done. |
| `app/equipment/scanners/settings/page.tsx` | **Modify.** Add the `rtDeviceId` field + live config preview. |
| `app/equipment/scanners/[id]/page.tsx` | **Modify.** Show last audit + failure banner. |
| `aws/scanner-mdm/lambdas/fetch_apk.py` | **Modify.** Derive version from the artifact. |
| `aws/scanner-mdm/lambdas/provision.py` | **Modify.** Per-location thing group. |
| `tools/scanner-setup/src/index.ts` | **Modify.** Consume `buildRtConfig`; delete its hardcoded XML. |

---

## Task 1: RT config builder (pure module + tests)

**Files:**
- Create: `lib/scanners/rtConfig.ts`
- Test: `lib/scanners/rtConfig.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module, no imports outside stdlib).
- Produces: `buildRtConfig(input: RtConfigInput): RtConfigResult`,
  `type RtConfigInput = { locationCode: string; rtLocatorUrl: string; rtDeviceId: string; template?: string }`,
  `type RtConfigValues = { orientation: string; deviceId: string; scaleFactor: string; rtLocatorUrl: string }`,
  `type RtConfigResult = { xml: string; values: RtConfigValues; problems: string[] }`.
  Tasks 3, 4, 6, 9 and 12 all import `buildRtConfig` from `@/lib/scanners/rtConfig`.

- [ ] **Step 1: Write the failing test**

Create `lib/scanners/rtConfig.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRtConfig } from "./rtConfig";

const OK = {
  locationCode: "W08",
  rtLocatorUrl: "https://rtl.example.com/mobile",
  rtDeviceId: "0001",
};

describe("buildRtConfig", () => {
  it("builds a valid config from the default template", () => {
    const r = buildRtConfig(OK);
    expect(r.problems).toEqual([]);
    expect(r.values.deviceId).toBe("0001");
    expect(r.values.rtLocatorUrl).toBe("https://rtl.example.com/mobile");
    expect(r.xml).toContain("<DEVICEID>0001</DEVICEID>");
    expect(r.xml).toContain("<RTLMOBILEURL>https://rtl.example.com/mobile</RTLMOBILEURL>");
  });

  it("substitutes into a supplied template instead of trusting its values", () => {
    const template = `<RT>
    <ORIENTATION>LANDSCAPE</ORIENTATION>
    <DEVICEID>W08-004</DEVICEID>
    <SCALEFACTOR>2.0</SCALEFACTOR>
    <RTLMOBILEURL>https://stale.example.com/old</RTLMOBILEURL>
</RT>`;
    const r = buildRtConfig({ ...OK, template });
    expect(r.problems).toEqual([]);
    // The template's DEVICEID and URL must be overwritten, not passed through.
    expect(r.values.deviceId).toBe("0001");
    expect(r.values.rtLocatorUrl).toBe("https://rtl.example.com/mobile");
    expect(r.xml).not.toContain("W08-004");
    expect(r.xml).not.toContain("stale.example.com");
    // Template-owned fields survive.
    expect(r.values.orientation).toBe("LANDSCAPE");
    expect(r.values.scaleFactor).toBe("2.0");
  });

  it("is deterministic — same input produces identical bytes", () => {
    expect(buildRtConfig(OK).xml).toBe(buildRtConfig(OK).xml);
  });

  it("reports a problem for an empty RT Locator URL", () => {
    const r = buildRtConfig({ ...OK, rtLocatorUrl: "" });
    expect(r.problems).toContain("rtLocatorUrl is empty — set it in Scanner Settings for W08");
  });

  it("reports a problem for a non-http URL", () => {
    const r = buildRtConfig({ ...OK, rtLocatorUrl: "not a url" });
    expect(r.problems.some((p) => p.includes("not a valid http(s) URL"))).toBe(true);
  });

  it("reports a problem for an empty device id", () => {
    const r = buildRtConfig({ ...OK, rtDeviceId: "" });
    expect(r.problems).toContain("rtDeviceId is empty — set it in Scanner Settings for W08");
  });

  it("rejects a per-scanner style device id, which is always a misconfiguration", () => {
    const r = buildRtConfig({ ...OK, rtDeviceId: "W08-004" });
    expect(r.problems.some((p) => p.includes("looks like a scanner number"))).toBe(true);
  });

  it("reports a problem for a malformed template", () => {
    const r = buildRtConfig({ ...OK, template: "<RT><DEVICEID>1</DEVICEID>" });
    expect(r.problems.some((p) => p.includes("not well-formed"))).toBe(true);
  });

  it("reports a problem when the template lacks required tags", () => {
    const r = buildRtConfig({ ...OK, template: "<RT><FOO>bar</FOO></RT>" });
    expect(r.problems.some((p) => p.includes("missing required tag"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/scanners/rtConfig.test.ts`
Expected: FAIL — `Failed to resolve import "./rtConfig"`.

- [ ] **Step 3: Write the implementation**

Create `lib/scanners/rtConfig.ts`:

```ts
// lib/scanners/rtConfig.ts
// Single source of truth for RT Locator config (rtlconfig.xml).
//
// Why this module exists: rtlconfig.xml used to be generated in four places with three
// different DEVICEID semantics, and it is written twice per setup run — once by the wizard
// over ADB, once by the agent at claim time. Whichever wrote last won, so the DEVICEID that
// landed on a device depended on whether a location template happened to exist.
//
// DEVICEID is CONSTANT PER LOCATION, never per scanner. Every scanner at a store must carry
// the same value. Templates are never trusted for DEVICEID or RTLMOBILEURL — those are always
// substituted from the location config — so all writers produce identical bytes.
//
// Pure: no React, no Convex, no I/O. Safe to import from the browser, Convex, and Node.

export type RtConfigInput = {
  locationCode: string;
  rtLocatorUrl: string;
  rtDeviceId: string;
  /** Optional per-location template from scannerMdmConfigs.rtConfigXml. */
  template?: string;
};

export type RtConfigValues = {
  orientation: string;
  deviceId: string;
  scaleFactor: string;
  rtLocatorUrl: string;
};

export type RtConfigResult = {
  xml: string;
  values: RtConfigValues;
  /** Non-empty means DO NOT WRITE THIS CONFIG. Callers must treat it as a hard failure. */
  problems: string[];
};

const REQUIRED_TAGS = ["ORIENTATION", "DEVICEID", "SCALEFACTOR", "RTLMOBILEURL"] as const;

const DEFAULT_ORIENTATION = "PORTRAIT";
const DEFAULT_SCALE_FACTOR = "3.5";

/** Read a single tag's text. Returns null when the tag is absent. */
function readTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : null;
}

/** Replace a tag's text, or append the tag before </RT> when it is missing. */
function writeTag(xml: string, tag: string, value: string): string {
  const re = new RegExp(`<${tag}>[^<]*</${tag}>`);
  if (re.test(xml)) return xml.replace(re, `<${tag}>${value}</${tag}>`);
  return xml.replace("</RT>", `    <${tag}>${value}</${tag}>\n</RT>`);
}

/**
 * A deliberately narrow well-formedness check: every <TAG> has a matching </TAG> and the
 * document is wrapped in <RT>…</RT>. A real XML parser is unavailable in every runtime this
 * module targets, and RT configs are a fixed flat shape, so this is sufficient and honest
 * about what it checks.
 */
function isWellFormed(xml: string): boolean {
  if (!/^\s*<RT>[\s\S]*<\/RT>\s*$/.test(xml)) return false;
  const opens = [...xml.matchAll(/<([A-Z]+)>/g)].map((m) => m[1]);
  const closes = [...xml.matchAll(/<\/([A-Z]+)>/g)].map((m) => m[1]);
  if (opens.length !== closes.length) return false;
  return opens.every((t, i) => t === closes[i]);
}

export function buildRtConfig(input: RtConfigInput): RtConfigResult {
  const problems: string[] = [];
  const { locationCode, rtLocatorUrl, rtDeviceId, template } = input;

  // --- validate the inputs the location config owns ---
  if (!rtLocatorUrl.trim()) {
    problems.push(`rtLocatorUrl is empty — set it in Scanner Settings for ${locationCode}`);
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(rtLocatorUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
      problems.push(`rtLocatorUrl "${rtLocatorUrl}" is not a valid http(s) URL`);
    }
  }

  if (!rtDeviceId.trim()) {
    problems.push(`rtDeviceId is empty — set it in Scanner Settings for ${locationCode}`);
  } else if (/^[A-Z]\d{2}-\d+$/.test(rtDeviceId.trim())) {
    // Guards the historical bug: convex/scannerMdm.ts used to write scanner.number here.
    problems.push(
      `rtDeviceId "${rtDeviceId}" looks like a scanner number — DEVICEID is constant per location, not per scanner`,
    );
  }

  // --- start from the template when present, else the canonical default ---
  let xml =
    template && template.trim()
      ? template.trim()
      : `<RT>
    <ORIENTATION>${DEFAULT_ORIENTATION}</ORIENTATION>
    <DEVICEID>${rtDeviceId}</DEVICEID>
    <SCALEFACTOR>${DEFAULT_SCALE_FACTOR}</SCALEFACTOR>
    <RTLMOBILEURL>${rtLocatorUrl}</RTLMOBILEURL>
</RT>`;

  if (!isWellFormed(xml)) {
    problems.push(`rtConfigXml for ${locationCode} is not well-formed XML`);
    // Fall back to the default shape so callers always get a usable `values` object.
    xml = `<RT>
    <ORIENTATION>${DEFAULT_ORIENTATION}</ORIENTATION>
    <DEVICEID>${rtDeviceId}</DEVICEID>
    <SCALEFACTOR>${DEFAULT_SCALE_FACTOR}</SCALEFACTOR>
    <RTLMOBILEURL>${rtLocatorUrl}</RTLMOBILEURL>
</RT>`;
  } else if (template && template.trim()) {
    for (const tag of REQUIRED_TAGS) {
      if (readTag(xml, tag) === null) {
        problems.push(`rtConfigXml for ${locationCode} is missing required tag <${tag}>`);
      }
    }
  }

  // --- always substitute the location-owned fields; never trust the template's copies ---
  xml = writeTag(xml, "DEVICEID", rtDeviceId);
  xml = writeTag(xml, "RTLMOBILEURL", rtLocatorUrl);
  if (readTag(xml, "ORIENTATION") === null) xml = writeTag(xml, "ORIENTATION", DEFAULT_ORIENTATION);
  if (readTag(xml, "SCALEFACTOR") === null) xml = writeTag(xml, "SCALEFACTOR", DEFAULT_SCALE_FACTOR);

  return {
    xml,
    values: {
      orientation: readTag(xml, "ORIENTATION") ?? DEFAULT_ORIENTATION,
      deviceId: readTag(xml, "DEVICEID") ?? rtDeviceId,
      scaleFactor: readTag(xml, "SCALEFACTOR") ?? DEFAULT_SCALE_FACTOR,
      rtLocatorUrl: readTag(xml, "RTLMOBILEURL") ?? rtLocatorUrl,
    },
    problems,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/scanners/rtConfig.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors introduced by `lib/scanners/rtConfig.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/scanners/rtConfig.ts lib/scanners/rtConfig.test.ts
git commit -m "feat(scanner-mdm): single RT config builder with validation

DEVICEID is constant per location, never per scanner. Templates no longer
pass through verbatim — DEVICEID and RTLMOBILEURL are always substituted
from the location config, so the wizard and the agent write identical bytes."
```

---

## Task 2: Add `rtDeviceId` to the location config

**Files:**
- Modify: `convex/schema.ts` (the `scannerMdmConfigs` table, around line 1080)
- Modify: `convex/scannerMdm.ts` (the `upsertMdmConfig` mutation args)
- Modify: `app/equipment/scanners/settings/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `scannerMdmConfigs.rtDeviceId?: string`, readable from `getMdmConfig`,
  `getMdmConfigByCode`, and `listMdmConfigs` (all spread the document, so no query change
  is needed). Tasks 3, 4 and 9 read it.

- [ ] **Step 1: Add the schema field**

In `convex/schema.ts`, inside `scannerMdmConfigs`, immediately after the `rtLocatorUrl`
line, add:

```ts
    // RT DEVICEID for this location. CONSTANT per location — every scanner at the store
    // reports the same value. Never a scanner number; see lib/scanners/rtConfig.ts.
    rtDeviceId: v.optional(v.string()),
```

- [ ] **Step 2: Accept it in the config mutation**

In `convex/scannerMdm.ts`, in `upsertMdmConfig` (line 516), add to `args` directly beneath
`rtConfigXml`:

```ts
    rtDeviceId: v.optional(v.string()),
```

No handler change is needed: the handler destructures `const { userId, ...data } = args` and
spreads `...data` into both the patch and the insert (lines 543-561), so the new field flows
through automatically.

- [ ] **Step 3: Add the settings form field**

In `app/equipment/scanners/settings/page.tsx`:

1. Add `rtDeviceId: string;` to the form type (beside `rtLocatorUrl: string;`, line ~45).
2. Add `rtDeviceId: "",` to both blank-form initializers (lines ~78 and ~145).
3. Add `rtDeviceId: config.rtDeviceId ?? "",` to the load-from-config block (line ~125).
4. Add `rtDeviceId: form.rtDeviceId || undefined,` to the save payload (line ~213).
5. Render the input directly beneath the RT Locator URL field:

```tsx
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wider theme-text-tertiary mb-1">
                    RT Device ID
                  </label>
                  <input
                    value={form.rtDeviceId}
                    onChange={(e) => setForm({ ...form, rtDeviceId: e.target.value })}
                    className="theme-input w-full px-3 py-2 text-sm font-mono"
                    placeholder="0001"
                  />
                  <p className="text-xs theme-text-tertiary mt-1">
                    Same for every scanner at this location. Not a scanner number.
                  </p>
                </div>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/scannerMdm.ts app/equipment/scanners/settings/page.tsx
git commit -m "feat(scanner-mdm): per-location RT Device ID setting"
```

---

## Task 3: Delete the wrong RT fallback in the claim path

**Files:**
- Modify: `convex/scannerMdm.ts:752-768` (the `rtConfigXml` block inside `claimProvision`)

**Interfaces:**
- Consumes: `buildRtConfig` from Task 1; `rtDeviceId` from Task 2.
- Produces: `claimProvision` returns `rtConfigXml: string | undefined` — unchanged shape, but
  now either a validated config or `undefined`. Never an invalid one.

This is the actively-wrong code path: it writes `DEVICEID = scanner.number`, and because the
agent writes the file *after* the wizard, that value wins for any location without a template.

- [ ] **Step 1: Replace the fallback with the builder**

In `convex/scannerMdm.ts`, add to the imports at the top:

```ts
import { buildRtConfig } from "../lib/scanners/rtConfig";
```

Then replace the whole `// Fetch RT config for the scanner's location` block with:

```ts
    // Fetch RT config for the scanner's location. Built by the shared builder so the bytes
    // are identical to what the wizard pushed over ADB (both writers hit the same file).
    // A config with problems is NOT returned — writing a knowingly-broken rtlconfig.xml is
    // worse than writing none, because RT then fails in a way nobody attributes to setup.
    let rtConfigXml: string | undefined;
    if (scanner) {
      const mdmConfig = await ctx.db
        .query("scannerMdmConfigs")
        .withIndex("by_location", (q) => q.eq("locationId", scanner.locationId))
        .first();
      if (mdmConfig) {
        const built = buildRtConfig({
          locationCode: mdmConfig.locationCode,
          rtLocatorUrl: mdmConfig.rtLocatorUrl,
          rtDeviceId: mdmConfig.rtDeviceId ?? "",
          template: mdmConfig.rtConfigXml,
        });
        if (built.problems.length > 0) {
          console.error(
            `claimProvision: refusing to send RT config for ${mdmConfig.locationCode}: ${built.problems.join("; ")}`,
          );
        } else {
          rtConfigXml = built.xml;
        }
      }
    }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If Convex complains about importing from outside `convex/`, confirm
`tsconfig.json` path aliases cover `lib/` — the relative `../lib/...` import is used because
Convex modules cannot rely on the `@/` alias.

- [ ] **Step 3: Verify the builder is reachable from Convex**

Run: `npx convex dev --once 2>&1 | tail -20`
Expected: pushes without a bundling error. If `CONVEX_DEPLOYMENT` is unset in this
environment, skip this step and rely on Task 13's deploy check.

- [ ] **Step 4: Commit**

```bash
git add convex/scannerMdm.ts
git commit -m "fix(scanner-mdm): stop writing scanner.number as RT DEVICEID

The claim path's fallback wrote DEVICEID=scanner.number, and the agent
writes rtlconfig.xml after the wizard, so that value won for any location
without a template — giving every scanner a unique DEVICEID when it must
be constant per location. Now built and validated by buildRtConfig, and
never sent at all when validation fails."
```

---

## Task 4: Wizard writes the validated config; RT Device ID input removed

**Files:**
- Modify: `app/equipment/scanners/setup/useSetupSession.ts`
- Modify: `app/equipment/scanners/setup/steps/IdentityStep.tsx`
- Modify: `app/equipment/scanners/setup/steps/InstallStep.tsx:209-225`

**Interfaces:**
- Consumes: `buildRtConfig` (Task 1), `rtDeviceId` on the location config (Task 2).
- Produces: `SetupState` no longer has `rtDeviceId`; `actions.setIdentity(scannerNumber: string)`
  takes one argument. Task 6 and Task 8 use the new signature.

- [ ] **Step 1: Drop `rtDeviceId` from the session**

In `useSetupSession.ts` make exactly these four edits:

1. Remove `rtDeviceId: string;` from `SetupState`.
2. Change the action type to `| { type: "SET_IDENTITY"; scannerNumber: string }`.
3. Remove `rtDeviceId: "0001",` from `initialState`.
4. Replace the reducer case and the action creator:

```ts
    case "SET_IDENTITY":
      return { ...state, scannerNumber: action.scannerNumber };
```

```ts
      setIdentity: (scannerNumber: string) =>
        dispatch({ type: "SET_IDENTITY", scannerNumber }),
```

- [ ] **Step 2: Remove the input from IdentityStep**

In `IdentityStep.tsx`: delete the `rtDeviceId` `useState`, delete the entire RT Device ID
`<div>` block (lines ~49-61), change `ready` to `const ready = scannerNumber.length > 0;`,
and change the handler to:

```tsx
  const handleContinue = () => {
    session.actions.setIdentity(scannerNumber);
    session.actions.goToStep("generate");
  };
```

- [ ] **Step 3: Build the config in InstallStep**

In `InstallStep.tsx`, add the import:

```ts
import { buildRtConfig } from "@/lib/scanners/rtConfig";
```

Replace the whole `// 6. Push RT config` step with:

```tsx
        // 6. Push RT config. Built by the shared builder and hard-failed on any problem:
        // a silently-broken rtlconfig.xml is the failure mode this whole change exists to
        // stop. The agent writes the same bytes at claim time, so the double write is a
        // harmless no-op instead of last-write-wins.
        let builtRtXml: string | undefined;
        await runStep("pushRtConfig", "Pushing RT config", async () => {
          const built = buildRtConfig({
            locationCode: state.locationCode!,
            rtLocatorUrl: mdmConfig?.rtLocatorUrl ?? "",
            rtDeviceId: mdmConfig?.rtDeviceId ?? "",
            template: mdmConfig?.rtConfigXml,
          });
          if (built.problems.length > 0) {
            throw new Error(`RT config invalid: ${built.problems.join("; ")}`);
          }
          builtRtXml = built.xml;
          await client.shell(`mkdir -p '/sdcard/My Documents'`);
          await client.pushTextFile(built.xml, "/sdcard/My Documents/rtlconfig.xml");
        });
```

Note: `builtRtXml` is declared here so the audit in Task 8 can compare the file on the device
against the exact bytes that were written. Declare it in the same scope as the other install
locals (`urls`, `apks`), not inside the step callback.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Any remaining `rtDeviceId` reference is a compile error — that is the
point; fix each call site.

- [ ] **Step 5: Commit**

```bash
git add app/equipment/scanners/setup/useSetupSession.ts app/equipment/scanners/setup/steps/IdentityStep.tsx app/equipment/scanners/setup/steps/InstallStep.tsx
git commit -m "feat(scanner-mdm): wizard writes validated RT config, drops per-scanner ID input

The RT Device ID free-text field defaulted to 0001 and was the only place
a constant-per-location value could be typo'd per device. It now comes
from the location config, and an invalid config fails the install instead
of being written silently."
```

---

## Task 5: Device readback helpers on the ADB client

**Files:**
- Modify: `app/equipment/scanners/setup/WebAdbClient.ts`

**Interfaces:**
- Consumes: the existing private `shell()`.
- Produces, all on `WebAdbClient`:
  `getPackageVersion(pkg: string): Promise<string | null>`,
  `getPackageSignerDigest(pkg: string): Promise<string | null>`,
  `readTextFile(devicePath: string): Promise<string | null>`,
  `getSystemSetting(key: string): Promise<string | null>`,
  `getSecureSetting(key: string): Promise<string | null>`,
  `dumpDevicePolicy(): Promise<string>`,
  `isUninstallBlocked(pkg: string): Promise<boolean>`.
  Task 7 parses their output; Task 8 calls them.

- [ ] **Step 1: Add the helpers**

Append these methods to the `WebAdbClient` class, before `getConnection()`:

```ts
  /** Installed versionName, or null when the package is absent. */
  async getPackageVersion(pkg: string): Promise<string | null> {
    const out = await this.shell(`dumpsys package ${pkg} | grep versionName`);
    const m = out.match(/versionName=(\S+)/);
    return m ? m[1].trim() : null;
  }

  /**
   * The signing certificate digest, used to catch a vendor-signed or otherwise foreign
   * pre-existing copy of an app — the failure that silently broke RT Locator on W08-004.
   * Android 8.1's dumpsys exposes this as `signatures=[...]` / a `cert` digest depending on
   * build, so both shapes are matched.
   */
  async getPackageSignerDigest(pkg: string): Promise<string | null> {
    const out = await this.shell(`dumpsys package ${pkg}`);
    const m =
      out.match(/signatures=\[([0-9a-fA-F]+)/) ??
      out.match(/cert\s+\d+:\s*([0-9a-fA-F]{8,})/);
    return m ? m[1].toLowerCase() : null;
  }

  /** File contents, or null when the file is missing/unreadable. */
  async readTextFile(devicePath: string): Promise<string | null> {
    const out = await this.shell(`cat '${devicePath}' 2>/dev/null`);
    return out.trim().length > 0 ? out : null;
  }

  async getSystemSetting(key: string): Promise<string | null> {
    const out = (await this.shell(`settings get system ${key}`)).trim();
    return out === "null" || out === "" ? null : out;
  }

  async getSecureSetting(key: string): Promise<string | null> {
    const out = (await this.shell(`settings get secure ${key}`)).trim();
    return out === "null" || out === "" ? null : out;
  }

  async dumpDevicePolicy(): Promise<string> {
    return this.shell("dumpsys device_policy");
  }

  async isUninstallBlocked(pkg: string): Promise<boolean> {
    const out = await this.shell(`pm get-uninstall-blocked ${pkg} 2>&1`);
    return /true/i.test(out);
  }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/equipment/scanners/setup/WebAdbClient.ts
git commit -m "feat(scanner-mdm): device readback helpers for the verification pass"
```

---

## Task 6: USB-only enablers in the wizard (Stage C)

**Files:**
- Modify: `app/equipment/scanners/setup/WebAdbClient.ts`
- Modify: `app/equipment/scanners/setup/steps/InstallStep.tsx`
- Modify: `aws/scanner-mdm/lambdas/provision.py:126-133`

**Interfaces:**
- Consumes: `WebAdbClient.shell()`.
- Produces: `WebAdbClient.grantWriteSettings(pkg: string): Promise<void>`,
  `WebAdbClient.enableAccessibilityService(component: string): Promise<void>`;
  `provision.py` adds each thing to `scanners-{locationCode}`.

These are the **only** items that cannot be delivered remotely later. Everything else in the
spec can reach an already-programmed scanner over the air, so these must land before the
batch or every scanner needs a second USB visit.

- [ ] **Step 1: Add the enabler helpers**

Append to `WebAdbClient`:

```ts
  /**
   * Grant the WRITE_SETTINGS appop so the agent can change SYSTEM settings (screen timeout,
   * rotation) on its own from now on. This is an appop, not a runtime permission, so
   * dpm.setPermissionGrantState cannot do it and `pm grant` does not apply — it must be set
   * over ADB, once, here. Without it every future settings change needs USB again.
   */
  async grantWriteSettings(pkg = "com.ietires.scanneragent"): Promise<void> {
    const out = await this.shell(`appops set ${pkg} WRITE_SETTINGS allow 2>&1`);
    if (out.trim() && !/^\s*$/.test(out) && /Error|Exception|Unknown/i.test(out)) {
      throw new Error(`appops WRITE_SETTINGS failed: ${out.trim()}`);
    }
  }

  /**
   * Enable an accessibility service. `enabled_accessibility_services` is a SECURE setting
   * outside dpm.setSecureSetting's allowlist on API 27, so shell is the only way in — which
   * is why re-enabling a disabled service later needs USB. Appends to any existing value
   * rather than clobbering it, and is idempotent.
   */
  async enableAccessibilityService(component: string): Promise<void> {
    const current = (await this.shell("settings get secure enabled_accessibility_services")).trim();
    const existing = current === "null" || current === "" ? "" : current;
    if (existing.split(":").includes(component)) {
      await this.shell("settings put secure accessibility_enabled 1");
      return;
    }
    const next = existing ? `${existing}:${component}` : component;
    await this.shell(`settings put secure enabled_accessibility_services ${next}`);
    await this.shell("settings put secure accessibility_enabled 1");
  }
```

- [ ] **Step 2: Call the appop grant in InstallStep**

In `InstallStep.tsx`, immediately after the existing `deviceOwner` step (the "Promoting to
Device Owner" `runStep`), insert:

```tsx
        // Grant the WRITE_SETTINGS appop while we still have USB. This is what makes future
        // device-settings changes deliverable remotely instead of needing another USB visit.
        await runStep("grantWriteSettings", "Granting settings-write permission", async () => {
          await client.grantWriteSettings(AGENT_PKG);
        });
```

Do **not** add the `enableAccessibilityService` call yet — the agent APK has no
accessibility service to enable. That call belongs with the agent build that introduces
`ScreenReaderService` (spec Unit 7). Enabling a non-existent component would write a dead
value into a secure setting.

- [ ] **Step 3: Add per-location thing groups to the provision Lambda**

In `aws/scanner-mdm/lambdas/provision.py`, replace the existing "Add to thing group" block
with:

```python
        # Add to the global group and to a per-location group. The per-location group is what
        # lets a CONTINUOUS IoT job target one store and automatically include scanners added
        # later — so a newly provisioned scanner picks up current desired state with no USB.
        for group in (THING_GROUP, f"scanners-{location_code}"):
            try:
                iot.add_thing_to_thing_group(
                    thingGroupName=group,
                    thingName=thing_name,
                )
            except iot.exceptions.ResourceNotFoundException:
                # Create the per-location group on first use, then retry once.
                try:
                    iot.create_thing_group(thingGroupName=group)
                    iot.add_thing_to_thing_group(thingGroupName=group, thingName=thing_name)
                except Exception as e:
                    print(f"thing group {group}: {e}")
            except Exception as e:
                print(f"thing group {group}: {e}")
```

- [ ] **Step 4: Confirm the Lambda role can create thing groups**

Run:

```bash
aws iam get-role-policy --role-name scanner-mdm-lambda-role --policy-name ScannerMDMPolicy \
  --query 'PolicyDocument.Statement[].Action' --output json
```

Expected: the action list includes `iot:CreateThingGroup` and `iot:AddThingToThingGroup`.
If `iot:CreateThingGroup` is missing, either add it to the inline policy or pre-create the
three groups by hand and skip the create branch:

```bash
for L in W08 R10 W09; do aws iot create-thing-group --thing-group-name "scanners-$L"; done
```

Prefer pre-creating the groups — it needs no IAM change, and there are only three stores.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/equipment/scanners/setup/WebAdbClient.ts app/equipment/scanners/setup/steps/InstallStep.tsx aws/scanner-mdm/lambdas/provision.py
git commit -m "feat(scanner-mdm): USB-only enablers — WRITE_SETTINGS appop, per-location thing groups

These are the only things that cannot be pushed to a scanner later, so
they have to be in the wizard before the batch is programmed. The
accessibility-service enable is deliberately NOT here — it needs the
agent build that actually contains the service."
```

---

## Task 7: Verification check-list module (pure + tests)

**Files:**
- Create: `lib/scanners/verify.ts`
- Test: `lib/scanners/verify.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `type CheckStatus = "pass" | "fail" | "warn" | "unverified"`,
  `type Check = { key: string; label: string; expected?: string; observed?: string; status: CheckStatus; hard: boolean }`,
  `parseDeviceOwner(dump: string, pkg: string): boolean`,
  `parseActiveRestrictions(dump: string): string[]`,
  `parsePasswordSufficient(dump: string): boolean | null`,
  `compareVersion(expected: string | null, observed: string | null): CheckStatus`,
  `buildChecks(input: VerifyInput): Check[]`,
  `allHardChecksPassed(checks: Check[]): boolean`.
  Task 8 calls `buildChecks` and `allHardChecksPassed`; Task 9 stores the `Check[]`.

- [ ] **Step 1: Write the failing test**

Create `lib/scanners/verify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseDeviceOwner,
  parseActiveRestrictions,
  compareVersion,
  buildChecks,
  allHardChecksPassed,
} from "./verify";

// Captured from a Zebra TC51 (Android 8.1) running agent 1.2.1.
const DUMP_OWNER = `
Current Device Policy Manager state:
  Device Owner:
    admin=ComponentInfo{com.ietires.scanneragent/com.ietires.scanneragent.DeviceAdminReceiver}
    name=
    package=com.ietires.scanneragent
  Enabled Device Admins (User 0, provisioningState: 2):
    admin=ComponentInfo{com.ietires.scanneragent/com.ietires.scanneragent.DeviceAdminReceiver}
    User restrictions:
      no_factory_reset
      no_add_account
`;

const DUMP_NO_OWNER = `
Current Device Policy Manager state:
  Enabled Device Admins (User 0):
    admin=ComponentInfo{com.other.app/com.other.app.Receiver}
`;

describe("parseDeviceOwner", () => {
  it("detects our package as device owner", () => {
    expect(parseDeviceOwner(DUMP_OWNER, "com.ietires.scanneragent")).toBe(true);
  });
  it("returns false when there is no device owner", () => {
    expect(parseDeviceOwner(DUMP_NO_OWNER, "com.ietires.scanneragent")).toBe(false);
  });
  it("does not match a different package that merely appears in the dump", () => {
    expect(parseDeviceOwner(DUMP_NO_OWNER, "com.other.app")).toBe(false);
  });
});

describe("parseActiveRestrictions", () => {
  it("extracts the restriction names", () => {
    expect(parseActiveRestrictions(DUMP_OWNER)).toEqual(["no_factory_reset", "no_add_account"]);
  });
  it("returns an empty array when none are set", () => {
    expect(parseActiveRestrictions(DUMP_NO_OWNER)).toEqual([]);
  });
});

describe("compareVersion", () => {
  it("passes on an exact match", () => {
    expect(compareVersion("2.0.1", "2.0.1")).toBe("pass");
  });
  it("fails on a mismatch", () => {
    expect(compareVersion("2.0.2", "2.0.1")).toBe("fail");
  });
  it("fails when the package is absent", () => {
    expect(compareVersion("2.0.1", null)).toBe("fail");
  });
  it("warns when nothing was pinned to compare against", () => {
    expect(compareVersion(null, "2.0.1")).toBe("warn");
  });
});

describe("buildChecks", () => {
  const base = {
    expected: {
      versions: { tireTrack: "2.0.1", rtLocator: "1.0", scannerAgent: "1.2.1" },
      rtConfigXml: "<RT><DEVICEID>0001</DEVICEID></RT>",
      screenOffTimeoutMs: 1800000,
      accelerometerRotation: 0,
      signerDigests: {} as Record<string, string | null>,
      sha256Present: { tireTrack: true, rtLocator: true, scannerAgent: true },
    },
    observed: {
      versions: { tireTrack: "2.0.1", rtLocator: "1.0", scannerAgent: "1.2.1" },
      rtConfigXml: "<RT><DEVICEID>0001</DEVICEID></RT>",
      screenOffTimeoutMs: "1800000",
      accelerometerRotation: "0",
      devicePolicyDump: DUMP_OWNER,
      signerDigests: {} as Record<string, string | null>,
      dataWedgeScanTestConfirmed: false,
    },
  };

  it("passes every hard check on a correctly configured device", () => {
    const checks = buildChecks(base);
    const failures = checks.filter((c) => c.hard && c.status !== "pass");
    expect(failures).toEqual([]);
    expect(allHardChecksPassed(checks)).toBe(true);
  });

  it("fails hard when the RT config on the device differs from intent", () => {
    const checks = buildChecks({
      ...base,
      observed: { ...base.observed, rtConfigXml: "<RT><DEVICEID>W08-004</DEVICEID></RT>" },
    });
    const rt = checks.find((c) => c.key === "rtConfigMatches")!;
    expect(rt.status).toBe("fail");
    expect(rt.hard).toBe(true);
    expect(allHardChecksPassed(checks)).toBe(false);
  });

  it("fails hard when the RT config is missing entirely", () => {
    const checks = buildChecks({
      ...base,
      observed: { ...base.observed, rtConfigXml: null },
    });
    expect(checks.find((c) => c.key === "rtConfigMatches")!.status).toBe("fail");
  });

  it("fails hard when device owner is not our package", () => {
    const checks = buildChecks({
      ...base,
      observed: { ...base.observed, devicePolicyDump: DUMP_NO_OWNER },
    });
    expect(checks.find((c) => c.key === "deviceOwner")!.status).toBe("fail");
    expect(allHardChecksPassed(checks)).toBe(false);
  });

  it("marks the DataWedge scan test unverified, and does not let it block", () => {
    const checks = buildChecks(base);
    const dw = checks.find((c) => c.key === "dataWedgeScanTest")!;
    expect(dw.status).toBe("unverified");
    expect(dw.hard).toBe(false);
    expect(allHardChecksPassed(checks)).toBe(true);
  });

  it("passes the scan test once a technician confirms it", () => {
    const checks = buildChecks({
      ...base,
      observed: { ...base.observed, dataWedgeScanTestConfirmed: true },
    });
    expect(checks.find((c) => c.key === "dataWedgeScanTest")!.status).toBe("pass");
  });

  it("warns without blocking when a build had no checksum to verify", () => {
    const checks = buildChecks({
      ...base,
      expected: { ...base.expected, sha256Present: { tireTrack: false, rtLocator: true, scannerAgent: true } },
    });
    const c = checks.find((k) => k.key === "sha256Verified")!;
    expect(c.status).toBe("warn");
    expect(c.hard).toBe(false);
    expect(allHardChecksPassed(checks)).toBe(true);
  });

  it("fails a settings check when the device disagrees with policy", () => {
    const checks = buildChecks({
      ...base,
      observed: { ...base.observed, screenOffTimeoutMs: "60000" },
    });
    expect(checks.find((c) => c.key === "screenTimeout")!.status).toBe("fail");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/scanners/verify.test.ts`
Expected: FAIL — `Failed to resolve import "./verify"`.

- [ ] **Step 3: Write the implementation**

Create `lib/scanners/verify.ts`:

```ts
// lib/scanners/verify.ts
// The scanner verification pass: what "correctly set up" means, expressed as a check list.
//
// Pure functions only — every input is already-captured device output. The same check list
// runs from the wizard over ADB and (later) from the agent reporting remotely, so a scanner
// is judged by identical rules either way.
//
// `hard: true` blocks the wizard from reaching Done. `warn`/`unverified` never block.

export type CheckStatus = "pass" | "fail" | "warn" | "unverified";

export type Check = {
  key: string;
  label: string;
  expected?: string;
  observed?: string;
  status: CheckStatus;
  hard: boolean;
};

export type AppKey = "tireTrack" | "rtLocator" | "scannerAgent";

export type VerifyInput = {
  expected: {
    versions: Record<AppKey, string | null>;
    rtConfigXml: string;
    screenOffTimeoutMs: number;
    accelerometerRotation: number;
    signerDigests: Record<string, string | null>;
    sha256Present: Record<AppKey, boolean>;
  };
  observed: {
    versions: Record<AppKey, string | null>;
    rtConfigXml: string | null;
    screenOffTimeoutMs: string | null;
    accelerometerRotation: string | null;
    devicePolicyDump: string;
    signerDigests: Record<string, string | null>;
    dataWedgeScanTestConfirmed: boolean;
  };
};

const AGENT_PKG = "com.ietires.scanneragent";

const APP_LABELS: Record<AppKey, string> = {
  tireTrack: "TireTrack",
  rtLocator: "RT Locator",
  scannerAgent: "Scanner Agent",
};

/** True when `pkg` is the active Device Owner, per `dumpsys device_policy`. */
export function parseDeviceOwner(dump: string, pkg: string): boolean {
  const section = dump.match(/Device Owner:[\s\S]*?(?=\n\s*\w[\w ]*:|\n*$)/);
  if (!section) return false;
  return section[0].includes(pkg);
}

/** Restriction names from the `User restrictions:` block. */
export function parseActiveRestrictions(dump: string): string[] {
  const section = dump.match(/User restrictions:\s*\n([\s\S]*?)(?=\n\s*[A-Z][\w ]*:|\n*$)/);
  if (!section) return [];
  return section[1]
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^no_[a-z_]+$/.test(l));
}

/** Whether the current lock password satisfies policy; null when the dump says nothing. */
export function parsePasswordSufficient(dump: string): boolean | null {
  const m = dump.match(/isActivePasswordSufficient=(true|false)/);
  return m ? m[1] === "true" : null;
}

export function compareVersion(
  expected: string | null,
  observed: string | null,
): CheckStatus {
  if (!expected) return "warn"; // nothing pinned — cannot judge
  if (!observed) return "fail"; // package absent
  return expected === observed ? "pass" : "fail";
}

/** Collapse whitespace so a trailing newline from `cat` is not a mismatch. */
function normalizeXml(xml: string): string {
  return xml.replace(/\s+/g, " ").trim();
}

export function buildChecks(input: VerifyInput): Check[] {
  const { expected, observed } = input;
  const checks: Check[] = [];

  // --- installed app versions ---
  for (const app of Object.keys(APP_LABELS) as AppKey[]) {
    checks.push({
      key: `version_${app}`,
      label: `${APP_LABELS[app]} version`,
      expected: expected.versions[app] ?? "(not pinned)",
      observed: observed.versions[app] ?? "(not installed)",
      status: compareVersion(expected.versions[app], observed.versions[app]),
      hard: true,
    });
  }

  // --- signer digests: only judged for apps where an expected digest is known ---
  for (const [pkg, expectedDigest] of Object.entries(expected.signerDigests)) {
    if (!expectedDigest) continue;
    const observedDigest = observed.signerDigests[pkg] ?? null;
    checks.push({
      key: `signer_${pkg}`,
      label: `${pkg} signer`,
      expected: expectedDigest,
      observed: observedDigest ?? "(unknown)",
      status: observedDigest === expectedDigest ? "pass" : "fail",
      hard: true,
    });
  }

  // --- integrity of what we installed ---
  const missingChecksums = (Object.keys(APP_LABELS) as AppKey[]).filter(
    (a) => !expected.sha256Present[a],
  );
  checks.push({
    key: "sha256Verified",
    label: "APK checksums verified",
    expected: "all 3",
    observed: missingChecksums.length
      ? `missing for: ${missingChecksums.map((a) => APP_LABELS[a]).join(", ")}`
      : "all 3",
    // A missing checksum means no integrity check happened. Visible, but not a reason to
    // reject a device that is otherwise correct.
    status: missingChecksums.length ? "warn" : "pass",
    hard: false,
  });

  // --- RT config actually on the device ---
  checks.push({
    key: "rtConfigMatches",
    label: "RT config on device matches intent",
    expected: normalizeXml(expected.rtConfigXml),
    observed: observed.rtConfigXml ? normalizeXml(observed.rtConfigXml) : "(file missing)",
    status:
      observed.rtConfigXml && normalizeXml(observed.rtConfigXml) === normalizeXml(expected.rtConfigXml)
        ? "pass"
        : "fail",
    hard: true,
  });

  // --- device settings ---
  checks.push({
    key: "screenTimeout",
    label: "Screen timeout",
    expected: String(expected.screenOffTimeoutMs),
    observed: observed.screenOffTimeoutMs ?? "(unset)",
    status: observed.screenOffTimeoutMs === String(expected.screenOffTimeoutMs) ? "pass" : "fail",
    hard: true,
  });

  checks.push({
    key: "screenRotation",
    label: "Auto-rotate",
    expected: String(expected.accelerometerRotation),
    observed: observed.accelerometerRotation ?? "(unset)",
    status:
      observed.accelerometerRotation === String(expected.accelerometerRotation) ? "pass" : "fail",
    hard: true,
  });

  // --- management state ---
  checks.push({
    key: "deviceOwner",
    label: "Device Owner",
    expected: AGENT_PKG,
    observed: parseDeviceOwner(observed.devicePolicyDump, AGENT_PKG)
      ? AGENT_PKG
      : "(not device owner)",
    status: parseDeviceOwner(observed.devicePolicyDump, AGENT_PKG) ? "pass" : "fail",
    hard: true,
  });

  // --- the one check that cannot be automated ---
  checks.push({
    key: "dataWedgeScanTest",
    label: "DataWedge scan emits Tab (manual test)",
    expected: "technician confirms a scan advances the field",
    observed: observed.dataWedgeScanTestConfirmed ? "confirmed" : "not yet confirmed",
    // DataWedge's SET_CONFIG result is not readable over ADB and the wizard cannot emit a
    // barcode, so this is recorded honestly as unverified rather than assumed to have worked.
    status: observed.dataWedgeScanTestConfirmed ? "pass" : "unverified",
    hard: false,
  });

  return checks;
}

export function allHardChecksPassed(checks: Check[]): boolean {
  return checks.every((c) => !c.hard || c.status === "pass");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/scanners/verify.test.ts`
Expected: PASS — 17 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all test files pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/scanners/verify.ts lib/scanners/verify.test.ts
git commit -m "feat(scanner-mdm): verification check-list module

Defines what a correctly set-up scanner means as data, with pure parsers
over dumpsys/settings output. Hard checks block the wizard; the DataWedge
scan test is recorded as unverified rather than assumed, because it can't
be automated over ADB."
```

---

## Task 8: Run the audit in the wizard and gate Done

**Files:**
- Modify: `app/equipment/scanners/setup/steps/InstallStep.tsx`
- Modify: `app/equipment/scanners/setup/useSetupSession.ts`
- Modify: `app/equipment/scanners/setup/steps/VerifyStep.tsx`

**Interfaces:**
- Consumes: `buildChecks`, `allHardChecksPassed`, `Check` (Task 7); the readback helpers
  (Task 5); `rtValues` and the built XML (Task 4).
- Produces: `SetupState.verification: Check[] | null`,
  `actions.setVerification(checks: Check[]): void`,
  `actions.confirmScanTest(): void`, `SetupState.scanTestConfirmed: boolean`.
  Task 9 persists the same `Check[]`.

- [ ] **Step 1: Add verification state to the session**

In `useSetupSession.ts`:

1. Add the import: `import type { Check } from "@/lib/scanners/verify";`
2. Add to `SetupState`: `verification: Check[] | null;` and `scanTestConfirmed: boolean;`
3. Add to `initialState`: `verification: null,` and `scanTestConfirmed: false,`
4. Add action types:

```ts
  | { type: "SET_VERIFICATION"; checks: Check[] }
  | { type: "CONFIRM_SCAN_TEST" }
```

5. Add reducer cases:

```ts
    case "SET_VERIFICATION":
      return { ...state, verification: action.checks };
    case "CONFIRM_SCAN_TEST":
      return { ...state, scanTestConfirmed: true };
```

6. Add action creators:

```ts
      setVerification: (checks: Check[]) => dispatch({ type: "SET_VERIFICATION", checks }),
      confirmScanTest: () => dispatch({ type: "CONFIRM_SCAN_TEST" }),
```

- [ ] **Step 2: Run the audit at the end of the install**

In `InstallStep.tsx` add the imports:

```ts
import { buildChecks, allHardChecksPassed } from "@/lib/scanners/verify";
```

Then, immediately **before** the `// Record completion` block, insert:

```tsx
        // 12. Verify: read the real state back off the device and compare it to intent.
        // Everything above reported success merely because a shell command didn't throw.
        await runStep("verify", "Verifying device state", async () => {
          const [ttV, rtlV, agentV] = await Promise.all([
            client.getPackageVersion(TIRETRACK_PKG),
            client.getPackageVersion(RTL_PKG),
            client.getPackageVersion(AGENT_PKG),
          ]);
          const onDeviceXml = await client.readTextFile("/sdcard/My Documents/rtlconfig.xml");
          const timeout = await client.getSystemSetting("screen_off_timeout");
          const rotation = await client.getSystemSetting("accelerometer_rotation");
          const dump = await client.dumpDevicePolicy();

          const checks = buildChecks({
            expected: {
              versions: {
                tireTrack: apks!.versions.tireTrack === "unknown" ? null : apks!.versions.tireTrack,
                rtLocator: apks!.versions.rtLocator === "unknown" ? null : apks!.versions.rtLocator,
                scannerAgent:
                  apks!.versions.scannerAgent === "unknown" ? null : apks!.versions.scannerAgent,
              },
              rtConfigXml: builtRtXml!,
              screenOffTimeoutMs: mdmConfig?.screenTimeoutMs ?? 1800000,
              accelerometerRotation: mdmConfig?.screenRotation === "landscape" ? 1 : 0,
              signerDigests: {},
              sha256Present: {
                tireTrack: urls!.tireTrack.sha256 !== null,
                rtLocator: urls!.rtLocator.sha256 !== null,
                scannerAgent: urls!.scannerAgent.sha256 !== null,
              },
            },
            observed: {
              versions: { tireTrack: ttV, rtLocator: rtlV, scannerAgent: agentV },
              rtConfigXml: onDeviceXml,
              screenOffTimeoutMs: timeout,
              accelerometerRotation: rotation,
              devicePolicyDump: dump,
              signerDigests, // observed only; see the note below
              dataWedgeScanTestConfirmed: false,
            },
          });

          actions.setVerification(checks);
          if (!allHardChecksPassed(checks)) {
            const failed = checks
              .filter((c) => c.hard && c.status !== "pass")
              .map((c) => `${c.label}: expected ${c.expected}, got ${c.observed}`);
            throw new Error(`Verification failed — ${failed.join(" | ")}`);
          }
        });
```

`builtRtXml` is already declared and assigned by Task 4's RT config step — no change needed
there.

**On the signer check:** `observed.signerDigests` and `expected.signerDigests` are both passed
as `{}` above, which makes `buildChecks` emit no signer rows (it skips any package with no
expected digest). The readback helper exists (`getPackageSignerDigest`, Task 5) but there is
no trustworthy *source* for the expected digest yet — hardcoding one would be brittle, and
capturing it at pin time belongs with the build-pinning work. To make the data available
without inventing a comparison, populate the observed side only and record it for later:

```tsx
          const signerDigests: Record<string, string | null> = {
            [TIRETRACK_PKG]: await client.getPackageSignerDigest(TIRETRACK_PKG),
            [RTL_PKG]: await client.getPackageSignerDigest(RTL_PKG),
            [AGENT_PKG]: await client.getPackageSignerDigest(AGENT_PKG),
          };
          console.info("observed signer digests", signerDigests);
```

Pass this as `observed.signerDigests` and keep `expected.signerDigests: {}`. After the first
few scanners, the digests can be read from these logs and promoted to expected values in a
follow-up. The verification row therefore carries no signer check yet — that is deliberate and
noted in "Deferred", rather than a fake pass.

- [ ] **Step 3: Show the result and gate Done in VerifyStep**

In `VerifyStep.tsx`, add near the top of the returned JSX (before the existing claim-code
block), a results panel plus the scan-test checkbox:

```tsx
      {session.state.verification && (
        <div className="space-y-2">
          <h4 className="text-[13px] font-semibold theme-text-primary">Verification</h4>
          <ul className="space-y-1">
            {session.state.verification.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-xs">
                <span
                  className={
                    c.status === "pass"
                      ? "text-emerald-500"
                      : c.status === "fail"
                        ? "text-red-500"
                        : "text-amber-500"
                  }
                >
                  {c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "!"}
                </span>
                <span className="theme-text-secondary">
                  {c.label}
                  {c.status !== "pass" && (
                    <span className="theme-text-tertiary">
                      {" "}
                      — expected {c.expected}, got {c.observed}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {!session.state.scanTestConfirmed && (
            <label className="flex items-start gap-2 text-xs theme-text-secondary p-2 rounded-lg ui-callout-amber">
              <input
                type="checkbox"
                onChange={() => session.actions.confirmScanTest()}
                className="mt-0.5"
              />
              <span>
                Scan a barcode into a text field on the scanner and confirm the cursor
                advances (DataWedge Tab). This can&apos;t be checked automatically.
              </span>
            </label>
          )}
        </div>
      )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/equipment/scanners/setup/steps/InstallStep.tsx app/equipment/scanners/setup/useSetupSession.ts app/equipment/scanners/setup/steps/VerifyStep.tsx
git commit -m "feat(scanner-mdm): post-install verification pass blocks a bad scanner

The wizard previously reported success because shell commands didn't
throw. It now reads versions, the RT config file, both settings and the
device-policy dump back off the device, compares them to intent, and
refuses to finish when a hard check fails."
```

---

## Task 9: Persist verifications in Convex

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/scannerMdm.ts`
- Modify: `app/equipment/scanners/setup/steps/InstallStep.tsx`
- Modify: `app/equipment/scanners/[id]/page.tsx`

**Interfaces:**
- Consumes: `Check` (Task 7).
- Produces: `api.scannerMdm.recordVerification` mutation,
  `api.scannerMdm.getLatestVerification` query returning
  `{ at: number; passed: boolean; source: string; checks: Check[] } | null`.

- [ ] **Step 1: Add the table**

In `convex/schema.ts`, after the `scannerLockPolicy` table, add:

```ts
  // Result of a scanner verification pass. One row per audit; the newest is authoritative.
  scannerVerifications: defineTable({
    scannerId: v.id("scanners"),
    at: v.number(),
    by: v.optional(v.id("users")),
    source: v.string(), // "wizard" | "manual" | "remote"
    passed: v.boolean(),
    checks: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        expected: v.optional(v.string()),
        observed: v.optional(v.string()),
        status: v.string(), // "pass" | "fail" | "warn" | "unverified"
        hard: v.boolean(),
      }),
    ),
  }).index("by_scanner", ["scannerId"]),
```

- [ ] **Step 2: Add the mutation and query**

Append to `convex/scannerMdm.ts`:

```ts
// ============ VERIFICATION ============

const verificationCheck = v.object({
  key: v.string(),
  label: v.string(),
  expected: v.optional(v.string()),
  observed: v.optional(v.string()),
  status: v.string(),
  hard: v.boolean(),
});

export const recordVerification = mutation({
  args: {
    scannerId: v.id("scanners"),
    source: v.string(),
    passed: v.boolean(),
    checks: v.array(verificationCheck),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("scannerVerifications", {
      scannerId: args.scannerId,
      at: Date.now(),
      by: args.actingUserId,
      source: args.source,
      passed: args.passed,
      checks: args.checks,
    });
  },
});

export const getLatestVerification = query({
  args: { scannerId: v.id("scanners") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("scannerVerifications")
      .withIndex("by_scanner", (q) => q.eq("scannerId", args.scannerId))
      .order("desc")
      .take(1);
    return rows[0] ?? null;
  },
});
```

- [ ] **Step 3: Record from the wizard**

In `InstallStep.tsx`, add the mutation hook beside the existing ones:

```ts
  const recordVerification = useMutation(api.scannerMdm.recordVerification);
```

Then inside the `verify` step, immediately after `actions.setVerification(checks);`, add:

```tsx
          if (state.scannerId) {
            await recordVerification({
              scannerId: state.scannerId,
              source: "wizard",
              passed: allHardChecksPassed(checks),
              checks,
              actingUserId: user?._id,
            }).catch(() => {});
          }
```

- [ ] **Step 4: Show the last audit on the detail page**

In `app/equipment/scanners/[id]/page.tsx`, add the query beside the existing ones:

```ts
  const lastVerification = useQuery(api.scannerMdm.getLatestVerification, { scannerId });
```

Then render a banner near the top of the detail content, above the command buttons:

```tsx
          {lastVerification && !lastVerification.passed && (
            <div className="p-3 rounded-xl ui-callout-red text-sm mb-4">
              <p className="font-semibold">Verification failed</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {lastVerification.checks
                  .filter((c) => c.hard && c.status !== "pass")
                  .map((c) => (
                    <li key={c.key}>
                      {c.label} — expected {c.expected}, got {c.observed}
                    </li>
                  ))}
              </ul>
            </div>
          )}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/scannerMdm.ts app/equipment/scanners/setup/steps/InstallStep.tsx "app/equipment/scanners/[id]/page.tsx"
git commit -m "feat(scanner-mdm): persist verification results, surface failures on the scanner"
```

---

## Task 10: Derive the APK version from the artifact

**Files:**
- Modify: `aws/scanner-mdm/lambdas/fetch_apk.py`

**Interfaces:**
- Consumes: nothing.
- Produces: the `/scanner-mdm/apk` response's `version` field is now derived from the S3
  object rather than a hand-typed config field. `getApkDownloadUrls` (Convex) and
  `apkManifest.ts` are unchanged — they already pass `version` through.

The manual `currentTireTrackVersion` field is the direct cause of "vunknown" displays:
nothing tied it to the object actually installed.

- [ ] **Step 1: Add a version resolver**

In `fetch_apk.py`, add after `get_sha256_for_key`:

```python
def resolve_version(key, config_version):
    """Version of the APK we are actually serving, most trustworthy source first:
      1. the S3 object's x-amz-meta-version
      2. the version embedded in the key, e.g. apks/scanner-agent-1.2.1.apk -> 1.2.1
      3. the hand-maintained config field (last resort — often stale, hence "vunknown")
    """
    if not key:
        return config_version or "unknown"
    try:
        head = s3.head_object(Bucket=S3_BUCKET, Key=key)
        meta_version = head.get("Metadata", {}).get("version")
        if meta_version:
            return meta_version
    except Exception as e:
        print(f"resolve_version: head_object failed for {key}: {e}")

    import re

    m = re.search(r"-(\d+(?:\.\d+)+)\.apk$", key)
    if m:
        return m.group(1)
    return config_version or "unknown"
```

- [ ] **Step 2: Use it in all three branches**

Replace each of the three `version = config.get("current...Version", "unknown") if config else "unknown"`
lines with the matching call:

```python
            version = resolve_version(s3_key, (config or {}).get("currentTireTrackVersion"))
```

```python
            version = resolve_version(s3_key, (config or {}).get("currentRtLocatorVersion"))
```

```python
            version = resolve_version(s3_key, (config or {}).get("currentAgentVersion"))
```

- [ ] **Step 3: Test the parser locally**

Run:

```bash
python3 -c "
import re
for k in ['apks/scanner-agent-1.2.1.apk','apks/tiretrack-2.0.1.apk','apks/rtlocator-1.0.apk','apks/weird.apk']:
    m = re.search(r'-(\d+(?:\.\d+)+)\.apk\$', k)
    print(k, '->', m.group(1) if m else 'no match')
"
```

Expected:
```
apks/scanner-agent-1.2.1.apk -> 1.2.1
apks/tiretrack-2.0.1.apk -> 2.0.1
apks/rtlocator-1.0.apk -> 1.0
apks/weird.apk -> no match
```

- [ ] **Step 4: Deploy the Lambda**

```bash
cd aws/scanner-mdm/lambdas && zip -q /tmp/fetch_apk.zip fetch_apk.py && \
aws lambda update-function-code --function-name scanner-fetch-apk \
  --zip-file fileb:///tmp/fetch_apk.zip --output json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['FunctionName'], d['LastUpdateStatus'])"
```

Expected: `scanner-fetch-apk Successful`. If the function name differs, find it with
`aws lambda list-functions --query 'Functions[?contains(FunctionName,\`apk\`)].FunctionName'`.

- [ ] **Step 5: Verify the live response**

```bash
curl -s "https://7brylwlei6.execute-api.us-east-1.amazonaws.com/prod/scanner-mdm/apk?app=agent&locationCode=W08" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('version:', d.get('version'), 'sha256:', (d.get('sha256') or 'MISSING')[:16], 'key:', d.get('s3Key'))"
```

Expected: a real version like `1.2.1`, not `unknown`.

- [ ] **Step 6: Commit**

```bash
git add aws/scanner-mdm/lambdas/fetch_apk.py
git commit -m "fix(scanner-mdm): derive APK version from the artifact, not a typed field

The served version came from a hand-maintained config string with nothing
tying it to the S3 object installed, which is why scanners displayed
vunknown. Now read from object metadata, then the key, with the config
field only as a last resort."
```

---

## Task 11: Point the legacy CLI at the shared builder

**Files:**
- Modify: `tools/scanner-setup/src/index.ts:390-405`

**Interfaces:**
- Consumes: `buildRtConfig` (Task 1).
- Produces: nothing new.

This is the fourth RT config writer. It hardcodes `<DEVICEID>0001</DEVICEID>`, so leaving it
alone would let it silently contradict the other three.

- [ ] **Step 1: Replace its inline XML**

In `tools/scanner-setup/src/index.ts`, add the import at the top:

```ts
import { buildRtConfig } from "../../../lib/scanners/rtConfig";
```

Replace the body of `pushRtConfig` down to the `fs.writeFileSync` call with:

```ts
async function pushRtConfig(adbSerial: string, config: api.SetupConfig) {
  if (!config.rtConfigXml && !config.rtLocatorUrl) return;

  console.log("Pushing RT config...");
  const built = buildRtConfig({
    locationCode: config.locationCode ?? "unknown",
    rtLocatorUrl: config.rtLocatorUrl ?? "",
    rtDeviceId: config.rtDeviceId ?? "",
    template: config.rtConfigXml,
  });
  if (built.problems.length > 0) {
    console.error(chalk.red(`✗ RT config invalid: ${built.problems.join("; ")}`));
    return;
  }
  const xml = built.xml;

  const tempFile = path.join(os.tmpdir(), "rtlconfig.xml");
  fs.writeFileSync(tempFile, xml);
```

Leave the rest of the function unchanged.

- [ ] **Step 2: Add the field to its config type**

In `tools/scanner-setup/src/api.ts`, the `SetupConfig` interface (line 35) already has
`locationCode: string`. Add one field beneath `rtConfigXml?: string;`:

```ts
  rtDeviceId?: string;
```

- [ ] **Step 3: Return `rtDeviceId` from the config Lambda**

The CLI reads its config from `/api/scanner-mdm/config`, which proxies to
`aws/scanner-mdm/lambdas/setup_config.py`. That Lambda lists its response fields explicitly,
so a new field will not flow through on its own.

In `setup_config.py`, add to the response dict beside `"rtConfigXml"` (line ~90):

```python
                "rtDeviceId": config.get("rtDeviceId"),
```

and to the hardcoded defaults dict beside its `"rtConfigXml": None,` (line ~123):

```python
        "rtDeviceId": None,
```

Then deploy it:

```bash
cd aws/scanner-mdm/lambdas && zip -q /tmp/setup_config.zip setup_config.py && \
aws lambda update-function-code --function-name scanner-setup-config \
  --zip-file fileb:///tmp/setup_config.zip --output json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['FunctionName'], d['LastUpdateStatus'])"
```

Expected: `scanner-setup-config Successful`. If the name differs, find it with
`aws lambda list-functions --query 'Functions[?contains(FunctionName,\`config\`)].FunctionName'`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. `tools/scanner-setup` has its own `tsconfig.json`; if so also run
`npx tsc --noEmit -p tools/scanner-setup`.

- [ ] **Step 5: Commit**

```bash
git add tools/scanner-setup/src/index.ts tools/scanner-setup/src/api.ts aws/scanner-mdm/lambdas/setup_config.py
git commit -m "refactor(scanner-setup): legacy CLI uses the shared RT config builder

It hardcoded DEVICEID=0001, making it the fourth writer able to
contradict the other three."
```

---

## Task 12: Live RT config preview in Scanner Settings

**Files:**
- Modify: `app/equipment/scanners/settings/page.tsx`

**Interfaces:**
- Consumes: `buildRtConfig` (Task 1), the `rtDeviceId` form field (Task 2).
- Produces: nothing new.

Config content was the user's stated worry. This makes a bad config visible while editing,
rather than at 2am on a scanner in a warehouse.

- [ ] **Step 1: Add the preview**

Add the import:

```ts
import { buildRtConfig } from "@/lib/scanners/rtConfig";
```

Immediately below the `rtConfigXml` textarea, add:

```tsx
                {(() => {
                  // locationCode is not a form field — it is derived at save time from
                  // LOCATION_DEFAULTS (see handleSave, line ~212). Derive it identically here
                  // so the preview validates exactly what will be saved.
                  const previewLocation = locations?.find((l) => l._id === selectedLocationId);
                  const previewCode =
                    (previewLocation ? LOCATION_DEFAULTS[previewLocation.name] : null)?.code ??
                    previewLocation?.name?.substring(0, 3).toUpperCase() ??
                    "???";
                  const preview = buildRtConfig({
                    locationCode: previewCode,
                    rtLocatorUrl: form.rtLocatorUrl,
                    rtDeviceId: form.rtDeviceId,
                    template: form.rtConfigXml || undefined,
                  });
                  return (
                    <div className="mt-2 space-y-2">
                      {preview.problems.length > 0 ? (
                        <div className="p-2 rounded-lg ui-callout-red text-xs">
                          <p className="font-semibold mb-1">This config will be rejected:</p>
                          <ul className="space-y-0.5">
                            {preview.problems.map((p) => (
                              <li key={p}>• {p}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="p-2 rounded-lg ui-callout-green text-xs">
                          Valid — DEVICEID <span className="font-mono">{preview.values.deviceId}</span>,
                          URL <span className="font-mono">{preview.values.rtLocatorUrl}</span>
                        </div>
                      )}
                      <pre className="p-2 rounded-lg text-[11px] font-mono overflow-x-auto theme-text-tertiary border border-[var(--border-subtle)]">
                        {preview.xml}
                      </pre>
                    </div>
                  );
                })()}
```

`locations`, `selectedLocationId` and `LOCATION_DEFAULTS` are all already in scope in this
component — the same three values `handleSave` uses.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/equipment/scanners/settings/page.tsx
git commit -m "feat(scanner-mdm): live RT config validation and preview in settings"
```

---

## Task 13: Ship it and verify on real hardware

**Files:** none (deploy + manual validation).

**Interfaces:** none.

- [ ] **Step 1: Full check before deploying**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: tests pass, no type errors, build succeeds.

- [ ] **Step 2: Push (deploys Vercel + Convex from origin/main)**

```bash
git push origin main && git log -1 --format='%h %an <%ae> %s'
```

Expected: the push succeeds and the author is `Andy Barrows <andy.barrows@gmail.com>`. A
different author causes Vercel to report `UNKNOWN` deploy status.

- [ ] **Step 3: Set `rtDeviceId` for all three locations**

Open `https://www.iecentral.com/equipment/scanners/settings`, and for W08, R10 and W09 set
the RT Device ID and confirm the preview panel reports **Valid**. Record the three values.

If any location shows a problem, fix the URL or template until it is valid — the wizard will
now refuse to install against an invalid config, which is the intended behaviour.

- [ ] **Step 4: Pre-create the per-location thing groups**

```bash
for L in W08 R10 W09; do
  aws iot create-thing-group --thing-group-name "scanners-$L" >/dev/null 2>&1
  aws iot describe-thing-group --thing-group-name "scanners-$L" \
    --query 'thingGroupName' --output text
done
```

Expected: `scanners-W08`, `scanners-R10`, `scanners-W09`.

- [ ] **Step 5: Run the wizard end-to-end on W08-001**

Prerequisites: `adb kill-server` (Chrome WebUSB cannot share the device with an ADB server),
scanner connected by USB, USB debugging on.

Walk the update flow and confirm:

1. The Identity step no longer shows an RT Device ID field.
2. "Granting settings-write permission" appears and succeeds.
3. "Verifying device state" appears and every hard check passes.
4. The Verify step lists the checks and shows the DataWedge scan-test prompt.
5. Scan a barcode into a text field on the device; confirm the cursor advances; tick the box.

- [ ] **Step 6: Confirm the config on the device is right**

```bash
adb shell cat "/sdcard/My Documents/rtlconfig.xml"
```

Expected: `<DEVICEID>` equals the value set for W08 in Step 3 — **not** `0001` and **not**
`W08-001`.

- [ ] **Step 7: Confirm the appop stuck**

```bash
adb shell appops get com.ietires.scanneragent WRITE_SETTINGS
```

Expected: output contains `allow`.

- [ ] **Step 8: Confirm the audit persisted**

```bash
npx convex run scannerMdm:getScannerBySerialNumber '{"serialNumber":"19058522500842"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('scanner:', d and d.get('number'))"
```

Then check the detail page for that scanner shows no red verification banner.

- [ ] **Step 9: Prove the audit actually blocks a bad device**

This is the test that matters — a gate that never fires is not a gate.

```bash
# Corrupt the config on the device, then re-run the wizard's audit.
adb shell "echo '<RT><DEVICEID>WRONG</DEVICEID></RT>' > '/sdcard/My Documents/rtlconfig.xml'"
```

Re-run the wizard against the device. Expected: the RT config check reports `fail` with
`expected …DEVICEID>0001…, got …DEVICEID>WRONG…`, the install step shows "Verification
failed", and the wizard does **not** advance to Done. Then re-run normally to restore it.

- [ ] **Step 10: Commit any fixes found during validation**

```bash
git add -A && git commit -m "fix(scanner-mdm): corrections from live validation on W08-001"
git push origin main
```

---

## Deferred to later stages (not in this plan)

From the spec, delivered remotely after the batch is programmed:

- **Unit 4/5/6** — PIN instant-revert, Settings-UI block, `super_admin` gate.
- **Unit 7** — remote view (`ScreenReaderService`). **If this is wanted on the new batch
  without a second USB visit, the agent build containing the service must ship before the
  batch is programmed**, because `enabled_accessibility_services` can only be written over
  shell. The cloud-side UI can follow later.
- **Unit 8** — Device Owner restrictions + sideload logging.
- **The signer-digest check.** `lib/scanners/verify.ts` and `WebAdbClient.getPackageSignerDigest`
  both support it, and Task 8 records the observed digests, but no *expected* digest is compared
  yet because there is no trustworthy source for one until digests are captured at pin time.
  Promote the logged values to expected once a few scanners have reported them.
- **Unit 10** — AWS IoT Jobs remote fleet updates, the ack bridge, and
  `isCleanSession = false`.
- **Unit 9 batch ergonomics** — "Program next scanner", Verify-step escape hatch, and
  confirming the stored `lockdownEnabled` value.
