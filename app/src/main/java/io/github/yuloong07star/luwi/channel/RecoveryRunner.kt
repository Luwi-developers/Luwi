package io.github.yuloong07star.luwi.channel

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * 「一键恢复」的顺序执行器: 通道 → 无障碍 → 屏
 *
 * 这个顺序是**依赖顺序**, 与体检表那三行一模一样, 因为后两件事都要特权进程: 开无障碍是让特权进程写
 * 一条 `Settings.Secure`, 建屏是让它在合成器上开一块 display。通道不在时那两件事连"试一试"都做不到,
 * 所以通道那一栏不通就直接停, 不去假装后面的步骤还在跑
 *
 * 谁去做这件事: 只有**通道**和**无障碍**这两步可能停在一个人身上 —— 无线调试的配对、Shizuku 那个
 * App 自己的启动按钮、系统无障碍页那个开关, 系统都不许第三方代按。所以 [run] 返回的是"办完了"或者
 * "停在哪儿", 而不是一个笼统的失败: 调用方要能说清是去 Shizuku 还是去无障碍页, 而不是把人往设置
 * 里一丢
 *
 * 屏那一步是纯自动的, 所以它不参与"需要人"的判断
 */
internal object RecoveryRunner {

    private const val TAG = "LwRecover"

    /** 等通道自己连上。Shizuku 那次权限弹窗是人的反应速度, 所以这个数不能按 binder 往返来定 */
    private const val CHANNEL_BUDGET_MS = 15_000L

    /** 开无障碍那边自带 3 秒 settle ([AccessibilitySetting.SETTLE_BUDGET_MS]), 再留一截读状态的余量 */
    private const val ACCESSIBILITY_BUDGET_MS = 8_000L

    /** 轮询间隔。两头都是人几乎看不见的等待, 200ms 足够, 也不会把主线程敲满 */
    private const val POLL_MS = 200L

    /** 先让它安静一会儿再问"还在忙吗": 刚点的按钮在头 500ms 里说"没在忙"只是因为它还没开始 */
    private const val SETTLE_GRACE_MS = 500L

    /** 官方 Shizuku 的包名。Sui 装上的是同一个 App, 所以这个名字对两种装法都成立 */
    private const val SHIZUKU_PACKAGE = "moe.shizuku.privileged.api"

    /**
     * 按依赖顺序把能办的办掉
     *
     * @param onStep 每一步开始时回调一次, 都在主线程上: 卡片要拿它来换按钮上那句话
     * @return [RecoveryOutcome.Done] 或停在[哪一步][RecoveryOutcome.NeedsUser]
     */
    suspend fun run(context: Context, onStep: (RecoveryStep) -> Unit): RecoveryOutcome {
        onStep(RecoveryStep.CHANNEL)
        if (!repairChannel()) return RecoveryOutcome.NeedsUser(RecoveryStep.CHANNEL)

        onStep(RecoveryStep.ACCESSIBILITY)
        if (!repairAccessibility()) return RecoveryOutcome.NeedsUser(RecoveryStep.ACCESSIBILITY)

        onStep(RecoveryStep.SCREEN)
        repairScreen(context)
        // 五道门里最值得记的一道: 到这儿的人曾经掉过, 并且自己爬回来了
        Funnel.mark(context, Funnel.Gate.RECOVERED)
        return RecoveryOutcome.Done
    }

    /**
     * Shizuku 那个 App 现在在不在 (binder 活着)
     *
     * 不在的时候 App 拉不起它 —— 那一步只能人去做。判断用通道自己已经读好的路由表, 不再单独 ping
     * 一次: 两个答案来自同一处, 就不会出现"卡片说能连、按钮却说去装 Shizuku"的分歧
     */
    fun channelAppRunning(): Boolean = ChannelSetting.routes.any { route ->
        route.backend == RemoteBackend.SHIZUKU && route.available
    }

    /**
     * 把 System 的无障碍页打开
     *
     * 与设置页那个 [accessibilitySettingsIntent] 是同一条 intent, 这里是它唯一还需要跨包用的地方
     */
    fun openAccessibilitySettings(context: Context) {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
            .onFailure { Log.w(TAG, "could not open the accessibility settings", it) }
    }

