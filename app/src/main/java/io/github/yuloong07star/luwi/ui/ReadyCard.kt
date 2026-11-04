/*
 * Hallmark · component: ready-card · genre: modern-minimal · theme: luwi-miuix
 * states: default · running(带确定进度) · done · failed · 锁住(下一件还点不动) · reading(读状态)
 * contrast: 颜色全部取 MiuixTheme.colorScheme, 没有写死色值; 可点的方框 >= 50dp
 * structure: 阶梯 (五件依赖排成一条竖轨 + 五个节点), 不是"标题 -> 五行状态 -> 按钮"
 */
package io.github.yuloong07star.luwi.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.channel.AccessibilitySetting
import io.github.yuloong07star.luwi.channel.ChannelSetting
import io.github.yuloong07star.luwi.channel.VirtualScreen
import io.github.yuloong07star.luwi.constants.UiSpacing
import io.github.yuloong07star.luwi.tool.LwWakeWord
import io.github.yuloong07star.luwi.voice.SpeechModelDownload
import io.github.yuloong07star.luwi.wake.WakeWordDownload
import io.github.yuloong07star.luwi.wake.WakeWordWords
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

/**
 * 「开始使用」: 第一次装完之后还差什么
 *
 * **这不是教程, 是体检表**, 而且是一张**有先后**的体检表。第一次打开这一页的人不知道"特权通道"是什么,
 * 也不知道它跟"能不能用"有什么关系; 但"还差 3 步"和每一项后面那个按钮是他看得懂的。所以这里只做三件事:
 * 说清还差几件, 每一件现在什么样, 点一下把它办掉
 *
 * **结构**: 五件按依赖顺序排成一条竖轨 (特权通道 → 无障碍 → 唤醒模型 → 语音模型 → 虚拟屏), 每件是一个
 * 节点。轨道本身在说话: 已经通了的那一段是主题色, 还没到的那一段是暗的 —— "这是一串有先后的事"不用
 * 再写一句话解释, 看线就知道。无障碍要靠特权进程写 secure setting, 模型要靠无障碍那条链被叫起来, 虚拟屏
 * 要靠特权进程建; 所以上面那件没通, 下面那件的按钮就是灰的: 先给他一个点得动的, 而不是一个点了报错的
 *
 * **模型这两件不自己下载**: 唤醒词与语音模型各有一个现成的下载器 ([WakeWordDownload] /
 * [SpeechModelDownload], 设置页那两条下载按钮背后就是它们), 它们自带 phase / received / total 三个
 * Compose 状态, 所以这里只是**订阅**进度、按一下调它们的 `download()` —— 不新开一套网络层, 也不自己算
 * 百分比。语音这一件只算 SenseVoice + silero VAD (约 240 MB); GLM-ASR 那套要大得多, 要点名才下,
 * 不算进这张体检表的必做项
 *
 * 全部到位时**整张卡不画**: 用了一周的人不该每次进设置都看见一页"你已经做完了"。但**位置留着** ——
 * 启动页底部这块地方如果突然塌下去, 上面那几行会往上跳一下, 所以收起后按量到的高度占住 (见 reserve)
 *
 * 动效只干一件事: **让人看懂"这是一串有先后的事"**。卡片从下方滑上来 (280ms), 五行依次淡入 (每行差
 * 90ms, 顺序即依赖顺序), 某一行刚变成做完时弹一下, 下载中的那一行用确定进度 (节点环 + 细条 + 百分比),
 * 不是转圈。除了那个环与下载进度, 没有别的东西在动, 也没有循环动画
 *
 * 最后一件事做完时**多停 900ms**再淡出: 否则第五行刚打上勾, 卡片就没了, 那道勾谁也看不见
 */
