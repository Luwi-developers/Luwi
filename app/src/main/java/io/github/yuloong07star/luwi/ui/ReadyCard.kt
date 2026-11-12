/*
 * Hallmark · component: ready-card · genre: modern-minimal · theme: luwi-miuix
 * states: default · running(带确定进度) · done · failed · 锁住(下一件还点不动) · reading(读状态)
 * contrast: 颜色全部取 MiuixTheme.colorScheme, 没有写死色值; 可点的方框 >= 50dp
 * structure: 阶梯 (四件依赖排成一条竖轨 + 四个节点), 装进一个**居中的对话框**
 * placement: 首启自动弹一次 / 设置页「检查所需依赖」那一行随时再弹 (2026-11-04 主人 #1)
 */
package io.github.yuloong07star.luwi.ui

import android.content.Context
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.channel.AccessibilitySetting
import io.github.yuloong07star.luwi.channel.ChannelSetting
import io.github.yuloong07star.luwi.channel.Funnel
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
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme

/**
 * 「开始使用」: 第一次装完之后还差什么 —— **一张居中的对话框** (2026-11-04 主人 #1 / #2)
 *
 * **这不是教程, 是体检表**, 而且是一张**有先后**的体检表。第一次打开应用的人不知道"特权通道"是什么,
 * 也不知道它跟"能不能用"有什么关系; 但"还差 3 步"和每一项后面那个按钮是他看得懂的。所以这里只做三件事:
 * 说清还差几件, 每一件现在什么样, 点一下把它办掉
 *
 * **结构**: 四件按依赖顺序排成一条竖轨 (特权通道 → 无障碍 → 唤醒模型 → 语音模型), 每件是一个
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
 * **为什么改成对话框**: 它原来内嵌在两处 (启动页底部一块、设置页「外观」下面一个 item), 都在页面的
 * 下半截, 而四件依赖排成一条竖轨之后比一屏还高 —— "还差几步"总有一半在屏幕外。对话框自己居中、自己
 * 滚动, 而且进退都不牵动页面布局 (那两个内嵌的挂载点因此都撤掉了, 见 [ReadyPrompt] 与设置页那一行)
 *
 * **虚拟屏那一件只显示状态, 不再给按钮** (2026-11-04 主人 #3): 建屏是"用起来之后自然会发现"的事,
 * 不该是这张体检表上的最后一道 CTA。所以 [ReadyActionRow] 只在**四件可操作的事**里挑下一步
 *
 * 动效只干一件事: **让人看懂"这是一串有先后的事"**。五行依次淡入 (每行差 90ms, 顺序即依赖顺序),
 * 某一行刚变成做完时弹一下, 下载中的那一行用确定进度 (节点环 + 细条 + 百分比), 不是转圈。除了那个环
 * 与下载进度, 没有别的东西在动, 也没有循环动画
 *
 * 关掉对话框不丢任何状态: 两个下载器的进度是它们自己的 Compose 状态, 窗关了照样在下, 再打开就接上
 */
@Composable
internal fun ReadyCardDialog(onDismiss: () -> Unit, onReport: () -> Unit) {
    // 第二个窗 (2026-11-07 主人: "在开机引导里再加上选择权限, 弹出第二个权限小窗")
    //
    // 为什么是第二个窗而不是在这一窗里换内容: 权限那一段是设置页现成的那一份 ([PermissionsItems]),
    // 十几行, 与四件依赖挤在同一张卡里会把"还差几步"埋掉; 而它也不该被"体检"的语气绑住 —— 想开哪
    // 个开哪个, 开完关掉就回到体检表
    var permissions by remember { mutableStateOf(false) }
    // 竖轨上那个节点办过没有 (2026-11-07 主人: "完成后那个节点要变蓝表示完成")。**关掉那一窗才算办过**
    // —— 点开又立刻点空白关掉也是一个完整的动作, 但"打开中"不该先亮蓝: 那会让人以为已经做完了
    val context = LocalContext.current
    var permissionsSeen by remember { mutableStateOf(PermissionsSeen.read(context)) }
    Dialog(
        // 点空白、按返回键两条路都能关: 这不是"必须答了才能用"的告示, 是一张随时能再打开的体检表
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        val scrim = remember { MutableInteractionSource() }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.4f))
                .clickable(interactionSource = scrim, indication = null) { onDismiss() },
            // **居中** (2026-11-04 主人 #2: 不要放底部)
            contentAlignment = Alignment.Center,
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 28.dp)
                    // 卡片自己吃掉点击: 点在里面不算"点空白"
                    .clickable(interactionSource = scrim, indication = null) {},
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        // 四件依赖 + 那颗按钮在窄屏上比一屏还高: 卡片封在屏幕的 72%, 内容自己滚
                        .heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.72f).dp)
                        .verticalScroll(rememberScrollState())
                        .padding(UiSpacing.Large),
                ) {
                    ReadyCardBody(
                        permissionsDone = permissionsSeen,
                        onPermissions = { permissions = true },
                        onReport = onReport,
                    )
                    TextButton(
                        text = stringResource(R.string.ready_dialog_close),
                        onClick = onDismiss,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = UiSpacing.Medium),
                    )
                }
            }
        }
    }
    // 窗口按创建次序叠, 后建的在上面 —— 这一窗压在体检表之上, 关掉它体检表还在原处
    if (permissions) {
        ReadyPermissionsDialog(
            onDismiss = {
                permissions = false
                // 关掉算办过: 节点变蓝, 而且这个记号跨启动 (见 [PermissionsSeen])
                PermissionsSeen.mark(context)
                permissionsSeen = true
            },
        )
    }
    // 自检这一窗由调用方在体检表关掉之后再开: 平台 Dialog 里再叠一层 Overlay 窗会被它自己的窗口吃掉
    // (2026-11-10 在 k40 上点不开, 就是这么发现的)
}

