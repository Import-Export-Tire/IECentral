package com.ietires.scanneragent

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputFilter
import android.text.InputType
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Setup screen shown when the scanner agent has no IoT config.
 * Handles: claim code → certs → enable unknown sources → download apps → install → configure device.
 */
class SetupActivity : Activity() {

    companion object {
        const val TAG = "ScannerSetup"
        const val UNKNOWN_SOURCES_REQUEST = 1001

        // Zebra bloatware to disable
        val BLOATWARE = listOf(
            "com.google.android.youtube",
            "com.google.android.music",
            "com.google.android.videos",
            "com.google.android.apps.docs",
            "com.google.android.apps.photos",
            "com.google.android.apps.maps",
            "com.google.android.gm",
            "com.google.android.apps.tachyon",
            "com.google.android.googlequicksearchbox",
            "com.android.chrome",
            "com.android.vending", // Play Store
        )
    }

    private lateinit var codeInput: EditText
    private lateinit var submitBtn: Button
    private lateinit var statusText: TextView
    private val executor = Executors.newSingleThreadExecutor()
    private var pendingApkInstalls = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(32), dp(64), dp(32), dp(32))
            setBackgroundColor(Color.WHITE)
        }

        // Import Export Tire branding. This is the screen a technician looks at for the whole
        // provisioning run, so it's where the logo earns its place. Scaled by width with the
        // aspect ratio preserved — the asset is 728x208 and has no alpha, which is fine against
        // this screen's white background but would show as a white box on a dark one.
        layout.addView(ImageView(this).apply {
            setImageResource(R.drawable.iet_logo)
            adjustViewBounds = true
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = "Import Export Tire"
            layoutParams = LinearLayout.LayoutParams(dp(240), LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(24)
            }
        })

        layout.addView(TextView(this).apply {
            text = "IE Scanner Agent"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
            setTextColor(Color.parseColor("#1e293b"))
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        })

        layout.addView(TextView(this).apply {
            text = "Setup"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTextColor(Color.parseColor("#64748b"))
            gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, dp(32))
        })

        layout.addView(TextView(this).apply {
            text = "Enter the provisioning code\nfrom IECentral"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTextColor(Color.parseColor("#475569"))
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(24))
        })

        codeInput = EditText(this).apply {
            hint = "XXXXXX"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f)
            typeface = Typeface.MONOSPACE
            gravity = Gravity.CENTER
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            filters = arrayOf(InputFilter.LengthFilter(6), InputFilter.AllCaps())
            setTextColor(Color.parseColor("#0891b2"))
            setHintTextColor(Color.parseColor("#cbd5e1"))
            letterSpacing = 0.3f
            setPadding(dp(16), dp(16), dp(16), dp(16))
            setBackgroundColor(Color.parseColor("#f1f5f9"))
        }
        layout.addView(codeInput, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { setMargins(0, 0, 0, dp(16)) })

        submitBtn = Button(this).apply {
            text = "Submit"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0891b2"))
            setPadding(dp(16), dp(14), dp(16), dp(14))
            isAllCaps = false
        }
        submitBtn.setOnClickListener { handleSubmit() }
        layout.addView(submitBtn, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { setMargins(0, 0, 0, dp(16)) })

        statusText = TextView(this).apply {
            text = ""
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTextColor(Color.parseColor("#64748b"))
            gravity = Gravity.CENTER
        }
        layout.addView(statusText)

        setContentView(layout)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == UNKNOWN_SOURCES_REQUEST && pendingApkInstalls) {
            pendingApkInstalls = false
            // Continue setup after user enabled unknown sources
            executor.execute { continueWithAppInstalls() }
        }
    }

    private fun handleSubmit() {
        val code = codeInput.text.toString().trim().uppercase()
        if (code.length != 6) {
            statusText.setTextColor(Color.parseColor("#ef4444"))
            statusText.text = "Enter a 6-character code"
            return
        }

        // Check connectivity BEFORE attempting the claim call. Without this, a scanner with no
        // Wi-Fi yet fails the claim with a raw UnknownHostException, and the technician sees
        // "Unable to resolve host ..." — meaningless to them. Left enabled/untouched on this
        // early return so they can just connect to Wi-Fi and press Submit again.
        if (!hasUsableNetwork()) {
            statusText.setTextColor(Color.parseColor("#ef4444"))
            statusText.text = "No network — connect to Wi-Fi, then try again."
            return
        }

        submitBtn.isEnabled = false
        codeInput.isEnabled = false
        updateStatus("Provisioning...")

        executor.execute {
            try {
                val result = claimProvision(code)
                if (result.has("error")) {
                    runOnUiThread {
                        statusText.setTextColor(Color.parseColor("#ef4444"))
                        statusText.text = result.getString("error")
                        submitBtn.isEnabled = true
                        codeInput.isEnabled = true
                    }
                    return@execute
                }

                saveProvisionData(result)
                updateStatus("Provisioned! Configuring device...", "#10b981")
                runOnUiThread {
                    submitBtn.visibility = View.GONE
                    codeInput.isEnabled = false
                }

                // Apply device settings
                applyDeviceSettings()

                // Disable bloatware
                disableBloatware()

                // Check unknown sources permission before installing apps. Not needed at all
                // when Device Owner — installApk() above goes through PackageInstaller
                // silently in that case, which never consults this setting.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !packageManager.canRequestPackageInstalls()
                    && !SilentInstaller.isDeviceOwner(this)) {
                    pendingApkInstalls = true
                    runOnUiThread {
                        statusText.text = "Enable 'Install unknown apps' for Scanner Agent, then press Back"
                        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))
                        startActivityForResult(intent, UNKNOWN_SOURCES_REQUEST)
                    }
                    return@execute
                }

                continueWithAppInstalls()
            } catch (e: java.net.UnknownHostException) {
                // DNS couldn't resolve the claim host — no usable network (or captive
                // portal/DNS blip that amounts to the same thing from a technician's seat).
                // Same plain message as the pre-flight hasUsableNetwork() check above, rather
                // than the raw "Unable to resolve host ..." this exception's own message reads.
                Log.w(TAG, "Setup failed: no network (${e.message})")
                runOnUiThread {
                    statusText.setTextColor(Color.parseColor("#ef4444"))
                    statusText.text = "No network — connect to Wi-Fi, then try again."
                    submitBtn.isEnabled = true
                    codeInput.isEnabled = true
                }
            } catch (e: java.io.IOException) {
                // Covers SocketTimeoutException, ConnectException, etc. — every one of these
                // means "couldn't reach the server", which reads to a technician exactly like
                // "no network" even when Wi-Fi itself is technically associated. Same plain
                // message rather than leaking the exception class/message. Caught after the
                // more specific UnknownHostException above (it's a subclass of IOException).
                Log.w(TAG, "Setup failed: network/IO error (${e.javaClass.simpleName}: ${e.message})")
                runOnUiThread {
                    statusText.setTextColor(Color.parseColor("#ef4444"))
                    statusText.text = "No network — connect to Wi-Fi, then try again."
                    submitBtn.isEnabled = true
                    codeInput.isEnabled = true
                }
            } catch (e: Exception) {
                Log.e(TAG, "Setup failed: ${e.message}", e)
                runOnUiThread {
                    statusText.setTextColor(Color.parseColor("#ef4444"))
                    statusText.text = "Error: ${e.message}"
                    submitBtn.isEnabled = true
                    codeInput.isEnabled = true
                }
            }
        }
    }

    /** Pre-flight connectivity check before attempting the claim-code POST. activeNetworkInfo
     *  is deprecated (API 29+) but is exactly what's available and reliable at this app's
     *  targetSdk 25 / minSdk 25 — the NetworkCapabilities/registerNetworkCallback replacement
     *  needs API 23+ callback bookkeeping that's overkill for a single yes/no check here. */
    @Suppress("DEPRECATION")
    private fun hasUsableNetwork(): Boolean {
        return try {
            val cm = getSystemService(CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            cm.activeNetworkInfo?.isConnected == true
        } catch (e: Exception) {
            // Fail open — a bug in this check itself shouldn't block a claim attempt that
            // might otherwise succeed.
            Log.w(TAG, "hasUsableNetwork check failed: ${e.message}")
            true
        }
    }

    private fun continueWithAppInstalls() {
        try {
            downloadAndInstallApps()

            // Grant permissions to installed apps
            grantAppPermissions()

            // Start MQTT service
            runOnUiThread {
                updateStatus("Starting agent...", "#10b981")
                val serviceIntent = Intent(this@SetupActivity, MqttService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent)
                } else {
                    startService(serviceIntent)
                }
                updateStatus("Setup complete!", "#10b981")
                statusText.postDelayed({ finish() }, 3000)
            }
        } catch (e: Exception) {
            Log.e(TAG, "App install failed: ${e.message}", e)
            // Still start the agent even if app installs fail
            runOnUiThread {
                updateStatus("Apps may need manual install. Starting agent...", "#f59e0b")
                val serviceIntent = Intent(this@SetupActivity, MqttService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent)
                } else {
                    startService(serviceIntent)
                }
                statusText.postDelayed({ finish() }, 3000)
            }
        }
    }

    private fun downloadAndInstallApps() {
        val apps = listOf("tiretrack" to "TireTrack", "rtlocator" to "RT Locator")

        for ((appId, appName) in apps) {
            try {
                updateStatus("Fetching $appName...")

                val apiUrl = URL("${BuildConfig.APK_API_URL}?app=$appId")
                val conn = apiUrl.openConnection() as HttpURLConnection
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                val response = conn.inputStream.bufferedReader().readText()
                conn.disconnect()

                val info = JSONObject(response)
                val downloadUrl = info.optString("downloadUrl", "")
                if (downloadUrl.isEmpty()) {
                    Log.w(TAG, "$appName APK not available, skipping")
                    continue
                }

                updateStatus("Downloading $appName...")
                val apkFile = File(cacheDir, "$appId.apk")
                val dlConn = URL(downloadUrl).openConnection() as HttpURLConnection
                dlConn.connectTimeout = 30000
                dlConn.readTimeout = 600000 // 10 min for large APKs like TireTrack (88MB)
                dlConn.inputStream.use { input ->
                    FileOutputStream(apkFile).use { output ->
                        val buffer = ByteArray(8192)
                        var totalRead = 0L
                        var bytesRead: Int
                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            output.write(buffer, 0, bytesRead)
                            totalRead += bytesRead
                            if (totalRead % (1024 * 1024) == 0L) {
                                val mb = totalRead / (1024 * 1024)
                                updateStatus("Downloading $appName... ${mb}MB")
                            }
                        }
                    }
                }
                dlConn.disconnect()
                Log.i(TAG, "$appName downloaded: ${apkFile.length() / 1024}KB")

                updateStatus("Installing $appName...")
                installApk(apkFile)

                // Wait for user to complete install prompt
                Thread.sleep(5000)

            } catch (e: Exception) {
                Log.w(TAG, "Failed to install $appName: ${e.message}")
            }
        }
    }

    private fun installApk(apkFile: File) {
        // Device Owner: install silently via PackageInstaller, no interactive installer and no
        // Play Protect "blocked as unsafe — install anyway" prompt (both IET apps are
        // debug-signed, so ACTION_VIEW would trigger that prompt on every one of ~20 scanners
        // being provisioned). The wizard promotes to Device Owner before this screen ever runs,
        // so this path is available for every normal provisioning run. Falls back to the
        // interactive intent path only when not Device Owner, or if the silent session itself
        // fails for some reason.
        if (SilentInstaller.isDeviceOwner(this)) {
            if (SilentInstaller.installSilently(this, apkFile)) {
                Log.i(TAG, "Silent install committed for ${apkFile.name}")
                return
            }
            Log.w(TAG, "Silent install failed for ${apkFile.name} — falling back to interactive install")
        }

        val intent = Intent(Intent.ACTION_VIEW)
        val uri: Uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            FileProvider.getUriForFile(this, "${packageName}.fileprovider", apkFile)
        } else {
            Uri.fromFile(apkFile)
        }
        intent.setDataAndType(uri, "application/vnd.android.package-archive")
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
        startActivity(intent)
    }

    @Suppress("DEPRECATION")
    private fun applyDeviceSettings() {
        try {
            // Screen timeout: 30 minutes
            Settings.System.putInt(contentResolver, Settings.System.SCREEN_OFF_TIMEOUT, 1800000)
            Log.i(TAG, "Screen timeout set to 30 min")
        } catch (e: Exception) {
            Log.w(TAG, "Could not set screen timeout: ${e.message}")
        }

        try {
            // Disable auto-rotate
            Settings.System.putInt(contentResolver, Settings.System.ACCELEROMETER_ROTATION, 0)
            Log.i(TAG, "Auto-rotate disabled")
        } catch (e: Exception) {
            Log.w(TAG, "Could not disable auto-rotate: ${e.message}")
        }
    }

    private fun disableBloatware() {
        var disabled = 0
        for (pkg in BLOATWARE) {
            try {
                // pm disable-user works without root on Zebra devices
                val process = Runtime.getRuntime().exec(arrayOf("pm", "disable-user", "--user", "0", pkg))
                process.waitFor()
                if (process.exitValue() == 0) {
                    disabled++
                    Log.i(TAG, "Disabled: $pkg")
                }
            } catch (e: Exception) {
                // Package not installed or can't disable, skip
            }
        }
        Log.i(TAG, "Disabled $disabled bloatware apps")
    }

    private fun grantAppPermissions() {
        // Grant storage permissions to RT Locator and TireTrack via pm grant
        // This works on Zebra devices where the scanner agent has device admin
        val grants = listOf(
            "com.rt_systems.rtlhandsfree" to "android.permission.READ_EXTERNAL_STORAGE",
            "com.rt_systems.rtlhandsfree" to "android.permission.WRITE_EXTERNAL_STORAGE",
            "com.importexporttire.tiretrack" to "android.permission.READ_EXTERNAL_STORAGE",
            "com.importexporttire.tiretrack" to "android.permission.WRITE_EXTERNAL_STORAGE",
            "com.importexporttire.tiretrack" to "android.permission.CAMERA",
        )
        for ((pkg, perm) in grants) {
            try {
                val process = Runtime.getRuntime().exec(arrayOf("pm", "grant", pkg, perm))
                process.waitFor()
                if (process.exitValue() == 0) {
                    Log.i(TAG, "Granted $perm to $pkg")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not grant $perm to $pkg: ${e.message}")
            }
        }
    }

    private fun claimProvision(code: String): JSONObject {
        val url = URL(BuildConfig.CLAIM_URL)
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json")
        conn.doOutput = true
        conn.connectTimeout = 15000
        conn.readTimeout = 15000

        val body = JSONObject().apply { put("code", code) }
        OutputStreamWriter(conn.outputStream).use { it.write(body.toString()) }

        val responseCode = conn.responseCode
        val responseBody = if (responseCode in 200..299) {
            conn.inputStream.bufferedReader().readText()
        } else {
            conn.errorStream?.bufferedReader()?.readText() ?: """{"error": "HTTP $responseCode"}"""
        }
        conn.disconnect()
        return JSONObject(responseBody)
    }

    private fun saveProvisionData(data: JSONObject) {
        File(filesDir, "certificate.pem").writeText(data.getString("certificatePem"))
        File(filesDir, "private.key").writeText(data.getString("privateKey"))
        val caBytes = assets.open("AmazonRootCA1.pem").readBytes()
        File(filesDir, "root-ca.pem").writeBytes(caBytes)
        val config = JSONObject().apply {
            put("thingName", data.getString("thingName"))
            put("iotEndpoint", data.getString("iotEndpoint"))
        }
        File(filesDir, "iot_config.json").writeText(config.toString())
        Log.i(TAG, "Saved IoT config for ${data.getString("thingName")}")

        // Save RT Locator config
        val rtConfig = data.optString("rtConfigXml", "")
        if (rtConfig.isNotEmpty()) {
            try {
                val docsDir = File(android.os.Environment.getExternalStorageDirectory(), "My Documents")
                docsDir.mkdirs()
                File(docsDir, "rtlconfig.xml").writeText(rtConfig)
                Log.i(TAG, "Saved RT config to ${docsDir.absolutePath}/rtlconfig.xml")
            } catch (e: Exception) {
                Log.w(TAG, "Could not save RT config: ${e.message}")
            }
        }
    }

    private fun updateStatus(text: String, color: String = "#64748b") {
        runOnUiThread {
            statusText.setTextColor(Color.parseColor(color))
            statusText.text = text
        }
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics
        ).toInt()
    }
}
