package io.github.yuloong07star.luwi.ui

import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Insets
import android.net.Uri
import android.os.Environment
import android.os.Message
import android.os.SystemClock
import android.util.Log
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.constants.UiSpacing
import io.github.yuloong07star.luwi.channel.PreviewControl
import io.github.yuloong07star.luwi.channel.ScreenState
import io.github.yuloong07star.luwi.channel.VirtualScreen
import io.github.yuloong07star.luwi.host.BallReturn
import io.github.yuloong07star.luwi.host.DshHost
import io.github.yuloong07star.luwi.host.HostStatus
import io.github.yuloong07star.luwi.overlay.OverlayState
import io.github.yuloong07star.luwi.sync.SyncSetting
import io.github.yuloong07star.luwi.tool.LwWakeWord
import io.github.yuloong07star.luwi.tool.OpenFile
import androidx.core.content.ContextCompat
import io.github.yuloong07star.luwi.wake.WakeWordDownload
import io.github.yuloong07star.luwi.voice.VoiceState
import io.github.yuloong07star.luwi.wake.WakeWordService
import io.github.yuloong07star.luwi.wake.WakeWordState
import org.json.JSONObject
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.DropdownEntry
import top.yukonga.miuix.kmp.basic.DropdownItem
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.Scaffold
import top.yukonga.miuix.kmp.basic.SnackbarHost
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Remove
import top.yukonga.miuix.kmp.icon.extended.Tune
import top.yukonga.miuix.kmp.overlay.OverlayDialog
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
import kotlin.math.roundToInt
import top.yukonga.miuix.kmp.menu.OverlayIconCascadingDropdownMenu
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 同一句虚拟屏错误在这段时间里只弹一次
 *
 * 30 s 是主人定的口径 (2.8.0 B2-c ⑩): 连点几下会连着失败三四回, 每回都弹一个窗等于什么都没说,
 * 而半分钟之后还是同一句, 说明事情没过去, 该再说一遍
 */
internal const val SCREEN_ERROR_WINDOW_MS = 30_000L

/**
 * 主页那条错误提示的去重状态
 *
 * 以前失败那句话是**常驻**的 (`selected == null` 时页面上一直挂着一行「虚拟屏: …」), 要等下一次
 * 成功才消失 —— 人分不清它是刚刚发生的还是昨天留下的。现在改成弹一次就走, 于是"什么时候该再弹"
 * 成了一件事: 第一句弹, 同一句在窗口内丢掉, 窗口过了再弹, 换了一句立刻弹
 *
 * 时钟是参数而不是 `SystemClock` 直接读, 所以这一条单测能直接量 (见 `ScreenErrorOnceTest`), 不用
 * 等真机上失败三回
 *
 * @param windowMs 同一句理由的去重窗口, 默认 [SCREEN_ERROR_WINDOW_MS]
 */
internal class ScreenErrorOnce(private val windowMs: Long = SCREEN_ERROR_WINDOW_MS) {

    /** 上一次真弹出去的那句理由, null 表示还没弹过 */
    private var reason: String? = null

    /** 它弹出去的那个时刻 (调用方给的时钟读数) */
    private var at = 0L

    /**
     * 这一句该不该弹
     * @param next 现在的 `VirtualScreen.lastError`, null / 空白表示没有错误
     * @param now 单调时钟的读数 ([SystemClock.uptimeMillis]), 只用来量窗口
     * @return true = 弹这一次; false = 同一句还在窗口里, 或者根本没有错误
     */
    fun take(next: String?, now: Long): Boolean {
        if (next.isNullOrBlank()) return false
        if (next == reason && now - at < windowMs) return false
        reason = next
        at = now
        return true
    }
}

/**
 * 那一条去重状态
 *
 * **挂在这一层而不是 `remember` 里**: 它离开组合 (进设置页、回来) 时 remember 就没了, 于是"30 s
 * 内只弹一次"会悄悄变成"每次回到主页都弹" —— 而这正是它要挡的那件事
 */
private val screenErrorOnce = ScreenErrorOnce()

/**
 * 主页面: dsh 的 Web GUI 占满, 虚拟屏的画面浮在它上面
 *
 * 画面是一个可拖动的小窗而不是占一条高度: 屏在后台跑着, 人要能一边看着它一边用会话, 而占高度
 * 会把会话挤掉一条。代价反过来了 - 小窗盖住的那一块 dsh 看不见 (WebView 量的是自己的视口), 所以
 * 窗越小界面越完整, 见 [FloatingScreenWindow] 与 `WINDOW_SCREEN_FRACTION`
 *
 * 顶栏末尾的级联菜单第一层就两项, 虚拟屏与设置; 虚拟屏那一项自己带着当前选中的是哪块屏, 展开
 * 才是屏的列表, 选中哪块看哪块, 再点一次同一块就是不看
 *
 * **有画面在看的时候顶栏整个让位** (2026-09-22): `SmallTopAppBar` 的高度是 `CollapsedHeight`
 * 52dp, 与标题长不长无关 (标题空着也一样), 而这一页的标题只是个应用名, 那 52dp 给会话更值。
 * 于是这时不放 topBar, 菜单按钮改成浮在小窗右上角, 静一会儿自己淡出, 碰一下画面再出来 - 与手机
 * 上视频播放器的控件一个脾气。不看画面了 (收起或没选中) 就回到那条默认顶栏
 * @param modifier layout modifier from the caller.
 */
@Composable
fun HostScreen(modifier: Modifier = Modifier) {
    val navigator = LocalRootNavigator.current
    val selected = VirtualScreen.selected
    // 选中就是显示: 没有"收起了但还选着"这种状态, 取消选中就是不看了
    val preview = selected

    // 减号把整扇窗收掉, 收起来之后界面上一点痕迹都不留; 要它回来走 ⋮ 菜单里那一项
    var windowHidden by remember { mutableStateOf(false) }
    // 浮标菜单里的「Luwi反馈」: 与设置页 ⋮ 第一条同一个窗 (2026-10-29)
    var feedbackOpen by remember { mutableStateOf(false) }
    // 正在弹的那条虚拟屏错误, null 表示没有 (2.8.0 B2-c): 以前这里是一行常驻文字, 现在是一次性的
    var screenError by remember { mutableStateOf<String?>(null) }

    // lastError 一变就判一次该不该弹: 同一句 30 s 内只弹一次 (⑩), 判过就把它记进 screenError
    LaunchedEffect(VirtualScreen.lastError) {
        val reason = VirtualScreen.lastError
        if (screenErrorOnce.take(reason, SystemClock.uptimeMillis())) screenError = reason
    }

    // **这一页没有顶栏**: 原来那条写着应用名的 `SmallTopAppBar` 去掉了, 顶上那点位置让给会话。
    // 唯一的菜单入口是浮标 (见 FloatingBall)。`innerPadding` 仍然带着状态栏那条 inset, 所以内容
    // 不会钻到时钟底下 - 顶栏在的时候那条 inset 是由顶栏自己吃的, 现在改由 Scaffold 给
    Scaffold(modifier = modifier.fillMaxSize()) { innerPadding ->
        Box(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.padding(innerPadding).fillMaxSize()) {
                // 画面空着就是空着, 页面上不留一行字 - 有没有屏、选中哪一块, ⋮ 菜单里都写着
                when (val status = DshHost.status) {
                    is HostStatus.Running -> {
                        // host 一就绪 WebView 就挂上, 而它把八百多 KB 的前端跑起来还要一两秒 —— 那一段
                        // 原来是纯白屏。开屏那块**不能盖在 WebView 上面** (它是同一个窗口里的子 View,
                        // 永远在组合绘制内容之上), 所以反过来: 页面先以 alpha 0 挂着加载, 开屏那块画在
                        // 它底下; 页面 ready 之后它淡进来, 淡到 1 才把开屏撤掉
                        var pageUp by remember(status) { mutableStateOf(false) }
                        val alpha by animateFloatAsState(
                            targetValue = if (pageUp) 1f else 0f,
                            animationSpec = tween(260),
                            label = "page-fade",
                        )
                        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                            HostWebView(
                                url = status.url,
                                modifier = Modifier.fillMaxSize(),
                                alpha = alpha,
                                onReady = { pageUp = true },
                                // renderer 真的死了 (重建过一次): 把开屏再盖回去, 别让人对着
                                // 一块空白的子 View 等新页面加载
                                onLost = { pageUp = false },
                            )
                            if (alpha < 1f) {
                                HostBootPanel(
                                    status = status,
                                    pageStage = stringResource(R.string.boot_stage_page),
                                    modifier = Modifier.fillMaxSize(),
                                )
                            }
                        }
                    }
                    else -> HostBootPanel(status = status, modifier = Modifier.weight(1f).fillMaxWidth())
                }
            }
            // 小窗直接挂在 Scaffold 的内容里, **中间不留任何一层容器**: 拖动范围就是这一层按 inset
            // 收好之后的整块地方, 而它由窗口自己量 (见 FloatingScreenWindow 的 onSizeChanged)。
            // 上一版为了拿到这个范围套了一个 fillMaxSize 的空 Box, 而 Compose 的 Box 默认参与命中
            // 测试 - "空盒子不吃事件"是错的, 它把窗口底下 1600 多像素的触摸全吃了, 用户的原话是
            // "虚拟屏下面一半都用不了"。所以这里宁可让窗口自己量, 也不再放一个会占满屏幕的东西
            if (preview != null && !windowHidden) {
                FloatingScreenWindow(
                    screen = preview,
                    onMinimize = { windowHidden = true },
                    modifier = Modifier.padding(innerPadding),
                )
            }
            // 浮标: 顶栏那个按钮的替身, 白底不透明、能拖到任何地方
            FloatingBall(
                selected = selected,
                onSettings = { navigator.push(Screen.Settings) },
                onTavern = { navigator.push(Screen.TavernHome) },
                onFeedback = { feedbackOpen = true },
                windowHidden = windowHidden,
                onToggleWindow = { windowHidden = !windowHidden },
                modifier = Modifier.padding(innerPadding),
            )
            // 错误只弹一次 (2.8.0 B2-c ⑨): 与浮标同级, 所以**有没有屏在看都会弹** —— 以前那一行
            // 只在 `selected == null` 时出现, 于是"正看着一块坏屏"反倒没有任何提示
            screenError?.let { reason ->
                OverlayDialog(
                    show = true,
                    title = "虚拟屏出错",
                    defaultWindowInsetsPadding = false,
                    onDismissRequest = { screenError = null },
                ) {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Text(text = reason, color = colorScheme.error)
                        TextButton(
                            text = "知道了",
                            onClick = { screenError = null },
                            modifier = Modifier
                                .align(Alignment.End)
                                .padding(top = 12.dp),
                        )
                    }
                }
            }
            if (feedbackOpen) {
                FeedbackDialog(onDismissRequest = { feedbackOpen = false })
            }
            // 「再按一次退出」走这里。挂在主页而不是脚手架上, 是因为提示只有主页会用到:
            // 按返回从设置页回来的时候不该弹它, 弹的是这一页的返回
            SnackbarHost(
                state = ExitHint.host,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 32.dp),
            )
        }
    }
}


/**
 * 顶栏上那个菜单按钮
 *
 * 顶栏版与悬浮版共用它, 免得两处的菜单对不上
 */
@Composable
private fun MenuButton(
    selected: ScreenState?,
    onSettings: () -> Unit,
    onTavern: () -> Unit,
    onFeedback: () -> Unit,
    windowHidden: Boolean,
    onToggleWindow: () -> Unit,
    modifier: Modifier = Modifier,
    backgroundColor: Color = Color.Unspecified,
    onExpandedChange: ((Boolean) -> Unit)? = null,
) {
    OverlayIconCascadingDropdownMenu(
        entries = mainMenu(
            selected = selected,
            onSettings = onSettings,
            onTavern = onTavern,
            onFeedback = onFeedback,
            windowHidden = windowHidden,
            onToggleWindow = onToggleWindow,
        ),
        modifier = modifier,
        backgroundColor = backgroundColor,
        onExpandedChange = onExpandedChange,
    ) {
        Icon(
            imageVector = MiuixIcons.Tune,
            contentDescription = "菜单",
        )
    }
}

