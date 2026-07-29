# Scanner MDM Hardening — Design

**Date:** 2026-07-29
**Status:** Approved (design), pending implementation plan
**Context:** A batch of new Zebra TC51 scanners is about to be programmed. Before that
happens, the setup wizard needs to prove what it installed, the RT config needs to stop
being ambiguous, the lock PIN needs to be genuinely unchangeable by employees, and the
fleet needs a remote-view capability for troubleshooting.

Related: `docs/superpowers/specs/2026-06-03-scanner-pin-management-design.md` (the
Device-Owner PIN work this builds on).

---

## 1. Problem statement

Four asks, in the user's words:

1. "Ensure RT is working correctly and you are uploading the right files."
2. "Changing the scanner settings appropriately."
3. "Tighten it down so employees can not change the pin number at all. Pin number
   assigned and requires something special to change."
4. "Remote viewing would be helpful."

Plus one risk the batch makes urgent: the known cert-retirement bug that strands
scanners offline.

---

## 2. Findings that drive the design

These were confirmed by reading the current code, not assumed.

### 2.1 RT config has two writers and three conflicting `DEVICEID` semantics

`/sdcard/My Documents/rtlconfig.xml` is written twice during a setup run:

| Writer | `DEVICEID` value | When |
|---|---|---|
| `app/equipment/scanners/setup/steps/InstallStep.tsx:210` | `session.rtDeviceId` — IdentityStep free-text field, defaults `"0001"` | install step 6 |
| `android/.../SetupActivity.kt:403` | the location template **verbatim, no substitution** | at claim — **after** install, so it wins |
| `convex/scannerMdm.ts:763` (claim fallback, no template) | `scanner.number`, e.g. `"W08-004"` | at claim |
| `tools/scanner-setup/src/index.ts:396` | hardcoded `"0001"` | legacy CLI path |

Consequences:

- Which `DEVICEID` lands on a device depends on whether a template happens to exist for
  that location — nondeterministic from the operator's point of view.
- **`DEVICEID` does not vary per scanner** (confirmed with the user). The
  `scannerMdm.ts:763` fallback writing `scanner.number` is therefore *actively wrong*,
  not merely a tiebreak: any location without an `rtConfigXml` template has been getting
  a unique per-scanner `DEVICEID` when it should be constant.
- When a template *does* exist, `SetupActivity` writes it unsubstituted, so
  `InstallStep`'s per-device value is silently discarded.
- Both fallbacks interpolate `mdmConfig.rtLocatorUrl` with no validation. An empty
  string produces `<RTLMOBILEURL></RTLMOBILEURL>` — a broken config written and reported
  as success.

### 2.2 Nothing is verified after install

`InstallStep` treats "the shell command did not throw" as success. Nothing reads back:

- installed `versionName` for any of the three APKs
- the APK signer (the mismatch that broke RT Locator on W08-004 — a vendor-signed
  pre-existing copy vs. the debug-signed S3 copy)
- the contents of `rtlconfig.xml`
- either of the two `settings put` values
- whether the DataWedge SET_CONFIG intent took
- whether Device Owner promotion, PIN initialization, or lockdown actually landed

### 2.3 APK selection is "newest LastModified in S3 wins"

`fetch_apk.py`'s `get_latest_s3_apk(app)` returns whichever object under `apks/` is
newest. There is no pinned version, no checksum, and no per-location control. "The right
files" is currently unfalsifiable.

### 2.4 PIN enforcement is boot-only

`MqttService.maybeInitializePin()` re-asserts the stored PIN at boot. An employee's PIN
change therefore survives until the next reboot — potentially days.

Separately, the detail page's PIN modal (`app/equipment/scanners/[id]/page.tsx:1127`)
calls `updateScanner({ pin })`, writing the `scanners.pin` DB field **only**. It never
reaches the device, so the record silently desynchronizes from reality.

### 2.5 Cert retirement strands devices

`aws/scanner-mdm/lambdas/provision.py` runs `retire_thing_certs()` *before* minting the
new cert. Any run that provisions but never completes the claim leaves the device holding
a deleted cert → AWS IoT drops the TLS handshake → permanently offline until rescued by
hand over ADB. Already hit W08-001 and W08-004. A batch of new scanners multiplies the
exposure.

### 2.6 Telemetry interval is 5 minutes

