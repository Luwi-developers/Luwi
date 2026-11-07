package io.github.yuloong07star.luwi.tool

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.BatteryManager
import android.os.PowerManager
import android.util.Log
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.automation.AutomationRule
import io.github.yuloong07star.luwi.host.DshHost
import io.github.yuloong07star.luwi.host.DshHostService
import io.github.yuloong07star.luwi.host.HostStatus
import io.github.yuloong07star.luwi.lock.LockReplay
import io.github.yuloong07star.luwi.lock.LockSetting
import io.github.yuloong07star.luwi.lock.LockTries
import io.github.yuloong07star.luwi.util.BatteryWhitelist
import io.github.yuloong07star.luwi.voice.VoiceInbox
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.File
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.ZoneId
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 探索的排期 (2.7.8 批次 8): **每天一个时刻, 到点自己开始**
 *
 * 主人 2026-10-17 的口径: "探索应该是定时的由用户决定开始时间，不要手动开始探索" —— 所以设置页没有
 * 任何"现在开一场"的入口, 应用里只有这一条产品级入口:
 *
 * 1. 主人设定 `HH:mm` 与总开关 (缺省关)
 * 2. [arm] 把下一次排进 `AlarmManager` (精确优先, 退 `setAndAllowWhileIdle`)
 * 3. 到点 [fire]: 上一场还在跑 → 跳过并记读数; **宿主没在跑就先把它拉起来** (["2.8.0 #9"]:
 *    闹钟本来就能把应用进程叫醒, 卡住的是"进程起来了, 宿主那半是死的, 于是只记 skipped"),
 *    等它就绪再读 [ExploreTask] 的卡 (空就是"自由探索这台手机"), 写一行收件箱
 *    (`source:"explore"`, 带着每场预算 `minutes` / `steps`) —— 宿主那边照批次 7 的
 *    `startExplore` 开一场, `Luwi` 工作区 / `explore` 预设都不变
 * 4. 不管跑没跑, 都写一份 `last` 读数并重排明天
 *
 * **省电模式不拦这一档** (2026-10-26 主人: "探索功能当前被省电模式阻止启动，看能不能忽略省电"):
 * 省电那两档开关 (`LwWakeWord.powerSave`) 管的是"现在别听", 而探索是按主人自己定的时刻干活, 不是
 * 麦克风那一笔账; 所以这里不再跳过, 只把"省电里照常开了"与"Doze 里网络可能要等维护窗口"写进
 * `last.why`。宿主那一侧的省电闸同样拆掉了 (见 `host-plugin/index.mjs` 的 `startExplore`)
 *
 * 配置与读数都落在 `$DSH_HOME/lw/explore-schedule.json` (应用单写者); `explore.json` 是宿主的账,
 * 这里只读 [ExploreTask.running]
 */
internal object ExploreSchedule {

    private const val TAG = "LwExplore"

    const val DIRECTORY = "lw"
    const val FILE = "explore-schedule.json"

    /** 缺省时刻: 夜里 (探索本身不发声, 不打扰人) */
    const val DEFAULT_AT = "03:00"

    /**
     * 每场预算的缺省与范围 (2.7.9 第 8 条 T2)
     *
     * 四个数与宿主那侧 `EXPLORE_MINUTES_DEFAULT` / `EXPLORE_STEPS_DEFAULT` 与两个范围**必须一样** ——
     * 应用只是把这几个数交给收件箱, 真正的夹取仍由宿主做; `tools/check-explore.mjs` 钉着这一对
     */
    const val MINUTES_DEFAULT = 30
    const val STEPS_DEFAULT = 60
    val MINUTES_RANGE = 1..180
    val STEPS_RANGE = 1..1000

    /** 与自动指令那个闹钟 (41) 分开, 两边互不覆盖 */
    private const val REQUEST = 42

    /**
     * 补跑窗口 (2026-11-07): 八小时
     *
     * 早上开应用能把凌晨那一场补上 ("昨晚 03:00 没跑"的那一次), 下午就不硬补 —— 隔了半天的
     * 任务卡已经不是当时的上下文了
     */
    const val CATCH_UP_WINDOW_MS = 8 * 60 * 60_000L

    /** 上一次 arm 排到的那一时刻 (进程内; 0 = 这一进程还没排过) */
    @Volatile
    private var armedAt = 0L