/**
 * 虚拟屏的小窗
 *
 * 它浮在会话上面而不是占一条高度: 屏在后台跑着, 人要能一边看着它一边用 dsh 的界面。代价是它盖
 * 住的那一块会话就真看不见了 - WebView 量的是自己的视口, 被盖住的地方缩不回来, 所以它越小,
 * 界面越完整
 *
 * 整条标题栏是拖动把手 (画面本身已经拿去注入触摸了, 见 [VirtualScreenPreview], 在画面上再认拖动
 * 就分不清"移窗口"与"划屏"), 右端那个减号把整扇窗收掉 - 它不自己留一条边, 也不再自己回来, 要
 * 回来走 ⋮ 菜单里的那一项, 这样收起来之后界面上真的一点痕迹都不剩
 *
 * **它自己量自己能拖到哪儿**: 传进来的 modifier 带着 Scaffold 的 inset padding, 于是这一层的尺寸
 * 就是可用范围, 不需要外面再套容器。这一点是踩过才知道的 - 外面套一个 fillMaxSize 的盒子去量,
 * 那个盒子会把窗口底下整片触摸都吃掉
 *
 * @param screen 显示哪块屏, 它同时决定画面的形状
 * @param onMinimize 按下减号时叫一声, 由调用方把整扇窗收掉
 */
@Composable
private fun FloatingScreenWindow(
    screen: ScreenState,
    onMinimize: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val screenWidth = LocalConfiguration.current.screenWidthDp

    // 小窗头一次出现在哪儿: 顶上那一条是系统自己的手势区 (下拉通知栏), 落在里面的触摸根本到不了
    // 这里, 所以起始位置放在它下面, 免得一上来就抓不住。实测这台设备上 y=250 的下拉被通知栏接走,
    // y=400 才落回应用
    //
    // **只是一个起点, 不是下限**: 用户要的是整块屏幕都能放, 所以上面不设禁入区。真放进手势区里
    // 拖不动了也有退路 - 减号收起来再显示, 窗会重新站回这个起点 (它离开组合时那些 remember 就没了)
    val start = with(density) { WINDOW_START_TOP.roundToPx() }.toFloat()
    var position by remember { mutableStateOf(Offset(0f, start)) }
    // 这一层自己有多大, 就是窗口能走多远 - 量的是自己, 所以没有任何多余的东西参与命中测试
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    var dragging by remember { mutableStateOf(false) }

    // 宽度是屏幕宽度的几分之一, 高度跟着屏自己的形状走 - 竖的屏得到一条竖的窗
    val width = with(density) { (screenWidth / WINDOW_SCREEN_FRACTION).dp.roundToPx() }
    val picture = (width / screen.aspect).roundToInt()
    val height = with(density) { WINDOW_BAR_HEIGHT.roundToPx() } + picture

    // 拖出屏幕就回不来了, 所以每次都用当前尺寸夹一遍; 上面不设下限, 整块屏幕都是它的地方
    val limitX = (viewport.width - width).coerceAtLeast(0).toFloat()
    val limitY = (viewport.height - height).coerceAtLeast(0).toFloat()
    // 指针推的是这个目标 (含钳制), 屏幕上跟的是下面那个弹簧的输出
    val target = Offset(position.x.coerceIn(0f, limitX), position.y.coerceIn(0f, limitY))

    // 下面那个拖动回调挂在 pointerInput 上, 而它不会因为位置变化重启, 所以回调里**只能读活的值**:
    // position 走 state 委托, 每次读都是当前值, 而这两个上限是组合期的局部量, 得包一层才是活的。
    // 第一版直接读了组合期算好的位置, 于是每一下拖动都从零重新算 - 窗几乎不动 (在设备上试出来的)
    val limits = rememberUpdatedState(Offset(limitX, limitY))

    // 目标与渲染分开, 与浮标同一套。**拖动中不用弹簧**: 弹簧会落后于手指, 小窗拖起来会像"粘"在
    // 原地、手停下才追上来
    val rendered = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
    var placed by remember { mutableStateOf(false) }
    LaunchedEffect(target, dragging) {
        when {
            !placed -> {
                rendered.snapTo(target)
                placed = true
            }
            dragging -> rendered.snapTo(target)
            else -> rendered.animateTo(target, SETTLE_SPRING)
        }
    }

    // "拿起来"那一下: 小窗只加投影, **不加缩放**。缩放是 RenderNode 变换, 而窗里的画面是
    // SurfaceView - 它的 surface 由 SurfaceFlinger 单独摆一层, 不跟着父节点的变换走, 一缩放就会
    // 出现"标题栏放大了、画面没放大"的错位。投影不影响 surface, 是安全的等效反馈
    val lift by animateDpAsState(
        targetValue = if (dragging) WINDOW_DRAG_ELEVATION else 0.dp,
        animationSpec = PRESS_LIFT_SPRING,
        label = "windowLift",
    )

    Box(modifier = modifier.fillMaxSize().onSizeChanged { viewport = it }) {
        Column(
            modifier = Modifier
                .offset { IntOffset(rendered.value.x.roundToInt(), rendered.value.y.roundToInt()) }
                .width(with(density) { width.toDp() })
                .shadow(elevation = lift, shape = RoundedCornerShape(UiSpacing.Medium))
                .clip(RoundedCornerShape(UiSpacing.Medium))
                .background(colorScheme.surface),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(WINDOW_BAR_HEIGHT)
                    // 整条标题栏就是拖动把手 (减号那块除外, 它自己收事件, 见下)
                    .pointerInput(screen.displayId) {
                        detectDragGestures(
                            onDragStart = { dragging = true },
                            onDragEnd = { dragging = false },
                            onDragCancel = { dragging = false },
                        ) { change, drag ->
                            change.consume()
                            val (limitXNow, limitYNow) = limits.value
                            position = Offset(
                                (position.x + drag.x).coerceIn(0f, limitXNow),
                                (position.y + drag.y).coerceIn(0f, limitYNow),
                            )
                        }
                    },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = screen.label,
                    modifier = Modifier.weight(1f).padding(start = UiSpacing.Small),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                // 触摸区比图标大一圈, 但仍然**远比 Miuix 的 IconButton 小**: 窗只有屏宽的几分之一,
                // 一个 48dp 的按钮会把整条标题栏占满, 拖动就没地方下手了 (第一版栽在这, 拖不动)
                Box(
                    modifier = Modifier
                        .padding(end = UiSpacing.Small)
                        .size(WINDOW_BUTTON_SIZE)
                        .clip(CircleShape)
                        .clickable(onClick = onMinimize),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = MiuixIcons.Remove,
                        contentDescription = stringResource(R.string.screen_window_hide),
                    )
                }
            }
            // heightLimit 说的是"画面最多给到宽度的几倍", 而竖屏的画面要的高度是宽度的
            // screen.height/screen.width 倍 (这台设备上约 2.2 倍)。传 1 就等于按宽度把画面封顶,
            // 于是竖屏只画得出上面那 1/2.2, 底下空着的全是这个盒子的黑底 - 用户报的"下面一半都用
            // 不了"就是它 (上一版这里写的是 1f, 而 1 的含义我一开始就理解反了)。
            // 传这个比例本身, 盒子就正好是画面要的高度, 一点黑边都不剩
            VirtualScreenPreview(
                screen = screen,
                modifier = Modifier.fillMaxWidth().height(with(density) { picture.toDp() }),
                heightLimit = 1f / screen.aspect,
            )
        }
    }
}

/**
 * 浮标: 顶上那个菜单按钮, 做成一枚跟着主题走的球, 能拖到应用里的任何地方
 *
 * 它接替了两处旧东西 - 顶栏 `actions` 里那个按钮, 和看画面时浮在画面右上角的那个会淡出的按钮。
 * **合成一个是因为"要能拖"和"会自己淡出"是矛盾的**: 想拖的时候它正好不在, 那这个球就没法用。
 * 所以它一直在, 也从不透明 - 底下的东西说不准是什么 (顶栏 / dsh 的界面 / 别人家的画面), 透了就
 * 看不清, 而它是要用手指找的东西。底色跟着配色走 (见下), 不写死成白色
 *
 * 位置只在拖过之后才记住: 没拖过就待在右上角, 与它替掉的那个按钮同一个地方
 *
 * @param selected 菜单里那一栏要显示的屏, 与顶栏那个按钮用的是同一份菜单
 * @param onSettings 菜单里的设置页入口, 原样传下去
 * @param windowHidden 小窗现在收着没有, 菜单里那一项照它显示"显示"还是"隐藏"
 * @param onToggleWindow 菜单里那一项按下去时叫一声
 */
@Composable
private fun FloatingBall(
    selected: ScreenState?,
    onSettings: () -> Unit,
    onTavern: () -> Unit,
    onFeedback: () -> Unit,
    windowHidden: Boolean,
    onToggleWindow: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val ball = with(density) { BALL_SIZE.roundToPx() }
    // 没被拖过时站在右上角再让开一个图标位, 免得压住对话右边栏的第一个图标
    val startTop = with(density) { BALL_START_TOP.roundToPx() }.toFloat()
    // null = 还没被拖过, 于是它待在右上角而不是 (0,0)
    var position by remember { mutableStateOf<Offset?>(null) }
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    var dragging by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }

    // 空闲计时: 每次交互 +1, 这段重跑就是重新计时。菜单开着时不计 - 那时它正在被用
    var interactions by remember { mutableStateOf(0) }
    var dimmed by remember { mutableStateOf(false) }
    LaunchedEffect(interactions, menuOpen) {
        dimmed = false
        if (menuOpen) return@LaunchedEffect
        delay(BALL_IDLE_MS)
        dimmed = true
    }

    val limitX = (viewport.width - ball).coerceAtLeast(0).toFloat()
    val limitY = (viewport.height - ball).coerceAtLeast(0).toFloat()
    // 指针推的是这个目标 (含钳制), 屏幕上跟的是下面那个弹簧的输出
    val target = (position ?: Offset(limitX, startTop)).let {
        Offset(it.x.coerceIn(0f, limitX), it.y.coerceIn(0f, limitY))
    }
    // 与窗口那边同一个道理: 拖动回调挂在 pointerInput 上, 不会因为位置变化重启, 所以它只能读活值
    val limits = rememberUpdatedState(Offset(limitX, limitY))

    // 目标与渲染分开, 与窗口同一套。**但拖动中不用弹簧**: 弹簧会落后于手指, 用户报的"没有被拖动,
    // 而是移动停止后才最终落位"就是它。拖动中直接 snapTo, 位置变化照样走 layout 阶段
    val rendered = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
    var placed by remember { mutableStateOf(false) }
    LaunchedEffect(target, dragging) {
        when {
            !placed -> {
                rendered.snapTo(target)
                placed = true
            }
            dragging -> rendered.snapTo(target)
            else -> rendered.animateTo(target, SETTLE_SPRING)
        }
    }

    // 变淡: 只用 alpha, **绝不把它移出视图树**。老代码那个 AnimatedVisibility 淡出会真的把内容拿掉
    // (理由是留着会吃掉点击), 但这里相反 - 25% 的球必须仍然点得到、拖得动, 而 alpha 不影响命中测试
    val ballAlpha by animateFloatAsState(
        targetValue = if (dimmed) BALL_DIM_ALPHA else 1f,
        animationSpec = tween(BALL_FADE_MS),
        label = "ballAlpha",
    )
    // "拿起来"那一下: 球没有 SurfaceView, 缩放是安全的 (小窗就不行, 见那边的注释)
    val scale by animateFloatAsState(
        targetValue = if (dragging) BALL_DRAG_SCALE else 1f,
        animationSpec = PRESS_SCALE_SPRING,
        label = "ballScale",
    )
    val lift by animateDpAsState(
        targetValue = if (dragging) BALL_DRAG_ELEVATION else BALL_IDLE_ELEVATION,
        animationSpec = PRESS_LIFT_SPRING,
        label = "ballLift",
    )

    Box(modifier = modifier.fillMaxSize().onSizeChanged { viewport = it }) {
        Box(
            modifier = Modifier
                .offset { IntOffset(rendered.value.x.roundToInt(), rendered.value.y.roundToInt()) }
                .size(BALL_SIZE)
                // 拖动挂在球上, 点按由里面那个菜单按钮自己收 - 手指一动就超过触摸阈值, 按钮那次点击
                // 会被取消, 于是同一个球既点得开又拖得动。
                // 放在 graphicsLayer **之前**是故意的: 层的缩放会作用到后面的命中测试上, 拖动位移
                // 会跟着被按 1.08 折算, 球就走得比手指慢
                .pointerInput(Unit) {
                    detectDragGestures(
                        onDragStart = {
                            dragging = true
                            interactions++
                        },
                        onDragEnd = { dragging = false },
                        onDragCancel = { dragging = false },
                    ) { change, drag ->
                        change.consume()
                        val (limitXNow, limitYNow) = limits.value
                        // **只能读活值**: `at` 是组合期算出来的, 而 pointerInput 不会因为位置变化
                        // 重启, 拿它当基准的话每一下拖动都从同一个死位置重算, 球就几乎不动。窗口那边
                        // 栽过一次, 这里又栽了一次 (写的时候明明刚修完)。position 走 state 委托, 每次
                        // 读都是当前值; 还没拖过就用右上角那个起点
                        val from = position ?: Offset(limitXNow, startTop)
                        position = Offset(
                            (from.x + drag.x).coerceIn(0f, limitXNow),
                            (from.y + drag.y).coerceIn(0f, limitYNow),
                        )
                    }
                }
                // **这一层必须写在投影/底色之前**: Compose 的绘制修饰符只影响排在它后面的节点,
                // 写在 background 之后就只淡化了里头那个图标, 底色与投影原样留着 (第一版就是这样,
                // 用户看到的正是"只有三横淡了、背景没淡")
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    alpha = ballAlpha
                }
                // 底色跟着主题走, 不写死白色: 浅色主题下纯白会和 dsh 的白底糊在一起, 而深色主题下
                // 它又得是深色的, 所以取的是当前配色里的 surface。投影让它看得出是浮起来的
                .shadow(elevation = lift, shape = CircleShape)
                .clip(CircleShape)
                .background(colorScheme.surface),
            contentAlignment = Alignment.Center,
        ) {
            MenuButton(
                selected = selected,
                onSettings = onSettings,
                onTavern = onTavern,
                onFeedback = onFeedback,
                windowHidden = windowHidden,
                onToggleWindow = onToggleWindow,
                // 球的底由外面这层给, 菜单按钮自己就不用再画一层
                backgroundColor = Color.Transparent,
                // 菜单开着时不计空闲: 那时用户正在用它, 淡下去没有道理
                onExpandedChange = { open ->
                    menuOpen = open
                    interactions++
                },
            )
        }
    }
}

