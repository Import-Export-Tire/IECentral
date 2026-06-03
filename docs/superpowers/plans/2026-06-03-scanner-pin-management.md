# Scanner PIN Management (Device-Owner) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** System-generated scanner lock PINs that users can't choose, are hard to change, and can be reset remotely to a known value — ending the "unknown PIN" problem.

**Architecture:** Promote the agent to Device Owner (no-wipe path, validated on W08-001). A new `PinManager` in the agent registers a reset-password token and sets/reset the PIN via `resetPasswordWithToken`; a `reset_pin` MQTT command drives remote resets. The wizard gains a Device-Owner promotion step. Convex stores the authoritative PIN + owner/managed flags and exposes a `requestPinReset` mutation; the manager UI shows status and a Reset-PIN button.

**Tech Stack:** Kotlin (Android agent, DevicePolicyManager API 26+), Next.js/React (wizard + manager), Convex (mutations/schema), WebUSB ADB (`@yume-chan/adb`), AWS S3 (APK distribution).

**Test device:** W08-001 (serial 19058522500842) — already Device Owner, account-free, running agent 1.1.1 (no PIN logic). Validate every agent task here before fleet use.

**Note on TDD:** The agent's `DevicePolicyManager` calls can't be unit-tested off-device; those tasks use **implement → install on W08-001 → verify via logcat/behavior** as the test. TS/Convex tasks use normal assertions where practical.

---

### Task 1: Agent — `PinManager` (token + generate + set/reset)

**Files:**
- Create: `android/scanner-agent/app/src/main/java/com/ietires/scanneragent/PinManager.kt`
- Modify: `android/scanner-agent/app/src/main/java/com/ietires/scanneragent/MqttService.kt`

- [ ] **Step 1: Create PinManager.kt**

```kotlin
package com.ietires.scanneragent

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.util.Base64
import android.util.Log
import java.security.SecureRandom

/** Owns the device lock PIN for Device-Owner scanners: token registration,
 *  system PIN generation, and resets. No-ops (logged) if not Device Owner. */
class PinManager(private val ctx: Context) {
    private val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(ctx, DeviceAdminReceiver::class.java)
    private val prefs = ctx.getSharedPreferences("pin_mgr", Context.MODE_PRIVATE)

    fun isManaged(): Boolean = dpm.isDeviceOwnerApp(ctx.packageName)

    private fun loadToken(): ByteArray? =
        prefs.getString("token", null)?.let { Base64.decode(it, Base64.NO_WRAP) }

    /** Ensure a reset token is registered + active. Returns true if active. */
    fun ensureToken(): Boolean {
        if (!isManaged()) return false
        var token = loadToken()
        if (token == null) {
            token = ByteArray(32).also { SecureRandom().nextBytes(it) }
            if (!dpm.setResetPasswordToken(admin, token)) {
                Log.w(MqttService.TAG, "setResetPasswordToken failed"); return false
            }
            prefs.edit().putString("token", Base64.encodeToString(token, Base64.NO_WRAP)).apply()
        }
        val active = dpm.isResetPasswordTokenActive(admin)
        if (!active) Log.w(MqttService.TAG, "Reset token not active (needs current-PIN confirm)")
        return active
    }

    fun generatePin(len: Int = 6): String {
        val r = SecureRandom(); val sb = StringBuilder()
        repeat(len) { sb.append(r.nextInt(10)) }
        return sb.toString()
    }

    /** Set the lock PIN via the token. Returns the new PIN on success, null otherwise. */
    fun setPin(pin: String): String? {
        if (!ensureToken()) return null
        val ok = dpm.resetPasswordWithToken(admin, pin, loadToken(), 0)
        if (!ok) { Log.e(MqttService.TAG, "resetPasswordWithToken failed"); return null }
        dpm.setPasswordQuality(admin, DevicePolicyManager.PASSWORD_QUALITY_NUMERIC)
        Log.i(MqttService.TAG, "Lock PIN set by system")
        return pin
    }
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd android/scanner-agent && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleDebug -q`
Expected: BUILD SUCCESSFUL, `app/build/outputs/apk/debug/app-debug.apk` produced.

- [ ] **Step 3: Commit**