/**
 * 第二个窗: 权限 (2026-11-07 主人: "里面有设置里权限版块的内容, 用户可点击打开")
 *
 * 正文整个是设置页「权限」那一段的 [PermissionsItems] —— **一份实现两处显示**, 不另抄一遍: 那一份
 * 每行自己知道怎么要 (运行时的弹框 / 特殊访问的系统页), 也自己在 ON_RESUME 时重读状态, 所以从系统页
 * 回来这一行就变成新的, 不需要这里再写一套刷新
 */
@Composable
internal fun ReadyPermissionsDialog(onDismiss: () -> Unit) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        val scrim = remember { MutableInteractionSource() }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.4f))
                .clickable(interactionSource = scrim, indication = null) { onDismiss() },
            contentAlignment = Alignment.Center,
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .clickable(interactionSource = scrim, indication = null) {},
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        // 十七个能力比一屏高得多: 卡片封在屏幕的 78%
                        .heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.78f).dp),
                ) {
                    // 标题固定在顶上: 滚到第十七项时还要知道这一窗是什么
                    Text(
                        text = stringResource(R.string.ready_permissions),
                        style = MiuixTheme.textStyles.title3,
                        modifier = Modifier.padding(
                            start = UiSpacing.Large,
                            end = UiSpacing.Large,
                            top = UiSpacing.Large,
                        ),
                    )
                    // 只有这一截滚。**「完成」不在里面** (2026-11-07 主人: "完成按钮要一直放下方"):
                    // 它原来跟着内容滚, 滚到一半就看不见了
                    //
                    // `fill = false` 是这一处唯一要小心的地方: 内容少时卡片该矮 (屏幕 78% 只是上限),
                    // 内容多时这一截才吃满剩下的高度。全填满会让四项的机器上也挂一张占大半屏的空卡
                    Column(
                        modifier = Modifier
                            .weight(1f, fill = false)
                            .verticalScroll(rememberScrollState())
                            // 滚到底时最后一行与「完成」之间留一点: 不加这一截, 那一行会紧贴着按钮上沿,
                            // 看着像被按钮压住了半行 (实测就是这样)
                            .padding(bottom = UiSpacing.Small),
                    ) {
                        PermissionsItems()
                    }
                    // 固定底栏。它在滚区**之外**, 所以内容滚到底时最后一行停在它上面, 不会被它盖住 ——
                    // 这也是为什么这里不是叠一层 Box: 叠起来就要自己算按钮高度去给内容让位, 算错了就是
                    // 最后一项点不到
                    TextButton(
                        text = stringResource(R.string.ready_permissions_close),
                        onClick = onDismiss,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = UiSpacing.Large)
                            .padding(top = UiSpacing.Small, bottom = UiSpacing.Large),
                    )
                }
            }
        }
    }
}

/**
 * 「选择权限」这一行办过没有 (2026-11-07 主人: "完成后那个节点要变蓝表示完成")
 *
 * 与 [ReadyDialogSeen] 同一个写法, 但语义不同: 那个记"首启弹过一次", 这个记"权限那一窗关过一次"。
 * 记在偏好里而不是进程里, 因为它是"这台机器上我处理过这件事"的事实 —— 重启后应当还是蓝的
 */
internal object PermissionsSeen {