/**
 * 顶栏菜单
 *
 * 屏是单选: 选中哪块看哪块, 选中的那块再点一次就取消选中 (这就是收起画面, 不再单设一个开关),
 * 而所有屏都还在跑 - 取消选中只是不看了
 */
@Composable
private fun mainMenu(
    selected: ScreenState?,
    onSettings: () -> Unit,
    onTavern: () -> Unit,
    onFeedback: () -> Unit,
    windowHidden: Boolean,
    onToggleWindow: () -> Unit,
): List<DropdownEntry> {
    val context = LocalContext.current
    val screens = VirtualScreen.screens
    // 「停止朗读」那一条 2026-10-24 撤掉了 (主人: "设置浮标的停止说话去掉") —— 球与设置页里都停得掉,
    // 菜单里再留一条只是占位置; 那 500 ms 一拍的状态轮询跟着一起去掉
    // 「同步」那一行 (2026-10-14 主人: 加在"进设置之前的那个菜单按钮"里): 它与设置页那一段是**同一件事**
    // —— `session-sync.json` 里的远端地址配没配。插件是**挂载时**读配置的, 所以这一个动作要顺带重启
    // host, 否则这一行等于没点。`SyncSetting.revision` 是它在文件被改过之后重读的记号 (菜单自己改的
    // 那一次也走同一条路 —— setSyncOn 会把它 +1)
    val syncSnapshot = remember(SyncSetting.revision) { SyncSetting.snapshot(context) }
    val syncOnToast = stringResource(R.string.menu_sync_switched_on)
    val syncOffToast = stringResource(R.string.menu_sync_switched_off)
    // 先算好: 下面那个下拉栏是 buildList 里拼的, 而那不是 composable 作用域, stringResource 进不去
    val windowToggle = stringResource(
        if (windowHidden) R.string.screen_window_show else R.string.screen_window_hide,
    )
    // 「Luwi反馈」: 与设置页 ⋮ 里那一条是同一个窗, 只是把入口也摆到球菜单 (2026-10-29 主人)
    val feedbackLabel = stringResource(R.string.settings_menu_feedback)
    return listOf(
        DropdownEntry(
            items = listOfNotNull(
                DropdownItem(
                    text = "虚拟屏",
                    summary = selected?.label,
                    children = buildList {
                        if (screens.isEmpty()) {
                            add(DropdownItem(text = "还没有已创建的虚拟屏", enabled = false))
                        }
                        screens.forEach { screen ->
                            add(
                                DropdownItem(
                                    text = screen.label,
                                    summary = screen.shape,
                                    selected = screen.displayId == selected?.displayId,
                                    onClick = { VirtualScreen.toggle(screen) },
                                ),
                            )
                        }
                        // 手动的刹车: 停的是模型的下一步动作, 不是这块屏也不是预览, 用户自己的手指
                        // 照样能碰画面
                        add(
                            DropdownItem(
                                text = if (selected?.acceptsControl == false) {
                                    "继续接受控制"
                                } else {
                                    "暂停接受控制"
                                },
                                summary = selected?.label,
                                enabled = selected != null,
                                onClick = {
                                    selected?.let { VirtualScreen.setAcceptsControl(it, !it.acceptsControl) }
                                },
                            ),
                        )
                        // 建屏不在这里: 一块屏叫什么、多大, 是工具在造它的时候决定的, 界面只负责看和关
                        // byUser = true: 之后模型再动这个 id, 桥要能说出"这是用户关的"
                        add(
                            DropdownItem(
                                text = "释放虚拟屏",
                                summary = selected?.label,
                                enabled = selected != null,
                                onClick = { selected?.let { VirtualScreen.release(it, byUser = true) } },
                            ),
                        )
                        // 减号收起来的窗从这里叫回来: 它收得干净, 界面上不留把手, 所以这一项是唯一
                        // 的路。放在"虚拟屏"这一栏里而不是一级菜单, 是因为它管的正是这一块屏
                        add(
                            DropdownItem(
                                text = windowToggle,
                                summary = selected?.label,
                                enabled = selected != null,
                                onClick = onToggleWindow,
                            ),
                        )
                    },
                ),
                // 这个开关放在一级菜单而不是设置页: 它是"现在这块画面能不能摸", 边看边切才对
                DropdownItem(
                    text = "虚拟屏触摸控制",
                    summary = "禁用以避免误操作",
                    selected = PreviewControl.allowed,
                    onClick = { PreviewControl.set(context, !PreviewControl.allowed) },
                ),
                // 「同步」: 与设置页那一段同一个开关 (默认关)。关→开需要先有仓库地址, 没有就把人送到
                // 设置页那一段去填; 改完必须重启 host 才生效, 所以这一下顺手重启 (主人点的那一下)
                DropdownItem(
                    text = stringResource(R.string.menu_sync),
                    summary = when {
                        syncSnapshot.syncOn -> stringResource(R.string.menu_sync_on)
                        syncSnapshot.resumableRemote.isNotBlank() -> stringResource(R.string.menu_sync_off)
                        else -> stringResource(R.string.menu_sync_need_remote)
                    },
                    selected = syncSnapshot.syncOn,
                    onClick = {
                        val wanted = !syncSnapshot.syncOn
                        val problem = SyncSetting.setSyncOn(context, wanted)
                        if (problem == null) {
                            Toast.makeText(context, if (wanted) syncOnToast else syncOffToast, Toast.LENGTH_LONG).show()
                            DshHost.restart(context)
                        } else {
                            // 没有地址可填: 把原因说清并把人送到设置页那一段 (那一行就在那儿)
                            Toast.makeText(context, problem, Toast.LENGTH_LONG).show()
                            onSettings()
                        }
                    },
                ),
                // 酒馆 (2026-10-24 主人: "在会话界面右上角加入「酒馆」选项, 点击进入"): 从这里进的是
                // **首页** (进入酒馆 / 选择存档 / 选择主题 / 打开配置 都在那儿); 设置页那一段的
                // "打开酒馆"仍然直奔聊天页 —— 两条路进的是同一套数据, 只是落点不同。
                // 公开构建 (LuwiTavern.enabled = false) 就不画这一行
                if (LuwiTavern.enabled) {
                    DropdownItem(
                        text = "酒馆",
                        onClick = onTavern,
                    )
                } else {
                    null
                },
                // 门户那一层的进出口 (2026-11-07 主人: "回到对话层没有按钮补一下, 和返回 dsh 这些都
                // 加到 luwi 菜单里, 不放界面上"): 界面上不放按钮, 两个动作都在这里 —— 收起门户看 dsh,
                // 或者从 dsh 回到门户。方向由页面报上来的 `PortalState.open` 决定
                DropdownItem(
                    text = if (PortalState.open) "回到 dsh" else "回到对话层",
                    onClick = {
                        val run = PortalState.run
                        val script = if (PortalState.open) {
                            "window.__LUWI_PORTAL__ && window.__LUWI_PORTAL__.hide()"
                        } else {
                            "window.__LUWI_PORTAL__ && window.__LUWI_PORTAL__.show()"
                        }
                        run?.invoke(script)
                    },
                ),
                // 反馈: 与设置页 ⋮ 第一条同一个对话框 (2026-10-29)
                DropdownItem(
                    text = feedbackLabel,
                    onClick = onFeedback,
                ),
                DropdownItem(
                    text = "设置",
                    onClick = onSettings,
                ),
            ),
        ),
    )
}

/**
 * The dsh GUI itself, which is a normal browser page served from loopback
 *
 * The host authenticates a browser by answering the token URL with a redirect that sets an
 * HttpOnly cookie, so the WebView has to keep that cookie or every later request comes back
 * unauthorized, which is an empty body and therefore a blank page
 *
 * What a browser is expected to do beyond rendering - pick a file, save a download - needs an
 * activity behind it, so those two requests are routed out of the page here
 *
 * **切后台回来不重载** (2026-10-26 主人: "切后台回来就重载"): 两件事都在这一块里做 ——
 * renderer 的优先级钉住 (不因为不可见就被降级回收), 以及 renderer 真死时自己换一块新的
 * (那只的缺省行为是把整个应用进程一起带走, 而进程里还有 host 与虚拟屏)
 *
 * @param url the token-carrying URL the host printed once its tree settled.
 * @param modifier layout modifier from the caller.
 * @param alpha 页面还没画出来时给 0: 开屏那块画在它底下, 靠这一层透明才看得见 (见调用处那段注释)
 * @param onReady 页面真的画出东西了 (`root` 有子节点) 时叫一次
 * @param onLost renderer 死了、这一页要重建时叫一次 (调用方据此把开屏盖回去)
 */
