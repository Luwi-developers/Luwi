package io.github.yuloong07star.luwi.tool

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.PowerManager
import android.util.Log
import io.github.yuloong07star.luwi.automation.AutomationRule
import io.github.yuloong07star.luwi.host.DshHost
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File

/**
 * 「今天这台手机被怎么用了」那一份读数 (2026-11-07, 球是门户)
 *
 * 判断层 (`host-plugin` 的 `judgeRouter`) 要回答"她该不该开口", 而它需要两个数: **今天哪个应用用了
 * 多久**(游戏那一档就是"打太久了"), 以及**刚才发生了什么**(前台换了 / 解锁了)。这一份就是那两样,
 * 落 `$DSH_HOME/lw/`:
 *
 * - `usage.json` —— 应用**单写者**, 宿主只读 (`judgeRouter` 读它)
 * - `signals.jsonl` —— 一行一件事, 有界 200 行
 *
 * 三条刻意的选择:
 *
 * 1. **只数时长, 不记内容**: 这里没有一个字的界面文本、没有聊天、没有搜索词 —— "今天王者 118 分钟"
 *    够判断层用了, 再多的都是不必要地存主人的东西
 * 2. **不新增闹钟与监听器**: 刷新挂在 [io.github.yuloong07star.luwi.automation.AutomationEngine] 那
 *    一拍 60 秒的心跳上 (它本来就一直在跑), 内部再按 [REFRESH_MS] 节流; 信号只在前台/解锁那两个
 *    既有回调里多写一行
 * 3. **读不到就写空**: 没有「使用情况访问」时 `queryEvents` 回空表而不是抛, 于是 `access: false`
 *    就是那份读数, 排查时一眼看得出"不是她不提醒, 是这条权限没给"
 */
internal object UsageLedger {

    private const val TAG = "LwUsage"

    const val DIRECTORY = "lw"
    const val USAGE_FILE = "usage.json"
    const val SIGNALS_FILE = "signals.jsonl"

    /** 多久重算一次今天这笔账 (60 秒那一拍里判) */
    const val REFRESH_MS = 5 * 60_000L

    /** 信号留多少行 (与收件箱同一个量级) */
    const val SIGNAL_MAX_LINES = 200

    /** 轮转以后留多少行 */
    private const val SIGNAL_KEEP_LINES = 150

    /** 今日榜留几个应用: 判断层只关心最上面那几个, 再多只是把文件撑大 */
    private const val TOP_APPS = 12

    private val json = Json { ignoreUnknownKeys = true }

    /** 上一次真的算过账的时刻 (内存里那一份省掉反复的 `queryEvents`) */
    private var lastRefreshAt = 0L

