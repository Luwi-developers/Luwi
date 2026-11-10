package io.github.yuloong07star.luwi.tool

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「更多设置」那一份的读与写 (2026-11-10)
 *
 * 两批: ① 表情那两格 —— **缺键回缺省**、**越界夹进范围**、**坏值不炸**;
 * ② 去群味 —— 带全 14 个群味老键的 `sim.json` **读得回来不炸**, 而写盘**一个老键都不写**
 * (方案 `docs/Luwi-更多设置去群味-方案-2026-11-10.md`)
 */
class SimSettingTest {

    private val json = Json

    private fun root(text: String): JsonObject = json.parseToJsonElement(text) as JsonObject

    @Test
    fun `没有 sticker 段时回 2 MB 与 200 张`() {
        val sticker = SimSetting.planFrom(root("""{"v":1}""")).sticker

        assertEquals(2, sticker.maxMb)
        assertEquals(200, sticker.maxCount)
        assertEquals(2L * 1024 * 1024, sticker.maxBytes)
    }

    @Test
    fun `两格都读得回来`() {
        val sticker = SimSetting.planFrom(root("""{"sticker":{"maxMb":5,"maxCount":30}}""")).sticker

        assertEquals(5, sticker.maxMb)
        assertEquals(30, sticker.maxCount)
    }

    @Test
    fun `越界夹进范围 (单张 1到20, 张数 20到500)`() {
        assertEquals(1, SimSetting.planFrom(root("""{"sticker":{"maxMb":0,"maxCount":0}}""")).sticker.maxMb)
        assertEquals(20, SimSetting.planFrom(root("""{"sticker":{"maxMb":999}}""")).sticker.maxMb)
        assertEquals(500, SimSetting.planFrom(root("""{"sticker":{"maxCount":99999}}""")).sticker.maxCount)
    }

    @Test
    fun `坏值回缺省, 不炸`() {
        val sticker = SimSetting.planFrom(root("""{"sticker":{"maxMb":"很大","maxCount":null}}""")).sticker

        assertEquals(2, sticker.maxMb)
        assertEquals(200, sticker.maxCount)
    }

    @Test
    fun `sticker 段本身坏掉时也回缺省`() {
        assertEquals(2, SimSetting.planFrom(root("""{"sticker":"nope"}""")).sticker.maxMb)
    }

    @Test
    fun `两个范围就是 1到20 与 20到500`() {
        assertEquals(1..20, SimSetting.STICKER_MB_RANGE)
        assertEquals(20..500, SimSetting.STICKER_COUNT_RANGE)
    }

    @Test
    fun `带全 14 个群味老键的 sim 文件也读得回来 (不认识的就当没有)`() {
        val plan = SimSetting.planFrom(
            root(
                """
                {"v":1,
                 "wake":{"mode":"active","gapMinMs":120000,"gapMaxMs":180000,"preSleepWaitMs":0,
                   "triggers":{"name":false,"keywords":true,"question":true,"poke":false,
                     "probability":0.5,"anyMessage":true},
                   "maxWakePerMinute":3,"maxWakePerHour":9,"noActionLimit":5,
                   "quietEnabled":false,"quietFrom":"01:00","quietTo":"02:00"},
                 "wait":{"defaultMs":1000,"quietMs":2000,"minQuietAfterNewMs":3000},
                 "context":{"wakeMessageLimit":3,"wakeMaxChars":1000},
                 "router":{"gameMinutes":120,"wishDays":30}}
                """.trimIndent(),
            ),
        )

        // 留下来的那几格照读
        assertEquals(SimSetting.MODE_ACTIVE, plan.wake.mode)
        assertEquals(120_000L, plan.wake.gapMinMs)
        assertEquals(180_000L, plan.wake.gapMaxMs)
        assertEquals(0L, plan.wake.preSleepWaitMs)
        assertFalse(plan.wake.quietEnabled)
        assertEquals("01:00", plan.wake.quietFrom)
        assertEquals("02:00", plan.wake.quietTo)
        // 撤掉的那几段不参与, 也不该把这一份读崩
        assertEquals(SimSetting.Send(), plan.send)
        assertEquals(SimSetting.Router(), plan.router)
        assertEquals(SimSetting.Sticker(), plan.sticker)
    }

    @Test
    fun `写盘只写留下来的键, 14 个群味老键一个都不写`() {
        val text = SimSetting.toJson(SimSetting.Plan()).toString()
        val gone = listOf(
            "triggers", "name", "keywords", "question", "poke", "probability", "anyMessage",
            "maxWakePerMinute", "maxWakePerHour", "noActionLimit",
            "wait", "defaultMs", "quietMs", "minQuietAfterNewMs",
            "context", "wakeMessageLimit", "wakeMaxChars",
            // 2026-11-10: 这两把尺子搬去 router.json, sim.json 不再写
            "gameMinutes", "wishDays",
        )
        for (key in gone) {
            assertFalse("写盘里还有群味老键 $key", text.contains("\"$key\":"))
        }
        // 四段与主动场那一档都还在
        listOf("\"wake\"", "\"send\"", "\"router\"", "\"proactive\"", "\"sticker\"", "\"quietFrom\"").forEach {
            assertTrue("写盘里缺 $it", text.contains(it))
        }
    }
}