@Composable
private fun HostWebView(
    url: String,
    modifier: Modifier = Modifier,
    alpha: Float = 1f,
    onReady: () -> Unit = {},
    onLost: () -> Unit = {},
) {
    val context = LocalContext.current
    // 「回应用」那一跳: **请求一变就跑一次** (见下面那个 LaunchedEffect), 而不押在 `AndroidView` 的
    // update 上 —— update 什么时候被叫到是 Compose 的事, 而这一跳是主人点名要的反馈 (2026-10-07:
    // "在 dsh 应用里双击回复框没有任何反馈")
    val ballRequest = BallReturn.request
    // WebView 实例与"这个文档加载完过几次": 切换那一步要拿它跑 JS, 还要等重载真的落地
    var page by remember { mutableStateOf<WebView?>(null) }
    // 2026-10-28: 键盘起来时这块 WebView 让出贴底键盘那一段 (悬浮键盘不让), 否则会话输入框被压在键盘后面
    // 2026-11-09: **门户盖着时不再让 WebView 变矮** —— 让位改由页面自己抬 (`--lwp-ime`), 见下面那段
    val imeLift = rememberImeLift()
    val portalOpen = PortalState.open
    // 推给页面的数**必须是 dp 而不是设备像素**: WebView 里 1 CSS px 就是 1 dp (393 宽的屏报 393 CSS px,
    // 屏本身 1080 设备像素), 拿 `roundToPx()` 那笔 (922) 当 CSS px 写下去就是整屏高 —— 2026-11-09 真机
    // 踩到, 输入卡被顶到顶栏下面
    val imeLiftDp = imeLift.value.roundToInt()
    var finishes by remember { mutableIntStateOf(0) }
    // renderer 是 Chrome 那边独立的一个进程: 它一死这块 WebView 就再也不能用, 只能整块重建 ——
    // generation 一变就换一块新的 (key 在 AndroidView 外面), rebuilds 是"同一个窗最多自动重建几次";
    // halted 是额度用完之后那一档: 那时 composition 里干脆不挂 WebView, 免得还有代码去碰那块
    // 已经 destroy 掉的旧实例
    var generation by remember { mutableIntStateOf(0) }
    var rebuilds by remember { mutableIntStateOf(0) }
    var halted by remember { mutableStateOf(false) }
    // A file input can only be answered by an activity, so the page's request parks here until
    // the picker it launched comes back
    var pending by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    // 老 WebView 那一摊 (2.7.10, 见 [WebCompat]): 那段 polyfill 是"文档开始"注入的, 垫的是
    // `Promise.withResolvers` 这类 Chrome 119 才有的 API; 页面还会把"还缺什么"报回来
    val compat = remember(context) { WebCompat.script(context) }
    val webInfo = remember(context) { WebCompat.info(context) }
    var compatMissing by remember { mutableStateOf<List<String>>(emptyList()) }
    // `root` 有子节点就算起来了 —— 那是"界面真的画出来"的判据 (与 SHELL_PROBE 那个日志同一件事)
    var readyAt by remember { mutableIntStateOf(0) }
    var stuck by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val answer = pending ?: return@rememberLauncherForActivityResult
        pending = null
        // The platform helper reads either form of result the picker can return, a single data
        // URI or the clip data of a multiple selection
        answer.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }
    // **已经交给 WebView 的那一条地址** (不是 `view.url`): host 打印的 token URL 会 302 到根路径,
    // 所以 `view.url` 永远不等于它 —— 拿这两者比, 每一次重组 (开屏淡出那一串 alpha 就是几十次)
    // 都会再 loadUrl 一次, 表现出来是"开屏那几帧里页面重载两三次" (2026-10-26 真机日志: 4 秒 3 条
    // finished)。只有"要打开的地址"真的换了 (重启 host) 才该重载
    val launched = remember { arrayOfNulls<String>(1) }
    // renderer 死了就整块换新的 (见下面 onRenderProcessGone): key 一变 AndroidView 就重建;
    // halted 那一档整块不挂, 所以不会有人再去用已经 destroy 的旧实例
    if (!halted) key(generation) {
        // 键盘那一格 (2026-11-09 主人: "呼出键盘时不应整个界面上移, 只要输入框和聊天记录向上移"):
        // **门户盖着时这一块尺寸一点都不动** —— 变矮的是页面里那层 flex (对话区 + 输入卡), 于是
        // 背景图 / 头栏 / 底下那屏 dsh 都不重排, 起落也就不卡了。门户收起时仍是旧做法: 缩 WebView
        // (dsh 自己的输入框靠这个贴到键盘上沿, 它不认识 `--lwp-ime`)
        AndroidView(
            modifier = if (portalOpen) modifier else modifier.padding(bottom = imeLift),
            factory = { viewContext ->
                CookieManager.getInstance().setAcceptCookie(true)
                WebView(viewContext).apply {
                    settings.javaScriptEnabled = true
                    // dsh keeps theme and font size in localStorage, which is also how a phone and
                    // a desktop browser reach the same server with different appearance settings
                    settings.domStorageEnabled = true
                    settings.allowFileAccess = false
                    // dsh 的朗读在页面里播放音频, 而 WebView 默认要有用户手势才放音: 消息到了
                    // 自动朗读会在没有手势的时候被拦掉, 这一条就是给它的 (系统引擎那一路走
                    // 通道的 speak, 不经页面, 不受这条影响)
                    settings.mediaPlaybackRequiresUserGesture = false
                    // Compose sizes an AndroidView through the modifier and leaves layoutParams at
                    // WRAP_CONTENT, and a WebView in that state resolves every viewport unit to 0,
                    // which collapses the dialogs, menus and directory picker dsh measures in vh,
                    // the visible size in Compose has nothing to do with it, so this has to be set
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    // **键盘那一段不让 WebView 自己再让一次** (2026-11-09): 上面那个 padding 与页面的
                    // `--lwp-ime` 已经把它让开了; Chromium 若还按 IME inset 收可视视口, 会顺手把整页
                    // 平移上去 (定位在 `position:fixed` 的那一层也跟着动) —— 那正是"整个界面上移、顶部
                    // 被裁"的另一半原因。所以 IME 那一段在这里吃掉, 其余 inset 原样交给它
                    setOnApplyWindowInsetsListener { _, insets ->
                        WindowInsets.Builder(insets)
                            .setInsets(WindowInsets.Type.ime(), Insets.NONE)
                            .setVisible(WindowInsets.Type.ime(), false)
                            .build()
                    }
                    // **切后台回来整页重载的根因就在这一行**: renderer 是独立进程, 视图不可见时
                    // 缺省允许被降级甚至回收, 回到前台只能从头加载。这里把它钉在 BOUND (可见那一档,
                    // 不是 IMPORTANT 那档"关键任务"), 并且**不可见时也不豁免** (第二个参数 true 才是
                    // "不可见就降成 WAIVED"), 代价是这个 renderer 在后台也占着内存 —— 那是
                    // "回来不重载"要付的那一笔
                    runCatching {
                        setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_BOUND, false)
                    }.onFailure { Log.w(WEB_TAG, "the renderer priority could not be pinned", it) }
                    CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                    // 输入框旁边那个麦克风指示器要问的两件事都在 app 这一侧 (服务在不在听、点一下停)
                    addJavascriptInterface(WakeBridge(viewContext.applicationContext), WAKE_BRIDGE)
                    // 门户那一层 (2026-11-07): 判断层与工作结构在 `$DSH_HOME/lw` 里, 球那场的账在
                    // `$DSH_HOME/voice/session.json` 里 —— 页面读不到 app 沙盒, 所以从这座桥走
                    addJavascriptInterface(PortalBridge(viewContext.applicationContext), PORTAL_BRIDGE)
                    // 老 WebView 那一档: 先把桥挂上 (页面把"还缺什么"报回来), 再让 polyfill 在文档
                    // **开始**时跑 —— 顺序不能反, 反了那段报告就没人接
                    addJavascriptInterface(
                        WebCompat.Bridge { missing, fixed ->
                            // 每次开屏一行: 这一行就是"这台机器上 polyfill 到底垫了什么"的现场记录
                            Log.i(WEB_TAG, "compat: filled ${fixed.joinToString().ifEmpty { "nothing" }}, missing ${missing.joinToString().ifEmpty { "nothing" }}")
                            if (missing.isNotEmpty()) {
                                Log.w(WEB_TAG, "the page is missing ${missing.joinToString()} after the polyfill")
                                compatMissing = missing
                            }
                        },
                        WebCompat.BRIDGE,
                    )
                    Log.i(WEB_TAG, "webview ${webInfo.label} (major ${webInfo.major})")
                    if (webInfo.isOld) {
                        // 这一行是老机器上唯一一句"为什么以前会卡在连接中": 版本号在这儿, polyfill 装没装上看下一行
                        Log.w(WEB_TAG, "this WebView is older than Chrome ${WebCompat.MIN_MAJOR}: ${webInfo.label}")
                    }
                    WebCompat.install(this, compat)
                    // The page is the whole product surface, so its own failures need somewhere to
                    // show up: status codes, load errors, and browser console lines all go to logcat
                    webViewClient = object : WebViewClient() {
                        /**
                         * renderer 死了 (OOM / 被系统回收): **缺省行为是把整个应用进程一起带走**
                         *
                         * 这个进程里还有 host 与虚拟屏, 一起死掉等于"回来要从解压与起 host 重来一遍"。
                         * 所以这里接住: 拆掉这一块已经不能用的 WebView (之后一个方法都不许再调它),
                         * 换一块新的重新加载同一页; 返回 true = "我自己处理了", 别动进程
                         *
                         * 连着死超过 [MAX_PAGE_REBUILDS] 次就不再自动重建 (那会变成重建循环),
                         * 直接把"还缺什么"那个真 Dialog 摆出来
                         */
                        override fun onRenderProcessGone(
                            view: WebView,
                            detail: RenderProcessGoneDetail,
                        ): Boolean {
                            Log.w(WEB_TAG, "renderer gone (crashed=${detail.didCrash()}), rebuilding the page")
                            (view.parent as? ViewGroup)?.removeView(view)
                            runCatching { view.destroy() }
                            if (page === view) page = null
                            rebuilds += 1
                            if (rebuilds > MAX_PAGE_REBUILDS) {
                                Log.w(WEB_TAG, "the renderer died $rebuilds times; asking the person instead")
                                // 不重建了: halted 让 composition 把 WebView 摘掉, 开屏盖回去,
                                // 决定权交给那个更新弹窗
                                halted = true
                                stuck = true
                                onLost()
                                return true
                            }
                            stuck = false
                            compatMissing = emptyList()
                            readyAt = 0
                            generation += 1
                            onLost()
                            return true
                        }

                        // Only the host's own pages belong in this view: everything here is one document,
                        // so a link that navigates this view away **replaces the whole GUI** and there is
                        // no way back to the session (2026-10-18: 轨迹 那个详情预览里的链接就是一例, 点完
                        // 屏幕上只剩那个网站). 别处的链接交给系统浏览器 (主人手机上一直这么用), 非页面
                        // 的 scheme (mail / app) 一律拒掉并记一行, 免得平台弹一个"打开方式"盖住 GUI
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val target = request.url
                            // 预览里那颗「用系统文件管理器打开」: 文档是老格式 (.doc/.ppt), 网页读不了,
                            // 把**已经授权过的绝对路径**交回来, 由这里换成 content:// 再交给系统
                            // (页面自己拿不到 FileProvider, 也不该直接拿到一条 startActivity 的路)
                            if (target.scheme == OPEN_SCHEME) {
                                openWithSystem(view.context, target.getQueryParameter(OPEN_PATH_PARAM))
                                return true
                            }
                            if (target.scheme != "http" && target.scheme != "https") {
                                Log.w(WEB_TAG, "blocked navigation to $target")
                                return true
                            }
                            if (sameOrigin(target, Uri.parse(url))) return false
                            val problem = openPage(view.context, target.toString())
                            if (problem == null) Log.i(WEB_TAG, "handed $target to the system browser")
                            else Log.w(WEB_TAG, problem)
                            return true
                        }

                        override fun onPageFinished(view: WebView, finishedUrl: String) {
                            Log.i(WEB_TAG, "finished $finishedUrl")
                            // A page that loads without any HTTP or console error can still be blank,
                            // so the shell state itself is asked for and logged
                            view.evaluateJavascript(SHELL_PROBE) { result ->
                                Log.i(WEB_TAG, "shell $result")
                            }
                            // `root` 有没有子节点 = 界面画出来了没有 (上面那句是给人看的读数, 这一句是判据)
                            view.evaluateJavascript(READY_PROBE) { result ->
                                if (result.trim('"').toIntOrNull()?.let { it > 0 } == true) {
                                    readyAt += 1
                                    // 这一页真的画出来了: 上一次那几笔 renderer 事故就不该再
                                    // 占着"最多重建几次"的额度
                                    rebuilds = 0
                                    onReady()
                                }
                            }
                            // 门户那一层的 JS 入口 (2026-11-07): 菜单里那一条点了就走这里 ——
                            // 每次文档加载都重新挂一遍, 换一次文档旧的 WebView 就不能用了
                            PortalState.run = { script -> view.evaluateJavascript(script, null) }
                            // 每次文档加载都把那个指示器装回去: 它是我们画在页面上的, 换一次文档就没了
                            view.evaluateJavascript(WAKE_BADGE_JS, null)
                            // 「回应用」那一跳在等"页面什么时候回来" (重载 / 冷启动那两档都是它)
                            finishes += 1
                        }

                        override fun onReceivedHttpError(
                            view: WebView,
                            request: WebResourceRequest,
                            errorResponse: WebResourceResponse,
                        ) {
                            Log.w(WEB_TAG, "http ${errorResponse.statusCode} for ${request.url}")
                        }

                        override fun onReceivedError(
                            view: WebView,
                            request: WebResourceRequest,
                            error: WebResourceError,
                        ) {
                            Log.w(WEB_TAG, "error ${error.errorCode} ${error.description} for ${request.url}")
                        }
                    }
                    webChromeClient = object : WebChromeClient() {
                        // dsh 的语音输入是页面自己录音 (getUserMedia + MediaRecorder), 而 WebView 不覆写
                        // 这一条就等于不给页面麦克风: 请求到这里没人应, Chromium 按拒绝处理。只放音频,
                        // 摄像头与 MIDI 仍然拒掉; 系统侧的 RECORD_AUDIO 由设置页那一项运行时权限管。
                        // http://127.0.0.1 属安全上下文 (localhost 例外), 所以按 host 判不会把自己拦掉
                        override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                            val audio = request.resources.filter {
                                it == android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE
                            }
                            if (request.origin.host != "127.0.0.1" || audio.isEmpty()) {
                                Log.w(WEB_TAG, "denied ${request.resources.joinToString()} for ${request.origin}")
                                request.deny()
                                return
                            }
                            Log.i(WEB_TAG, "granting ${audio.joinToString()} to ${request.origin}")
                            request.grant(audio.toTypedArray())
                        }
                        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                            Log.i(WEB_TAG, "console ${message.messageLevel()} ${message.message()}")
                            return true
                        }

                        // A popup cannot become a second view here, and leaving the request to
                        // Chromium is what can put a platform chooser over the GUI, so the attempt
                        // is refused and logged rather than answered
                        override fun onCreateWindow(
                            view: WebView,
                            isDialog: Boolean,
                            isUserGesture: Boolean,
                            resultMsg: Message?,
                        ): Boolean {
                            Log.w(WEB_TAG, "blocked popup dialog=$isDialog gesture=$isUserGesture")
                            return false
                        }

                        // dsh attaches files through a plain file input, and the chooser it needs is
                        // an activity the page cannot open itself
                        override fun onShowFileChooser(
                            view: WebView,
                            callback: ValueCallback<Array<Uri>>,
                            params: FileChooserParams,
                        ): Boolean {
                            Log.i(WEB_TAG, "file chooser ${params.acceptTypes.joinToString()}")
                            // A second request supersedes the first, and every callback has to be
                            // answered exactly once
                            pending?.onReceiveValue(null)
                            pending = callback
                            return try {
                                picker.launch(params.createIntent())
                                true
                            } catch (error: ActivityNotFoundException) {
                                Log.w(WEB_TAG, "no picker for ${params.acceptTypes.joinToString()}: ${error.message}")
                                pending = null
                                callback.onReceiveValue(null)
                                true
                            }
                        }
                    }
                    setDownloadListener { downloadUrl, _, contentDisposition, mimeType, _ ->
                        startDownload(context, downloadUrl, contentDisposition, mimeType)
                    }
                    loadUrl(url)
                    launched[0] = url
                }
            },
            update = { view ->
                // 只有"要打开的地址"变了才重载 (比的是上一次交出去的, 不是 302 之后的 view.url)
                if (launched[0] != url) {
                    launched[0] = url
                    view.loadUrl(url)
                }
                // 开屏淡出那一档: alpha 由外面推, 页面自己是不知道的
                if (view.alpha != alpha) view.alpha = alpha
                page = view
            },
        )
    }

    // 键盘那一格 (2026-11-09): 门户盖着时只把这个数推给页面 —— 页面自己写 `--lwp-ime`, 抬的是对话区
    // 与输入卡, **这一块 WebView 不动**。变了才推 (一次起落十来帧, 每帧一句 evaluateJavascript 就够;
    // 页面那头同值直接返回)。`PortalState.imePx` 是给"页面刷新 / 收起再张"那一档留的: 那时页面挂载
    // 会来问一次 (`LuwiPortal.portalIme()`), 正好补上错过的那一下
    LaunchedEffect(portalOpen, imeLiftDp, page) {
        // 门户收起时清 0: dsh 那一屏走的是缩 WebView 那条路, 与这个数无关
        PortalState.imePx = if (portalOpen) imeLiftDp else 0
        if (!portalOpen) return@LaunchedEffect
        // 一行读数: "整页被顶上去 / 卡一下" 时先看这一行 (值与页面拿到的那个数逐字相同, 单位 dp)
        Log.i(WEB_TAG, "ime lift ${imeLiftDp}dp portal=$portalOpen")
        page?.evaluateJavascript(
            "window.__LUWI_PORTAL__ && window.__LUWI_PORTAL__.setKeyboard($imeLiftDp)",
            null,
        )
    }

    // 12 秒还没画出界面: 那就不是"慢", 是老 WebView 在解析期就死了 (或者别的硬故障) —— 弹窗说清,
    // 别让人对着"连接中"干等
    //
    // 计时从**每一次文档加载完成**起算 (`finishes` 变一次就重排一次); 「重试」是换一块新的从头加载,
    // 那时 `generation` 也变一次。判据是"这一窗里 readyAt 涨没涨" —— **平时不能在这里把它清成 0**:
    // 探针那个回调与这一次重组谁先到说不准, 清了就会把"其实画出来了"判成卡住。**只有 generation 变
    // (renderer 死了换了一块新的) 才清**: 那一档是一次全新的加载, 计时窗也该重新开始, 所以 generation
    // 也进这个 key
    LaunchedEffect(url) {
        // 换了一个 host 地址 (重启 host 那一档): 上一轮的额度与停摆都不作数了
        halted = false
        rebuilds = 0
    }
    LaunchedEffect(url, finishes, generation) {
        stuck = false
        val seen = readyAt
        delay(STUCK_SECONDS * 1000L)
        if (readyAt == seen) {
            stuck = true
            Log.w(WEB_TAG, "the page never rendered within ${STUCK_SECONDS}s on ${webInfo.label}")
        }
    }
    // 「WebView 版本太旧 / 卡住了」那个弹窗 **2026-11-07 撤掉了** (主人: "这个也去掉"): 它原来
    // 兜的是"polyfill 没垫全"与"12 秒没画出 root"两档, 而这两档在真机上一直是"看见了也做不了什么"
    // —— 那四条更新指引对普通人来说只是在开屏上多挡一层。**检测本身留着**: 上面那句
    // `Log.w(page never rendered)` 与桥报上来的 missing 仍然进日志, 出事时有读数可查

    /**
     * 等下一次 `onPageFinished` (超时回 false): "重载真的落地了没有"只有它答得上来
     *
     * [finishes] 是那个计数器, 读它是 Compose 的状态读 —— 所以在 `snapshotFlow` 里能等到它变
     */
    suspend fun awaitFinish(after: Int): Boolean = withTimeoutOrNull(RETURN_WAIT_MS) {
        snapshotFlow { finishes }.first { it > after }
    } != null

    /** 跑一段 JS 并把它的字符串结果拿回来 (超时 / 页面被换掉就回 null) */
    suspend fun ask(view: WebView, script: String): String? = withTimeoutOrNull(RETURN_ASK_MS) {
        suspendCancellableCoroutine { continuation ->
            view.evaluateJavascript(script) { answer ->
                // 超时 / 页面被换掉之后回调还会来一次, 已取消的续体不再喂值
                if (continuation.isActive) continuation.resume(answer.orEmpty())
            }
        }
    }

    // 返回键先问页面一句 (见 [PageBack]): 网页里那一层 (右栏的浏览器格, 手机上它是全屏的) 收得掉就
    // 收掉, 收不掉把这一下还回去。超时按 [PAGE_BACK_MS] 而不是 `ask` 那个 5 s —— 返回键不能挂着等
    val scope = rememberCoroutineScope()
    DisposableEffect(page) {
        val view = page
        PageBack.handle = view?.let { target ->
            { nothing ->
                scope.launch {
                    val answer = withTimeoutOrNull(PAGE_BACK_MS) { ask(target, PAGE_BACK_JS) }
                    val closed = answer?.contains("closed") == true
                    Log.i(WEB_TAG, if (closed) "back: the page closed its own layer" else "back: the page had nothing to close")
                    if (!closed) nothing()
                }
            }
        }
        onDispose { PageBack.handle = null }
    }

    // 「回应用」那一跳 (**在 dsh 里也一定有反馈**, 主人 2026-10-07): 请求一来就切到那一场 —— 需要就
    // 改键 + 重载, 然后**读回那个键验证**; 一次不成再试一次, 两次都不成才把请求放掉。无论哪一种结果
    // 都留一行日志与一笔状态 (`lw_overlay op=state` 的 `said` 读它)
    LaunchedEffect(ballRequest?.seq, page) {
        val request = ballRequest ?: return@LaunchedEffect
        val view = page ?: return@LaunchedEffect
        // 空 = [BallReturn.NEW_SESSION]: 这一跳不是"切到某一场", 而是"回到新会话界面" —— 会话界面自己
        // 没有"新建一场"的公开入口, 所以做法是把"看的是哪一场"那一笔擦掉再重载, dsh 那侧会自己开一场
        // 新的 (与冷启动时键还空着那一条是同一条路, 见 `ui-workspace` 的 `restoreSelection`)
        val fresh = request.session.isEmpty()
        val label = if (fresh) "a new conversation" else request.session
        // 页面还没落在 http 上时 localStorage 还不可用 (about:blank 那一档): 等它的 onPageFinished
        if (view.url?.startsWith("http") != true) {
            noteReturn("holding the return to $label until the GUI is up")
            if (!awaitFinish(finishes)) {
                // 等不到就把这一次请求收干净再说一句: 留在半路上 ("状态里还挂着请求"而界面上没人会
                // 再动它) 比明说一次没成更糟
                noteReturn("return to $label: failed: the GUI never came up")
                BallReturn.done(request.seq)
                return@LaunchedEffect
            }
        }
        var outcome = "failed: the page never answered"
        for (attempt in 1..RETURN_TRIES) {
            val before = finishes
            val answer = ask(view, returnJs(request))?.trim()?.removeSurrounding("\"")
            if (answer == "already") {
                outcome = "already on it"
                break
            }
            if (answer != null && answer.startsWith("failed")) {
                outcome = answer
                continue
            }
            // `reload` (或页面没回话): 等这一次重载落地之后再读回那个键 —— "重载了但没落在那一场"
            // 与"真的切过去了"要分得开
            if (!awaitFinish(before)) {
                outcome = "failed: the page did not come back"
                continue
            }
            // **新会话那一档没有 id 可对**: 做完 (clear + reload) 就算成 —— 读回那个键只会读到
            // dsh 自己新建那一场的新 id, 拿它跟要的那个空值比永远不等
            if (fresh) {
                outcome = "verified on try $attempt (a new conversation)"
                break
            }
            val now = ask(view, CURRENT_SESSION_JS)?.trim()?.removeSurrounding("\"")
            if (now == request.session) {
                outcome = "verified on try $attempt"
                break
            }
            outcome = "failed: the GUI came back on ${now?.takeIf { it.isNotEmpty() } ?: "nothing"}"
        }
        noteReturn("return to $label: $outcome")
        BallReturn.done(request.seq)
    }
}

