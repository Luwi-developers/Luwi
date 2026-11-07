package io.github.yuloong07star.luwi.theme

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit
import top.yukonga.miuix.kmp.theme.ColorSchemeMode
import top.yukonga.miuix.kmp.theme.ThemeController

/**
 * 外观设置
 *
 * **只剩下深浅色这一档** (2026-11-07 主人: "外观只留深浅色, 其它默认关闭并删除选项"): 原来那一栏
 * 是照 SFA 的主题页搬过来的 —— Monet 动态配色 (键色 / 调色板风格 / 色彩规范) 加「圆角矩形」开关。
 * 这台机器上真正要在意的是"深还是浅", 多一个旋钮就多一处与主题走岔的路, 所以那几项连同它们的字段
 * 与 pref 键一起撤了
 *
 * **"默认关闭"是靠"没有这条通路"保证的**, 不是靠读出来是 false: 字段删掉之后, 谁也没法再把它们
 * 打开, 旧 pref 里那几个键留着也无害 (没人读)
 *
 * @property mode 跟随系统 / 浅色 / 深色
 * @property transition **已废** (2026-10-17 主人撤掉导航那一段): 转场只剩 Miuix 那套, 这个字段只为
 *   读旧 pref 保留, 没人读它
 * @property swipeBack **已废** (同上): 横滑返回一直开着, 这个字段只为读旧 pref 保留
 */
data class ThemeSettings(
    val mode: Int = MODE_SYSTEM,
    val transition: Int = TRANSITION_MIUIX,
    val swipeBack: Boolean = true,
) {
    companion object {
        const val MODE_SYSTEM = 0
        const val MODE_LIGHT = 1
        const val MODE_DARK = 2

        const val TRANSITION_MIUIX = 0

        // 下标 1 本来是 "无", 照 SFA 的选项表换成了 AOSP; 存着的旧值不改写, 于是选过 "无" 的人
        // 升级后拿到的是 AOSP 而不是没有动效
        const val TRANSITION_AOSP = 1
    }
}

/** 设置存在哪, 以及它现在的值, 值变了会重算主题 */
object ThemeStore {

    private const val FILE = "theme"
    private const val MODE = "mode"
    private const val TRANSITION = "transition"
    private const val SWIPE_BACK = "swipe_back"

    private var preferences: SharedPreferences? = null

    /** 当前设置, 未 [initialize] 过时是默认值 */
    var current: ThemeSettings by mutableStateOf(ThemeSettings())
        private set

    /** 从磁盘读一次, 之后每次改动都会写回去 */
    fun initialize(context: Context) {
        if (preferences != null) return
        val store = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        preferences = store
        val defaults = ThemeSettings()
        current = ThemeSettings(
            mode = store.getInt(MODE, defaults.mode),
            transition = store.getInt(TRANSITION, defaults.transition),
            swipeBack = store.getBoolean(SWIPE_BACK, defaults.swipeBack),
        )
    }

    /** 收下一份新设置, 先让界面用上再落盘 */
    fun update(settings: ThemeSettings) {
        current = settings
        preferences?.edit {
            putInt(MODE, settings.mode)
            putInt(TRANSITION, settings.transition)
            putBoolean(SWIPE_BACK, settings.swipeBack)
        }
    }
}

/** 把设置变成 Miuix 的主题控制器: 只有深浅一档, 不再有 Monet 那几条分支 */
fun ThemeSettings.controller(): ThemeController = ThemeController(
    colorSchemeMode = when (mode.coerceIn(0, 2)) {
        ThemeSettings.MODE_LIGHT -> ColorSchemeMode.Light
        ThemeSettings.MODE_DARK -> ColorSchemeMode.Dark
        else -> ColorSchemeMode.System
    },
)
