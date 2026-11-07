package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.os.PowerManager
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 会话期唤醒锁 (2026-11-07)
 *
 * 与 [LwKeepAwake] 的分工: 那一把是**模型显式按的** (`lw_keep_awake`), 谁开谁关, 没有超时;
 * 这一把是**排期自己按的** —— 一场探索 / 一次主动对话跑起来之后, 能把它按住的只有应用这一侧,
 * 因为模型可能一个工具都不调, 也可能半路被打断
 *
 * 为什么需要它: 熄屏之后 CPU 会 suspend, 而宿主 (Node) 的定时器 / 网络回调 / 模型请求全挂在 CPU
 * 上 —— 现象是"凌晨三点投出去了, 早上看 `explore.json` 只走了两三步"。Doze 白名单
 * ([io.github.yuloong07star.luwi.util.BatteryWhitelist]) 只管"不掐网络 / 不忽略唤醒锁", 它不会
 * 替你按住 CPU
 *
 * 三条边界:
 *
 * 1. **一定带超时** (`acquire(timeoutMs)`): 到点系统自己释放, 一把忘掉的锁最多耗到预算尽头
 * 2. **同一支重复按下先放旧的**: 设置页连着改时刻会连着投, 不能叠成两把
 * 3. **收尾就提前放** ([reconcile]): 宿主那边 `explore.json` 一改 (`over` / 过了 deadline),
 *    心跳下一拍就放手, 不必等超时
 */
internal object LwSessionLock {

    private const val TAG = "LwSessionLock"

    /** 探索那一场 */
    const val TAG_EXPLORE = "explore"

    /** 主动对话那一场 */
    const val TAG_PROACTIVE = "proactive"

    /** `dumpsys power` 里看到的名字: 与 `luwi:keep-awake` / `luwi:explore-host` 一眼分得清 */
    private const val LOCK_NAME = "luwi:session"

    /** 收尾那几秒也留着: 模型写摘要 / 归还虚拟屏还在里面 */
    const val SLACK_MS = 10 * 60_000L

    private val guard = Any()

    /** tag -> 那一把锁 (只在这一个进程里活着, 重启即无 —— 唤醒锁本来就不跨进程) */
    private val locks = HashMap<String, PowerManager.WakeLock>()

    /** tag -> 按到哪一刻, 读数用 */
    private val until = HashMap<String, Long>()

    /**
     * 按下一把 (幂等): 同一 tag 已经有就换新的
     *
     * @return 按到哪一刻 (epoch 毫秒); 拿不到电源管理器时 0
     */
    fun hold(context: Context, tag: String, timeoutMs: Long): Long = synchronized(guard) {
        val manager = context.applicationContext.getSystemService(PowerManager::class.java)
            ?: return 0L
        val now = System.currentTimeMillis()
        val budget = timeoutMs.coerceAtLeast(60_000L)
        locks.remove(tag)?.let { old -> runCatching { if (old.isHeld) old.release() } }
        val fresh = runCatching {
            manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, LOCK_NAME).apply { acquire(budget) }
        }.onFailure { Log.w(TAG, "the session lock for $tag could not be held", it) }.getOrNull()
            ?: return 0L
        locks[tag] = fresh
        val deadline = now + budget
        until[tag] = deadline
        Log.i(TAG, "holding a session wake lock for $tag until ${stamp(deadline)} (${budget / 60_000} min)")
        deadline
    }

    /** 放掉一把 (幂等): 本来就没按着回 false, 不假装刚生效 */
    fun release(tag: String): Boolean = synchronized(guard) {
        val lock = locks.remove(tag)
        until.remove(tag)
        if (lock == null) return false
        val held = lock.isHeld
        runCatching { if (held) lock.release() }
        if (held) Log.i(TAG, "released the session wake lock for $tag")
        held
    }

    /** 进程退出 / 宿主停掉时把每一把都放掉 (别留一个看不见的电量黑洞) */
    fun releaseAll() = synchronized(guard) {
        locks.keys.toList().forEach { release(it) }
    }

    /** 现在按着吗 */
    fun held(tag: String): Boolean = synchronized(guard) { locks[tag]?.isHeld == true }

    /**
     * 不跑了就放 (心跳那一拍叫)
     *
     * "还在跑"由调用方给 ([ExploreTask.running] 那本账), 这一层不自己读文件
     */
    fun reconcile(tag: String, stillRunning: Boolean) {
        if (stillRunning) return
        release(tag)
    }

    /** 给 `last.why` 与状态读数用的一句话: 没按着就是空串 */
    fun describe(tag: String): String = synchronized(guard) {
        if (locks[tag]?.isHeld != true) return ""
        val deadline = until[tag] ?: return "唤醒锁按着"
        "唤醒锁按到 ${stamp(deadline)}"
    }

    private fun stamp(at: Long): String = SimpleDateFormat("HH:mm", Locale.ROOT).format(Date(at))
}
