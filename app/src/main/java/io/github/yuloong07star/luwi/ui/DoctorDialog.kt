/*
 * 「自检」对话框 (主人 2026-11-08: 先自检; 自检解决不了, 由人自己决定要不要匿名上报)
 *
 * 三条线画在这里:
 * 1. 一打开就**先把报告排出来** (本机读取, 一个字节不出门) —— 多数人照着这张表就能自己修好;
 * 2. 出门只有一条路: 点「匿名上报」→ 弹一次确认 → 发出去的只有这张表 (机型/系统/版本/各层状态),
 *    不带截图、不带输入、不带账号, 也不带宿主日志;
 * 3. 失败只说一句人话, 不把栈丢给用户。
 *
 * 报告怎么排 (纯函数) 在 [io.github.yuloong07star.luwi.doctor.DoctorReport.toText],
 * 这里只负责显示、复制、上报。
 */
package io.github.yuloong07star.luwi.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.doctor.Doctor
import io.github.yuloong07star.luwi.doctor.DoctorStatus
import io.github.yuloong07star.luwi.feedback.Feedback
import io.github.yuloong07star.luwi.feedback.FeedbackSubmit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.overlay.OverlayDialog
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme
import top.yukonga.miuix.kmp.utils.overScrollVertical

/** 报告区的最高高度: 再长就在框里滚, 不把对话框撑到屏幕外 */
private val ReportMaxHeight = 340.dp

/**
 * 反馈群号 —— 修不好时第一优先的动作是「进群说一句」, 不是「填表上报」
 *
 * 主人 2026-11-08: 群号要放在最显眼处, 并且明说加群修得更快、也是对我们的支持。
 * 留空时这一行不显示 (换成群号只改这一处)。
 */
internal const val QQ_GROUP_NUMBER: String = "1130917719"