@Composable
internal fun ReadyCard(modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    // 这三个都是 Compose 状态: 通道与无障碍由各自的 Setting 在 worker 线程上填, 屏列表由
    // [VirtualScreen] 直接改写 —— 所以这里不需要轮询, 也不需要自己记住上一次读到什么
    val channel = ChannelSetting.state
    val accessibility = AccessibilitySetting.state
    val screens = VirtualScreen.screens
    // 建屏不像连接和开无障碍那样自带 working: [VirtualScreen.create] 每次都新建一块, 不去重,
    // 所以按钮自己得挡住连点, 否则点三下就是三块屏
    var creating by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        // 进页面时读一次。四件事都不在画帧的线程上做事: 通道与无障碍要起几个 settings/cmd 子进程;
        // 两个 refresh 只数磁盘上的模型文件, 不联网 (正在下的时候它们自己会让开)
        ChannelSetting.refresh()
        AccessibilitySetting.refreshState()
        WakeWordDownload.refresh(context)
        SpeechModelDownload.refresh(context)
    }

    // 两个下载器的进度都是它们自己的 Compose 状态, 读一下就是订阅: 每收一块它们改一次 received,
    // 这一行跟着重画 —— 没有轮询, 也没有第二套网络层。present() 只在 phase 变的时候数一次文件,
    // 不会每收一块就 stat 一遍
    val wakePhase = WakeWordDownload.phase
    val speechPhase = SpeechModelDownload.phase
    val wakePresent = remember(wakePhase) { WakeWordDownload.present(context) }
    val speechPresent = remember(speechPhase) { SpeechModelDownload.present(context) }
    val wakeBytes = WakeWordDownload.files.sumOf { it.bytes }
    val speechBytes = SpeechModelDownload.files.sumOf { it.bytes } + SpeechModelDownload.vad.bytes
    val wakeProgress = fraction(WakeWordDownload.received, WakeWordDownload.total)
    val speechProgress = fraction(SpeechModelDownload.received, SpeechModelDownload.total)

    val steps = listOf(
        ReadyStep(
            state = when {
                channel?.connected == true -> ReadyState.DONE
                // 读到了而没连上, 且通道自己记了原因: 这一件是"试过、没成", 不是"还没办"
                !channel?.error.isNullOrEmpty() -> ReadyState.FAILED
                else -> ReadyState.TODO
            },
            title = stringResource(R.string.ready_channel),
            detail = when {
                channel == null -> stringResource(R.string.ready_reading)
                channel.connected -> stringResource(
                    R.string.ready_channel_ok,
                    channel.backend.orEmpty(),
                )
                else -> channel.error.orEmpty().ifEmpty { stringResource(R.string.ready_channel_off) }
            },
            action = ReadyAction.Connect,
        ),
        ReadyStep(
            state = when {
                accessibility?.healthy == true -> ReadyState.DONE
                AccessibilitySetting.lastError != null -> ReadyState.FAILED
                else -> ReadyState.TODO
            },
            title = stringResource(R.string.ready_accessibility),
            detail = when {
                accessibility == null -> stringResource(R.string.ready_reading)
                accessibility.healthy -> stringResource(R.string.ready_accessibility_ok)
                else -> AccessibilitySetting.lastError
                    ?: stringResource(R.string.ready_accessibility_off)
            },
            action = ReadyAction.Accessibility,
        ),
        ReadyStep(
            state = wakeState(wakePhase, wakePresent),
            title = stringResource(R.string.ready_wake),
            detail = modelDetail(
                downloading = wakePhase == WakeWordDownload.Phase.DOWNLOADING,
                failed = wakePhase == WakeWordDownload.Phase.FAILED,
                present = wakePresent,
                bytes = wakeBytes,
                received = WakeWordDownload.received,
                total = WakeWordDownload.total,
                reason = WakeWordDownload.detail,
            ),
            progress = wakeProgress,
            action = ReadyAction.WakeDownload,
            bytes = wakeBytes,
        ),
        ReadyStep(
            state = speechState(speechPhase, speechPresent),
            title = stringResource(R.string.ready_speech),
            detail = modelDetail(
                downloading = speechPhase == SpeechModelDownload.Phase.DOWNLOADING,
                failed = speechPhase == SpeechModelDownload.Phase.FAILED,
                present = speechPresent,
                bytes = speechBytes,
                received = SpeechModelDownload.received,
                total = SpeechModelDownload.total,
                reason = SpeechModelDownload.detail,
            ),
            progress = speechProgress,
            action = ReadyAction.SpeechDownload,
            bytes = speechBytes,
        ),
        ReadyStep(
            state = if (screens.isNotEmpty()) ReadyState.DONE else ReadyState.TODO,
            title = stringResource(R.string.ready_screen),
            detail = if (screens.isEmpty()) {
                stringResource(R.string.ready_screen_off)
            } else {
                stringResource(R.string.ready_screen_ok, screens.size)
            },
            action = ReadyAction.CreateScreen,
        ),
    )

    val done = steps.count { it.state == ReadyState.DONE }
    val missing = steps.size - done
    // **只给下一步该做的那一件**。五件各给一个按钮, 用户会按顺序全按一遍, 而第二件往后按下去只会报
    // "特权通道还没通"; 正在下的那一件也不换按钮 —— 同一块方框就当地给它自己用 (见 [ReadyActionRow])
    val next = steps.firstOrNull { it.state != ReadyState.DONE }

    // 这张卡在这页上"露过面"没有: 决定全绿时是直接不画 (本来就没露过) 还是先亮一下再收
    var shown by remember { mutableStateOf(false) }
    // 正在收尾: 全绿了但还没淡出完。这个标志让下面的显示条件暂时别把卡片抽走
    //
    // 它是**算出来的**, 不是在 [LaunchedEffect] 里置位的: 效果体要等这一帧组合结束才跑, 而 missing
    // 变 0 的那一刻就发生在组合里 —— 等到效果体再去置位, 中间那一帧已经按"全绿"把整棵子树抽掉了,
    // 卡片会闪一下再带着重新播的入场动画回来
    val lingering = missing == 0 && shown
    LaunchedEffect(missing) {
        if (missing > 0) {
            shown = true
        } else if (shown) {
            // 最后一件事是当着面做完的: 让 5/5 亮一下, 再淡出
            delay(LingerMillis)
            shown = false
        }
    }

    // 收起之后按上一次量到的高度占住: 启动页底部这块地方突然塌下去, 上面那几行会跳一下。
    // 一进来就全绿的 (从没露过面) 量不到高度, 于是**一个像素都不占**
    var reserve by remember { mutableStateOf(0) }
    val density = LocalDensity.current
    val visible = missing > 0 || lingering

    // 还没读到就不画: 两个 state 的初值都是 null, 否则刚进页面会闪一下"还差 5 步", 一帧后变少
    if (channel == null && accessibility == null) return

    Box(
        modifier = modifier.then(
            if (visible || reserve == 0) {
                Modifier
            } else {
                Modifier.height(with(density) { reserve.toDp() })
            },
        ),
    ) {
        AnimatedVisibility(
            visible = visible,
            // 入场只挂这一处, 而且交给 AnimatedVisibility 自己管: 原来那条 Animatable 会跟着 missing
            // 重启 (每办完一件就重启一次), 被打断的那一帧停在半透明上, 五行就一起灰着 —— 现在没人
            // 中途改它的值了
            enter = fadeIn(tween(durationMillis = AppearMillis, easing = FastOutSlowInEasing)) +
                slideInVertically(
                    animationSpec = tween(durationMillis = AppearMillis, easing = FastOutSlowInEasing),
                    initialOffsetY = { it / 24 },
                ),
            exit = fadeOut(tween(durationMillis = LeaveMillis, easing = FastOutSlowInEasing)),
            modifier = Modifier.onSizeChanged { if (it.height > 0) reserve = it.height },
        ) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(UiSpacing.Large),
                ) {
                    ReadyHead(done = done, total = steps.size, missing = missing)

                    steps.forEachIndexed { index, step ->
                        // 用下标当身份: 五件的顺序本来就是固定的依赖顺序, 下标就是这个顺序本身
                        ReadyRow(
                            step = step,
                            index = index,
                            last = index == steps.lastIndex,
                            modifier = Modifier.padding(top = if (index == 0) UiSpacing.Large else 0.dp),
                        )
                    }

                    ReadyActionRow(
                        next = next,
                        enabled = !creating,
                        onAction = { action ->
                            when (action) {
                                ReadyAction.Connect -> ChannelSetting.connect()
                                ReadyAction.Accessibility -> AccessibilitySetting.set(true)
                                ReadyAction.WakeDownload -> scope.launch {
                                    // download() 是同步阻塞的一趟网络, 不能落在画帧的线程上
                                    withContext(Dispatchers.IO) {
                                        runCatching { WakeWordDownload.download(context) }
                                        // 模型没下过时 keywords.txt 也还没写过: 补上缺省那张词表,
                                        // 否则"模型就绪"了而服务照样起不来 (设置页那一条同理)
                                        if (LwWakeWord.names(context).isEmpty()) {
                                            LwWakeWord.setWords(context, WakeWordWords.defaultText())
                                        }
                                    }
                                }

                                ReadyAction.SpeechDownload -> scope.launch {
                                    withContext(Dispatchers.IO) {
                                        runCatching { SpeechModelDownload.download(context) }
                                    }
                                }

                                ReadyAction.CreateScreen -> if (!creating) {
                                    creating = true
                                    scope.launch {
                                        try {
                                            // 建屏是一次 binder 往返, 而且是特权进程那边现场问合成器
                                            withContext(Dispatchers.IO) { VirtualScreen.create() }
                                        } finally {
                                            creating = false
                                        }
                                    }
                                }

                                ReadyAction.None -> Unit
                            }
                        },
                    )
                }
            }
        }
    }
}

