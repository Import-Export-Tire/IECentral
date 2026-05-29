# Scanner Setup Wizard — Design

**Status:** Draft — awaiting implementation
**Author:** Andy Barrows (drafted with Claude)
**Date:** 2026-05-29
**Repo affected:** `IECentral`

## Summary

Replace the current scanner provisioning workflow (local Bash script + half-finished Node CLI) with a **fully web-based setup wizard** in the IECentral Scanner Manager. An admin clicks "Setup New Scanner," plugs the scanner into the computer via USB, and the wizard walks them through detect → location → register → install (APKs + RT config + permissions + Device Admin) → verify → done. All ADB operations happen in the browser via the WebUSB API and the `@yume-chan/adb` ("ya-webadb") library.

## Motivation

Today's scanner setup requires Andy to:
1. Connect to the scanner via USB on a Mac with `adb` installed
2. Open Terminal
3. Run `./setup-tc51.sh` from `~/Desktop/scanner-setup/`
4. Answer interactive prompts
5. Manually approve Device Admin on the scanner
6. Set the PIN on the scanner

This is fine for Andy but unworkable for other admins or future warehouse managers in other cities. The half-finished `tools/scanner-setup/` Node CLI was an attempt to polish this but still requires `npm install`, `npx ts-node`, and Terminal familiarity.

A web wizard removes all of those constraints. Admin opens IECentral in Chrome on whatever Mac/Windows machine has the scanner plugged in. Browser-resident ADB. One UI. No install.

## Non-goals

- **OTA updates to already-deployed scanners.** Scanner Agent already does this via MQTT; not in this feature.
- **Bulk multi-scanner setup.** Wizard handles one at a time.
- **Firefox / Safari support.** WebUSB is Chromium-only by design; admins use Chrome.
- **Replacing the existing provisioning-code-only flow on the scanner detail page.** That stays for the case where a scanner is already physically deployed in a warehouse and needs to claim a code remotely.
- **Reimplementing the ADB protocol.** We use `ya-webadb`, a mature MIT-licensed library.
- **Initial OS flashing / unbricking.** Out of scope; rare manual process.

## Design

### Section 1 — UX flow

Wizard opens as a modal from the Scanner Manager page. Eight steps:

1. **Plug in** — wizard waits for `navigator.usb.requestDevice()` to return a Zebra TC51. Instructions: "Plug in scanner via USB, enable USB debugging in Developer Options, tap Allow on the device." On first connect, the browser asks user to grant permission to the specific device (persistent per-origin).
2. **Confirm device** — shows serial, model, Android version pulled from `adb shell getprop`. Button: "This is the right scanner."
3. **Pick location** — Latrobe / Everson / Chestnut. Wizard calls existing `getMdmConfigByCode(locationCode)` to fetch RT URL, bloatware list, screen settings.
4. **Pick warehouse / RT device ID** — pre-fills next free `W08-NNN` / `R10-NNN` / `W09-NNN` via existing `getNextScannerNumber(locationCode)`. Optional RT Device ID override.
5. **Generate** — calls existing `createScannerFromSetup` to insert the scanner record, then `getProvisionCode(scannerId)` to mint a 6-char provisioning code + IoT certs.
6. **Install** — live progress as the wizard executes each step in order:
   - Download RTLHandsFree APK from S3 (presigned URL via `getApkDownloadUrls`) → `webAdb.install(buffer)`
   - Download TireTrack APK → `webAdb.install(buffer)`
   - Download Scanner Agent APK → `webAdb.install(buffer)`
   - Push RT config XML to `/sdcard/My Documents/rtlconfig.xml` via `webAdb.push()`
   - Grant runtime permissions for each app via `webAdb.shell("pm grant ...")`
   - Set `screen_off_timeout` to 30 min, `accelerometer_rotation` to 0 via `webAdb.shell("settings put ...")`
   - Activate Scanner Agent as Device Admin via `webAdb.shell("dpm set-active-admin com.ietires.scanneragent/.DeviceAdminReceiver")`
   - Disable ~19 bloatware packages via batched `pm disable-user --user 0`
   - Launch Scanner Agent's `SetupActivity` via `webAdb.shell("am start -n com.ietires.scanneragent/.SetupActivity")` so the operator sees the provisioning-code prompt on the device. The wizard displays the 6-char code prominently and instructs: "Type this code into the Scanner Agent on the scanner." (A future enhancement: extend Scanner Agent to accept the code as an `Intent` extra so the wizard can pass it directly, eliminating the manual type-in. Out of scope for this PR.)
