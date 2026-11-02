package io.github.yuloong07star.luwi.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.channel.AccessibilitySetting
import io.github.yuloong07star.luwi.channel.ChannelSetting
import io.github.yuloong07star.luwi.channel.VirtualScreen
import io.github.yuloong07star.luwi.constants.UiSpacing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text

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
 */
@Composable
internal fun ReadyCard() {
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
    // 还没读到就不画: 两个 state 的初值都是 null, 否则刚进页面会闪一下"还差 3 项", 一帧后变少
    if (channel == null && accessibility == null) return
    // 全绿也不画。这张卡存在的唯一理由是"还差东西"
    if (missing == 0) return

    // Card 包在这里, 而不是让调用方 `Card { ReadyCard() }`: 上面两个 return 得连卡片一起躲开,
    // 否则全绿之后留下的是一张有底色、有内边距、里面什么都没有的空卡
    Card {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(UiSpacing.Large),
        ) {
            Text(text = stringResource(R.string.settings_ready_title, steps.size - missing, steps.size))
            steps.forEach { step ->
                Text(
                    text = stringResource(
                        if (step.done) R.string.settings_ready_row_done else R.string.settings_ready_row_todo,
                        step.title,
                        step.detail,
                    ),
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

/** 体检表里的一行: 做没做完、叫什么、现在什么样 */
private data class ReadyStep(val done: Boolean, val title: String, val detail: String)
