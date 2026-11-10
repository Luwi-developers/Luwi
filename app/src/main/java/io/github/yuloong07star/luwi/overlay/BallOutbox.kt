package io.github.yuloong07star.luwi.overlay

import io.github.yuloong07star.luwi.tool.SimSetting

/**
 * 队列里的一条 (2026-11-08 起不再只是一段文本)
 *
 * 那一份 jsonl 里的每一行都带着它自己的 `gapMs` (`lw_say` 写下来的, 门户与球读同一份), 所以队列里
 * 的一条要能把它带上:
 *
 * - `gapMs >= 0`: **它自己带着节奏** —— 照它放, 不再各自抽随机
 * - `gapMs < 0`: 老路径 (`overlay op=reply` / `op=burst` / `op=say`) 放进去的, 按 [BallOutbox.gapFor]
 *   现场算 (那些路没有一份文件可以读)
 *
 * `sticker` / `image` 二选一非空就是"这一条要画一张图"; `image` 是行里的 `rel` (相对 `lw/out`)
 */
internal data class BallSay(
    val text: String,
    val gapMs: Long = -1L,
    val sticker: String = "",
    val image: String = "",
    val session: String = "",
    /** 她主动冒的一句 (`overlay op=say`): 画进同一块只读区, 但不写回复那几笔账 */
    val say: Boolean = false,
    /**
     * `kind=file` 那一行 (2026-11-09): 文件名 / 行里的相对路径 / 字节数
     *
     * 以前球上把它压成「（文件）」三个字 —— 主人那一句是"文件也可点击", 于是这里得把名字与路径带上,
     * 画成一颗能点的 chip (点开走悬浮预览窗)
     */
    val file: String = "",
    val fileRel: String = "",
    val fileBytes: Long = 0L,
) {
    /** 是不是"纯文字"那一条 (媒体那三种合并不出来, 见 [BallOutbox.mergeOverflow]) */
    val isPlainText: Boolean
        get() = sticker.isEmpty() && image.isEmpty() && file.isEmpty()
}

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
    /**
     * 满了再排一条: **两边都是纯文字才合并**, 否则丢最旧的那条 (2026-11-09)
     *
     * 媒体那三种 (`sticker` / `image` / `file`) 合不出来 —— 一段字接一个文件名只剩一串字, 图更是直接
     * 没了。所以满队列时的规矩分两种:
     *
     * - 双方都纯文字 → 接在最后一条后面 (字都在, 换行之后仍看得出是两件事)
     * - 有一方是媒体 → **丢最旧的那一条** (`drop(1)`), 新的一条排在队尾: 顺序不乱, 而"最旧的已经过时"
     */
    fun mergeOverflow(queued: List<BallSay>, line: BallSay): List<BallSay> {
        if (queued.isEmpty()) return listOf(line)
        val last = queued.last()
        if (last.isPlainText && line.isPlainText) {
            return queued.dropLast(1) + last.copy(text = last.text + "\n" + line.text)
        }
        return queued.drop(1) + line
    }

    /**
     * 排一条 (纯函数): 没满就追加, 满了就合并, 回一份新的表
     *
     * 调用方拿回新表之后整份替换自己的队列, 于是"有界"这件事只有一个地方说了算。合并只动 `text`,
     * 那一条自己的 `gapMs` 留着 —— 节奏不因为合并而变
     */
    fun offer(queued: List<BallSay>, line: BallSay, limit: Int = MAX): List<BallSay> {
        if (line.text.isBlank() && line.sticker.isEmpty() && line.image.isEmpty() && line.file.isEmpty()) {
            return queued
        }
        val capped = limit.coerceIn(1, MAX)
        if (queued.size < capped) return queued + line
        return mergeOverflow(queued, line)
    }
}
