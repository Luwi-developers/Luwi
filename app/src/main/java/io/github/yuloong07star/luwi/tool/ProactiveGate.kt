package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.util.Log
import io.github.yuloong07star.luwi.host.DshHost
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.File

/**
 * 主动开口那一道 30 分钟闸 (2.8.0 B4-b)
 *
 * 主人 2026-10-18 的口径: 主动对话从探索里拆开之后, **不再有每天几次的总上限**, 但两次开口之间
 * 至少隔 30 分钟。这一道闸**跨两个来源**: 主动排期 ([ProactiveSchedule]) 与自动指令
 * ([io.github.yuloong07star.luwi.automation.AutomationEngine]) 共用同一笔账 —— 任何一边刚说过,
 * 另一边在 30 分钟内都不许再开口, 而手动「立刻跑一次」是主人自己点的那一下: 它既不查这道闸, 也不
 * 往这笔账里记 (见 `AutomationEngine.fireNow`)
 *
 * 账落在 `$DSH_HOME/lw/proactive-gate.json`, 应用单写者 (两个来源都在 app 进程里, 共用 [deliver]
 * 那把锁); 只有**真的投进收件箱**才算一次, 被拦下 / 写不进去都不记账
 *
 * 判据在 `ProactiveScheduleTest`: 29:59 拒绝 / 30:00 放行, 第一次没有前一笔时放行
 */
internal object ProactiveGate {

    private const val TAG = "LwProactiveGate"

    /** 两次主动开口之间至少隔多少分钟 (硬编码: 这是产品闸, 不跟单条规则的冷却走) */
    const val GAP_MINUTES = 30

    /** 30 分钟换成毫秒 */
    const val GAP_MS = GAP_MINUTES * 60_000L

    /**
     * 那一笔账: `$DSH_HOME/lw/proactive-gate.json`
     *
     * 与 `proactive-schedule.json` 分开放: 那份是主人改的配置 (单写者, 整份重写), 而这一份是运行时
     * 读数, 两个来源都要写 —— 混在一起会让一次自动指令把主人的排期配置覆盖掉
     */
    const val FILE = "proactive-gate.json"

    /** 一次投递的结果 */
    sealed interface Outcome {
        /** 投出去了 (收件箱序号) */
        data class Delivered(val seq: Long) : Outcome

        /** 闸关着: 上一次开口在 [lastAt], 差得还不够 30 分钟 */
        data class Blocked(val lastAt: Long) : Outcome

        /** 闸开着, 但收件箱没写进去 (目录建不出来 / 磁盘满) */
        object Failed : Outcome
    }

    private val json = Json { ignoreUnknownKeys = true }

    /** 只有 [deliver] 会拿它; 两个来源在同一个进程里, 这把锁就是"查账 + 记账"的原子性 */
    private val lock = Any()

    /** 这笔账在哪: 与主动排期同一个 `lw/` 目录 */
    fun file(context: Context): File =
        File(File(File(context.filesDir, DshHost.HOME_DIR), ProactiveSchedule.DIRECTORY), FILE)

    /**
     * 现在放不放行 (纯函数, 单测钉着)
     *
     * 没有前一笔 ([lastAt] <= 0) 就放行; 正好 30:00 也放行 —— 区间是"距上一次开口至少
     * [GAP_MS]", 所以 29:59 拒绝而 30:00 放行, 时钟往回跳时 `now - lastAt` 为负, 一样算"还没过
     * 30 分钟", 宁可少说一句也不在时间跳变里连说两次
     */
    fun open(lastAt: Long, now: Long): Boolean = lastAt <= 0L || now - lastAt >= GAP_MS

    /** 上一次主动开口是什么时候 (没记过 / 读坏了都是 0) */
    fun lastAt(context: Context): Long {
        val raw = runCatching { file(context).takeIf { it.isFile }?.readText() }.getOrNull() ?: return 0L
        val root = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return 0L
        return root["at"]?.jsonPrimitive?.longOrNull ?: 0L
    }

    /** 上一次是谁开的口 (`proactive` / `automation`), 只当读数 */
    fun source(context: Context): String? {
        val raw = runCatching { file(context).takeIf { it.isFile }?.readText() }.getOrNull() ?: return null
        val root = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return null
        return root["source"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
    }

    /**
     * 在闸里投一句 (两个来源唯一的投递口)
     *
     * 查账 / 投递 / 记账三步在同一把锁里: 查完到记账之间不会有第二条从别的线程挤进来, 所以两次
     * 开口之间至少隔 [GAP_MS] 这一条不会被并发绕过去; [append] 回 null 就是收件箱写不进去 ——
     * 那一次不算开口, 也不记账
     */
    fun deliver(context: Context, now: Long, source: String, append: () -> Long?): Outcome = synchronized(lock) {
        val last = lastAt(context)
        if (!open(last, now)) {
            Outcome.Blocked(last)
        } else {
            val seq = append()
            if (seq == null) {
                Outcome.Failed
            } else {
                write(context, now, source)
                Outcome.Delivered(seq)
            }
        }
    }

    /** 被闸拦下时给人看的那一句 (两处借它, 字面一样) */
    fun blockedReason(lastAt: Long, now: Long): String {
        val minutes = ((now - lastAt).coerceAtLeast(0L) / 60_000L)
        return "上一条主动投递才 $minutes 分钟, ${GAP_MINUTES} 分钟内不开口"
    }

    /** 把这一笔记下来 (原子写; 写不进去只留一行日志, 不许让投递失败) */
    private fun write(context: Context, at: Long, source: String) {
        val target = file(context)
        runCatching {
            target.parentFile?.mkdirs()
            val root = buildJsonObject {
                put("v", 1)
                put("at", at)
                put("source", source)
            }
            val text = json.encodeToString(JsonObject.serializer(), root) + "\n"
            val tmp = File(target.parentFile, "${target.name}.tmp")
            tmp.writeText(text)
            if (!tmp.renameTo(target)) {
                target.writeText(text)
                tmp.delete()
            }
        }.onFailure { Log.w(TAG, "the proactive gate was not written", it) }
    }
}