```bash
git add android/scanner-agent/app/src/main/java/com/ietires/scanneragent/PinManager.kt
git commit -m "feat(agent): PinManager — reset token + system PIN set/reset"
```

---

### Task 2: Agent — `reset_pin` command + report PIN/owner to backend

**Files:**
- Modify: `MqttService.kt` (handleCommand, telemetry, a report helper)

- [ ] **Step 1: Add `reset_pin` to `handleCommand`'s `when`**

```kotlin
"reset_pin" -> resetPin()
```

- [ ] **Step 2: Add resetPin() + report helpers to MqttService**

```kotlin
private val pinManager by lazy { PinManager(this) }

private fun resetPin() {
    val pin = pinManager.generatePin()
    val applied = pinManager.setPin(pin)
    val body = JSONObject()
        .put("scanner", thingName)
        .put("pinManaged", applied != null)
        .put("pin", applied ?: JSONObject.NULL)
    // Report new PIN to backend over the dedicated MQTT topic the backend ingests.
    try {
        mqttClient?.publish("dt/scanners/$thingName/pin",
            MqttMessage(body.toString().toByteArray()).apply { qos = 1 })
    } catch (e: Exception) { Log.e(TAG, "pin report failed: ${e.message}") }
}
```

- [ ] **Step 3: Add deviceOwner/pinManaged to telemetry JSON** (in `publishTelemetry`'s `telemetry` object):

```kotlin
put("deviceOwner", pinManager.isManaged())
put("pinManaged", pinManager.isManaged() && getSharedPreferences("pin_mgr", MODE_PRIVATE).contains("token"))
```

- [ ] **Step 4: Build (Task 1 Step 2 command). Expected: BUILD SUCCESSFUL.**

- [ ] **Step 5: Commit** — `feat(agent): reset_pin command + report owner/pin status`

---

### Task 3: Backend ingest of the PIN report

**Files:**
- Modify: `convex/schema.ts` (scanners: `deviceOwner`, `pinManaged` optional booleans)
- Modify: `convex/scannerMdm.ts` (`updateScannerTelemetry` accepts the two booleans; new `reportPin` internalMutation; `getScannerDetail` returns them)
- Modify: `convex/http.ts` (route the MQTT-bridged `pin` report → `reportPin`) **only if** telemetry bridge is HTTP; if telemetry arrives via the existing IoT→Convex path, extend that ingest instead. Confirm the existing telemetry ingestion path first and follow it.

- [ ] **Step 1: schema** — add to `scanners`:

```ts
deviceOwner: v.optional(v.boolean()),
pinManaged: v.optional(v.boolean()),
```

- [ ] **Step 2:** extend `updateScannerTelemetry` args + writes with `deviceOwner`, `pinManaged` (mirror existing optional-field pattern at scannerMdm.ts:222-231).

- [ ] **Step 3:** add `reportPin` internalMutation:

```ts
export const reportPin = internalMutation({
  args: { iotThingName: v.string(), pin: v.optional(v.string()), pinManaged: v.boolean() },
  handler: async (ctx, args) => {
    const s = await ctx.db.query("scanners")
      .withIndex("by_iot_thing", q => q.eq("iotThingName", args.iotThingName)).first();
    if (!s) return { success: false };
    const patch: Record<string, unknown> = { pinManaged: args.pinManaged, updatedAt: Date.now() };
    if (args.pin) patch.pin = args.pin;
    await ctx.db.patch(s._id, patch);
    return { success: true };
  },
});
```

- [ ] **Step 4:** `npx convex codegen` then typecheck: `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 5: Commit** — `feat(scannerMdm): ingest deviceOwner/pinManaged + reportPin`

---

### Task 4: Backend — `requestPinReset` mutation (manager → device)

**Files:** Modify `convex/scannerMdm.ts`

- [ ] **Step 1:** Find the existing command-send path. The manager logs commands via `logScannerCommand`; confirm how a logged command is delivered to the device (IoT topic `cmd/scanners/{thing}/#`). Add `requestPinReset`:

```ts
export const requestPinReset = mutation({
  args: { scannerId: v.id("scanners"), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.scannerId);
    if (!s) throw new Error("Scanner not found");
    if (!s.deviceOwner) throw new Error("Scanner is not Device Owner — PIN reset unavailable");
    // Reuse the same command pipeline as install_apk/lock (publish cmd to the device).
    // Mirror whatever logScannerCommand + the IoT publisher do for other commands,
    // with command="reset_pin", no payload.
    // <implement using the confirmed existing publisher>
    return { success: true };
  },
});
```

> Implementer: wire this to the **same** mechanism existing commands use (do not invent a second path). If commands are delivered by an action publishing to IoT, call it; if the device polls a queue table, insert there.

- [ ] **Step 2:** typecheck. **Step 3: Commit** — `feat(scannerMdm): requestPinReset command`

---

### Task 5: Wizard — WebAdbClient Device-Owner helpers

**Files:** Modify `app/equipment/scanners/setup/WebAdbClient.ts`

- [ ] **Step 1:** Add helpers:

```ts
async listAccounts(): Promise<string[]> {
  const out = await this.shell("dumpsys account");
  return [...out.matchAll(/Account \{name=([^,]+), type=([^}]+)\}/g)].map(m => `${m[1]} (${m[2]})`);
}
async isDeviceOwner(pkg = "com.ietires.scanneragent"): Promise<boolean> {
  const out = await this.shell("dumpsys device_policy");
  return /Device Owner:[\s\S]*?package=" + pkg/.test(out) || new RegExp(`Device Owner:[\\s\\S]*?${pkg}`).test(out);
}
async setDeviceOwner(component = "com.ietires.scanneragent/.DeviceAdminReceiver"): Promise<void> {
  const out = await this.shell(`dpm set-device-owner ${component} 2>&1`);
  if (!/Success/.test(out)) throw new Error(`set-device-owner failed: ${out.trim()}`);
}
async openAccountsSettings(): Promise<void> {
  await this.shell("am start -a android.settings.SYNC_SETTINGS");
}
```

- [ ] **Step 2:** `npx tsc --noEmit`. **Step 3: Commit** — `feat(scanner-setup): WebAdbClient device-owner helpers`

---

### Task 6: Wizard — Device-Owner promotion step + PIN at setup

**Files:**
- Modify: `app/equipment/scanners/setup/steps/InstallStep.tsx` (after `deviceAdmin` step, before `launchSetupActivity`)
- Modify: `app/equipment/scanners/setup/useSetupSession.ts` (track `deviceOwner` boolean + an "awaiting account removal" sub-state)

- [ ] **Step 1:** In InstallStep, add a `makeDeviceOwner` step:

```ts
await runStep("deviceOwner", "Promoting to Device Owner", async () => {
  if (await client.isDeviceOwner()) { actions.setDeviceOwner(true); return; }
  const accounts = await client.listAccounts();
  if (accounts.length > 0) {
    await client.openAccountsSettings();
    throw new Error(
      `Remove the account(s) on the scanner first (Settings → Accounts: ${accounts.join(", ")}), then re-run setup.`);
  }
  await client.setDeviceOwner();
  actions.setDeviceOwner(true);
});
```

- [ ] **Step 2:** After device-owner success, the agent's SetupActivity (next launch) will set the PIN (Task 7). No PIN logic in the wizard itself.
- [ ] **Step 3:** Add `deviceOwner` to session state + `setDeviceOwner` action (mirror existing reducer fields).
- [ ] **Step 4:** `npx tsc --noEmit`. **Step 5: Commit** — `feat(scanner-setup): device-owner promotion step`

---

### Task 7: Agent — set system PIN during SetupActivity

**Files:** Modify `SetupActivity.kt` (`continueWithAppInstalls`, after starting MqttService) and/or `MqttService.onCreate`.

- [ ] **Step 1:** When the agent starts and is Device Owner but has no token yet, set a system PIN:

```kotlin
// in MqttService.onCreate after startForeground, Device-Owner only, once:
if (pinManager.isManaged() && !getSharedPreferences("pin_mgr", MODE_PRIVATE).contains("token")) {
    val pin = pinManager.generatePin()
    val applied = pinManager.setPin(pin)
    // report via the same dt/.../pin topic after MQTT connects (queue if not yet connected)
}
```

> Implementer: ensure the PIN report is sent after the MQTT connection is up (defer until `connectComplete` if needed). Guard so it runs once.

- [ ] **Step 2:** Build. **Step 3:** Verify on W08-001 (Task 9). **Step 4: Commit** — `feat(agent): set system PIN at setup`

---

### Task 8: Manager UI — owner badge, PIN, Reset button

**Files:** Modify `app/equipment/scanners/[id]/page.tsx`

- [ ] **Step 1:** Show a **Device Owner** badge (from `scanner.deviceOwner`) and **PIN managed** badge.
- [ ] **Step 2:** Add a **Reset PIN** button → `useMutation(api.scannerMdm.requestPinReset)({ scannerId, requestingUserId: user._id })`; disable + tooltip when `!scanner.deviceOwner`.
- [ ] **Step 3:** Show current `scanner.pin`; note it updates after the device reports back.
- [ ] **Step 4:** `npx tsc --noEmit`. **Step 5: Commit** — `feat(manager): scanner PIN reset + device-owner badges`

---

### Task 9: Investigate + implement "block PIN change" lever on W08-001

**Files:** Modify `PinManager.kt` (add `lockDownPinChanges()`)

- [ ] **Step 1:** On W08-001 (Device Owner), test which lever actually prevents on-device PIN change on Zebra 8.1, in order of preference:
  1. `dpm.addUserRestriction(admin, "no_config_credentials"/"no_safe_boot")` and related — check what sticks.
  2. Disable the Settings security activity entry, or
  3. Accept "always-resettable" as the guarantee (token) + enforce quality.
- [ ] **Step 2:** Implement the best working lever in `lockDownPinChanges()` (called after `setPin`). If none truly blocks change, document that the guarantee is "always-resettable" and ship that.
- [ ] **Step 3:** Build + verify on W08-001. **Step 4: Commit** — `feat(agent): lock down on-device PIN changes (best available)`

---

### Task 10: Rebuild, version bump, deploy agent to S3

**Files:** Modify `android/scanner-agent/app/build.gradle` (versionCode 3→4, versionName 1.1.1→1.2.0)

- [ ] **Step 1:** Bump version. Build release-equivalent debug APK (Task 1 Step 2 command).
- [ ] **Step 2:** Install on W08-001: `adb install -r app/build/outputs/apk/debug/app-debug.apk`. Verify agent connects + sets PIN + `reset_pin` from manager works end-to-end (PIN on device changes; manager shows new PIN).
- [ ] **Step 3:** Upload to S3 (needs AWS creds, gated): `aws s3 cp app-debug.apk s3://ietires-scanner-assets/apks/scanner-agent-1.2.0.apk --content-type application/vnd.android.package-archive --metadata sha256=<sha>,version=1.2.0`. (Newest-by-date wins → served to all setups.)
- [ ] **Step 4: Commit** — `chore(agent): v1.2.0 — PIN management`

---

### Task 11: End-to-end validation + rollout doc

- [ ] **Step 1:** Fresh wizard run on an account-free scanner → auto device-owner + system PIN set + visible in manager.
- [ ] **Step 2:** Wizard run on an account-present scanner → correct "remove account" prompt, then promote.
- [ ] **Step 3:** `reset_pin` from manager on W08-001 → device PIN changes, new PIN reported.
- [ ] **Step 4:** Non-device-owner scanner → no crashes, PIN controls disabled with explanation.
- [ ] **Step 5:** Write a short ops runbook (in the spec dir) for the 3 rollout cases (account-free / known-PIN / locked-out→reset).

---

## Self-review notes

- **Spec coverage:** PIN generation (T1,T7), no user choice (T7), reset token (T1), remote reset (T2,T4,T8), wizard device-owner (T5,T6), manager UI (T8), block-change (T9, honest fallback), rollout (T11), remote update path reuses existing `install_apk` (noted; no new task needed). Covered.
- **Open risk carried from spec:** T9 (block-change lever) and token activation with an existing PIN are explicitly test-on-W08-001 tasks, not assumed.
- **Type consistency:** `deviceOwner`/`pinManaged` booleans flow schema → telemetry → getScannerDetail → UI; `reset_pin`/`requestPinReset` names fixed across agent + convex + UI.
- **Backend command path:** T4 deliberately defers to the *existing* command-delivery mechanism rather than inventing one — implementer must confirm it first.
