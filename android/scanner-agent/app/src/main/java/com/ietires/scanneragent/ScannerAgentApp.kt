package com.ietires.scanneragent

import android.app.Application
import android.content.Intent
import android.os.Build
import android.util.Log
import java.io.File

class ScannerAgentApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Log.i(MqttService.TAG, "Scanner Agent app started")

        // Brand the device so an IE Tires scanner is recognisable at a glance. Done here rather
        // than in MqttService because that only starts once provisioned — this way a scanner
        // shows the tire wallpaper from the first boot after install.
        WallpaperSetter.ensureApplied(this)

        // Only start MQTT service if provisioned (config exists)
        if (File(filesDir, "iot_config.json").exists()) {
            val intent = Intent(this, MqttService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        } else {
            Log.i(MqttService.TAG, "Not provisioned — waiting for setup")
        }
    }
}