7. **Verify** — wizard polls Convex (`getScannerById(scannerId).isOnline`) for up to 60 seconds, waiting for Scanner Agent to come online via MQTT. Shows "Scanner online ✓" when it does. The polling starts as soon as step 6 reaches the SetupActivity launch — gives the operator time to type the code while the wizard waits.
8. **Done** — summary card with scanner ID + PIN (printed once, admin records it). Reminders for manual on-device steps: Wi-Fi, DataWedge → Default Profile → **Tab Command checked** (NOT Send Enter — RT requires Tab), Gboard tweaks (Number Row ON, Autocorrect OFF). Close button.

### Section 2 — Architecture

#### Frontend (Next.js, IECentral)

**New files** (all under `app/equipment/scanners/setup/`):
- `WebAdbClient.ts` — wraps `ya-webadb` with our specific operations (`installApkFromUrl`, `pushTextFile`, `shell`, `setActiveAdmin`, `disablePackages`). Pure TypeScript, no React.
- `SetupWizard.tsx` — the modal component, orchestrates the 8 steps. Holds wizard state, drives the WebAdbClient, renders progress.
- `useSetupSession.ts` — React hook that owns the install sequence state machine and exposes per-step progress to the wizard.
- `steps/` — one file per wizard step (`DeviceDetectStep.tsx`, `LocationStep.tsx`, `IdentityStep.tsx`, `GenerateStep.tsx`, `InstallStep.tsx`, `VerifyStep.tsx`, `DoneStep.tsx`) so each step is small and independently editable.
- `apkManifest.ts` — tiny module that fetches the APK manifest (S3 keys, expected SHA-256) and exposes it to the wizard for verification.

**Modified files:**
- `app/equipment/scanners/page.tsx` — add a "Setup New Scanner" button next to the existing "Add Scanner" affordance. Opens `<SetupWizard>`. Detect browser capability via `'usb' in navigator`; if absent, button is disabled with tooltip "Open in Chrome or Edge to enable scanner setup."

**New deps (added to `package.json`):**
- `@yume-chan/adb` (core ADB protocol)
- `@yume-chan/adb-credential-web` (RSA key storage in IndexedDB)
- `@yume-chan/adb-daemon-webusb` (WebUSB transport)
- `@yume-chan/stream-extra` (peer dep used internally)

Bundle impact: ~150 kB minified+gzipped, **lazy-loaded** via dynamic `import()` when the wizard opens — does not bloat the initial page load.

#### Backend (Convex, IECentral)

**New mutations / queries** in `convex/scannerMdm.ts`:
- `getApkDownloadUrls({ locationCode })` — calls the AWS Lambda `scanner-fetch-apk` three times (one per app) and returns:
  ```ts
  {
    rtLocator: { url: string; sha256: string; version: string },
    tireTrack: { url: string; sha256: string; version: string },
    scannerAgent: { url: string; sha256: string; version: string },
  }
  ```
  Each `url` is a presigned S3 GET URL valid for 15 minutes. The Lambda needs a tiny extension to also return the SHA-256 — that's a follow-up to this PR or part of it.
- `markScannerSetupComplete({ scannerId, installedApps: { tireTrack, rtLocator, scannerAgent }, provisionedAt })` — patches the scanner row's `mdmStatus`, `installedApps.{tireTrack,rtLocator,scannerAgent}` (with version strings).
- `logScannerSetupStep({ scannerId, step, status, durationMs, error?, browserAgent? })` — appends to a new `scannerSetupLogs` table for telemetry.

**New table** in `convex/schema.ts`:
- `scannerSetupLogs` — `{ scannerId, step, status, durationMs, error?, browserAgent?, createdAt }`, indexed by `[scannerId, createdAt]`.

