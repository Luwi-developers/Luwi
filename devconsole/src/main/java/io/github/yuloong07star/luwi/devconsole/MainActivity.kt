package io.github.yuloong07star.luwi.devconsole

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File

/**
 * 开发台那一屏 (2.8.1)
 *
 * 三块: 当前项目的元信息 / 上次构建与进度 / 日志尾. **只读** —— 改项目是 Luwi 那一侧的事, 这里一个字都不写
 * (唯一写的是 `current.json`, 由 [ConsoleState.open] 记)
 *
 * 进度与日志按文件读, 每一秒看一眼 (查看时才有): 构建在 Luwi 的特权进程里跑, 它每一步写
 * `.lwforge/progress.json` 与 `build.log`, 这里跟着刷新就是那个"看进度"的意思
 *
 * 用原生 View 而不是 Compose/Miuix: 这一件是伴侣 APK, 少一层依赖就少一份与主 APK 的版本拉扯
 */
class MainActivity : Activity() {

    private val tick = Handler(Looper.getMainLooper())
    private lateinit var title: TextView
    private lateinit var body: TextView
    private lateinit var log: TextView
    private lateinit var empty: TextView
    private lateinit var access: Button

    /** 每一秒看一次项目目录; 停在前台才看 */
    private val poll = object : Runnable {
        override fun run() {
            render()
            tick.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val padding = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
        }

        title = TextView(this).apply {
            textSize = 20f
            setTypeface(typeface, Typeface.BOLD)
        }
        empty = TextView(this).apply { text = getString(R.string.console_empty) }
        access = Button(this).apply {
            text = getString(R.string.console_no_access)
            setOnClickListener { openAllFilesPage() }
            visibility = if (ConsoleState.canReadShared()) ViewGroup.GONE else ViewGroup.VISIBLE
        }
        body = TextView(this).apply { textSize = 14f }
        log = TextView(this).apply {
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
        }
        val refresh = Button(this).apply {
            text = getString(R.string.console_refresh)
            setOnClickListener { render() }
        }

        root.addView(title)
        root.addView(access)
        root.addView(empty)
        root.addView(body)
        root.addView(refresh)
        root.addView(
            TextView(this).apply {
                text = getString(R.string.console_log)
                setPadding(0, padding, 0, 0)
            },
        )
        root.addView(
            log,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )
        setContentView(
            ScrollView(this).apply {
                addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            },
        )
    }

    override fun onResume() {
        super.onResume()
        tick.removeCallbacks(poll)
        tick.post(poll)
    }

    override fun onPause() {
        super.onPause()
        tick.removeCallbacks(poll)
    }

    override fun onDestroy() {
        super.onDestroy()
        tick.removeCallbacksAndMessages(null)
    }

    private fun render() {
        val current = ConsoleState.current(this)
        access.visibility = if (ConsoleState.canReadShared()) ViewGroup.GONE else ViewGroup.VISIBLE
        if (current == null) {
            title.text = getString(R.string.app_name)
            empty.visibility = ViewGroup.VISIBLE
            body.text = ""
            log.text = ""
            return
        }
        empty.visibility = ViewGroup.GONE
        title.text = current.name
        val dir = File(current.path)
        val lines = mutableListOf<String>()
        lines += getString(R.string.console_current) + ": " + current.path
        ConsoleState.meta(dir).forEach { (key, value) -> lines += "$key: $value" }
        val progress = ConsoleState.progress(dir)
        if (progress.isNotBlank()) lines += "进度: $progress"
        val build = ConsoleState.lastBuild(dir)
        if (build.isNotEmpty()) {
            lines += ""
            lines += getString(R.string.console_build)
            build.forEach { (key, value) -> lines += "$key: $value" }
        }
        body.text = lines.joinToString("\n")
        body.gravity = Gravity.START
        log.text = ConsoleState.logTail(dir, 80)
    }

    private fun openAllFilesPage() {
        val app = Intent(
            Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
            Uri.parse("package:$packageName"),
        )
        runCatching { startActivity(app) }.onFailure {
            runCatching { startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) }
        }
    }
}
