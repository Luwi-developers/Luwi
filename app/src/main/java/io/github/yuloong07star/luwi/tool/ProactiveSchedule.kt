package io.github.yuloong07star.luwi.tool

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import io.github.yuloong07star.luwi.automation.AutomationRule
import io.github.yuloong07star.luwi.automation.AutomationStore
import io.github.yuloong07star.luwi.host.DshHost
import io.github.yuloong07star.luwi.host.HostStatus
import io.github.yuloong07star.luwi.voice.VoiceInbox
import io.github.yuloong07star.luwi.wake.PowerWindow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 主动对话的排期 (2.8.0 B4-a): **一天几个时刻, 到点自己开一场**
 *
 * 它是 [ExploreSchedule] 的姊妹件而不是它的一部分 —— 主人 2026-10-18 的口径是"主动对话从探索里
 * 拆开": 两边各有自己的配置文件 (`proactive-schedule.json` 对 `explore-schedule.json`)、自己的
 * 卡片 (`proactive-card.md` 对 `explore-card.md`) 与自己的宿主账 (`proactive.json` 对
 * `explore.json`)。**排期这一段是共用的** (闹钟 / 先拉宿主 / 等就绪 / 允许锁屏解锁), 所以那几步
 * 走 [ExploreSchedule] 里现成的那两条 ([ExploreSchedule.wakeHost] / [ExploreSchedule.unlockAtSchedule])
 *
 * B4-a 只做骨架; B4-b 把三道产品闸接上 (设置页归 B4-c):
 *
 * 1. **30 分钟闸** ([ProactiveGate]): 与自动指令**共用同一笔账**, 任何一边刚说过, 另一边在 30
 *    分钟内都不开口; 手动「立刻跑一次」不查也不记这笔账
 * 2. **静默时段** ([quietWhy]): 到点落在 `automations/settings.json` 的静默窗口里就跳过, 也不为了
 *    这一场把宿主叫起来
 * 3. **没有每日总次数上限**: 2.8.0 起取消 `saidLimit`, 一天能说几次只受这两道闸与排期时刻约束
 *
 * 这里要成立的是两件事:
 *
 * 1. **排期能起**: 文件里开着, 宿主服务起来就排上; 到点先拉宿主, 再往收件箱投一行
 *    `source:"proactive"` (正文是 `proactive-card.md`, 没有就投缺省那一句)
 * 2. **主动场不建虚拟屏**: 应用这一侧一条建屏的路都不走; 宿主那一侧 `startProactive` 只开会话,
 *    而且 `proactive` 预设的场里屏幕类工具一律被 [host-plugin] 的 guard 拒掉
 *
 * 配置与读数都落 `$DSH_HOME/lw/proactive-schedule.json` (应用单写者); 30 分钟闸那笔账落在
 * `$DSH_HOME/lw/proactive-gate.json` ([ProactiveGate], 应用单写者); 到点之后宿主那一场记在
 * `$DSH_HOME/lw/proactive.json` (宿主单写者, 应用只读)
 */
internal object ProactiveSchedule {

    private const val TAG = "LwProactive"

    /** 目录与文件名: 宿主那一侧同一个约定 */
    const val DIRECTORY = "lw"
    const val FILE = "proactive-schedule.json"

    /** 这一档的卡 (宿主 / 主人写, 到点读它当开场正文) */
    const val CARD = "proactive-card.md"

    /** 卡与开场正文的上限, 与探索那张卡同一个数 */
    const val MAX_CHARS = 8000

    /** 缺省时刻: 上午九点半 (夜里不打扰, 一天先问一次) */
    const val DEFAULT_AT = "09:30"

    /** 卡是空的时候投什么 —— 启动顺序那四步, 与宿主 `proactiveStartLine` 的缺省同一段 */
    const val FALLBACK_TEXT = "最新探索摘要 -> 记忆搜索 -> 今天的日历 -> 通知摘要, 再决定要不要开口"

    /** 与自动指令 (41) / 探索 (42) 两个闹钟分开, 三个 requestCode 互不覆盖 */
    private const val REQUEST = 43

