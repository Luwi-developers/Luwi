package io.github.yuloong07star.luwi.overlay

import io.github.yuloong07star.luwi.tool.SimSetting

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

    /** 两条之间的停顿下限 (没有 plan 时的兜底, 2026-11-07 之前的那个手感) */
    const val GAP_MIN_MS = 320L

    /** 两条之间的停顿上限 (同上) */
    const val GAP_MAX_MS = 720L

    /**
     * 念的时候隔多久再看一眼"念完了没有"
     *
     * 朗读引擎没有回调进这一层 (它有自己的状态), 所以只能问 [LwSpeak.talking]; 这个间隔只决定
     * "晚多少毫秒发现它念完了", 不影响任何一句的内容
     */
    const val SPEAK_POLL_MS = 220L

    /** 这一档的队列上限: 主人关掉分条 (`burstEnabled`) 时收成一条, 于是几条会合成一段话 */
    fun limitOf(send: SimSetting.Send): Int =
        if (send.burstEnabled) send.burstMaxMessages.coerceIn(1, MAX) else 1

    /**
     * 上一条画完到放下一条之间等多久 (纯函数)
     *
     * 2026-11-07 晚: 两段算式都交给 [send] —— 它来自「更多设置」那一页, 缺省值照 QQ 桥接的
     * `socialV2.send` (基础 1~3 s, 每字 20 ms, 两成概率换成 5~10 s 的长停顿)。[roll] 传进来而
     * 不是在里面取, 于是"什么时候落到长停顿那一档"在没有设备的地方也量得动
     */
    fun gapFor(
        text: String,
        send: SimSetting.Send = SimSetting.Send(),
        roll: Float = 0f,
    ): Long {
        val bounded = roll.coerceIn(0f, 1f)
        if (bounded < send.longGapProbability) {
            val low = minOf(send.longGapMinMs, send.longGapMaxMs)
            val high = maxOf(send.longGapMinMs, send.longGapMaxMs)
            return low + ((high - low) * bounded).toLong()
        }
        val low = minOf(send.gapMinMs, send.gapMaxMs)
        val high = maxOf(send.gapMinMs, send.gapMaxMs)
        return (low + text.length * send.perCharMs).coerceIn(low, high)
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
    fun offer(queued: List<String>, line: String, limit: Int = MAX): List<String> {
        val wanted = line.trim()
        if (wanted.isEmpty()) return queued
        val capped = limit.coerceIn(1, MAX)
        if (queued.size < capped) return queued + wanted
        return mergeOverflow(queued, wanted)
    }
}
