package io.github.yuloong07star.luwi.ui

import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.runtime.Composable
import top.yukonga.miuix.kmp.nav.core.NavEntryBuilder

/**
 * 公开构建里的 `LuwiTavern` (2026-10-29, C 方案)
 *
 * 与私有目录里那一份**同一个 FQN**, 二选一: 完整版构建把它 exclude 掉, 公开构建就用这一份。
 * 共享文件 (AppNav / SettingsScreen / HostScreen / MainActivity / CustomPresets / PluginOverlay)
 * 对酒馆的每一次调用都落在这些空实现上 —— 于是公开树里没有任何 `luwi.tavern` 的符号
 */
object LuwiTavern {
    /** 这一份构建不带酒馆 */
    val enabled: Boolean = false

    /** 没有酒馆就没有那一段, 设置页的段名表也跟着少一个 */
    val sectionKeys: List<String> = emptyList()

    @Composable
    fun summaryEffect(reload: Int) = Unit

    fun tavernSection(scope: LazyListScope, collapsed: Set<String>, onToggle: (String) -> Unit) = Unit

    fun tavernEntries(builder: NavEntryBuilder) = Unit

    @Composable
    fun overlays() = Unit

    fun handleBack(): Boolean = false

    fun releaseCache() = Unit
}
