package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.os.PowerManager
import android.util.Log
import io.github.yuloong07star.luwi.host.DshHost
import io.github.yuloong07star.luwi.host.DshHostService
import io.github.yuloong07star.luwi.host.HostStatus
import io.github.yuloong07star.luwi.lock.LockReplay
import io.github.yuloong07star.luwi.lock.LockSetting
import io.github.yuloong07star.luwi.lock.LockTries
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.File

/**
 * 探索的预算 (2.7.8 批次 8 起; **2026-11-21 起探索只由判断层触发**)
 *
 * 主人 2026-10-17 的口径是"定时由用户决定开始时间, 不要手动开始", 于是 2.7.8 做了一条每天一个时刻的
 * `AlarmManager` 排期 (requestCode 42). 2026-11-21 那份方案把排期整条撤了: 判断层 (`judgeRouter`) 判
 * `say=true` 且球不在场时, 宿主自己 `startExplore { via:'router' }` 开一场 —— 于是应用这一侧**没有时刻、
 * 没有闹钟、没有开关、也没有"上一趟"读数**, 只剩两件她要用到的东西:
 *
 * 1. **每场多少步** ([Plan.steps]): 宿主 `readExploreSchedule` 在**每一场开场前**现读这个文件, 拨多少就
 *    跑多少 (缺省 60, 范围 1~1000, 与应用同一对)
 * 2. **允许锁屏解锁** ([Plan.unlock]): 探索里那条 `lw_lock op=unlock` 要过它 (见 `LwLock`), 关着就如实拒
 *
 * 文件仍是 `$DSH_HOME/lw/explore-schedule.json` (应用单写者, 宿主只读). 2026-11-21 之前写进去的
 * `enabled` / `at` / `minutes` / `last` 一律当没有 —— [planOf] 只认 `steps` / `unlock`
 *
 * 剩下两条钩子也留在这里, 它们跟排期没关系, 只是历史上长在这个文件里:
 * [wakeHost] (判断层那一拍 / 门户「唤醒一下」共用) 与 [unlockAtSchedule] (探索 / 主动场共用)
 */
internal object ExploreSchedule {

    private const val TAG = "LwExplore"

    const val DIRECTORY = "lw"
    const val FILE = "explore-schedule.json"

    /**
     * 每场预算的缺省与范围 (2.7.9 第 8 条 T2)
     *
     * 两个数与宿主那侧 `EXPLORE_STEPS_DEFAULT` / `EXPLORE_STEPS_RANGE` **必须一样** —— 应用只是把这一步数
     * 交给宿主, 真正的夹取仍由宿主做; `tools/check-explore.mjs` 钉着这一对. 分钟那一路 2026-11-21 已撤
     * (宿主内部 `deadline` 只当看门狗, 不再是用户设置)
     */
    const val STEPS_DEFAULT = 60
    val STEPS_RANGE = 1..1000

    /**
     * 宿主不在时最多等它多久 (毫秒)
     *
     * 平时从 `startForegroundService` 到 dsh 打出就绪行是几秒; 首次解包那棵树要更久, 所以给到三分钟
     */
    const val HOST_WAIT_MS = 180_000L

    /** 等宿主时多久看一眼 */
    private const val HOST_POLL_MS = 200L

    private val json = Json { ignoreUnknownKeys = true }
    private val lock = Any()

    /** 排期文件里还剩的两格: 每场步数 / 到点允不允许解屏 */
    data class Plan(
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

    /** 现在这份配置 (读不到 / 读坏了都按缺省: 60 步, 不解屏) */
    fun plan(context: Context): Plan {
        val raw = runCatching { file(context).takeIf { it.isFile }?.readText() }.getOrNull()
            ?: return Plan()
        val root = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
            ?: return Plan()
        return planOf(root)
    }

    /** 一份 JSON -> 配置 (纯函数; 预算按宿主那个范围夹, 不认识的键不看) */
    fun planOf(root: JsonObject): Plan {
        val steps = clamp(root["steps"]?.jsonPrimitive?.intOrNull, STEPS_RANGE, STEPS_DEFAULT)
        // 允许锁屏解锁 (2.7.10): 老文件没有这个键, 那就是关着 —— 与别的开关同一个"缺省关"的规矩
        val unlock = root["unlock"]?.jsonPrimitive?.booleanOrNull ?: false
        return Plan(steps, unlock)
    }

    /** 写配置 (单写者, 原子写); 2026-11-21 起不再排闹钟, 也不写开关 / 时刻 / 上一趟 */
    fun save(context: Context, plan: Plan) = synchronized(lock) {
        val target = file(context)
        target.parentFile?.mkdirs()
        val root = buildJsonObject {
            put("v", 1)
            put("updatedAt", System.currentTimeMillis())
            // 每场预算: 落盘也夹一遍, 别让手改的文件写进一个越界的数
            put("steps", clamp(plan.steps, STEPS_RANGE))
            // 探索里那条 lw_lock op=unlock 要过它 (与「锁屏」那段「唤醒时自动解锁」是两个开关)
            put("unlock", plan.unlock)
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
    }

    /** 拉起宿主那一步的读数: 成没成, 以及没成时那句话 */
    data class HostWake(val ok: Boolean, val why: String? = null)

    /**
     * 宿主不在时把它拉起来, 等就绪最多 [HOST_WAIT_MS]; 已经在跑就直接算成功
     *
     * 只该在自己的 worker 线程上调 (它会睡)。等的时候拿一把 partial wakelock: 这一档常常发生在 Doze 里,
     * 那几秒的唤醒窗口撑不到 dsh 打出就绪行, CPU 一睡这轮等待就停在半路
     *
     * **`onStarted` 是 2026-11-07 加的**: 广播那头 (`goAsync`) 必须等服务**真的开始启动**之后才能
     * `finish()` —— Android 12 起从后台启动前台服务的豁免挂在广播带来的临时白名单上, 先松手再
     * `startForegroundService` 等于把豁免丢在门外
     *
     * 2026-11-21 起用它的是判断层那一拍 (`RouterTick`) 与门户「唤醒一下」(`PortalBridge`), 不再有排期
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

    /**
     * 探索里 (以及主动场里) 先把锁屏让开 (2.7.10, 主人 2026-10-25: "探索时使用锁屏的解锁功能")
     *
     * 走的就是「锁屏」那一段的 [LockReplay]: 三条点亮路 + 主人自己录的那一串 (或注入密码); 回一句
     * **"开始前屏幕怎么了"**, 没什么可做的就回 null
     *
     * 三条边界都在这里: **没录过就不放**(只会白点亮一次屏), **失败太多次也不放**(那是 `LockTries`
     * 的闸, 别让自动解锁的计数蹭光), 而**放不出去也不挡这一场** —— 探索照开, 只是停在锁屏
     *
     * [tag] 只进 `LockReplay` 的日志, 用来说明是谁在放锁屏
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
}
