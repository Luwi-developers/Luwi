package io.github.yuloong07star.luwi.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.yuloong07star.luwi.R
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.overlay.OverlayDialog

/**
 * 「开发」面板 (2026-11-17 主人: 前台更多里加一行, 点进去就是设置里那一段)
 *
 * 内容**原样复用** [DevItems] —— 设置页那一段与这里从此是同一份实现, 不复制任何一行文案与动作:
 * 新建应用 / 开发工具链 / 从文件导入 / 打开开发台 (+ 下载页)
 *
 * 窗口用 Miuix 的 [OverlayDialog] (与「关于」那几窗同一个排法); 面板本身比一屏高, 所以内容可滚
 */
@Composable
internal fun DevPanelDialog(onDismissRequest: () -> Unit) {
    OverlayDialog(
        show = true,
        title = stringResource(R.string.dev_panel_title),
        defaultWindowInsetsPadding = false,
        onDismissRequest = onDismissRequest,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 460.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            DevItems()
        }
        TextButton(
            text = stringResource(R.string.settings_close),
            onClick = onDismissRequest,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.textButtonColorsPrimary(),
        )
    }
}
