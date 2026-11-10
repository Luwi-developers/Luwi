package io.github.yuloong07star.luwi.overlay

import io.github.yuloong07star.luwi.tool.SimSetting
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 输出队列那三笔算式的判据 (2026-11-07; 2026-11-08 起队列里的一条是 [BallSay])
 *
 * 主人这一天的口径是"分条发送时要等上一条消息结束": 排队本身在 [OverlayService] 里, 而"等多久"
 * 与"满了怎么办"是纯算式 —— 它们最容易在真机上"看着差不多"却差一口气 (间隔太短就看成一条,
 * 满了丢话就少说一句), 所以钉在这里
 *
 * 2026-11-07 晚: 停顿那两段算式改由「更多设置」的 [SimSetting.Send] 给 (缺省值与 QQ 桥接的
 * 二代仿真同一套), 于是这里量的是"传进去的那一份", 不再是写死的两个常量
 *
 * 2026-11-08: 队列里的一条不再是 `String` 而是 [BallSay] —— 它自己带着 `gapMs` (`lw_say` 写进 jsonl
 * 的那一份, 门户与球读同一份)。`gapMs < 0` 才是老路径, 那时才用 [BallOutbox.gapFor] 兜底
 */
class BallOutboxTest {

    /** 缺省那一份: 基础 1~3 s / 每字 20 ms / 两成长停顿 */
    private val plan = SimSetting.Send()

    /* ── 停顿: 短句快, 长句慢, 两头都有闸 ──────────────────────────────── */

    @Test
    fun `空串给下限`() {
        assertEquals(plan.gapMinMs, BallOutbox.gapFor("", plan, 0.99f))
    }

    @Test
    fun `一个字的停顿是下限加一个字的时`() {
        assertEquals(plan.gapMinMs + plan.perCharMs, BallOutbox.gapFor("嗯", plan, 0.99f))
    }

    @Test
    fun `长句给到上限但不超过`() {
        val gap = BallOutbox.gapFor("这是一句很长的话, 长到足够把停顿顶到上限去, 所以它应该停在上限".repeat(20), plan, 0.99f)
        assertEquals(plan.gapMaxMs, gap)
    }

    @Test
    fun `抽中长停顿那一档就用长停顿的范围`() {
        assertEquals(plan.longGapMinMs, BallOutbox.gapFor("嗯", plan, 0f))
    }

    @Test
    fun `关掉分条时队列收成一条`() {
        assertEquals(1, BallOutbox.limitOf(plan.copy(burstEnabled = false)))
        assertEquals(plan.burstMaxMessages, BallOutbox.limitOf(plan))
    }

    @Test
    fun `条数上限不会超过框那六条`() {
        assertEquals(BallOutbox.MAX, BallOutbox.limitOf(plan.copy(burstMaxMessages = 99)))
    }

    /* ── 满了合并, 不丢 ──────────────────────────────────────────────── */

    @Test
    fun `空队列里合并出一条`() {
        assertEquals(listOf(BallSay("a")), BallOutbox.mergeOverflow(emptyList(), BallSay("a")))
    }

    @Test
    fun `满队列再来的那条接在最后一条后面`() {
        val full = List(BallOutbox.MAX) { BallSay("$it") }
        val merged = BallOutbox.mergeOverflow(full, BallSay("g"))
        assertEquals(BallOutbox.MAX, merged.size)
        assertEquals("${BallOutbox.MAX - 1}\ng", merged.last().text)
    }

    @Test
    fun `合并只动正文, 节奏留着`() {
        val full = List(BallOutbox.MAX) { BallSay("$it", gapMs = 1200L) }
        val merged = BallOutbox.mergeOverflow(full, BallSay("g"))
        assertEquals(1200L, merged.last().gapMs)
    }

    /* ── 排队: 没满就追加, 满了就合并 ──────────────────────────────────── */

    @Test
    fun `没满追加`() {
        assertEquals(listOf(BallSay("a"), BallSay("b")), BallOutbox.offer(listOf(BallSay("a")), BallSay("b")))
    }

    @Test
    fun `满了合并`() {
        val full = List(BallOutbox.MAX) { BallSay("$it") }
        val offered = BallOutbox.offer(full, BallSay("最后"))
        assertEquals(BallOutbox.MAX, offered.size)
        assertTrue("got ${offered.last().text}", offered.last().text.endsWith("\n最后"))
    }

    @Test
    fun `空白的一条不排队`() {
        assertEquals(listOf(BallSay("a")), BallOutbox.offer(listOf(BallSay("a")), BallSay("   ")))
    }

    /* ── 老路径与那一份文件的分别: 带不带自己的节奏 ────────────────────── */

    @Test
    fun `老路径进来的那一条没有自己的节奏`() {
        assertEquals(-1L, BallSay("嗯").gapMs)
    }

    @Test
    fun `表情那一条也排得进队列`() {
        val offered = BallOutbox.offer(listOf(BallSay("在的。")), BallSay("", sticker = "开心"))
        assertEquals(2, offered.size)
        assertEquals("开心", offered.last().sticker)
    }

    /* ── 图与文件那两条 (2026-11-09) ───────────────────────────────────── */

    @Test
    fun `文件那一条也排得进队列 (不再兜「（文件）」)`() {
        val offered = BallOutbox.offer(
            listOf(BallSay("在的。")),
            BallSay("", file = "7-__.png", fileRel = "assets/s/7-__.png", fileBytes = 883_829L),
        )
        assertEquals(2, offered.size)
        assertEquals("7-__.png", offered.last().file)
        assertEquals("assets/s/7-__.png", offered.last().fileRel)
        assertEquals(883_829L, offered.last().fileBytes)
    }

    @Test
    fun `只有正文是空、文件在场时也不算空条`() {
        // 纯图 / 纯文件那一条正文是空串 —— 它不是"没话说", 是"话在东西上"
        assertEquals(1, BallOutbox.offer(emptyList(), BallSay("", image = "assets/s/1-a.png")).size)
        assertEquals(1, BallOutbox.offer(emptyList(), BallSay("", file = "a.pdf", fileRel = "assets/s/a.pdf")).size)
    }

    @Test
    fun `有媒体时满了丢最旧那条, 不把媒体合成一串字`() {
        val full = List(BallOutbox.MAX) { BallSay("$it") }
        val merged = BallOutbox.mergeOverflow(full, BallSay("", image = "assets/s/9-z.png"))
        assertEquals(BallOutbox.MAX, merged.size)
        // 最旧的那条走了, 新的一条排在队尾 (顺序不乱), 图还带着它自己那份
        assertEquals("1", merged.first().text)
        assertEquals("assets/s/9-z.png", merged.last().image)
    }

    @Test
    fun `文字接在媒体后面也不合并 (会吃掉那条媒体)`() {
        val full = List(BallOutbox.MAX - 1) { BallSay("$it") } + BallSay("", sticker = "开心")
        val merged = BallOutbox.mergeOverflow(full, BallSay("再来一句"))
        assertEquals(BallOutbox.MAX, merged.size)
        assertEquals("再来一句", merged.last().text)
        assertTrue(merged.none { it.text.contains("\n再来一句") })
    }
}