/**
 * 卡片头: 一个环 + 两句
 *
 * 没有"这是什么"那种大标题: 这张卡的重点是"还差几步", 不是自我说明。环说比例, 第一句说还差几步,
 * 第二句说这五件的规矩 —— 后者是这张卡唯一需要解释的东西
 */
@Composable
private fun ReadyHead(done: Int, total: Int, missing: Int) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ReadyRing(done = done, total = total)
        Spacer(Modifier.width(UiSpacing.Large))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = if (missing > 0) {
                    stringResource(R.string.ready_remaining, missing)
                } else {
                    stringResource(R.string.ready_complete)
                },
                style = MiuixTheme.textStyles.title3,
            )
            Text(
                text = stringResource(R.string.ready_title),
                style = MiuixTheme.textStyles.body2,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
        }
    }
}

/**
 * 那个环: 做完几件 / 共几件
 *
 * 文字版"还差 3 步"标题里已经有了, 这里只画环 —— 环的作用是让"离做完还有多远"一眼可见, 不是再报一遍数。
 * 弧长用 [animateFloatAsState] 跟随完成数, 所以办完一件时它是**转过去**的, 不是跳过去的
 */
@Composable
private fun ReadyRing(done: Int, total: Int, modifier: Modifier = Modifier) {
    val target = if (total <= 0) 0f else done.toFloat() / total
    val sweep by animateFloatAsState(
        targetValue = target,
        animationSpec = tween(durationMillis = RingMillis, easing = FastOutSlowInEasing),
        label = "ready-ring",
    )
    val track = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(alpha = 0.25f)
    val fill = MiuixTheme.colorScheme.primary
    Canvas(modifier = modifier.size(RingSize)) {
        val stroke = 3.dp.toPx()
        // 笔画的圆心在半径内侧一半, 否则画出来的环会被裁掉一半线宽
        val inset = stroke / 2
        val arcSize = Size(size.width - stroke, size.height - stroke)
        val topLeft = Offset(inset, inset)
        drawArc(
            color = track,
            startAngle = -90f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = topLeft,
            size = arcSize,
            style = Stroke(width = stroke, cap = StrokeCap.Round),
        )
        // 0 的时候不画: Round 笔帽在顶上会留一个小圆点, 看着像"已经做完了一点"
        if (sweep > 0.001f) {
            drawArc(
                color = fill,
                startAngle = -90f,
                sweepAngle = 360f * sweep,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
        }
    }
}

/**
 * 体检表里的一行: 节点、名称、现在什么样、以及一条**一直占着位**的进度槽
 *
 * 两个动效: 首次进来按 [index] 依次淡入, 以及**刚做完时弹一下** —— 后者只在 false→true 那一次触发,
 * 不是"做完的项一直在抖"
 *
 * 进度槽与右侧百分比格在所有状态下都占着位置: 开始下载时那一行不该长高, 整张卡也不该跟着重排
 */
@Composable
private fun ReadyRow(
    step: ReadyStep,
    index: Int,
    last: Boolean,
    modifier: Modifier = Modifier,
) {
    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        try {
            // 差开一点, 五行才有"依次"的样子; 间隔比单行动画短, 五行串起来不超过 500ms
            delay(index * RowStaggerMillis)
            enter.animateTo(1f, tween(durationMillis = RowEnterMillis, easing = FastOutSlowInEasing))
        } finally {
            // 被打断 (行提前离开组合) 时直接补到 1: 否则这一行永远停在半透明上
            if (enter.value < 1f) enter.snapTo(1f)
        }
    }

    val pop = remember { Animatable(1f) }
    // 上一次看到的值。初值取当前值: 一进来就已经做完的项不该弹, 只有"当着你的面做完"才弹
    var wasDone by remember { mutableStateOf(step.state == ReadyState.DONE) }
    LaunchedEffect(step.state) {
        val now = step.state == ReadyState.DONE
        if (now && !wasDone) {
            pop.animateTo(PopScale, tween(durationMillis = 120))
            pop.animateTo(
                1f,
                spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
            )
        }
        wasDone = now
    }

    val colors = MiuixTheme.colorScheme
    val dim = colors.onSurface.copy(alpha = 0.28f)
    val rail = if (step.state == ReadyState.DONE) colors.primary.copy(alpha = 0.45f) else dim
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = RowMinHeight)
            // 轨道画在行自己身上: 行知道自己多高, 于是"从节点到行底"这条线不用去量外面的布局。
            // 上一行画到自己的底, 这一行再从顶画到节点上缘 —— 两段接得上, 靠中间的节点看是一条线
            .drawBehind {
                val x = NodeCenterX.toPx()
                val stroke = 2.dp.toPx()
                if (index > 0) {
                    drawLine(
                        color = rail,
                        start = Offset(x, 0f),
                        end = Offset(x, (NodeCenterY - NodeRadius - 2.dp).toPx()),
                        strokeWidth = stroke,
                        cap = StrokeCap.Round,
                    )
                }
                if (last) return@drawBehind
                drawLine(
                    color = rail,
                    start = Offset(x, (NodeCenterY + NodeRadius + 2.dp).toPx()),
                    end = Offset(x, size.height),
                    strokeWidth = stroke,
                    cap = StrokeCap.Round,
                )
            }
            .graphicsLayer {
                alpha = enter.value
                scaleX = pop.value
                scaleY = pop.value
            },
    ) {
        // 节点槽: 固定的一格, 四种状态都画在这里, 换状态不会挤动右边的字
        Canvas(
            modifier = Modifier
                .width(NodeSlotWidth)
                .height(NodeCenterY + NodeRadius + 2.dp),
        ) {
            drawStepNode(
                state = step.state,
                progress = step.progress,
                accent = colors.primary,
                onAccent = colors.surface,
                dim = dim,
                error = colors.error,
            )
        }
        Spacer(Modifier.width(NodeGap))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = step.title,
                style = MiuixTheme.textStyles.body1,
                color = colors.onSurface,
            )
            Text(
                text = step.detail,
                style = MiuixTheme.textStyles.body2,
                color = if (step.state == ReadyState.FAILED) {
                    colors.error
                } else {
                    colors.onSurfaceVariantSummary
                },
            )
            // 进度槽: 一直占着这三 dp, 只有下载中才画东西
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp)
                    .height(NodeBarHeight),
            ) {
                if (step.state == ReadyState.RUNNING) {
                    ReadyBar(progress = step.progress, modifier = Modifier.fillMaxSize())
                }
            }
        }
        // 百分比格: 定宽, 只有下载中才有字 —— 出现与消失都不重排这一行
        Box(
            modifier = Modifier
                .width(PercentSlotWidth)
                .padding(top = 2.dp),
        ) {
            if (step.state == ReadyState.RUNNING) {
                Text(
                    text = stringResource(R.string.ready_percent, (step.progress * 100).toInt()),
                    style = MiuixTheme.textStyles.footnote1,
                    color = colors.primary,
                )
            }
        }
    }
}

