package com.ietires.scanneragent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Remote control of DataWedge — the Zebra service that actually drives the barcode imager.
 *
 * WHY THIS EXISTS AT ALL: the setup wizard's DataWedge step (`WebAdbClient.configureDataWedgeTab`)
 * shells out `am broadcast --es com.symbol.datawedge.api.SET_CONFIG '<json string>'`. DataWedge
 * reads that extra with `getBundleExtra(SET_CONFIG)`, so a *string* extra is silently ignored —
 * there is no way to build the nested Bundle SET_CONFIG requires from an adb command line. That
 * step has therefore never configured anything, which is consistent with the wizard logging
 * `datawedge: success` on scanners that then don't scan, and with `lib/scanners/verify.ts`
 * marking the check permanently `unverified` (it could never read a result back). Sending the
 * real Bundles from inside an app is the only correct way to do this, and it doubles as the
 * remote fix for a fleet scanner that can't be walked to a bench.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never resets the BARCODE plugin's decoder set
 * (`RESET_CONFIG` = "false"). Turning decoders back to DataWedge defaults would silently drop
 * any symbology someone enabled by hand on a working scanner (I2of5 for DOT codes, for one),
 * so a repair must not quietly change *which* barcodes a device reads. Only the switches that
 * make scanning work at all are asserted, plus the documented output format.
 *
 * Target config mirrors the documented manual runbook (tools/scanner-setup/src/index.ts:357 —
 * "DataWedge → Profile0 → Suffix: ! | Send data: ✓ | Send TAB: ✓").
 */
class DataWedgeConfigurator(private val context: Context) {

    companion object {
        const val DW_PACKAGE = "com.symbol.datawedge"

        private const val ACTION = "com.symbol.datawedge.api.ACTION"
        private const val RESULT_ACTION = "com.symbol.datawedge.api.RESULT_ACTION"

        private const val EXTRA_ENABLE_DATAWEDGE = "com.symbol.datawedge.api.ENABLE_DATAWEDGE"
        private const val EXTRA_SET_CONFIG = "com.symbol.datawedge.api.SET_CONFIG"
        private const val EXTRA_SCANNER_INPUT_PLUGIN = "com.symbol.datawedge.api.SCANNER_INPUT_PLUGIN"
        private const val EXTRA_GET_ACTIVE_PROFILE = "com.symbol.datawedge.api.GET_ACTIVE_PROFILE"
        private const val EXTRA_GET_VERSION_INFO = "com.symbol.datawedge.api.GET_VERSION_INFO"

        private const val EXTRA_SEND_RESULT = "SEND_RESULT"
        private const val EXTRA_COMMAND_IDENTIFIER = "COMMAND_IDENTIFIER"
        private const val RESULT_SET_CONFIG = "com.symbol.datawedge.api.RESULT_SET_CONFIG"
        private const val RESULT_GET_ACTIVE_PROFILE = "com.symbol.datawedge.api.RESULT_GET_ACTIVE_PROFILE"
        private const val RESULT_GET_VERSION_INFO = "com.symbol.datawedge.api.RESULT_GET_VERSION_INFO"

        /** Profile0 is DataWedge's catch-all: it serves every app with no profile of its own,
         *  which is how TireTrack and RT Locator get scan input. */
        private const val DEFAULT_PROFILE = "Profile0 (default)"

        /** Documented output format for this fleet. Overridable per command so a one-off device
         *  can be matched to a peer without shipping a new agent. */
        private const val DEFAULT_SUFFIX = "!"

        /** DataWedge answers a SET_CONFIG in well under a second on a TC51; the ceiling is only
         *  here so a missing/wedged DataWedge can't hold the caller's thread forever. */
        private const val RESULT_TIMEOUT_MS = 8_000L
    }

    /** Everything the caller (and the operator reading telemetry) needs to know about one run. */
    class Outcome(
        val dataWedgePresent: Boolean,
        val setConfigSucceeded: Boolean,
        val failureReason: String?,
        val detail: JSONObject
    )

    @Volatile private var lastOutcome: JSONObject? = null

