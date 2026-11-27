package io.github.yuloong07star.luwi.ui

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.tool.ForgeConsole
import java.io.File

/**
 * 开发屏 (2.8.1; 2026-11-17 从伴侣 APK 搬进主应用)
 *
 * 三块, 一块一档读数:
 *
 * | 块 | 画什么 |
 * | :-- | :-- |
 * | 项目卡 | 名字 / 包名与版本 / 路径 (读不到就是空态那一句) |
 * | 状态卡 | 六档徽标 + 水平进度条 + `step x/y` 读数 + 一行原因 |
 * | 动作行 | **按档换的那一颗主钮** (空态去设置 / 无权限去授权 / 构建失败去看日志 / 其余刷新) |
 *
 * **只读**: 改项目是工坊那一侧的事, 这里一个字都不写; 主钮做的也全是"刷新这一页"或"去别处"的动作
 *
 * 进度与日志按文件读, 一秒一眼 (只有在前台才轮): 构建在特权进程里跑, 每一步写 `.lwforge/progress.json`
 * 与 `build.log`, 这里跟着刷就是那个「看进度」的意思
 *
 * 三块卡片钉同一个**固定高** ([CARD_HEIGHT_DP]): 换档时整页不许上下跳, 徽标也不只靠颜色区分
 * (判据 `tools/check-forge.mjs` 第四节)
 *
 * **没有桌面图标**: 它由 `lw_forge op=screen` 用 `am start` 拉到那块虚拟屏上, 主人平时看不到它单独出现
 */
class DevConsoleActivity : Activity() {

    private val tick = Handler(Looper.getMainLooper())

    private lateinit var title: TextView
    private lateinit var projectCard: LinearLayout
    private lateinit var projectName: TextView
    private lateinit var projectMeta: TextView
    private lateinit var statusCard: LinearLayout
    private lateinit var badge: TextView
    private lateinit var stepBar: ProgressBar
    private lateinit var stepLabel: TextView
    private lateinit var reason: TextView
    private lateinit var actionRow: LinearLayout
    private lateinit var primary: Button
    private lateinit var logTitle: TextView
    private lateinit var log: TextView
    private lateinit var scroller: ScrollView

    /** 上一拍的签名 (档 / 步 / 原因 / 项目 / 权限); 一秒一眼那趟只比它, 一样就一个字都不改 */
    private var lastSignature: String? = null

    private val poll = object : Runnable {
        override fun run() {
            render()
            tick.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val padding = dp(16)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
        }

        title = label(20f, Typeface.BOLD).apply { text = getString(R.string.dev_console_title) }

        projectName = label(16f, Typeface.BOLD)
        projectMeta = label(12f, Typeface.NORMAL)
        projectCard = card().apply {
            addView(projectName, block(0))
            addView(projectMeta, block(dp(4)))
        }

        badge = label(16f, Typeface.BOLD)
        stepBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = false
            max = 1
            progress = 0
        }
        // 等宽那一档: `Typeface.MONOSPACE` 是一份字体, 不是 [Typeface.BOLD] 那种 style 数
        stepLabel = label(12f, Typeface.NORMAL).apply { typeface = Typeface.MONOSPACE }
        reason = label(12f, Typeface.NORMAL)
        statusCard = card().apply {
            addView(badge, block(0))
            addView(stepBar, block(dp(6), dp(6)))
            addView(stepLabel, block(dp(6)))
            addView(reason, block(dp(2)))
        }

        primary = Button(this).apply {
            isAllCaps = false
            textSize = 14f
        }
        actionRow = card(Gravity.CENTER_VERTICAL).apply {
            addView(primary, block(0, dp(52)))
        }

        logTitle = label(12f, Typeface.NORMAL).apply {
            text = getString(R.string.dev_console_log)
            setPadding(0, padding, 0, dp(4))
        }
        log = TextView(this).apply {
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
        }