`MqttService.TELEMETRY_INTERVAL_MS = 5 * 60 * 1000`. Any "live" view built on the
existing telemetry cadence would be useless without an on-demand fast mode.

---

## 3. Decisions taken

| Question | Decision |
|---|---|
| Remote view scope | Live state + on-screen **text** + agent log tail. No pixels: Android 8.1 offers a Device Owner no screenshot API, and MediaProjection requires a per-session on-device consent tap, so unattended pixel capture is not possible on this fleet without root. |
| PIN change gate | `super_admin` role + typed confirmation + reason, fully audited. |
| APK selection | Pin an approved build **per location**, verify after install. W08/R10/W09 can differ so a build can be piloted at one store. |
| Cert stranding | Fix first, before the batch. |
| PIN device enforcement | Instant revert **and** block the Settings UI. |
| Device Owner restrictions | Block factory reset, block adding accounts, block uninstalling the 3 IET apps. **Not** `DISALLOW_INSTALL_UNKNOWN_SOURCES` (the IET apps are themselves unknown-source) — log sideloads instead. |
| App allowlist lockdown | Turn ON for the whole batch. |
| RT `DEVICEID` | Constant per location, never per scanner. |

Deliberately **not** set: `DISALLOW_DEBUGGING_FEATURES`, which would lock the WebUSB
setup wizard out of the device entirely.

Judgment call flagged for veto: `DISALLOW_SAFE_BOOT` **is** included. The user grouped it
with unknown-sources when declining that option, but it is independent — it prevents
booting to safe mode to evade the agent, with no effect on sideloading.

---

## 4. Architecture

Nine units. Each is independently testable and has one job.

### Unit 1 — `lib/scannerRtConfig.ts`: one RT config builder

A pure module, the single source of truth for RT config generation.

```ts
buildRtConfig(input: {
  locationCode: string;
  rtLocatorUrl: string;
  rtDeviceId: string;
  template?: string;
}): { xml: string; values: RtConfigValues; problems: string[] }
```

Behaviour:

- Always substitutes `DEVICEID`, `RTLMOBILEURL`, and `ORIENTATION` into the template.
  Templates never pass through verbatim again — this kills the `SetupActivity` overwrite
  problem at the source.
- Validates and reports `problems[]`: XML well-formed, required tags present,
  `RTLMOBILEURL` non-empty and parseable as an `http(s)` URL whose host matches the
  location's configured RT host, `DEVICEID` non-empty and equal to the location's
  configured value.
- Non-empty `problems` is a **hard fail** at every call site. No more silently writing a
  broken config.

Consumers (all four converge here): `InstallStep`, `claimProvisionCode`,
`tools/scanner-setup`, and a new live preview/validator on the Scanner Settings page.

Because the wizard and the agent now produce byte-identical XML, the double write becomes
harmless idempotency instead of last-write-wins.

**Schema:** `scannerMdmConfigs` gains `rtDeviceId: v.optional(v.string())` — one constant
per location. No `rtDeviceIdMode` flag: a per-location field already covers both "same at
every store" and "different per store".

**Removals:**

- The RT Device ID input comes out of `IdentityStep.tsx`; `session.rtDeviceId` and the
  `setIdentity()` parameter are dropped from `useSetupSession.ts`.
- The `scanner.number` fallback at `convex/scannerMdm.ts:763` is **deleted**. No template
  and no configured `rtDeviceId` becomes a hard error, not a guess.

**Invariant this creates:** every scanner at a store must read back the *same*
`DEVICEID`, matching the location config. Unit 3 asserts it flatly.

**Migration note:** scanners previously set up through the no-template path carry
`W08-###`-style `DEVICEID`s today. Unit 3's "Re-audit over USB" flags them, and
`push_config` corrects them remotely without a wizard run.

### Unit 2 — Per-location version pinning

**Schema:** `scannerMdmConfigs.pinnedBuilds: v.optional(v.object({ tireTrack, rtLocator,
scannerAgent }))`, each `{ version: string, sha256: string }`.

- `fetch_apk.py` gains version-specific resolution (`apks/{app}-{version}.apk`) beside
  the existing newest-wins path, which stays as the fallback when nothing is pinned.
- Scanner Settings grows an **Available builds** panel listing S3 objects per app with a
  **Pin** button. Pinning records version + sha256 (computed once, server side, via a new
  Convex action against S3).
