package com.ietires.scanneragent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast

/** Latest mirrored-screen snapshot. Written on the main thread by ScreenReaderService;
 *  read from a companion accessor that may be called from a background thread (e.g. the
 *  telemetry publisher), hence the @Volatile holder in the companion object below. */
data class ScreenSnapshot(
    val at: Long,            // System.currentTimeMillis()
    val packageName: String,
    val className: String,   // foreground activity/window class
    val windowTitle: String,
    val text: List<String>,  // visible text, in traversal order
    val truncated: Boolean,  // true if caps were hit
)

/**
 * Accessibility service that mirrors "what's on screen" as text, since Device Owner on
 * Android 8.1 has no screenshot API and MediaProjection needs a per-session consent tap.
 * Reports the foreground app + visible text so remote support can see what a picker is
 * stuck on without walking to the device.
 *
 * Also blocks the on-device "change lock PIN" settings flow, since the PIN is managed
 * centrally by IE Central (see PinManager) and an on-device change would drift from it.
 */
class ScreenReaderService : AccessibilityService() {

    companion object {
        private const val MAX_STRINGS = 100
        private const val MAX_CHARS = 4096
        private const val MAX_DEPTH = 50
        private const val MAX_NODES = 2000
        private const val CONTENT_DEBOUNCE_MS = 1000L

        @Volatile
        private var snapshot: ScreenSnapshot? = null

        /** Latest snapshot, or null if the service hasn't produced one yet. Safe to call
         *  from any thread. */
        fun latest(): ScreenSnapshot? = snapshot
    }

    // Only touched from onAccessibilityEvent, which runs on the main thread — no locking needed.
    private var lastPackageName: String = ""
    private var lastClassName: String = ""
    private var lastWindowTitle: String = ""
    private var lastRebuildAt: Long = 0L

