package io.github.yuloong07star.luwi.overlay

import android.util.Log
import io.github.yuloong07star.luwi.tool.LwIn

/**
 * 选好的附件从 [io.github.yuloong07star.luwi.ui.PickMediaActivity] 交回球 (**进程内唯一一条路**)
 *
 * 为什么得有这么一层: 相册/文件那道闸只有 Activity 收得到结果, 而球那块输入框是 `OverlayService` 里的
 * 一个 View —— 它连 `startActivityForResult` 都没有。两者在**同一个进程** (都在 `:main`, 没有
 * `android:process`), 所以一份内存里的队列就够, 不必再落一个交接文件。
 *
 * 两条纪律:
 *
 * 1. **服务在就当场交出去** (`sink`), 框没开着由服务那边自己张回来 —— 主人点完 `+` 一定看得见结果
 * 2. 服务不在 (进程被杀那一下) 就先攒着, 下一次服务起来 `take()` 补上; 攒着的那几份已经在
 *    `<工作区>/lw-in/` 里了, 攒不住也只是"这次的附件没挂上", 不会丢文件
 */
internal object BallPicks {

    private const val TAG = "LwOverlay"

    private val lock = Any()

    /** 还没交出去的那几份 (只在服务不在时用得上) */
    private val waiting = ArrayDeque<LwIn.Pick>()

    @Volatile
    private var sink: ((List<LwIn.Pick>) -> Unit)? = null

    /** 服务挂上/摘掉它的接收口 (幂等) */
    fun bind(listener: ((List<LwIn.Pick>) -> Unit)?) {
        sink = listener
    }

    /** 选完了: 服务在就当场给, 不在就先攒着 */
    fun offer(picks: List<LwIn.Pick>) {
        if (picks.isEmpty()) return
        val listener = sink
        if (listener != null) {
            runCatching { listener(picks) }
            return
        }
        synchronized(lock) { waiting.addAll(picks) }
        Log.i(TAG, "picks: ${picks.size} kept until the overlay service comes back")
    }

    /** 取走攒着的那几份 (服务起来时补一次) */
    fun take(): List<LwIn.Pick> {
        synchronized(lock) {
            if (waiting.isEmpty()) return emptyList()
            val out = waiting.toList()
            waiting.clear()
            return out
        }
    }

    /** 服务收摊时把攒着的清掉 (那份文件仍在 `lw-in/` 里, 只是这次不挂了) */
    fun clear() {
        synchronized(lock) { waiting.clear() }
    }
}