    /**
     * Asserts a scanning-capable DataWedge configuration and reports back what DataWedge said.
     *
     * Payload (all optional): `profile`, `suffix`, `sendTab`, `sendEnter`, `enableDataWedge`.
     */
    fun apply(payload: JSONObject?): Outcome {
        val detail = JSONObject()
        detail.put("attemptedAt", System.currentTimeMillis() / 1000)

        val dwVersion = installedVersion()
        detail.put("dataWedgeInstalled", dwVersion != null)
        if (dwVersion != null) detail.put("dataWedgePackageVersion", dwVersion)
        detail.put("dataWedgePackageEnabled", isPackageEnabled())

        if (dwVersion == null) {
            // Nothing to configure and nothing a retry will change — a TC51 without DataWedge
            // has had it uninstalled/disabled at a level this command can't reach.
            val reason = "DataWedge ($DW_PACKAGE) is not installed on this device"
            detail.put("error", reason)
            lastOutcome = detail
            MqttService.alog(Log.WARN, "datawedge_config: $reason")
            return Outcome(false, false, reason, detail)
        }
        if (!isPackageEnabled()) {
            // Worth surfacing loudly: a disabled DataWedge package is exactly what a bad
            // lockdown pass would leave behind, and no amount of intent config fixes it.
            MqttService.alog(
                Log.WARN,
                "datawedge_config: $DW_PACKAGE is present but DISABLED — config will not take effect until it is re-enabled"
            )
        }

        val profile = payload?.optString("profile")?.takeIf { it.isNotBlank() } ?: DEFAULT_PROFILE
        val suffix = if (payload != null && payload.has("suffix")) payload.optString("suffix") else DEFAULT_SUFFIX
        val sendTab = payload?.optBoolean("sendTab", true) ?: true
        val sendEnter = payload?.optBoolean("sendEnter", false) ?: false
        val enableDataWedge = payload?.optBoolean("enableDataWedge", true) ?: true

        detail.put("profile", profile)
        detail.put("suffix", suffix)
        detail.put("sendTab", sendTab)
        detail.put("sendEnter", sendEnter)

        val commandId = "IECENTRAL_DW_${System.currentTimeMillis()}"
        val results = JSONArray()
        val setConfigLatch = CountDownLatch(1)
        // AtomicReference rather than captured locals: the receiver runs on the main thread while
        // apply() blocks on another, so these cross a thread boundary and need the memory
        // guarantees a plain captured `var` doesn't give.
        val setConfigResult = java.util.concurrent.atomic.AtomicReference<String?>(null)
        val activeProfile = java.util.concurrent.atomic.AtomicReference<String?>(null)
        val dwApiVersion = java.util.concurrent.atomic.AtomicReference<String?>(null)

        // One receiver for the whole run. Every RESULT_ACTION extra is captured rather than
        // only the keys we expect: the result key names vary across DataWedge versions, and an
        // unrecognised-but-recorded result is far more useful than a silent success.
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                val extras = intent?.extras ?: return
                val entry = JSONObject()
                for (key in extras.keySet()) {
                    val short = key.removePrefix("com.symbol.datawedge.api.")
                    entry.put(short, describe(extras.get(key)))
                }
                synchronized(results) { results.put(entry) }

                extras.getString(RESULT_GET_ACTIVE_PROFILE)?.let { activeProfile.set(it) }
                (extras.get(RESULT_GET_VERSION_INFO) as? Bundle)?.let {
                    dwApiVersion.set(it.getString("DATAWEDGE") ?: it.getString("DATAWEDGE_VERSION"))
                }
                extras.getString(RESULT_SET_CONFIG)?.let {
                    if (extras.getString(EXTRA_COMMAND_IDENTIFIER) == commandId ||
                        extras.getString(EXTRA_COMMAND_IDENTIFIER) == null
                    ) {
                        setConfigResult.set(it)
                        setConfigLatch.countDown()
                    }
                }
            }
        }

        val filter = IntentFilter(RESULT_ACTION).apply { addCategory(Intent.CATEGORY_DEFAULT) }
        context.registerReceiver(receiver, filter)
        try {
            // 1. The global on/off switch. This is the first suspect for "scans nothing at all",
            //    and it is not part of any profile — a profile can be perfect while DataWedge
            //    itself is switched off.
            if (enableDataWedge) {
                send { it.putExtra(EXTRA_ENABLE_DATAWEDGE, true) }
            }

            // 2. Profile config, as the nested Bundles DataWedge actually reads.
            send {
                it.putExtra(EXTRA_SET_CONFIG, buildProfileBundle(profile, suffix, sendTab, sendEnter))
                it.putExtra(EXTRA_SEND_RESULT, "true")
                it.putExtra(EXTRA_COMMAND_IDENTIFIER, commandId)
            }

            // 3. Arm the scanner for the foreground app. SET_CONFIG enables the plugin in the
            //    stored profile; this is what makes the currently-running app able to scan
            //    without a restart, which is the difference between "fixed" and "fixed after
            //    someone reboots it".
            send { it.putExtra(EXTRA_SCANNER_INPUT_PLUGIN, "ENABLE_PLUGIN") }

            // 4. Read back, so this command proves something instead of asserting it.
            send { it.putExtra(EXTRA_GET_ACTIVE_PROFILE, "") }
            send { it.putExtra(EXTRA_GET_VERSION_INFO, "") }

            val confirmed = setConfigLatch.await(RESULT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            if (!confirmed) {
                MqttService.alog(Log.WARN, "datawedge_config: no SET_CONFIG result within ${RESULT_TIMEOUT_MS}ms")
            }
            // Late results (GET_ACTIVE_PROFILE / version) usually land within a few hundred ms
            // of the latch; a short settle keeps them in the same telemetry payload.
            Thread.sleep(400)
        } catch (e: Exception) {
            detail.put("error", e.message ?: e.javaClass.simpleName)
            MqttService.alog(Log.ERROR, "datawedge_config threw: ${e.message}")
        } finally {
            try {
                context.unregisterReceiver(receiver)
            } catch (e: Exception) {
                Log.w(MqttService.TAG, "datawedge_config: receiver already unregistered: ${e.message}")
            }
        }

        val finalResult = setConfigResult.get()
        detail.put("setConfigResult", finalResult ?: "no result")
        activeProfile.get()?.let { detail.put("activeProfile", it) }
        dwApiVersion.get()?.let { detail.put("dataWedgeVersion", it) }
        synchronized(results) { if (results.length() > 0) detail.put("results", results) }

        val ok = finalResult == "SUCCESS"
        val reason = when {
            ok -> null
            finalResult == null -> "DataWedge sent no SET_CONFIG result within ${RESULT_TIMEOUT_MS}ms"
            else -> "DataWedge reported SET_CONFIG $finalResult"
        }
        lastOutcome = detail
        MqttService.alog(
            if (ok) Log.INFO else Log.WARN,
            "datawedge_config: profile=$profile setConfig=${finalResult ?: "none"} active=${activeProfile.get() ?: "?"}"
        )
        return Outcome(true, ok, reason, detail)
    }

    /**
     * DataWedge facts worth carrying on every telemetry tick, whether or not the command has
     * ever run: whether the package is installed and enabled is the single most useful thing to
     * know about a scanner that won't scan, and today nothing in the fleet reports it.
     */
    fun state(): JSONObject {
        val state = JSONObject()
        val version = installedVersion()
        state.put("installed", version != null)
        if (version != null) state.put("packageVersion", version)
        state.put("packageEnabled", isPackageEnabled())
        lastOutcome?.let { state.put("lastConfig", it) }
        return state
    }

    // ---- internals ----

    private fun send(build: (Intent) -> Unit) {
        val intent = Intent(ACTION)
        // Android 8.1 will not deliver an implicit broadcast to a manifest receiver in another
        // app; naming the package makes this explicit enough to reach DataWedge.
        intent.setPackage(DW_PACKAGE)
        build(intent)
        context.sendBroadcast(intent)
    }

    private fun buildProfileBundle(
        profile: String,
        suffix: String,
        sendTab: Boolean,
        sendEnter: Boolean
    ): Bundle {
        val barcodeParams = Bundle().apply {
            // The two switches that decide whether the imager fires at all.
            putString("scanner_input_enabled", "true")
            putString("scanner_selection", "auto")
        }
        val barcode = Bundle().apply {
            putString("PLUGIN_NAME", "BARCODE")
            // "false" on purpose — see the class comment: never silently reset the decoder set.
            putString("RESET_CONFIG", "false")
            putBundle("PARAM_LIST", barcodeParams)
        }

        val keystrokeParams = Bundle().apply {
            putString("keystroke_output_enabled", "true")
        }
        val keystroke = Bundle().apply {
            putString("PLUGIN_NAME", "KEYSTROKE")
            putString("RESET_CONFIG", "false")
            putBundle("PARAM_LIST", keystrokeParams)
        }

        // Basic Data Formatting is what the runbook's "Suffix / Send data / Send TAB" settings
        // actually are — the old `keystroke_send_tab` param the wizard sent does not exist.
        val bdfParams = Bundle().apply {
            putString("bdf_enabled", "true")
            putString("bdf_prefix", "")
            putString("bdf_suffix", suffix)
            putString("bdf_send_data", "true")
            putString("bdf_send_tab", if (sendTab) "true" else "false")
            putString("bdf_send_enter", if (sendEnter) "true" else "false")
        }
        val bdf = Bundle().apply {
            putString("PLUGIN_NAME", "BDF")
            putString("RESET_CONFIG", "false")
            putBundle("PARAM_LIST", bdfParams)
        }

        return Bundle().apply {
            putString("PROFILE_NAME", profile)
            putString("PROFILE_ENABLED", "true")
            putString("CONFIG_MODE", "UPDATE")
            putParcelableArray("PLUGIN_CONFIG", arrayOf(barcode, keystroke, bdf))
        }
    }

    private fun installedVersion(): String? = try {
        context.packageManager.getPackageInfo(DW_PACKAGE, 0).versionName
    } catch (e: PackageManager.NameNotFoundException) {
        null
    } catch (e: Exception) {
        Log.w(MqttService.TAG, "datawedge: version lookup failed: ${e.message}")
        null
    }

    private fun isPackageEnabled(): Boolean = try {
        when (context.packageManager.getApplicationEnabledSetting(DW_PACKAGE)) {
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER,
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED -> false
            else -> true
        }
    } catch (e: Exception) {
        // Not installed, or the setting is unreadable — state() already reports `installed`.
        false
    }

    /** Flattens an arbitrary result extra into something JSON can carry. */
    private fun describe(value: Any?): Any = when (value) {
        null -> JSONObject.NULL
        is String, is Boolean, is Int, is Long, is Double -> value
        is Bundle -> JSONObject().also { obj ->
            for (key in value.keySet()) obj.put(key.removePrefix("com.symbol.datawedge.api."), describe(value.get(key)))
        }
        is Array<*> -> JSONArray().also { arr -> value.forEach { arr.put(describe(it)) } }
        else -> value.toString()
    }
}
