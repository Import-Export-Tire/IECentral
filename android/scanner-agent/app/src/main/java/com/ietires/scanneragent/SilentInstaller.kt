package com.ietires.scanneragent

import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log
import java.io.File

/**
 * Shared fire-and-forget silent install via PackageInstaller, for the two Device-Owner-only
 * "just install it, no prompt" call sites that don't need a correlated async result:
 * MqttService's remote install_apk (cmd/scanners/# path) and SetupActivity's initial app
 * provisioning during setup. (JobsClient.commitInstallSession is intentionally NOT unified with
 * this — it correlates the install result back to a specific AWS IoT Jobs execution via a
 * registered BroadcastReceiver, which this simpler fire-and-forget helper has no notion of, and
 * JobsClient.kt is out of scope for this change.)
 *
 * The whole point of this class: without it, installing the (debug-signed) IET apps triggers
 * the interactive installer AND Play Protect's "blocked as unsafe — install anyway" prompt on
 * every single one of ~20 scanners being provisioned. A Device Owner can install silently
 * instead — no prompt, no Play Protect interstitial.
 */
object SilentInstaller {

    /** True if the given context's own app is Device Owner — the precondition every method
     *  below (and every caller) needs. Callers should fall back to the ACTION_VIEW intent path
     *  when this is false. */
    fun isDeviceOwner(ctx: Context): Boolean {
        val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        return dpm.isDeviceOwnerApp(ctx.packageName)
    }

    /** Commits a full-install PackageInstaller session for apkFile. Fire-and-forget: neither
     *  existing caller waits for the install-result broadcast, both already treat "session
     *  created and committed without throwing" as success — matching the behaviour this
     *  replaces. Returns false (logged, not thrown) if not Device Owner or if any step of
     *  session creation/write/commit fails. */
    fun installSilently(ctx: Context, apkFile: File): Boolean {
        if (!isDeviceOwner(ctx)) {
            Log.i(MqttService.TAG, "SilentInstaller: not device owner — cannot silent install")
            return false
        }
        return try {
            val installer = ctx.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setSize(apkFile.length())

            val sessionId = installer.createSession(params)
            val session = installer.openSession(sessionId)
            session.openWrite("apk", 0, apkFile.length()).use { output ->
                apkFile.inputStream().use { it.copyTo(output) }
                session.fsync(output)
            }

            // Fire-and-forget result callback — nothing currently listens for
            // INSTALL_COMPLETE, same as the code this replaces. Still supplied (rather than a
            // null IntentSender) since PackageInstaller.commit requires one.
            val callbackIntent = Intent("com.ietires.scanneragent.INSTALL_COMPLETE")
            val pendingIntent = PendingIntent.getBroadcast(
                ctx, sessionId, callbackIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            session.commit(pendingIntent.intentSender)
            Log.i(MqttService.TAG, "SilentInstaller: install session committed for ${apkFile.name}")
            true
        } catch (e: Exception) {
            Log.w(MqttService.TAG, "SilentInstaller: install failed for ${apkFile.name}: ${e.message}")
            false
        }
    }
}
