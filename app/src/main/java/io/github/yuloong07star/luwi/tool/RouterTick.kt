package io.github.yuloong07star.luwi.tool

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import io.github.yuloong07star.luwi.host.DshHost
import io.github.yuloong07star.luwi.host.HostStatus
import io.github.yuloong07star.luwi.voice.VoiceInbox
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.random.Random

/**
 * 判断层敲钟的那一下 (2026-11-07, 球是门户)
 *
 * 它这一侧**只做一件事**: 隔一段**不定长**的时间往收件箱投一行 `source:"router"`, 说"该看一眼了" ——
 * 要不要开口、说什么, 全在宿主那一侧 (`host-plugin` 的 `judgeRouter`)。划界这么切有三个好处:
 *
 * 1. 判断要读的那些账 (`usage.json` / `wishes.json` / `signals.jsonl`) 都在 `$DSH_HOME` 里,
 *    宿主本来就在读它们
 * 2. 应用这一侧不必知道"什么算久"、"谁快考试了" —— 规则改了不用重装 APK
 * 3. 敲钟与说话分开之后, "她挑时机"与"她说人话"可以各自单独验
 *
 * **间隔是随机的** (25~55 分钟): 固定的时刻会让人觉出"这是闹钟", 而不定时才像有人在过日子 ——
 * 这是"活人感"里最便宜也最有效的一条
 *
 * 开关是 `$DSH_HOME/lw/router.json` 的 `tick.enabled`, **缺省关**: 这一批先关着发, 主人自己打开
 * 才敲。与探索 (41) / 主动对话 (43) 两个闹钟分开, requestCode 44 不覆盖任何一个
 */
internal object RouterTick {

    private const val TAG = "LwRouter"

    const val DIRECTORY = "lw"
    const val FILE = "router.json"

    /** 敲钟那一行的正文: 宿主那一侧只认这一行是不是 `router`, 正文本身不参与判断 */
    const val TEXT = "tick"

    /** 两次敲钟之间最短 / 最长各是多少毫秒 */
    const val MIN_GAP_MS = 25 * 60_000L
    const val MAX_GAP_MS = 55 * 60_000L

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
     */
    fun enabled(context: Context): Boolean = runCatching {
        val raw = file(context).takeIf { it.isFile }?.readText() ?: return false
        val root = json.parseToJsonElement(raw).jsonObject
        root["tick"]?.jsonObject?.get("enabled")?.jsonPrimitive?.booleanOrNull ?: false
    }.getOrDefault(false)

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
     * [roll] 是 0~1 之间的一个数: 传进来而不是自己在里面取, 于是它在没有设备的地方也量得动
     */
    fun gapFor(roll: Float): Long {
        val bounded = roll.coerceIn(0f, 1f)
        return MIN_GAP_MS + ((MAX_GAP_MS - MIN_GAP_MS) * bounded).toLong()
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
        val next = System.currentTimeMillis() + gapFor(Random.nextFloat())
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
                // **无论成没成都要排下一次**: 这一次宿主起不来不代表下一次不敲
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

/** 敲钟的闹钟广播: `exported=false`, 只可能被本应用自己的 `PendingIntent` 叫到 */
class RouterTickReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val pending = goAsync()
        RouterTick.fireAsync(context) { pending.finish() }
    }
}
