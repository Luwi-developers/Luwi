package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.os.SystemClock
import android.util.Log
import io.github.yuloong07star.luwi.automation.AutomationStore

/**
 * 设置页「定时对话」那一段的读数 (2.8.0 B4-c)
 *
 * 主人 2026-10-18 的口径: 主动对话从探索里拆开, 排期、规则、30 分钟闸各是一笔账, 设置页要把这三笔
 * 摆在一起, 但**不能每次进页面都重读一遍**: ⑫ 要求 30 s 内重复进来只刷新一次 UI —— 所以读数在
 * 这一层留一份, 30 s 之内再来就用这一份, 只在真的重读时打一行日志
 * (`LwSettings: settings schedule panel refreshed …`, 两行 reused 不算刷新)
 *
 * 这一份只是**读**: 排期改由 [ProactiveSchedule.save] 落盘, 规则正文仍归「自动指令」那一段;
 * [read] 的调用方在改完排期后调 [invalidate], 下一眼才看得到新值
 *
 * 时间窗口用单调时钟 ([SystemClock.uptimeMillis]) 而不是墙上时间: 主人把手机时间调一下不该让
 * "刚看过"变成"要重读", 也不该反过来
 */
internal object SchedulePanel {

    /** ⑫ 的去重窗口: 30 s 内两次进设置页只算一次刷新 */
    const val WINDOW_MS = 30_000L

    private const val TAG = "LwSettings"

    /** 一条自动指令在面板上的样子 (名字 + 条件摘要 + 开关) */
    data class RuleLine(val name: String, val summary: String, val enabled: Boolean)

    /** 一段时间的读数 (只给设置页看, 落不落盘都不影响排期) */
    data class Reading(
        /** 这一份是什么时候读的 (墙上时间, 只给"30 分钟闸现在开没开"用) */
        val at: Long,
        val proactive: ProactiveSchedule.Plan,
        /** 下一次主动对话 (关着 / 没有可用时刻就是 null) */
        val proactiveNext: Long?,
        /** 30 分钟闸上一笔是多少 (0 = 还没有主动投递) */
        val gateLastAt: Long,
        val gateSource: String?,
        /** 下一次探索 (关着就是 null) */
        val exploreNext: Long?,
        /** 探索上一次那一趟 */
        val exploreLast: ExploreSchedule.Last?,
        /** 自动指令 (读不出来的那几条不在这一列) */
        val rules: List<RuleLine>,
        /** 自动指令最近一次被拦下的那一行 (没有就是 null) */
        val autoBlocked: AutomationStore.Fired?,
    )

    private var cached: Reading? = null

    /** 上一次真读的时刻 (单调时钟; 0 = 还没读过) */
    private var readAtUptime = 0L

    /**
     * 该不该真的重读 (纯函数, 单测钉着)
     *
     * 正好 30 s 算"该读了" —— 与 [ProactiveGate] 那道 30 分钟闸同一个开闭口径
     */
    fun shouldRefresh(lastReadUptime: Long, nowUptime: Long): Boolean =
        lastReadUptime <= 0L || nowUptime - lastReadUptime >= WINDOW_MS

    /**
     * 现在这一段该显示什么 (30 s 内同一份)
     *
     * 日志只分两种: `refreshed` 是真读了一次 (计数就是它), `reused` 是窗口里没重读
     */
    fun read(context: Context): Reading = synchronized(this) {
        val now = SystemClock.uptimeMillis()
        val current = cached
        if (current != null && !shouldRefresh(readAtUptime, now)) {
            Log.i(TAG, "settings schedule panel reused: inside the 30 s window")
            return current
        }
        val fresh = snapshot(context.applicationContext, System.currentTimeMillis())
        cached = fresh
        readAtUptime = now
        Log.i(
            TAG,
            "settings schedule panel refreshed: explore nextTrigger=${fresh.exploreNext}"
                + " last=${fresh.exploreLast?.at} proactive nextTrigger=${fresh.proactiveNext}"
                + " rules=${fresh.rules.size}",
        )
        fresh
    }

    /** 排期刚改完: 下一眼要看到新值 (改的那一次不算"窗口里的重复刷新") */
    fun invalidate() = synchronized(this) {
        cached = null
        readAtUptime = 0L
    }

    private fun snapshot(context: Context, now: Long): Reading {
        val proactive = ProactiveSchedule.plan(context)
        val explore = ExploreSchedule.plan(context)
        return Reading(
            at = now,
            proactive = proactive,
            proactiveNext = if (proactive.enabled) {
                ProactiveSchedule.nextAt(proactive.times, now)
            } else {
                null
            },
            gateLastAt = ProactiveGate.lastAt(context),
            gateSource = ProactiveGate.source(context),
            exploreNext = if (explore.enabled) ExploreSchedule.nextAt(explore.at, now) else null,
            exploreLast = explore.last,
            rules = AutomationStore.entries(context).mapNotNull { entry ->
                entry.rule?.let { RuleLine(entry.name, it.summary(), it.enabled) }
            },
            // 最近一次被拦: 历史最新的在前, 第一条带 blocked 的就是它 (没有这一条就是"最近没被拦过")
            autoBlocked = AutomationStore.history(context, 20).firstOrNull { it.blocked != null },
        )
    }
}
