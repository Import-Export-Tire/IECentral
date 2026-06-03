package com.ietires.scanneragent

import android.annotation.SuppressLint
import android.app.*
import android.app.admin.DevicePolicyManager
import android.content.*
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.os.*
import android.util.Log
import org.eclipse.paho.client.mqttv3.*
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence
import org.json.JSONObject
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.openssl.PEMKeyPair
import org.bouncycastle.openssl.PEMParser
import org.bouncycastle.openssl.jcajce.JcaPEMKeyConverter
import android.net.Uri
import android.os.StatFs
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.FileReader
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.Security
import java.security.cert.CertificateFactory
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory

/**
 * Foreground service that maintains MQTT connection to AWS IoT Core.
 * Publishes telemetry every 5 minutes and listens for remote commands.
 */
class MqttService : Service() {

    companion object {
        const val TAG = "ScannerAgent"
        const val NOTIFICATION_ID = 1
        const val CHANNEL_ID = "scanner_agent_channel"
        const val TELEMETRY_INTERVAL_MS = 5 * 60 * 1000L // 5 minutes
    }

    private var mqttClient: MqttAsyncClient? = null
    private val handler = Handler(Looper.getMainLooper())
    private var thingName: String = ""
    private var iotEndpoint: String = ""
    @Volatile private var lastLocation: Location? = null
    private var locationManager: LocationManager? = null
    private val pinManager by lazy { PinManager(this) }

