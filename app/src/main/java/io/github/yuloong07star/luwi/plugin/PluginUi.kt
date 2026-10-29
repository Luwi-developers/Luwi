package io.github.yuloong07star.luwi.plugin

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue

/**
 * 插件列表的"该重读了"信号 (2026-10-28)
 *
 * 列表页与详情页是两条路由: 详情页里停用 / 卸载之后, 列表页仍然留在返回栈里 (它没有被重建),
 * 它那份 `remember(revision)` 里的 entries 就是旧名单 —— 于是删掉的插件还在页面上挂着, 直到手动
 * 刷新。这里给详情页一个"说一声"的地方, 列表页把它当 key 就能当场重读
 */
internal object PluginUi {
    var revision by mutableIntStateOf(0)
        private set

    fun bump() {
        revision += 1
    }
}