        root.addView(title, block(0))
        // 三块固定高: 换档只改字, 高度逐像素不变 (空态 / 无权限那两张图也一样)
        root.addView(projectCard, block(padding, dp(CARD_HEIGHT_DP)))
        root.addView(statusCard, block(dp(10), dp(CARD_HEIGHT_DP)))
        root.addView(actionRow, block(dp(10), dp(CARD_HEIGHT_DP)))
        root.addView(logTitle, block(padding))
        root.addView(log, block(0))
        scroller = ScrollView(this).apply {
            addView(
                root,
                ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT),
            )
        }
        setContentView(scroller)
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

    /**
     * 三块只改字段, 不再整段拼一个 `key: value` 大文本
     *
     * 档位由 [stateOf] 定 (纯函数), 这里只负责把那一档画出来
     */
    private fun render() {
        val access = canReadShared()
        val current = if (access) ForgeConsole.current() else null
        val dir = current?.let { File(it.path) }
        val progress = dir?.let { ForgeConsole.progress(it) }.orEmpty()
        val build = dir?.let { ForgeConsole.lastBuild(it) }.orEmpty()
        // 两份文件谁新谁旧才是"这一档"的判据: progress 新 = 又跑起来了, last-build 新 = 那一笔已经了结
        val state = stateOf(
            progress = progress,
            progressAt = dir?.let { File(it, PROGRESS_FILE).lastModified() } ?: 0L,
            build = buildRead(build),
            buildAt = dir?.let { File(it, BUILD_FILE).lastModified() } ?: 0L,
            hasProject = current != null,
            hasAccess = access,
        )
        bind(current, state)
        // 日志尾巴同理: 行没变就不重设, 一秒一眼那趟不白排版
        val tail = dir?.let { ForgeConsole.logTail(it, 80) }.orEmpty()
        if (tail != log.text.toString()) log.text = tail
    }

    /** 一档画一次: 徽标 / 进度 / 读数 / 原因 / 主钮 (签名没变的那一秒不动一个字节) */
    private fun bind(current: ForgeConsole.Project?, state: DevState) {
        val noAccess = state.phase == DevPhase.NO_ACCESS
        val nameLine = when {
            current != null -> getString(R.string.dev_console_current) + " · " + current.name
            noAccess -> getString(R.string.dev_state_no_access)
            else -> getString(R.string.dev_state_empty)
        }
        // 无权限这一档不许画成"没有项目": 那时项目可能就在盘上, 只是读不到
        val metaText = when {
            current != null -> metaLine(current)
            noAccess -> getString(R.string.dev_console_no_access)
            else -> getString(R.string.dev_console_empty)
        }
        val detail = state.reason.ifBlank { getString(R.string.dev_state_reason_none) }
        val reasonLine = when (state.phase) {
            DevPhase.SUCCESS, DevPhase.FAILED -> getString(R.string.dev_console_build) + " · " + detail
            else -> detail
        }
        val signature = listOf(
            state.phase.id,
            state.step.toString(),
            state.total.toString(),
            reasonLine,
            nameLine,
            metaText,
        ).joinToString("|")
        if (signature == lastSignature) return
        lastSignature = signature
        Log.i(TAG, "state ${state.phase.id} ${state.step}/${state.total}")

        title.text = current?.name ?: getString(R.string.dev_console_title)
        projectName.text = nameLine
        projectMeta.text = metaText

        badge.text = getString(state.badge)
        // 进度条只在构建中上屏; 其余档 INVISIBLE (留着那一格, 三块卡片才不会换高)
        stepBar.visibility = if (state.phase == DevPhase.BUILDING) View.VISIBLE else View.INVISIBLE
        stepBar.max = state.total.coerceAtLeast(1)
        stepBar.progress = state.step.coerceIn(0, stepBar.max)
        stepLabel.text = if (state.total > 0) {
            getString(R.string.dev_state_step, state.step, state.total)
        } else {
            getString(R.string.dev_state_step_none)
        }
        reason.text = reasonLine

        primary.text = getString(state.action)
        primary.setOnClickListener { onAction(state.phase) }
    }

    /** 主钮按档干活: 全是"刷新"或"去别处", 没有一件是改项目 */
    private fun onAction(state: DevPhase) {
        when (state) {
            DevPhase.EMPTY -> openSettings()
            DevPhase.NO_ACCESS -> openAllFilesPage()
            DevPhase.FAILED -> scroller.smoothScrollTo(0, logTitle.top)
            DevPhase.IDLE, DevPhase.BUILDING, DevPhase.SUCCESS -> render()
        }
    }

    /** 项目卡那一行: `包名 xxx · 版本 1.0 (1) · SDK min 33 / target 37 ...` */
    private fun metaLine(project: ForgeConsole.Project): String =
        ForgeConsole.meta(File(project.path)).joinToString(" · ") { "${it.first} ${it.second}" }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    /** 一行小字: 单行 + 尾省略, 三块卡片因此换档也不改高 */
    private fun label(size: Float, style: Int): TextView = TextView(this).apply {
        textSize = size
        setTypeface(typeface, style)
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.END
    }

    private fun block(top: Int, height: Int = ViewGroup.LayoutParams.WRAP_CONTENT): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height).apply { topMargin = top }

    /** 一块卡: 同一档圆角 (高度由外面那三处固定高定死, 这里不碰) */
    private fun card(crossGravity: Int = Gravity.CENTER_VERTICAL): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = crossGravity
        setPadding(dp(14), dp(10), dp(14), dp(10))
        background = cardBackground()
    }

    private fun cardBackground(): GradientDrawable {
        val value = TypedValue()
        theme.resolveAttribute(android.R.attr.colorBackgroundFloating, value, true)
        return GradientDrawable().apply {
            cornerRadius = dp(16).toFloat()
            setColor(if (value.data == 0) 0xFF424242.toInt() else value.data)
            setStroke(dp(1), 0x33000000)
        }
    }

    private fun canReadShared(): Boolean =
        android.os.Environment.isExternalStorageManager()

    /**
     * 空态那颗钮: 开发台是虚拟屏上单独一页, 自己没有回设置的路
     *
     * 于是请门户推到 设置 → 开发 那一页 ([PortalAsk] 只落一个掷标, 由 `HostScreen` 消费),
     * 这一页留一句回执, 人不必猜按钮是不是死的
     */
    private fun openSettings() {
        PortalAsk.ask(PortalAsk.Target.SETTINGS)
        Toast.makeText(this, R.string.dev_action_open_settings_sent, Toast.LENGTH_SHORT).show()
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

    private companion object {
        /** 三块卡片的固定高 (dp); 三张图里卡片高度逐像素相同 */
        const val CARD_HEIGHT_DP = 104

        /** 工坊写的两份读数 (键与 `ForgeConsole` 逐字相同, 这里只取它们的时间) */
        const val PROGRESS_FILE = ".lwforge/progress.json"
        const val BUILD_FILE = ".lwforge/last-build.json"

        /** 换档那一行日志的 tag (`adb logcat -s LwDev`) */
        const val TAG = "LwDev"
    }
}