- The wizard hashes each downloaded APK in-browser and refuses to install on mismatch.

### Unit 3 — Verification pass

`lib/scannerVerify.ts` holds pure parsers (`dumpsys` / `settings` / `pm` output →
observed values). A wizard stage runs the pass before Done; it is also re-runnable from
the Verify step and from the detail page as **Re-audit over USB**.

Checks, each recording expected vs. **actually observed**:

- all three packages present; `versionName` equals the pinned version
- **APK signer digest** matches the expected signer. The expected value is recorded per
  app in `pinnedBuilds` alongside `sha256` at pin time (read from the S3 object, so it is
  derived from the approved artifact rather than hardcoded). The fleet is debug-signed
  today — `CN=Android Debug`, matching `~/.android/debug.keystore` — so this check
  catches a vendor-signed or otherwise foreign pre-existing copy, which is the failure
  that broke RT Locator on W08-004.
- `rtlconfig.xml` read back off the device and byte-compared to the intended XML; parsed
  `DEVICEID` / `RTLMOBILEURL` surfaced for operator confirmation
- `screen_off_timeout` and `accelerometer_rotation` read back against policy
- Device Owner confirmed; user restrictions confirmed; uninstall-blocked confirmed
- accessibility service present in `enabled_accessibility_services`
- runtime permissions granted
- lockdown: recount disabled packages **and** assert every essential package is still
  enabled
- a lock PIN is set (value itself comes from telemetry, not ADB)

**DataWedge is explicitly marked "unverified — scan test required."** SET_CONFIG's result
is not readable over ADB and the wizard cannot emit a barcode, so this becomes a recorded
technician checkbox ("scanned into a text field, Tab advanced") rather than an assumed
pass. This is the one check that is not automated, and it is labelled as such rather than
faked.

**New table `scannerVerifications`:**

```ts
{
  scannerId: v.id("scanners"),
  at: v.number(),
  by: v.optional(v.id("users")),
  source: v.string(),        // "wizard" | "manual"
  passed: v.boolean(),
  checks: v.array(v.object({
    key: v.string(),
    label: v.string(),
    expected: v.optional(v.string()),
    observed: v.optional(v.string()),
    status: v.string(),      // "pass" | "fail" | "warn" | "unverified"
  })),
}
```

Indexed `by_scanner`. **The wizard cannot reach Done with a failing hard check**; `warn`
and `unverified` do not block. The fleet page gains an audit column; the detail page
shows a red banner on failure.

### Unit 4 — PIN lockdown, device side

`DeviceAdminReceiver.onPasswordChanged()` → re-assert the stored system PIN immediately.
An employee's change is undone in roughly a second instead of surviving until reboot.

Guards, both necessary:

- a 5s `expectSelfChange` flag so `PinManager.setPin()` does not retrigger itself
- a revert rate limit of 5 per minute, after which the agent stops reverting and reports
  `pinRevertThrottled` in telemetry — so no pathological loop can drain the battery, and
  the condition is visible rather than silent

`maybeInitializePin()`'s boot re-assert stays as the backstop. Telemetry gains
`pinRevertCount` and `pinLastRevertedAt`, surfaced on the detail page — unauthorized
change attempts become visible rather than invisible.

`device_admin_policies.xml` already declares `<limit-password/>` and `<reset-password/>`,
so no manifest change is required. Note the existing hazard: an in-place APK update does
not refresh an already-active admin's cached policy set, so all `dpm` calls stay wrapped
in try/catch (the crash-loop lesson from agent 1.1.1).

### Unit 5 — PIN Settings UI block

The accessibility service from Unit 7 watches `WINDOW_STATE_CHANGED` for
`com.android.settings/.password.ChooseLock*`; on match it returns to HOME and toasts
"PIN is managed by IE Central." Gated by a new `scannerLockPolicy.blockPinSettingsUi`
boolean so it can be switched off without a rebuild.

### Unit 6 — PIN change gate, web side

- Reset PIN and a new **Set specific PIN** both require `super_admin`, enforced with the
  existing `requireRole(ctx, id, ["super_admin"])` in Convex **and** in the
  `/api/scanner-mdm/command` route — not merely hidden in the UI.