@Composable
internal fun DoctorDialog(onDismissRequest: () -> Unit) {
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    var report by remember { mutableStateOf(Doctor.collect(context)) }
    var askingToSend by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    // null = 还没报过, "" = 报成功, 其它 = 一句人话
    var outcome by remember { mutableStateOf<String?>(null) }

    val text = remember(report) {
        report.toText(
            app = FeedbackSubmit.appLine(context),
            device = FeedbackSubmit.deviceLine(context),
        )
    }

    fun copyOut() {
        context.getSystemService(ClipboardManager::class.java)
            ?.setPrimaryClip(ClipData.newPlainText("Luwi doctor", text))
        Toast.makeText(context, R.string.doctor_copied, Toast.LENGTH_SHORT).show()
    }

    fun copyGroup() {
        context.getSystemService(ClipboardManager::class.java)
            ?.setPrimaryClip(ClipData.newPlainText("Luwi group", QQ_GROUP_NUMBER))
        Toast.makeText(context, R.string.doctor_group_copied, Toast.LENGTH_SHORT).show()
    }

    OverlayDialog(
        show = true,
        title = stringResource(R.string.doctor_title),
        summary = stringResource(R.string.doctor_summary),
        defaultWindowInsetsPadding = false,
        onDismissRequest = onDismissRequest,
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = ReportMaxHeight)
                    .overScrollVertical()
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = 12.dp),
            ) {
                text.lineSequence().forEach { line ->
                    // 只有 FAIL 用红: 别的都用次级色, 免得满屏红把人吓一跳
                    val color = if (line.startsWith("[FAIL]")) {
                        colorScheme.error
                    } else {
                        colorScheme.onSurfaceVariantSummary
                    }
                    Text(
                        text = line,
                        style = MiuixTheme.textStyles.footnote1.copy(fontFamily = FontFamily.Monospace),
                        color = color,
                    )
                }
            }

            // 先说清「为什么值得上报」 (主人 2026-11-08: 光有自检不够, 得让人知道上报是为了把问题修掉)
            Text(
                text = stringResource(R.string.doctor_why),
                style = MiuixTheme.textStyles.footnote1,
                color = colorScheme.onSurfaceVariantSummary,
            )

            if (QQ_GROUP_NUMBER.isNotBlank()) {
                // 群号放在按钮上面 (主人: 优先附群号, 加群修得更快, 也是对我们的支持)
                // 整行可点就复制, 不再单独占一个大按钮
                Spacer(Modifier.height(4.dp))
                Text(
                    text = stringResource(R.string.doctor_group_line, QQ_GROUP_NUMBER),
                    style = MiuixTheme.textStyles.footnote1,
                    color = colorScheme.primary,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .clickable {
                            haptic.contextClick()
                            copyGroup()
                        }
                        .padding(vertical = 4.dp),
                )
            }

            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                MiniAction(stringResource(R.string.doctor_copy)) {
                    haptic.contextClick()
                    copyOut()
                }
                MiniAction(stringResource(R.string.doctor_recheck)) {
                    haptic.contextClick()
                    outcome = null
                    report = Doctor.collect(context)
                }
                if (report.needsAttention) {
                    MiniAction(
                        text = if (sending) stringResource(R.string.doctor_sending) else stringResource(R.string.doctor_send),
                        tint = colorScheme.primary,
                        filled = true,
                        onClick = {
                            if (sending) return@MiniAction
                            haptic.contextClick()
                            askingToSend = true
                        },
                    )
                }
            }

            outcome?.let { message ->
                Spacer(Modifier.height(8.dp))
                Text(
                    text = if (message.isEmpty()) {
                        stringResource(R.string.doctor_send_ok)
                    } else {
                        stringResource(R.string.doctor_send_failed, message)
                    },
                    style = MiuixTheme.textStyles.footnote1,
                    color = if (message.isEmpty()) colorScheme.onSurfaceVariantSummary else colorScheme.error,
                )
            }
        }
    }

    if (askingToSend) {
        OverlayDialog(
            show = true,
            title = stringResource(R.string.doctor_send_confirm_title),
            summary = stringResource(R.string.doctor_send_confirm_summary),
            defaultWindowInsetsPadding = false,
            onDismissRequest = { askingToSend = false },
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                Row(horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(
                        text = stringResource(R.string.button_cancel),
                        onClick = {
                            haptic.contextClick()
                            askingToSend = false
                        },
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(20.dp))
                    TextButton(
                        text = stringResource(R.string.doctor_send_confirm_send),
                        onClick = {
                            haptic.confirm()
                            askingToSend = false
                            sending = true
                            scope.launch {
                                val error = withContext(Dispatchers.IO) {
                                    FeedbackSubmit.post(
                                        FeedbackSubmit.endpoint(context),
                                        FeedbackSubmit.payload(
                                            Feedback.Kind.ISSUE,
                                            text,
                                            "",
                                            FeedbackSubmit.appLine(context),
                                            FeedbackSubmit.deviceLine(context),
                                        ),
                                    )
                                }
                                outcome = error.orEmpty()
                                sending = false
                            }
                        },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.textButtonColorsPrimary(),
                    )
                }
            }
        }
    }
}

/**
 * 一颗小胶囊按钮
 *
 * 主人 2026-11-08「按键太大号了, 很丑」—— miuix 的 [TextButton] 自带很大的最小高度,
 * 四个排下来像四面墙; 这里自己画一颗 32dp 高的小胶囊, 三个并成一行。
 * 高亮的那颗 (匿名上报) 只多一层淡淡的底色与更实的边, 不用整块主色, 免得抢走报告的注意力。
 */
@Composable
private fun MiniAction(
    text: String,
    tint: androidx.compose.ui.graphics.Color = colorScheme.onSurfaceVariantActions,
    filled: Boolean = false,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(50)
    Box(
        modifier = Modifier
            .clip(shape)
            .then(
                if (filled) {
                    Modifier.background(colorScheme.primary.copy(alpha = 0.13f))
                } else {
                    Modifier
                },
            )
            .border(1.dp, tint.copy(alpha = if (filled) 0.5f else 0.26f), shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 13.dp, vertical = 7.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style = MiuixTheme.textStyles.footnote1,
            color = if (filled) colorScheme.primary else tint,
        )
    }
}
