package io.github.yuloong07star.luwi.channel

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 预览帧率那一条纯函数 ([previewGapFor])
 *
 * 以前是写死的 66ms (15fps), 那一档是给 1080p 调好的: 2K 屏每帧 18 MB, 同一档就是每秒搬 1.1 GB,
 * 而 720p 又白等。改成"每秒最多搬 150 MB"之后, 同一常数在所有分辨率上都落在 33~200ms 里 ——
 * 这里把三个常见分辨率与两头夹住的边界逐条钉住
 */
class FrameCacheTest {

    @Test
    fun `1080p 落在 66ms 上下`() {
        // 1080x2316 每帧约 10 MB, 150 MB/s 约 66ms —— 与以前写死的 66 一致
        assertEquals(66L, previewGapFor(1080, 2316))
    }

    @Test
    fun `2K 自动放慢`() {
        // 1440x3200 每帧约 18 MB, 约 123ms: 不再按 15fps 白搬
        assertEquals(122L, previewGapFor(1440, 3200))
    }

    @Test
    fun `720p 顶到 33ms`() {
        assertEquals(33L, previewGapFor(720, 1600))
    }

    @Test
    fun `夹在 33 到 200 之间`() {
        assertEquals(33L, previewGapFor(1, 1))
        assertEquals(200L, previewGapFor(4320, 7680))
    }

    @Test
    fun `尺寸非法时退回缓存间隔`() {
        assertEquals(250L, previewGapFor(0, 0))
    }
}