    private const val STORE = "luwi"

    /** 关过一次 (落偏好, 跨启动) */
    private const val KEY = "ready-permissions-seen"

    fun read(context: Context): Boolean = prefs(context).getBoolean(KEY, false)

    fun mark(context: Context) {
        runCatching { prefs(context).edit().putBoolean(KEY, true).apply() }
    }

    private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
}

/**
 * 首启自动弹的那一次 (2026-11-04 主人 #1①)
 *
 * 一辈子只自动弹一次 ([ReadyDialogSeen] 落 `ready-dialog-seen`), 弹不弹只看"看过没有" —— 这一窗是
 * 第一次进应用的那一眼, 那四件齐不齐是它要**说**的事, 不是它该不该出现的前提。之后要看就走设置页
 * 那一行「检查所需依赖」。判那一步仍在 IO 上做, 因为它要读偏好
 */
@Composable
internal fun ReadyPrompt() {
    val context = LocalContext.current
    var open by remember { mutableStateOf(false) }
    var doctor by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (withContext(Dispatchers.IO) { ReadyDialogSeen.claim(context) }) open = true
    }
    if (open) {
        ReadyCardDialog(
            onDismiss = { open = false },
            // 自检先把体检表关掉: 两层窗叠在一起点不开 (见 [ReadyCardDialog] 末尾那句)
            onReport = {
                open = false
                doctor = true
            },
        )
    }
    if (doctor) DoctorDialog(onDismissRequest = { doctor = false })
}

/**
 * 首启那一弹的账: 弹没弹过 (`ready-dialog-seen`) 与"这一次打开弹过没有"
 *
 * 与 [ModelSetup] / [BundledPluginNotice] 同一个写法: 跨启动的记号落 `luwi` 偏好, 进程里再记一个
 * 布尔, 于是 Activity 重建 / 转屏不会又弹一遍。**写下记号那一刻就算弹过了** —— 进程中途被杀也不会
 * 下一次又冒出来
 */
internal object ReadyDialogSeen {

    private const val STORE = "luwi"

    /** 自动弹过没有 (落偏好, 跨启动) */
    private const val SEEN = "ready-dialog-seen"

    /** 这一次打开应用里已经弹过 (Activity 重建不重弹, 进程死了自然归零) */
    @Volatile
    private var promptedThisRun = false

    /** 这一次打开要不要弹; 返回 true 时记号已经写下了 */
    fun claim(context: Context): Boolean {
        if (promptedThisRun) return false
        if (prefs(context).getBoolean(SEEN, false)) return false
        promptedThisRun = true
        runCatching { prefs(context).edit().putBoolean(SEEN, true).apply() }
        return true
    }

    private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
}