/** 节点: 做完的打勾, 下载中的走进度弧, 失败的描一圈错误色, 没办的只留一道浅圈 */
private fun DrawScope.drawStepNode(
    state: ReadyState,
    progress: Float,
    accent: Color,
    onAccent: Color,
    dim: Color,
    error: Color,
) {
    val center = Offset(NodeCenterX.toPx(), NodeCenterY.toPx())
    val radius = NodeRadius.toPx()
    val stroke = 2.dp.toPx()
    when (state) {
        ReadyState.DONE -> {
            // 填实的一颗 + 一道勾: 勾是画的, 不用 emoji —— emoji 的字重与基线都不跟主题走
            drawCircle(color = accent, radius = radius, center = center)
            val mark = Path().apply {
                moveTo(center.x - radius * 0.44f, center.y)
                lineTo(center.x - radius * 0.10f, center.y + radius * 0.36f)
                lineTo(center.x + radius * 0.46f, center.y - radius * 0.38f)
            }
            drawPath(
                path = mark,
                // 勾的颜色取 surface 而不是写死白: 深色主题下 primary 是亮色, 亮色勾会糊在上面
                color = onAccent,
                style = Stroke(width = 1.7.dp.toPx(), cap = StrokeCap.Round),
            )
        }

        ReadyState.RUNNING -> {
            drawCircle(color = dim, radius = radius - stroke / 2, center = center, style = Stroke(stroke))
            if (progress > 0.001f) {
                drawArc(
                    color = accent,
                    startAngle = -90f,
                    sweepAngle = 360f * progress.coerceIn(0f, 1f),
                    useCenter = false,
                    topLeft = Offset(center.x - radius + stroke / 2, center.y - radius + stroke / 2),
                    size = Size((radius - stroke / 2) * 2, (radius - stroke / 2) * 2),
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
            }
        }

        ReadyState.FAILED -> {
            drawCircle(color = error, radius = radius - stroke / 2, center = center, style = Stroke(stroke))
            // 中间一道横杠: 与"打勾"同一套笔画语言, 但不假装它成了
            drawLine(
                color = error,
                start = Offset(center.x - radius * 0.4f, center.y),
                end = Offset(center.x + radius * 0.4f, center.y),
                strokeWidth = 1.7.dp.toPx(),
                cap = StrokeCap.Round,
            )
        }

        ReadyState.TODO -> drawCircle(
            color = dim,
            radius = radius - stroke / 2,
            center = center,
            style = Stroke(stroke),
        )
    }
}

/** 细的确定进度条: 轨道是暗的, 走的那一段是主题色, 600ms 追一次 (不是转圈) */
@Composable
private fun ReadyBar(progress: Float, modifier: Modifier = Modifier) {
    val sweep by animateFloatAsState(
        targetValue = progress.coerceIn(0f, 1f),
        animationSpec = tween(durationMillis = RingMillis, easing = FastOutSlowInEasing),
        label = "ready-bar",
    )
    val track = MiuixTheme.colorScheme.onSurface.copy(alpha = 0.12f)
    val fill = MiuixTheme.colorScheme.primary
    Canvas(modifier = modifier) {
        val height = size.height
        val radius = CornerRadius(height / 2)
        drawRoundRect(color = track, size = size, cornerRadius = radius)
        if (sweep > 0.001f) {
            drawRoundRect(
                color = fill,
                size = Size(size.width * sweep, height),
                cornerRadius = radius,
            )
        }
    }
}

/**
 * 卡片最下面那块: 只给"下一步该做的那一件"
 *
 * 形态是设置页那种**圆角矩形**, 不是主色实心按钮 —— 这一块是"点一下办掉", 不是"快买"。下载中它不换
 * 位置、不换高度, 只把同一块方框当成进度条用 (底色按比例从左往右长), 所以开始下载时整张卡不重排
 */
@Composable
private fun ReadyActionRow(
    next: ReadyStep?,
    enabled: Boolean,
    onAction: (ReadyAction) -> Unit,
) {
    val colors = MiuixTheme.colorScheme
    val running = next?.state == ReadyState.RUNNING
    val failed = next?.state == ReadyState.FAILED
    val label = when {
        next == null -> stringResource(R.string.ready_complete)
        running -> stringResource(R.string.ready_action_running, (next.progress * 100).toInt())
        next.action == ReadyAction.Connect -> stringResource(R.string.ready_action_connect)
        next.action == ReadyAction.Accessibility -> stringResource(R.string.ready_action_accessibility)
        next.action == ReadyAction.CreateScreen -> stringResource(R.string.ready_action_screen)
        // 只有模型那两件有"重试"这一说; 通道与无障碍失败还是那一句原话
        failed -> stringResource(R.string.ready_action_retry, next.title)
        else -> stringResource(R.string.ready_action_download, next.title)
    }
    // 右边那串字是**这一步要花多少**: 唤醒词 5.3 MB, 语音 240 MB —— 别让人按下去才知道
    val hint = when {
        next == null || running -> ""
        next.action == ReadyAction.WakeDownload || next.action == ReadyAction.SpeechDownload ->
            stringResource(R.string.ready_mb, "%.1f".format(next.bytes / 1024.0 / 1024.0))

        else -> ""
    }
    val clickable = next != null && !running && enabled
    val accent = colors.primary
    val shape = RoundedCornerShape(16.dp)
    val fill by animateFloatAsState(
        targetValue = if (running) next?.progress ?: 0f else 0f,
        animationSpec = tween(durationMillis = RingMillis, easing = FastOutSlowInEasing),
        label = "ready-action",
    )
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = UiSpacing.Large)
            .clip(shape)
            .background(accent.copy(alpha = if (running) 0.10f else 0.06f))
            .border(
                width = 1.dp,
                color = accent.copy(
                    alpha = when {
                        running -> 0.25f
                        clickable -> 0.45f
                        else -> 0.16f
                    },
                ),
                shape = shape,
            ),
    ) {
        // 下载中这块方框就是进度条: 底色按比例长, 位置与高度一点不动
        if (running) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fill.coerceIn(0f, 1f))
                    .height(ActionHeight)
                    .background(accent.copy(alpha = 0.16f)),
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = ActionHeight)
                .then(
                    if (clickable) {
                        Modifier.clickable(role = Role.Button) { next?.let { onAction(it.action) } }
                    } else {
                        Modifier
                    },
                )
                .padding(horizontal = UiSpacing.Large, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = label,
                style = MiuixTheme.textStyles.body1,
                color = when {
                    running || clickable -> accent
                    else -> colors.onSurfaceVariantSummary
                },
            )
            Spacer(Modifier.weight(1f))
            if (hint.isNotEmpty()) {
                Text(
                    text = hint,
                    style = MiuixTheme.textStyles.footnote1,
                    color = colors.onSurfaceVariantSummary,
                )
            }
        }
    }
}

