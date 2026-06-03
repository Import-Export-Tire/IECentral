# Scanner PIN Management (Device-Owner) — Design Spec

**Date:** 2026-06-03
**Status:** Draft for review
**Owner:** Andy
**Component:** Scanner MDM (Android agent `com.ietires.scanneragent`, setup wizard, Convex `scannerMdm`, manager UI)

## Goal

Make scanner lock-screen PINs **system-controlled**:

1. PINs are **system-generated only** — no human (operator or admin) chooses them.
2. PINs **cannot be casually changed** on the device.
3. The system can **always reset a scanner's PIN to a known value remotely** — so a lost/changed PIN never locks us out again.

This fixes today's pain: a pile of scanners whose PINs were changed on-device and never recorded, leaving them unrecoverable.

## Root constraint (validated 2026-06-03 on W08-001)

Everything here requires the agent to be **Device Owner**, not just Device Admin. As a plain Device Admin on Android 8.1, the OS forbids resetting or clearing an existing PIN — which is exactly why the current fleet is unrecoverable.

**Proven no-wipe promotion path** (tested live on W08-001, serial 19058522500842):
- TC51 is **not rooted**; `dpm set-device-owner` fails while any account exists ("there are already some accounts on the device"). The `device_provisioned=1` flag was **not** a blocker.
- `pm clear com.google.android.gms`/`gsf` does **not** remove the account (record is in a root-only DB).
- Removing the Google account via **Settings → Accounts** (one manual, non-root step) → then `dpm set-device-owner …/.DeviceAdminReceiver` → **Success. Device Owner set.** No factory reset.

So Device Owner is reachable in-place on accessible devices; the only manual step is account removal in Settings.

## Hard limits to be honest about

- **No true "freeze the PIN" API exists**, even for Device Owner. We deliver: system-set PIN the user can't choose + always-resettable via token + security-settings access disabled/hidden (deterrence). That meets the real requirement (never locked out; can't pick their own PIN) but is not a kernel guarantee.
- **`resetPasswordWithToken` needs an *activated* token.** A reset token activates immediately only when set while there is **no password, or the current password is entered once**. Implication by scanner state:
  - **New / currently-unlocked scanners (PIN known or none):** agent sets token + system PIN cleanly at provisioning → controlled forever after. ✅
  - **In-use scanners whose PIN the operator still knows (admin doesn't):** during promotion the operator enters the current PIN once to activate the token, then we reset to the system PIN. ✅
  - **Truly locked-out scanners (nobody knows the PIN):** can't reach Settings to remove the account or activate a token → **one-time factory reset required**, after which they provision as Device Owner and are managed forever. ❌ in-place.
- **Account-free is mandatory** for Device Owner via ADB (confirmed). Andy confirmed scanners can run account-free.

## Architecture

### A. Android agent (`com.ietires.scanneragent`) — new code

All gated on `dpm.isDeviceOwnerApp(packageName)`; if not owner, these are no-ops (logged), preserving current behavior.

1. **PIN generation + apply at setup** (Device Owner only):
   - Generate a random N-digit PIN (length from policy, default 6).
   - `setResetPasswordToken(admin, token)` with a locally generated 32-byte token; persist the token bytes in the agent's private storage so future resets work.
   - Set the lock screen: `resetPasswordWithToken(admin, pin, token, 0)`.
   - Report the PIN + "deviceOwner=true" + "pinManaged=true" to Convex (via the existing claim/telemetry channel or a dedicated mutation).
2. **`reset_pin` MQTT command** (added to `handleCommand`): regenerate PIN → `resetPasswordWithToken` → report new PIN to Convex + ack.
3. **Lock down PIN changes** (Device Owner): keep `setPasswordQuality(NUMERIC)` + min length; additionally disable the lock-screen settings entry where possible (`setPasswordQuality` + hide Security settings via `DevicePolicyManager.setPermitted... ` / lock-task allowlist, or `pm disable` of the relevant settings activity as a fallback). Exact lever finalized in the plan after testing on W08-001.
4. **Report Device-Owner status** in telemetry so the manager can badge it.

### B. Setup wizard (`app/equipment/scanners/setup`)

- After `setActiveAdmin`, add a **"Make Device Owner"** step:
  - Check accounts (`dumpsys account` via the WebADB shell). If none → `dpm set-device-owner …`.
  - If an account exists → show an instruction to remove it (open Accounts settings on device), wait, re-check, then promote.
- Surface device-owner result in the wizard; if promotion fails, the scanner still works (admin-only) but PIN management is unavailable — shown clearly.
- The agent's setup path then generates/sets the PIN (section A).

### C. Convex (`convex/scannerMdm.ts`, schema)

- Store the authoritative system PIN on the scanner record (already a `pin` field) — written only by the agent/wizard, never user-editable for managed scanners.
- Add `deviceOwner: boolean` and `pinManaged: boolean` to the scanner record (telemetry-updated).
- Add a `requestPinReset(scannerId)` mutation that enqueues a `reset_pin` command to the device (reuse the existing command/MQTT plumbing).
- The agent reports the new PIN back; the record updates.

### D. Manager UI

- Scanner detail: **Device-Owner badge**, **PIN-managed badge**, current system PIN, and a **"Reset PIN"** button (calls `requestPinReset`, shows the new PIN when the device reports back).
- For non-device-owner scanners: show "PIN not managed — promote to Device Owner" with a short how-to.

## Fleet rollout (one-time per existing scanner)

| Scanner state | Procedure |
|---|---|
| New / account-free | Wizard promotes to Device Owner automatically → PIN managed. |
| In use, PIN known to operator | Remove Google account (Settings) → wizard promotes → operator enters current PIN once to activate token → reset to system PIN. |
| Locked out, PIN unknown to all | **Factory reset** (recovery), then provision as Device Owner. Managed thereafter. |

## Testing plan

- Verify on **W08-001** (already Device Owner as of this session): register token + set/reset PIN end to end; confirm `reset_pin` from the manager changes the device PIN and reports back; confirm security-settings lockdown behavior.
- Verify a fresh wizard run on an account-free device promotes + sets PIN automatically.
- Verify the "account present" wizard branch prompts correctly.
- Confirm non-device-owner scanners degrade gracefully (no crashes; PIN management hidden).

## Risks / open items

- Exact mechanism to disable on-device PIN changes on Zebra 8.1 (test on W08-001 before finalizing).
- Token-activation behavior when a password already exists (operator-enters-once flow) — verify on a device with a known PIN.
- W08-001 is currently Device Owner with **no Google account** and the **old agent (1.1.1, no PIN logic)** — it's the test unit; treat accordingly.
- Agent rebuild + S3 redeploy required (debug-signed, `apks/scanner-agent-X.Y.Z.apk`, newest wins) — same pipeline as the 1.1.1 fix.

## Out of scope (for now)

- Managed Google Play / app account provisioning (scanners run account-free).
- Zero-touch / StageNow re-imaging of the whole fleet (only the locked-out subset needs factory reset).
