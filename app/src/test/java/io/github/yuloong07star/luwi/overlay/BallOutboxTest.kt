package io.github.yuloong07star.luwi.overlay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 输出队列那三笔算式的判据 (2026-11-07)
 *
 * 主人这一天的口径是"分条发送时要等上一条消息结束": 排队本身在 [OverlayService] 里, 而"等多久"
 * 与"满了怎么办"是纯算式 —— 它们最容易在真机上"看着差不多"却差一口气 (间隔太短就看成一条,
 * 满了丢话就少说一句), 所以钉在这里
 */
class BallOutboxTest {

    /* ── 停顿: 短句快, 长句慢, 两头都有闸 ──────────────────────────────── */

    @Test
    fun `空串给下限`() {
        assertEquals(BallOutbox.GAP_MIN_MS, BallOutbox.gapFor(""))
    }

    @Test
    fun `一个字的停顿落在下限附近`() {
        val gap = BallOutbox.gapFor("嗯")
        assertTrue("got $gap", gap in BallOutbox.GAP_MIN_MS..(BallOutbox.GAP_MIN_MS + 20))
    }

    @Test
    fun `长句给到上限但不超过`() {
        val gap = BallOutbox.gapFor("这是一句很长的话, 长到足够把停顿顶到上限去, 所以它应该停在上限".repeat(3))
        assertEquals(BallOutbox.GAP_MAX_MS, gap)
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
