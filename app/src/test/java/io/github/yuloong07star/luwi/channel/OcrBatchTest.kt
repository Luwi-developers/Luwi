package io.github.yuloong07star.luwi.channel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 识别任务的批量分组 ([OcrBatch])
 *
 * 边界只有三个: 最后一组不满、总数比 batch 小、batch 为 1 (必须与逐段跑等价)
 */
class OcrBatchTest {

    @Test
    fun `按批分组且最后一组可以不满`() {
        assertEquals(
            listOf(0..3, 4..7, 8..11, 12..15, 16..19, 20..23, 24..27, 28..28),
            OcrBatch.groups(29, 4),
        )
    }

    @Test
    fun `总数比 batch 小`() {
        assertEquals(listOf(0..2), OcrBatch.groups(3, 8))
    }

    @Test
    fun `batch 一就是逐段`() {
        assertEquals(listOf(0..0, 1..1, 2..2), OcrBatch.groups(3, 1))
    }

    @Test
    fun `空与非法参数回空表`() {
        assertTrue(OcrBatch.groups(0, 4).isEmpty())
        assertTrue(OcrBatch.groups(5, 0).isEmpty())
        assertTrue(OcrBatch.groups(-1, 4).isEmpty())
    }

    /**
     * 出网边界: 屏幕画面默认绝不上传 (主人 2026-11-15 12:45 拍板)
     *
     * 读屏那条路只有端侧一支, 云端开关是常量且恒为 false —— 谁把它改成 true, 这条当场红
     */
    @Test
    fun `云端 OCR 默认关`() {
        assertFalse(LwOcr.allowCloud)
        assertEquals("local", LwOcr.ENGINE)
    }
}
