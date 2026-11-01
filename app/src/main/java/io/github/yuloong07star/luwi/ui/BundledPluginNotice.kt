package io.github.yuloong07star.luwi.ui

import android.content.Context
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.github.yuloong07star.luwi.R
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme

/**
 * 首启那张「别自己更新随包插件」的告示 (2026-10-30 主人)
 *
 * 要说的四样 —— DeepSeek Harness / mneme / dsh-imagegen / 自定义模式 —— 都是**镶在 host 里**的:
 * 它们的版本由 APK 说了算, 每次 Luwi 更新都会连它们一起换到"当下最新且适配这一版"的那一份。
 * 主人自己在界面上把它们单独升级, 换掉的是 APK 解开的那棵树, 下一次更新要么被盖回去、要么留下
 * 一半新一半旧的目录 —— 记忆库那类带数据的插件还可能直接读不回来. 所以这条必须在**第一次打开**
 * 就摆到脸上, 而不是藏在设置里
 *
 * **为什么用真 Dialog**: 开屏之后盖着的是一块 WebView (WebView 是子 View, Compose 的 OverlayDialog
 * 盖不住它, 见 WebCompat 那条同一个根因), 只有自己开一个窗口才在它上面; 于是这里与
 * [ModelSetupDialog] 用同一个 [Dialog]
 *
 * **只弹一次, 且不认点空白 / 返回键**: 这是一条"知道了才能用"的告示, 所以
 * `dismissOnBackPress` / `dismissOnClickOutside` 都关掉; 看过之后记在 `luwi` 偏好里, 之后不再出现.
 * 进程里再记一个 `shownThisRun`, Activity 重建 / 转屏不会又弹一遍
 */
internal object BundledPluginNotice {

    private const val STORE = "luwi"

    /** 看过那条告示没有 (落偏好, 跨启动) */
    private const val SEEN = "bundled-plugin-notice-seen"

    /** 这一次打开应用里已经弹过 (Activity 重建不重弹, 进程死了自然归零) */
    private var shownThisRun = false

    /** 这次打开要不要弹: 没看过、且这一次还没弹过 */
    fun pending(context: Context): Boolean =
        !shownThisRun && !context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getBoolean(SEEN, false)

    /** 「我知道了」: 记下来, 之后不再弹; 写入失败也把这一次算作看过 (不拿偏好当闸) */
    fun acknowledge(context: Context) {
        shownThisRun = true
        runCatching {
            context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putBoolean(SEEN, true).apply()
        }
    }
}

/** 把那张告示挂到每一页之上 (调用点在 [AppNav], 与首启的模型说明并排) */
@Composable
internal fun BundledPluginNoticePrompt() {
    val context = LocalContext.current
    var showing by remember { mutableStateOf(BundledPluginNotice.pending(context)) }
    if (!showing) return
    Dialog(
        // 认死理: 只有按钮能关它
        onDismissRequest = {},
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            dismissOnBackPress = false,
            dismissOnClickOutside = false,
        ),
    ) {
        val scrim = remember { MutableInteractionSource() }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.55f))
                // 点空白什么都不做, 但要把事件吃掉, 免得落到下面那一层
                .clickable(interactionSource = scrim, indication = null) {},
            contentAlignment = Alignment.Center,
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .clickable(interactionSource = scrim, indication = null) {},
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.72f).dp)
                        .verticalScroll(rememberScrollState())
                        .padding(24.dp),
                ) {
                    Text(
                        text = stringResource(R.string.bundled_notice_title),
                        style = MiuixTheme.textStyles.title3,
                    )
                    Text(
                        text = stringResource(R.string.bundled_notice_body),
                        style = MiuixTheme.textStyles.body2,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                    TextButton(
                        text = stringResource(R.string.bundled_notice_ok),
                        onClick = {
                            BundledPluginNotice.acknowledge(context)
                            showing = false
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 18.dp),
                    )
                }
            }
        }
    }
}
