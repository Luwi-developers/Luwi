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
 * 主动对话排期那几条纯算术 (2.8.0 B4-a)
 *
 * 三个地方错了都不会当场报错, 只会在"该响的那天没响"或"到点响了两场"上表现出来:
 *
 * - [ProactiveSchedule.nextAt]: 今天还剩的时刻里最早那个, 都过了就明天第一个; 空表就是 null
 * - [ProactiveSchedule.timesOf]: `times` 那一栏认不出来 / 空表 / 全坏都退回 09:30 (否则"开着却
 *   永远不响"), 认出来的按分钟去重排序并统一写成 `HH:mm`
 * - [ProactiveSchedule.planOf]: 读坏了退回"关着 + 09:30", 而不是让 B4-c 的设置页炸掉
 */
class ProactiveScheduleTest {

    private val zone = ZoneId.of("Asia/Shanghai")
    private val json = Json

    private fun moment(text: String): Long = OffsetDateTime.parse(text).toInstant().toEpochMilli()

    private fun stamp(at: Long): String =
        OffsetDateTime.ofInstant(Instant.ofEpochMilli(at), zone).toString()

    /* ── 一天几个时刻 ────────────────────────────────────────────────────── */

    @Test
    fun theNextMomentIsTheFirstOneLeftToday() {
        val now = moment("2026-11-05T08:00:00+08:00")

        assertEquals(
            "2026-11-05T09:30+08:00",
            stamp(ProactiveSchedule.nextAt(listOf("09:30", "18:00"), now, zone)!!),
        )
    }

    @Test
    fun theNextMomentIsTheFollowingOneWhenTheFirstHasPassed() {
        val now = moment("2026-11-05T12:00:00+08:00")

        assertEquals(
            "2026-11-05T18:00+08:00",
            stamp(ProactiveSchedule.nextAt(listOf("09:30", "18:00"), now, zone)!!),
        )
    }

    @Test
    fun theNextMomentRollsToTomorrowAfterTheLastOne() {
        val now = moment("2026-11-05T19:00:00+08:00")

        assertEquals(
            "2026-11-06T09:30+08:00",
            stamp(ProactiveSchedule.nextAt(listOf("09:30", "18:00"), now, zone)!!),
        )
    }

    @Test
    fun theExactMomentItselfCountsAsPassed() {
        val now = moment("2026-11-05T09:30:00+08:00")

        assertEquals(
            "2026-11-05T18:00+08:00",
            stamp(ProactiveSchedule.nextAt(listOf("09:30", "18:00"), now, zone)!!),
        )
    }

    @Test
    fun badTimesAreSkippedButTheGoodOneStillRings() {
        val now = moment("2026-11-05T08:00:00+08:00")

        assertEquals(
            "2026-11-05T21:00+08:00",
            stamp(ProactiveSchedule.nextAt(listOf("明天", "25:00", "21:00"), now, zone)!!),
        )
    }

    @Test
    fun noUsableTimeHasNoNextMoment() {
        assertNull(ProactiveSchedule.nextAt(emptyList(), 0L, zone))
        assertNull(ProactiveSchedule.nextAt(listOf("tomorrow", "25:00"), 0L, zone))
    }

    /* ── `times` 那一栏 ──────────────────────────────────────────────────── */

    @Test
    fun missingOrEmptyTimesFallBackToHalfPastNine() {
        assertEquals(listOf(ProactiveSchedule.DEFAULT_AT), ProactiveSchedule.timesOf(null))
        assertEquals(
            listOf(ProactiveSchedule.DEFAULT_AT),
            ProactiveSchedule.timesOf(json.parseToJsonElement("[]")),
        )
        assertEquals(
            listOf(ProactiveSchedule.DEFAULT_AT),
            ProactiveSchedule.timesOf(json.parseToJsonElement("""["明天","25:00"]""")),
        )
        assertEquals("09:30", ProactiveSchedule.DEFAULT_AT)
    }

    @Test
    fun timesAreCanonicalisedDedupedAndSorted() {
        assertEquals(
            listOf("07:05", "09:30", "18:00"),
            ProactiveSchedule.timesOf(
                json.parseToJsonElement("""["18:00","9:30","07:05","09:30","18:00"]"""),
            ),
        )
        // 手改的 `9:30` 与 `09:30` 是同一个时刻, 落盘之后只留一个形状
        assertEquals(
            listOf("09:30"),
            ProactiveSchedule.timesOf(json.parseToJsonElement("""["9:30","09:30"]""")),
        )
    }

    /* ── 配置 ───────────────────────────────────────────────────────────── */

    @Test
    fun aMissingPlanMeansOffAtHalfPastNine() {
        val plan = ProactiveSchedule.planOf(JsonObject(emptyMap()))

        assertEquals(false, plan.enabled)
        assertEquals(listOf("09:30"), plan.times)
        assertNull(plan.last)
        assertEquals(false, plan.unlock)
    }

    @Test
    fun thePlanReadsBackItsTimesSwitchAndLastRun() {
        val plan = ProactiveSchedule.planOf(
            json.parseToJsonElement(
                """{"v":1,"enabled":true,"times":["18:00","09:30"],"unlock":true,
                   "last":{"at":123,"outcome":"skipped","why":"宿主起不来"}}""",
            ) as JsonObject,
        )

        assertEquals(true, plan.enabled)
        assertEquals(listOf("09:30", "18:00"), plan.times)
        assertEquals(true, plan.unlock)
        assertEquals(123L, plan.last?.at)
        assertEquals("skipped", plan.last?.outcome)
        assertEquals("宿主起不来", plan.last?.why)
    }

    @Test
    fun aBrokenPlanFallsBackToTheDefaults() {
        val plan = ProactiveSchedule.planOf(
            json.parseToJsonElement("""{"enabled":true,"times":"09:30","unlock":"随便写点什么"}""") as JsonObject,
        )

        assertEquals(true, plan.enabled)
        assertEquals(listOf(ProactiveSchedule.DEFAULT_AT), plan.times)
        assertEquals(false, plan.unlock)
    }

    /* ── 文件与读数 ─────────────────────────────────────────────────────── */

    @Test
    fun theFilesLiveInOneDirectoryAndKeepDistinctNames() {
        assertEquals("proactive-schedule.json", ProactiveSchedule.FILE)
        assertEquals("proactive-card.md", ProactiveSchedule.CARD)
        assertEquals("explore-schedule.json", ExploreSchedule.FILE)
        assertTrue(ProactiveSchedule.FALLBACK_TEXT.contains("探索摘要"))
        assertTrue(ProactiveSchedule.FALLBACK_TEXT.contains("通知摘要"))
    }

    @Test
    fun theLastRunSentenceReadsLikeTheExploreOne() {
        assertEquals(
            "开了一场主动对话 · 到点先把锁屏解开了",
            ProactiveSchedule.describeLast(ProactiveSchedule.Last(1L, "started", "到点先把锁屏解开了")),
        )
        assertEquals(
            "开了一场主动对话",
            ProactiveSchedule.describeLast(ProactiveSchedule.Last(1L, "started", null)),
        )
        assertTrue(
            ProactiveSchedule.describeLast(ProactiveSchedule.Last(1L, "skipped", "宿主起不来"))
                .startsWith("没跑"),
        )
    }

    /* ── 30 分钟闸 (B4-b ⑥) ─────────────────────────────────────────────── */

    @Test
    fun theFirstConversationEverIsAllowed() {
        assertTrue(ProactiveGate.open(0L, moment("2026-11-05T10:00:00+08:00")))
    }

    @Test
    fun twentyNineFiftyNineAfterTheLastOneIsRefused() {
        val last = moment("2026-11-05T10:00:00+08:00")

        assertEquals(false, ProactiveGate.open(last, last + 29 * 60_000L + 59_000L))
    }

    @Test
    fun thirtyMinutesAfterTheLastOneIsAllowed() {
        val last = moment("2026-11-05T10:00:00+08:00")

        assertTrue(ProactiveGate.open(last, last + ProactiveGate.GAP_MS))
        assertEquals(30, ProactiveGate.GAP_MINUTES)
    }

    @Test
    fun aClockThatJumpedBackwardsDoesNotOpenTheGate() {
        val last = moment("2026-11-05T10:00:00+08:00")

        assertEquals(false, ProactiveGate.open(last, last - 60_000L))
    }

    @Test
    fun theBlockedSentenceSaysHowLongAgoAndHowLongToWait() {
        val last = moment("2026-11-05T10:00:00+08:00")

        assertEquals(
            "上一条主动投递才 12 分钟, 30 分钟内不开口",
            ProactiveGate.blockedReason(last, last + 12 * 60_000L),
        )
    }

    /* ── 静默时段 (B4-b ⑨) ─────────────────────────────────────────────── */

    @Test
    fun quietHoursKeepTheProactiveConversationClosed() {
        val why = ProactiveSchedule.quietWhy(
            enabled = true,
            window = "23:00-07:00",
            now = moment("2026-11-05T23:30:00+08:00"),
            zone = zone,
        )

        assertTrue(why != null)
        assertTrue(why!!.startsWith("静默时段"))
        assertTrue(why.contains("23:00 - 07:00"))
    }

    @Test
    fun theQuietWindowIsLeftClosedRightOpen() {
        fun quietAt(text: String): Boolean = ProactiveSchedule.quietWhy(
            enabled = true,
            window = "23:00-07:00",
            now = moment(text),
            zone = zone,
        ) != null

        assertEquals(false, quietAt("2026-11-05T22:59:00+08:00"))
        assertEquals(true, quietAt("2026-11-05T23:00:00+08:00"))
        assertEquals(true, quietAt("2026-11-06T06:59:00+08:00"))
        assertEquals(false, quietAt("2026-11-06T07:00:00+08:00"))
    }

    @Test
    fun turningQuietHoursOffLetsItSpeak() {
        assertNull(
            ProactiveSchedule.quietWhy(
                enabled = false,
                window = "23:00-07:00",
                now = moment("2026-11-05T03:00:00+08:00"),
                zone = zone,
            ),
        )
    }

    @Test
    fun aBrokenOrEmptyQuietWindowIsNotQuiet() {
        val now = moment("2026-11-05T03:00:00+08:00")

        assertNull(ProactiveSchedule.quietWhy(true, "半夜到早上", now, zone))
        assertNull(ProactiveSchedule.quietWhy(true, "23:00-23:00", now, zone))
        assertNull(ProactiveSchedule.quietWhy(true, null, now, zone))
    }
}
