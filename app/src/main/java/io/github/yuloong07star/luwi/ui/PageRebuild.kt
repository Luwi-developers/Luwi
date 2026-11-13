package io.github.yuloong07star.luwi.ui

/**
 * renderer 死掉之后"还该不该自己重建、等多久再建"这一笔账
 *
 * 2026-11-13 真机那一档 (`docs/Luwi-真机-界面加载中-检查-2026-11-13.md`): 系统 lowmemorykiller 把
 * WebView 的 renderer 收了, 而原来的代码**一死就立刻换一块新的** —— 20:40:33 那 1.2 s 里连着换了 4 块,
 * 每块都在内存最紧的时刻又要 200 MB, 于是每块活 0.3~0.6 s 又被杀; 第 4 次时 `rebuilds > 3` 直接
 * `halted = true` 到底, 界面从此只剩开屏那块「界面加载中…」, 而唯一的复位口是 host 地址变 (重启 host)
 *
 * 现在这一笔账分三段:
 *
 * 1. **退避**: 第 1/2/3 次重建分别等 [backoffMs] 的 1 s / 3 s / 8 s, 别在内存抖动里连打
 * 2. **额度按时间窗还**: 上一次死亡距今超过 [windowMs] 就把计数清 0 —— 一次抖动不该吃光整个会话的额度
 * 3. **额度用光不等于放弃**: 回 null 只表示"该进慢档了", 由调用方进 30 s 慢档重试并给一个真按钮
 *
 * 纯 Kotlin, 时钟是参数 (与 [ScreenErrorOnce] 同一套写法), 所以规则本身能直接量, 不用等真机连死四回
 *
 * @param windowMs 多远的死亡还算"同一场事故"的额度
 * @param backoffMs 第 1 / 2 / 3 次重建各等多久 (多于数组长度时取最后一个)
 * @param maxRebuilds 一个窗口里最多自动重建几次
 */
internal class PageRebuild(
    private val windowMs: Long = 60_000L,
    private val backoffMs: LongArray = longArrayOf(1_000L, 3_000L, 8_000L),
    private val maxRebuilds: Int = 3,
) {

    /** 当前时间窗里已经自动重建过几次 */
    var rebuilds = 0
        private set

    /** 上一次死亡的时刻, 0 表示还没死过 (第一笔死亡不该被判成"过了窗口") */
    private var lastAt = 0L

    /**
     * 记一次 renderer 死亡, 并给出这一次的处置
     *
     * @param now 单调时钟的读数 ([android.os.SystemClock.uptimeMillis])
     * @return 该等多少毫秒再重建; **null = 窗口内额度用光** (调用方进慢档, 界面要给出口)
     */
    fun death(now: Long): Long? {
        // 上一次死亡过去够久: 上一场事故的额度不算数了 (一次抖动不吃光整个会话)
        if (lastAt != 0L && now - lastAt > windowMs) rebuilds = 0
        lastAt = now
        rebuilds += 1
        if (rebuilds > maxRebuilds) return null
        return backoffMs[minOf(rebuilds - 1, backoffMs.lastIndex)]
    }

    /** 页面真的画出来了 (`root` 有子节点): 上一次那几笔事故不该再占着额度 */
    fun rendered() {
        rebuilds = 0
    }

    /** host 地址换了 / 人点了「重新加载界面」: 上一轮整笔账都不作数 */
    fun reset() {
        rebuilds = 0
        lastAt = 0L
    }
}
