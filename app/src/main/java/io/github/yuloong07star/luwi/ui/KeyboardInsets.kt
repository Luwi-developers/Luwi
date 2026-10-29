package io.github.yuloong07star.luwi.ui

import android.view.WindowInsets as AndroidWindowInsets
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * 软键盘挡住底部输入框时, 页面该往上让多少 (2026-10-28)
 *
 * `targetSdk 37` + `enableEdgeToEdge()` 之后 `android:windowSoftInputMode="adjustResize"` 不再替应用缩窗口,
 * `Scaffold` 的 `innerPadding` 也只含 system bars —— 两块 WebView 要自己把键盘那一段让出来, 否则输入框
 * 被压在键盘后面
 *
 * **只认贴底的那一类键盘**:
 *   · 贴底 (IME 边框并集全宽 + 贴着窗口底部 / 导航条上沿) -> ime.bottom - navigationBars.bottom
 *   · 悬浮键盘 (窗口边框窄, 或没贴到底) -> 0, 输入框不跟着动
 *   · 拿不到 IME 边框 (平台不给) 时退回左右 inset 判断
 *
 * 减掉导航条那一段是因为 `Scaffold` 已经把底部导航条让出来了, 不减会双倍留白
 *
 * 高度读 Compose 的 `WindowInsets.ime` (它跟着窗口 insets 走), 不挂在 WebView 自己身上 ——
 * Compose 的 AndroidView 子树不一定拿到 `onApplyWindowInsets`, 挂在 WebView 上会静默不触发
 */
internal data class ImeFrame(val left: Int, val top: Int, val right: Int, val bottom: Int)

/** 键盘边框与窗口边缘的取整容差 (px), 只用来吸收测量取整 */
private const val IME_FRAME_TOLERANCE_PX = 2

/**
 * 纯函数: 贴底键盘要抬多少 px, 悬浮键盘回 0
 *
 * @param imeBottom 系统报的 IME 底边 inset (含导航条那一段)
 * @param imeLeft / imeRight 系统报的 IME 左右 inset (拿不到边框时的退路)
 * @param navBottom 系统报的导航条 inset
 * @param windowWidth / windowHeight 窗口尺寸 (rootView 的宽高)
 * @param frames 当前 IME 窗口的边框, 空 = 平台没给
 */
internal fun dockedImeLiftPx(
    imeBottom: Int,
    imeLeft: Int,
    imeRight: Int,
    navBottom: Int,
    windowWidth: Int,
    windowHeight: Int,
    frames: List<ImeFrame>,
): Int {
    if (imeBottom <= 0) return 0
    val docked = if (frames.isEmpty()) {
        imeLeft == 0 && imeRight == 0
    } else {
        // 分体键盘是两块拼起来的: 取并集, 全宽 + 贴底才算贴底
        val left = frames.minOf { it.left }
        val right = frames.maxOf { it.right }
        val bottom = frames.maxOf { it.bottom }
        right - left >= windowWidth - IME_FRAME_TOLERANCE_PX &&
            windowHeight - bottom <= navBottom + IME_FRAME_TOLERANCE_PX
    }
    if (!docked) return 0
    return (imeBottom - navBottom).coerceAtLeast(0)
}

/**
 * 盯住窗口的 IME inset, 返回当前该让出的底部高度
 *
 * @return 贴底键盘的 ime.bottom - navigationBars.bottom, 其余情况 0
 */
@Composable
internal fun rememberImeLift(): Dp {
    val density = LocalDensity.current
    val layoutDirection = LocalLayoutDirection.current
    val view = LocalView.current
    val ime = WindowInsets.ime
    val imeBottom = ime.getBottom(density)
    if (imeBottom <= 0) return 0.dp
    val root = view.rootView
    if (root.width <= 0 || root.height <= 0) return 0.dp
    val frames = runCatching {
        view.rootWindowInsets?.getBoundingRects(AndroidWindowInsets.Type.ime())
    }.getOrNull().orEmpty().map { ImeFrame(it.left, it.top, it.right, it.bottom) }
    val lift = dockedImeLiftPx(
        imeBottom = imeBottom,
        imeLeft = ime.getLeft(density, layoutDirection),
        imeRight = ime.getRight(density, layoutDirection),
        navBottom = WindowInsets.navigationBars.getBottom(density),
        windowWidth = root.width,
        windowHeight = root.height,
        frames = frames,
    )
    return with(density) { lift.toDp() }
}
