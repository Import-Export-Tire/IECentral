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
        prefs.edit().putString("pin", pin).apply()
        return pin
    }

    fun currentPin(): String? = prefs.getString("pin", null)
}