    /**
     * 投出去之后按多久会话锁 (2026-11-07)
     *
     * 主动对话是一句话 + 几轮推理, 不是长任务; 十五分钟够它把话说完并落账, 也不至于白耗一夜
     */
    private const val PROACTIVE_LOCK_MS = 15 * 60_000L

    private val json = Json { ignoreUnknownKeys = true }
    private val lock = Any()
    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "lw-proactive-schedule").apply { isDaemon = true }
    }

    /** 上一次排期的那一趟 (给 B4-c 的设置页用) */
    data class Last(val at: Long, val outcome: String, val why: String?)

    /**
     * 最近一次被拦的那一趟 (B4-c ⑪ "最近 blocked reason")
     *
     * 单独记一份而不是只看 [Last]: 被拦之后又成功开过一场时, `last` 已经是"开了一场", 但那句
     * "为什么上次没开口"仍是主人要看的读数 —— 所以它跟着 [Plan] 一起落盘
     */
    data class Blocked(val at: Long, val why: String)

    /** 排期配置: 开没开 / 一天那几个时刻 / 到点允不允许解屏 / 上一趟 / 最近一次被拦 */
    data class Plan(
        val enabled: Boolean,
        val times: List<String>,
        val last: Last?,
        val unlock: Boolean = false,
        val blocked: Blocked? = null,
    )

    fun file(context: Context): File = File(File(context.filesDir, DshHost.HOME_DIR), "$DIRECTORY/$FILE")

    /** 卡在哪: 与 [ExploreTask.file] 同一个目录, 只是名字不同 */
    fun cardFile(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), "$DIRECTORY/$CARD")

    /** 现在这份配置 (读不到 / 读坏了都按缺省: 关着, 09:30) */
    fun plan(context: Context): Plan {
        val raw = runCatching { file(context).takeIf { it.isFile }?.readText() }.getOrNull()
            ?: return Plan(false, listOf(DEFAULT_AT), null)
        val root = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
            ?: return Plan(false, listOf(DEFAULT_AT), null)
        // 手改坏了的 JSON (比如 `times` 里塞了个对象) 一样退回缺省: 排期读坏不该让进程崩
        return runCatching { planOf(root) }.getOrElse { Plan(false, listOf(DEFAULT_AT), null) }
    }

    /**
     * 一份 JSON -> 配置 (纯函数)
     *
     * `times` 认不出来 / 全是坏的 / 根本没写时落回 [DEFAULT_AT]; 认出来的那几条按分钟排好并去重,
     * 统一写成 `HH:mm` (手改的 `9:30` / `09:30` 落盘之后是同一个形状)
     */
    fun planOf(root: JsonObject): Plan {
        val enabled = root["enabled"]?.jsonPrimitive?.booleanOrNull ?: false
        val times = timesOf(root["times"])
        val last = (root["last"] as? JsonObject)?.let { one ->
            Last(
                at = one["at"]?.jsonPrimitive?.longOrNull ?: 0L,
                outcome = one["outcome"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                why = one["why"]?.jsonPrimitive?.contentOrNull,
            )
        }
        val unlock = root["unlock"]?.jsonPrimitive?.booleanOrNull ?: false
        // B4-c: 最近一次被拦 (旧文件没有这个键, 那就是"最近没被拦过")
        val blocked = (root["blocked"] as? JsonObject)?.let { one ->
            Blocked(
                at = one["at"]?.jsonPrimitive?.longOrNull ?: 0L,
                why = one["why"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            )
        }?.takeIf { it.why.isNotBlank() }
        return Plan(enabled, times, last, unlock, blocked)
    }

    /**
     * `times` 那一栏 -> 一天里认得的几个时刻 (纯函数)
     *
     * 空表与全坏都退 [DEFAULT_AT]: "开着但一个时刻都认不出来"等于**永远不响**, 那比回到缺省更糟
     */
    fun timesOf(element: JsonElement?): List<String> {
        val asked = (element as? JsonArray)
            ?.mapNotNull { one ->
                AutomationRule.minutesOf((one as? JsonPrimitive)?.contentOrNull.orEmpty())
            }
            ?.map { minutes -> String.format(Locale.ROOT, "%02d:%02d", minutes / 60, minutes % 60) }
            ?.distinct()
            ?.sorted()
            .orEmpty()
        return asked.ifEmpty { listOf(DEFAULT_AT) }
    }

    /**
     * 设置页那个编辑框 -> 一天里认得的几个时刻 (纯函数, B4-c)
     *
     * 与 [timesOf] 同一套规范化 (`9:30` 与 `09:30` 是同一个时刻, 去重排序), 只是输入是主人手打的
     * 一段文字而不是 JSON。**有一个认不出来就整段拒**: 静默地丢掉坏的那个, 主人会以为它排上了
     */
    fun parseTimes(text: String): List<String>? {
        val parts = text.split(',', '，', ';', '；', '、', '/', '\n', ' ')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        if (parts.isEmpty()) return null
        val minutes = parts.mapNotNull { AutomationRule.minutesOf(it) }
        if (minutes.size != parts.size) return null
        return minutes.distinct().sorted()
            .map { minute -> String.format(Locale.ROOT, "%02d:%02d", minute / 60, minute % 60) }
    }

    /** 写配置 + 重排闹钟 (单写者, 原子写) */
    fun save(context: Context, plan: Plan) = synchronized(lock) {
        val target = file(context)
        target.parentFile?.mkdirs()
        val root = buildJsonObject {
            put("v", 1)
            put("updatedAt", System.currentTimeMillis())
            put("enabled", plan.enabled)
            put("times", buildJsonArray { plan.times.forEach { add(it) } })
            // 到点允不允许解屏: 与探索那一个开关各管一条路 (B4-b 的产品闸还没接)
            put("unlock", plan.unlock)
            plan.last?.let { last ->
                put("last", buildJsonObject {
                    put("at", last.at)
                    put("outcome", last.outcome)
                    last.why?.let { put("why", it) }
                })
            }
            // 最近一次被拦 (B4-c ⑪): 它比 `last` 活得久, 成功开过一场之后也不清掉
            plan.blocked?.let { blocked ->
                put("blocked", buildJsonObject {
                    put("at", blocked.at)
                    put("why", blocked.why)
                })
            }
        }
        val text = json.encodeToString(JsonObject.serializer(), root) + "\n"
        val tmp = File(target.parentFile, "${target.name}.tmp")
        runCatching {
            tmp.writeText(text)
            if (!tmp.renameTo(target)) {
                target.writeText(text)
                tmp.delete()
            }
        }.onFailure { Log.w(TAG, "the proactive schedule was not written", it) }
        arm(context)
    }

    /**
     * 下一次该响的时刻 (epoch 毫秒): 今天还剩的时刻里最早那个, 都过了就明天第一个
     *
     * 纯函数, 单测钉着; 一条都认不出来就是 null
     */
    fun nextAt(times: List<String>, now: Long, zone: ZoneId = ZoneId.systemDefault()): Long? {
        val minutes = times.mapNotNull { AutomationRule.minutesOf(it) }.distinct().sorted()
        if (minutes.isEmpty()) return null
        val date = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val start = date.atStartOfDay(zone)
        for (minute in minutes) {
            val at = start.plusMinutes(minute.toLong()).toInstant().toEpochMilli()
            if (at > now) return at
        }
        return date.plusDays(1).atStartOfDay(zone)
            .plusMinutes(minutes.first().toLong())
            .toInstant()
            .toEpochMilli()
    }

    /** 现在这张卡 (trim 过; 读不到就是空串) */
    fun readCard(context: Context): String = runCatching {
        cardFile(context).takeIf { it.isFile }?.readText().orEmpty()
    }.getOrDefault("").trim().take(MAX_CHARS)

    /**
     * 静默时段 (B4-b ⑨): 落在里面就回那一句, 不在就 null
     *
     * 窗口与自动指令是同一份 (`automations/settings.json` 的 `quiet.enabled` / `quiet.window`, 缺省
     * 23:00-07:00) —— 主动排期没有"这条规则要不要静默"的那一栏, 所以只看总开关
     */
    fun quietWhy(context: Context, now: Long, zone: ZoneId = ZoneId.systemDefault()): String? {
        val on = AutomationStore.settings(context)
        return quietWhy(on.quietEnabled, on.quietWindow, now, zone)
    }

    /**
     * 纯函数那一半 (单测钉着): 开关关着 / 窗口认不出来 / 空窗都不算静默
     *
     * 到点那一刻落在窗口里就是"不开口", 与到点那一刻有没有东西可说无关 —— 静默时段挡的是"发出
     * 声音"这件事本身
     */
    fun quietWhy(
        enabled: Boolean,
        window: String?,
        now: Long,
        zone: ZoneId = ZoneId.systemDefault(),
    ): String? {
        if (!enabled) return null
        val parsed = window?.let { PowerWindow.parse(it) }?.takeIf { !it.empty } ?: return null
        if (!PowerWindow.inside(PowerWindow.minutesOfDay(now, zone), parsed)) return null
        return "静默时段 (${PowerWindow.describe(parsed)})"
    }

    /** 宿主起来 / 设置页改完时叫一次: 开着就排, 关着就撤 */
    fun ensure(context: Context) {
        arm(context)
    }

    /**
     * 按当前配置排下一次 (关着就撤销)
     *
     * 精确档拿不到时退 `setAndAllowWhileIdle` —— 与另外两个闹钟同一个退路
     */
    fun arm(context: Context) {
        val manager = context.getSystemService(AlarmManager::class.java) ?: return
        val pending = intent(context)
        val current = plan(context)
        if (!current.enabled) {
            manager.cancel(pending)
            return
        }
        val next = nextAt(current.times, System.currentTimeMillis()) ?: return
        val exact = runCatching { manager.canScheduleExactAlarms() }.getOrDefault(false)
        runCatching {
            if (exact) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
            }
        }.onFailure { Log.w(TAG, "the proactive alarm could not be armed", it) }
    }

    private fun intent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        REQUEST,
        Intent(context, ProactiveAlarmReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** 接收器那条: 放到自己的工作线程上做, 不占主线程 (理由与探索那条一样) */
    fun fireAsync(context: Context, done: () -> Unit) {
        val application = context.applicationContext
        worker.execute {
            val released = AtomicBoolean(false)
            val release = { if (released.compareAndSet(false, true)) done() }
            try {
                fire(application, System.currentTimeMillis(), release)
            } catch (problem: Throwable) {
                Log.w(TAG, "the scheduled proactive conversation could not be fired", problem)
            } finally {
                release()
            }
        }
    }

    /**
     * 到点那一趟: 先看静默时段与 30 分钟闸, 宿主不在就先拉起来, 然后往收件箱投一行 `source:"proactive"`
     *
     * **这里不判上一场在不在跑**: 主动场固定新开 (B4-a ⑤); 30 分钟闸 (B4-b ⑥) 查的是
     * [ProactiveGate] 那笔与自动指令共用的账: 到点这一刻就查一次 (闸关着就不必把宿主叫起来), 真正
     * 投递时再在 [ProactiveGate.deliver] 里查一次 —— 等宿主 / 解屏那一两分钟里自动指令可能刚说过
     */
    private fun fire(context: Context, now: Long, release: () -> Unit) {
        val current = plan(context)
        if (!current.enabled) return
        val at = current.times.joinToString("/")
        // 静默时段 (B4-b ⑨): 到点也不开口, 更不为了这一场去把宿主叫起来
        val quiet = quietWhy(context, now)
        if (quiet != null) {
            Log.i(TAG, "the scheduled proactive conversation at $at was skipped: $quiet")
            save(context, current.copy(last = Last(now, "skipped", quiet), blocked = Blocked(now, quiet)))
            return
        }
        // 30 分钟闸 (B4-b ⑥): 自动指令刚说过 / 上一次排期才过 20 分钟, 这一场就不开口
        val lastSpoken = ProactiveGate.lastAt(context)
        if (!ProactiveGate.open(lastSpoken, now)) {
            val why = ProactiveGate.blockedReason(lastSpoken, now)
            Log.i(TAG, "the scheduled proactive conversation at $at was skipped: $why")
            save(context, current.copy(last = Last(now, "skipped", why), blocked = Blocked(now, why)))
            return
        }
        Log.i(TAG, "the proactive schedule fired ($at)")
        if (DshHost.status !is HostStatus.Running) {
            // 与 2.8.0 #9 探索那条同一个形态: 闹钟把进程叫醒了, 而宿主那半可能是死的
            Log.i(TAG, "the host was not running, starting it for the proactive conversation")
            // 松手交给 wakeHost: 服务**真的开始启动**之后才 finish() 广播 (2026-11-07, 同探索那条)
            val wake = ExploreSchedule.wakeHost(context, onStarted = release)
            if (!wake.ok) {
                val why = wake.why
                    ?: "宿主起不来 (等了 ${ExploreSchedule.HOST_WAIT_MS / 1000} 秒)"
                Log.w(TAG, "the scheduled proactive conversation was skipped: $why")
                save(context, current.copy(last = Last(now, "skipped", why)))
                return
            }
        }
        // 允许锁屏解锁时先让屏幕亮起来并解开 (与探索那条同一段实现)
        val unlockNote = if (current.unlock) {
            ExploreSchedule.unlockAtSchedule(context, "the scheduled proactive conversation")
        } else {
            null
        }
        val card = readCard(context)
        val text = card.ifEmpty { FALLBACK_TEXT }
        // 查账 / 投递 / 记账在同一把锁里: 等宿主与解屏可能过了一两分钟, 这一刻才是真正的开口时刻
        val sent = ProactiveGate.deliver(context, System.currentTimeMillis(), VoiceInbox.SOURCE_PROACTIVE) {
            VoiceInbox.append(context, text, source = VoiceInbox.SOURCE_PROACTIVE)
        }
        when (sent) {
            is ProactiveGate.Outcome.Blocked -> {
                val why = ProactiveGate.blockedReason(sent.lastAt, System.currentTimeMillis())
                Log.i(TAG, "the scheduled proactive conversation was skipped: $why")
                save(context, current.copy(last = Last(now, "skipped", why)))
            }

            ProactiveGate.Outcome.Failed -> {
                Log.w(TAG, "the scheduled proactive conversation could not be queued")
                save(context, current.copy(last = Last(now, "failed", "收件箱写不进去")))
            }

            is ProactiveGate.Outcome.Delivered -> {
                // 会话锁 (2026-11-07): 主动对话没有"场时长"这个数 (它只说几句话), 给一个固定预算 ——
                // 与探索那条同一把机制, 名字分开, 心跳那边各自 reconcile
                val lockUntil = LwSessionLock.hold(
                    context,
                    LwSessionLock.TAG_PROACTIVE,
                    PROACTIVE_LOCK_MS,
                )
                val why = listOfNotNull(
                    if (card.isEmpty()) "卡是空的, 按缺省那一段投的" else null,
                    unlockNote,
                    if (lockUntil > 0L) LwSessionLock.describe(LwSessionLock.TAG_PROACTIVE) else null,
                ).joinToString("; ").ifEmpty { null }
                Log.i(TAG, "the proactive conversation was queued as line #${sent.seq} (card ${card.length} chars)")
                save(context, current.copy(last = Last(now, "started", why)))
            }
        }
    }

    /** 设置页那一行读数用: `started` / `skipped` / `failed` -> 一句中文 (B4-c 接) */
    fun describeLast(last: Last): String = when (last.outcome) {
        "started" -> "开了一场主动对话" + (last.why?.let { " · $it" } ?: "")
        "skipped" -> "没跑: ${last.why.orEmpty()}"
        "failed" -> "没投出去: ${last.why.orEmpty()}"
        else -> last.outcome
    }
}

/**
 * 主动对话排期的闹钟广播 (与自动指令 41 / 探索 42 分开, 三个 requestCode 互不覆盖)
 *
 * `exported=false`: 只可能被本应用自己的 `PendingIntent` 叫到; 系统在进程不在时也会把进程拉起来送
 * 这一条, 所以"到点了"这件事不依赖界面开着
 */
class ProactiveAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val pending = goAsync()
        ProactiveSchedule.fireAsync(context) { pending.finish() }
    }
}
