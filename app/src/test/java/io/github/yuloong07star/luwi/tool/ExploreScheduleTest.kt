package io.github.yuloong07star.luwi.tool

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId

/**
 * 探索排期那几条纯算术 (2.7.8 批次 8)
 *
 * 三个地方错了都不会当场报错, 只会在"该跑的那天没跑"或"到点了却跳过了"上表现出来:
 *
 * - [ExploreSchedule.nextAt]: 今天还没到就今天, 过了就明天; 时刻认不出来就是 null
 * - [ExploreSchedule.dueOf]: 关着 / 上一场 / 宿主三条, 顺序不能反 (**省电从 2026-10-26 起不在其中**,
 *   它只进 `last.why`, 所以这一条判据要钉住"省电开着也不跳过"); 宿主没在跑是"叫醒它"不是"跳过"
 *   (2.8.0 #9)
 * - [ExploreSchedule.planOf]: 读坏了退回"关着 + 03:00", 而不是让整段设置页炸掉
 */
class ExploreScheduleTest {

    private val zone = ZoneId.of("Asia/Shanghai")
    private val json = Json

    private fun moment(text: String): Long = OffsetDateTime.parse(text).toInstant().toEpochMilli()

    private fun stamp(at: Long): String =
        OffsetDateTime.ofInstant(Instant.ofEpochMilli(at), zone).toString()

    @Test
    fun theNextMomentIsTodayWhenTheTimeHasNotComeYet() {
        val now = moment("2026-10-18T01:00:00+08:00")

        assertEquals("2026-10-18T03:00+08:00", stamp(ExploreSchedule.nextAt("03:00", now, zone)!!))
    }

    @Test
    fun theNextMomentIsTomorrowOnceTheTimeHasPassed() {
        val now = moment("2026-10-18T04:00:00+08:00")

        assertEquals("2026-10-19T03:00+08:00", stamp(ExploreSchedule.nextAt("03:00", now, zone)!!))
    }

    @Test
    fun theExactMomentItselfCountsAsPassed() {
        val now = moment("2026-10-18T03:00:00+08:00")

        assertEquals("2026-10-19T03:00+08:00", stamp(ExploreSchedule.nextAt("03:00", now, zone)!!))
    }

    @Test
    fun aBadTimeHasNoNextMoment() {
        assertNull(ExploreSchedule.nextAt("25:00", 0L, zone))
        assertNull(ExploreSchedule.nextAt("tomorrow", 0L, zone))
    }

    /* ── 到点这一趟该做什么 (2.8.0 #9) ───────────────────────────────────── */

    /**
     * 宿主被系统杀掉的凌晨三点: 不再"只跳过不开始" —— 先拉宿主服务, 等它就绪再投那一行
     *
     * 这一条是 #9 的核心: 闹钟本来就能把进程叫起来 (2.7.8 已换 AlarmManager), 卡住的是
     * "进程起来了但宿主那半不在, 于是直接记 skipped"
     */
    @Test
    fun aMissingHostMeansWakeItInsteadOfSkipping() {
        assertEquals(
            ExploreSchedule.Due.WAKE_HOST,
            ExploreSchedule.dueOf(enabled = true, hostRunning = false, running = false),
        )
    }

    /** 宿主在跑, 也没有上一场: 直接投 (与改之前一样) */
    @Test
    fun aLiveHostQueuesRightAway() {
        assertEquals(
            ExploreSchedule.Due.QUEUE,
            ExploreSchedule.dueOf(enabled = true, hostRunning = true, running = false),
        )
    }

    /** 上一场还在跑: 照样跳过 —— 拉宿主那一条不能把这一条也放宽 */
    @Test
    fun aRunInFlightStillSkips() {
        assertEquals(
            ExploreSchedule.Due.SKIP_RUNNING,
            ExploreSchedule.dueOf(enabled = true, hostRunning = true, running = true),
        )
        assertEquals(
            ExploreSchedule.Due.SKIP_RUNNING,
            ExploreSchedule.dueOf(enabled = true, hostRunning = false, running = true),
        )
    }

