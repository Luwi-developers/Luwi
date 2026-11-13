package io.github.yuloong07star.luwi.tool

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import io.github.yuloong07star.luwi.automation.AutomationCalendar
import io.github.yuloong07star.luwi.host.DshHost
import io.github.yuloong07star.luwi.host.HostStatus
import io.github.yuloong07star.luwi.voice.VoiceInbox
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.random.Random

/**
 * 判断层唤醒的那一下 (2026-11-07, 球是门户)
 *
 * 它这一侧**只做一件事**: 隔一段**不定长**的时间往收件箱投一行 `source:"router"`, 说"该看一眼了" ——
 * 要不要开口、说什么, 全在宿主那一侧 (`host-plugin` 的 `judgeRouter`)。划界这么切有三个好处:
 *
 * 1. 判断要读的那些账 (`usage.json` / `wishes.json` / `signals.jsonl`) 都在 `$DSH_HOME` 里,
 *    宿主本来就在读它们
 * 2. 应用这一侧不必知道"什么算久"、"谁快考试了" —— 规则改了不用重装 APK
 * 3. 唤醒与说话分开之后, "她挑时机"与"她说人话"可以各自单独验
 *
 * **间隔是随机的** (25~55 分钟): 固定的时刻会让人觉出"这是闹钟", 而不定时才像有人在过日子 ——
 * 这是"活人感"里最便宜也最有效的一条
 *
 * 开关是 `$DSH_HOME/lw/router.json` 的 `tick.enabled`, **缺省关**: 这一批先关着发, 主人自己打开
 * 才唤醒。与探索 (41) / 主动对话 (43) 两个闹钟分开, requestCode 44 不覆盖任何一个
 */
internal object RouterTick {

    private const val TAG = "LwRouter"

    const val DIRECTORY = "lw"
    const val FILE = "router.json"

    /** 唤醒那一行的正文: 宿主那一侧只认这一行是不是 `router`, 正文本身不参与判断 */
    const val TEXT = "tick"

    /** 两次唤醒之间最短 / 最长各是多少毫秒 */
    const val MIN_GAP_MS = 25 * 60_000L
    const val MAX_GAP_MS = 55 * 60_000L

    /* ── 准点那一拍 (2026-11-10, 方案 E) ──────────────────────────────────────
     *
     * 事件型检测项说的是"开始前 N 分钟", 而 25~55 分钟的随机间隔会让这句话抖掉大半 —— 所以有 event
     * 检测项时按事件自己的时刻排一次。**提前量由应用自己算** (不读宿主写的键): `arm()` 是"投完收件箱
     * 立刻"跑的, 那时宿主还没判断完, 它写下来的时刻赶不上这一次排闹钟
     */

    /** 提前量最多看多远: 两小时以内的事件才值得为它把闹钟提前 */
    const val LEAD_WINDOW_MS = 2 * 60 * 60 * 1000L

    /** 窗口**已经开着**却没说过时, 一分钟后再唤醒一次 (说过了就交回随机间隔) */
    const val LEAD_SOON_MS = 60_000L

    /** 排闹钟的下限: 已经到点的那一刻也不要排到"现在" */
    const val LEAD_FLOOR_MS = 3_000L

    /** 算提前量时往前看多远: 一天够盖住所有 `beforeMinutes` 的合理取值 */
    private const val LEAD_LOOKAHEAD_MS = 24 * 60 * 60 * 1000L

    /** 一次提前量的读法: [next] 是"那一刻" (0 = 没有), [open] 是"现在就在窗口里" */
    data class Lead(val next: Long = 0L, val open: Boolean = false)

    /** 与自动指令 (41) / 探索 (42) / 主动对话 (43) 各占一个, 互不覆盖 */
    private const val REQUEST = 44