/** 对话框里那一坨: 一个环 + 四件依赖 + 下一步该按的那一颗按钮 */
@Composable
private fun ReadyCardBody(permissionsDone: Boolean, onPermissions: () -> Unit, onReport: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    // 这两个都是 Compose 状态: 通道与无障碍由各自的 Setting 在 worker 线程上填 —— 所以这里不需要轮询,
    // 也不需要自己记住上一次读到什么
    val channel = ChannelSetting.state
    val accessibility = AccessibilitySetting.state

    LaunchedEffect(Unit) {
        // 打开时读一次。四件事都不在画帧的线程上做事: 通道与无障碍要起几个 settings/cmd 子进程;
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
    )

    // 进度**把「选择权限」也算进去** (2026-11-07 主人: "没有完成权限时却显示准备完毕") —— 它虽然
    // 不是 ReadyStep (没有四档状态), 但它确实有一件事没办, 而顶部那句"全部就绪"是给整张卡下的
    // 结论: 权限没看过就报就绪, 等于把最后一步藏起来了。所以分母是四件 + 这一件
    val done = steps.count { it.state == ReadyState.DONE } + if (permissionsDone) 1 else 0
    val total = steps.size + 1
    val missing = total - done

    // 过门记录 (cf33e06): 这张卡是唯一同时看得见这几项的地方, 埋点跟着它走就不必再挂别的 watcher。
    // 只记前两件 —— 四件里只有通道与无障碍在「五道门」那张表上有位置, 两个模型是随时可删可下的东西,
    // 不是"装完必经的一道门"。Funnel.mark 自己只写第一次, 所以这里每跑一次都不会重复写盘
    LaunchedEffect(channel?.connected, accessibility?.healthy) {
        if (channel?.connected == true) Funnel.mark(context, Funnel.Gate.CHANNEL)
        if (accessibility?.healthy == true) Funnel.mark(context, Funnel.Gate.ACCESSIBILITY)
    }

    // **只给下一步该做的那一件**: 四件各给一个按钮不行 —— 用户会按顺序全按一遍, 而第二件往后
    // 按下去只会报"特权通道还没通"
    val next = steps.firstOrNull { it.state != ReadyState.DONE && it.action != ReadyAction.None }

    if (channel == null && accessibility == null) {
        // 还没读到就不摆四行: 两个 state 的初值都是 null, 否则刚打开会闪一下"还差 4 步", 一帧后变少
        Text(
            text = stringResource(R.string.ready_reading),
            style = MiuixTheme.textStyles.body2,
            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
        )
        return
    }

    ReadyHead(done = done, total = total, missing = missing)

    steps.forEachIndexed { index, step ->
        // 用下标当身份: 四件的顺序本来就是固定的依赖顺序, 下标就是这个顺序本身
        ReadyRow(
            step = step,
            index = index,
            // 轨道要接着往下走到「选择权限」那个节点, 所以末行不再收口
            last = false,
            modifier = Modifier.padding(top = if (index == 0) UiSpacing.Large else 0.dp),
        )
    }

    // 竖轨上的第五个节点: 「选择权限」 (2026-11-07 主人: "也放在那个竖向进度条的下方, 到选择权限时
    // 用户点击即可弹出窗口")。形态与上面四件一样 (同一个 x 上的节点 + 同一条轨道), 但它**不是**
    // ReadyStep —— 没有状态、不进环的分母、也不参与"还差几步": 它是一行的入口, 点开是设置页
    // 「权限」那一段本身, 关掉就回到这张体检表
    ReadyLinkRow(
        title = stringResource(R.string.ready_permissions),
        detail = stringResource(R.string.ready_permissions_summary),
        index = steps.size,
        done = permissionsDone,
        onClick = onPermissions,
    )

    // 没有"下一步"时整块不画 (四件都办完就是这样): 不该留一块空框
    if (next != null) {
        ReadyActionRow(
            next = next,
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

                    ReadyAction.None -> Unit
                }
            },
        )
    }

    // 修不好也得有个出口: 这一行点开就是八项读数 + 一个 "要不要发" 的岔路
    // (窗由 [ReadyCardDialog] 叠在上面, 不能在这张表里再开一个 Dialog)
    Text(
        text = stringResource(R.string.doctor_entry_from_guide),
        style = MiuixTheme.textStyles.footnote1,
        color = MiuixTheme.colorScheme.primary,
        modifier = Modifier
            .padding(top = UiSpacing.Medium)
            .clip(RoundedCornerShape(8.dp))
            .clickable { onReport() },
    )
}

/**
 * 卡片头: 一个环 + 两句
 *
 * 没有"这是什么"那种大标题: 这张卡的重点是"还差几步", 不是自我说明。环说比例, 第一句说还差几步,
 * 第二句说这四件的规矩 —— 后者是这张卡唯一需要解释的东西
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
/**
 * 竖轨上的一个入口行: 有节点、有轨道、整行可点, 但没有状态
 *
 * **为什么单开一个函数而不复用 [ReadyRow]**: [ReadyRow] 那一行的身份是 `ReadyStep` (四档状态、
 * 进度弧、失败色、做完弹一下), 而这一行没有状态可报 —— 强行塞一个假的 `ReadyState` 会让环的分母、
 * "还差几步"、以及下载进度那几条逻辑全部跟着它算。所以两条共用的只有几何: 同一个 x 上的节点、同一
 * 条轨道、同一套入场动效
 *
 * 节点的画法是一条圆环加一个右箭头, 意思是"这一行会带你到别处", 与上面四件的勾/圈/环区分开
 */