    /** 关着就什么都不做: 别为了"到点了"去拉一个主人没开的宿主 */
    @Test
    fun theSwitchOffMeansNothingHappens() {
        assertEquals(
            ExploreSchedule.Due.OFF,
            ExploreSchedule.dueOf(enabled = false, hostRunning = false, running = false),
        )
        assertEquals(
            ExploreSchedule.Due.OFF,
            ExploreSchedule.dueOf(enabled = false, hostRunning = true, running = true),
        )
    }

    /** 等宿主那一段必须有上限 (广播那头 10 s 就得松手, 所以它是一个有界的常数) */
    @Test
    fun theHostWaitIsBounded() {
        assertTrue(ExploreSchedule.HOST_WAIT_MS in 30_000L..300_000L)
    }

    @Test
    fun aMissingPlanMeansOffAtThree() {
        val plan = ExploreSchedule.planOf(JsonObject(emptyMap()))

        assertEquals(false, plan.enabled)
        assertEquals("03:00", plan.at)
        assertNull(plan.last)
    }

    @Test
    fun aBrokenTimeFallsBackToThree() {
        val plan = ExploreSchedule.planOf(
            json.parseToJsonElement("""{"enabled":true,"at":"明天早上"}""") as JsonObject,
        )

        assertEquals(true, plan.enabled)
        assertEquals("03:00", plan.at)
    }

    @Test
    fun theLastRunIsReadBack() {
        val plan = ExploreSchedule.planOf(
            json.parseToJsonElement(
                """{"enabled":true,"at":"21:30","last":{"at":123,"outcome":"skipped","why":"宿主没在跑"}}""",
            ) as JsonObject,
        )

        assertEquals("21:30", plan.at)
        assertEquals(123L, plan.last?.at)
        assertEquals("skipped", plan.last?.outcome)
        assertEquals("宿主没在跑", plan.last?.why)
        assertTrue(ExploreSchedule.describeLast(plan.last!!).startsWith("没跑"))
    }

    /* ── 每场预算 (2.7.9 第 8 条 T2) ─────────────────────────────────────── */

    /** 老文件没有这两个键: 落 30 / 60, 与宿主那边的缺省是同一对 */
    @Test
    fun aMissingBudgetMeansThirtyAndSixty() {
        val plan = ExploreSchedule.planOf(JsonObject(emptyMap()))

        assertEquals(ExploreSchedule.MINUTES_DEFAULT, plan.minutes)
        assertEquals(ExploreSchedule.STEPS_DEFAULT, plan.steps)
        assertEquals(30, plan.minutes)
        assertEquals(60, plan.steps)
    }

    /** 读进来就夹进范围 (与宿主 exploreClamp 同一个口径: 0 -> 1, 500 -> 180) */
    @Test
    fun theBudgetIsClampedWhenRead() {
        val low = ExploreSchedule.planOf(
            json.parseToJsonElement("""{"minutes":0,"steps":0}""") as JsonObject,
        )
        val high = ExploreSchedule.planOf(
            json.parseToJsonElement("""{"minutes":500,"steps":4000}""") as JsonObject,
        )

        assertEquals(1, low.minutes)
        assertEquals(1, low.steps)
        assertEquals(180, high.minutes)
        assertEquals(1000, high.steps)
    }

    /** 认不出来的值 (字符串 / 小数) 给缺省, 不把那一行当坏 JSON */
    @Test
    fun anUnreadableBudgetFallsBack() {
        val plan = ExploreSchedule.planOf(
            json.parseToJsonElement("""{"minutes":"很久","steps":12.5}""") as JsonObject,
        )

        assertEquals(30, plan.minutes)
        assertEquals(60, plan.steps)
    }

    /** 夹取那两条纯函数的边界 (写回文件之前也要过一遍) */
    @Test
    fun theBudgetIsClampedBeforeItIsWritten() {
        assertEquals(1, ExploreSchedule.clamp(-5, ExploreSchedule.MINUTES_RANGE))
        assertEquals(180, ExploreSchedule.clamp(500, ExploreSchedule.MINUTES_RANGE))
        assertEquals(60, ExploreSchedule.clamp(null, ExploreSchedule.STEPS_RANGE, ExploreSchedule.STEPS_DEFAULT))
    }