- Confirmation requires typing the scanner number plus a reason; both are written to
  `scannerCommandLog`.
- The DB-only PIN modal is **deleted**. Its replacement sends a real device command:
  `update_pin` gains an optional `payload.pin` (today `MqttService.updatePin()` ignores
  payload and always generates).
- `scanners.pin` becomes display-only — "reported by device at &lt;time&gt;" — with a
  mismatch badge when the last commanded PIN differs from the reported one.

### Unit 7 — Remote view

**Agent:** new `ScreenReaderService : AccessibilityService`, auto-enabled at setup via
`settings put secure enabled_accessibility_services` + `accessibility_enabled 1`, and
permitted via `dpm.setPermittedAccessibilityServices`. It maintains a debounced snapshot:

- foreground package / activity / window title
- visible text nodes, capped (~100 nodes / 4KB), **skipping any node flagged
  `isPassword`**
- a 200-line ring buffer of the agent's own log lines (system logcat needs `READ_LOGS`,
  which is not available)

**Transport — no new AWS wiring.** Telemetry (IoT rule `scanner_telemetry_to_lambda` →
`status.py` → Convex webhook) is the only path already bridged, so the snapshot rides it.
A `get_screen` command flips the agent into fast-publish mode (~3s) for two minutes and
includes `screen` in the payload; the default 5-minute cadence is untouched. `status.py`
forwards the new fields.

**Web:** a **Live view** panel on the detail page — foreground app, screen on/off/locked,
on-screen text, agent log tail, auto-refreshing from Convex. Stop ends fast mode.
Sessions are logged to `scannerCommandLog`.

**Storage:** latest snapshot on the scanner doc as `lastScreen: { at, package, activity,
title, text, logTail }`. No history table — YAGNI.

IoT's 128KB message limit is comfortable given the caps.

### Unit 8 — Device Owner restrictions + sideload logging

`applyPolicies()` in the agent, run on every boot and via a new `apply_policies` command:

- `DISALLOW_FACTORY_RESET`, `DISALLOW_ADD_ACCOUNT`, `DISALLOW_SAFE_BOOT`
- `setUninstallBlocked(true)` on all three IET packages

Sideload logging replaces the declined unknown-sources restriction: a `PACKAGE_ADDED` /
`PACKAGE_REMOVED` receiver reports `{ package, versionName, installerPackage }` through
telemetry into a new table:

```ts
scannerAppEvents: {
  scannerId: v.id("scanners"),
  at: v.number(),
  event: v.string(),          // "added" | "removed"
  packageName: v.string(),
  versionName: v.optional(v.string()),
  installerPackage: v.optional(v.string()),
  approved: v.boolean(),      // in the expected set?
}
```

Indexed `by_scanner`. Anything outside the approved set surfaces on the detail page and
in `getScannersNeedingAttention`.

All restrictions are read back in Unit 3's pass.

### Unit 9 — Cert stranding fix + batch ergonomics

**Cert fix.** `provision.py` stops retiring certs at provision time. Retirement moves to
**first successful telemetry after claim** — the device is provably connected on the new
cert before any old cert dies, so an abandoned wizard run can never strand a scanner.
Implementation: claim sets `pendingCertRetirement` on the scanner doc;
`updateScannerTelemetry` sees it, schedules an action that calls a `retire` branch on the
provision Lambda (which already holds the needed IoT permissions), and clears the flag.

**Batch ergonomics**, for programming several scanners in a sitting:

- `scannerLockPolicy.lockdownEnabled` → ON.
- A **Program next scanner** button on Done that resets to Detect while keeping location
  and policy — plug, few clicks, unplug.
- A **Check now** / **Finish** escape on the Verify step, for the known
  `getScannerDetail` auto-advance hiccup.

---

## 5. Data flow

**Setup (wizard, over WebUSB/ADB):**

```
Detect → Location → Identity → Generate → Install → Verify(pass) → Done
                                              │
                    pinnedBuilds → exact S3 object → sha256 check → pm install
                    buildRtConfig(location) → validate → push rtlconfig.xml
                    settings put / Device Admin / Device Owner / restrictions
                    accessibility service enable / DataWedge / lockdown
                                              │
                                    scannerVerifications ← readback of everything
```

**Runtime (agent → cloud):**

