package io.github.yuloong07star.luwi.ui

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import io.github.yuloong07star.luwi.tool.DevConsole
import io.github.yuloong07star.luwi.tool.DevToolchain
import io.github.yuloong07star.luwi.tool.DevTools
import io.github.yuloong07star.luwi.tool.LwForge
import io.github.yuloong07star.luwi.tool.ToolchainPack
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.preference.ArrowPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 设置页那一段「开发」 (2.8.1 #16; 2026-11-17 按主人口径改成「一个应用 + 一份数据包」)
 *
 * 一段话 + 四行:
 *
 * | 行 | 做什么 |
 * | :-- | :-- |
 * | Luwi 开发台 | 下那一件伴侣 APK, 再交给系统安装器 (它有界面, 只能装成应用) |
 * | 开发工具链 | 把 `luwi-toolchain.zip` 下到 Luwi 自己的目录, 再交给特权进程 — **不装第二个应用** |
 * | 连接开发台 | 绑上开发台, 读出它当前打开的项目 |
 * | 打开开发台 (虚拟屏) | 建屏并把开发台拉上去, 构建时在上面看进度 |
 * | 打开下载页 | 直链下不动时, 把人送到那一页自己挑 |
 *
 * **"自行下载" 在这一段是这个意思**: 应用只把包下下来, 装不装由人在系统安装器那一页点的那一下定
 * ([DevTools.download] 里没有一处替谁按那个安装键). 所以小字只报状态 (没装 / 正在下 / 已装 vX)
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

    // 「从文件导入工具链」: 这台网络下 113 MB 常被掐断, 人在电脑上下好再选进来的一条
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) {
            haptic.confirm()
            scope.launch {
                said = withContext(Dispatchers.IO) { importToolchain(context, uri) }
                revision += 1
            }
        }
    }

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

    // 2.8.1 的三行: 连开发台 / 装工具链 / 把开发台拉到虚拟屏上.
    // 三件都要绑伴侣的 Service 或者起屏, 全是阻塞活儿 —— 一律下 IO, 结果回一句 `said`
    Card {
        ArrowPreference(
            title = stringResource(R.string.settings_dev_connect_title),
            summary = stringResource(R.string.settings_dev_connect_summary),
            onClick = {
                haptic.confirm()
                scope.launch {
                    said = withContext(Dispatchers.IO) { DevConsole.status(context) }
                }
            },
        )
        ArrowPreference(
            title = stringResource(R.string.settings_dev_toolchain_title),
            summary = stringResource(R.string.settings_dev_toolchain_summary),
            onClick = {
                haptic.confirm()
                scope.launch {
                    said = withContext(Dispatchers.IO) { DevToolchain.install(context) }
                    revision += 1
                }
            },
        )
        ArrowPreference(
            title = stringResource(R.string.settings_dev_import_title),
            summary = stringResource(R.string.settings_dev_import_summary),
            onClick = {
                haptic.contextClick()
                importLauncher.launch("application/zip")
            },
        )
        ArrowPreference(
            title = stringResource(R.string.settings_dev_open_title),
            summary = stringResource(R.string.settings_dev_open_summary),
            onClick = {
                haptic.contextClick()
                scope.launch {
                    said = withContext(Dispatchers.IO) { LwForge.openConsole(context) }
                }
            },
        )
    }

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

/**
 * 把人选的那份 zip 抄进 Luwi 自己的目录, 再交给 [ToolchainPack.installFromZip]
 *
 * 选进来的东西只当**一份数据**看: 抄完先验整包 sha256, 不对就一句话回绝
 */
private fun importToolchain(context: Context, uri: Uri): String {
    val root = context.getExternalFilesDir("toolchain-pack") ?: return "这块设备上没有外部目录"
    root.mkdirs()
    val target = java.io.File(root, DevTools.TOOLCHAIN_ASSET)
    runCatching {
        context.contentResolver.openInputStream(uri)?.use { input ->
            target.outputStream().use { sink -> input.copyTo(sink) }
        } ?: error("这个 URI 打不开")
    }.getOrElse { return "文件读不动: ${it.message ?: it.javaClass.simpleName}" }
    return ToolchainPack.installFromZip(context, target)
}
