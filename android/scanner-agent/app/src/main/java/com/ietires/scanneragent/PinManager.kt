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
}