/**
 * 「回应用」那一跳走到哪一步: 一行日志 + 一笔状态
 *
 * 两个去处都要有: 主人 2026-10-07 报的那条是"在 dsh 应用里双击回复框没有任何反馈", 而排查时能对账的
 * 就是 `lw_overlay op=state` 的 `said`(它读 [OverlayState.lastHint]) 与 `adb logcat -s DshWebView`
 */
private fun noteReturn(text: String) {
    Log.i(WEB_TAG, text)
    OverlayState.lastHint = text
}

/**
 * 那一段 JS: 判一下"已经是这一场了吗", 不是就改键 + 重载
 *
 * **为什么只有这一条路**: "在看哪一场"是 dsh 客户端在浏览器里的路由状态
 * (`localStorage['dsh.sessions.current']`, 值形如 `{"sessionId":"session-…"}`), 它只在页面启动那一步
 * 读一次 (见 `ui-workspace` 的 `restoreSelection`) —— 客户端没有公开的路由可用, 所以唯一拿得到的把手
 * 就是这个键, 改完必须重载一次
 *
 * `location.reload()` 是**故意的**: 那个键只在页面启动那一步读, 改完不重载就等于没改。同步执行
 * (改键与重载在同一个 JS 块里) 是为了不给客户端一个"看了一半的状态又被重载"的窗口
 */
