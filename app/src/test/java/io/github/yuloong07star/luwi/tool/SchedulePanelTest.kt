package io.github.yuloong07star.luwi.tool

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 设置页那一段读数 30 s 的去重窗口 (2.8.0 B4-c ⑫)
 *
 * 这条账做错的两个样子都不响: 窗口短了 = 两次进设置页重读两遍, 长 / 永不刷新 = 排期改了看不出来。
 * 所以边界钉在纯函数上 (正好 30 s 算该读), 不需要设备
 */
class SchedulePanelTest {

    @Test
    fun theFirstReadAlwaysRefreshes() {
        assertTrue(SchedulePanel.shouldRefresh(0L, 1_000L))
    }

    @Test
    fun aSecondEntryInsideThirtySecondsDoesNotRefresh() {
        val first = 10_000L

        assertFalse(SchedulePanel.shouldRefresh(first, first + 1L))
        assertFalse(SchedulePanel.shouldRefresh(first, first + 29_999L))
    }

    @Test
    fun exactlyThirtySecondsRefreshes() {
        val first = 10_000L

        assertTrue(SchedulePanel.shouldRefresh(first, first + SchedulePanel.WINDOW_MS))
        assertTrue(SchedulePanel.WINDOW_MS == 30_000L)
    }

    @Test
    fun aClockThatJumpedBackwardsStaysInsideTheWindow() {
        // 单调时钟正常不会回退; 真回退了也宁可少读一次, 不要一进页面就重读
        assertFalse(SchedulePanel.shouldRefresh(50_000L, 1_000L))
    }
}
