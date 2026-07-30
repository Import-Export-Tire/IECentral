package com.ietires.scanneragent

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.eclipse.paho.client.mqttv3.IMqttActionListener
import org.eclipse.paho.client.mqttv3.IMqttToken
import org.eclipse.paho.client.mqttv3.MqttAsyncClient
import org.eclipse.paho.client.mqttv3.MqttMessage
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Outcome of executing a job/command, mapped to AWS IoT Jobs status by JobsClient:
 *  Success -> SUCCEEDED, Retryable -> FAILED (AWS retries), Permanent -> REJECTED (AWS does
 *  NOT retry — use only for things that can never succeed on a retry with the same payload:
 *  unknown command, malformed document, checksum mismatch). Getting Retryable vs Permanent
 *  backwards either burns the retry budget on something that can never work, or gives up on
 *  something transient that would have succeeded a minute later. */
sealed class JobOutcome {
    object Success : JobOutcome()
    data class Retryable(val detail: String) : JobOutcome()
    data class Permanent(val detail: String) : JobOutcome()
}

/**
 * AWS IoT Jobs device-side client. This is the "next powerup" mechanism: unlike the
 * cmd/scanners/# MQTT path (nothing queued for a disconnected client — a command sent to a
 * scanner that's off or out of Wi-Fi is discarded permanently), a job execution sits QUEUED on
 * the AWS side indefinitely until this device connects and reports a terminal status. A
 * persistent MQTT session is NOT an adequate substitute (AWS IoT persistent sessions expire —
 * 1 hour default, 7 days max), so this always re-asks "what's next for me?" on every connect
 * rather than relying on anything surviving the gap.
 *
 * Every public entry point (onConnected, onMessage) is wrapped in try/catch: a malformed job
 * or notification must never crash the service — an agent that dies stops receiving jobs
 * entirely, and recovering it needs a physical USB visit to re-provision.
 *
 * Job document format (deliberately close to the existing cmd/scanners/# vocabulary so both
 * paths share one implementation and can't drift apart):
 *   { "version": "1", "command": "<name>", "payload": { ... } }
 */
