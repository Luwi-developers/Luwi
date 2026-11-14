package io.github.yuloong07star.luwi.ui

import android.Manifest
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.scaffolds.InputDialog
import io.github.yuloong07star.luwi.automation.AutomationRule
import io.github.yuloong07star.luwi.constants.UiSpacing
import io.github.yuloong07star.luwi.scaffolds.ArrowSlider
import io.github.yuloong07star.luwi.scaffolds.LazyColumn
import io.github.yuloong07star.luwi.scaffolds.SectionSmallTitle
import io.github.yuloong07star.luwi.scaffolds.SuperTextField
import io.github.yuloong07star.luwi.tool.RouterChecks
import io.github.yuloong07star.luwi.tool.SimSetting
import io.github.yuloong07star.luwi.util.Capability
import io.github.yuloong07star.luwi.util.PermissionGate
import kotlin.math.roundToInt
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.overlay.OverlayDialog
import top.yukonga.miuix.kmp.preference.ArrowPreference
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.preference.SwitchPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.textStyles

/** 设置页那四个入口的顺序 (一组 = 小标题 + 卡片, 两个 item) */
private val SIM_GROUPS = listOf("wake", "send", "router", "sticker")

/** 门户那两颗「设置」多出来两组, 摆在最前面; 加组只改这两张表, 别在 item 里数魔法数 */
private val ACTIVITY_GROUPS = listOf("explore", "proactive") + SIM_GROUPS

/**
 * 门户面板进来的**可见组** (2026-11-14 主人: "活动板块除探索和判断里已有的, 剩下缺少的都加到判断的设置里, 包括表情包数量")
 *
 * - 探索面板: 只有 `explore` 一组 (她每天自己看手机那一摊)
 * - 判断面板: **活动里除探索之外的全归它** —— 主动对话 / 主动程度 / 开口节奏与分条 / 判断层 / 表情
 *   (面板上那六行读数在 `wake` + `router` 里, 而"说几条、一张表情多大"也是她开口那套的一部分)
 * - 设置页 (`withActivity = false`): 仍是原来四组, 一个字节不改
 * - 认不出来的词: 也退"活动里除探索"这一份 —— 门户只有那两颗按钮, 不必处理失败分支
 */
private fun visibleGroups(focus: String, withActivity: Boolean): List<String> = when {
    !withActivity -> SIM_GROUPS
    focus.trim() == "explore" -> listOf("explore")
    else -> ACTIVITY_GROUPS.filter { it != "explore" }
}

/**
 * 「更多设置」那个弹窗 (2026-11-07 晚, 活动段末尾那一行点开的)
 *
 * 主人这一条要的是"功能与 QQ 桥接里的二代仿真一致" —— 所以这里把 `socialV2` 里那些**时机与
 * 节奏**搬了过来 (多久唤醒一次 / 沉睡前等多久 / 一次说几条 / 条间多长 / 判断层那几个阈值)。
 * **2026-11-10 去群味**: Luwi 只有单聊, 群里那 14 项 (什么算一次唤醒 / 等多久 / 带多少历史)
 * 在单聊里没有语义, 已整段撤掉 (方案 `docs/Luwi-更多设置去群味-方案-2026-11-10.md`), 这一页只剩
 * 真有读者的四段 —— 主动程度 / 开口节奏与分条 / 判断层 / 表情
 *
 * 而**唤醒之后看什么**不在这里写: 那是探索每天自己加进 `router.json` 的 `checks`
 * (主人: "检测的内容应由探索时加上"), 这一坨只把它们列出来、给一个开关与一个「忘掉」
 *
 * **形状是弹窗** (主人 2026-11-07 晚: "改成像选择权限那样的弹窗"): 一页参数不值得占一次跳转,
 * 与插件能力那张同一个壳 —— `OverlayDialog` + 一坨可滚动的 + 底部一个按钮
 *
 * 落 `$DSH_HOME/lw/sim.json` (见 [SimSetting]); 改完立刻生效, 宿主下一次判断就按新的来
 *
 * **2026-11-13: 一份实现, 三个入口** (主人: "判断和探索面板的设置按钮…加在打开唤醒/刷新 的右侧")
 * —— 门户判断面板 / 门户探索面板 / 设置 → 活动 → 更多设置 都调这里。**不另开第二个弹窗壳**:
 * 抄第二份参数页就是灾难
 *
 * **2026-11-14: 门户那两颗各管半边** —— 探索面板只摆 `explore`; 判断面板摆活动里剩下的全部
 * (主动对话 / 主动程度 / 开口节奏与分条 / 判断层 / 表情); 不再按 [focus] 滚到某一组, 从头看
 * @param focus 门户那两颗按钮给的词 (`explore` / `router`; 设置页是 `top`), 决定摆哪半边
 * @param withActivity 门户进来时为真: 摆活动板块 (探索 / 主动对话 两组本来只在门户侧出现)
 * @param onDismiss 关窗
 */
