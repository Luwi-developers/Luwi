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
        assertTrue(OcrBoxes.isIconLike(40, 40, 0.6f, 1080))
        assertTrue(OcrBoxes.isIconLike(44, 38, 0.5f, 1080))
    }

    @Test
    fun `分数高的方形不是图标`() {
        assertFalse(OcrBoxes.isIconLike(40, 40, 0.9f, 1080))
    }

    @Test
    fun `宽扁的行不是图标`() {
        assertFalse(OcrBoxes.isIconLike(200, 30, 0.5f, 1080))
    }

    @Test
    fun `尺寸判据按屏长边的比例走`() {
        // 2K 屏长边 3200, 9% 是 288px: 120px 的方形仍然是头像, 而旧的 96px 绝对判据会漏掉它
        assertTrue(OcrBoxes.isIconLike(120, 120, 0.5f, 3200))
        // 1080 屏的 9% 是 97px, 同一个 120px 框已经比阈值大, 不算小图标
        assertFalse(OcrBoxes.isIconLike(120, 120, 0.5f, 1080))
        // 屏尺寸非法时不做形状判断, 交给后面的分数线
        assertFalse(OcrBoxes.isIconLike(40, 40, 0.5f, 0))
    }

    @Test
    fun `大方形不是图标`() {
        // 长边过了屏长边的 9% 就不是"小图标"了, 不按形状判
        assertFalse(OcrBoxes.isIconLike(150, 150, 0.5f, 1080))
    }

    @Test
    fun `重叠的两条只留分数高的`() {
        // 检测器对同一行给两个重叠框: 一个是 0.986, 一个是 0.75 (小米13 上"微信(4)"那条)
        val high = OcrBox(100f, 100f, 400f, 140f, 0.986f)
        val low = OcrBox(110f, 104f, 396f, 136f, 0.75f)
        val (kept, dropped) = OcrBoxes.dedupe(listOf(high, low))
        assertEquals(1, kept.size)
        assertEquals(1, dropped)
        assertEquals(0.986f, kept[0].score, 0.0001f)
    }

    @Test
    fun `不相邻的两条都保留`() {
        val first = OcrBox(0f, 0f, 300f, 40f, 0.9f)
        val second = OcrBox(0f, 60f, 300f, 100f, 0.9f)
        val (kept, dropped) = OcrBoxes.dedupe(listOf(first, second))
        assertEquals(2, kept.size)
        assertEquals(0, dropped)
    }

    @Test
    fun `被包住的小框也丢掉`() {
        val big = OcrBox(0f, 0f, 500f, 60f, 0.95f)
        val inner = OcrBox(100f, 10f, 200f, 50f, 0.80f)
        val (kept, dropped) = OcrBoxes.dedupe(listOf(big, inner))
        assertEquals(1, kept.size)
        assertEquals(1, dropped)
        assertEquals(0.95f, kept[0].score, 0.0001f)
    }

    @Test
    fun `去重不改检测器给的顺序`() {
        val upper = OcrBox(0f, 10f, 300f, 40f, 0.9f)
        val lower = OcrBox(0f, 100f, 300f, 130f, 0.9f)
        val (kept, _) = OcrBoxes.dedupe(listOf(upper, lower))
        assertEquals(listOf(upper, lower), kept)
    }

    @Test
    fun `完全不相交的两条重叠为 0`() {
        val a = OcrBox(0f, 0f, 100f, 40f, 0.9f)
        val b = OcrBox(200f, 0f, 300f, 40f, 0.9f)
        assertEquals(0f, OcrBoxes.overlap(a, b), 0.0001f)
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
