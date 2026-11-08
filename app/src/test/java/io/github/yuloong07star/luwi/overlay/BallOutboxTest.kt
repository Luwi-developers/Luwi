package io.github.yuloong07star.luwi.overlay

import io.github.yuloong07star.luwi.tool.SimSetting
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 输出队列那三笔算式的判据 (2026-11-07)
 *
 * 主人这一天的口径是"分条发送时要等上一条消息结束": 排队本身在 [OverlayService] 里, 而"等多久"
 * 与"满了怎么办"是纯算式 —— 它们最容易在真机上"看着差不多"却差一口气 (间隔太短就看成一条,
 * 满了丢话就少说一句), 所以钉在这里
 *
 * 2026-11-07 晚: 停顿那两段算式改由「更多设置」的 [SimSetting.Send] 给 (缺省值与 QQ 桥接的
 * 二代仿真同一套), 于是这里量的是"传进去的那一份", 不再是写死的两个常量
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
        assertEquals(listOf("a"), BallOutbox.mergeOverflow(emptyList(), "a"))
    }

    @Test
    fun `满队列再来的那条接在最后一条后面`() {
        val full = listOf("a", "b", "c", "d", "e", "f")
        val merged = BallOutbox.mergeOverflow(full, "g")
        assertEquals(BallOutbox.MAX, merged.size)
        assertEquals("f\ng", merged.last())
    }

    /* ── 排队: 没满就追加, 满了就合并 ──────────────────────────────────── */

    @Test
    fun `没满追加`() {
        assertEquals(listOf("a", "b"), BallOutbox.offer(listOf("a"), "b"))
    }

    @Test
    fun `满了合并`() {
        val full = List(BallOutbox.MAX) { "$it" }
        val offered = BallOutbox.offer(full, "最后")
        assertEquals(BallOutbox.MAX, offered.size)
        assertTrue("got ${offered.last()}", offered.last().endsWith("\n最后"))
    }

    @Test
    fun `空白的一条不排队`() {
        assertEquals(listOf("a"), BallOutbox.offer(listOf("a"), "   "))
    }
}