@Composable
fun SimSettingsDialog(
    onDismiss: () -> Unit,
    focus: String = "top",
    withActivity: Boolean = false,
) {
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    var plan by remember { mutableStateOf(SimSetting.plan(context)) }
    var checks by remember { mutableStateOf(RouterChecks.list(context)) }
    var message by remember { mutableStateOf<String?>(null) }
    var editingFrom by remember { mutableStateOf(false) }
    var editingTo by remember { mutableStateOf(false) }
    // 可见组由 focus 决定 (2026-11-14): 探索面板只看探索, 判断面板看活动里剩下的全部
    val visible = visibleGroups(focus, withActivity)
    // 2026-11-14: 不再按 focus 滚到某一组 —— 判断面板现在有五组, 一进来就滚到最后那组
    // ("判断层") 会让人以为只剩一组; 从头看, 顺序就是"主动对话 -> 主动程度 -> 分条 -> 判断层 -> 表情"
    val listState = rememberLazyListState()

    fun commit(next: SimSetting.Plan = plan) {
        plan = next
        message = if (SimSetting.save(context, next)) {
            context.getString(R.string.settings_sim_saved)
        } else {
            context.getString(R.string.settings_sim_failed)
        }
    }

    // 形状照页面上那几个"选一选"的弹窗 (插件能力那一张): 标题 + 一句说明 + 可滚动的那一坨 + 底部按钮
    // 2026-11-07 晚主人: "更多设置, 改成像选择权限那样的弹窗" —— 它是一页参数, 不值得占一次跳转
    OverlayDialog(
        show = true,
        title = stringResource(R.string.settings_sim_title),
        summary = stringResource(R.string.settings_sim_note),
        defaultWindowInsetsPadding = false,
        onDismissRequest = onDismiss,
    ) {
        val screenHeight = LocalConfiguration.current.screenHeightDp
        Column(
            modifier = Modifier
                .fillMaxWidth()
                // 那一句说明已经在弹窗的 summary 上, 所以这一坨只放条目; 高度留出底部按钮与它的间距,
                // 0.72 屏会把按钮挤到内容上去 (2026-11-07 真机上量到)
                //
                // 2026-11-13: 门户进来时多两组 (探索 / 主动对话), 五个小标题 + 六张卡在原高度里太挤,
                // 那一侧给 0.66 屏 (设置页那四个入口仍是 0.58, 一个像素没动)
                // 2026-11-14: 门户那两颗「设置」各自只看自己那半 (1~2 组), 高度跟着收
                .height((screenHeight * when {
                    !withActivity -> 0.58f
                    visible.size <= 2 -> 0.52f
                    else -> 0.66f
                }).dp),
        ) {
            LazyColumn(
                contentPadding = PaddingValues(0.dp),
                limitLandscapeWidth = false,
                state = listState,
            ) {

            // 门户那两个入口多出来的两组 (2026-11-13): **搬的是设置页那一份 composable**, 不复制
            // —— `ExploreItems` / `ProactiveItems` 本来就只写各自的文件, 这里只是把它们换个壳摆出来
            // 可见性由 `visible` 决定 (2026-11-14): 组内缩进没跟着挪 —— 这几百行 whitespace
            // 会把这次 review 淹掉, 而 `if` 不改变 LazyListScope 接收者, `item` 照样解析得到
            if (visible.contains("explore")) {
                item { SectionSmallTitle(stringResource(R.string.settings_activity_daily)) }
                item {
                    Card {
                        Column {
                            ExploreItems()
                        }
                    }
                }
            }
            if (visible.contains("proactive")) {
                item { SectionSmallTitle(stringResource(R.string.settings_activity_speak)) }
                item {
                    Card {
                        Column {
                            ProactiveItems()
                        }
                    }
                }
            }

            /* ── 一、主动程度 ───────────────────────────────────────────── */
            if (visible.contains("wake")) {
            item { SectionSmallTitle(stringResource(R.string.settings_sim_wake_group)) }
            item {
                Card {
                    Column {
                        OverlayDropdownPreference(
                            title = stringResource(R.string.settings_sim_mode),
                            summary = stringResource(R.string.settings_sim_mode_summary),
                            items = listOf(
                                stringResource(R.string.settings_sim_mode_diving),
                                stringResource(R.string.settings_sim_mode_active),
                            ),
                            selectedIndex = if (plan.wake.active) 1 else 0,
                            onSelectedIndexChange = { index ->
                                commit(
                                    plan.copy(
                                        wake = plan.wake.copy(
                                            mode = if (index == 1) SimSetting.MODE_ACTIVE else SimSetting.MODE_DIVING,
                                        ),
                                    ),
                                )
                            },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_gap_min),
                            summary = stringResource(R.string.settings_sim_gap_min_summary, plan.wake.gapMinMs / 60_000),
                            value = (plan.wake.gapMinMs / 60_000).toInt(),
                            range = 1..360,
                            unit = stringResource(R.string.settings_sim_unit_minutes),
                            onChange = { plan = plan.copy(wake = plan.wake.copy(gapMinMs = it * 60_000L)) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_gap_max),
                            summary = stringResource(R.string.settings_sim_gap_max_summary, plan.wake.gapMaxMs / 60_000),
                            value = (plan.wake.gapMaxMs / 60_000).toInt(),
                            range = 1..360,
                            unit = stringResource(R.string.settings_sim_unit_minutes),
                            onChange = { plan = plan.copy(wake = plan.wake.copy(gapMaxMs = it * 60_000L)) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_pre_sleep),
                            summary = stringResource(
                                R.string.settings_sim_pre_sleep_summary,
                                plan.wake.preSleepWaitMs / 60_000,
                            ),
                            value = (plan.wake.preSleepWaitMs / 60_000).toInt(),
                            range = 0..60,
                            unit = stringResource(R.string.settings_sim_unit_minutes),
                            onChange = { plan = plan.copy(wake = plan.wake.copy(preSleepWaitMs = it * 60_000L)) },
                            onCommit = { commit() },
                        )
                        SwitchPreference(
                            title = stringResource(R.string.settings_sim_quiet),
                            summary = stringResource(R.string.settings_sim_quiet_summary),
                            checked = plan.wake.quietEnabled,
                            onCheckedChange = { on ->
                                commit(plan.copy(wake = plan.wake.copy(quietEnabled = on)))
                            },
                        )
                        TwoTimes(
                            from = plan.wake.quietFrom,
                            to = plan.wake.quietTo,
                            onFrom = {
                                haptic.contextClick()
                                editingFrom = true
                            },
                            onTo = {
                                haptic.contextClick()
                                editingTo = true
                            },
                        )
                    }
                }
            }

            }
            /* ── 二、开口节奏与分条 ─────────────────────────────────────── */
            if (visible.contains("send")) {
            item { SectionSmallTitle(stringResource(R.string.settings_sim_send_group)) }
            item {
                Card {
                    Column {
                        SwitchPreference(
                            title = stringResource(R.string.settings_sim_burst),
                            summary = stringResource(R.string.settings_sim_burst_summary),
                            checked = plan.send.burstEnabled,
                            onCheckedChange = { on ->
                                commit(plan.copy(send = plan.send.copy(burstEnabled = on)))
                            },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_burst_max),
                            summary = stringResource(R.string.settings_sim_burst_max_summary, plan.send.burstMaxMessages),
                            value = plan.send.burstMaxMessages,
                            range = 1..6,
                            unit = stringResource(R.string.settings_sim_unit_messages),
                            onChange = { plan = plan.copy(send = plan.send.copy(burstMaxMessages = it)) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_send_gap_min),
                            summary = stringResource(
                                R.string.settings_sim_send_gap_min_summary,
                                plan.send.gapMinMs / 1000f,
                            ),
                            value = (plan.send.gapMinMs / 100).toInt(),
                            range = 2..600,
                            step = 5,
                            display = { it / 10f },
                            unit = stringResource(R.string.settings_sim_unit_seconds),
                            onChange = { plan = plan.copy(send = plan.send.copy(gapMinMs = it * 100L)) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_send_gap_max),
                            summary = stringResource(
                                R.string.settings_sim_send_gap_max_summary,
                                plan.send.gapMaxMs / 1000f,
                            ),
                            value = (plan.send.gapMaxMs / 100).toInt(),
                            range = 2..600,
                            step = 5,
                            display = { it / 10f },
                            unit = stringResource(R.string.settings_sim_unit_seconds),
                            onChange = { plan = plan.copy(send = plan.send.copy(gapMaxMs = it * 100L)) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_per_char),
                            summary = stringResource(R.string.settings_sim_per_char_summary, plan.send.perCharMs),
                            value = plan.send.perCharMs.toInt(),
                            range = 0..200,
                            step = 5,
                            unit = stringResource(R.string.settings_sim_unit_ms),
                            onChange = { plan = plan.copy(send = plan.send.copy(perCharMs = it.toLong())) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_long_gap),
                            summary = stringResource(
                                R.string.settings_sim_long_gap_summary,
                                (plan.send.longGapProbability * 100).roundToInt(),
                            ),
                            value = (plan.send.longGapProbability * 100).roundToInt(),
                            range = 0..100,
                            unit = "%",
                            onChange = { plan = plan.copy(send = plan.send.copy(longGapProbability = it / 100f)) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_long_gap_min),
                            summary = stringResource(
                                R.string.settings_sim_long_gap_min_summary,
                                plan.send.longGapMinMs / 1000f,
                            ),
                            value = (plan.send.longGapMinMs / 100).toInt(),
                            range = 2..600,
                            step = 5,
                            display = { it / 10f },
                            unit = stringResource(R.string.settings_sim_unit_seconds),
                            onChange = { plan = plan.copy(send = plan.send.copy(longGapMinMs = it * 100L)) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_long_gap_max),
                            summary = stringResource(
                                R.string.settings_sim_long_gap_max_summary,
                                plan.send.longGapMaxMs / 1000f,
                            ),
                            value = (plan.send.longGapMaxMs / 100).toInt(),
                            range = 2..600,
                            step = 5,
                            display = { it / 10f },
                            unit = stringResource(R.string.settings_sim_unit_seconds),
                            onChange = { plan = plan.copy(send = plan.send.copy(longGapMaxMs = it * 100L)) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_max_chars),
                            summary = stringResource(R.string.settings_sim_max_chars_summary, plan.send.maxMessageChars),
                            value = plan.send.maxMessageChars,
                            range = 60..2000,
                            step = 20,
                            unit = stringResource(R.string.settings_sim_unit_chars),
                            onChange = { plan = plan.copy(send = plan.send.copy(maxMessageChars = it)) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_send_per_minute),
                            summary = stringResource(
                                R.string.settings_sim_send_per_minute_summary,
                                plan.send.maxPerMinute,
                            ),
                            value = plan.send.maxPerMinute,
                            range = 1..60,
                            unit = stringResource(R.string.settings_sim_unit_messages),
                            onChange = { plan = plan.copy(send = plan.send.copy(maxPerMinute = it)) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_send_per_hour),
                            summary = stringResource(
                                R.string.settings_sim_send_per_hour_summary,
                                plan.send.maxPerHour,
                            ),
                            value = plan.send.maxPerHour,
                            range = 1..600,
                            unit = stringResource(R.string.settings_sim_unit_messages),
                            onChange = { plan = plan.copy(send = plan.send.copy(maxPerHour = it)) },
                            onCommit = { commit() },
                        )
                    }
                }
            }

            }
            /* ── 三、判断层: 阈值这一半归这里, 盯什么归探索 ──────────────── */
            if (visible.contains("router")) {
            item { SectionSmallTitle(stringResource(R.string.settings_sim_router_group)) }
            item {
                Card {
                    Column {
                        // 游戏多久算久 / 记着的事提前几天提 (2026-11-10 主人: "那两个设置应该由探索或主动对话时
                        // 自己决定, 而不需要加在设置里"): 那两把尺子已经不在这里, 她走 `lw_router op=rules` 或
                        // 探索收尾的 `rules` 自己定 —— 这一页只剩"多久问一次"这一类由人拍的数
                        NumberRow(
                            title = stringResource(R.string.settings_sim_router_cooldown),
                            summary = stringResource(
                                R.string.settings_sim_router_cooldown_summary,
                                plan.router.cooldownMs / 60_000,
                            ),
                            value = (plan.router.cooldownMs / 60_000).toInt(),
                            range = 1..1440,
                            unit = stringResource(R.string.settings_sim_unit_minutes),
                            onChange = { plan = plan.copy(router = plan.router.copy(cooldownMs = it * 60_000L)) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_router_chance),
                            summary = stringResource(
                                R.string.settings_sim_router_chance_summary,
                                (plan.router.chatChance * 100).roundToInt(),
                            ),
                            value = (plan.router.chatChance * 100).roundToInt(),
                            range = 0..100,
                            unit = "%",
                            onChange = { plan = plan.copy(router = plan.router.copy(chatChance = it / 100f)) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_router_chat_after),
                            summary = stringResource(
                                R.string.settings_sim_router_chat_after_summary,
                                plan.router.chatAfterMs / 3_600_000,
                            ),
                            value = (plan.router.chatAfterMs / 3_600_000).toInt(),
                            range = 1..48,
                            unit = stringResource(R.string.settings_sim_unit_hours),
                            onChange = { plan = plan.copy(router = plan.router.copy(chatAfterMs = it * 3_600_000L)) },
                            onCommit = { commit() },
                        )
                        NumberRow(
                            title = stringResource(R.string.settings_sim_router_ignored),
                            summary = stringResource(
                                R.string.settings_sim_router_ignored_summary,
                                plan.router.ignoredCooldownMs / 3_600_000,
                            ),
                            value = (plan.router.ignoredCooldownMs / 3_600_000).toInt(),
                            range = 1..168,
                            unit = stringResource(R.string.settings_sim_unit_hours),
                            onChange = {
                                plan = plan.copy(router = plan.router.copy(ignoredCooldownMs = it * 3_600_000L))
                            },
                            onCommit = { commit() },
                        )
                    }
                }
            }
            item {
                Card {
                    Column {
                        Note(stringResource(R.string.settings_sim_checks_note))
                        // 事件型检测项要日历 (2026-11-10): 读不到时那几条永远不会命中, 而"到点没响"与
                        // "压根没有这一条"在界面上长得一样 —— 所以这里明说一句, 不猜
                        if (checks.any { it.kind == "event" }) {
                            val noCalendar = remember(checks) {
                                PermissionGate.refusal(
                                    context,
                                    Capability(
                                        name = "日历",
                                        why = "事件型检测项",
                                        permissions = listOf(Manifest.permission.READ_CALENDAR),
                                    ),
                                ) != null
                            }
                            if (noCalendar) Note(stringResource(R.string.settings_sim_checks_calendar))
                        }
                        if (checks.isEmpty()) {
                            Note(stringResource(R.string.settings_sim_checks_empty))
                        } else {
                            checks.forEach { one ->
                                SwitchPreference(
                                    title = one.what,
                                    summary = stringResource(
                                        R.string.settings_sim_checks_how,
                                        one.how,
                                        one.from ?: "—",
                                    ),
                                    checked = one.enabled,
                                    onCheckedChange = { on ->
                                        if (RouterChecks.setEnabled(context, one.id, on)) {
                                            checks = RouterChecks.list(context)
                                        } else {
                                            message = context.getString(R.string.settings_sim_failed)
                                        }
                                    },
                                )
                            }
                            checks.forEach { one ->
                                ArrowPreference(
                                    title = stringResource(R.string.settings_sim_checks_drop, one.what),
                                    summary = stringResource(R.string.settings_sim_checks_from, one.from ?: "—"),
                                    onClick = {
                                        haptic.contextClick()
                                        if (RouterChecks.drop(context, one.id)) {
                                            checks = RouterChecks.list(context)
                                            message = context.getString(R.string.settings_sim_checks_dropped)
                                        } else {
                                            message = context.getString(R.string.settings_sim_failed)
                                        }
                                    },
                                )
                            }
                        }
                    }
                }
            }

            }
            /* ── 四、表情 (2026-11-10, 主人: "加表情包图片上限设置") ──────── */
            if (visible.contains("sticker")) {
            item { SectionSmallTitle(stringResource(R.string.settings_sim_sticker_group)) }
            item {
                Card {
                    Column {
                        NumberRow(
                            title = stringResource(R.string.settings_sim_sticker_max),
                            summary = stringResource(
                                R.string.settings_sim_sticker_max_summary,
                                plan.sticker.maxMb,
                            ),
                            value = plan.sticker.maxMb,
                            range = SimSetting.STICKER_MB_RANGE,
                            unit = stringResource(R.string.settings_sim_unit_mb),
                            onChange = { plan = plan.copy(sticker = plan.sticker.copy(maxMb = it)) },
                            onCommit = { commit() },
                        )
                        // 张数那一条 (2026-11-10 主人: "表情包加上数量限制"): 两个写入方都按它拦
                        NumberRow(
                            title = stringResource(R.string.settings_sim_sticker_count),
                            summary = stringResource(
                                R.string.settings_sim_sticker_count_summary,
                                plan.sticker.maxCount,
                            ),
                            value = plan.sticker.maxCount,
                            range = SimSetting.STICKER_COUNT_RANGE,
                            step = 10,
                            unit = stringResource(R.string.settings_sim_unit_sheets),
                            onChange = { plan = plan.copy(sticker = plan.sticker.copy(maxCount = it)) },
                            onCommit = { commit() },
                        )
                        Note(stringResource(R.string.settings_sim_sticker_note))
                    }
                }
            }
            }

            message?.let { one ->
                item { Note(one) }
            }
        }
    }
    TextButton(
        text = stringResource(R.string.settings_sim_close),
        onClick = onDismiss,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = UiSpacing.Medium),
        colors = ButtonDefaults.textButtonColorsPrimary(),
    )
    }

    if (editingFrom) {
        TimeTextDialog(
            title = stringResource(R.string.settings_sim_quiet_from),
            initial = plan.wake.quietFrom,
            onDismiss = { editingFrom = false },
            onSave = { text ->
                editingFrom = false
                if (AutomationRule.minutesOf(text) == null) {
                    message = context.getString(R.string.settings_sim_quiet_bad)
                } else {
                    commit(plan.copy(wake = plan.wake.copy(quietFrom = text.trim())))
                }
            },
        )
    }
    if (editingTo) {
        TimeTextDialog(
            title = stringResource(R.string.settings_sim_quiet_to),
            initial = plan.wake.quietTo,
            onDismiss = { editingTo = false },
            onSave = { text ->
                editingTo = false
                if (AutomationRule.minutesOf(text) == null) {
                    message = context.getString(R.string.settings_sim_quiet_bad)
                } else {
                    commit(plan.copy(wake = plan.wake.copy(quietTo = text.trim())))
                }
            },
        )
    }
}