/** 下载器的 phase → 卡片的状态。IDLE 时再看一眼磁盘: 下好了却没走 refresh 的那一次也算数 */
private fun wakeState(phase: WakeWordDownload.Phase, present: Boolean): ReadyState = when (phase) {
    WakeWordDownload.Phase.DOWNLOADING -> ReadyState.RUNNING
    WakeWordDownload.Phase.FAILED -> ReadyState.FAILED
    WakeWordDownload.Phase.READY -> ReadyState.DONE
    WakeWordDownload.Phase.IDLE -> if (present) ReadyState.DONE else ReadyState.TODO
}

/** 语音模型那一套同义的 phase */
private fun speechState(phase: SpeechModelDownload.Phase, present: Boolean): ReadyState = when (phase) {
    SpeechModelDownload.Phase.DOWNLOADING -> ReadyState.RUNNING
    SpeechModelDownload.Phase.FAILED -> ReadyState.FAILED
    SpeechModelDownload.Phase.READY -> ReadyState.DONE
    SpeechModelDownload.Phase.IDLE -> if (present) ReadyState.DONE else ReadyState.TODO
}

/**
 * 模型那一行的第二句: 下没下、下了多少、没下成是什么原因
 *
 * MB 都按**这一件要下多少**算, 不按"已经下到第几个文件": 人在这一行只想知道"还要等多少"
 */