    fun usageFile(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), "$DIRECTORY/$USAGE_FILE")

    fun signalsFile(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), "$DIRECTORY/$SIGNALS_FILE")

    /**
     * 到点就重算一次 (60 秒心跳里调它)
     *
     * **熄屏不算**: 熄屏那一刻前台没变、时长也不涨, 这一拍跳过可以省一整天几百次无用的
     * `queryEvents` —— 而 `usage.json` 里的 `at` 一旦旧到能看出来, 也就说明"心跳没在跑"
     */
    fun maybeRefresh(context: Context, now: Long) {
        val interactive = runCatching {
            context.getSystemService(PowerManager::class.java)?.isInteractive == true
        }.getOrDefault(false)
        if (!interactive) return
        // 进程重启后 [lastRefreshAt] 是 0, 那就看文件有多旧 —— 与"内存里记着"是同一个判据
        val stamp = if (lastRefreshAt > 0) lastRefreshAt else usageFile(context).lastModified()
        if (now - stamp < REFRESH_MS) return
        lastRefreshAt = now
        runCatching { writeSnapshot(context, now) }
            .onFailure { Log.w(TAG, "today's usage was not written", it) }
    }

    /** 现算一份并落盘 (设置页那行读数、排查、与 [maybeRefresh] 共用同一段) */
    fun writeSnapshot(context: Context, now: Long) {
        val snapshot = snapshot(context, now)
        val payload = buildJsonObject {
            put("v", 1)
            put("at", now)
            put("day", AutomationRule.dayKey(now))
            // 没有「使用情况访问」时这一份是空的: 把"为什么空"写在数据里, 而不是让下一个读者去猜
            put("access", snapshot.access)
            put("today", buildJsonArray {
                snapshot.apps.take(TOP_APPS).forEach { app ->
                    add(buildJsonObject {
                        put("pkg", app.pkg)
                        put("label", app.label)
                        put("ms", app.ms)
                        put("game", app.game)
                    })
                }
            })
            snapshot.foreground?.let { foreground ->
                put("foreground", buildJsonObject {
                    put("pkg", foreground)
                    put("since", snapshot.foregroundSince)
                })
            }
        }
        writeAtomically(usageFile(context), payload.toString())
    }

    /** 今天这一天: 每个包累计多久 + 现在前台是谁 */
    fun snapshot(context: Context, now: Long): Snapshot {
        val manager = context.getSystemService(UsageStatsManager::class.java)
            ?: return Snapshot(access = false, apps = emptyList(), foreground = null, foregroundSince = 0L)
        val access = usageAccess(context)
        val dayStart = startOfDay(now)
        val running = mutableMapOf<String, Long>()
        val totals = mutableMapOf<String, Long>()
        val latest = mutableMapOf<String, Long>()
        runCatching {
            val events = manager.queryEvents(dayStart, now)
            val event = UsageEvents.Event()
            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                val pkg = event.packageName ?: continue
                if (pkg == context.packageName) continue
                when (event.eventType) {
                    UsageEvents.Event.ACTIVITY_RESUMED -> {
                        running[pkg] = event.timeStamp
                        latest[pkg] = event.timeStamp
                    }

                    UsageEvents.Event.ACTIVITY_PAUSED,
                    UsageEvents.Event.ACTIVITY_STOPPED,
                    -> {
                        val from = running.remove(pkg) ?: continue
                        totals[pkg] = (totals[pkg] ?: 0L) + (event.timeStamp - from).coerceAtLeast(0L)
                    }
                }
            }
            // 还在前台那几个: 算到"现在"
            running.forEach { (pkg, from) ->
                totals[pkg] = (totals[pkg] ?: 0L) + (now - from).coerceAtLeast(0L)
            }
        }
        val foreground = running.maxByOrNull { it.value }?.key
        val apps = totals
            .map { (pkg, ms) -> app(context, pkg, ms) }
            .sortedByDescending { it.ms }
        return Snapshot(
            access = access,
            apps = apps,
            foreground = foreground,
            foregroundSince = foreground?.let { running[it] } ?: 0L,
        )
    }

    /**
     * 上一次心跳看到的"锁着没有" (`null` = 还没看过)
     *
     * 用它判"刚解锁"是**不依赖广播**的那一条路: `USER_PRESENT` 在 HyperOS 上没送到这台机器
     * (2026-11-07 量到: 接收器挂着、锁屏再解锁、文件里一行都没有), 而 `isKeyguardLocked` 读一次
     * 就能比出"从锁着变成解开" —— 60 秒粒度对"他刚在用过手机"这件事够用
     */
    private var lastLocked: Boolean? = null

    /** 心跳里叫一次: 从"锁着"变"解开"就记一行 (广播那条仍然留着, 两条互为备份) */
    fun maybeSignalUnlock(context: Context) {
        val locked = runCatching {
            context.getSystemService(android.app.KeyguardManager::class.java)?.isKeyguardLocked
        }.getOrNull() ?: return
        val previous = lastLocked
        lastLocked = locked
        if (previous == true && !locked) signal(context, "unlock")
    }

    /**
     * 记一行信号 (前台换了 / 解锁了)
     *
     * 它只是**给判断层看的一件事**, 不是规则引擎的输入: 自动指令那一套仍然走
     * [io.github.yuloong07star.luwi.automation.AutomationEngine] 自己的回调, 两条路互不影响
     */
    fun signal(context: Context, kind: String, pkg: String? = null) {
        val now = System.currentTimeMillis()
        val line = buildJsonObject {
            put("at", now)
            put("kind", kind)
            pkg?.takeIf { it.isNotBlank() }?.let { put("pkg", it) }
        }.toString()
        runCatching {
            val target = signalsFile(context)
            target.parentFile?.mkdirs()
            target.appendText("$line\n")
            if (target.length() > 64 * 1024) rotate(target)
        }.onFailure { Log.w(TAG, "the signal line was not written", it) }
    }

    private fun rotate(target: File) {
        val kept = target.readLines().takeLast(SIGNAL_KEEP_LINES)
        target.writeText(kept.joinToString("\n", postfix = if (kept.isEmpty()) "" else "\n"))
    }

    /** 一个包 -> 那一行读数 (名字取不到就用包名, 类型取不到就不是游戏) */
    private fun app(context: Context, pkg: String, ms: Long): App {
        val manager = context.packageManager
        val info = runCatching { manager.getApplicationInfo(pkg, 0) }.getOrNull()
        val label = info?.let { runCatching { manager.getApplicationLabel(it).toString() }.getOrNull() }
        val game = info?.category == ApplicationInfo.CATEGORY_GAME
        return App(pkg = pkg, label = label?.takeIf { it.isNotBlank() } ?: pkg, ms = ms, game = game)
    }

    /** 「使用情况访问」给没给 (appops, 与 `PermissionCatalog` 那一条是同一个判据) */
    private fun usageAccess(context: Context): Boolean {
        val manager = context.getSystemService(AppOpsManager::class.java) ?: return false
        val mode = runCatching {
            manager.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                context.packageName,
            )
        }.getOrNull() ?: return false
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /** 今天零点 (本地时区) */
    private fun startOfDay(now: Long): Long =
        java.time.Instant.ofEpochMilli(now)
            .atZone(java.time.ZoneId.systemDefault())
            .toLocalDate()
            .atStartOfDay(java.time.ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()

    /** 原子写 (`.tmp` + rename): 读的一侧永远看不到半份文件 (与 `ball-phase.json` 同一条路) */
    private fun writeAtomically(target: File, text: String) {
        val temporary = File(target.parentFile, "${target.name}.tmp")
        runCatching {
            target.parentFile?.mkdirs()
            temporary.writeText("$text\n")
            if (!temporary.renameTo(target)) {
                target.writeText("$text\n")
                temporary.delete()
            }
        }
    }

    /** 今天这一天的一份快照 */
    data class App(val pkg: String, val label: String, val ms: Long, val game: Boolean)

    data class Snapshot(
        val access: Boolean,
        val apps: List<App>,
        val foreground: String?,
        val foregroundSince: Long,
    )
}
