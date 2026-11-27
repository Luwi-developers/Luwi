package io.github.yuloong07star.luwi.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * renderer 连死之后的重建账 (2026-11-13 真机「界面加载中」永久卡死)
 *
 * 钉五件事: 头三次死亡按 1 s / 3 s / 8 s 退避; 第四次回 null (额度 = 3); 上一次死亡过去够久就还额度;
 * 页面真的画出来之后额度还回来; 人点了重试 (或 host 地址换了) 之后整笔账清空
 *
 * 时钟是参数, 所以这里量的是规则本身, 不碰系统时间
 */
class PageRebuildTest {

    private val window = 60_000L

    @Test
    fun `the first three deaths back off one three eight seconds`() {
        val plan = PageRebuild(windowMs = window)
        assertEquals(1_000L, plan.death(10_000L))
        assertEquals(3_000L, plan.death(20_000L))
        assertEquals(8_000L, plan.death(30_000L))
        assertEquals(3, plan.rebuilds)
    }

    @Test
    fun `the fourth death inside the window gives up`() {
        val plan = PageRebuild(windowMs = window)
        plan.death(10_000L)
        plan.death(20_000L)
        plan.death(30_000L)
        // 真机现场就是这一笔: 1.2 s 里连死四回, 第 4 次不该再自动要一块新的
        assertNull(plan.death(31_200L))
        assertEquals(4, plan.rebuilds)
        // 之后每死一次都还是 null: 额度没还回来之前一直交给慢档
        assertNull(plan.death(32_000L))
    }

    @Test
    fun `a quiet window gives the budget back`() {
        val plan = PageRebuild(windowMs = window)
        plan.death(10_000L)
        plan.death(20_000L)
        plan.death(30_000L)
        assertNull(plan.death(31_000L))
        // 过了窗口 (60 s 以上没再死), 下一场事故从 1 s 那一档重新起
        assertEquals(1_000L, plan.death(31_000L + window + 1))
        assertEquals(1, plan.rebuilds)
    }

    @Test
    fun `a rendered page clears the budget`() {
        val plan = PageRebuild(windowMs = window)
        plan.death(10_000L)
        plan.death(20_000L)
        plan.rendered()
        assertEquals(0, plan.rebuilds)
        // 画出来过就说明上一次抖动过去了: 再死一次仍是 1 s 那一档
        assertEquals(1_000L, plan.death(21_000L))
    }

    @Test
    fun `reset starts a new session`() {
        val plan = PageRebuild(windowMs = window)
        plan.death(10_000L)
        plan.death(20_000L)
        plan.death(30_000L)
        assertNull(plan.death(31_000L))
        // 人点了「重新加载界面」/ host 地址换了: 上一轮整笔账作废
        plan.reset()
        assertEquals(0, plan.rebuilds)
        assertEquals(1_000L, plan.death(40_000L))
    }

    @Test
    fun `the default window is one minute and the budget is three`() {
        val plan = PageRebuild()
        plan.death(0L + 1_000L)
        plan.death(2_000L)
        plan.death(3_000L)
        // 窗口内第四次就交出去
        assertNull(plan.death(4_000L))
    }
}