@Composable
private fun modelDetail(
    downloading: Boolean,
    failed: Boolean,
    present: Boolean,
    bytes: Long,
    received: Long,
    total: Long,
    reason: String,
): String = when {
    downloading -> stringResource(
        R.string.ready_model_downloading,
        "%.1f".format(received / 1024.0 / 1024.0),
        "%.1f".format((if (total > 0L) total else bytes) / 1024.0 / 1024.0),
    )

    failed -> stringResource(R.string.ready_model_failed, reason)
    present -> stringResource(R.string.ready_model_ready, "%.1f".format(bytes / 1024.0 / 1024.0))
    else -> stringResource(R.string.ready_model_missing, "%.1f".format(bytes / 1024.0 / 1024.0))
}

/** 收了多少 / 这一趟总共多少, 落在 0..1; 还没开始就报 0 */
private fun fraction(received: Long, total: Long): Float =
    if (total <= 0L) 0f else (received.toFloat() / total.toFloat()).coerceIn(0f, 1f)

/** 体检表里的一行: 状态、名称、现在什么样、要花多少 */
private data class ReadyStep(
    val state: ReadyState,
    val title: String,
    val detail: String,
    val progress: Float = 0f,
    val action: ReadyAction = ReadyAction.None,
    /** 这一件要下多少字节 (只有模型那两件有) */
    val bytes: Long = 0L,
)

