package io.github.yuloong07star.luwi.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.host.LwInterfaces
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.preference.ArrowPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 设置页最末那段「接口」 (2026-10-25 主人: "在设置末尾加个接口文档…接口文档放当前已开放的接口"
 * 之后又收窄成 "版块只留接口文档和复制文档地址，两个选项即可")
 *
 * 一段话 + 两行, 没有开关:
 *
 * | 行 | 做什么 |
 * | :-- | :-- |
 * | 接口文档 | 弹窗显示全文 (开屏 / 浮标状态 / 浮标外观 / 语音状态 / 快捷指令 / 技能 / 自动指令 / 探索卡) |
 * | 复制文档地址 | 把 `$DSH_HOME/lw/interfaces.md` 这条路径放进剪贴板 |
 *
 * 文档只有一份来源 ([LwInterfaces]), 落盘的那份 `$DSH_HOME/lw/interfaces.md` 就是 agent 要读的东西;
 * 这里显示与复制的是同一份, 两处各写一遍就会漂
 */
@Composable
internal fun ApiItems() {
    val context = LocalContext.current
    var doc by remember { mutableStateOf<String?>(null) }
    val copied = stringResource(R.string.settings_api_copied)
    val path = remember { LwInterfaces.docFile(context).absolutePath }

    Card {
        ArrowPreference(
            title = stringResource(R.string.settings_api_doc),
            summary = stringResource(R.string.settings_api_doc_summary, path),
            onClick = { doc = LwInterfaces.docText(context) },
        )
        ArrowPreference(
            title = stringResource(R.string.settings_api_copy_path),
            summary = stringResource(R.string.settings_api_copy_path_summary),
            onClick = {
                val clipboard = context.getSystemService(ClipboardManager::class.java)
                val placed = runCatching {
                    clipboard?.setPrimaryClip(ClipData.newPlainText("Luwi interfaces", path))
                }.isSuccess && clipboard != null
                Toast.makeText(
                    context,
                    if (placed) copied else context.getString(R.string.settings_api_copy_failed),
                    Toast.LENGTH_SHORT,
                ).show()
            },
        )
    }

    doc?.let { text -> InterfaceDocDialog(text = text, onDismiss = { doc = null }) }
}

/**
 * 文档全文那一窗
 *
 * 字是等宽的: 正文里有 JSON 示例与路径, 比例字体会把缩进和对齐全打乱。窗口封在半屏以内并自带滚动 ——
 * Miuix 的 `OverlayDialog` 不滚也没有 maxHeight, 所以这里是真 `Dialog` (理由同 [WebViewTroubleDialog])
 */
@Composable
private fun InterfaceDocDialog(text: String, onDismiss: () -> Unit) {
    val screenHeight = LocalConfiguration.current.screenHeightDp
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        val scrim = remember { MutableInteractionSource() }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.4f))
                .clickable(interactionSource = scrim, indication = null) { onDismiss() },
            contentAlignment = Alignment.Center,
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp)
                    .clickable(interactionSource = scrim, indication = null) {},
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = stringResource(R.string.settings_api_doc_title),
                        style = MiuixTheme.textStyles.title3,
                    )
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = (screenHeight * 0.58f).dp)
                            .verticalScroll(rememberScrollState())
                            .padding(top = 10.dp),
                    ) {
                        Text(
                            text = text,
                            style = MiuixTheme.textStyles.footnote1.copy(fontFamily = FontFamily.Monospace),
                            color = colorScheme.onSurfaceVariantSummary,
                        )
                    }
                    TextButton(
                        text = stringResource(R.string.settings_close),
                        onClick = onDismiss,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 10.dp),
                    )
                }
            }
        }
    }
}