private fun RETURN_TO_BALL_JS(session: String): String =
    "(function(){try{var k='dsh.sessions.current';var want={sessionId:${JSONObject.quote(session)}};" +
        "var cur=null;try{cur=JSON.parse(localStorage.getItem(k)||'null')}catch(e){cur=null}" +
        "if(cur&&cur.sessionId===want.sessionId){return 'already'}" +
        "localStorage.setItem(k,JSON.stringify(want));location.reload();return 'reload'}catch(e){return 'failed:'+e}})()"

/**
 * 这一跳该跑哪一段 JS: 空会话 = **去新会话界面**
 *
 * 是新是旧只看有没有 id, 判据与 [BallReturn.NEW_SESSION] 是同一个: 带 id 就切到那一场, 不带就擦掉
 * "看的是哪一场"那一笔再重载。分成两个函数而不是一个带 `if` 的, 是为了让"新会话"那一段 JS 短到
 * 一眼能读完 (它只做一件事: 删键 + 重载)
 */
private fun returnJs(request: BallReturn.Request): String =
    if (request.session.isEmpty()) BALL_NEW_SESSION_JS else RETURN_TO_BALL_JS(request.session)

/**
 * 那一段 JS: **回到新会话界面**
 *
 * 会话界面的"新建一场"没有公开入口, 而它启动那一步会把 `dsh.sessions.current` 当"上次看的那一场"
 * ([`ui-workspace`] 的 `restoreSelection`) —— 那个键指向的会话还在、而且是个空会话时它会**复用**它,
 * 所以"最坏"也只是复用一场已经空着的会话 —— 那与新建一场对主人是同一件事 (一块干净的新对话), 而
 * dsh 那侧**没有把会话列表写进 localStorage** (那份清单走 rpc), 页面里判不出"现在这本账是不是空
 * 的"。所以这里只有一条动作: 删键 + 重载。验证那一半在 [HostScreen] 里也是"做完就算成" —— 新建
 * 之后的 id 是本机生成的, 拿它跟要的那个空值比永远不等
 */
private const val BALL_NEW_SESSION_JS =
    "(function(){try{localStorage.removeItem('dsh.sessions.current');location.reload();" +
        "return 'reload'}catch(e){return 'failed:'+e}})()"

/**
 * 读回"现在这个键里写着哪一场": 切换那一步的判据 (空串 = 读不出来)
 *
 * 与 [RETURN_TO_BALL_JS] 配成一对: 一个负责改, 一个负责验证 —— 少了后面那条, "重载了但没落在那一场"
 * 会被当成成功
 */
private const val CURRENT_SESSION_JS =
    "(function(){try{var v=JSON.parse(localStorage.getItem('dsh.sessions.current')||'null');" +
        "return v&&v.sessionId?v.sessionId:''}catch(e){return ''}})()"

/**
 * Hand an http(s) download to the system downloader
 *
 * The host authorises a browser with a cookie that the downloader's own process cannot see, so
 * the header travels with the request
 *
 * A `blob:` download never reaches this listener, because the bytes only exist inside the page;
 * those need the page itself to hand them over and are not supported yet
 * @param context context whose download service is used.
 * @param url the URL the page asked to save.
 * @param contentDisposition the page's disposition header, which often carries the file name.
 * @param mimeType the page's content type, absent when the page did not name one.
 */
private fun startDownload(context: Context, url: String, contentDisposition: String?, mimeType: String?) {
    if (!url.startsWith("http")) {
        Log.w(WEB_TAG, "unsupported download $url")
        return
    }
    val request = DownloadManager.Request(Uri.parse(url))
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(
            Environment.DIRECTORY_DOWNLOADS,
            URLUtil.guessFileName(url, contentDisposition, mimeType),
        )
    if (!mimeType.isNullOrEmpty()) request.setMimeType(mimeType)
    CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
    context.getSystemService(DownloadManager::class.java).enqueue(request)
    Log.i(WEB_TAG, "download enqueued for $url")
}

/**
 * 小窗的宽度是屏幕宽度的几分之一
 *
 * 分母越大窗越小, 而窗越小它盖住的会话越少 - 这是这个窗唯一的取舍, 所以它在这里是一个数。
 * 一开始给的是 6 (手机上 60dp), 实测下来画面小得看不清, 现在按用户要求翻倍成 3
 */
private const val WINDOW_SCREEN_FRACTION = 3

/** 浮标有多大 */
private val BALL_SIZE = 44.dp

/**
 * 浮标没被拖过时停在哪: 右上角, 但**往下让开一个 dsh 侧边栏图标位**
 *
 * 对话时右边栏的图标就贴在右上角, 球压在第一个图标上, 那一个就点不着了。dsh 侧边栏的每一项是
 * 36px 的行高加 4px 间距 (见 `packages/client/ui-sidebar` 的 `SidebarRoot.module.css`), 所以一个
 * 图标位是 40dp - 球从那里往下站, 正好落在第一个图标下面
 */
private val BALL_START_TOP = 40.dp

/** 浮标空闲多久开始变淡, 以及淡到多少 */
private const val BALL_IDLE_MS = 5000L
private const val BALL_DIM_ALPHA = 0.25f

/** 变淡用多久, 和拖动那套弹簧分开: 这是"提示", 不是"运动", 用一条短渐变就够 */
private const val BALL_FADE_MS = 220

/** 按住浮标时的放大, 就是"拿起来"那一下 */
private const val BALL_DRAG_SCALE = 1.08f

/** 闲着与按住的投影高度 */
private val BALL_IDLE_ELEVATION = 2.dp
private val BALL_DRAG_ELEVATION = 6.dp

/**
 * 小窗按住时的投影
 *
 * 小窗只有投影**没有缩放**, 因为它的画面是 `SurfaceView` - 见 [FloatingScreenWindow] 的注释
 */
private val WINDOW_DRAG_ELEVATION = 6.dp

/**
 * 按住/松开那一下的弹簧: 略欠阻尼, 带一点点回弹, "软"就是从这儿来的
 *
 * 分两个是因为 `animateFloatAsState` 与 `animateDpAsState` 要的规格类型不一样
 */
private val PRESS_SCALE_SPRING = spring<Float>(dampingRatio = 0.65f, stiffness = Spring.StiffnessMediumLow)
private val PRESS_LIFT_SPRING = spring<Dp>(dampingRatio = 0.65f, stiffness = Spring.StiffnessMediumLow)

/**
 * 不在拖动时 (头一次落位、可用范围变了) 用的弹簧, 让位置变化不是硬切
 *
 * **拖动中不用它**: 第一版让渲染值用弹簧去追指针, 而 `StiffnessMediumLow` 太软, 屏幕上的球明显
 * 落在手指后面, 要等手停下来才追得上去 — 用户的原话是"没有被拖动, 而是移动停止后才最终落位, 这样
 * 导致更加生硬"。跟手这件事上严丝合缝比优雅重要, 所以拖动中直接 `snapTo`, 柔化交给按住那一下
 * 缩放与投影
 */
private val SETTLE_SPRING = spring<Offset>(stiffness = Spring.StiffnessMediumLow, dampingRatio = 1f)

/** 小窗顶栏的高度, 拖动把手与减号都在这条上 */
private val WINDOW_BAR_HEIGHT = 36.dp

/**
 * 小窗上那个减号的触摸区
 *
 * 它比图标大一圈, 但**绝不能换成 Miuix 的 `IconButton`**: 那个是 48dp, 而窗只有屏宽的几分之一
 * (手机上 60dp), 一放上去整条标题栏就只剩按钮了 - 子节点先拿到事件, 拖动再没有地方下手
 */
private val WINDOW_BUTTON_SIZE = 24.dp

/**
 * 小窗头一次出现在离屏幕顶多高的地方
 *
 * 屏幕顶部那一条被系统拿去做下拉通知栏的手势区, 落在里面的触摸不会交给应用, 所以标题栏一进去就
 * 拖不动了 - 起始位置放在这条线以下, 免得一上来就抓不住。实测这台设备上 y=250 的下拉被通知栏接
 * 走, y=400 才回到应用, 这个值要在这条分界之上留出余量
 *
 * 它只管**起点**: 用户要的是整块屏幕都能放, 所以往上不再设禁入区, 拖到顶是允许的
 */
private val WINDOW_START_TOP = 120.dp

/** Logcat tag for what the embedded browser reports */
private const val WEB_TAG = "DshWebView"

/**
 * renderer 死了之后**同一个窗最多自动换几次新的**
 *
 * 一次是正常的恢复 (系统回收 / OOM 各是一次意外); 连着死三次还自动重建就是在重建循环里烧电,
 * 那时把手交给那个真 Dialog, 让主人自己决定要不要重试
 */
private const val MAX_PAGE_REBUILDS = 3

/**
 * 预览里那颗「用系统文件管理器打开」用的自定义 scheme
 *
 * 网页那一半只知道**工作区的相对路径**, 而交给系统要的是一条能读的 `content://`。两条路都不该让页面
 * 自己走: FileProvider 在应用这一侧, `startActivity` 更不是页面能调的东西。于是约定一条窄通道 ——
 * 页面把"读字节时拿到的绝对路径"塞进 `luwi-open://file?path=…`, 由这里换成 intent
 * (`OpenFile.allowed` 只放行工作区与 `$DSH_HOME` 之下, 文档里夹一条这样的链接也递不出别的路径)
 */
private const val OPEN_SCHEME = "luwi-open"
private const val OPEN_PATH_PARAM = "path"

/**
 * 把一个工作区文件交给系统里接这个类型的那个应用
 *
 * 没有应用能接是常态 (模拟器上就没有 Office), 那一档给一句 Toast 而不是静默 —— 主人点的是
 * "用系统文件管理器打开", 什么都没发生会被当成按钮坏了
 * @param context 用来发 intent 与弹 Toast 的上下文
 * @param path 页面交回来的绝对路径
 */
private fun openWithSystem(context: Context, path: String?) {
    val file = path?.let { OpenFile.allowed(context, it) }
    if (file == null) {
        Log.w(WEB_TAG, "open-with-system refused ${path ?: "(no path)"}")
        Toast.makeText(context, context.getString(R.string.preview_open_refused), Toast.LENGTH_SHORT).show()
        return
    }
    val intent = OpenFile.viewIntent(context, file)
    val problem = try {
        context.startActivity(intent)
        Log.i(WEB_TAG, "handed ${file.name} to the system")
        null
    } catch (error: ActivityNotFoundException) {
        "no app opens ${file.extension}"
    }
    if (problem != null) {
        Log.w(WEB_TAG, problem)
        Toast.makeText(context, context.getString(R.string.preview_open_missing), Toast.LENGTH_SHORT).show()
    }
}

/**
 * 这一跳是不是宿主自己那一页 (scheme 与 host:port 都一样)
 *
 * 这个 WebView 里从头到尾**只有一个文档**: 会话界面。别处的页面一旦在这里导航成功, GUI 就被顶掉
 * 了 —— 而它没有"历史后退"那条路可走 (dsh 的客户端根本没有用 `history`, 见 `PAGE_BACK_JS` 那一
 * 段), 屏幕上只剩那个网站。判据只比 origin, 不比路径: 宿主自己的路由与静态资源都在同一个 origin 上
 */
private fun sameOrigin(target: Uri, host: Uri): Boolean =
    target.scheme == host.scheme && target.host == host.host && target.port == host.port

/**
 * 「回应用」那一跳的耐心: 等一次重载落地多久 / 等一次 JS 回话多久, 以及最多试几次
 *
 * 两次的代价是"重载两遍页面", 而收益是"一次没成不会静默什么都不发生" —— 在 dsh 里那一下本来就是
 * 主人点名要的反馈
 */
private const val RETURN_WAIT_MS = 15_000L
private const val RETURN_ASK_MS = 5_000L
private const val RETURN_TRIES = 2

