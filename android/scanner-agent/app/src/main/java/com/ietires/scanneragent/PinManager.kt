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

        // clearThenSet timings. The settle gives vold a moment to act on the credential
        // removal before the new PIN goes in — without it the two transitions collapse and the
        // FDE footer never moves, which is what made this look unfixable at first.
        private const val CLEAR_SETTLE_MS = 1_500L
        private const val SET_ATTEMPTS = 5
        private const val SET_RETRY_MS = 750L
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
        val r = SecureRandom()
        // Re-roll anything guessable. A random generator will happily produce 123456 or
        // 111111, and those are the first PINs anyone tries on a shared warehouse device.
        // Bounded so this can never spin forever.
        repeat(50) {
            val candidate = buildString { repeat(len) { append(r.nextInt(10)) } }
            if (!isWeakPin(candidate)) return candidate
        }
        // Astronomically unlikely; fall back to something non-sequential by construction.
        return buildString { repeat(len) { append(r.nextInt(8) + 1) } }
    }

    /** Guessable PINs: all one digit (111111), or a run counting up or down (123456 / 654321).
     *  Wrapping runs count too — 890123 is no harder to guess than 123456. */
    fun isWeakPin(pin: String): Boolean {
        if (pin.length < 2) return true
        if (pin.all { it == pin[0] }) return true
        val digits = pin.map { it - '0' }
        val ascending = digits.zipWithNext().all { (a, b) -> (a + 1) % 10 == b }
        val descending = digits.zipWithNext().all { (a, b) -> (a + 9) % 10 == b }
        return ascending || descending
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
        //    Routed through clearThenSet so the FDE boot password follows the lock PIN; see
        //    that function for why a plain resetPassword is not enough.
        return clearThenSet(pin)
    }

    /**
     * Sets the lock PIN via "clear, then set" so the **boot/decrypt password follows too**.
     *
     * These TC51s use Full-Disk Encryption, where the boot password and the lock-screen PIN are
     * separate credentials. Measured on W08-902 (2026-08-05): a plain `resetPassword()` — and
     * `locksettings set-pin`, for that matter — changes ONLY the keyguard. The footer keeps
     * whatever it had, forever, and re-keying it directly needs vdc/root which no app has.
     *
     * The one transition that DOES re-key it is no-credential → credential: that is how every
     * scanner got a boot password in the first place, when the agent set its very first PIN in
     * maybeInitializePin(). So each change is performed as clear (→ footer back to default),
     * then set (→ footer takes the new PIN), leaving both credentials on the same value.
     *
     * Without this, every remote PIN change silently strands a scanner one reboot away from
     * asking for a PIN nobody has written down — which is exactly what happened to W08-902.
     */
    private fun clearThenSet(pin: String): String? {
        // The password-quality policy has to be relaxed first: with NUMERIC in force, clearing
        // to an empty credential is refused, and the whole sequence would silently no-op.
        try {
            dpm.setPasswordQuality(admin, DevicePolicyManager.PASSWORD_QUALITY_UNSPECIFIED)
        } catch (e: Exception) {
            Log.w(MqttService.TAG, "setPasswordQuality(UNSPECIFIED) failed: ${e.message}")
        }

        var cleared = false
        try {
            prefs.edit().putLong("last_self_change_at", System.currentTimeMillis()).apply()
            @Suppress("DEPRECATION")
            cleared = dpm.resetPassword("", 0)
            if (!cleared) MqttService.alog(Log.WARN, "setPin: clear step refused — boot PIN will not follow this change")
        } catch (e: Exception) {
            Log.w(MqttService.TAG, "setPin: clear step threw: ${e.message}")
        }

        // Let vold actually process the credential removal. The clear and the set are separate
        // transitions and the footer re-key happens on each; firing them back-to-back with no
        // gap is what made this look impossible to fix during debugging.
        if (cleared) {
            try { Thread.sleep(CLEAR_SETTLE_MS) } catch (e: InterruptedException) { Thread.currentThread().interrupt() }
        }

        // Now set the real PIN. This is the step that must not be allowed to fail: after a
        // successful clear the device has NO lock screen until it lands, so retry hard and say
        // so loudly if it still doesn't take.
        repeat(SET_ATTEMPTS) { attempt ->
            try {
                prefs.edit().putLong("last_self_change_at", System.currentTimeMillis()).apply()
                @Suppress("DEPRECATION")
                if (dpm.resetPassword(pin, 0)) {
                    if (cleared) MqttService.alog(Log.INFO, "setPin: clear+set completed — boot PIN and lock PIN should now match")
                    return onPinSet(pin)
                }
                Log.e(MqttService.TAG, "resetPassword returned false (attempt ${attempt + 1}/$SET_ATTEMPTS)")
            } catch (e: Exception) {
                Log.e(MqttService.TAG, "resetPassword failed (attempt ${attempt + 1}/$SET_ATTEMPTS): ${e.message}")
            }
            try { Thread.sleep(SET_RETRY_MS) } catch (e: InterruptedException) { Thread.currentThread().interrupt() }
        }

        if (cleared) {
            // Worst case: cleared but never re-set. The device is sitting with no lock screen,
            // which is a security problem an operator has to know about immediately rather than
            // discovering later — restoring the quality policy at least blocks a weak manual PIN.
            MqttService.alog(Log.ERROR, "setPin: CLEARED THE LOCK SCREEN BUT COULD NOT SET A NEW PIN — device is unlocked")
        }
        try {
            dpm.setPasswordQuality(admin, DevicePolicyManager.PASSWORD_QUALITY_NUMERIC)
        } catch (e: Exception) {
            Log.w(MqttService.TAG, "setPasswordQuality(NUMERIC) restore failed: ${e.message}")
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