/**
 * 状态卡那几档: 空态 / 无权限 / 还没构建 / 构建中 / 成功 / 失败
 *
 * `id` 只是给人读的名字 (判据与单测按它摆读数), 不参与界面
 */
internal enum class DevPhase(val id: String) {
    EMPTY("empty"),
    NO_ACCESS("no-access"),
    IDLE("idle"),
    BUILDING("building"),
    SUCCESS("success"),
    FAILED("failed"),
}

/**
 * 一档要画的四件事
 *
 * `badge` / `action` 是字符串资源 id: 徽标是字不是颜色, 主钮按档换一句话
 */
internal data class DevState(
    val phase: DevPhase,
    val badge: Int,
    val action: Int,
    val step: Int = 0,
    val total: Int = 0,
    val reason: String = "",
)

/** `last-build.json` 折出来的两件 */
internal data class BuildRead(val ok: Boolean, val detail: String)

/**
 * `ForgeConsole.lastBuild` 那几行折成 [BuildRead]
 *
 * 键名与 [ForgeConsole] 逐字相同 —— 那一份是唯一写者, 这里只读; 认不出就 null (没有构建记录)
 */
internal fun buildRead(lines: List<Pair<String, String>>): BuildRead? {
    val verdict = lines.firstOrNull { it.first == KEY_VERDICT }?.second ?: return null
    val error = lines.firstOrNull { it.first == KEY_ERROR }?.second.orEmpty()
    val apk = lines.firstOrNull { it.first == KEY_APK }?.second.orEmpty()
    return BuildRead(ok = verdict == VERDICT_OK, detail = error.ifBlank { apk })
}