    private val locationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            lastLocation = location
        }
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
        @Deprecated("Deprecated in API") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("Connecting..."))
        lockDownPinSettings()
        maybeInitializePin()
        startLocationUpdates()
        loadConfigAndConnect()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY // Restart if killed
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        locationManager?.removeUpdates(locationListener)
        mqttClient?.disconnect()
        super.onDestroy()
    }

    private fun loadConfigAndConnect() {
        val configFile = File(filesDir, "iot_config.json")
        if (!configFile.exists()) {
            Log.e(TAG, "IoT config not found. Scanner not provisioned.")
            updateNotification("Not provisioned")
            return
        }

        val config = JSONObject(configFile.readText())
        thingName = config.getString("thingName")
        iotEndpoint = config.getString("iotEndpoint")

        connectMqtt()
    }

    private fun connectMqtt() {
        val serverUri = "ssl://$iotEndpoint:8883"
        mqttClient = MqttAsyncClient(serverUri, thingName, MemoryPersistence())

        mqttClient?.setCallback(object : MqttCallbackExtended {
            override fun connectComplete(reconnect: Boolean, serverURI: String) {
                Log.i(TAG, "Connected to IoT Core (reconnect=$reconnect)")
                updateNotification("Connected")
                subscribeToCommands()
                startTelemetryLoop()
            }

            override fun connectionLost(cause: Throwable?) {
                Log.w(TAG, "Connection lost: ${cause?.message}")
                updateNotification("Reconnecting...")
            }

            override fun messageArrived(topic: String, message: MqttMessage) {
                handleCommand(topic, message)
            }

            override fun deliveryComplete(token: IMqttDeliveryToken) {}
        })

        val options = MqttConnectOptions().apply {
            isAutomaticReconnect = true
            isCleanSession = true
            connectionTimeout = 30
            keepAliveInterval = 60
            socketFactory = createSslSocketFactory()
        }

        try {
            mqttClient?.connect(options)
        } catch (e: Exception) {
            Log.e(TAG, "MQTT connect failed: ${e.message}")
            updateNotification("Connection failed")
        }
    }

    private fun createSslSocketFactory(): javax.net.ssl.SSLSocketFactory {
        Security.addProvider(BouncyCastleProvider())

        val certFile = File(filesDir, "certificate.pem")
        val keyFile = File(filesDir, "private.key")
        val caFile = File(filesDir, "root-ca.pem")

        // Load CA certificate
        val cf = CertificateFactory.getInstance("X.509")
        val caCert = cf.generateCertificate(caFile.inputStream())
        val trustStore = KeyStore.getInstance(KeyStore.getDefaultType())
        trustStore.load(null)
        trustStore.setCertificateEntry("ca", caCert)
        val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        tmf.init(trustStore)

        // Load client certificate + private key via BouncyCastle
        val clientCert = cf.generateCertificate(certFile.inputStream())
        val pemParser = PEMParser(FileReader(keyFile))
        val pemObject = pemParser.readObject()
        pemParser.close()
        val converter = JcaPEMKeyConverter().setProvider("BC")
        val privateKey = when (pemObject) {
            is PEMKeyPair -> converter.getKeyPair(pemObject).private
            is org.bouncycastle.asn1.pkcs.PrivateKeyInfo -> converter.getPrivateKey(pemObject)
            else -> throw IllegalArgumentException("Unexpected PEM object: ${pemObject::class.java}")
        }

        val keyStore = KeyStore.getInstance("PKCS12")
        keyStore.load(null)
        keyStore.setKeyEntry("client", privateKey, CharArray(0), arrayOf(clientCert))
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(keyStore, CharArray(0))

        val sslContext = SSLContext.getInstance("TLSv1.2")
        sslContext.init(kmf.keyManagers, tmf.trustManagers, null)
        return sslContext.socketFactory
    }

    private fun subscribeToCommands() {
        val topic = "cmd/scanners/$thingName/#"
        mqttClient?.subscribe(topic, 1, null, object : IMqttActionListener {
            override fun onSuccess(asyncActionToken: IMqttToken?) {
                Log.i(TAG, "Subscribed to $topic")
            }
            override fun onFailure(asyncActionToken: IMqttToken?, exception: Throwable?) {
                Log.e(TAG, "Subscribe failed: ${exception?.message}")
            }
        })
    }

    // ============ TELEMETRY ============

    private fun startTelemetryLoop() {
        handler.removeCallbacksAndMessages(null)
        publishTelemetry()
        handler.postDelayed(object : Runnable {
            override fun run() {
                publishTelemetry()
                handler.postDelayed(this, TELEMETRY_INTERVAL_MS)
            }
        }, TELEMETRY_INTERVAL_MS)
    }

    private fun publishTelemetry() {
        val telemetry = JSONObject().apply {
            put("battery", getBatteryLevel())
            put("wifiSignal", getWifiSignal())
            put("gps", getGpsLocation())
            put("apps", getInstalledAppVersions())
            put("agentVersion", BuildConfig.VERSION_NAME)
            put("androidVersion", Build.VERSION.RELEASE)
            put("deviceOwner", pinManager.isManaged())
            put("pinManaged", pinManager.isManaged() && pinManager.currentPin() != null)
            if (pinManager.isManaged()) pinManager.currentPin()?.let { put("pin", it) }
            val km = getSystemService(KEYGUARD_SERVICE) as android.app.KeyguardManager
            put("isLocked", km.isDeviceLocked)
            put("timestamp", System.currentTimeMillis() / 1000)

            // Storage telemetry
            try {
                val stat = StatFs(Environment.getDataDirectory().path)
                val blockSize = stat.blockSizeLong
                put("storageTotal", (stat.blockCountLong * blockSize) / (1024 * 1024))
                put("storageFree", (stat.availableBlocksLong * blockSize) / (1024 * 1024))
            } catch (e: Exception) {
                Log.w(TAG, "Could not read storage stats: ${e.message}")
            }
        }

        val topic = "dt/scanners/$thingName/telemetry"
        try {
            mqttClient?.publish(topic, MqttMessage(telemetry.toString().toByteArray()).apply {
                qos = 0
            })
            Log.d(TAG, "Telemetry published")
        } catch (e: Exception) {
            Log.e(TAG, "Telemetry publish failed: ${e.message}")
        }

        // Also update device shadow
        val shadow = JSONObject().apply {
            put("state", JSONObject().apply {
                put("reported", telemetry)
            })
        }
        try {
            mqttClient?.publish(
                "\$aws/things/$thingName/shadow/update",
                MqttMessage(shadow.toString().toByteArray()).apply { qos = 0 }
            )
        } catch (e: Exception) {
            Log.e(TAG, "Shadow update failed: ${e.message}")
        }
    }

    private fun getBatteryLevel(): Int {
        val bm = getSystemService(BATTERY_SERVICE) as BatteryManager
        return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    private fun getWifiSignal(): Int {
        val wm = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
        return wm.connectionInfo.rssi
    }

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates() {
        try {
            locationManager = getSystemService(LOCATION_SERVICE) as LocationManager
            // Request updates every 5 minutes / 50 meters — whichever comes first
            if (locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true) {
                locationManager?.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, 5 * 60 * 1000L, 50f, locationListener
                )
            }
            if (locationManager?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) == true) {
                locationManager?.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, 5 * 60 * 1000L, 50f, locationListener
                )
            }
            // Seed with last known location if available
            lastLocation = locationManager?.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: locationManager?.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
        } catch (e: SecurityException) {
            Log.w(TAG, "Location permission not granted")
        }
    }

    private fun getGpsLocation(): JSONObject {
        val result = JSONObject()
        val loc = lastLocation
        if (loc != null) {
            result.put("lat", loc.latitude)
            result.put("lng", loc.longitude)
            result.put("accuracy", loc.accuracy)
        }
        return result
    }

    private fun getInstalledAppVersions(): JSONObject {
        val apps = JSONObject()
        val pm = packageManager
        try {
            apps.put("tireTrack", pm.getPackageInfo("com.importexporttire.tiretrack", 0).versionName)
        } catch (e: Exception) { /* not installed */ }
        try {
            apps.put("rtLocator", pm.getPackageInfo("com.rt_systems.rtlhandsfree", 0).versionName)
        } catch (e: Exception) { /* not installed */ }
        apps.put("scannerAgent", BuildConfig.VERSION_NAME)
        return apps
    }

    // ============ COMMAND HANDLING ============

    private fun handleCommand(topic: String, message: MqttMessage) {
        val payload = JSONObject(String(message.payload))
        val command = payload.optString("command", topic.substringAfterLast("/"))
        Log.i(TAG, "Received command: $command")

        when (command) {
            "lock" -> lockDevice()
            "unlock" -> unlockDevice()
            "wipe" -> wipeDevice()
            "restart" -> restartDevice()
            "install_apk" -> installApk(payload.optJSONObject("payload"))
            "uninstall_app" -> uninstallApp(payload.optJSONObject("payload"))
            "push_config" -> pushConfig(payload.optJSONObject("payload"))
            "update_pin" -> updatePin()
        }

        // Acknowledge command
        val ack = JSONObject().apply {
            put("command", command)
            put("status", "acknowledged")
            put("timestamp", System.currentTimeMillis() / 1000)
        }
        mqttClient?.publish(
            "cmd/scanners/$thingName/ack",
            MqttMessage(ack.toString().toByteArray()).apply { qos = 1 }
        )
    }

    private fun updatePin() {
        val pin = pinManager.generatePin()
        val applied = pinManager.setPin(pin)
        Log.i(TAG, "update_pin: managed=${applied != null}")
        publishTelemetry() // report new pin/status over the bridged telemetry path
    }

    private fun lockDevice() {
        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(this, DeviceAdminReceiver::class.java)
        if (dpm.isAdminActive(admin)) {
            dpm.lockNow()
            Log.i(TAG, "Device locked")
        } else {
            Log.w(TAG, "Device admin not active, cannot lock")
        }
    }

    @Suppress("DEPRECATION")
    private fun unlockDevice() {
        // 1. Wake the screen and keep it on
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        val wakeLock = pm.newWakeLock(
            PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
            "ScannerAgent:Unlock"
        )
        wakeLock.acquire(30_000) // Hold screen on for 30 seconds

        // 2. Disable the keyguard
        val km = getSystemService(KEYGUARD_SERVICE) as android.app.KeyguardManager
        val keyguardLock = km.newKeyguardLock("ScannerAgent")
        keyguardLock.disableKeyguard()
        Log.i(TAG, "Keyguard disabled")

        // 3. Launch a transparent unlock Activity with window flags
        try {
            val unlockIntent = android.content.Intent(this, UnlockActivity::class.java)
            unlockIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(unlockIntent)
        } catch (e: Exception) {
            Log.w(TAG, "UnlockActivity launch failed: ${e.message}")
        }

        Log.i(TAG, "Device unlock initiated")
    }

    private fun wipeDevice() {
        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(this, DeviceAdminReceiver::class.java)
        if (dpm.isAdminActive(admin)) {
            Log.w(TAG, "FACTORY RESET initiated!")
            dpm.wipeData(0)
        } else {
            Log.w(TAG, "Device admin not active, cannot wipe")
        }
    }

    private fun restartDevice() {
        // Try device owner reboot first (cleanest), then fallbacks
        if (isDeviceOwner()) {
            try {
                val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
                val admin = ComponentName(this, DeviceAdminReceiver::class.java)
                dpm.reboot(admin)
                return
            } catch (e: Exception) {
                Log.w(TAG, "Device owner reboot failed: ${e.message}")
            }
        }
        try {
            Runtime.getRuntime().exec(arrayOf("su", "-c", "reboot"))
        } catch (e: Exception) {
            try {
                Runtime.getRuntime().exec("reboot")
            } catch (e2: Exception) {
                try {
                    Runtime.getRuntime().exec(arrayOf("am", "broadcast", "-a", "android.intent.action.REBOOT"))
                } catch (e3: Exception) {
                    Log.e(TAG, "All reboot methods failed: ${e3.message}")
                }
            }
        }
    }

    private fun uninstallApp(payload: JSONObject?) {
        val packageName = payload?.optString("packageName") ?: return
        Log.i(TAG, "Uninstalling: $packageName")

        if (isDeviceOwner()) {
            // Silent uninstall via PackageInstaller
            try {
                val installer = getPackageManager().packageInstaller
                val callbackIntent = Intent("com.ietires.scanneragent.UNINSTALL_COMPLETE")
                val pendingIntent = android.app.PendingIntent.getBroadcast(
                    this, 0, callbackIntent,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
                )
                installer.uninstall(packageName, pendingIntent.intentSender)
                Log.i(TAG, "Silent uninstall initiated for $packageName")
            } catch (e: Exception) {
                Log.e(TAG, "Silent uninstall failed: ${e.message}")
            }
        } else {
            // Fallback: intent-based uninstall (requires user tap)
            val intent = Intent(Intent.ACTION_DELETE, Uri.parse("package:$packageName"))
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            startActivity(intent)
        }
    }

    private fun installApk(payload: JSONObject?) {
        val downloadUrl = payload?.optString("downloadUrl") ?: return
        Log.i(TAG, "Downloading APK from: $downloadUrl")

        Thread {
            try {
                // Download APK to cache directory
                val apkFile = File(cacheDir, "mdm_update.apk")
                val conn = URL(downloadUrl).openConnection() as HttpURLConnection
                conn.connectTimeout = 30000
                conn.readTimeout = 600000 // 10 min for large APKs
                conn.inputStream.use { input ->
                    FileOutputStream(apkFile).use { output ->
                        val buffer = ByteArray(8192)
                        var bytesRead: Int
                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            output.write(buffer, 0, bytesRead)
                        }
                    }
                }
                conn.disconnect()
                Log.i(TAG, "APK downloaded: ${apkFile.length() / 1024}KB")

                // Try silent install first (requires device owner)
                if (silentInstall(apkFile)) {
                    Log.i(TAG, "Silent install succeeded")
                    return@Thread
                }

                // Fallback: trigger install via Intent (requires user tap)
                Log.i(TAG, "Falling back to intent-based install")
                val intent = Intent(Intent.ACTION_VIEW)
                val uri: Uri = FileProvider.getUriForFile(
                    this@MqttService, "${packageName}.fileprovider", apkFile
                )
                intent.setDataAndType(uri, "application/vnd.android.package-archive")
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "APK install failed: ${e.message}", e)
            }
        }.start()
    }

    private fun silentInstall(apkFile: File): Boolean {
        return try {
            val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val admin = ComponentName(this, DeviceAdminReceiver::class.java)
            if (!dpm.isDeviceOwnerApp(packageName)) {
                Log.i(TAG, "Not device owner — cannot silent install")
                return false
            }

            val installer = packageManager.packageInstaller
            val params = android.content.pm.PackageInstaller.SessionParams(
                android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL
            )
            params.setSize(apkFile.length())

            val sessionId = installer.createSession(params)
            val session = installer.openSession(sessionId)

            session.openWrite("apk", 0, apkFile.length()).use { output ->
                apkFile.inputStream().use { input ->
                    input.copyTo(output)
                }
                session.fsync(output)
            }

            // Create a PendingIntent for the install result
            val callbackIntent = Intent("com.ietires.scanneragent.INSTALL_COMPLETE")
            val pendingIntent = android.app.PendingIntent.getBroadcast(
                this, sessionId, callbackIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )
            session.commit(pendingIntent.intentSender)
            Log.i(TAG, "Silent install session committed")
            true
        } catch (e: Exception) {
            Log.w(TAG, "Silent install failed: ${e.message}")
            false
        }
    }

    private fun isDeviceOwner(): Boolean {
        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
        return dpm.isDeviceOwnerApp(packageName)
    }

    private fun pushConfig(payload: JSONObject?) {
        val xmlContent = payload?.optString("configXml") ?: return
        // Use direct /sdcard/My Documents/ path — works on Zebra TC51 Android 8.1
        // Environment.getExternalStorageDirectory() is deprecated and unreliable
        val configDir = File("/sdcard/My Documents")
        configDir.mkdirs()
        File(configDir, "rtlconfig.xml").writeText(xmlContent)
        Log.i(TAG, "RT config pushed to ${configDir.absolutePath}/rtlconfig.xml")
    }

    private fun lockDownPinSettings() {
        try {
            val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val admin = ComponentName(this, DeviceAdminReceiver::class.java)
            if (dpm.isAdminActive(admin)) {
                // Require numeric PIN with minimum 4 digits — prevents disabling or weakening the lock
                dpm.setPasswordQuality(admin, DevicePolicyManager.PASSWORD_QUALITY_NUMERIC)
                dpm.setPasswordMinimumLength(admin, 4)
                Log.i(TAG, "PIN policy enforced: numeric, min 4 digits")
            }
        } catch (e: Exception) {
            // A device-policy hiccup must never crash the foreground service (this ran in
            // onCreate, so an uncaught SecurityException here crash-looped the agent — e.g.
            // an older APK whose admin policy XML lacked <limit-password/>, or OEM limits).
            Log.w(TAG, "Could not enforce PIN policy: ${e.message}")
        }
    }

    /** First managed boot with no PIN yet → set a system-generated PIN. Idempotent:
     *  once a PIN is stored, this is a no-op. The new PIN is reported on the next
     *  telemetry publish (publishTelemetry includes it when managed). */
    private fun maybeInitializePin() {
        try {
            if (pinManager.isManaged() && pinManager.currentPin() == null) {
                val applied = pinManager.setPin(pinManager.generatePin())
                Log.i(TAG, "Initial system PIN set: managed=${applied != null}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "maybeInitializePin failed: ${e.message}")
        }
    }

    // ============ NOTIFICATIONS ============

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Scanner Agent", NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Scanner MDM agent status" }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(status: String): Notification {
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("IE Scanner Agent")
            .setContentText(status)
            .setSmallIcon(android.R.drawable.ic_menu_manage)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(status: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(status))
    }
}
