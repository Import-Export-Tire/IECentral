package com.ietires.scanneragent

import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * Replaces stock Launcher3 as the device home screen. Seeding Launcher3's own favourites
 * database (to show only the apps this fleet actually needs) requires root, which these TC51s
 * don't have — becoming the launcher ourselves sidesteps that entirely. See MqttService's
 * applyHomeScreenPreference()/setHome() for how this activity is actually made the default HOME
 * (addPersistentPreferredActivity, Device Owner only) and how it's reverted remotely.
 *
 * Shows exactly three tiles — "It should put TireTrack, and RT mobile and Settings on the home
 * screen. That's it." — real icon + label via PackageManager, per-tile omitted if that app
 * isn't installed rather than showing a dead tile.
 *
 * CRASH SAFETY IS THE PRIORITY HERE, more than for any other screen in this app: this activity
 * IS the home screen. If it force-closes, the device has no home screen at all — an FC loop a
 * technician can't back out of without a USB cable. So: all of onCreate's real work is wrapped
 * in try/catch, with a plain "Home unavailable" text view as the last-resort fallback rather
 * than letting an exception propagate. Per-tile failures are caught individually too, so one
 * bad app entry can't take out the other two tiles.
 *
 * Deliberately has NO dependency on MqttService — the remote escape hatch (set_home command)
 * lives entirely in MqttService/DevicePolicyManager, so a bug in this activity can never affect
 * whether that service starts or stays connected.
 */
class HomeActivity : Activity() {

    companion object {
        const val TAG = "ScannerAgentHome"

        data class Tile(val packageName: String, val label: String)

        // Exactly these three, in this order.
        val TILES = listOf(
            Tile("com.importexporttire.tiretrack", "TireTrack"),
            Tile("com.rt_systems.rtlhandsfree", "RT Locator"),
            Tile("com.android.settings", "Settings")
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            setContentView(buildTileRow())
        } catch (e: Throwable) {
            // See class doc: an uncaught exception here is a home-screen FC loop. Fall back to
            // a plain text view — still a usable (if minimal) screen — rather than propagate.
            Log.e(TAG, "onCreate: failed to build tile layout, falling back to plain view: ${e.message}", e)
            try {
                setContentView(TextView(this).apply {
                    text = "Home unavailable"
                    gravity = Gravity.CENTER
                    setTextColor(Color.WHITE)
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT
                    )
                })
            } catch (e2: Throwable) {
                // Truly nothing left to try — at least this didn't crash-loop the process.
                Log.e(TAG, "onCreate: fallback view also failed: ${e2.message}", e2)
            }
        }
    }

    private fun buildTileRow(): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT
            )
        }
        for (tile in TILES) {
            val view = try {
                buildTileView(tile) ?: continue // app not installed — omit rather than show a dead tile
            } catch (e: Exception) {
                Log.w(TAG, "buildTileRow: tile for ${tile.packageName} failed, omitting: ${e.message}")
                continue
            }
            row.addView(view)
        }
        return row
    }

    /** Returns null (omit) if the app isn't installed. Icon load failures fall back to a
     *  text-only tile rather than omitting the tile entirely — the label alone is still a
     *  usable launch target. */
    private fun buildTileView(tile: Tile): View? {
        val pm = packageManager
        val appInfo = try {
            pm.getApplicationInfo(tile.packageName, 0)
        } catch (e: PackageManager.NameNotFoundException) {
            Log.i(TAG, "buildTileView: ${tile.packageName} not installed, omitting tile")
            return null
        }

        val icon: Drawable? = try {
            pm.getApplicationIcon(appInfo)
        } catch (e: Exception) {
            Log.w(TAG, "buildTileView: icon load failed for ${tile.packageName}, falling back to text tile: ${e.message}")
            null
        }
        val label: String = try {
            pm.getApplicationLabel(appInfo).toString().takeIf { it.isNotBlank() } ?: tile.label
        } catch (e: Exception) {
            tile.label
        }

        val tileLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            setPadding(dp(24), dp(24), dp(24), dp(24))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        if (icon != null) {
            tileLayout.addView(ImageView(this).apply {
                setImageDrawable(icon)
                layoutParams = LinearLayout.LayoutParams(dp(72), dp(72)).apply { bottomMargin = dp(8) }
            })
        }
        // Label is always present — normal decoration under an icon, or the entire tile
        // content when the icon failed to load above.
        tileLayout.addView(TextView(this).apply {
            text = label
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
        })

        tileLayout.setOnClickListener { launchTile(tile) }
        return tileLayout
    }

    private fun launchTile(tile: Tile) {
        try {
            val intent = packageManager.getLaunchIntentForPackage(tile.packageName)
            if (intent == null) {
                Toast.makeText(this, "${tile.label} unavailable", Toast.LENGTH_SHORT).show()
                return
            }
            startActivity(intent)
        } catch (e: Exception) {
            // Never crash the home screen over a launch failure — toast and stay put.
            Log.w(TAG, "launchTile(${tile.packageName}) failed: ${e.message}")
            try {
                Toast.makeText(this, "Couldn't open ${tile.label}", Toast.LENGTH_SHORT).show()
            } catch (e2: Exception) {
                // Give up quietly rather than let a Toast failure become a crash.
            }
        }
    }

    /** Back must not exit the home screen — there is nowhere for "back" to go on a launcher,
     *  and the only sanctioned way off this screen is the set_home remote command (see
     *  MqttService), not a Back press. */
    @Suppress("MissingSuperCall")
    override fun onBackPressed() {
        // Deliberately empty — do nothing.
    }

    private fun dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics
    ).toInt()
}
