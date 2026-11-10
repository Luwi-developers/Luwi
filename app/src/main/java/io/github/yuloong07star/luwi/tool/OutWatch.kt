package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.os.FileObserver

/**
 * `$DSH_HOME/lw/out/` 的变更通知: **一个 observer, 两个听众** (2026-11-08)
 *
 * 门户与浮球读的是同一份 jsonl (见 [OutFile]), 所以盯目录这件事也只该有一处 —— 两边各起一个
 * `FileObserver` 不只是浪费, 还会出现"其中一个先看到、另一个后看到", 而那一瞬两块界面上的条数不一样。
 *
 * 与 `lw/ball-phase.json` 那套同一个写法 (文件说了算, 事件驱动零轮询): `$DSH_HOME` 在 `filesDir` 下,
 * 是真文件系统而不是 `/sdcard` 那个 FUSE, 所以 inotify 可用。
 *
 * **回调在 [FileObserver] 自己那条线程上** —— 谁要动界面 (主线程的东西), 自己 `handler.post` 一下。
 * 这里只把"哪一场变了"传出去 (文件名去掉 `.jsonl`), 认不出名字时传空串。
 */
internal object OutWatch {

    /** 原子写走的是 `CLOSE_WRITE` (直接写) 与 `MOVED_TO` (rename), `CREATE` 兜住新文件 */
    private const val MASK = FileObserver.CLOSE_WRITE or FileObserver.MOVED_TO or FileObserver.CREATE

    private val listeners = LinkedHashSet<(String) -> Unit>()

    private var observer: FileObserver? = null

    /**
     * 开始听 (幂等: 第二次调用只加一个听众)
     *
     * 回一个"摘掉这个听众"的函数。`startWatching()` 是 void, 盯没盯上问不到 —— 所以兜底不放在这儿:
     * 门户那侧每 3 s 的 `pollLedger` 会顺手补一次, 球那侧本来就有一拍 tick
     */
    fun watch(context: Context, listener: (String) -> Unit): () -> Unit {
        synchronized(listeners) { listeners.add(listener) }
        ensure(context)
        return {
            synchronized(listeners) { listeners.remove(listener) }
            Unit
        }
    }

    /** 起那个 observer (已经起了就什么都不做) */
    fun ensure(context: Context) {
        if (observer != null) return
        val dir = OutFile.dir(context.applicationContext)
        dir.mkdirs()
        val created = object : FileObserver(dir, MASK) {
            override fun onEvent(event: Int, name: String?) {
                val seen = name.orEmpty()
                val id = when {
                    seen.endsWith(OutFile.SUFFIX) -> seen.removeSuffix(OutFile.SUFFIX)
                    seen.endsWith("${OutFile.SUFFIX}.tmp") -> seen.removeSuffix("${OutFile.SUFFIX}.tmp")
                    else -> ""
                }
                // 只认 jsonl (这个目录以后可能还有别的东西)
                if (id.isEmpty() && !seen.isEmpty()) return
                notify(id)
            }
        }
        observer = created
        created.startWatching()
    }

    private fun notify(sessionId: String) {
        val copy = synchronized(listeners) { listeners.toList() }
        for (listener in copy) {
            runCatching { listener(sessionId) }
        }
    }
}
