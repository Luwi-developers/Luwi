package io.github.yuloong07star.luwi.tool

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.ZoneId

/**
 * 静默时段那一份 (2026-11-20, 主人: "静默时段与 automations/settings.json 统一接口")
 *
 * 只测纯函数那一半 (JVM 上没有设备): 窗口判断 + 老 `sim.json` 的搬家决策 / 摘键。
 * 文件读写那一半 (`read` / `save` / `migrateLegacy` 的副作用) 由真机读数兜。
 */
class QuietHoursTest {

    private val json = Json

    private fun obj(text: String): JsonObject = json.parseToJsonElement(text) as JsonObject

    /** 与 `ProactiveScheduleTest` 里那几条同一个口径: 跨零点 + 左右闭开 */
    @Test
    fun `落在窗口里回那一句, 不在就 null`() {
        val zone = ZoneId.of("Asia/Shanghai")
        // 2026-11-20 02:00 (+08:00) 落在 23:00-07:00 里 (起 > 止 = 跨零点)
        val atTwo = java.time.ZonedDateTime.of(2026, 11, 20, 2, 0, 0, 0, zone).toInstant().toEpochMilli()
        val why = QuietHours.why(true, "23:00-07:00", atTwo, zone)
        assertEquals("静默时段 (23:00 - 07:00)", why)
        assertNull(QuietHours.why(false, "23:00-07:00", atTwo, zone))
        assertNull(QuietHours.why(true, "坏", atTwo, zone))
        assertNull(QuietHours.why(true, "07:00-07:00", atTwo, zone))
    }

    @Test
    fun `老 sim 里三个 quiet 键一个都没有时不搬`() {
        assertNull(QuietHours.legacyPlan(obj("""{"gapMinMs":1}"""), null))
        assertNull(QuietHours.legacyPlan(null, null))
    }

    @Test
    fun `新家已经有 quiet 段时新家优先, 不搬`() {
        val wake = obj("""{"quietEnabled":false,"quietFrom":"01:00","quietTo":"02:00"}""")
        val settings = obj("""{"quiet":{"enabled":true,"window":"22:00-06:00"}}""")
        assertNull(QuietHours.legacyPlan(wake, settings))
    }

    @Test
    fun `新家没有 quiet 段时按旧值搬一份`() {
        val wake = obj("""{"quietEnabled":false,"quietFrom":"01:00","quietTo":"02:00"}""")
        val moved = QuietHours.legacyPlan(wake, obj("""{"monitors":{}}"""))
        assertEquals(false, moved?.enabled)
        assertEquals("01:00", moved?.from)
        assertEquals("02:00", moved?.to)
        assertEquals("01:00-02:00", moved?.window)
    }

    @Test
    fun `旧值里缺格或坏值都落到缺省那一段`() {
        val moved = QuietHours.legacyPlan(obj("""{"quietEnabled":"很快"}"""), null)
        assertEquals(true, moved?.enabled)
        assertEquals(QuietHours.DEFAULT_FROM, moved?.from)
        assertEquals(QuietHours.DEFAULT_TO, moved?.to)
    }

    @Test
    fun `摘键只摘那三个, 别的段原样留下`() {
        val root = obj(
            """
            {"v":1,
             "wake":{"quietEnabled":false,"quietFrom":"01:00","quietTo":"02:00","gapMinMs":90000},
             "send":{"burstEnabled":true},
             "sticker":{"maxMb":3}}
            """.trimIndent(),
        )
        val text = QuietHours.stripLegacy(root).toString()
        assertEquals(false, text.contains("quietEnabled"))
        assertEquals(false, text.contains("quietFrom"))
        assertEquals(false, text.contains("quietTo"))
        assertEquals(true, text.contains("\"gapMinMs\":90000"))
        assertEquals(true, text.contains("\"burstEnabled\":true"))
        assertEquals(true, text.contains("\"maxMb\":3"))
    }
}