```
agent telemetry (5 min, or ~3s in fast mode)
  → IoT rule scanner_telemetry_to_lambda → status.py → Convex /scanner-telemetry
  → updateScannerTelemetry → scanners doc + scannerAppEvents + lastScreen
  → first telemetry after claim also triggers cert retirement
```

**Commands (cloud → agent):**

```
UI → /api/scanner-mdm/command (role gate) → API GW → command.py
  → iot_data.publish cmd/scanners/{thing}/{command}
  → MqttService.handleCommand → ack
```

New commands: `get_screen`, `apply_policies`. `update_pin` extended with `payload.pin`.

---

## 6. Error handling

- **RT config problems** — hard fail with the specific problem listed, at every call
  site. Never write a partially-valid config.
- **Checksum mismatch** — abort before `pm install`; report expected vs. actual.
- **Signature mismatch on install** — the existing uninstall-and-reinstall recovery stays
  (it fixed W08-004); the verification pass then confirms the result.
- **`dpm` / restriction failures** — logged, never fatal to the foreground service. This
  is the crash-loop lesson from agent 1.1.1: an uncaught `SecurityException` in
  `onCreate` crash-loops the agent under `START_STICKY` + `BootReceiver`.
- **PIN revert loop** — rate-limited and self-change-flagged (Unit 4).
- **Accessibility service absent or disabled** — Live view reports "screen reader not
  enabled" rather than hanging; the verification pass flags it.
- **Verification hard-fail** — the wizard blocks Done and shows which checks failed with
  observed values, so the scanner is not handed out.

---

## 7. Testing

**Pure units (vitest, already wired as `npm test`; precedent in
`lib/dealerRebates/*.test.ts`):**

- `buildRtConfig`: valid template, missing/empty URL, host mismatch, DEVICEID
  substitution, malformed XML, absent template + absent `rtDeviceId` → hard fail.
- `lib/scannerVerify.ts` parsers: fed captured real `dumpsys` / `settings` / `pm` output.

**Device validation on W08-001** (the existing account-free Device Owner test unit):

- change the PIN in Settings → confirm revert within seconds, no loop, revert counter
  increments
- confirm the Settings screen-lock UI is bounced
- confirm restrictions applied and uninstall-blocked
- exercise Live view: foreground app, on-screen text, log tail, fast mode expiry
- walk the lockdown: home, keyboard, Settings, all three IET apps, DataWedge

**First scanner of the batch** is the full end-to-end gate: fresh wizard run on an
account-free device, auto-promotion to Device Owner, verification pass green, DataWedge
scan test, then the rest of the batch.

**Cert fix:** deliberately abandon a wizard run mid-claim and confirm the device stays
online on its existing cert.

---

## 8. Implementation order

Nine units is more than one sitting, and the batch is waiting. The plan should stage them
so the batch is unblocked as early as possible, with each stage independently shippable:

**Stage A — unblock the batch (Unit 9's cert fix).** Smallest change, highest risk
averted. Ship and verify before any new scanner is programmed.

**Stage B — right files, right config, proven (Units 1, 2, 3).** The core of the user's
first two asks. Unit 1 is a prerequisite for Unit 3's RT check, and Unit 2 is a
prerequisite for Unit 3's version/signer checks, so these land together.

**Stage C — PIN lockdown (Units 4, 6, then 5).** Units 4 and 6 are the substance; Unit 5
depends on the accessibility service and so lands with or after Stage D.

**Stage D — remote view and restrictions (Units 7, 8).** Unit 7 introduces the
accessibility service that Unit 5 needs; Unit 8 rides the same telemetry additions.

Batch ergonomics (the rest of Unit 9) can land with any stage — they are independent and
small. Lockdown ON is a policy flip, gated only on Stage B's verification pass existing so
a bad lockdown is caught rather than shipped.

## 9. Out of scope

- True pixel streaming / unattended screenshots — not possible on Android 8.1 for a
  Device Owner without root.
- Rescuing already-locked-out scanners with unknown PINs — still requires a factory reset
  (they cannot reach Settings to remove the account).
- `ctx.auth` migration. These handlers keep the existing `requestingUserId` pattern and
  the `authGuards` helpers, consistent with the rest of the codebase.
- Retiring `tools/scanner-setup` (the legacy CLI). It is updated to use `buildRtConfig`
  so it cannot write a conflicting config, but it is not removed.
