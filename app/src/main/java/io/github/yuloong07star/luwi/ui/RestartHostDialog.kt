/*
 * 「重启 dsh」那一问 (2026-11-22 主人: "成功配对或关闭终端等需要重新启动的情况, 要弹出重启 dsh 启动终端的弹窗")
 *
 * 为什么非问一句: 终端是 dsh 里的插件, 配置 (配对 / 总开关 / 取消配对) 是**挂载时**读一次 ——
 * 写完文件当下什么都没变, 只有重启过 host 才生效。以前这几个写入点各自 `DshHost.restart` 一声不吭地
 * 把页面掀掉, 人看到的只是"界面突然重来"; 现在改成先问一句, 由人决定什么时候重启
 *
 * 四个写入点共用这一份 (门户扫码配对 / 设置扫码配对 / 终端总开关开与关 / 取消配对), 标题按场景换,
 * 正文与两颗钮固定: 「取消」= 什么都不动 (配置已写, 之后再从 ⋮ 里那条重启 host 补), 「现在重启」= 真重启
 */
package io.github.yuloong07star.luwi.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import io.github.yuloong07star.luwi.R
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.overlay.OverlayDialog

/**
 * 问一句"现在重启 dsh 吗"
 *
 * @param title 场景那一句 (配对成功 / 终端已打开 / 终端已关闭 / 已取消配对)
 * @param onDismissRequest 取消 (或点外面 / 返回键): 不重启, 配置留在文件里
 * @param onRestart 人点了「现在重启」: 调用方自己 [io.github.yuloong07star.luwi.host.DshHost.restart]
 */
@Composable
internal fun RestartHostDialog(
    title: String,
    onDismissRequest: () -> Unit,
    onRestart: () -> Unit,
) {
    val haptic = LocalHapticFeedback.current
    OverlayDialog(
        show = true,
        title = title,
        summary = stringResource(R.string.terminal_restart_body),
        defaultWindowInsetsPadding = false,
        onDismissRequest = onDismissRequest,
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(
                text = stringResource(R.string.button_cancel),
                onClick = {
                    haptic.contextClick()
                    onDismissRequest()
                },
                modifier = Modifier.weight(1f),
            )
            TextButton(
                text = stringResource(R.string.terminal_restart_ok),
                onClick = {
                    haptic.confirm()
                    onRestart()
                },
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.textButtonColorsPrimary(),
            )
        }
    }
}
