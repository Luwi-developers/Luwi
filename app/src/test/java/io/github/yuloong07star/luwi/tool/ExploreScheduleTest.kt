package io.github.yuloong07star.luwi.tool

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 探索预算那几条纯算术 (2.7.8 批次 8; 2026-11-21 排期撤掉之后只剩两格)
 *
 * 排期 (每天一个时刻 / 补跑 / 到点那一趟) 已随判断层接管一起删掉, 所以这里只钉还用得到的三条 ——
 * 它们错了都不会当场报错, 只会在"设置页拨的步数不生效"或"屏锁着却解不开"上表现出来:
 *
 * - [ExploreSchedule.planOf]: 只认 `steps` / `unlock`; 老文件里的 `enabled` / `at` / `minutes` / `last`
 *   一律当没有 (2026-11-21 之前写进去的那些)
 * - 步数读进来与写回去都夹进范围 (与宿主 `exploreClamp` 同一个口径)
 * - [ExploreSchedule.HOST_WAIT_MS]: 等宿主那一段必须有上限 (判断层那一拍也要松手)
 */
class ExploreScheduleTest {

    private val json = Json

    @Test
    fun aMissingPlanMeansSixtyStepsAndNoUnlock() {
        val plan = ExploreSchedule.planOf(JsonObject(emptyMap()))

        assertEquals(ExploreSchedule.STEPS_DEFAULT, plan.steps)
        assertEquals(false, plan.unlock)
        assertEquals(60, plan.steps)
    }

    @Test
    fun anOldFileStillParsesButItsScheduleKeysAreIgnored() {
        val plan = ExploreSchedule.planOf(
            json.parseToJsonElement(
                """{"enabled":false,"at":"03:00","minutes":30,"steps":10,""" +
                    """"last":{"at":123,"outcome":"skipped","why":"宿主没在跑"}}""",
            ) as JsonObject,
        )

        // 关着的那一格不再有闸的作用: 判断层开的那一场照样按 10 步跑
        assertEquals(10, plan.steps)
    }

    @Test
    fun theBudgetIsClampedWhenRead() {
        val low = ExploreSchedule.planOf(
            json.parseToJsonElement("""{"steps":0}""") as JsonObject,
        )
        val high = ExploreSchedule.planOf(
            json.parseToJsonElement("""{"steps":4000}""") as JsonObject,
        )

        assertEquals(1, low.steps)
        assertEquals(1000, high.steps)
    }

    @Test
    fun anUnreadableBudgetFallsBack() {
        val plan = ExploreSchedule.planOf(
            json.parseToJsonElement("""{"steps":"一打"}""") as JsonObject,
        )

        assertEquals(60, plan.steps)
    }

    @Test
    fun theBudgetIsClampedBeforeItIsWritten() {
        assertEquals(1, ExploreSchedule.clamp(-5, ExploreSchedule.STEPS_RANGE))
        assertEquals(1000, ExploreSchedule.clamp(5000, ExploreSchedule.STEPS_RANGE))
        assertEquals(60, ExploreSchedule.clamp(null, ExploreSchedule.STEPS_RANGE, ExploreSchedule.STEPS_DEFAULT))
    }

    /* ── 允许锁屏解锁 (2.7.10, 主人 2026-10-25) ───────────────────────────── */

    /** 老文件没有这个键: 就是关着 (屏锁着时那条 lw_lock 会如实拒) */
    @Test
    fun aMissingUnlockSwitchMeansOff() {
        val plan = ExploreSchedule.planOf(JsonObject(emptyMap()))

        assertEquals(false, plan.unlock)
    }

    /** 写进去的那个 true 读回来还是 true, 认不出来的值一律按关 */
    @Test
    fun theUnlockSwitchIsReadBack() {
        val on = ExploreSchedule.planOf(
            json.parseToJsonElement("""{"steps":30,"unlock":true}""") as JsonObject,
        )
        val broken = ExploreSchedule.planOf(
            json.parseToJsonElement("""{"unlock":"随便写点什么"}""") as JsonObject,
        )

        assertEquals(true, on.unlock)
        assertEquals(false, broken.unlock)
    }

    /** 等宿主那一段必须有上限 (判断层那一拍也得松手, 所以它是一个有界的常数) */
    @Test
    fun theHostWaitIsBounded() {
        assertTrue(ExploreSchedule.HOST_WAIT_MS in 30_000L..300_000L)
    }
}