    /**
     * 把 Shizuku 那个 App 打开
     *
     * 只有一种情况会走到这里: 它的 binder 已经死了 (手机重启之后基本都是这一种), 而启动它需要它自己
     * 那个按钮。返回 false 表示这台机器上根本没有这个 App (走的是 root 那条路) —— 调用方据此不必
     * 再提示"去点一下"
     */
    fun openChannelApp(context: Context): Boolean {
        val intent = context.packageManager.getLaunchIntentForPackage(SHIZUKU_PACKAGE)
            ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching { context.startActivity(intent) }.isSuccess
    }

    /**
     * 通道: 已经通就直接过, 否则拉一次并等它自己连上
     *
     * [ChannelSetting.connect] 在 binder 活着且已授权时是**静默**的; 没授权时它会弹 Shizuku 自己那
     * 个授权框 —— 那也是人点的, 但它是系统弹窗, 不是我们要把人送到别的页面去
     */
    private suspend fun repairChannel(): Boolean {
        if (ChannelSetting.state?.connected == true) return true
        ChannelSetting.connect()
        var waited = 0L
        while (waited < CHANNEL_BUDGET_MS) {
            delay(POLL_MS)
            waited += POLL_MS
            if (ChannelSetting.state?.connected == true) return true
            // 它已经给了答案 (没在忙) 而且答案是"没连上": 再等下去只是等一个不会来的结果
            if (!ChannelSetting.working && waited > SETTLE_GRACE_MS) break
        }
        // 再读一次真状态: 上面那个 break 可能是"刚放弃", 而通道在放弃的同一秒连上了
        ChannelSetting.refresh()
        delay(POLL_MS * 2)
        return ChannelSetting.state?.connected == true
    }

    /**
     * 无障碍: 通道通了它就能全自动, 因为写入是由特权进程做的
     *
     * 停在这里只可能是**写不进去** (受系统限制的那几种, `AccessibilityState.reason()` 会说清是哪一层),
     * 那时候人只能去系统页自己按一下
     */
    private suspend fun repairAccessibility(): Boolean {
        if (AccessibilitySetting.state?.healthy == true) return true
        AccessibilitySetting.set(true)
        var waited = 0L
        while (waited < ACCESSIBILITY_BUDGET_MS) {
            delay(POLL_MS)
            waited += POLL_MS
            if (AccessibilitySetting.state?.healthy == true) return true
            if (!AccessibilitySetting.working && waited > SETTLE_GRACE_MS) break
        }
        AccessibilitySetting.refreshState()
        delay(POLL_MS * 2)
        return AccessibilitySetting.state?.healthy == true
    }

    /**
     * 屏: 全自动, 用记住的那块尺寸建回去
     *
     * 建不出来也不算"需要人": 屏这一步没有"人的动作"可做, 它只会因为通道没了而失败, 而通道是第一步
     * 的事。失败原因已经进了 [VirtualScreen.lastError], 卡片下一次读状态就会把它显示出来
     */
    private suspend fun repairScreen(context: Context) {
        if (VirtualScreen.screens.isNotEmpty()) return
        val shape = RecoveryStore.screen(context)
        val made = try {
            // 建屏是一次 binder 往返加现场问合成器, 不能落在画帧的线程上
            withContext(Dispatchers.IO) {
                VirtualScreen.create(
                    width = shape?.width ?: 0,
                    height = shape?.height ?: 0,
                    dpi = shape?.dpi ?: 0,
                )
            }
        } catch (error: Throwable) {
            Log.w(TAG, "rebuilding the virtual screen failed", error)
            null
        }
        if (made != null) RecoveryStore.remember(context, made)
    }
}

/** 一件要做的事, 顺序就是它们依赖的顺序 */
internal enum class RecoveryStep { CHANNEL, ACCESSIBILITY, SCREEN }

/** 一次恢复停在哪 */
internal sealed interface RecoveryOutcome {
    /** 三项都办完了 */
    data object Done : RecoveryOutcome

    /** 卡在 [step]: 这一步要人去做, 做完回来自动接着跑 */
    data class NeedsUser(val step: RecoveryStep) : RecoveryOutcome
}