    /** Small mutable accumulator threaded through the recursive tree walk so every
     *  recursive call shares one running count/char-budget/truncated flag. */
    private class CollectState {
        val texts = mutableListOf<String>()
        var totalChars = 0
        var truncated = false
        var nodesVisited = 0
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        // Set programmatically too — behaviour shouldn't depend on which of XML/code the
        // platform actually honours.
        try {
            serviceInfo = AccessibilityServiceInfo().apply {
                eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                    AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
                flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
                // 0 = no event coalescing. A >0 timeout lets the platform merge same-type
                // events and deliver only the latest — verified on-device that this can
                // silently drop the ChooseLockPassword window-state event when the numeric
                // keyboard auto-shows a moment later (its own state-changed event wins the
                // coalesce). That transition is exactly the one the PIN-settings block below
                // depends on, so we can't afford to lose it.
                notificationTimeout = 0
            }
        } catch (e: Exception) {
            Log.w(MqttService.TAG, "ScreenReaderService: could not set serviceInfo programmatically: ${e.message}")
        }
        Log.i(MqttService.TAG, "ScreenReaderService: connected and live")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        try {
            when (event.eventType) {
                AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                    lastPackageName = event.packageName?.toString() ?: lastPackageName
                    lastClassName = event.className?.toString() ?: lastClassName
                    lastWindowTitle = event.text
                        .filterNotNull()
                        .joinToString(" ") { it.toString() }
                        .trim()

                    checkBlockLockScreenSettings(lastPackageName, lastClassName)

                    // Window-state changes are the interesting transitions — rebuild immediately.
                    rebuildSnapshot()
                }

                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                    // Debounced — a scanning app can fire content-changed continuously.
                    val now = System.currentTimeMillis()
                    if (now - lastRebuildAt >= CONTENT_DEBOUNCE_MS) {
                        rebuildSnapshot()
                    }
                }
            }
        } catch (e: Exception) {
            // A failure here must never crash the service — losing it means losing remote
            // troubleshooting AND requires a USB cable to re-enable it.
            Log.w(MqttService.TAG, "ScreenReaderService: onAccessibilityEvent failed: ${e.message}", e)
        }
    }

    override fun onInterrupt() {
        Log.w(MqttService.TAG, "ScreenReaderService: interrupted")
    }

    // ============ SNAPSHOT BUILDING ============

    private fun rebuildSnapshot() {
        try {
            val root = rootInActiveWindow
            val state = CollectState()
            // Prefer the foreground window/activity identity captured from the last
            // TYPE_WINDOW_STATE_CHANGED event — root.className is the root *view* class
            // (e.g. FrameLayout), not the activity/window class, and would be misleading here.
            val packageName = lastPackageName.ifBlank { root?.packageName?.toString() ?: "" }
            val className = lastClassName.ifBlank { root?.className?.toString() ?: "" }

            // walk() recycles `root` (and every node it obtains) on every exit path.
            walk(root, 0, state)

            val now = System.currentTimeMillis()
            snapshot = ScreenSnapshot(
                at = now,
                packageName = packageName,
                className = className,
                windowTitle = lastWindowTitle,
                text = state.texts,
                truncated = state.truncated,
            )
            lastRebuildAt = now
            Log.d(
                MqttService.TAG,
                "ScreenReaderService: snapshot pkg=$packageName cls=$className strings=${state.texts.size} " +
                    "chars=${state.totalChars} truncated=${state.truncated}"
            )
        } catch (e: Exception) {
            Log.w(MqttService.TAG, "ScreenReaderService: snapshot build failed: ${e.message}", e)
        }
    }

    /** Recursive pre-order walk of the node tree, collecting text/contentDescription into
     *  [state] subject to the depth/node/string/char caps. Recycles every node it obtains,
     *  including [node] itself, on every exit path (normal return or exception). */
    private fun walk(node: AccessibilityNodeInfo?, depth: Int, state: CollectState) {
        if (node == null) return
        try {
            if (state.truncated) return

            state.nodesVisited++
            if (state.nodesVisited > MAX_NODES) {
                state.truncated = true
                return
            }

            // Never collect a password, no exceptions.
            if (!node.isPassword) {
                val text = node.text?.toString()?.takeIf { it.isNotBlank() }
                    ?: node.contentDescription?.toString()?.takeIf { it.isNotBlank() }
                if (text != null) addText(text, state)
            }

            if (depth < MAX_DEPTH) {
                for (i in 0 until node.childCount) {
                    if (state.truncated) break
                    val child = try {
                        node.getChild(i)
                    } catch (e: Exception) {
                        null
                    }
                    walk(child, depth + 1, state)
                }
            }
        } finally {
            try {
                @Suppress("DEPRECATION")
                node.recycle()
            } catch (e: Exception) {
                // Already recycled or otherwise invalid — nothing more we can do.
            }
        }
    }

    private fun addText(raw: String, state: CollectState) {
        val str = raw.trim()
        if (str.isEmpty()) return
        // De-dup consecutive identical strings (common with repeated labels).
        if (state.texts.isNotEmpty() && state.texts.last() == str) return

        if (state.texts.size >= MAX_STRINGS) {
            state.truncated = true
            return
        }
        val remaining = MAX_CHARS - state.totalChars
        if (remaining <= 0) {
            state.truncated = true
            return
        }
        val toAdd = if (str.length > remaining) {
            state.truncated = true
            str.substring(0, remaining)
        } else {
            str
        }
        if (toAdd.isEmpty()) return
        state.texts.add(toAdd)
        state.totalChars += toAdd.length
    }

    // ============ LOCK-SCREEN SETTINGS BLOCK ============

    /** The PIN is managed centrally (see PinManager) — block the on-device "change lock
     *  PIN" flow so it can't drift from the system-set value. Does NOT block the legitimate
     *  "confirm your current PIN" screen (ConfirmLockPassword). */
    private fun checkBlockLockScreenSettings(packageName: String, className: String) {
        if (packageName != "com.android.settings") return
        if (!className.contains("ChooseLock")) return
        if (className.contains("ConfirmLockPassword")) return // legitimate confirm-PIN screen — never block

        val prefs = getSharedPreferences("pin_mgr", Context.MODE_PRIVATE)
        val blocked = prefs.getBoolean("block_pin_settings_ui", true)
        if (!blocked) return

        Log.i(MqttService.TAG, "ScreenReaderService: blocked lock-screen settings UI ($className)")
        try {
            performGlobalAction(GLOBAL_ACTION_HOME)
            Toast.makeText(this, "PIN is managed by IE Central.", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Log.w(MqttService.TAG, "ScreenReaderService: could not block lock-screen settings UI: ${e.message}")
        }
    }
}
