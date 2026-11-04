package io.github.yuloong07star.luwi.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.channel.AccessibilitySetting
import io.github.yuloong07star.luwi.channel.ChannelSetting
import io.github.yuloong07star.luwi.channel.VirtualScreen
import io.github.yuloong07star.luwi.constants.UiSpacing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

/**
 * 「开始使用」: 第一次装完之后还差什么
 *
 * **这不是教程, 是体检表**。第一次打开这一页的人不知道"特权通道"是什么, 也不知道它跟"能不能用"有什么
 * 关系; 但"还差 2 项"和每一项后面那个按钮是他看得懂的。所以这里只做三件事: 说清还差几项, 每一项现在
 * 什么样, 点一下把它办掉
 *
 * 三项的顺序是**依赖顺序**, 不是重要性顺序: 无障碍要靠特权进程写 secure setting, 虚拟屏要靠特权进程
 * 建；所以上面那项没通, 下面那项的按钮就该是灰的 —— 先给他一个点得动的, 而不是一个点了报错的
 *
 * 全部到位时**整张卡不画**: 用了一周的人不该每次进设置都看见一页"你已经做完了"。判据只有一处在
 * [steps] 里, 卡片显不显示是它的副产物
 *
 * 动效只干一件事: **让人看懂"这是一串有先后的事"**。卡片从下方 12dp 滑上来, 三行依次淡入 (每行差
 * 90ms, 顺序即依赖顺序), 某一行刚变成做完时弹一下。除了右上角那个环, 没有别的东西在动, 也没有循环
 * 动画: 这张卡每次进页面只播一遍, 不抢"下一步按钮"的注意力
 *
 * 最后一件事做完时**多停 900ms**再淡出: 否则第三行刚打上勾, 卡片就没了, 那道勾谁也看不见。这个停留
 * 只发生在"当着你的面做完"的场景; 一进来就全绿的 (shown 还是 false) 照样一帧都不画
 */
@Composable
internal fun ReadyCard(modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    // 这三个都是 Compose 状态: 通道与无障碍由各自的 Setting 在 worker 线程上填, 屏列表由
    // [VirtualScreen] 直接改写 —— 所以这里不需要轮询, 也不需要自己记住上一次读到什么
    val channel = ChannelSetting.state
    val accessibility = AccessibilitySetting.state
    val screens = VirtualScreen.screens
    // 建屏不像连接和开无障碍那样自带 working: [VirtualScreen.create] 每次都新建一块, 不去重,
    // 所以按钮自己得挡住连点, 否则点三下就是三块屏
    var creating by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        // 进页面时读一次。两者都不在主线程上做事: 读一次要起几个 settings/cmd 子进程
        ChannelSetting.refresh()
        AccessibilitySetting.refreshState()
    }

    val steps = listOf(
        ReadyStep(
            done = channel?.connected == true,
            title = stringResource(R.string.settings_ready_channel),
            detail = when {
                channel == null -> stringResource(R.string.settings_ready_reading)
                channel.connected -> stringResource(
                    R.string.settings_ready_channel_ok,
                    channel.backend.orEmpty(),
                )
                else -> stringResource(R.string.settings_ready_channel_off)
            },
        ),
        ReadyStep(
            done = accessibility?.healthy == true,
            title = stringResource(R.string.settings_ready_accessibility),
            detail = when {
                accessibility == null -> stringResource(R.string.settings_ready_reading)
                accessibility.healthy -> stringResource(R.string.settings_ready_accessibility_ok)
                else -> stringResource(R.string.settings_ready_accessibility_off)
            },
        ),
        ReadyStep(
            done = screens.isNotEmpty(),
            title = stringResource(R.string.settings_ready_screen),
            detail = if (screens.isEmpty()) {
                stringResource(R.string.settings_ready_screen_off)
            } else {
                stringResource(R.string.settings_ready_screen_ok, screens.size)
            },
        ),
    )

    val missing = steps.count { !it.done }

    // 入场进度 0→1: 一次性, 不跟随状态刷新重播 (remember 跨重组保留, 只有真的离开这页再回来才重来)
    val appear = remember { Animatable(0f) }
    // 这张卡在这页上"露过面"没有。它决定全绿时是直接不画 (本来就没露过) 还是先亮一下再收
    var shown by remember { mutableStateOf(false) }
    // 正在收尾: 全绿了但还没淡出完。这个标志让下面的 return 暂时别把卡片抽走
    //
    // 它是**算出来的**, 不是在 [LaunchedEffect] 里置位的: 效果体要等这一帧组合结束才跑, 而 missing
    // 变 0 的那一刻就发生在组合里 —— 等到效果体再去置位, 中间那一帧已经按"全绿"把整棵子树抽掉了,
    // 卡片会闪一下再带着重新播的入场动画回来
    val lingering = missing == 0 && shown
    LaunchedEffect(missing) {
        if (missing > 0) {
            // 第一次进来 (或刚淡出过又缺东西了) 才播入场; 已经亮着的状态刷新不重播
            if (appear.value < 1f) {
                appear.animateTo(1f, tween(durationMillis = 280, easing = FastOutSlowInEasing))
            }
            shown = true
        } else if (shown) {
            // 最后一件事是当着面做完的: 让 3/3 亮一下, 再淡出
            delay(LingerMillis)
            appear.animateTo(0f, tween(durationMillis = 220, easing = FastOutSlowInEasing))
            shown = false
        }
    }

    // 还没读到就不画: 两个 state 的初值都是 null, 否则刚进页面会闪一下"还差 3 项", 一帧后变少
    if (channel == null && accessibility == null) return
    // 全绿也不画。这张卡存在的唯一理由是"还差东西"; 收尾中的那一小段除外
    if (missing == 0 && !lingering) return

    // Card 包在这里, 而不是让调用方 `Card { ReadyCard() }`: 上面两个 return 得连卡片一起躲开,
    // 否则全绿之后留下的是一张有底色、有内边距、里面什么都没有的空卡
    Card(
        modifier = modifier.graphicsLayer {
            alpha = appear.value
            // 从底下一路滑上来: 位移和 alpha 用同一条曲线, 看上去才像"同一块东西在动"
            translationY = (1f - appear.value) * 12.dp.toPx()
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(UiSpacing.Large),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.settings_ready_title, steps.size - missing, steps.size),
                    modifier = Modifier.weight(1f),
                )
                ReadyRing(done = steps.size - missing, total = steps.size)
            }

            steps.forEachIndexed { index, step ->
                // 用下标当身份: 三项的顺序本来就是固定的依赖顺序, 下标就是这个顺序本身
                ReadyRow(
                    step = step,
                    index = index,
                    modifier = Modifier.padding(top = UiSpacing.Medium),
                )
            }

            // 只给**下一步该做的那一件**一个按钮。三项各给一个按钮的话, 用户会按顺序全按一遍, 而第二、
            // 三个按下去只会报"特权通道还没通"
            when {
                channel?.connected != true -> Button(
                    onClick = { ChannelSetting.connect() },
                    enabled = !ChannelSetting.working,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = UiSpacing.Medium),
                ) {
                    Text(text = stringResource(R.string.settings_ready_connect))
                }

                accessibility?.healthy != true -> Button(
                    onClick = { AccessibilitySetting.set(true) },
                    enabled = !AccessibilitySetting.working,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = UiSpacing.Medium),
                ) {
                    Text(text = stringResource(R.string.settings_ready_turn_on))
                }

                screens.isEmpty() -> Button(
                    onClick = {
                        if (creating) return@Button
                        creating = true
                        scope.launch {
                            try {
                                // 建屏是一次 binder 往返, 而且是特权进程那边现场问合成器, 不能落在画帧的线程上
                                withContext(Dispatchers.IO) { VirtualScreen.create() }
                            } finally {
                                creating = false
                            }
                        }
                    },
                    enabled = !creating,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = UiSpacing.Medium),
                ) {
                    Text(text = stringResource(R.string.settings_ready_create))
                }
            }
        }
    }
}