    /* ── 允许锁屏解锁 (2.7.10, 主人 2026-10-25) ───────────────────────────── */

    /** 老文件没有这个键: 就是关着 (夜里不自己去解屏) */
    @Test
    fun aMissingUnlockSwitchMeansOff() {
        val plan = ExploreSchedule.planOf(JsonObject(emptyMap()))

        assertEquals(false, plan.unlock)
    }

    /** 写进去的那个 true 读回来还是 true, 认不出来的值一律按关 */
    @Test
    fun theUnlockSwitchIsReadBack() {
        val on = ExploreSchedule.planOf(
            json.parseToJsonElement("""{"enabled":true,"at":"03:00","unlock":true}""") as JsonObject,
        )
        val broken = ExploreSchedule.planOf(
            json.parseToJsonElement("""{"unlock":"随便写点什么"}""") as JsonObject,
        )

        assertEquals(true, on.unlock)
        assertEquals(false, broken.unlock)
    }

    /** 那行读数把"开始前屏幕怎么了"也带上; why 空着时不多那一个点 */
    @Test
    fun theLastRunSentenceCarriesTheNote() {
        val withNote = ExploreSchedule.Last(1L, "started", "到点先把锁屏解开了")
        val without = ExploreSchedule.Last(1L, "started", null)

        assertEquals("开始了一场探索 · 到点先把锁屏解开了", ExploreSchedule.describeLast(withNote))
        assertEquals("开始了一场探索", ExploreSchedule.describeLast(without))
    }

    /* ── 错过补跑 (2026-11-07) ─────────────────────────────────────────────── */

    /**
     * 什么才算"漏了"
     *
     * 这一条挡的是"刚刚打开开关就在大白天凭空开一场": `last.at` 一次都没写过时, 那不是漏, 是还没开始
     */
    @Test
    fun aScheduleThatNeverRanHasNothingToCatchUp() {
        val now = moment("2026-10-18T08:00:00+08:00")

        assertNull(ExploreSchedule.catchUpLateMs(null, "03:00", now, zone))
    }

    /** 上一趟就是今天这一次: 已经跑过了, 再补就是同一天开两场 */
    @Test
    fun theRunThatJustHappenedIsNotCatchUp() {
        val now = moment("2026-10-18T08:00:00+08:00")
        val last = moment("2026-10-18T03:00:00+08:00")

        assertNull(ExploreSchedule.catchUpLateMs(last, "03:00", now, zone))
    }

    /** 今天凌晨那场没跑 (last 停在昨天): 早上八点补一趟, 晚了五小时 */
    @Test
    fun aMissedNightIsCaughtUpInTheMorning() {
        val now = moment("2026-10-18T08:00:00+08:00")
        val last = moment("2026-10-17T03:00:00+08:00")

        assertEquals(
            5 * 60 * 60_000L,
            ExploreSchedule.catchUpLateMs(last, "03:00", now, zone),
        )
    }

    /** 刚过一分钟也算漏 (闹钟被 ROM 清掉时就是这样) */
    @Test
    fun aMinuteLateStillCounts() {
        val now = moment("2026-10-18T03:01:00+08:00")
        val last = moment("2026-10-17T03:00:00+08:00")

        assertEquals(60_000L, ExploreSchedule.catchUpLateMs(last, "03:00", now, zone))
    }

    /** 晚了九小时就不硬补了: 隔了半天的任务卡不是当时的上下文 */
    @Test
    fun tooLateIsNotCatchUp() {
        val now = moment("2026-10-18T12:00:00+08:00")
        val last = moment("2026-10-17T03:00:00+08:00")

        assertNull(ExploreSchedule.catchUpLateMs(last, "03:00", now, zone))
    }

    /** 今晚还没到: 那是**等闹钟**的那一场, 别把昨天那次当成漏跑 */
    @Test
    fun beforeTodaysMomentThereIsNothingToCatchUp() {
        val now = moment("2026-10-18T01:00:00+08:00")
        val last = moment("2026-10-17T03:00:00+08:00")

        assertNull(ExploreSchedule.catchUpLateMs(last, "03:00", now, zone))
    }
}
