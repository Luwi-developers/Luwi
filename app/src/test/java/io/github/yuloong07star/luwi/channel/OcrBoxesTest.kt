package io.github.yuloong07star.luwi.channel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * OCR 前后处理那两条纯规则 ([OcrBoxes])
 *
 * 它们决定"结果里混不混图标"与"长行右边丢不丢字", 而在设备上只能看现象。抽成纯函数之后这几条
 * 边界可以逐条量: 方形小低分是图标、宽扁行不是、切段要无缝覆盖满整行、拼接要去掉重叠
 */
class OcrBoxesTest {

    @Test
    fun `方形小低分是图标`() {
        assertTrue(OcrBoxes.isIconLike(40, 40, 0.6f))
        assertTrue(OcrBoxes.isIconLike(44, 38, 0.5f))
    }

    @Test
    fun `分数高的方形不是图标`() {
        assertFalse(OcrBoxes.isIconLike(40, 40, 0.9f))
    }

    @Test
    fun `宽扁的行不是图标`() {
        assertFalse(OcrBoxes.isIconLike(200, 30, 0.5f))
    }

    @Test
    fun `大方形不是图标`() {
        // 边长到了 ICON_MAX_SIDE 就不是小图标了, 不按形状判
        assertFalse(OcrBoxes.isIconLike(OcrBoxes.ICON_MAX_SIDE, OcrBoxes.ICON_MAX_SIDE, 0.5f))
    }

    @Test
    fun `只有符号的框没有字`() {
        assertTrue(OcrBoxes.isSymbolOnly(">"))
        assertTrue(OcrBoxes.isSymbolOnly("、"))
        assertTrue(OcrBoxes.isSymbolOnly(">»"))
        assertFalse(OcrBoxes.isSymbolOnly("已关闭>"))
        assertFalse(OcrBoxes.isSymbolOnly("A"))
        assertFalse(OcrBoxes.isSymbolOnly(""))
    }

    @Test
    fun `正常长宽比的行不用切`() {
        assertTrue(OcrBoxes.segments(0, 300, 48).isEmpty())
        // 6.67~10 之间只是被挤压一点, 切了反而在接缝处多认标点
        assertTrue(OcrBoxes.segments(0, 480, 60).isEmpty())
    }

    @Test
    fun `超宽行切成几段且无缝覆盖`() {
        val left = 100
        val right = 1500
        val height = 40
        val slices = OcrBoxes.segments(left, right, height)
        // 切完每段都该回到"挤压不超过 SPLIT_FACTOR"的范围里
        val limit = 320f / 48f * OcrBoxes.SPLIT_FACTOR
        assertTrue(slices.size >= 2)
        assertEquals(left, slices.first().left)
        assertEquals(right, slices.last().right)
        for (index in slices.indices) {
            val slice = slices[index]
            assertTrue("每段都得在模型的上限内", slice.width / height.toFloat() <= limit + 0.01f)
            if (index > 0) {
                // 相邻两段要接上, 允许重叠 (重叠是为了不切在字上)
                assertTrue("第 $index 段与上一段之间有缝", slice.left <= slices[index - 1].right)
            }
        }
    }

    @Test
    fun `拼接时去掉重叠`() {
        // 12 屏像素的重叠落到字上通常是一两个字符
        assertEquals("Amateur Radio Satellite", OcrBoxes.joinOverlap("Amateur Radi", "io Satellite"))
        assertEquals("abcdefghijkl", OcrBoxes.joinOverlap("abcdefgh", "efghijkl"))
    }

    @Test
    fun `没有重叠时直接接上`() {
        assertEquals("你好世界", OcrBoxes.joinOverlap("你好", "世界"))
    }

    @Test
    fun `空的那一侧原样返回`() {
        assertEquals("ab", OcrBoxes.joinOverlap("", "ab"))
        assertEquals("ab", OcrBoxes.joinOverlap("ab", ""))
    }
}