/** 四档状态: 没办 / 正在下 / 做完了 / 试过没成 */
private enum class ReadyState { TODO, RUNNING, DONE, FAILED }

/** 点一下办掉的那件事: 每一项只有一件, 走的是各自现成的入口 */
private enum class ReadyAction { None, Connect, Accessibility, WakeDownload, SpeechDownload, CreateScreen }

/** 环的直径。与标题那一行同高 */
private val RingSize = 40.dp

/** 节点那一格的宽度 */
private val NodeSlotWidth = 16.dp

/** 节点圆心离行顶多远 (与标题那一行的中线对齐) */
private val NodeCenterY = 9.dp

/** 节点圆心在槽里的横向位置 */
private val NodeCenterX = 5.dp

/** 节点半径 */
private val NodeRadius = 5.dp

/** 节点与文字的间距 */
private val NodeGap = 12.dp

/** 进度槽的高度: 一直在, 只有下载中才画 */
private val NodeBarHeight = 3.dp

/** 右侧百分比那一格的宽度 (定宽, 出现与消失都不重排) */
private val PercentSlotWidth = 40.dp

/** 一行至少这么高: 节点、两行字与进度槽都在里面, 也不挤 */
private val RowMinHeight = 56.dp

/** 最下面那块方框的高度: 44dp 是触控下限, 这里留到 50 */
private val ActionHeight = 50.dp

/** 做完那一下弹到多大 */
private const val PopScale = 1.06f

/** 整张卡入场 */
private const val AppearMillis = 280

/** 整张卡淡出 */
private const val LeaveMillis = 220

/** 单行的入场 */
private const val RowEnterMillis = 220

/** 相邻两行开始淡入的间隔 */
private const val RowStaggerMillis = 90L

/** 环与进度条追一次用多久 */
private const val RingMillis = 600

/** 全绿之后卡片多停多久, 让最后那道勾看得见 */
private const val LingerMillis = 900L
