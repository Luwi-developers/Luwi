package io.github.yuloong07star.luwi.scaffolds

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.textStyles

/**
 * 所有"要打字"的弹窗都走这里 (2026-11-14 主人: "填写窗放屏幕中间, 防止弹出键盘时挡住填写内容")
 *
 * **为什么不套 Miuix 的 `OverlayDialog`**: 它有两件事与这条需求冲突, 都在真机 A 上量到过 ——
 *
 * 1. 小屏时它按 `Alignment.BottomCenter` 贴底放; 改成 `largeScreen = true` 虽居中, 但那一档会把窗
 *    画进 root scaffold, 嵌套场景 (门户「更多设置」→ 数字窗) 就被外层弹窗整个盖住, 表现是"点了没反应"
 * 2. 它自己开窗口且按默认 `decorFitsSystemWindows` 吃掉了 ime insets: 内容里 `WindowInsets.ime`
 *    恒 0, `imePadding()` 拿不到键盘高度 —— 长文本窗那颗「确定」被键盘压住
 *
 * 所以这里用 Compose 自己的 [Dialog]: 关掉窗口内缩 (`decorFitsSystemWindows = false`)、关掉平台默认
 * 宽度, 自己 `Box(fillMaxSize, Center)` 居中 + `imePadding()` 让出键盘。卡片与文字仍是 Miuix 那套
 * (`Card` / `colorScheme` / `textStyles`), 观感与别的弹窗一致
 *
 * @param title 标题
 * @param onDismissRequest 点外面 / 返回键
 * @param show 开不开
 * @param summary 说明 (标题下面那一行, 可省)
 * @param onDismissFinished 关完动画结束时叫一次 (有的行要在那时才松开按住态)
 * @param heightFraction 内容最高占屏幕的几分之一 (长文本窗靠它 + 内部滚动, 弹窗不会被撑出屏)
 * @param content 表单本体: 输入框 + 那一对「取消 / 确定」
 */
@Composable
fun InputDialog(
    title: String,
    onDismissRequest: () -> Unit,
    show: Boolean = true,
    summary: String? = null,
    onDismissFinished: (() -> Unit)? = null,
    heightFraction: Float = 0.62f,
    content: @Composable ColumnScope.() -> Unit,
) {
    if (!show) return
    val screenHeight = LocalConfiguration.current.screenHeightDp
    Dialog(
        onDismissRequest = {
            onDismissRequest()
            onDismissFinished?.invoke()
        },
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        // imePadding 在外层: 键盘起来时整块可用区抬起来, 居中于是落在"键盘上面那一段"的正中
        Box(
            modifier = Modifier
                .fillMaxSize()
                .imePadding()
                .padding(horizontal = 20.dp, vertical = 24.dp),
            contentAlignment = Alignment.Center,
        ) {
            BoxWithConstraints(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                // 键盘顶上来之后这一格会变矮 (Box 被 imePadding 压过), 卡片跟着收 —— 底部两颗按钮
                // 于是始终在键盘上方; 键盘收起时退回 heightFraction 那一档
                val byFraction = (screenHeight * heightFraction).dp
                val cap = if (maxHeight < byFraction) maxHeight else byFraction
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = cap)
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 20.dp, vertical = 20.dp),
                    ) {
                        Text(text = title, style = textStyles.title3, color = colorScheme.onSurface)
                        if (!summary.isNullOrBlank()) {
                            Text(
                                text = summary,
                                style = textStyles.body2,
                                color = colorScheme.onSurfaceVariantSummary,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                        }
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 16.dp),
                            content = content,
                        )
                    }
                }
            }
        }
    }
}
