package com.ietires.scanneragent

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.ImageView
import android.widget.TextView
import android.widget.LinearLayout
import android.view.Gravity
import java.io.File

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // If not provisioned, redirect to setup screen
        if (!File(filesDir, "iot_config.json").exists()) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
        }
        layout.addView(ImageView(this).apply {
            setImageResource(R.drawable.iet_logo)
            adjustViewBounds = true
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = "Import Export Tire"
            layoutParams = LinearLayout.LayoutParams(
                (resources.displayMetrics.density * 220).toInt(),
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { bottomMargin = (resources.displayMetrics.density * 20).toInt() }
        })
        layout.addView(TextView(this).apply {
            text = "IE Scanner Agent"
            textSize = 20f
            gravity = Gravity.CENTER
        })
        layout.addView(TextView(this).apply {
            text = "v${BuildConfig.VERSION_NAME}\nAgent is running in the background."
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(0, 24, 0, 0)
        })
        setContentView(layout)
    }
}