/**
 * 返回键问页面那一句最多等多久
 *
 * `evaluateJavascript` 是同步进渲染进程的, 正常几毫秒就回; 这个上限只兜"页面正忙 / 已经不在了"
 * 那一档 —— 挂得比它久就等于把返回键吃掉了, 而没答话时调用方会把这一下还给「再按一次退出」
 */
private const val PAGE_BACK_MS = 500L

/**
 * 返回键那一下该按页面上的哪个东西: 右栏那个展开着的格右上角的「收起」
 *
 * 手机上 (视口窄于 768 px) 那一格是**全屏**的, 点一条网页链接之后会话连同顶栏一起被它盖住, 而系统
 * 返回键原来只会在主页上弹「再按一次退出」—— 用户的原话是"网页全屏, 无法返回会话" (2026-10-18)
 *
 * 判据只用 dsh 自己写在那块面板上的两个 `data` 属性, 不猜类名也不按文字认: `data-sidebar-right-open`
 * 说明它现在展开着 (`fullscreen` 与 `push` 两档都算, 后者在横屏与平板上就是半屏那一块),
 * `data-sidebar-right-toggle` 就是面板上那颗「收起」(见 dsh 的 `ui-sidebar-right` 里 PanelChrome,
 * 两个属性都由它自己写, 与界面语言无关)
 *
 * 回 `closed` / `none`: 后者是"这一页没有可收的层", 调用方据此把返回键还回去
 */
private const val PAGE_BACK_JS = """
(function () {
  var panel = document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]')
  if (!panel) return 'none'
  var collapse = panel.querySelector('[data-sidebar-right-toggle]')
  if (!collapse) return 'none'
  collapse.click()
  return 'closed'
})()
"""

/** Shell facts worth logging after a load: boot globals, DOM size, and whatever text rendered */
private const val SHELL_PROBE = """(function () {
  var root = document.getElementById('root')
  var probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;left:-1px;width:1px;height:100vh'
  document.body.appendChild(probe)
  var vh = probe.getBoundingClientRect().height
  probe.remove()
  return JSON.stringify({
    ready: typeof globalThis.__DSH_BOOT_READY__,
    boot: typeof globalThis.__DSH_BOOT__,
    loader: typeof globalThis.__ModuleLoader__,
    rootChildren: root ? root.childElementCount : -1,
    htmlLength: document.documentElement.outerHTML.length,
    innerHeight: innerHeight,
    vh: vh,
    text: (document.body.innerText || '').slice(0, 80)
  })
})()
"""

/**
 * "界面画出来了没有"的判据 (2.7.10): `root` 里有几个子节点, `-1` = 连 root 都没有
 *
 * 它比上面那句 [SHELL_PROBE] 窄得多, 只回答一件事 —— 那一段是给人看的读数, 这一句是**弹不弹窗**
 * 的判据, 所以两者分开: 读数那句改了不该动到弹窗的门槛
 */
private const val READY_PROBE = "(function(){var r=document.getElementById('root');return r?r.childElementCount:-1})()"

/** The name the page sees for the bridge above: `window.Luwi` */
private const val WAKE_BRIDGE = "Luwi"

/** 门户那一层的桥名: `window.LuwiPortal` (判断层 / 工作结构 / 球那场的账) */
private const val PORTAL_BRIDGE = "LuwiPortal"

/**
 * 页面与 app 之间那一座桥: 唤醒词那两件事 + "现在在看哪一场"
 *
 * 为什么不是 dsh 的 client 插件加一条私有路由: 那个指示器要显示的状态 (服务在不在听、命中了几次)
 * 只有 app 这一侧知道, 而点它要停的也是 app 里那个前台服务 —— 插件跑在浏览器 JS 里, 两个都拿不到,
 * 还得再连一条回 app 的通道; 而 dsh 的 client 插件是内部协议上的产物 (每个包跟着上游的 descriptors
 * 与 codecs 走), 为一个小徽标挂一个包不划算。这条桥与一条路由的信任边界是一样的: 页面就是本机 host
 * 发的那一个 (见上面 shouldOverrideUrlLoading 只放行 http/https)
 *
 * **三个方法里只有 [session] 带参数** (2026-10-07 加的): 它是页面推上来的"现在在看哪一场", 而那份
 * 状态只有浏览器里有 (`localStorage['dsh.sessions.current']`)。这个参数只当提示用 —— 它最终要过宿主
 * 那一侧的"这一场还在、还是根会话"检查, 认不出来就落回原来的规则, 所以桥上多这一条不改信任边界
 */
private class WakeBridge(private val context: Context) {

    /**
     * 现在什么样: **这一句话的窗口开着没有**、命中几次、看的是哪几个词 —— 一句 JSON, 页面照着画
     *
     * 这里给的是 `voice`, 它读的是 [VoiceState.capturing]: 那个胶囊对应的是"麦克风正在被吃", 所以只有
     * 命中唤醒词 (或球上点一下) 之后那一段时间里才该出现, **纯唤醒词守着的时候它不出来** —— 那是常态
     * (唤醒词一直在守), 不该在会话界面上一直挂一个"正在听"的徽标 (主人 2026-10-05 定的两条链分开说)
     *
     * **它原来读的是 `WakeWordState.voiceActive`** (2026-10-06 改的): 那一个是"常驻语音那半条在不在
     * 跑", 而常驻语音整条链路已经删掉了 —— 现在两者说的是同一件事, 只剩 `capturing` 这一个名字
     */
    @JavascriptInterface
    fun state(): String = JSONObject().apply {
        put("voice", VoiceState.capturing)
        put("listening", WakeWordState.listening)
        put("hits", WakeWordState.hits)
        put("words", LwWakeWord.names(context).joinToString(", "))
        put("ready", WakeWordDownload.present(context))
        put("label", context.getString(R.string.wake_badge_listening))
        put("stop", context.getString(R.string.wake_badge_stop))
    }.toString()

    /**
     * 点一下就是**把这一句话的窗口收掉**
     *
     * **不关唤醒词**: 那才是这个胶囊代表的那件事 (它只在窗口开着时出现), 而唤醒词继续守着 —— 想再要
     * 一次"开口说话", 喊一声就回来了, 整件事收工是通知栏那个「停止」, 那个按钮关的是服务, 与这里
     * 分工不同
     */
    @JavascriptInterface
    fun stop(): String {
        val intent = Intent(context, WakeWordService::class.java)
            .setAction(WakeWordService.ACTION_HUSH)
        runCatching { ContextCompat.startForegroundService(context, intent) }
        return state()
    }

    /**
     * 页面报一句: **它现在在看哪一场** (`localStorage['dsh.sessions.current']` 里那个 id)
     *
     * 用处只有一个: 切进视频模式那一刻把这一场**定格**下来 ([LwWakeWord.resident]), 于是视频模式里
     * 说的话与"打开视频模式"那句话落在同一场 (主人 2026-10-07 的口径: 两条投递目标要统一)
     *
     * 空串是合法输入, 意思是"现在没有选中的会话" (页面刚起来 / 选择被清掉那一档) —— 那时把它清成
     * null, 别让一个过期的 id 钉在那儿。长度上限只是防呆: 真伪由宿主那侧的存在性检查兜底
     */
    @JavascriptInterface
    fun session(id: String) {
        val wanted = id.trim()
        VoiceState.uiSession = wanted.takeIf { it.isNotEmpty() && it.length <= SESSION_ID_MAX }
    }

    private companion object {
        /** 会话 id 的长度上限 (dsh 的是 `session-` 加一个 uuid, 给足余量) */
        const val SESSION_ID_MAX = 128
    }
}

/**
 * 输入框上沿那个麦克风指示器
 *
 * 状态只有一条: **"这一句话的窗口"开着的时候才出来**, 用跳动的波形表示"麦克风正在被吃", 点一下把它
 * 关掉 (上面的 [WakeBridge]) —— 一直开着的麦克风必须有一眼看得见、一下就关得掉的地方, 通知栏那一条
 * 是后台时看的, 这一条是看着会话时看的。**唤醒词守着的时候它不出现**: 那是常态 (麦克风本来就开着听
 * 那个词), 一直挂着只会让人以为麦克风在被吃
 *
 * 它原来代表的是"常驻语音" (那条一直不收的链), 而那条链 2026-10-06 已经删掉了 —— 徽标本身留着,
 * 语义收窄成"这一句正在听"
 *
 * 位置是**算出来的**: 找到页面里那个输入框 (textarea 或 contenteditable), 贴在它上沿的左上角; 找不到
 * 就退回右下角一个固定位置。所以不碰输入框自己的控件 (发送键那些还在原地), 也不依赖 dsh 的类名 ——
 * 它换一次前端不该让这个徽标消失
 *
 * 样式一律用 CSSOM (`element.style.x = ...`) 与 JS 计时器来做, **不插样式表也不插 keyframes**: 页面
 * 万一哪天带上 `style-src` 的 CSP, 内联样式表会被挡掉, 而这样写不受影响
 */
private const val WAKE_BADGE_JS = """
(function () {
  if (!window.Luwi) return
  var ID = 'lw-wake-badge'
  var TICK = 220
  var POLL = 1000
  var CURRENT = 'dsh.sessions.current'
  var phase = 0
  var last = null
  var lastSession = null
  function build() {
    if (document.getElementById(ID) || !document.body) return
    var badge = document.createElement('div')
    badge.id = ID
    var style = badge.style
    style.position = 'fixed'
    style.zIndex = '2147483646'
    style.display = 'flex'
    style.alignItems = 'center'
    style.gap = '6px'
    style.padding = '4px 10px 4px 8px'
    style.borderRadius = '999px'
    style.background = 'rgba(24,24,27,0.86)'
    style.color = '#ffffff'
    style.font = '12px/16px system-ui,-apple-system,sans-serif'
    style.boxShadow = '0 2px 10px rgba(0,0,0,0.28)'
    style.opacity = '0'
    style.pointerEvents = 'none'
    style.transition = 'opacity 200ms'
    style.cursor = 'pointer'
    var wave = document.createElement('span')
    wave.style.display = 'flex'
    wave.style.alignItems = 'flex-end'
    wave.style.gap = '2px'
    wave.style.height = '14px'
    for (var i = 0; i < 5; i++) {
      var bar = document.createElement('i')
      bar.style.display = 'block'
      bar.style.width = '2px'
      bar.style.height = '3px'
      bar.style.borderRadius = '1px'
      bar.style.background = '#7ee787'
      wave.appendChild(bar)
    }
    var text = document.createElement('span')
    text.setAttribute('data-role', 'text')
    badge.appendChild(wave)
    badge.appendChild(text)
    badge.onclick = function (event) {
      event.preventDefault()
      event.stopPropagation()
      try { last = JSON.parse(window.Luwi.stop()) } catch (error) {}
      draw(last, false)
      bars(false)
    }
    document.body.appendChild(badge)
  }
  function place(badge) {
    var editable = document.querySelector('textarea, [contenteditable="true"]')
    if (editable) {
      var box = editable.getBoundingClientRect()
      if (box.width > 40 && box.height > 0) {
        badge.style.left = Math.max(6, box.left + 2) + 'px'
        badge.style.top = Math.max(6, box.top - 30) + 'px'
        badge.style.right = 'auto'
        badge.style.bottom = 'auto'
        return
      }
    }
    badge.style.left = 'auto'
    badge.style.top = 'auto'
    badge.style.right = '12px'
    badge.style.bottom = '96px'
  }
  function draw(state, live) {
    var badge = document.getElementById(ID)
    if (!badge) return
    if (!live) {
      badge.style.opacity = '0'
      badge.style.pointerEvents = 'none'
      return
    }
    badge.style.opacity = '1'
    badge.style.pointerEvents = 'auto'
    place(badge)
    var text = badge.querySelector('[data-role="text"]')
    text.textContent = (state && state.label ? state.label : '') + (state && state.hits > 0 ? ' ' + state.hits : '')
    badge.title = (state && state.words ? state.words + ' - ' : '') + (state && state.stop ? state.stop : '')
  }
  function bars(live) {
    var badge = document.getElementById(ID)
    if (!badge) return
    var all = badge.querySelectorAll('i')
    for (var i = 0; i < all.length; i++) {
      var height = 3
      if (live) height = 4 + Math.round(9 * (0.5 + 0.5 * Math.sin(phase + i * 1.7)))
      all[i].style.height = height + 'px'
    }
  }
  function on() { return !!(last && last.voice) }
  // 现在在看哪一场: 变了才过一次桥 (那个 id 是 app 那一侧"进视频模式时定格哪一场"的输入,
  // 见 WakeBridge.session), 一秒问一次 localStorage 是本地读, 不花钱
  function tellSession() {
    var id = ''
    try {
      var saved = JSON.parse(localStorage.getItem(CURRENT) || 'null')
      if (saved && saved.sessionId) id = String(saved.sessionId)
    } catch (error) {}
    if (id === lastSession) return
    lastSession = id
    try { window.Luwi.session(id) } catch (error) {}
  }
  function refresh() {
    build()
    var state = null
    try { state = JSON.parse(window.Luwi.state()) } catch (error) {}
    last = state
    tellSession()
    draw(state, on())
    bars(on())
  }
  // 问 app 一秒一次足够 (它那侧要读一次词表与四个文件的大小), 而波形按 220ms 跳 —— 状态缓存在这里,
  // 不是每一帧都过一次桥
  refresh()
  setInterval(function () {
    phase += 0.9
    bars(on())
  }, TICK)
  setInterval(refresh, POLL)
})()
"""