@Composable
private fun ReadyLinkRow(
    title: String,
    detail: String,
    index: Int,
    done: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        try {
            delay(index * RowStaggerMillis)
            enter.animateTo(1f, tween(durationMillis = RowEnterMillis, easing = FastOutSlowInEasing))
        } finally {
            if (enter.value < 1f) enter.snapTo(1f)
        }
    }

    val colors = MiuixTheme.colorScheme
    // 角色映射 (2026-11-07 按 ui skill 重定, 主人同日: "选择权限颜色不对"):
    //
    //   未办 → 与四件**同一档** (浅圈), 已办 → 与四件**同一档** (实心主色 + 勾)。这一行不另画第五种
    //          节点: 2026-11-07 主人先嫌"灰得像禁用", 试过"主色描边 + 箭头"之后又定成"保持一致" ——
    //          一串同款圆圈里插一个箭头, 反而它最突兀
    //
    // 文字不跟着变: 标题始终 onSurface, 副标题始终淡化一档 —— 变化的只有节点与轨道, 否则一行字在
    // "办过"前后换色, 会在滚动的竖轨里显得像另一项
    val accent = colors.primary
    val dim = colors.onSurface.copy(alpha = 0.28f)
    // 轨道与 [ReadyRow] 同一个口径 (办过的那一段跟着主色走), 末行也只画到节点为止
    val rail = if (done) accent.copy(alpha = 0.45f) else dim
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = RowMinHeight)
            .clickable(onClick = onClick)
            .drawBehind {
                val x = NodeCenterX.toPx()
                // 上一行画到自己的底, 这一行再从顶画到节点上缘 —— 两段接得上
                drawLine(
                    color = rail,
                    start = Offset(x, 0f),
                    end = Offset(x, (NodeCenterY - NodeRadius - 2.dp).toPx()),
                    strokeWidth = 2.dp.toPx(),
                    cap = StrokeCap.Round,
                )
            }
            .graphicsLayer { alpha = enter.value },
    ) {
        Canvas(
            modifier = Modifier
                .width(NodeSlotWidth)
                .height(NodeCenterY + NodeRadius + 2.dp),
        ) {
            // **与四件完全一致** (2026-11-07 主人: "选择权限未完成时应该也和其它的一样, 保持一致"):
            // 没办就是四件那种浅圈, 办过就是实心勾 —— 这一行不另发明第五种节点画法。原来那个"主色
            // 描边 + 箭头"是想用箭头当"可点"的暗号, 但四件里没有谁的节点长得像箭头, 于是在一串同款
            // 圆圈里它反而最突兀; 而"这一行能点"本来就由整行的点击区与小字说明承担
            drawStepNode(
                state = if (done) ReadyState.DONE else ReadyState.TODO,
                progress = 1f,
                accent = accent,
                onAccent = colors.surface,
                dim = dim,
                error = colors.error,
            )
        }
        Spacer(Modifier.width(NodeGap))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MiuixTheme.textStyles.body1,
                color = colors.onSurface,
            )
            Text(
                text = detail,
                style = MiuixTheme.textStyles.body2,
                color = colors.onSurface.copy(alpha = 0.5f),
            )
        }
    }
}

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
 *
 * **虚拟屏那一件没有这一块** (2026-11-04 主人 #3): 调用方只会在四件可操作的事里挑, 所以这里的 [next]
 * 一定是"能办的", 不再有"没有下一步"那一档文案
 */
@Composable
private fun ReadyActionRow(next: ReadyStep, onAction: (ReadyAction) -> Unit) {
    val colors = MiuixTheme.colorScheme
    val running = next.state == ReadyState.RUNNING
    val failed = next.state == ReadyState.FAILED
    val label = when {
        running -> stringResource(R.string.ready_action_running, (next.progress * 100).toInt())
        next.action == ReadyAction.Connect -> stringResource(R.string.ready_action_connect)
        next.action == ReadyAction.Accessibility -> stringResource(R.string.ready_action_accessibility)
        // 只有模型那两件有"重试"这一说; 通道与无障碍失败还是那一句原话
        failed -> stringResource(R.string.ready_action_retry, next.title)
        else -> stringResource(R.string.ready_action_download, next.title)
    }
    // 右边那串字是**这一步要花多少**: 唤醒词 5.3 MB, 语音 240 MB —— 别让人按下去才知道
    val hint = when {
        running -> ""
        next.action == ReadyAction.WakeDownload || next.action == ReadyAction.SpeechDownload ->
            stringResource(R.string.ready_mb, "%.1f".format(next.bytes / 1024.0 / 1024.0))

        else -> ""
    }
    val clickable = !running
    val accent = colors.primary
    val shape = RoundedCornerShape(16.dp)
    val fill by animateFloatAsState(
        targetValue = if (running) next.progress else 0f,
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
                        Modifier.clickable(role = Role.Button) { onAction(next.action) }
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

/**
 * 点一下办掉的那件事: 每一项只有一件, 走的是各自现成的入口
 *
 * **没有 CreateScreen 这一档了** (2026-11-04 主人 #3): 虚拟屏那一件只显示状态, 不给按钮
 */
private enum class ReadyAction { None, Connect, Accessibility, WakeDownload, SpeechDownload }

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

/** 单行的入场 */
private const val RowEnterMillis = 220

/** 相邻两行开始淡入的间隔 */
private const val RowStaggerMillis = 90L

/** 环与进度条追一次用多久 */
private const val RingMillis = 600
