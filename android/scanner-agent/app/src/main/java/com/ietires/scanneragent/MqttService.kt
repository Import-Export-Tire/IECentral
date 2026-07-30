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
import org.json.JSONArray
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

        // get_screen (item 5): fast-publish cadence for live remote troubleshooting, and how
        // long it runs before auto-reverting to the normal cadence.
        const val FAST_PUBLISH_INTERVAL_MS = 3 * 1000L
        const val FAST_PUBLISH_DURATION_MS = 2 * 60 * 1000L

        // Sideload/app-change queue cap (item 3) — bounded so it can never grow without limit.
        const val MAX_APP_CHANGE_EVENTS = 20

        // Started (see DeviceAdminReceiver.onPasswordChanged) purely to nudge an immediate
        // telemetry publish after an out-of-band PIN revert; onStartCommand below handles it.
        const val ACTION_PIN_REVERT_CHECK = "com.ietires.scanneragent.action.PIN_REVERT_CHECK"

        private const val LOG_TAIL_MAX_LINES = 200
        private const val LOG_TAIL_MAX_LINE_CHARS = 200
        private val logTail = ArrayDeque<String>()
        private val logTailLock = Any()

        /** Logs through android.util.Log AND appends to a small bounded in-process ring
         *  buffer. This app holds no READ_LOGS permission, so it can't pull system logcat to
         *  build the "recent log lines" attached to an on-demand screen snapshot (items 4/5)
         *  — this is the agent's own capture path instead. Deliberately only wired into the
         *  new code paths added for this work (PIN revert, policy application, sideload
         *  detection, the two new commands) — not a blanket replacement for every existing
         *  Log.* call in this module, and NOT wired into ScreenReaderService (out of scope:
         *  that file isn't touched, and it only calls android.util.Log directly, so its own
         *  lines aren't reachable here without editing it). */
        fun alog(priority: Int, msg: String) {
            when (priority) {
                Log.ERROR -> Log.e(TAG, msg)
                Log.WARN -> Log.w(TAG, msg)
                Log.DEBUG -> Log.d(TAG, msg)
                else -> Log.i(TAG, msg)
            }
            synchronized(logTailLock) {
                val stamped = "${System.currentTimeMillis() / 1000} $msg"
                val line = if (stamped.length > LOG_TAIL_MAX_LINE_CHARS) stamped.substring(0, LOG_TAIL_MAX_LINE_CHARS) else stamped
                logTail.addLast(line)
                while (logTail.size > LOG_TAIL_MAX_LINES) logTail.removeFirst()
            }
        }

        /** Bounded snapshot of the ring buffer, safe from any thread. */
        fun logTailSnapshot(): List<String> = synchronized(logTailLock) { logTail.toList() }
    }

    private var mqttClient: MqttAsyncClient? = null
    // AWS IoT Jobs client — the "even if it's on next powerup" mechanism. See JobsClient.kt.
    private var jobsClient: JobsClient? = null
    private val handler = Handler(Looper.getMainLooper())
    private var thingName: String = ""
    private var iotEndpoint: String = ""
    @Volatile private var lastLocation: Location? = null
    private var locationManager: LocationManager? = null
    private val pinManager by lazy { PinManager(this) }

    // ---- item 2: policy/uninstall-protection result from the last applyPolicies() run ----
    @Volatile private var lastPolicyResult: JSONObject = JSONObject()

    // ---- item 3: bounded queue of sideload/uninstall events since the last telemetry publish ----
    private val appChangeQueue = ArrayDeque<JSONObject>()
    private val appChangeLock = Any()
    private var packageChangeReceiver: BroadcastReceiver? = null

    // ---- item 5: get_screen fast-publish mode ----
    @Volatile private var fastPublishActive = false
    private var fastPublishStopRunnable: Runnable? = null
    private val fastPublishRunnable = object : Runnable {
        override fun run() {
            publishTelemetry()
            handler.postDelayed(this, FAST_PUBLISH_INTERVAL_MS)
        }
    }

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
        applyPolicies() // item 2: runs on every service start, no-ops (logged) if not device owner
        // Headline item: makes HomeActivity the default HOME activity (gated on the
        // home_screen/enabled flag). Runs after applyPolicies (same device-owner precondition)
        // but is its own try/caught step — see the function doc for why this must never be
        // able to stop loadConfigAndConnect() below from running.
        applyHomeScreenPreference()
        registerPackageChangeReceiver() // item 3
        startLocationUpdates()
        loadConfigAndConnect()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_PIN_REVERT_CHECK) {
            // The revert itself already happened synchronously in DeviceAdminReceiver against
            // PinManager (so it works even if this service's process wasn't already running);
            // this is just a best-effort nudge to publish sooner than the next scheduled tick.
            try {
                alog(Log.INFO, "onStartCommand: PIN-revert notify received, publishing telemetry now")
                publishTelemetry()
            } catch (e: Exception) {
                Log.w(TAG, "onStartCommand: revert-triggered publish failed: ${e.message}")
            }
        }
        return START_STICKY // Restart if killed
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        locationManager?.removeUpdates(locationListener)
        packageChangeReceiver?.let {
            try { unregisterReceiver(it) } catch (e: Exception) { Log.w(TAG, "unregisterReceiver(packageChangeReceiver) failed: ${e.message}") }
        }
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
        Log.i(TAG, "Connecting to $serverUri as $thingName")
        val client = MqttAsyncClient(serverUri, thingName, MemoryPersistence())
        mqttClient = client
        // AWS IoT Jobs client — clientId IS the thing name (see MqttAsyncClient construction
        // above), and every jobs/* topic is keyed off it. Wired here (not lazily) so it exists
        // before the first connectComplete fires.
        jobsClient = JobsClient(client, thingName, applicationContext, ::executeJobCommand)

        mqttClient?.setCallback(object : MqttCallbackExtended {
            override fun connectComplete(reconnect: Boolean, serverURI: String) {
                Log.i(TAG, "Connected to IoT Core (reconnect=$reconnect)")
                updateNotification("Connected")
                subscribeToCommands()
                startTelemetryLoop()
                // Jobs offline-convergence: subscribes to notify-next + $next/get response
                // topics, then asks "what's next for me?" — this is what makes a job queued
                // while this scanner was off/out-of-range run now instead of never.
                try {
                    jobsClient?.onConnected()
                } catch (e: Exception) {
                    Log.e(TAG, "jobsClient.onConnected failed: ${e.message}", e)
                }
            }

            override fun connectionLost(cause: Throwable?) {
                Log.w(TAG, "Connection lost: ${cause?.message}")
                updateNotification("Reconnecting...")
            }

            override fun messageArrived(topic: String, message: MqttMessage) {
                // A malformed/unexpected message on either path must never crash this callback
                // — this service holds the only channel back to a remote scanner, so an
                // uncaught exception here is effectively a lost device until someone drives out
                // with a USB cable.
                try {
                    if (topic.startsWith("\$aws/things/$thingName/jobs/")) {
                        jobsClient?.onMessage(topic, message)
                    } else {
                        handleCommand(topic, message)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "messageArrived($topic) failed: ${e.message}", e)
                }
            }

            override fun deliveryComplete(token: IMqttDeliveryToken) {}
        })

        val options = MqttConnectOptions().apply {
            isAutomaticReconnect = true
            // Deliberately NOT false. AWS IoT Jobs (JobsClient, wired above) makes a persistent
            // session unnecessary — a job execution stays QUEUED server-side regardless of
            // session state until this device reports a terminal status — and MemoryPersistence
            // wouldn't survive a process restart anyway, so isCleanSession=false here would add
            // real risk (stale queued cmd/scanners/# messages replayed on reconnect) for zero
            // actual benefit.
            isCleanSession = true
            connectionTimeout = 30
            keepAliveInterval = 60
            try {
                socketFactory = createSslSocketFactory()
            } catch (e: Exception) {
                Log.e(TAG, "SSL setup failed: ${e.message}", e)
            }
        }

        // connect() with a listener so initial-connect FAILURES are logged + retried.
        // (isAutomaticReconnect only covers drops AFTER a successful connect, so a failed
        // first connect was previously silent — the agent looked dead with no log.)
        val listener = object : IMqttActionListener {
            override fun onSuccess(asyncActionToken: IMqttToken?) {
                Log.i(TAG, "connect() onSuccess")
            }
            override fun onFailure(asyncActionToken: IMqttToken?, exception: Throwable?) {
                Log.e(TAG, "connect() onFailure: ${exception?.javaClass?.simpleName}: ${exception?.message}", exception)
                updateNotification("Connection failed")
                handler.postDelayed({
                    try { mqttClient?.connect(options, null, this) }
                    catch (e: Exception) { Log.e(TAG, "retry connect threw: ${e.message}") }
                }, 15_000)
            }
        }
        try {
            mqttClient?.connect(options, null, listener)
        } catch (e: Exception) {
            Log.e(TAG, "MQTT connect threw: ${e.message}", e)
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
        // This wipes EVERY queued callback, including the get_screen fast-publish tick and its
        // auto-stop. Reconnects call this, so without clearing the flag too, fastPublishActive
        // stays true after a reconnect: fast publishing stops, but publishTelemetry() keeps
        // attaching the `screen` field to every 5-minute publish forever. Screen contents are
        // meant to be sent only while someone is actively troubleshooting, so a stuck flag both
        // bloats the payload and leaks what a picker has on screen indefinitely.
        handler.removeCallbacksAndMessages(null)
        fastPublishActive = false
        fastPublishStopRunnable = null
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

            // --- item 1: PIN revert visibility ---
            put("pinRevertCount", pinManager.pinRevertCount())
            put("pinLastRevertedAt", pinManager.pinLastRevertedAt())
            put("pinRevertThrottled", pinManager.pinRevertThrottled())

            // --- item 2: result of the last applyPolicies() run ---
            put("restrictionsApplied", lastPolicyResult)

            // --- home screen: whether HomeActivity is (meant to be) the default HOME activity.
            // Reflects the home_screen/enabled flag, not whether addPersistentPreferredActivity
            // actually succeeded — pair with restrictionsApplied.deviceOwner to tell "disabled"
            // apart from "device owner precondition not met so it never took effect".
            put("homeScreenEnabled", isHomeScreenEnabled())

            // --- item 3: queued sideload/uninstall events since the last publish; draining
            // here (rather than on ack) is what keeps the bounded queue from re-reporting the
            // same events on every subsequent telemetry tick.
            val changes = drainAppChangeQueue()
            if (changes.length() > 0) put("appChanges", changes)

            // --- item 4/5: on-demand screen snapshot + log tail. Only attached while in
            // get_screen's fast-publish window — the normal 5-minute cadence stays small.
            if (fastPublishActive) {
                put("screen", buildScreenPayload())
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
            "update_pin" -> updatePin(payload.optJSONObject("payload"))
            "apply_policies" -> { applyPolicies(); publishTelemetry() }
            "get_screen" -> enterFastPublishMode()
            "set_home" -> setHome(payload.optJSONObject("payload"))
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

    /** AWS IoT Jobs entry point: executes a command by calling the SAME private handlers the
     *  cmd/scanners/# path above uses (lockDevice, unlockDevice, ...), so behaviour cannot
     *  drift between the two delivery mechanisms. Returns a best-effort outcome for job status
     *  reporting; the cmd/scanners/# path ignores this return value and keeps its existing
     *  unconditional "acknowledged" semantics unchanged.
     *
     *  install_apk is NOT handled here — JobsClient runs it directly off-thread (download +
     *  sha256 verify + self-update safety) and only reuses the low-level PackageInstaller
     *  session mechanics, since its success/failure timing needs are different from every other
     *  command. "wipe" is also deliberately not offered over Jobs at all — no job document,
     *  however old or malformed, should ever be able to factory-reset a fleet scanner
     *  unattended; it's simply not in the command vocabulary Jobs supports (see the spec list
     *  this was built against). */
    internal fun executeJobCommand(command: String, payload: JSONObject?): JobOutcome {
        return try {
            when (command) {
                "lock" -> if (lockDevice()) JobOutcome.Success else JobOutcome.Retryable("device admin not active")
                "unlock" -> { unlockDevice(); JobOutcome.Success }
                // restartDevice() actually reboots — the caller (JobsClient) MUST report
                // SUCCEEDED before invoking this, since nothing can publish afterward.
                "restart" -> { restartDevice(); JobOutcome.Success }
                "uninstall_app" -> {
                    val pkg = payload?.optString("packageName")
                    if (pkg.isNullOrBlank()) JobOutcome.Permanent("uninstall_app: packageName missing or blank")
                    else { uninstallApp(payload); JobOutcome.Success }
                }
                "push_config" -> {
                    val xml = payload?.optString("configXml")
                    if (xml.isNullOrBlank()) JobOutcome.Permanent("push_config: configXml missing or blank")
                    else { pushConfig(payload); JobOutcome.Success }
                }
                "update_pin" -> when (updatePin(payload)) {
                    UpdatePinResult.Applied -> JobOutcome.Success
                    UpdatePinResult.SetPinFailed -> JobOutcome.Retryable("setPin failed")
                    // Invalid payload.pin can never succeed on a retry with the same payload —
                    // see the JobOutcome doc above on Retryable vs Permanent.
                    UpdatePinResult.InvalidPin -> JobOutcome.Permanent("update_pin: payload.pin must be 4-8 digits, digits only")
                }
                "apply_policies" -> {
                    applyPolicies(); publishTelemetry()
                    if (isDeviceOwner()) JobOutcome.Success else JobOutcome.Retryable("not device owner — policies not applied")
                }
                "get_screen" -> { enterFastPublishMode(); JobOutcome.Success }
                "set_home" -> if (setHome(payload)) JobOutcome.Success else JobOutcome.Retryable("not device owner — home screen preference not applied")
                else -> JobOutcome.Permanent("Unrecognized command: $command")
            }
        } catch (e: Exception) {
            Log.e(TAG, "executeJobCommand($command) threw: ${e.message}", e)
            JobOutcome.Retryable(e.message ?: e.javaClass.simpleName)
        }
    }

    /** Outcome of updatePin(), richer than a plain Boolean so executeJobCommand can tell "the
     *  requested PIN itself was invalid" (Permanent — retrying the identical payload can never
     *  succeed) apart from "setPin failed" (Retryable — e.g. a transient DevicePolicyManager
     *  hiccup, may well succeed on the next attempt). */
    private enum class UpdatePinResult { Applied, InvalidPin, SetPinFailed }

    /** update_pin: sets the lock PIN, optionally to an operator-specified value.
     *
     *  payload.pin, if present, must be digits-only and 4-8 characters. Anything else
     *  (letters, wrong length, blank) is REJECTED outright — it deliberately does NOT fall
     *  back to a random PIN on invalid input, because that would leave the operator believing
     *  they set pin=X while the device silently ended up with a different, random value. (That
     *  exact class of silent-fallback bug has already bitten this project once — see
     *  PinManager's self-change-suppression handling for the previous incident this guards
     *  against the same way: never let a caller believe one thing happened when another did.)
     *
     *  With no payload.pin supplied, behaviour is unchanged from before: generate a random PIN.
     *
     *  The cmd/scanners/# path above ignores the return value (as it always has); executeJobCommand
     *  maps it to Success / Retryable / Permanent for AWS IoT Jobs status reporting. */
    private fun updatePin(payload: JSONObject? = null): UpdatePinResult {
        val requestedPin = payload?.optString("pin", "")?.takeIf { it.isNotEmpty() }
        val pin: String
        if (requestedPin != null) {
            if (!isValidPin(requestedPin)) {
                Log.e(TAG, "update_pin: rejected invalid payload.pin (must be 4-8 digits, digits only) — leaving current PIN unchanged, NOT falling back to a random PIN")
                return UpdatePinResult.InvalidPin
            }
            pin = requestedPin
        } else {
            pin = pinManager.generatePin()
        }
        val applied = pinManager.setPin(pin)
        Log.i(TAG, "update_pin: managed=${applied != null} explicit=${requestedPin != null}")
        publishTelemetry() // report new pin/status over the bridged telemetry path
        return if (applied != null) UpdatePinResult.Applied else UpdatePinResult.SetPinFailed
    }

    private fun isValidPin(pin: String): Boolean = pin.length in 4..8 && pin.all { it.isDigit() }

    /** Returns true if lockNow() was actually invoked (device admin active) — used by
     *  executeJobCommand to distinguish success from failure. The cmd/scanners/# path above
     *  ignores the return value; behaviour there is unchanged. */
    private fun lockDevice(): Boolean {
        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(this, DeviceAdminReceiver::class.java)
        return if (dpm.isAdminActive(admin)) {
            dpm.lockNow()
            Log.i(TAG, "Device locked")
            true
        } else {
            Log.w(TAG, "Device admin not active, cannot lock")
            false
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

    /** Returns true if a reboot mechanism was invoked without an immediately-thrown exception.
     *  This actually reboots — for the Jobs path (executeJobCommand), the job's terminal status
     *  must be reported to AWS BEFORE this is called, not after (see JobsClient.startExecution's
     *  "restart" branch); there is no way to publish anything once the process is gone. The
     *  cmd/scanners/# path above ignores the return value; behaviour there is unchanged. */
    private fun restartDevice(): Boolean {
        // Try device owner reboot first (cleanest), then fallbacks
        if (isDeviceOwner()) {
            try {
                val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
                val admin = ComponentName(this, DeviceAdminReceiver::class.java)
                dpm.reboot(admin)
                return true
            } catch (e: Exception) {
                Log.w(TAG, "Device owner reboot failed: ${e.message}")
            }
        }
        try {
            Runtime.getRuntime().exec(arrayOf("su", "-c", "reboot"))
            return true
        } catch (e: Exception) {
            try {
                Runtime.getRuntime().exec("reboot")
                return true
            } catch (e2: Exception) {
                try {
                    Runtime.getRuntime().exec(arrayOf("am", "broadcast", "-a", "android.intent.action.REBOOT"))
                    return true
                } catch (e3: Exception) {
                    Log.e(TAG, "All reboot methods failed: ${e3.message}")
                    return false
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

    /** Thin wrapper over the shared SilentInstaller helper (also used by SetupActivity's initial
     *  provisioning installs) — kept here rather than inlined so every existing call site/log
     *  line in this class is unaffected; see SilentInstaller.kt for why this isn't unified with
     *  JobsClient's own install-session handling too. */
    private fun silentInstall(apkFile: File): Boolean = SilentInstaller.installSilently(this, apkFile)

    private fun isDeviceOwner(): Boolean {
        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
        return dpm.isDeviceOwnerApp(packageName)
    }

    private fun pushConfig(payload: JSONObject?) {
        val xmlContent = payload?.optString("configXml") ?: return
        // optString returns "" (not null) when the key is absent, so the `?: return` above
        // never fires for a bodyless command — and the "Push Config" button on the scanner
        // detail page sends {} unless an admin hand-types JSON. Without this guard, one click
        // truncates the converged rtlconfig.xml to zero bytes. Blank guard only; routing this
        // command through the shared rtConfig builder is separate follow-up work.
        if (xmlContent.isBlank()) {
            Log.w(TAG, "pushConfig: configXml missing or blank — refusing to overwrite rtlconfig.xml")
            return
        }
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
            if (!pinManager.isManaged()) return
            val stored = pinManager.currentPin()
            if (stored == null) {
                // First managed boot: generate + set a system PIN.
                val applied = pinManager.setPin(pinManager.generatePin())
                Log.i(TAG, "Initial system PIN set: managed=${applied != null}")
            } else {
                // Re-assert the stored system PIN on every boot. Android 8.1 has no API to
                // forbid on-device PIN changes, so re-asserting reverts any user change on
                // the next reboot — the practical enforcement of "system PIN only".
                val applied = pinManager.setPin(stored)
                Log.i(TAG, "System PIN re-asserted: ok=${applied != null}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "maybeInitializePin failed: ${e.message}")
        }
    }

    // ============ DEVICE OWNER RESTRICTIONS / UNINSTALL PROTECTION (item 2) ============

    /** Runs on every service start (onCreate) and via the apply_policies command. No-ops
     *  (logged, not thrown) when not Device Owner. Deliberately does NOT set
     *  DISALLOW_INSTALL_UNKNOWN_SOURCES (both business apps are sideloaded — this would break
     *  installs) or DISALLOW_DEBUGGING_FEATURES (would permanently lock the USB setup wizard
     *  out of the device). Every dpm call is individually try/caught so one failure can't
     *  skip the rest or crash the service. */
    private fun applyPolicies() {
        val result = JSONObject()
        result.put("ranAt", System.currentTimeMillis() / 1000)
        try {
            if (!isDeviceOwner()) {
                Log.i(TAG, "applyPolicies: not device owner — no-op")
                result.put("deviceOwner", false)
                lastPolicyResult = result
                return
            }
            result.put("deviceOwner", true)

            val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val admin = ComponentName(this, DeviceAdminReceiver::class.java)

            val restrictions = JSONObject()
            for (restriction in listOf(
                UserManager.DISALLOW_FACTORY_RESET,
                // UserManager has no DISALLOW_ADD_ACCOUNT constant — DISALLOW_MODIFY_ACCOUNTS
                // is the real restriction governing adding/removing accounts on-device.
                UserManager.DISALLOW_MODIFY_ACCOUNTS,
                UserManager.DISALLOW_SAFE_BOOT,
                // Blocks Settings > Apps > Force stop / Clear data. Verified on a TC51 that a
                // force-stop wipes enabled_accessibility_services outright (Android's app
                // "stopped" state disables accessibility services), which would permanently
                // kill remote troubleshooting on that scanner — and re-enabling it needs a
                // shell, i.e. physically collecting the device. This restriction is what makes
                // the screen reader survive an employee poking around in Settings.
                UserManager.DISALLOW_APPS_CONTROL,
                // Keeps the IE Tires tire wallpaper in place. The agent writes it once rather
                // than re-asserting on every start, so this restriction is what actually makes
                // it stick instead of a pointless tug of war with whoever changed it.
                UserManager.DISALLOW_SET_WALLPAPER
            )) {
                val ok = try {
                    dpm.addUserRestriction(admin, restriction)
                    alog(Log.INFO, "applyPolicies: restriction applied: $restriction")
                    true
                } catch (e: Exception) {
                    Log.w(TAG, "applyPolicies: restriction failed ($restriction): ${e.message}")
                    false
                }
                restrictions.put(restriction, ok)
            }
            result.put("restrictions", restrictions)

            val uninstallBlocked = JSONObject()
            for (pkg in listOf(
                "com.ietires.scanneragent",
                "com.importexporttire.tiretrack",
                "com.rt_systems.rtlhandsfree"
            )) {
                val ok = try {
                    dpm.setUninstallBlocked(admin, pkg, true)
                    alog(Log.INFO, "applyPolicies: uninstall blocked for $pkg")
                    true
                } catch (e: Exception) {
                    Log.w(TAG, "applyPolicies: uninstall-block failed for $pkg: ${e.message}")
                    false
                }
                uninstallBlocked.put(pkg, ok)
            }
            result.put("uninstallBlocked", uninstallBlocked)
        } catch (e: Exception) {
            // Belt-and-suspenders: applyPolicies runs in onCreate, so an uncaught exception
            // here would crash-loop the agent just like the PIN-policy hiccup this module has
            // already been bitten by once.
            Log.w(TAG, "applyPolicies failed: ${e.message}", e)
            result.put("error", e.message ?: "unknown")
        }
        lastPolicyResult = result
    }

    // ============ HOME SCREEN (replaces stock Launcher3 — see HomeActivity.kt) ============

    private fun homeScreenPrefs() = getSharedPreferences("home_screen", Context.MODE_PRIVATE)

    private fun isHomeScreenEnabled(): Boolean = homeScreenPrefs().getBoolean("enabled", true)

    /** Applies (or removes) HomeActivity as the device's persistent-preferred HOME activity,
     *  per the home_screen/enabled flag (default true — new scanners get the reduced 3-tile
     *  home screen from first boot). No-op (logged) if not Device Owner, same precondition as
     *  every other DPM call in applyPolicies() — addPersistentPreferredActivity and
     *  clearPackagePersistentPreferredActivities both require Device Owner.
     *
     *  Called from onCreate (alongside applyPolicies, so it's re-asserted on every service
     *  start) and directly from setHome() below for an immediate effect when the flag is
     *  flipped via the set_home command. Wrapped entirely in try/catch: this runs in onCreate,
     *  so an uncaught exception here would crash-loop the service exactly like the PIN-policy
     *  and applyPolicies hiccups this module has already been bitten by. */
    private fun applyHomeScreenPreference() {
        try {
            if (!isDeviceOwner()) {
                Log.i(TAG, "applyHomeScreenPreference: not device owner — no-op")
                return
            }
            val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val admin = ComponentName(this, DeviceAdminReceiver::class.java)
            val filter = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            if (isHomeScreenEnabled()) {
                dpm.addPersistentPreferredActivity(admin, filter, ComponentName(this, HomeActivity::class.java))
                alog(Log.INFO, "applyHomeScreenPreference: HomeActivity set as persistent-preferred HOME")
            } else {
                // No per-filter clear API exists — clearPackagePersistentPreferredActivities
                // removes every persistent-preferred registration THIS app has made, for any
                // filter. Safe here since HomeActivity's HOME filter is the only one this app
                // ever registers. This is what actually lets stock Launcher3 win the HOME
                // resolution again (rather than just leaving a stale, no-longer-desired
                // preference in place).
                dpm.clearPackagePersistentPreferredActivities(admin, packageName)
                alog(Log.INFO, "applyHomeScreenPreference: cleared persistent-preferred HOME — stock Launcher3 restored")
            }
        } catch (e: Exception) {
            Log.w(TAG, "applyHomeScreenPreference failed: ${e.message}", e)
        }
    }

    /** set_home command: payload.enabled (boolean, default true if payload/field missing)
     *  toggles whether HomeActivity is the device's persistent-preferred HOME activity.
     *
     *  This is the escape hatch for a broken/unwanted home screen: MqttService (this class)
     *  runs independently of whatever HomeActivity is doing, so even a HomeActivity that fails
     *  to draw at all is still remotely recoverable by sending set_home with enabled=false —
     *  which restores stock Launcher3 immediately, no reboot required.
     *
     *  Returns true if the preference was actually applied (i.e. this is Device Owner) — used
     *  by executeJobCommand to report FAILED (retryable) instead of a false SUCCEEDED when it
     *  isn't. The cmd/scanners/# path above ignores the return value; behaviour there is
     *  unaffected. */
    private fun setHome(payload: JSONObject?): Boolean {
        val enabled = payload?.optBoolean("enabled", true) ?: true
        homeScreenPrefs().edit().putBoolean("enabled", enabled).apply()
        Log.i(TAG, "set_home: enabled=$enabled")
        applyHomeScreenPreference()
        publishTelemetry() // report the new homeScreenEnabled flag immediately
        return isDeviceOwner()
    }

    // ============ SIDELOAD / APP-CHANGE LOGGING (item 3) ============

    private fun queueAppChange(evt: JSONObject) {
        synchronized(appChangeLock) {
            appChangeQueue.addLast(evt)
            while (appChangeQueue.size > MAX_APP_CHANGE_EVENTS) appChangeQueue.removeFirst()
        }
    }

    /** Drains the queue into a JSONArray for telemetry; clearing it here is what keeps the
     *  same events from being re-reported on the next publish. */
    private fun drainAppChangeQueue(): JSONArray {
        synchronized(appChangeLock) {
            val arr = JSONArray()
            for (evt in appChangeQueue) arr.put(evt)
            appChangeQueue.clear()
            return arr
        }
    }

    /** ACTION_PACKAGE_ADDED/REMOVED (with a "package" data scheme) are implicit broadcasts
     *  Android 8.0+ deliberately excludes from the set a <receiver> manifest entry is still
     *  allowed to declare for — a manifest registration for these two actions would silently
     *  never fire on this API 27 fleet. The only thing that actually works is a
     *  context.registerReceiver() call from a running component, so it's registered here in
     *  the foreground service (which is what stays alive under START_STICKY) and unregistered
     *  in onDestroy. */
    private fun registerPackageChangeReceiver() {
        if (packageChangeReceiver != null) return
        try {
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_PACKAGE_ADDED)
                addAction(Intent.ACTION_PACKAGE_REMOVED)
                addDataScheme("package")
            }
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) {
                    try {
                        val pkg = intent.data?.schemeSpecificPart ?: return
                        val added = intent.action == Intent.ACTION_PACKAGE_ADDED
                        val replacing = intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)
                        var versionName: String? = null
                        var installer: String? = null
                        if (added) {
                            try { versionName = packageManager.getPackageInfo(pkg, 0).versionName } catch (e: Exception) { /* gone already */ }
                            try { installer = packageManager.getInstallerPackageName(pkg) } catch (e: Exception) { /* not queryable */ }
                        }
                        val evt = JSONObject().apply {
                            put("event", if (added) "added" else "removed")
                            put("package", pkg)
                            put("versionName", versionName ?: JSONObject.NULL)
                            put("installerPackage", installer ?: JSONObject.NULL)
                            put("replacing", replacing)
                            put("timestamp", System.currentTimeMillis() / 1000)
                        }
                        queueAppChange(evt)
                        alog(Log.INFO, "App change detected: $evt")
                    } catch (e: Exception) {
                        Log.w(TAG, "packageChangeReceiver.onReceive failed: ${e.message}", e)
                    }
                }
            }
            registerReceiver(receiver, filter)
            packageChangeReceiver = receiver
            Log.i(TAG, "Package add/remove receiver registered (runtime-registered — see comment above)")
        } catch (e: Exception) {
            Log.w(TAG, "Could not register package change receiver: ${e.message}", e)
        }
    }

    // ============ ON-DEMAND SCREEN SNAPSHOT (items 4/5) ============

    private fun buildScreenPayload(): JSONObject {
        val obj = JSONObject()
        val snap = ScreenReaderService.latest()
        if (snap != null) {
            obj.put("package", snap.packageName)
            obj.put("activity", snap.className)
            obj.put("title", snap.windowTitle)
            obj.put("text", JSONArray(snap.text))
            obj.put("truncated", snap.truncated)
            obj.put("snapshotAt", snap.at / 1000)
        } else {
            obj.put("available", false)
        }
        obj.put("log", JSONArray(logTailSnapshot()))
        return obj
    }

    /** get_screen command: publish immediately with the screen field attached, then keep
     *  publishing on a fast ~3s cadence for ~2 minutes before auto-reverting to the normal
     *  5-minute cadence. Always clears any previously-scheduled fast-publish callbacks first,
     *  so repeated get_screen commands can't stack Handler callbacks — at most one fast-tick
     *  Runnable and one stop-Runnable are ever pending. */
    private fun enterFastPublishMode() {
        handler.removeCallbacks(fastPublishRunnable)
        fastPublishStopRunnable?.let { handler.removeCallbacks(it) }

        fastPublishActive = true
        Log.i(TAG, "get_screen: entering fast-publish mode (~${FAST_PUBLISH_INTERVAL_MS}ms for ~${FAST_PUBLISH_DURATION_MS / 1000}s)")
        fastPublishRunnable.run() // publishes now (with screen) and schedules the next tick

        val stop = Runnable {
            fastPublishActive = false
            handler.removeCallbacks(fastPublishRunnable)
            fastPublishStopRunnable = null
            Log.i(TAG, "get_screen: fast-publish window ended, back to normal cadence")
        }
        fastPublishStopRunnable = stop
        handler.postDelayed(stop, FAST_PUBLISH_DURATION_MS)
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
