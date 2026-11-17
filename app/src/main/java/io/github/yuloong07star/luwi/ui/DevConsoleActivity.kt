package io.github.yuloong07star.luwi.ui

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
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.tool.ForgeConsole
import java.io.File

/**
 * 开发屏 (2.8.1; 2026-11-17 从伴侣 APK 搬进主应用)
 *
 * 三块: 当前项目的元信息 / 上次构建与进度 / 日志尾. **只读** —— 改项目是工坊那一侧的事, 这里一个字都不写
 *
 * 进度与日志按文件读, 一秒一眼 (只有在前台才轮): 构建在特权进程里跑, 每一步写 `.lwforge/progress.json`
 * 与 `build.log`, 这里跟着刷就是那个「看进度」的意思
 *
 * **没有桌面图标**: 它由 `lw_forge op=screen` 用 `am start` 拉到那块虚拟屏上, 主人平时看不到它单独出现
 */
class DevConsoleActivity : Activity() {

    private val tick = Handler(Looper.getMainLooper())
    private lateinit var title: TextView
    private lateinit var body: TextView
    private lateinit var log: TextView
    private lateinit var empty: TextView
    private lateinit var access: Button

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
        empty = TextView(this).apply { text = getString(R.string.dev_console_empty) }
        access = Button(this).apply {
            text = getString(R.string.dev_console_no_access)
            setOnClickListener { openAllFilesPage() }
            visibility = ViewGroup.GONE
        }
        body = TextView(this).apply { textSize = 14f }
        log = TextView(this).apply {
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
        }
        val refresh = Button(this).apply {
            text = getString(R.string.dev_console_refresh)
            setOnClickListener { render() }
        }
        root.addView(title)
        root.addView(access)
        root.addView(empty)
        root.addView(body)
        root.addView(refresh)
        root.addView(
            TextView(this).apply {
                text = getString(R.string.dev_console_log)
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
        val current = ForgeConsole.current()
        access.visibility = if (canReadShared()) ViewGroup.GONE else ViewGroup.VISIBLE
        if (current == null) {
            title.text = getString(R.string.dev_console_title)
            empty.visibility = ViewGroup.VISIBLE
            body.text = ""
            log.text = ""
            return
        }
        empty.visibility = ViewGroup.GONE
        title.text = current.name
        val dir = File(current.path)
        val lines = mutableListOf<String>()
        lines += getString(R.string.dev_console_current) + ": " + current.path
        ForgeConsole.meta(dir).forEach { (key, value) -> lines += "$key: $value" }
        val progress = ForgeConsole.progress(dir)
        if (progress.isNotBlank()) lines += "进度: $progress"
        val build = ForgeConsole.lastBuild(dir)
        if (build.isNotEmpty()) {
            lines += ""
            lines += getString(R.string.dev_console_build)
            build.forEach { (key, value) -> lines += "$key: $value" }
        }
        body.text = lines.joinToString("\n")
        body.gravity = Gravity.START
        log.text = ForgeConsole.logTail(dir, 80)
    }

    private fun canReadShared(): Boolean =
        android.os.Environment.isExternalStorageManager()

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