/**
 * 一个数字项: 滑块 + 手打 (照 `ExploreItems` 那一套)
 *
 * 拖动只改内存里的那一份, **松手才落盘** (见 [onCommit]) —— 每一帧写一次 `sim.json` 没有必要
 */
@Composable
private fun NumberRow(
    title: String,
    summary: String,
    value: Int,
    range: IntRange,
    onChange: (Int) -> Unit,
    onCommit: () -> Unit,
    unit: String = "",
    step: Int = 1,
    display: (Int) -> Float = { it.toFloat() },
) {
    ArrowSlider(
        title = title,
        summary = summary,
        value = display(value),
        onValueChange = { raw -> onChange(raw.roundToInt()) },
        valueRange = display(range.first)..display(range.last),
        // 档位只在小范围里画 (60 档以内), 大范围一律连续 —— 否则滑块上全是点, 一格一格的反而不好滑
        steps = run {
            val span = range.last - range.first
            if (step <= 1 || span / step > 40) 0 else (span / step) - 1
        },
        unit = unit,
        onValueChangeFinished = { onCommit() },
        // 手打那一档也得落盘 (2026-11-13 真机上量到: 只调 `onChange` 就只是改了内存里的那一份,
        // 关掉弹窗再打开又回到 30 —— 滑块"松手才落盘"那条对它不成立, 这一档没有"松手"这个动作)
        onInputConfirm = { text ->
            text.trim().toFloatOrNull()?.let {
                onChange(it.roundToInt())
                onCommit()
            }
        },
    )
}

