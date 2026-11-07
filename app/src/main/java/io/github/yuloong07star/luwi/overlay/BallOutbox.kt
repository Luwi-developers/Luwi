package io.github.yuloong07star.luwi.overlay

/**
 * 往框里放东西的队列 (2026-11-07)
 *
 * 主人这一天的三条口径:
 *
 * 1. **分条发送时, 要等上一条消息结束** —— "结束" = 画进框 + (开了朗读时) 念完, 再等一小段停顿
 * 2. **下一条到达时不改变用户已输入的内容** —— 于是这个队列只管"哪一句该画", 一条都不碰输入框
 *    (输入与输出的分工在 [BoxView] 里, 这里连 View 都不认识)
 * 3. 一个框里显示, 所以排队的是同一块只读区里的条, 不是另开窗口
 *
 * 三个纯函数钉在 `BallOutboxTest` 上, 没有设备也能跑; [OverlayService] 只负责把它们串成
 * "画一条 -> 等 -> 再画一条"
 */
internal object BallOutbox {

    /** 一次最多排几条: 再多就该她自己收敛, 不是框的事 */
    const val MAX = 6

    /** 两条之间的停顿下限: 太短会看成同一条, 太长会以为卡住了 */
    const val GAP_MIN_MS = 320L

    /** 两条之间的停顿上限 */
    const val GAP_MAX_MS = 720L

    /**
     * 念的时候隔多久再看一眼"念完了没有"
     *
     * 朗读引擎没有回调进这一层 (它有自己的状态), 所以只能问 [LwSpeak.talking]; 这个间隔只决定
     * "晚多少毫秒发现它念完了", 不影响任何一句的内容
     */
    const val SPEAK_POLL_MS = 220L

    /**
     * 上一条画完到放下一条之间等多久 (纯函数)
     *
     * 按字数给: 短句几乎没有等待, 长句多给一点 —— 读得完的量级才像人在说话
     */
    fun gapFor(text: String): Long {
        val wanted = GAP_MIN_MS + text.length * 8L
        return wanted.coerceIn(GAP_MIN_MS, GAP_MAX_MS)
    }

    /**
     * 队列满了怎么办: **合并进最后一条, 不丢**
     *
     * 丢话是最伤的那种省事 —— 她说的话少了一句, 主人只会以为她没说完。合起来至少字都在,
     * 而且换行之后仍然看得出是两件事
     */
    fun mergeOverflow(queued: List<String>, line: String): List<String> =
        if (queued.isEmpty()) listOf(line)
        else queued.dropLast(1) + (queued.last() + "\n" + line)

    /**
     * 排一条 (纯函数): 没满就追加, 满了就合并, 回一份新的表
     *
     * 调用方拿回新表之后整份替换自己的队列, 于是"有界"这件事只有一个地方说了算
     */
    fun offer(queued: List<String>, line: String): List<String> {
        val wanted = line.trim()
        if (wanted.isEmpty()) return queued
        if (queued.size < MAX) return queued + wanted
        return mergeOverflow(queued, wanted)
    }
}