/**
 * 开屏那一块 (2026-10-25 主人: "增加开屏加载动画，图标+转圈，图标下方放个加载日志，最底下加 power by
 * deepseek harness 小字")
 *
 * 它是"host 还没起来"那一段唯一的画面, 而这一段从**首启解压三万多文件**开始, 到 node 起来、dsh 打出
 * 那一行 `dsh web:` 为止 —— 老机器上要好几十秒。所以这里给三样:
 *
 * 1. 品牌标记 + 一圈转 (那一圈是这里自己画的: Miuix 没有进度环, 而 material3 不是本项目依赖)
 * 2. 图标下面一行**加载日志** —— 取 host 自己最后一行输出 ([DshHost.log]), 换一行就淡入换一次;
 *    点一下展开完整那份 (老那一版整屏 300 行的诊断能力不丢), 失败时默认就是展开的
 * 3. 最底下一行 `powered by deepseek harness`
 *
 * 解压那一档有真实进度 (`Installing(done, total)`), 所以日志下面多一条细的定长进度条; 别的阶段只有那
 * 一圈转 —— 那些阶段没有可报的数 (node 起来要多久只有它自己知道)
 *
 * @param status the state to describe.
 * @param modifier layout modifier from the caller.
 */
@Composable
private fun HostBootPanel(
    status: HostStatus,
    modifier: Modifier = Modifier,
    /** host 已经就绪、只剩页面还在加载时的那一句 (那一档 [HostStatus] 自己说不出来) */
    pageStage: String? = null,
) {
    val colors = MiuixTheme.colorScheme
    val context = LocalContext.current
    val failure = status as? HostStatus.Failed
    // 失败时一进来就是展开的: 那时日志就是唯一的线索, 不该再让人点一下
    var expanded by remember(failure) { mutableStateOf(failure != null) }
    // 起不来的时候设置页可能都进不去, 自检这条路得摆在这一屏上
    // (2026-11-08 主人: 自检修不了, 由他自己决定要不要匿名上报)
    var reportFailure by remember(failure) { mutableStateOf(false) }
    // 主人 / agent 写的那份 splash.json (见 [SplashSetting]): 每次进来现读, 改完下一次开屏就是新的
    val splash = SplashSetting.config(context)
    // 自己那张图标: 只在文件真的换了 (大小/时间变了) 才重新解一遍
    val stamp = remember(splash.icon) { SplashSetting.stamp(splash.icon) }
    val custom = remember(stamp) { SplashSetting.decode(splash.icon) }
    val accent = splash.accent?.let { Color(it) } ?: colors.primary
    val background = splash.background?.let { Color(it) } ?: colors.surface
    // 自己配了底色就得自己挑字色: 深底上还用主题那个深字, 整屏字就"消失"了 (2026-10-25 第一次
    // 用深色样例时当场看见的)。没配底色时照旧跟着主题走
    val onBackground = when {
        splash.background == null -> colors.onSurface
        SplashSetting.isDark(splash.background) -> Color.White
        else -> Color.Black
    }
    val onBackgroundDim = onBackground.copy(alpha = 0.66f)
    val stage = pageStage ?: when (status) {
        is HostStatus.Idle -> stringResource(R.string.boot_stage_preparing)
        is HostStatus.Installing -> stringResource(R.string.host_status_installing, status.done, status.total)
        is HostStatus.Starting -> stringResource(R.string.host_status_starting)
        is HostStatus.Failed -> stringResource(R.string.host_status_failed, status.reason)
        is HostStatus.Running -> stringResource(R.string.host_status_running)
    }
    // title 写了就用它顶替阶段话 (agent 自己设计的台词); 没写就照旧按阶段说
    val headline = splash.title.ifBlank { stage }
    val lastLog = DshHost.log.lastOrNull { it.isNotBlank() }.orEmpty()
    Box(modifier.fillMaxSize().background(background)) {
        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .fillMaxWidth()
                .padding(horizontal = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (custom != null) {
                Image(
                    bitmap = custom.asImageBitmap(),
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.size(112.dp),
                )
            } else {
                Image(
                    painter = painterResource(R.drawable.ic_launcher_foreground),
                    contentDescription = null,
                    modifier = Modifier.size(112.dp),
                )
            }
            Spacer(Modifier.height(4.dp))
            BootIndicator(
                color = if (failure != null) colors.error else accent,
                motion = splash.motion,
            )
            Spacer(Modifier.height(14.dp))
            Text(
                text = headline,
                style = MiuixTheme.textStyles.body2,
                color = if (failure != null) colors.error else onBackground,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            if (failure != null) {
                TextButton(
                    text = stringResource(R.string.boot_failed_report),
                    onClick = { reportFailure = true },
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            if (splash.subtitle.isNotBlank()) {
                Text(
                    text = splash.subtitle,
                    style = MiuixTheme.textStyles.footnote1,
                    color = onBackgroundDim,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                )
            }
            (status as? HostStatus.Installing)?.let { installing ->
                if (installing.total > 0) {
                    Spacer(Modifier.height(10.dp))
                    BootProgress(
                        ratio = installing.done.toFloat() / installing.total,
                        color = colors.primary,
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            if (!splash.showLog) {
                // 主人把日志关了: 只留那一句阶段话 (失败时仍然展开: 找不到原因比"多一行"更糟)
                if (expanded) {
                    BootLogExpanded(
                        onCollapse = { expanded = false },
                        modifier = Modifier.fillMaxWidth(),
                        hintColor = onBackgroundDim,
                    )
                }
            } else if (expanded) {
                BootLogExpanded(
                    onCollapse = { expanded = false },
                    modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                    hintColor = onBackgroundDim,
                )
            } else {
                // 换了一行就淡一下: 老机器上"它还在动"这件事, 大半靠这一下看得出来
                Crossfade(
                    targetState = lastLog.ifBlank { stringResource(R.string.boot_log_waiting) },
                    animationSpec = tween(220),
                    label = "boot-log",
                ) { line ->
                    Text(
                        text = line,
                        // 等宽 + 压暗: 它是 host 的原话, 不是我们写给人看的句子 —— 这样看着才像"日志",
                        // 也免得一行路径被当成出错信息
                        style = MiuixTheme.textStyles.footnote1.copy(fontFamily = FontFamily.Monospace),
                        color = onBackgroundDim,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { expanded = true },
                    )
                }
                if (DshHost.log.isNotEmpty()) {
                    Text(
                        text = stringResource(R.string.boot_log_hint),
                        style = MiuixTheme.textStyles.footnote1,
                        color = onBackgroundDim.copy(alpha = 0.5f),
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp)
                            .clickable { expanded = true },
                    )
                }
            }
        }
        // 「开始使用」那张体检表**不再挂在启动页底部** (2026-11-04 主人 #2: 不要放底部): 它现在是
        // 一个居中对话框, 首启由 [ReadyPrompt] 弹一次, 之后走设置页那一行「检查所需依赖」
        if (reportFailure) DoctorDialog(onDismissRequest = { reportFailure = false })
        if (splash.credit.isNotBlank()) {
            Text(
                text = splash.credit,
                style = MiuixTheme.textStyles.footnote1,
                color = onBackgroundDim.copy(alpha = 0.45f),
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .padding(bottom = 26.dp),
            )
        }
    }
}

/** 中间那一个动效: 主人可以在设置页里选转圈 / 呼吸 / 不转 ([SplashSetting.Motion]) */
@Composable
private fun BootIndicator(color: Color, motion: SplashSetting.Motion) {
    when (motion) {
        SplashSetting.Motion.NONE -> Unit
        SplashSetting.Motion.SPIN -> BootSpinner(color)
        SplashSetting.Motion.PULSE -> BootPulse(color)
    }
}

/** 呼吸那一档: 一整圈淡底 + 一圈忽明忽暗、忽大忽小的环 (不转, 但看得出来它还在动) */
@Composable
private fun BootPulse(color: Color) {
    val breath = rememberInfiniteTransition(label = "boot-pulse")
    val level by breath.animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 900, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "boot-pulse-level",
    )
    Canvas(modifier = Modifier.size(26.dp)) {
        val width = size.minDimension * 0.12f
        val maxRadius = size.minDimension / 2f - width / 2f
        drawCircle(
            color = color.copy(alpha = 0.16f),
            radius = maxRadius,
            style = Stroke(width = width),
        )
        drawCircle(
            color = color.copy(alpha = level),
            // 环自己也在缩一点: 只变亮度的话在深色壁纸上几乎看不出来
            radius = maxRadius * (0.62f + 0.38f * level),
            style = Stroke(width = width, cap = StrokeCap.Round),
        )
    }
}

/** 那一圈转: 一圈淡底 + 一段圆弧绕着转 (自己画, 不引依赖) */
@Composable
private fun BootSpinner(color: Color) {
    val spin = rememberInfiniteTransition(label = "boot-spinner")
    val angle by spin.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 900, easing = LinearEasing)),
        label = "boot-spinner-angle",
    )
    Canvas(modifier = Modifier.size(26.dp)) {
        val width = size.minDimension * 0.12f
        drawArc(
            color = color.copy(alpha = 0.16f),
            startAngle = 0f,
            sweepAngle = 360f,
            useCenter = false,
            style = Stroke(width = width, cap = StrokeCap.Round),
        )
        drawArc(
            color = color,
            startAngle = angle,
            sweepAngle = 100f,
            useCenter = false,
            style = Stroke(width = width, cap = StrokeCap.Round),
        )
    }
}

/** 解压那一档的定长进度条 (只有它有真实数字) */
@Composable
private fun BootProgress(ratio: Float, color: Color) {
    Box(
        modifier = Modifier
            .fillMaxWidth(0.6f)
            .height(3.dp)
            .clip(CircleShape)
            .background(color.copy(alpha = 0.16f)),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(ratio.coerceIn(0f, 1f))
                .fillMaxHeight()
                .background(color),
        )
    }
}

/**
 * 完整日志 (点开那一档): 与老那一版同一个内容, 只是塞进一块半高的卡片里, 点一下收起
 *
 * `heightIn` 是必须的 —— [LazyColumn] 在无界高度里量不出来; 上限取屏高的一半, 剩下的留给开屏那三样
 */
@Composable
private fun BootLogExpanded(onCollapse: () -> Unit, modifier: Modifier = Modifier, hintColor: Color = MiuixTheme.colorScheme.onSurfaceVariantSummary) {
    Card(modifier = modifier.clickable { onCollapse() }) {
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 260.dp)
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            items(DshHost.log) { line ->
                Text(
                    text = line,
                    style = MiuixTheme.textStyles.footnote1,
                    // 卡片里面是主题底色, 所以这里照旧用主题的字色 (外面那屏才可能换过底色)
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
    Text(
        text = stringResource(R.string.boot_log_collapse),
        style = MiuixTheme.textStyles.footnote1,
        color = hintColor.copy(alpha = 0.5f),
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 6.dp)
            .clickable { onCollapse() },
    )
}
