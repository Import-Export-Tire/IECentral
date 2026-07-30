package com.ietires.scanneragent

import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.util.Base64
import android.util.Log
import java.security.SecureRandom

/** Owns the device lock PIN for Device-Owner scanners: token registration,
 *  system PIN generation, and resets. No-ops (logged) if not Device Owner. */
class PinManager(private val ctx: Context) {
    private val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(ctx, DeviceAdminReceiver::class.java)
    private val prefs = ctx.getSharedPreferences("pin_mgr", Context.MODE_PRIVATE)

    companion object {
        // Suppression window: setPin() below fires DeviceAdminReceiver.onPasswordChanged
        // just like any other password change would, so a revert would otherwise retrigger
        // itself forever. Anything landing inside this window after our own setPin() call is
        // treated as self-triggered and ignored.
        private const val SELF_CHANGE_SUPPRESS_MS = 5_000L
        // Rate limit: at most this many reverts per rolling minute, so a pathological loop
        // (or a very determined employee) can't be an invisible battery drain.
        private const val REVERT_WINDOW_MS = 60_000L
        private const val MAX_REVERTS_PER_WINDOW = 5
    }

    fun isManaged(): Boolean = dpm.isDeviceOwnerApp(ctx.packageName)

    private fun loadToken(): ByteArray? =
        prefs.getString("token", null)?.let { Base64.decode(it, Base64.NO_WRAP) }

    /** Ensure a reset token is registered + active. Returns true if active.
     *  setResetPasswordToken THROWS "Escrow token is disabled" on Full-Disk-Encryption
     *  devices (e.g. Zebra TC51 / Android 8.1) — caught here so we fall back to resetPassword. */
    @SuppressLint("NewApi") // escrow APIs are API 26+; only called behind an SDK_INT guard
    fun ensureToken(): Boolean {
        if (!isManaged()) return false
        try {
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
        } catch (e: Exception) {
            Log.w(MqttService.TAG, "Escrow token unavailable: ${e.message}")
            return false
        }
    }

    fun generatePin(len: Int = 6): String {
        val r = SecureRandom(); val sb = StringBuilder()
        repeat(len) { sb.append(r.nextInt(10)) }
        return sb.toString()
    }

    /** Set the lock PIN. Returns the new PIN on success, null otherwise.
     *  Prefers the escrow-token path (File-Based-Encryption devices); falls back to the
     *  legacy resetPassword, which a Device Owner can use on Full-Disk-Encryption devices. */
    @SuppressLint("NewApi")
    fun setPin(pin: String): String? {
        if (!isManaged()) return null
        // Stamp "we're about to change it ourselves" BEFORE making the call — the
        // resetPassword()/resetPasswordWithToken() below fires onPasswordChanged just like
        // any other password change, and onExternalPasswordChange() checks this timestamp to
        // avoid reverting its own revert.
        prefs.edit().putLong("last_self_change_at", System.currentTimeMillis()).apply()
        // 1. Escrow-token path — File-Based-Encryption devices only (API 26+).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                if (ensureToken() && dpm.resetPasswordWithToken(admin, pin, loadToken(), 0)) {
                    return onPinSet(pin)
                }
            } catch (e: Exception) {
                Log.w(MqttService.TAG, "token reset failed (${e.message}); trying legacy resetPassword")
            }
        }
        // 2. Legacy resetPassword — works for a Device Owner on FDE devices (TC51 / 8.1).
        try {
            @Suppress("DEPRECATION")
            if (dpm.resetPassword(pin, 0)) return onPinSet(pin)
            Log.e(MqttService.TAG, "resetPassword returned false")
        } catch (e: Exception) {
            Log.e(MqttService.TAG, "resetPassword failed: ${e.message}")
        }
        return null
    }

    private fun onPinSet(pin: String): String {
        dpm.setPasswordQuality(admin, DevicePolicyManager.PASSWORD_QUALITY_NUMERIC)
        prefs.edit().putString("pin", pin).apply()
        Log.i(MqttService.TAG, "Lock PIN set by system")
        return pin
    }

    fun currentPin(): String? = prefs.getString("pin", null)

    // ============ INSTANT PIN REVERT (item 1) ============

    /** Called from DeviceAdminReceiver.onPasswordChanged whenever ANY password/PIN change
     *  happens on the device — including an employee changing it on-device, which is exactly
     *  what this exists to catch. Reverts to the last system-set PIN, subject to the
     *  self-change suppression window and the per-minute rate limit above. Returns true if a
     *  revert was actually performed. */
    fun onExternalPasswordChange(): Boolean {
        if (!isManaged()) return false
        val now = System.currentTimeMillis()

        val lastSelfChangeAt = prefs.getLong("last_self_change_at", 0L)
        if (now - lastSelfChangeAt < SELF_CHANGE_SUPPRESS_MS) {
            Log.d(MqttService.TAG, "onExternalPasswordChange: self-triggered change, ignoring")
            return false
        }

        val stored = currentPin()
        if (stored == null) {
            Log.d(MqttService.TAG, "onExternalPasswordChange: no system PIN stored yet, nothing to revert to")
            return false
        }

        var windowStart = prefs.getLong("revert_window_start", 0L)
        var windowCount = prefs.getInt("revert_window_count", 0)
        if (now - windowStart >= REVERT_WINDOW_MS) {
            windowStart = now
            windowCount = 0
        }
        if (windowCount >= MAX_REVERTS_PER_WINDOW) {
            prefs.edit().putBoolean("pin_revert_throttled", true).apply()
            MqttService.alog(Log.WARN, "PIN revert throttled: $MAX_REVERTS_PER_WINDOW reverts already this minute, giving up until the window resets")
            return false
        }
        windowCount++
        prefs.edit()
            .putLong("revert_window_start", windowStart)
            .putInt("revert_window_count", windowCount)
            .putBoolean("pin_revert_throttled", false)
            .apply()

        val applied = setPin(stored)
        if (applied != null) {
            val total = prefs.getInt("pin_revert_count", 0) + 1
            prefs.edit()
                .putInt("pin_revert_count", total)
                .putLong("pin_last_reverted_at", now)
                .apply()
            MqttService.alog(Log.WARN, "PIN reverted: unauthorized on-device change detected and undone (revert #$total)")
            return true
        }
        Log.e(MqttService.TAG, "onExternalPasswordChange: revert attempt failed (setPin returned null)")
        return false
    }

    fun pinRevertCount(): Int = prefs.getInt("pin_revert_count", 0)
    fun pinLastRevertedAt(): Long = prefs.getLong("pin_last_reverted_at", 0L)
    fun pinRevertThrottled(): Boolean = prefs.getBoolean("pin_revert_throttled", false)
}