/** 静默时段那两行 (起 / 止各一个可点的行) */
@Composable
private fun TwoTimes(from: String, to: String, onFrom: () -> Unit, onTo: () -> Unit) {
    ArrowPreference(
        title = stringResource(R.string.settings_sim_quiet_from),
        summary = from,
        onClick = onFrom,
    )
    ArrowPreference(
        title = stringResource(R.string.settings_sim_quiet_to),
        summary = to,
        onClick = onTo,
    )
}

/** 一段灰字 (页首说明、空态、落盘回执都走它) */
@Composable
private fun Note(text: String) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = UiSpacing.Large, vertical = UiSpacing.Small)) {
        Text(text = text, style = textStyles.footnote1, color = colorScheme.onSurfaceVariantActions)
    }
}

/** 一个小输入窗 (静默起止用): 只收 `HH:mm` 那种写法, 认不出来由调用方说一句 */
@Composable
private fun TimeTextDialog(
    title: String,
    initial: String,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    val haptic = LocalHapticFeedback.current
    InputDialog(
        show = true,
        title = title,
        summary = stringResource(R.string.settings_sim_quiet_hint),
        onDismissRequest = onDismiss,
    ) {
        var text by remember { mutableStateOf(initial) }
        SuperTextField(
            modifier = Modifier.padding(bottom = 16.dp),
            value = text,
            onValueChange = { text = it },
            label = "23:00",
        )
        Row(horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(
                text = stringResource(R.string.button_cancel),
                onClick = {
                    haptic.contextClick()
                    onDismiss()
                },
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(20.dp))
            TextButton(
                text = stringResource(R.string.settings_sim_save),
                onClick = {
                    haptic.confirm()
                    onSave(text)
                },
                modifier = Modifier.weight(1f),
            )
        }
    }
}