/**
 * 右上角那个环: 做完几项 / 共几项
 *
 * 文字版"1 / 3"标题里已经有了, 这里只画环 —— 环的作用是让"离做完还有多远"一眼可见, 不是再报一遍数。
 * 弧长用 [animateFloatAsState] 跟随完成数, 所以办完一项时它是**转过去**的, 不是跳过去的
 */
@Composable
private fun ReadyRing(done: Int, total: Int, modifier: Modifier = Modifier) {
    val target = if (total <= 0) 0f else done.toFloat() / total
    val sweep by animateFloatAsState(
        targetValue = target,
        animationSpec = tween(durationMillis = 600, easing = FastOutSlowInEasing),
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
 * 体检表里的一行: 做没做完、叫什么、现在什么样
 *
 * 两个动效: 首次进来按 [index] 依次淡入, 以及**刚做完时弹一下** —— 后者只在 false→true 那一次触发,
 * 不是"做完的项一直在抖"
 */
@Composable
private fun ReadyRow(step: ReadyStep, index: Int, modifier: Modifier = Modifier) {
    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        // 差开一点, 三行才有"依次"的样子; 间隔比单行动画短, 三行串起来不超过 400ms
        delay(index * RowStaggerMillis)
        enter.animateTo(1f, tween(durationMillis = 220, easing = FastOutSlowInEasing))
    }

    val pop = remember { Animatable(1f) }
    // 上一次看到的值。初值取当前值: 一进来就已经做完的项不该弹, 只有"当着你的面做完"才弹
    var wasDone by remember { mutableStateOf(step.done) }
    LaunchedEffect(step.done) {
        if (step.done && !wasDone) {
            pop.animateTo(1.12f, tween(durationMillis = 120))
            pop.animateTo(
                1f,
                spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
            )
        }
        wasDone = step.done
    }

    Box(
        modifier = modifier.graphicsLayer {
            alpha = enter.value
            translationY = (1f - enter.value) * 10.dp.toPx()
            scaleX = pop.value
            scaleY = pop.value
        },
    ) {
        Text(
            text = stringResource(
                if (step.done) R.string.settings_ready_row_done else R.string.settings_ready_row_todo,
                step.title,
                step.detail,
            ),
        )
    }
}

/** 体检表里的一行: 做没做完、叫什么、现在什么样 */
private data class ReadyStep(val done: Boolean, val title: String, val detail: String)

/** 环的直径。和标题同一行, 比一行文字略高一点 */
private val RingSize = 22.dp

/** 相邻两行开始淡入的间隔 */
private const val RowStaggerMillis = 90L

/** 全绿之后卡片多停多久, 让最后那道勾看得见 */
private const val LingerMillis = 900L