/** `progress.json` 那一行折出来的三件 */
internal data class StepRead(val index: Int, val total: Int, val text: String)

/**
 * `ForgeConsole.progress` 那一行 (`3/5 · compile · 编译中`) 折成步数
 *
 * 认不出 (老进度文件没有 index/total 这两格) 就 null, 那时不摆进度条
 */
internal fun stepOf(line: String): StepRead? {
    val parts = line.split('·').map { it.trim() }.filter { it.isNotEmpty() }
    val found = parts.firstOrNull()?.let { STEP_HEAD.find(it) } ?: return null
    val index = found.groupValues[1].toIntOrNull() ?: return null
    val total = found.groupValues[2].toIntOrNull() ?: return null
    if (total <= 0) return null
    val name = parts.getOrNull(1).orEmpty()
    val text = parts.getOrNull(2).orEmpty()
    return StepRead(index, total, text.ifBlank { name })
}

/**
 * 纯函数: 两份文件的读数与时间 + 两个前提 -> 一档状态
 *
 * 谁新谁旧才定档, 不靠"进度条到没到头":
 *
 * 1. `last-build` 是新的那一笔且 `ok:false` -> 失败 (中途失败时 progress 停在 2/5 也不会被当成还在跑)
 * 2. `progress` 比 `last-build` 新 -> 构建中 (**末步也算**: 最后一步跑完才会写 last-build;
 *    上一轮留下的老 progress 因为时间早, 也不会再把人钉在"构建中")
 * 3. 其余按那笔结论: 没有记录 -> 还没构建, `ok` -> 成功, 不 ok -> 失败
 *
 * 是纯函数才摆得进判据: 这一段里没有 findViewById / getString / File / ForgeConsole
 * (`check-forge` 第四节)
 */
internal fun stateOf(
    progress: String,
    progressAt: Long,
    build: BuildRead?,
    buildAt: Long,
    hasProject: Boolean,
    hasAccess: Boolean,
): DevState {
    if (!hasAccess) {
        return DevState(DevPhase.NO_ACCESS, R.string.dev_state_no_access, R.string.dev_action_grant)
    }
    if (!hasProject) {
        return DevState(DevPhase.EMPTY, R.string.dev_state_empty, R.string.dev_action_open_settings)
    }
    val step = stepOf(progress)
    if (build != null && !build.ok && buildAt >= progressAt) {
        return DevState(
            DevPhase.FAILED,
            R.string.dev_state_failed,
            R.string.dev_action_log,
            step?.index ?: 0,
            step?.total ?: 0,
            build.detail,
        )
    }
    if (step != null && progressAt > buildAt) {
        return DevState(
            DevPhase.BUILDING,
            R.string.dev_state_building,
            R.string.dev_console_refresh,
            step.index,
            step.total,
            step.text,
        )
    }
    return when {
        build == null -> DevState(DevPhase.IDLE, R.string.dev_state_idle, R.string.dev_console_refresh)
        build.ok -> DevState(
            DevPhase.SUCCESS,
            R.string.dev_state_success,
            R.string.dev_console_refresh,
            step?.index ?: 0,
            step?.total ?: 0,
            build.detail,
        )
        else -> DevState(
            DevPhase.FAILED,
            R.string.dev_state_failed,
            R.string.dev_action_log,
            step?.index ?: 0,
            step?.total ?: 0,
            build.detail,
        )
    }
}

/** `progress.json` 第一段那个 `x/y` */
private val STEP_HEAD = Regex("^(\\d+)\\s*/\\s*(\\d+)$")

/** `last-build.json` 的键 (那一份是唯一写者) */
private const val KEY_VERDICT = "结论"
private const val KEY_ERROR = "错误"
private const val KEY_APK = "APK"
private const val VERDICT_OK = "成功"
