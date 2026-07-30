package com.ietires.scanneragent

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Device admin receiver for lock/wipe capabilities.
 * Must be activated during scanner setup via:
 * adb shell dpm set-active-admin com.ietires.scanneragent/.DeviceAdminReceiver
 */
class DeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        Log.i(MqttService.TAG, "Device admin enabled")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        Log.w(MqttService.TAG, "Device admin disabled")
    }

    /** Fires system-wide whenever ANY app changes the device password/PIN — including an
     *  employee changing it by hand on the device, which is exactly the case this exists to
     *  catch (item 1: instant PIN revert). This callback (the 2-arg overload) is the one the
     *  platform invokes for a DPC that targets pre-O, which this app deliberately does — see
     *  build.gradle's targetSdk comment.
     *
     *  Runs directly against PinManager (not routed through MqttService) so it works even
     *  when the app's process isn't already running: BroadcastReceiver delivery for a
     *  Device Admin callback always spins the process up if needed, without depending on
     *  MqttService's lifecycle. Every call is wrapped in try/catch — an uncaught exception
     *  here is a Device Admin callback crash, which has previously crash-looped this agent. */
    override fun onPasswordChanged(context: Context, intent: Intent) {
        super.onPasswordChanged(context, intent)
        try {
            val reverted = PinManager(context).onExternalPasswordChange()
            if (reverted) {
                MqttService.alog(Log.WARN, "onPasswordChanged: PIN reverted to system value")
            }
        } catch (e: Exception) {
            Log.w(MqttService.TAG, "onPasswordChanged: revert handling failed: ${e.message}", e)
        }

        // Best-effort nudge so a revert (or a throttled non-revert) surfaces on telemetry
        // sooner than the next scheduled 5-minute publish. Purely additive: if MqttService
        // isn't running this starts it (which will itself re-assert/report the PIN state on
        // connect); if it's already running, onStartCommand below does an immediate publish.
        try {
            val svcIntent = Intent(context, MqttService::class.java).setAction(MqttService.ACTION_PIN_REVERT_CHECK)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svcIntent)
            } else {
                context.startService(svcIntent)
            }
        } catch (e: Exception) {
            Log.w(MqttService.TAG, "onPasswordChanged: could not notify MqttService: ${e.message}")
        }
    }
}