class JobsClient(
    private val mqttClient: MqttAsyncClient,
    private val thingName: String,
    private val context: Context,
    private val commandExecutor: (command: String, payload: JSONObject?) -> JobOutcome
) {
    companion object {
        private const val INSTALL_RESULT_TIMEOUT_MS = 5 * 60 * 1000L
    }

    private data class JobExecution(val jobId: String, val versionNumber: Int, val jobDocument: JSONObject?)

    // Guards the "one job at a time" bookkeeping below. AWS IoT Jobs only ever surfaces a
    // single "next" execution at a time anyway, so this is mostly protecting against the same
    // execution being re-announced (a retried notify-next, or the $next/get/accepted answer to
    // our own request echoing back the job we already started).
    private val jobLock = Any()
    @Volatile private var activeJobId: String? = null
    @Volatile private var activeVersionNumber: Int = 0

    // Only publish $next/get once BOTH its response topics are subscribed — this ordering is
    // the entire offline-convergence path (it's what makes a job queued while the device was
    // off/out-of-range run on next powerup), so it matters more than anything else here.
    private val getNextSubsReady = AtomicInteger(0)

    /** Called once per successful MQTT connect (including reconnects). Resubscribes everything
     *  (isCleanSession=true means the broker forgot our subscriptions) and resets local
     *  "active job" tracking — a disconnect may have interrupted whatever we were doing
     *  mid-flight, and MemoryPersistence means we have no durable record of it anyway. Every
     *  command handler this can cause to re-run (lock, push_config, apply_policies,
     *  update_pin, get_screen, install_apk's own idempotent `pm install`) is safe to run twice,
     *  so re-processing the same resurfaced execution is the correct, simple choice. */
    fun onConnected() {
        try {
            synchronized(jobLock) {
                activeJobId = null
                activeVersionNumber = 0
            }
            getNextSubsReady.set(0)
            subscribeAll()
        } catch (e: Exception) {
            Log.e(MqttService.TAG, "JobsClient.onConnected failed: ${e.message}", e)
        }
    }

    /** Dispatches an incoming message on any `$aws/things/{thingName}/jobs/...` topic. Called
     *  from MqttService.messageArrived, which has already routed jobs-prefixed topics here. */
    fun onMessage(topic: String, message: MqttMessage) {
        try {
            val body = try {
                JSONObject(String(message.payload))
            } catch (e: Exception) {
                Log.e(MqttService.TAG, "Jobs: unparsable message on $topic: ${e.message}")
                return
            }
            when {
                topic.endsWith("/jobs/notify-next") -> considerExecution(parseExecution(body))
                topic.endsWith("/jobs/\$next/get/accepted") -> considerExecution(parseExecution(body))
                topic.endsWith("/jobs/\$next/get/rejected") ->
                    Log.i(MqttService.TAG, "Jobs: \$next/get/rejected: ${body.optString("code")} ${body.optString("message")}")
                topic.endsWith("/update/accepted") -> onUpdateAccepted(topic, body)
                topic.endsWith("/update/rejected") -> onUpdateRejected(topic, body)
                else -> Log.w(MqttService.TAG, "Jobs: unrecognized jobs topic: $topic")
            }
        } catch (e: Exception) {
            Log.e(MqttService.TAG, "Jobs: onMessage($topic) failed: ${e.message}", e)
        }
    }

    // ============ SUBSCRIBE + THE OFFLINE-CONVERGENCE REQUEST ============

    private fun subscribeAll() {
        subscribe("\$aws/things/$thingName/jobs/notify-next")
        subscribe("\$aws/things/$thingName/jobs/+/update/accepted")
        subscribe("\$aws/things/$thingName/jobs/+/update/rejected")
        subscribe("\$aws/things/$thingName/jobs/\$next/get/accepted", countsTowardGetNext = true)
        subscribe("\$aws/things/$thingName/jobs/\$next/get/rejected", countsTowardGetNext = true)
    }

    private fun subscribe(topic: String, countsTowardGetNext: Boolean = false) {
        try {
            mqttClient.subscribe(topic, 1, null, object : IMqttActionListener {
                override fun onSuccess(asyncActionToken: IMqttToken?) {
                    Log.i(MqttService.TAG, "Jobs: subscribed to $topic")
                    if (countsTowardGetNext && getNextSubsReady.incrementAndGet() == 2) {
                        // Both $next/get response topics are live — safe to publish the
                        // request now. This is what re-checks "what's queued for me?" on every
                        // connect, satisfying "even if it's on next powerup".
                        requestNextJob()
                    }
                }
                override fun onFailure(asyncActionToken: IMqttToken?, exception: Throwable?) {
                    Log.e(MqttService.TAG, "Jobs: subscribe failed for $topic: ${exception?.message}")
                }
            })
        } catch (e: Exception) {
            Log.e(MqttService.TAG, "Jobs: subscribe threw for $topic: ${e.message}", e)
        }
    }

    private fun requestNextJob() {
        try {
            val body = JSONObject().apply {
                put("includeJobDocument", true)
                put("clientToken", newClientToken())
            }
            mqttClient.publish(
                "\$aws/things/$thingName/jobs/\$next/get",
                MqttMessage(body.toString().toByteArray()).apply { qos = 1 }
            )
            Log.i(MqttService.TAG, "Jobs: requested \$next/get")
        } catch (e: Exception) {
            Log.e(MqttService.TAG, "Jobs: \$next/get publish failed: ${e.message}", e)
        }
    }

    private fun newClientToken(): String = "scn-${System.currentTimeMillis()}-${(1000..9999).random()}"

    // ============ EXECUTION SELECTION / DEDUP ============

    private fun parseExecution(root: JSONObject): JobExecution? {
        val exec = root.optJSONObject("execution") ?: return null
        val jobId = exec.optString("jobId", "")
        if (jobId.isBlank()) return null
        return JobExecution(jobId, exec.optInt("versionNumber", 1), exec.optJSONObject("jobDocument"))
    }

    private fun considerExecution(exec: JobExecution?) {
        if (exec == null) {
            Log.d(MqttService.TAG, "Jobs: no pending execution")
            return
        }
        synchronized(jobLock) {
            if (activeJobId == exec.jobId) {
                // Re-announcement of the job we're already running (a retried notify-next, or
                // the $next/get/accepted reply to our own request echoing it back) — starting
                // it twice could double-download an APK or double-fire a reboot.
                Log.d(MqttService.TAG, "Jobs: execution ${exec.jobId} already active, ignoring duplicate")
                return
            }
            if (activeJobId != null) {
                // Should be rare: AWS IoT Jobs only ever surfaces ONE "next" execution at a
                // time, so this means the previously-active one was superseded server-side
                // (e.g. force-canceled) while we were still mid-flight on it. Chosen behaviour:
                // ignore-with-log rather than queue it locally, because running two command
                // handlers concurrently could race (two install_apk downloads sharing the same
                // cache file, two reboots, etc). Nothing is lost — the moment the current job
                // reaches a terminal state we re-issue $next/get (see reportTerminal below),
                // which will surface this one.
                Log.w(MqttService.TAG, "Jobs: execution ${exec.jobId} arrived while $activeJobId is in progress — ignoring for now")
                return
            }
            activeJobId = exec.jobId
            activeVersionNumber = exec.versionNumber
        }
        startExecution(exec)
    }

    // ============ RUNNING A JOB ============

    private fun startExecution(exec: JobExecution) {
        val doc = exec.jobDocument
        if (doc == null) {
            reportTerminal(exec.jobId, "REJECTED", "job document missing")
            return
        }
        val command = doc.optString("command", "")
        if (command.isBlank()) {
            reportTerminal(exec.jobId, "REJECTED", "job document missing required 'command' field")
            return
        }
        val version = doc.optString("version", "1")
        if (version != "1") {
            Log.w(MqttService.TAG, "Jobs(${exec.jobId}): document declares version=$version (expected \"1\") — attempting anyway")
        }
        val payload = doc.optJSONObject("payload")

        MqttService.alog(Log.INFO, "Jobs(${exec.jobId}): starting command=$command")
        reportStatus(exec.jobId, "IN_PROGRESS", null)

        if (command == "install_apk") {
            handleInstallApkJob(exec.jobId, payload)
            return
        }
        if (command == "restart") {
            // Rebooting kills this process — nothing could be published afterward, so report
            // SUCCEEDED BEFORE triggering it (same rule as the install_apk self-update case
            // below). Runs off the MQTT callback thread purely so the tiny publish-then-reboot
            // pause never blocks message processing.
            Thread {
                try {
                    reportTerminal(exec.jobId, "SUCCEEDED", null)
                    Thread.sleep(500) // best-effort: give the publish a moment to leave the socket
                    commandExecutor("restart", payload)
                } catch (e: Exception) {
                    Log.e(MqttService.TAG, "Jobs(${exec.jobId}): restart failed: ${e.message}", e)
                }
            }.start()
            return
        }

        val outcome = try {
            commandExecutor(command, payload)
        } catch (e: Exception) {
            JobOutcome.Retryable(e.message ?: e.javaClass.simpleName)
        }
        when (outcome) {
            is JobOutcome.Success -> reportTerminal(exec.jobId, "SUCCEEDED", null)
            is JobOutcome.Retryable -> reportTerminal(exec.jobId, "FAILED", outcome.detail)
            is JobOutcome.Permanent -> reportTerminal(exec.jobId, "REJECTED", outcome.detail)
        }
    }

    // ============ install_apk — download, verify, self-update safety ============

    private fun handleInstallApkJob(jobId: String, payload: JSONObject?) {
        val url = payload?.optString("url")
        if (url.isNullOrBlank()) {
            reportTerminal(jobId, "REJECTED", "install_apk: payload.url missing or blank")
            return
        }
        val expectedSha256 = payload.optString("sha256").takeIf { it.isNotBlank() }
        val allowDowngrade = payload.optBoolean("allowDowngrade", false)

        // Everything below runs off the MQTT callback thread — a multi-MB APK over a slow link
        // must never block message processing (that would itself stall the offline-convergence
        // path for every other job/notification). The URL is used immediately, exactly as
        // received in this job document fetch — never cached and re-downloaded later, since AWS
        // substitutes ${aws:iot:s3-presigned-url:...} placeholders at fetch time and presigned
        // URLs expire in at most an hour.
        Thread {
            val apkFile = File(context.cacheDir, "jobs_install_${jobId.take(8)}.apk")
            try {
                downloadTo(url, apkFile)
                Log.i(MqttService.TAG, "Jobs($jobId): downloaded ${apkFile.length() / 1024}KB")

                if (expectedSha256 != null) {
                    val actual = sha256Hex(apkFile)
                    if (!actual.equals(expectedSha256, ignoreCase = true)) {
                        Log.e(MqttService.TAG, "Jobs($jobId): sha256 mismatch — expected $expectedSha256 got $actual")
                        reportTerminal(jobId, "REJECTED", "sha256 mismatch")
                        return@Thread
                    }
                    Log.i(MqttService.TAG, "Jobs($jobId): sha256 verified")
                }

                val archiveInfo = context.packageManager.getPackageArchiveInfo(apkFile.absolutePath, 0)
                if (archiveInfo == null) {
                    reportTerminal(jobId, "REJECTED", "downloaded file is not a valid APK")
                    return@Thread
                }
                val isSelfUpdate = archiveInfo.packageName == context.packageName

                if (isSelfUpdate) {
                    @Suppress("DEPRECATION") val incomingVersion = archiveInfo.versionCode
                    @Suppress("DEPRECATION") val runningVersion = context.packageManager.getPackageInfo(context.packageName, 0).versionCode
                    if (incomingVersion < runningVersion && !allowDowngrade) {
                        Log.w(MqttService.TAG, "Jobs($jobId): refusing self-downgrade $runningVersion -> $incomingVersion (no allowDowngrade flag)")
                        reportTerminal(jobId, "REJECTED", "refusing downgrade: running=$runningVersion incoming=$incomingVersion")
                        return@Thread
                    }
                    if (!isDeviceOwnerSelf()) {
                        // Silent install is the only path safe to fire unattended (pm install
                        // -r is atomic — a failed silent self-update simply leaves the current
                        // agent running). The intent-based fallback needs a human to tap
                        // "Install", which defeats the point of an unattended remote update.
                        Log.w(MqttService.TAG, "Jobs($jobId): self-update requires device owner for silent install — not attempting")
                        reportTerminal(jobId, "FAILED", "self-update requires device owner (silent install unavailable)")
                        return@Thread
                    }
                }

                val committed = commitInstallSession(apkFile, jobId) { success, message ->
                    // Only ever reached for a NON-self-update — the process is still alive to
                    // hear about it. A self-update's callback (if the OS even had time to fire
                    // it before the process died) is harmless if it does arrive late.
                    if (success) reportTerminal(jobId, "SUCCEEDED", null) else reportTerminal(jobId, "FAILED", message)
                    apkFile.delete()
                }
                if (!committed) {
                    reportTerminal(jobId, "FAILED", "silent install session could not be committed")
                    apkFile.delete()
                    return@Thread
                }

                if (isSelfUpdate) {
                    // Self-update safety: the install just committed is about to kill this very
                    // process, so no post-install status report would ever be possible. Report
                    // SUCCEEDED now — download is on disk and sha256-verified (when provided),
                    // and pm install -r is atomic, so if the install itself somehow fails, the
                    // previous (already-reported-healthy) agent keeps running rather than
                    // bricking the scanner.
                    reportTerminal(jobId, "SUCCEEDED", null)
                }
            } catch (e: Exception) {
                Log.e(MqttService.TAG, "Jobs($jobId): install_apk failed: ${e.message}", e)
                reportTerminal(jobId, "FAILED", e.message ?: e.javaClass.simpleName)
                apkFile.delete()
            }
        }.start()
    }

    private fun isDeviceOwnerSelf(): Boolean {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        return dpm.isDeviceOwnerApp(context.packageName)
    }

    private fun downloadTo(urlStr: String, dest: File) {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.connectTimeout = 30_000
        conn.readTimeout = 600_000 // 10 min, matches the existing cmd/scanners install_apk path
        try {
            conn.inputStream.use { input ->
                FileOutputStream(dest).use { output ->
                    val buffer = ByteArray(8192)
                    var read: Int
                    while (input.read(buffer).also { read = it } != -1) output.write(buffer, 0, read)
                }
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun sha256Hex(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            var read: Int
            while (input.read(buffer).also { read = it } != -1) digest.update(buffer, 0, read)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /** Commits a PackageInstaller session (device-owner silent install) and correlates the
     *  async OS install-result broadcast back to this jobId via a dynamically-registered,
     *  app-private receiver (mirrors MqttService.silentInstall's session-building, but that
     *  one is fire-and-forget for the cmd/scanners/# path — this variant needs the real result
     *  to report SUCCEEDED/FAILED accurately). Returns true if the session committed without
     *  throwing (the async result arrives later via onResult); false on an immediate failure
     *  (not device owner, or a PackageInstaller error) which the caller reports as FAILED. */
    private fun commitInstallSession(apkFile: File, jobId: String, onResult: (Boolean, String) -> Unit): Boolean {
        return try {
            if (!isDeviceOwnerSelf()) {
                Log.w(MqttService.TAG, "Jobs($jobId): not device owner — cannot silent-install")
                return false
            }
            val installer = context.packageManager.packageInstaller
            val params = android.content.pm.PackageInstaller.SessionParams(
                android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL
            )
            params.setSize(apkFile.length())
            val sessionId = installer.createSession(params)
            val session = installer.openSession(sessionId)
            session.openWrite("apk", 0, apkFile.length()).use { output ->
                apkFile.inputStream().use { it.copyTo(output) }
                session.fsync(output)
            }

            val action = "com.ietires.scanneragent.JOBS_INSTALL_COMPLETE"
            val delivered = AtomicBoolean(false)
            val timeoutHandler = Handler(Looper.getMainLooper())
            lateinit var timeoutRunnable: Runnable
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(rctx: Context, intent: Intent) {
                    if (intent.getStringExtra("jobsJobId") != jobId) return // stale/foreign, ignore
                    if (!delivered.compareAndSet(false, true)) return
                    try {
                        timeoutHandler.removeCallbacks(timeoutRunnable)
                        try { context.unregisterReceiver(this) } catch (e: Exception) { /* already gone */ }
                        val status = intent.getIntExtra(android.content.pm.PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)
                        val message = intent.getStringExtra(android.content.pm.PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""
                        onResult(status == android.content.pm.PackageInstaller.STATUS_SUCCESS, "status=$status $message".trim())
                    } catch (e: Exception) {
                        Log.e(MqttService.TAG, "Jobs($jobId): install-result receiver failed: ${e.message}", e)
                    }
                }
            }
            timeoutRunnable = Runnable {
                if (!delivered.compareAndSet(false, true)) return@Runnable
                try { context.unregisterReceiver(receiver) } catch (e: Exception) { /* already gone */ }
                Log.w(MqttService.TAG, "Jobs($jobId): install result timed out after ${INSTALL_RESULT_TIMEOUT_MS / 1000}s")
                onResult(false, "install result timed out")
            }
            context.registerReceiver(receiver, IntentFilter(action))
            timeoutHandler.postDelayed(timeoutRunnable, INSTALL_RESULT_TIMEOUT_MS)

            val callbackIntent = Intent(action).apply {
                setPackage(context.packageName) // keep this broadcast private to our own app
                putExtra("jobsJobId", jobId)
            }
            val pendingIntent = android.app.PendingIntent.getBroadcast(
                context, sessionId, callbackIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )
            session.commit(pendingIntent.intentSender)
            Log.i(MqttService.TAG, "Jobs($jobId): install session committed (sessionId=$sessionId)")
            true
        } catch (e: Exception) {
            Log.e(MqttService.TAG, "Jobs($jobId): commitInstallSession failed: ${e.message}", e)
            false
        }
    }

    // ============ STATUS REPORTING ============

    private fun reportStatus(jobId: String, status: String, detail: String?) = publishUpdate(jobId, status, detail)

    private fun reportTerminal(jobId: String, status: String, detail: String?) {
        publishUpdate(jobId, status, detail)
        MqttService.alog(Log.INFO, "Jobs($jobId): terminal status $status${detail?.let { " ($it)" } ?: ""}")
        synchronized(jobLock) {
            if (activeJobId == jobId) {
                activeJobId = null
                activeVersionNumber = 0
            }
        }
        // Immediately check for anything queued behind this one — this is the same
        // offline-convergence request as onConnected(), just re-run after finishing a job
        // instead of after a connect.
        requestNextJob()
    }

    private fun publishUpdate(jobId: String, status: String, detail: String?) {
        val expectedVersion = synchronized(jobLock) { if (activeJobId == jobId) activeVersionNumber else 0 }
        try {
            val body = JSONObject().apply {
                put("status", status)
                if (detail != null) put("statusDetails", JSONObject().put("detail", detail.take(1024)))
                if (expectedVersion > 0) put("expectedVersion", expectedVersion)
                put("clientToken", newClientToken())
            }
            mqttClient.publish(
                "\$aws/things/$thingName/jobs/$jobId/update",
                MqttMessage(body.toString().toByteArray()).apply { qos = 1 }
            )
            // Optimistic local bump: AWS IoT increments the execution's versionNumber on every
            // accepted update. We don't block this thread waiting for the "/update/accepted"
            // echo before the NEXT update for the same job (IN_PROGRESS -> terminal can happen
            // back-to-back for a fast synchronous command, and parking a continuation mid-flight
            // on the single MQTT callback thread isn't worth the complexity), so we advance our
            // own counter immediately and let onUpdateAccepted()/onUpdateRejected() below correct
            // or reset it if the guess was wrong. If it WAS wrong, onUpdateRejected's
            // VersionMismatch handling clears local state and re-requests $next/get, which
            // resurfaces this same still-non-terminal job so it gets re-run and re-reported
            // correctly — self-healing rather than getting stuck.
            synchronized(jobLock) { if (activeJobId == jobId) activeVersionNumber += 1 }
            Log.i(MqttService.TAG, "Jobs($jobId): reported $status (expectedVersion=$expectedVersion)")
        } catch (e: Exception) {
            Log.e(MqttService.TAG, "Jobs($jobId): update publish failed for $status: ${e.message}", e)
        }
    }

    private fun onUpdateAccepted(topic: String, body: JSONObject) {
        val jobId = extractJobId(topic) ?: return
        val newVersion = body.optJSONObject("executionState")?.optInt("versionNumber", -1) ?: -1
        synchronized(jobLock) {
            if (activeJobId == jobId && newVersion > 0) activeVersionNumber = newVersion
        }
        Log.d(MqttService.TAG, "Jobs($jobId): update accepted (versionNumber=$newVersion)")
    }

    private fun onUpdateRejected(topic: String, body: JSONObject) {
        val jobId = extractJobId(topic)
        val code = body.optString("code")
        val message = body.optString("message")
        Log.e(MqttService.TAG, "Jobs($jobId): update REJECTED: code=$code message=$message")
        if (code == "VersionMismatch") {
            // Our view of the execution is stale — clear local tracking and re-fetch the
            // authoritative current state via $next/get rather than guessing a version number.
            synchronized(jobLock) {
                if (activeJobId == jobId) {
                    activeJobId = null
                    activeVersionNumber = 0
                }
            }
            requestNextJob()
        }
    }

    private fun extractJobId(topic: String): String? {
        // $aws/things/{thingName}/jobs/{jobId}/update/accepted|rejected
        val prefix = "\$aws/things/$thingName/jobs/"
        if (!topic.startsWith(prefix)) return null
        val rest = topic.removePrefix(prefix)
        val jobId = rest.substringBefore("/update/")
        return jobId.takeIf { it.isNotBlank() && it != "\$next" }
    }
}
