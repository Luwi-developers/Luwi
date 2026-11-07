package io.github.yuloong07star.luwi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 敲钟间隔的判据 (2026-11-07)
 *
 * 主人要的是"不定时触发" —— 固定时刻会让人觉出"这是闹钟"。所以这一条钉的是**区间**而不是某个数:
 * 抽到 0 就是下限、抽到 1 就是上限、中间单调, 而越界的输入被夹回去 (真机上 `Random.nextFloat()`
 * 永远是 0~1, 但这一条不该依赖调用方守规矩)
 */
class RouterTickTest {

    @Test
    fun `抽到最小就是最短间隔`() {
        assertEquals(RouterTick.MIN_GAP_MS, RouterTick.gapFor(0f))
    }

    @Test
    fun `抽到最大就是最长间隔`() {
        assertEquals(RouterTick.MAX_GAP_MS, RouterTick.gapFor(1f))
    }

    @Test
    fun `中间那一下落在区间里`() {
        val gap = RouterTick.gapFor(0.5f)
        assertTrue("got $gap", gap > RouterTick.MIN_GAP_MS && gap < RouterTick.MAX_GAP_MS)
    }

    @Test
    fun `越界的输入被夹回区间`() {
        assertEquals(RouterTick.MIN_GAP_MS, RouterTick.gapFor(-3f))
        assertEquals(RouterTick.MAX_GAP_MS, RouterTick.gapFor(9f))
    }

    @Test
    fun `间隔单调 - 抽得大等得久`() {
        val small = RouterTick.gapFor(0.2f)
        val large = RouterTick.gapFor(0.8f)
        assertTrue("small $small, large $large", large > small)
    }
}
