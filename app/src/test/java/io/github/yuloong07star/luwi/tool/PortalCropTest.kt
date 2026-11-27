package io.github.yuloong07star.luwi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 裁剪几何那几条算术 (2026-11-15): 铺满 / 夹紧 / 落盘矩形 / 退化输入
 *
 * 这些都没有设备也能量, 而它们恰好是"手一滑就露白"与"落盘落偏"的全部来源 —— 头像那块是圆的,
 * 背景那块铺满整屏, 两边都走同一份 [PortalCrop]
 */
class PortalCropTest {

    /** 4:3 的源图放进 3:4 的框: 铺满之后纵向对齐, 横向多出来的一段居中 */
    @Test
    fun `铺满的起始档就是整张图`() {
        val frame = PortalCrop.fit(400, 300, 300f, 400f)
        val rect = PortalCrop.rectOf(frame, 400, 300, 300f, 400f)
        // 4:3 进 3:4: 按高铺满 (400/300), 缩放图宽 533.3 比框宽, 左右各被切掉一段
        assertEquals(0, rect.top)
        assertEquals(300, rect.bottom)
        assertTrue("左右该被裁到框的比例 (实际 ${rect.left}..${rect.right})", rect.left > 0 || rect.right < 400)
        assertTrue(rect.width > 0 && rect.height > 0)
    }

    /** 方图进方框: 一像素都不该裁 */
    @Test
    fun `同比例时落盘就是原图`() {
        val frame = PortalCrop.fit(512, 512, 300f, 300f)
        val rect = PortalCrop.rectOf(frame, 512, 512, 300f, 300f)
        assertEquals(PortalCrop.Rect(0, 0, 512, 512), rect)
    }

    /** 放大之后框里仍然是这一张图, 不许露白 (dx 落在 [boxW - 宽, 0]) */
    @Test
    fun `放大之后再平移也不许露白`() {
        val boxW = 300f
        val boxH = 300f
        val zoomed = PortalCrop.clamp(PortalCrop.Frame(scale = 4f, dx = 9999f, dy = -9999f), 512, 512, boxW, boxH)
        val width = 512 * zoomed.scale
        assertTrue("dx 越界了: ${zoomed.dx}", zoomed.dx <= 0f && zoomed.dx >= boxW - width)
        assertTrue("dy 越界了: ${zoomed.dy}", zoomed.dy <= 0f && zoomed.dy >= boxH - width)
    }

    /** 缩放下限是铺满, 上限是铺满的 MAX_ZOOM 倍 */
    @Test
    fun `缩放夹在铺满与铺满的四倍之间`() {
        val base = PortalCrop.baseScale(400, 300, 300f, 400f)
        assertEquals(base, PortalCrop.clamp(PortalCrop.Frame(0.01f, 0f, 0f), 400, 300, 300f, 400f).scale, 0.0001f)
        assertEquals(base * PortalCrop.MAX_ZOOM, PortalCrop.clamp(PortalCrop.Frame(99f, 0f, 0f), 400, 300, 300f, 400f).scale, 0.0001f)
    }

    /** 源图比框小 (老的小图): 仍然铺满, 不居中留白 */
    @Test
    fun `小图也铺满框`() {
        val frame = PortalCrop.fit(40, 40, 300f, 300f)
        val rect = PortalCrop.rectOf(frame, 40, 40, 300f, 300f)
        assertEquals(PortalCrop.Rect(0, 0, 40, 40), rect)
    }

    /** 退化输入: 宽高为 0 时不抛、回一个合法的一像素矩形 */
    @Test
    fun `退化尺寸也回一个合法矩形`() {
        val rect = PortalCrop.rectOf(PortalCrop.Frame(1f, 0f, 0f), 0, 0, 300f, 300f)
        assertTrue(rect.width >= 1 && rect.height >= 1)
    }

    /** 框的比例: 头像 1:1, 背景按屏 (9:19.5) */
    @Test
    fun `框高按比例反推`() {
        assertEquals(320f, PortalCrop.boxHeight(320f, 1f), 0.001f)
        assertEquals(320f / (9f / 19.5f), PortalCrop.boxHeight(320f, 9f / 19.5f), 0.5f)
    }
}
