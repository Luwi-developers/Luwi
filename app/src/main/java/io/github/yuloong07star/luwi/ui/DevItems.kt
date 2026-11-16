package io.github.yuloong07star.luwi.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.constants.UiSpacing
import io.github.yuloong07star.luwi.tool.DevTools
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.preference.ArrowPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 设置页那一段「开发」 (2.8.1 #16, 主人 2026-11-16: "在 luwi 设置里加个开发板块, 上面加上可以让用户
 * 自行下载'安卓开发工具'和'luwi 开发台'伴侣软件")
 *
 * 一段话 + 三行, 没有开关:
 *
 * | 行 | 做什么 |
 * | :-- | :-- |
 * | 安卓开发工具 | 下那一件伴侣 APK, 再交给系统安装器 |
 * | Luwi 开发台 | 同上 |
 * | 打开下载页 | 直链下不动时, 把人送到那一页自己挑 |
 *
 * **"自行下载" 在这一段是这个意思**: 应用只把包下下来, 装不装由人在系统安装器那一页点的那一下定
 * ([DevTools.download] 里没有一处替谁按那个安装键). 所以小字只报状态 (没装 / 正在下 / 已装 vX), 不写
 * "已经装好了" 这种替人做主的句子
 *
 * 装没装读的是系统那一份事实 ([DevTools.installed]), 下完再读一次 (`revision`) —— 人在安装器那一页
 * 装完回来, 这一行自己就会变成 "已装"
 */
@Composable
internal fun DevItems() {
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    // 正在下的是哪一件 (同一刻只让一件在跑: 两条一起往下冲只会两个都慢)
    var busy by remember { mutableStateOf<String?>(null) }
    // 上一趟的结果 (成了 / 为什么没成), 一句话
    var said by remember { mutableStateOf<String?>(null) }
    // 装没装要重读一次: 从安装器回来时界面还在, 只有这个记号变了才会再看一遍系统那一份
    var revision by remember { mutableIntStateOf(0) }

    Card {
        DevTools.tools.forEach { tool ->
            val version = remember(revision) { DevTools.installed(context, tool) }
            val blurb = stringResource(tool.blurb)
            val state = when {
                busy == tool.id -> stringResource(R.string.settings_dev_busy)
                version != null -> stringResource(R.string.settings_dev_installed, version)
                else -> stringResource(R.string.settings_dev_absent)
            }
            ArrowPreference(
                title = stringResource(tool.label),
                summary = "$blurb · $state",
                onClick = {
                    if (busy != null) return@ArrowPreference
                    haptic.confirm()
                    busy = tool.id
                    scope.launch {
                        // 下载与安装都是阻塞的 (网络 + 可能一次 pm install), 而这里是主线程
                        val line = withContext(Dispatchers.IO) { DevTools.download(context, tool) }
                        busy = null
                        said = line
                        revision += 1
                    }
                },
            )
        }
    }

    DevLines(said ?: stringResource(R.string.settings_dev_note))

    Card {
        ArrowPreference(
            title = stringResource(R.string.settings_dev_page),
            summary = stringResource(R.string.settings_dev_page_summary),
            onClick = {
                haptic.contextClick()
                openPage(context, DevTools.PAGE)?.let { said = it }
            },
        )
    }
}

/** 段里那一句话 (与 [PlaceholderItems] 同一种排法: 不进卡片, 一行小字) */
@Composable
private fun DevLines(text: String) {
    Column(modifier = Modifier.fillMaxWidth().padding(UiSpacing.Large)) {
        Text(text = text, color = colorScheme.onSurfaceVariantActions)
    }
}
