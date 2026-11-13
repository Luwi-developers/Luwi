package io.github.yuloong07star.luwi.tool

import io.github.yuloong07star.luwi.automation.AutomationCalendar
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 唤醒间隔的判据 (2026-11-07)
 *
 * 主人要的是"不定时触发" —— 固定时刻会让人觉出"这是闹钟"。所以这一条钉的是**区间**而不是某个数:
 * 抽到 0 就是下限、抽到 1 就是上限、中间单调, 而越界的输入被夹回去 (真机上 `Random.nextFloat()`
 * 永远是 0~1, 但这一条不该依赖调用方守规矩)
 *
 * 2026-11-10 (方案 E) 多了"准点那一拍": 有事件型检测项时按"开始前 N 分钟"排, 而**提前量由应用自己
 * 算** —— 宿主是投完收件箱才判断的, 它写下来的时刻赶不上这一次排闹钟
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

    /* ── 准点那一拍 (2026-11-10, 方案 E) ──────────────────────────────────── */

    /** 一个固定的"现在" (只用来算相对时刻, 不对应哪一天) */
    private val now = 1_762_740_000_000L

    private val minute = 60_000L

    private fun eventCheck(
        id: String = "c1",
        beforeMinutes: Int = 30,
        titleContains: String? = null,
        calendarIds: List<Long> = emptyList(),
        enabled: Boolean = true,
    ) = RouterChecks.Check(
        id = id,
        what = id,
        kind = "event",
        packageName = null,
        minutes = 0,
        at = null,
        enabled = enabled,
        from = null,
        beforeMinutes = beforeMinutes,
        titleContains = titleContains,
        calendarIds = calendarIds,
    )

    private fun meeting(
        begin: Long,
        title: String = "上班",
        allDay: Boolean = false,
        calendarId: Long = 7L,
    ) = AutomationCalendar.Occurrence(
        eventId = 1L,
        calendarId = calendarId,
        title = title,
        begin = begin,
        end = begin + 60 * minute,
        allDay = allDay,
    )

    @Test
    fun `事件落在两小时内就按开始前 N 分钟排`() {
        val lead = RouterTick.leadAtOf(
            listOf(eventCheck(beforeMinutes = 30)),
            listOf(meeting(now + 90 * minute)),
            emptyMap(),
            now,
        )
        assertEquals(now + 60 * minute, lead.next)
        assertEquals(false, lead.open)
    }

    @Test
    fun `两小时以外的事件不影响随机间隔`() {
        val lead = RouterTick.leadAtOf(
            listOf(eventCheck(beforeMinutes = 30)),
            listOf(meeting(now + 5 * 60 * minute)),
            emptyMap(),
            now,
        )
        assertEquals(0L, lead.next)
        assertEquals(false, lead.open)
    }

    @Test
    fun `全天事件与已经开始的事件都不算 - 前者该走 time`() {
        val lead = RouterTick.leadAtOf(
            listOf(eventCheck(beforeMinutes = 30)),
            listOf(meeting(now + 10 * minute, allDay = true), meeting(now - 5 * minute)),
            emptyMap(),
            now,
        )
        assertEquals(0L, lead.next)
        assertEquals(false, lead.open)
    }

    @Test
    fun `窗口开着且没说过时一分钟后再来`() {
        val lead = RouterTick.leadAtOf(
            listOf(eventCheck(beforeMinutes = 30)),
            listOf(meeting(now + 10 * minute)),
            emptyMap(),
            now,
        )
        assertEquals(true, lead.open)
        assertEquals(RouterTick.LEAD_SOON_MS, RouterTick.gapWithLead(0.5f, RouterTick.MIN_GAP_MS, RouterTick.MAX_GAP_MS, lead, now))
    }

    @Test
    fun `窗口开着但那场说过就回到随机间隔`() {
        val begin = now + 10 * minute
        val said = mapOf("c1" to RouterTick.dayKeyOf(now) + "@" + begin)
        val lead = RouterTick.leadAtOf(listOf(eventCheck(beforeMinutes = 30)), listOf(meeting(begin)), said, now)
        assertEquals(false, lead.open)
        assertEquals(
            RouterTick.gapFor(0.5f, RouterTick.MIN_GAP_MS, RouterTick.MAX_GAP_MS),
            RouterTick.gapWithLead(0.5f, RouterTick.MIN_GAP_MS, RouterTick.MAX_GAP_MS, lead, now),
        )
    }

    @Test
    fun `标题与日历都筛, 不匹配的那些一条都不算`() {
        val checks = listOf(
            eventCheck(id = "c1", beforeMinutes = 30, titleContains = "周会"),
            eventCheck(id = "c2", beforeMinutes = 30, calendarIds = listOf(9L)),
        )
        val lead = RouterTick.leadAtOf(
            checks,
            listOf(meeting(now + 20 * minute, title = "买菜"), meeting(now + 25 * minute, calendarId = 7L)),
            emptyMap(),
            now,
        )
        assertEquals(0L, lead.next)
        assertEquals(false, lead.open)
    }

    @Test
    fun `关掉的那一条不参与, 没有事件项时什么都不算`() {
        assertEquals(
            RouterTick.Lead(),
            RouterTick.leadAtOf(
                listOf(eventCheck(enabled = false)),
                listOf(meeting(now + 20 * minute)),
                emptyMap(),
                now,
            ),
        )
        assertEquals(RouterTick.Lead(), RouterTick.leadAtOf(emptyList(), listOf(meeting(now + 20 * minute)), emptyMap(), now))
    }

    @Test
    fun `两个事件时取最近的那一刻`() {
        val lead = RouterTick.leadAtOf(
            listOf(eventCheck(id = "c1", beforeMinutes = 5), eventCheck(id = "c2", beforeMinutes = 60)),
            listOf(meeting(now + 120 * minute), meeting(now + 40 * minute)),
            emptyMap(),
            now,
        )
        assertEquals(now + 35 * minute, lead.next)
    }

    @Test
    fun `到点那一刻不排到"现在" - 有下限`() {
        val lead = RouterTick.Lead(next = now + 1, open = false)
        assertEquals(RouterTick.LEAD_FLOOR_MS, RouterTick.gapWithLead(0.5f, RouterTick.MIN_GAP_MS, RouterTick.MAX_GAP_MS, lead, now))
    }

    @Test
    fun `日期键与宿主同一个口径`() {
        assertEquals(true, Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(RouterTick.dayKeyOf(now)))
    }
}