    private val json = Json { ignoreUnknownKeys = true }
    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "lw-router-tick").apply { isDaemon = true }
    }

    fun file(context: Context): File = File(File(context.filesDir, DshHost.HOME_DIR), "$DIRECTORY/$FILE")

    /**
     * 现在开着没有 (读不到 / 读坏了都算关着)
     *
     * 缺省关是刻意的: 一个"会自己开口"的东西, 装上就开始说, 比装上不说话糟得多
     *
     * **2026-11-07 晚**: 「更多设置」里那一档 `sim.json` 的 `wake.mode = active` 也算开 —— 那是
     * 主人对这一页的直说, 与这里的开关任一为开就唤醒
     */
    fun enabled(context: Context): Boolean {
        val bySwitch = runCatching {
            val raw = file(context).takeIf { it.isFile }?.readText()
            if (raw == null) {
                false
            } else {
                val root = json.parseToJsonElement(raw).jsonObject
                root["tick"]?.jsonObject?.get("enabled")?.jsonPrimitive?.booleanOrNull ?: false
            }
        }.getOrDefault(false)
        if (bySwitch) return true
        return runCatching { SimSetting.plan(context).wake.active }.getOrDefault(false)
    }

    /**
     * 打开 / 关掉 (设置页那一行)
     *
     * **读-改-写整份 `router.json`**: 那一份里还有判断层写的东西 (上次说了什么、退让计数、规则表),
     * 所以只动 `tick` 这一段, 别的键原样搬回去 —— 整份覆盖等于把她"刚说过话"那笔账抹了, 于是
     * 冷却失效、退让清零
     *
     * @returns 写进去了没有 (设置页据此如实说一句)
     */
    fun setEnabled(context: Context, on: Boolean): Boolean {
        val target = file(context)
        val root = runCatching {
            target.takeIf { it.isFile }?.readText()?.let { json.parseToJsonElement(it).jsonObject }
        }.getOrNull() ?: JsonObject(emptyMap())
        val payload = buildJsonObject {
            root.forEach { (key, value) -> put(key, value) }
            put("tick", buildJsonObject { put("enabled", on) })
        }
        val written = runCatching {
            target.parentFile?.mkdirs()
            val temporary = File(target.parentFile, "${target.name}.tmp")
            temporary.writeText("${json.encodeToString(JsonObject.serializer(), payload)}\n")
            if (!temporary.renameTo(target)) {
                target.writeText("${json.encodeToString(JsonObject.serializer(), payload)}\n")
                temporary.delete()
            }
            true
        }.getOrDefault(false)
        if (written) arm(context)
        return written
    }

    /**
     * 下一次隔多久 (纯函数, 单测钉着)
     *
     * [roll] 是 0~1 之间的一个数: 传进来而不是自己在里面取, 于是它在没有设备的地方也量得动。
     * 2026-11-07 晚: 两头改成参数 —— 「更多设置」里那一档 `sim.json` 的 `wake.gapMinMs` / `gapMaxMs`
     * 就是这两个数, 不传就是原来那 25~55 分钟
     */
    fun gapFor(roll: Float, minMs: Long = MIN_GAP_MS, maxMs: Long = MAX_GAP_MS): Long {
        val bounded = roll.coerceIn(0f, 1f)
        val low = minOf(minMs, maxMs).coerceAtLeast(0L)
        val high = maxOf(minMs, maxMs).coerceAtLeast(low)
        return low + ((high - low) * bounded).toLong()
    }

    /** 与宿主 `routerDayKey` 同一个口径 (`2026-11-10`, 本地时区) */
    fun dayKeyOf(now: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(now))

    /**
     * 检测项 + 日程实例 -> 这一拍该盯的时刻 (纯函数)
     *
     * 与宿主 `routerEventHit` 同一套三条规矩: 全天事件不算、已经开始的 lead 不算、标题与日历要匹配
     * (两边漂开的样子是"闹钟按点响了, 判断层却说不该响")。`said` 是 `router.json` 的 `checksSaid`:
     * 一场会说过之后它在窗口里不再算"该唤醒", 于是不会每分钟响一次
     */
    fun leadAtOf(
        checks: List<RouterChecks.Check>,
        occurrences: List<AutomationCalendar.Occurrence>,
        said: Map<String, String>,
        now: Long,
    ): Lead {
        var next = 0L
        var open = false
        for (one in checks) {
            if (!one.enabled || one.kind != "event") continue
            val beforeMs = (if (one.beforeMinutes > 0) one.beforeMinutes else 15) * 60_000L
            for (event in occurrences) {
                if (event.allDay || event.begin <= now) continue
                if (one.calendarIds.isNotEmpty() && event.calendarId !in one.calendarIds) continue
                val wanted = one.titleContains
                if (!wanted.isNullOrBlank() && !event.title.contains(wanted, ignoreCase = true)) continue
                val leadAt = event.begin - beforeMs
                if (leadAt <= now) {
                    // 窗口已经开着: 没说过就补一次唤醒, 说过了交给随机间隔
                    if (said[one.id] != dayKeyOf(now) + "@" + event.begin) open = true
                    continue
                }
                if (leadAt - now > LEAD_WINDOW_MS) continue
                if (next == 0L || leadAt < next) next = leadAt
            }
        }
        return Lead(next = next, open = open)
    }

    /**
     * 下一次排多久 (纯函数)
     *
     * 三档: 窗口开着 → 一分钟后再来; 提前量落在两小时内 → 就按那一刻排; 其余 → 原来那 25~55 分钟的
     * 随机 — **随机性不为这件事破掉**, 只是这一拍让给了事件
     */
    fun gapWithLead(roll: Float, minMs: Long, maxMs: Long, lead: Lead, now: Long): Long {
        if (lead.open) return LEAD_SOON_MS
        if (lead.next > now && lead.next - now <= LEAD_WINDOW_MS) {
            return (lead.next - now).coerceAtLeast(LEAD_FLOOR_MS)
        }
        return gapFor(roll, minMs, maxMs)
    }

    /** `router.json` 的 `checksSaid` (只读; 读不到就是空表 —— 这一条坏了不该把闹钟也带走) */
    private fun saidKeys(context: Context): Map<String, String> = runCatching {
        val raw = file(context).takeIf { it.isFile }?.readText() ?: return emptyMap()
        val said = json.parseToJsonElement(raw).jsonObject["checksSaid"] as? JsonObject
            ?: return emptyMap()
        said.entries.mapNotNull { (key, value) ->
            val text = (value as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
            key to text
        }.toMap()
    }.getOrDefault(emptyMap())

    /**
     * 现在有没有该盯的日程 (设备读数; 没有事件型检测项时一次日历都不碰)
     *
     * 读不到日历 (没权限 / 查询失败) 一律回空 Lead: 那一拍退回随机间隔, 不猜也不报错
     */
    private fun leadFor(context: Context, now: Long): Lead {
        val wanted = runCatching {
            RouterChecks.list(context).filter { it.enabled && it.kind == "event" }
        }.getOrDefault(emptyList())
        if (wanted.isEmpty()) return Lead()
        val ids = wanted.flatMap { it.calendarIds }.distinct()
        val reading = AutomationCalendar.read(context, now, now + LEAD_LOOKAHEAD_MS, ids)
        val occurrences = reading.occurrences ?: return Lead()
        return leadAtOf(wanted, occurrences, saidKeys(context), now)
    }

    /** 宿主起来 / 设置页改完时叫一次: 开着就排, 关着就撤 */
    fun ensure(context: Context) {
        arm(context)
    }

    /** 按当前开关排下一次 (关着就撤销) */
    fun arm(context: Context) {
        val manager = context.getSystemService(AlarmManager::class.java) ?: return
        val pending = intent(context)
        if (!enabled(context)) {
            manager.cancel(pending)
            return
        }
        val plan = runCatching { SimSetting.plan(context).wake }.getOrNull()
        val now = System.currentTimeMillis()
        // 准点那一拍 (2026-11-10): 有事件型检测项就按"开始前 N 分钟"排, 没有就还是 25~55 分钟的随机
        val lead = runCatching { leadFor(context, now) }.getOrDefault(Lead())
        val next = now + gapWithLead(
            Random.nextFloat(),
            plan?.gapMinMs ?: MIN_GAP_MS,
            plan?.gapMaxMs ?: MAX_GAP_MS,
            lead,
            now,
        )
        val exact = runCatching { manager.canScheduleExactAlarms() }.getOrDefault(false)
        runCatching {
            if (exact) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
            }
        }.onFailure { Log.w(TAG, "the router alarm could not be armed", it) }
    }

    private fun intent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        REQUEST,
        Intent(context, RouterTickReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** 接收器那条: 放到自己的工作线程上做, 不占主线程 */
    fun fireAsync(context: Context, done: () -> Unit) {
        val application = context.applicationContext
        worker.execute {
            val released = AtomicBoolean(false)
            val release = { if (released.compareAndSet(false, true)) done() }
            try {
                fire(application)
            } catch (problem: Throwable) {
                Log.w(TAG, "the router tick could not be fired", problem)
            } finally {
                release()
                // **无论成没成都要排下一次**: 这一次宿主起不来不代表下一次不唤醒
                runCatching { arm(application) }
            }
        }
    }

    private fun fire(context: Context) {
        if (!enabled(context)) return
        if (DshHost.status !is HostStatus.Running) {
            // 判断在宿主那一侧, 它不在就跑不了 —— 与探索 / 主动对话同一个形态: 先把它拉起来
            val wake = ExploreSchedule.wakeHost(context) {}
            if (!wake.ok) {
                Log.i(TAG, "the router tick was skipped: ${wake.why ?: "the host did not come up"}")
                return
            }
        }
        val seq = VoiceInbox.append(context, TEXT, source = VoiceInbox.SOURCE_ROUTER)
        if (seq == null) {
            Log.w(TAG, "the router tick could not be queued")
        } else {
            Log.i(TAG, "the router was asked to look once (line #$seq)")
        }
    }
}

/** 唤醒的闹钟广播: `exported=false`, 只可能被本应用自己的 `PendingIntent` 叫到 */
class RouterTickReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val pending = goAsync()
        RouterTick.fireAsync(context) { pending.finish() }
    }
}