**Existing pieces reused unchanged:**
- `createScannerFromSetup` mutation (creates scanner record)
- `getProvisionCode` query (already generates 6-char code + IoT cert)
- `getMdmConfigByCode` query (location-specific MDM config)
- `getNextScannerNumber` query (next free `W08-NNN`)
- HTTP `/claim-provision` route (Scanner Agent's redeem endpoint; unchanged)

#### AWS infrastructure (mostly unchanged)

- S3 bucket `ietires-scanner-assets/apks/` — keeps holding APKs.
- Lambda `scanner-fetch-apk` — needs a small change: also compute and return the SHA-256 of the chosen APK so the browser can verify. Cheap (S3 supports object metadata; we can pre-compute SHA at upload time and store as `x-amz-meta-sha256`).
- API Gateway `/scanner-mdm/apk` — unchanged.
- **S3 CORS policy update required:** the bucket needs a CORS rule allowing `GET` from IECentral's origins (production domain, Vercel preview pattern, localhost). The Lambda's own response already includes `Access-Control-Allow-Origin: *`; the actual S3 GET from the presigned URL needs separate CORS configured on the bucket.

#### Data flow per install step

```
Browser (SetupWizard / WebAdbClient)
  ↓ webusb (via navigator.usb)
USB → Zebra TC51 ADB daemon

For APK install:
1. Browser → convex.query(getApkDownloadUrls, { locationCode }) → { url, sha256 } x3
2. Browser → fetch(presignedUrl) → ArrayBuffer
3. Browser → verify SHA-256(buffer) matches manifest; abort if mismatch
4. Browser → webAdb.install(buffer) → ADB sync to /data/local/tmp + `pm install`
5. Browser → webAdb.shell("pm grant <pkg> <perm>") for each runtime permission
6. Browser → webAdb.shell("dpm set-active-admin com.ietires.scanneragent/.DeviceAdminReceiver")
7. Browser → convex.mutation(markScannerSetupComplete, { ... })
8. Browser → poll convex.query(getScannerById, { id }) until isOnline === true
```

The browser is the orchestrator. The server's role is: hand out config + presigned URLs + record success/telemetry.

#### Browser support detection

On wizard mount: `const supported = typeof navigator !== "undefined" && "usb" in navigator;`. If false, render a friendly message: "This feature requires Chrome or Edge. Open this page in a supported browser to set up scanners."

### Section 3 — Failure handling, security, and APK delivery

#### Failure modes & recovery

| Failure | Detection | Recovery |
|---|---|---|
| **WebUSB permission denied** | `navigator.usb.requestDevice()` throws `NotFoundError` or `SecurityError` | Wizard shows "Permission denied — click here to retry" |
| **Scanner unplugged mid-install** | `webAdb.disconnected` event fires | Wizard pauses, shows "Reconnect scanner to continue" — resumes from the failed step (each step is idempotent) |
| **APK download fails (network/CORS/S3)** | `fetch()` rejects or non-2xx response | Wizard shows the error inline, lets admin retry just that step |
| **SHA-256 mismatch on downloaded APK** | manual check after `fetch()` | Wizard aborts with "APK verification failed — contact admin" — never installs a tampered APK |
| **APK install fails with signature mismatch** | `pm install` returns `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Wizard prompts: "App already installed with different signature. Uninstall first?" Yes → `pm uninstall <pkg>` → re-install. No → skip this app. |
| **`dpm set-active-admin` fails** | Shell command exits non-zero | Show error inline; admin can manually approve on device, click "I did it" to continue |
| **Convex registration fails** (duplicate scanner number) | Mutation throws "Scanner already exists" | Wizard returns to step 4, asks admin to pick a different number |
| **Scanner Agent never comes online** (Verify step timeout) | 60s polling timeout | Wizard shows "Couldn't verify — provision later from scanner detail page" + offers to mark setup-complete-without-verify |

Each install step is idempotent. Re-running it does not break anything, so resume-from-failure is safe.

#### Security

- **Role gating:** wizard available only to users with role `super_admin`, `admin`, `warehouse_director`, or `warehouse_manager`. Same as the current Add Scanner flow. Enforced at both the UI render gate and the Convex mutation's `requireManagePersonnel` check.
- **WebUSB consent:** browser-enforced; user must explicitly grant the page access to each scanner the first time. Persists per-origin until revoked through browser settings.
- **ADB authentication:** `ya-webadb` generates an RSA key pair stored in browser IndexedDB. First connect to a given scanner triggers the "Allow USB debugging from this computer?" prompt on the device. The scanner stores the key fingerprint; subsequent connects from the same browser auto-allow.
- **APK signature verification:** every APK downloaded by the wizard is hashed (SHA-256) and compared against the `sha256` field returned by `getApkDownloadUrls`. Mismatch aborts the install — defense against compromised S3 objects or man-in-the-middle (S3's presigned URLs are HTTPS but this is belt-and-suspenders).
- **Provisioning code:** stays 6-char + 1-hour TTL + single-use (existing `claimProvision` behavior). Code is held in the wizard's session state and not logged or persisted client-side beyond the wizard's lifetime.
- **No long-lived secrets in browser:** the wizard never touches AWS IAM credentials, EAS tokens, or IoT certs. It only handles presigned S3 URLs (time-limited, scope-limited) and the provisioning code.

#### APK delivery & caching

- `getApkDownloadUrls` returns presigned S3 URLs that expire in 15 minutes — comfortable for the wizard's typical install time (~30–60 seconds).
- Browser uses `fetch()` to pull each APK as `ArrayBuffer`. Sizes today: RTLocator ~2.5MB, TireTrack ~88MB, Scanner Agent ~7MB. ~100MB total per scanner.
- **Caching:** the wizard caches downloaded APK buffers in IndexedDB keyed by `s3Key + sha256`. If admin sets up multiple scanners in a row, subsequent ones reuse the cached APKs. Cache invalidates automatically when S3 returns a different key/sha256.
- **S3 bucket CORS:** must allow `GET` from IECentral's origins. The bucket policy needs:
  ```json
  [{
    "AllowedOrigins": ["https://iecentral.ietires.com", "https://*.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["x-amz-meta-sha256"],
    "MaxAgeSeconds": 3600
  }]
  ```

#### Telemetry

- Each wizard step writes a structured log via `logScannerSetupStep` mutation: `{ scannerId, step, status, durationMs, error?, browserAgent }`.
- The scanner detail page (existing `app/equipment/scanners/[id]/page.tsx`) gains a new "Setup History" section that surfaces these logs — diagnostic gold when a field setup fails.

#### What gets retired

- `tools/scanner-setup/` (Node CLI) — kept in the repo for one release with a deprecation README, then removed in a follow-up PR.
- `~/Desktop/scanner-setup/setup-tc51.sh` — Andy's local Bash script. Stays as a "break-glass / advanced manual setup" tool, documented as legacy.

### Section 4 — Testing strategy

No automated test framework exists in IECentral today (verified at plan time). Verification per task:

- **Type checks:** `npx tsc --noEmit` for every TypeScript change. Must be clean.
- **Convex schema deploys:** `npx convex dev --once`. Must succeed.
- **Manual smoke on a real TC51:** the whole point of the feature; nothing replaces it. Each install step has a documented expected-output for the smoke test.
- **Browser support:** verified manually on Chrome (Mac), Chrome (Windows), Edge. Confirm "unsupported browser" UX in Safari and Firefox.
- **Failure-mode rehearsal:** disconnect the scanner mid-install, deny the WebUSB prompt, corrupt an APK locally to force a SHA mismatch, etc. Documented in the implementation plan as explicit verification scenarios.

If the team adds Vitest + a mock ADB transport later, the `WebAdbClient` is the natural seam — the wrapper can be tested in isolation. Out of scope for this PR.

### Rollout

Single PR on a feature branch (`feat/scanner-setup-wizard`). No feature flag. The new "Setup New Scanner" button just appears in the Scanner Manager for users on supported browsers. The old "Add Scanner" button stays as a manual-entry fallback. Once the new flow has been used in production for a week without issues, the old button can be removed in a follow-up PR.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `ya-webadb` is a third-party dependency you didn't audit | Library is MIT-licensed, single-author but with 1k+ GitHub stars and active maintenance; pin the major version; review the surface API we depend on |
| WebUSB experience varies subtly between Chrome versions / OSes | Documented browser/OS support matrix; the "unsupported browser" UX exists; manual smoke on Chrome Mac + Chrome Windows + Edge before shipping |
| APK download from S3 is slow on warehouse Wi-Fi | The wizard caches APKs after first download; subsequent scanners are fast. Worst case: admin does the slow download once, then bangs out 10 scanners back-to-back. |
| `dpm set-active-admin` works on TC51 today but may fail on different device models | Wizard surfaces the error and gives an "I approved manually on device" escape hatch; degrades gracefully |
| The two scanners we provisioned today (W08-842, W08-002) used the old broken Scanner Agent 1.1.0 that needs to be re-pushed via this wizard | The wizard is designed to re-install — running it on a previously-set-up scanner will overwrite with the latest APKs from S3 |
| User burns through provisioning codes if wizard crashes mid-flow | Codes are 1-hour TTL + single-use; if a code is wasted, admin just generates a fresh one — minimal cost |
| S3 CORS misconfiguration blocks the entire feature | Documented in the plan as a pre-flight step; verified in dev before shipping; if forgotten, browser error is loud and clear |