    /** 上一次 arm 用的是不是精确档 (只当读数, 不落盘) */
    @Volatile
    private var armedExact = false

    /**
     * 宿主不在时最多等它多久 (毫秒)
     *
     * 平时从 `startForegroundService` 到 dsh 打出就绪行是几秒; 首次解包那棵树要更久, 所以给到三分钟
     * —— 等着的是排期自己的单线程 worker, 不是广播 (广播那头在拉起服务之后立刻松手, 见 [fire])
     */
    const val HOST_WAIT_MS = 180_000L

    /** 等宿主时多久看一眼 */
    private const val HOST_POLL_MS = 200L

    private val json = Json { ignoreUnknownKeys = true }
    private val lock = Any()
    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "lw-explore-schedule").apply { isDaemon = true }
    }

    /** 上一次排期的那一趟 (给人看的三个值) */
    data class Last(val at: Long, val outcome: String, val why: String?)

    /** 排期配置: 开没开 / 每天几点 / 每场预算 / 到点允不允许解屏 / 上一趟 */
    data class Plan(
        val enabled: Boolean,
        val at: String,
        val last: Last?,
        val minutes: Int = MINUTES_DEFAULT,
        val steps: Int = STEPS_DEFAULT,
        val unlock: Boolean = false,
    )

    /**
     * 夹进范围 (与宿主 `exploreClamp` 同一个口径: 认不出来给缺省, 出来的数四舍五入再夹)
     *
     * 两份纯函数 (带 null / 不带 null) 是为了 `planOf` 与 `save` 各用得到的那一档, 判据在
     * [ExploreScheduleTest]
     */
    fun clamp(value: Int?, range: IntRange, fallback: Int): Int =
        (value ?: fallback).coerceIn(range.first, range.last)

    fun clamp(value: Int, range: IntRange): Int = value.coerceIn(range.first, range.last)

    fun file(context: Context): File = File(File(context.filesDir, DshHost.HOME_DIR), "$DIRECTORY/$FILE")

    /** 现在这份配置 (读不到 / 读坏了都按缺省: 关着, 03:00) */
    fun plan(context: Context): Plan {
        val raw = runCatching { file(context).takeIf { it.isFile }?.readText() }.getOrNull()
            ?: return Plan(false, DEFAULT_AT, null)
        val root = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
            ?: return Plan(false, DEFAULT_AT, null)
        return planOf(root)
    }

    /** 一份 JSON -> 配置 (纯函数; 坏 `at` 退回缺省, 预算按宿主那两个范围夹, 不认识的键不看) */
    fun planOf(root: JsonObject): Plan {
        val enabled = root["enabled"]?.jsonPrimitive?.booleanOrNull ?: false
        val asked = root["at"]?.jsonPrimitive?.contentOrNull
        val at = if (asked != null && AutomationRule.minutesOf(asked) != null) asked else DEFAULT_AT
        val last = (root["last"] as? JsonObject)?.let { one ->
            Last(
                at = one["at"]?.jsonPrimitive?.longOrNull ?: 0L,
                outcome = one["outcome"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                why = one["why"]?.jsonPrimitive?.contentOrNull,
            )
        }
        val minutes = clamp(root["minutes"]?.jsonPrimitive?.intOrNull, MINUTES_RANGE, MINUTES_DEFAULT)
        val steps = clamp(root["steps"]?.jsonPrimitive?.intOrNull, STEPS_RANGE, STEPS_DEFAULT)
        // 允许锁屏解锁 (2.7.10): 老文件没有这个键, 那就是关着 —— 与别的开关同一个"缺省关"的规矩
        val unlock = root["unlock"]?.jsonPrimitive?.booleanOrNull ?: false
        return Plan(enabled, at, last, minutes, steps, unlock)
    }

    /** 写配置 + 重排闹钟 (单写者, 原子写) */
    fun save(context: Context, plan: Plan) = synchronized(lock) {
        val target = file(context)
        target.parentFile?.mkdirs()
        val root = buildJsonObject {
            put("v", 1)
            put("updatedAt", System.currentTimeMillis())
            put("enabled", plan.enabled)
            put("at", plan.at)
            // 每场预算 (2.7.9 第 8 条 T2): 落盘也夹一遍, 别让手改的文件写进一个越界的数
            put("minutes", clamp(plan.minutes, MINUTES_RANGE))
            put("steps", clamp(plan.steps, STEPS_RANGE))
            // 到点允不允许解屏 (2.7.10): 它与「锁屏」那段的自动解锁是两个开关, 各管一条路
            put("unlock", plan.unlock)
            plan.last?.let { last ->
                put("last", buildJsonObject {
                    put("at", last.at)
                    put("outcome", last.outcome)
                    last.why?.let { put("why", it) }
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
        }.onFailure { Log.w(TAG, "the explore schedule was not written", it) }
        arm(context)
    }

    /**
     * 下一次该响的时刻 (epoch 毫秒): 今天还没到就今天, 否则明天
     *
     * 纯函数, 单测钉着; `at` 认不出来就是 null
     */
    fun nextAt(at: String, now: Long, zone: ZoneId = ZoneId.systemDefault()): Long? {
        val minutes = AutomationRule.minutesOf(at) ?: return null
        val date = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val today = date.atStartOfDay(zone).plusMinutes(minutes.toLong()).toInstant().toEpochMilli()
        if (today > now) return today
        return date.plusDays(1).atStartOfDay(zone)
            .plusMinutes(minutes.toLong())
            .toInstant()
            .toEpochMilli()
    }

    /**
     * 该响的那一刻已经过去、而 `last.at` 之后一次都没跑成: 现在补一趟的话晚了多少毫秒 (2026-11-07)
     *
     * 纯函数, 单测钉着。四种情况都回 null:
     *
     * 1. `lastAt == null` —— 刚打开开关, 别在白天凭空开一场 (那不是"漏了", 是"还没开始")
     * 2. `lastAt >= dueAt` —— 这一趟就是那一次, 已经跑过了
     * 3. 还没到今天的时刻 (`late <= 0`) —— 那是**今晚**那一场, 等闹钟
     * 4. 晚了超过 [window] —— 隔了半天的任务卡已经不是当时的上下文, 等下一个正常时刻
     */
    fun catchUpLateMs(
        lastAt: Long?,
        at: String,
        now: Long,
        zone: ZoneId = ZoneId.systemDefault(),
        window: Long = CATCH_UP_WINDOW_MS,
    ): Long? {
        if (lastAt == null) return null
        val minutes = AutomationRule.minutesOf(at) ?: return null
        val date = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val todayAt = date.atStartOfDay(zone).plusMinutes(minutes.toLong()).toInstant().toEpochMilli()
        // 用 LocalDate.minusDays 而不是减 24 小时: 跨夏令时的地区后者会偏一小时
        val dueAt = if (todayAt <= now) {
            todayAt
        } else {
            date.minusDays(1).atStartOfDay(zone).plusMinutes(minutes.toLong()).toInstant().toEpochMilli()
        }
        val late = now - dueAt
        if (late <= 0L || late > window) return null
        if (lastAt >= dueAt) return null
        return late
    }

    /** 到点这一趟该做什么 (纯函数, 单测钉着) */
    enum class Due {
        /** 关着: 什么都不做 */
        OFF,

        /** 宿主在跑, 上一场也结束了: 直接投那一行 */
        QUEUE,

        /**
         * 宿主不在 (进程被系统杀掉 / 崩了): 先把宿主服务拉起来, 等它就绪再投
         *
         * 2.8.0 #9: 以前这一档是"记 skipped 收工", 于是凌晨三点那一场只跳过不开始 —— 闹钟明明
         * 已经把应用叫醒了, 丢在"宿主那半是死的"这一步
         */
        WAKE_HOST,

        /** 上一场探索还在跑: 跳过, 不重开 */
        SKIP_RUNNING,
    }

    /**
     * 到点这一趟该做什么 (纯函数)
     *
     * 顺序是"关着 → 上一场 → 宿主", **省电不在其中** (见文件头那一段); 宿主没在跑不再等于跳过,
     * 而是先拉起来 (见 [Due.WAKE_HOST])
     */
    fun dueOf(enabled: Boolean, hostRunning: Boolean, running: Boolean): Due = when {
        !enabled -> Due.OFF
        running -> Due.SKIP_RUNNING
        hostRunning -> Due.QUEUE
        else -> Due.WAKE_HOST
    }

    /** 拉起宿主那一步的读数: 成没成, 以及没成时那句话 (进 `last.why`) */
    data class HostWake(val ok: Boolean, val why: String? = null)

    /**
     * 宿主不在时把它拉起来, 等就绪最多 [HOST_WAIT_MS]; 已经在跑就直接算成功
     *
     * 只该在排期自己的 worker 线程上调 (它会睡)。等的时候拿一把 partial wakelock: 这一档本来就
     * 发生在凌晨三点的 Doze 里, 广播那几秒的唤醒窗口撑不到 dsh 打出就绪行, CPU 一睡这轮等待就
     * 停在半路
     *
     * **`onStarted` 是 2026-11-07 加的**: 广播那头 (`goAsync`) 必须等服务**真的开始启动**之后才
     * 能 `finish()` —— Android 12 起从后台启动前台服务的豁免挂在广播带来的临时白名单上, 先松手
     * 再 `startForegroundService` 等于把豁免丢在门外。以前这里先 `release()` 再启动, 顺序是反的
     */
    fun wakeHost(
        context: Context,
        timeoutMs: Long = HOST_WAIT_MS,
        onStarted: (() -> Unit)? = null,
    ): HostWake {
        if (DshHost.status is HostStatus.Running) {
            onStarted?.invoke()
            return HostWake(true)
        }
        val wake = runCatching {
            context.getSystemService(PowerManager::class.java)
                ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "luwi:explore-host")
                ?.apply { acquire(timeoutMs + 10_000L) }
        }.getOrNull()
        try {
            var failure: String? = null
            runCatching { DshHostService.start(context) }
                .onFailure {
                    failure = it.message ?: it.javaClass.simpleName
                    Log.w(TAG, "the host service could not be started for the exploration", it)
                }
            // 服务已经进启动流程: 现在松手, 广播那点预算留给别人
            onStarted?.invoke()
            val deadline = System.currentTimeMillis() + timeoutMs
            while (System.currentTimeMillis() < deadline) {
                if (DshHost.status is HostStatus.Running) return HostWake(true)
                runCatching { Thread.sleep(HOST_POLL_MS) }
            }
            if (DshHost.status is HostStatus.Running) return HostWake(true)
            val why = failure?.let { "宿主没起来: $it" }
                ?: "宿主起不来 (等了 ${timeoutMs / 1000} 秒)"
            return HostWake(false, why)
        } finally {
            runCatching { wake?.takeIf { it.isHeld }?.release() }
        }
    }

    /** 宿主起来 / 设置页改完时叫一次: 开着就排, 关着就撤 */
    fun ensure(context: Context) {
        arm(context)
    }

    /**
     * 按当前配置排下一次 (关着就撤销)
     *
     * 精确档拿不到时退 `setAndAllowWhileIdle` —— 与自动指令那个闹钟同一个退路
     */
    fun arm(context: Context) {
        val manager = context.getSystemService(AlarmManager::class.java) ?: return
        val pending = intent(context)
        val current = plan(context)
        if (!current.enabled) {
            manager.cancel(pending)
            armedAt = 0L
            return
        }
        val next = nextAt(current.at, System.currentTimeMillis()) ?: return
        val exact = runCatching { manager.canScheduleExactAlarms() }.getOrDefault(false)
        armedExact = exact
        runCatching {
            if (exact) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
            }
        }.onSuccess {
            armedAt = next
        }.onFailure {
            armedAt = 0L
            Log.w(TAG, "the explore alarm could not be armed", it)
        }
    }

    /**
     * 心跳里那一拍的自愈 (2026-11-07)
     *
     * 闹钟只在 [fire] / [save] / [ensure] 那三处排 —— 而 `AlarmManager` 里的排期会被 ROM 清、
     * 会被进程被杀那一瞬间漏掉, 一旦漏了, 这个"每天一次"的东西就永久停在那儿。心跳里按现状校一遍:
     * 算出来的下一次跟已经排着的不一致才重排 (**不每 60 秒刷一次 setExact**)
     *
     * 进程重启之后 `armedAt` 是 0, 所以第一次心跳必然重排一次 —— 那正是要的
     */
    fun ensureIfStale(context: Context, now: Long = System.currentTimeMillis()) {
        val current = plan(context)
        if (!current.enabled) {
            if (armedAt != 0L) arm(context)
            return
        }
        val next = nextAt(current.at, now) ?: return
        if (armedAt == next) return
        Log.i(TAG, "re-arming the explore alarm at ${stampOf(next)} (was ${if (armedAt == 0L) "not armed" else stampOf(armedAt)})")
        arm(context)
    }

    /** 读数用的一句 `MM-dd HH:mm` (闹钟那一刻是本地的, 与人的表一致) */
    private fun stampOf(at: Long): String = SimpleDateFormat("MM-dd HH:mm", Locale.ROOT).format(Date(at))

    /**
     * 心跳里那一拍的另一半: 漏掉的那一场现在补 (2026-11-07)
     *
     * **不能只靠 [fire]**: fire 只由闹钟叫起来, 而"漏了"的典型现场正是"闹钟压根没响 / 进程被杀 /
     * 设备关机跨过了那个时刻" —— 那时不会有任何一个闹钟来叫我们, 补跑就永远轮不到。心跳是唯一
     * 一个"设备醒着就一定会跑"的钩子, 所以补跑必须挂在这里
     *
     * 不会连环补: 这一趟无论成没成都会把 `last` 写成"刚刚", 于是下一次 [catchUpLateMs] 就是 null
     */
    fun ensureCatchUp(context: Context, now: Long = System.currentTimeMillis()) {
        val current = plan(context)
        if (!current.enabled) return
        val late = catchUpLateMs(current.last?.at, current.at, now) ?: return
        // 上一场还在跑就不叠第二场 (与 fire 里那条 SKIP_RUNNING 同一个口径)
        if (ExploreTask.running(context, now) != null) return
        Log.i(TAG, "the ${current.at} run was missed by ${late / 60_000} min, catching up now")
        fireAsync(context) { }
    }

    private fun intent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        REQUEST,
        Intent(context, ExploreAlarmReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /**
     * 接收器那条: 放到自己的工作线程上做, 不占主线程
     *
     * 广播只有十秒, 而"宿主不在 → 拉起来 → 等就绪"可能是几十秒, 所以这里把手上的 [done] 做成
     * 可以提前松手的一次性钩子: [fire] 一拉起宿主服务就调用它 (服务进前台之后进程就活着了,
     * 剩下的等待放在 worker 上照常走)
     */
    fun fireAsync(context: Context, done: () -> Unit) {
        val application = context.applicationContext
        worker.execute {
            val released = AtomicBoolean(false)
            val release = { if (released.compareAndSet(false, true)) done() }
            try {
                fire(application, System.currentTimeMillis(), release)
            } catch (problem: Throwable) {
                Log.w(TAG, "the scheduled exploration could not be fired", problem)
            } finally {
                release()
            }
        }
    }

    /**
     * 到点那一趟: 决定跑不跑, 跑就写一行收件箱, 然后记 `last` 并重排明天
     *
     * 那行 `why` 是给人看的 (设置页那行"上一次"与回执都读它), 与 `history.jsonl` 的 `reason` 同一种写法
     */
    private fun fire(context: Context, now: Long, release: () -> Unit) {
        val current = plan(context)
        if (!current.enabled) return
        // 省电只当读数 (2026-10-26): 它不再是跳过的一条
        val powerSave = LwWakeWord.powerSave(context)
        // 补跑 (2026-11-07): 上一次该响的那一刻已经过去, 而 `last` 说明那一趟根本没跑成 —— 关机 /
        // 进程被杀 / 闹钟被 ROM 清掉都会留下这种洞, 从前只能干等明天
        val lateMs = catchUpLateMs(current.last?.at, current.at, now)
        val due = dueOf(
            enabled = true,
            hostRunning = DshHost.status is HostStatus.Running,
            running = ExploreTask.running(context, now) != null,
        )
        if (due == Due.SKIP_RUNNING) {
            val why = "上一场探索还在跑"
            Log.i(TAG, "the scheduled exploration at ${current.at} was skipped: $why")
            save(context, current.copy(last = Last(now, "skipped", why)))
            // 只写文件的话, 主人要等下次打开设置页才知道这一场没开成 (2.7.9 T5)
            report(context, why)
            return
        }
        if (due == Due.WAKE_HOST) {
            // 2.8.0 #9: 闹钟到点把应用叫醒了, 但宿主那半是死的 (进程被系统杀掉) —— 以前这里记一笔
            // skipped 就收工, 于是"两晚都只有跳过没有开始"; 现在先把它拉起来, 等服务就绪再投
            Log.i(TAG, "the host was not running at ${current.at}, starting it for the exploration")
            // 松手交给 wakeHost: 服务**真的开始启动**之后才 finish() 广播 (2026-11-07, 见 [wakeHost])
            val wake = wakeHost(context, onStarted = release)
            if (!wake.ok) {
                val why = wake.why ?: "宿主起不来 (等了 ${HOST_WAIT_MS / 1000} 秒)"
                Log.w(TAG, "the scheduled exploration at ${current.at} was skipped: $why")
                save(context, current.copy(last = Last(now, "skipped", why)))
                report(context, why)
                return
            }
        }
        // 允许锁屏解锁 (2.7.10): 先让屏幕亮起来并解开, 再投那一行 —— 模型一开口看到的就是能用的屏,
        // 而不是一块锁屏; 开关关着时这一段一个字都不走 (与 2.7.9 的行为一模一样)
        val unlockNote = if (current.unlock) unlockForExplore(context) else null
        val card = ExploreTask.read(context)
        val text = card.ifEmpty { ExploreTask.FALLBACK_TEXT }
        // 预算跟着这一行走 (2.7.9 第 8 条 T1): 宿主那一侧照着 `minutes` / `steps` 开这一场, 老行没有
        // 这两个键时那边落 30 / 60 的缺省
        val seq = VoiceInbox.append(
            context,
            text,
            source = VoiceInbox.SOURCE_EXPLORE,
            minutes = current.minutes,
            steps = current.steps,
        )
        if (seq == null) {
            Log.w(TAG, "the scheduled exploration could not be queued")
            save(context, current.copy(last = Last(now, "failed", "收件箱写不进去")))
            report(context, "收件箱写不进去")
            return
        }
        // 投出去了才按会话锁 (2026-11-07): 没投成的这一趟不该占着电。熄屏之后 CPU 会 suspend,
        // 宿主 (Node) 的定时器 / 网络回调 / 模型请求全挂在它上面 —— 这才是"跑一半就停"的根
        val lockUntil = LwSessionLock.hold(
            context,
            LwSessionLock.TAG_EXPLORE,
            current.minutes * 60_000L + LwSessionLock.SLACK_MS,
        )
        // 几句话都进 `why` (设置页那行"上一次"带着它): 卡是空的 / 到点屏是锁着的 / 省电里照常开了 /
        // 设备在 Doze 里 (这一条是"开了却没跑成"最可能的那个解释, 所以照样写进读数) /
        // 这一趟是补的 (最近加的那句) / 唤醒锁按到什么时候 / 精确档与白名单这两层现在什么状态
        val why = listOfNotNull(
            lateMs?.let { "补跑 (晚了 ${it / 60_000} 分钟)" },
            if (card.isEmpty()) "卡是空的, 按自由探索投的" else null,
            unlockNote,
            if (lockUntil > 0L) LwSessionLock.describe(LwSessionLock.TAG_EXPLORE) else "唤醒锁没按上",
            layers(context).joinToString("; ").ifEmpty { null },
            if (powerSave) "省电模式里照常开了" else null,
            if (doze(context)) "设备在深度省电 (Doze) 里, 网络可能要等维护窗口" else null,
        ).joinToString("; ").ifEmpty { null }
        Log.i(
            TAG,
            "the scheduled exploration was queued as line #$seq"
                + " (card ${card.length} chars, budget ${current.minutes} min / ${current.steps} steps)",
        )
        save(context, current.copy(last = Last(now, "started", why)))
    }

    /**
     * 到点那一趟先把锁屏让开 (2.7.10, 主人 2026-10-25: "探索时使用锁屏的解锁功能")
     *
     * 走的就是「锁屏」那一段的 [LockReplay]: 三条点亮路 + 主人自己录的那一串 (或注入密码); 回一句
     * **"开始前屏幕怎么了"**, 没什么可做的就回 null —— 它进 `last.why`, 设置页那行"上一次"带着它;
     * 屏幕本来就亮着并解开着时不留话, 那不是这一条做的事
     *
     * 三条边界都在这里: **没录过就不放**(只会白点亮一次屏), **失败太多次也不放**(那是 `LockTries`
     * 的闸, 别让排期把自动解锁的计数蹭光), 而**放不出去也不挡这一场** —— 探索照开, 只是停在锁屏
     */
    private fun unlockForExplore(context: Context): String? =
        unlockAtSchedule(context, "the scheduled exploration")

    /**
     * 上面那一段的共用版: 主动对话的排期 (2.8.0 B4-a) 也要在同一条路上放锁屏
     *
     * [tag] 只进 `LockReplay` 的日志, 用来说明是哪一个排期在放锁屏 —— 两条排期的三道边界
     * (没录过 / 失败太多 / 放不出去) 完全一样, 所以只留这一份实现
     */
    internal fun unlockAtSchedule(context: Context, tag: String): String? {
        if (LockSetting.unlocked(context)) return null
        LockReplay.wakeScreen(context, allowConnecting = true)
        if (!LockSetting.screenOn(context)) return "屏幕没点亮 (这一场可能看不见东西)"
        if (!LockSetting.locked(context)) return null
        if (!LockSetting.unlockable(context)) return "屏还锁着, 而且还没有录过解锁"
        if (LockTries.exhausted(LockSetting.tries(context))) {
            return "屏还锁着, 解锁连着失败太多次已经停了"
        }
        val report = LockReplay.replayNow(context, tag)
        return if (report.ok) {
            "到点先把锁屏解开了"
        } else {
            "到点没解开锁屏 (到「锁屏」那一段看哪一步没成)"
        }
    }

    /**
     * 设备现在在不在 Doze 里
     *
     * **只当读数**: 那一档不是"不跑", 而是"跑起来可能拿不到网" —— Doze 会挂起应用的网络, 模型请求
     * 要等下一个维护窗口; 把它写进 `last.why`, 主人看设置页时才知道"投出去了却没回音"是哪一层
     */
    private fun doze(context: Context): Boolean = runCatching {
        context.getSystemService(PowerManager::class.java)?.isDeviceIdleMode() == true
    }.getOrDefault(false)

    /**
     * 另外两层现在什么状态 (2026-11-07): 精确档与电池优化白名单
     *
     * 这两层决定"能不能被叫醒"与"叫醒了有没有网", 而它们都不是这个应用自己能盖住的 —— 写进
     * `last.why` 之后, 主人一眼看得出"投出去了却没回音"是卡在哪一层, 不用来回猜
     */
    private fun layers(context: Context): List<String> = listOfNotNull(
        if (armedExact) null else "这一趟是打盹档 (没有精确闹钟权限)",
        if (!BatteryWhitelist.ignored(context)) {
            "没进电池优化白名单: 息屏后网络与唤醒可能被挂起"
        } else {
            null
        },
        // 反向读数: 在充电时 CPU 不会被 suspend, 那是最省事的过夜方式
        if (charging(context)) "在充电" else null,
    )

    /** 现在在不在充电 (`BATTERY_STATUS` 里那两个都算) */
    private fun charging(context: Context): Boolean = runCatching {
        context.getSystemService(BatteryManager::class.java)?.isCharging == true
    }.getOrDefault(false)

    /** 设置页那行读数用: `started` / `skipped` / `failed` -> 一句中文 */
    fun describeLast(last: Last): String = when (last.outcome) {
        "started" -> "开始了一场探索" + (last.why?.let { " · $it" } ?: "")
        "skipped" -> "没跑: ${last.why.orEmpty()}"
        "failed" -> "没投出去: ${last.why.orEmpty()}"
        else -> last.outcome
    }

    /**
     * 「这次探索没开成: 原因」那一条通知 (2.7.9 T5)
     *
     * 走 [LwNotify] 与模型发通知同一条渠道: 一个固定 id, 再加一次只更新那一条, 不会堆一屏; 通知权限
     * 没给 (或这台机器没有通知栏) 时静默 —— 排期这一趟不该因为一句提示失败
     */
    private fun report(context: Context, why: String) {
        runCatching {
            LwNotify.notify(
                context,
                buildJsonObject {
                    put("title", context.getString(R.string.settings_explore_not_started))
                    put("text", why)
                },
            )
        }
    }
}

/**
 * 探索排期的闹钟广播 (与自动指令那个接收器分开, 两个 requestCode 互不覆盖)
 *
 * `exported=false`: 只可能被本应用自己的 `PendingIntent` 叫到; 系统在进程不在时也会把进程拉起来送
 * 这一条, 所以"到点了"这件事不依赖界面开着
 */
class ExploreAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val pending = goAsync()
        ExploreSchedule.fireAsync(context) { pending.finish() }
    }
}
