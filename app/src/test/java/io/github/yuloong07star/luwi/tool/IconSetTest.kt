package io.github.yuloong07star.luwi.tool

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 图标套的读法与切换顺序 (2026-11-22)
 *
 * 两件事没有设备也能量, 而它们恰好是这一步最容易写错的地方:
 *
 * - **缺省**: 没配过 / 写坏 / 认不出的 id 都要落到主人点名的那一套 (女仆那张), 不能落到"上一版的内置"
 * - **切换顺序**: 先启用目标再停旧的。反过来那一瞬间桌面上一个入口都没有, 部分 ROM 会就此把图标清掉
 */
class IconSetTest {

    @Test
    fun `缺省是主人点名的那一套`() {
        assertEquals(IconSet.MAID, IconSet.DEFAULT)
        assertEquals(IconSet.MAID, IconSet.of(null))
        assertEquals(IconSet.MAID, IconSet.of(""))
        assertEquals(IconSet.MAID, IconSet.of("   "))
    }

    @Test
    fun `认不出的 id 回缺省`() {
        assertEquals(IconSet.MAID, IconSet.of("whale"))
        assertEquals(IconSet.MAID, IconSet.of("MAID"))
    }

    @Test
    fun `认得出的 id 照读`() {
        assertEquals(IconSet.BUILTIN, IconSet.of("builtin"))
        assertEquals(IconSet.MAID, IconSet.of(" maid "))
    }

    @Test
    fun `icon json 只认 set 那一个键`() {
        val root = buildJsonObject {
            put("v", JsonPrimitive(1))
            put("set", JsonPrimitive("builtin"))
        }
        assertEquals(IconSet.BUILTIN, IconSetting.of(root))
    }

    @Test
    fun `icon json 的坏值回缺省`() {
        assertEquals(IconSet.MAID, IconSetting.of(null))
        assertEquals(IconSet.MAID, IconSetting.of(buildJsonObject { put("v", JsonPrimitive(1)) }))
        assertEquals(
            IconSet.MAID,
            IconSetting.of(buildJsonObject { put("set", JsonPrimitive(3)) }),
        )
    }

    @Test
    fun `切换顺序是先开新的再停旧的`() {
        val plan = IconSet.switchPlan(IconSet.BUILTIN, IconSet.MAID)
        assertEquals(2, plan.size)
        assertEquals(IconSet.MAID to true, plan.first())
        assertTrue("目标之后全是停用", plan.drop(1).all { !it.second })
        assertTrue("除目标之外每套都停一次", plan.drop(1).map { it.first }.toSet() == setOf(IconSet.BUILTIN))
    }

    @Test
    fun `停用名单里永远不含目标自己`() {
        for (from in IconSet.values()) {
            for (to in IconSet.values()) {
                val plan = IconSet.switchPlan(from, to)
                assertEquals(to to true, plan.first())
                assertTrue(plan.drop(1).none { it.first == to })
            }
        }
    }

    @Test
    fun `内置那套的换算与旧算式逐字节相同`() {
        // 旧算式: ballDrawDp * GLYPH_INK_RATIO(0.65) / ICON_INK_RATIO(0.46), 再取整
        for (size in listOf(45, 67, 48, 72)) {
            val ink = size * 0.65f
            assertEquals((ink / 0.46f).toInt(), IconTheme.boxDpForInk(ink, IconSet.BUILTIN))
        }
    }

    @Test
    fun `女仆那张是满幅, 盒子就是墨迹本身`() {
        assertEquals(31, IconTheme.boxDpForInk(31f, IconSet.MAID))
    }

    @Test
    fun `开屏那一块两套看起来一样大`() {
        // 内置是 112dp 画布里 0.46 的墨迹; 女仆那张紧裁过, 盒子缩到同一个墨迹尺寸
        assertEquals(112, IconTheme.splashBoxDp(IconSet.BUILTIN))
        assertEquals(51, IconTheme.splashBoxDp(IconSet.MAID))
    }

    @Test
    fun `两套的 alias 与清单逐字对齐`() {
        assertEquals(".IconBuiltin", IconSet.BUILTIN.alias)
        assertEquals(".IconMaid", IconSet.MAID.alias)
    }
}
