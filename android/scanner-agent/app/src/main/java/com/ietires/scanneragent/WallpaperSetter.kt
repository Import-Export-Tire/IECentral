package com.ietires.scanneragent

import android.app.WallpaperManager
import android.content.Context
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Log

/**
 * Applies the IE Tires wallpaper so a company scanner is identifiable on sight across a
 * warehouse floor. Runs from the Application class, so it happens on any process start —
 * including before provisioning finishes, which is when someone is most likely to be looking
 * at a pile of near-identical TC51s.
 *
 * Uses WallpaperManager rather than ADB because Android 8.1 has no wallpaper shell command,
 * and because doing it in the agent means it also reaches scanners that are already in the
 * field. SET_WALLPAPER is a normal permission, granted at install with no prompt.
 */
object WallpaperSetter {

    /** Bump when the image itself changes, so existing devices re-apply it exactly once. */
    private const val ASSET_VERSION = 1
    private const val PREFS = "wallpaper"
    private const val KEY_APPLIED_VERSION = "applied_version"

    /**
     * Idempotent: writes the wallpaper only when this device has not applied this asset version
     * yet. Deliberately not re-asserted on every start — repeatedly rewriting the wallpaper
     * would fight the user pointlessly and churn storage. Employees are stopped from changing
     * it by the DISALLOW_SET_WALLPAPER restriction instead, which is enforcement rather than a
     * tug of war.
     */
    fun ensureApplied(ctx: Context) {
        try {
            val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (prefs.getInt(KEY_APPLIED_VERSION, 0) >= ASSET_VERSION) return

            val wm = WallpaperManager.getInstance(ctx) ?: run {
                Log.w(MqttService.TAG, "WallpaperSetter: no WallpaperManager available")
                return
            }

            // decodeResource keeps this off the heap-heavy path: the asset is already sized to
            // the panel (720x1280), so there is nothing to downsample.
            val bmp = BitmapFactory.decodeResource(ctx.resources, R.drawable.wallpaper_tires)
            if (bmp == null) {
                Log.w(MqttService.TAG, "WallpaperSetter: could not decode wallpaper asset")
                return
            }

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    // Both surfaces: the lock screen is what you see before unlocking, which is
                    // exactly when you're trying to tell whose scanner this is.
                    wm.setBitmap(bmp, null, true, WallpaperManager.FLAG_SYSTEM)
                    wm.setBitmap(bmp, null, true, WallpaperManager.FLAG_LOCK)
                } else {
                    wm.setBitmap(bmp)
                }
                prefs.edit().putInt(KEY_APPLIED_VERSION, ASSET_VERSION).apply()
                MqttService.alog(Log.INFO, "WallpaperSetter: applied IE Tires wallpaper (v$ASSET_VERSION)")
            } finally {
                bmp.recycle()
            }
        } catch (e: Exception) {
            // Cosmetic feature — it must never take the agent down with it. A scanner that
            // can't set a wallpaper is still a working scanner.
            Log.w(MqttService.TAG, "WallpaperSetter: failed to apply wallpaper: ${e.message}")
        }
    }
}
