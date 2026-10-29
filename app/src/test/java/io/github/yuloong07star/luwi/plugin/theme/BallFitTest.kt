package io.github.yuloong07star.luwi.plugin.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「按高贴满、宽度按比例居中」那条算式的判据 (2026-10-25 主人: "东张西望动作左右比例被挤压了")
 *
 * 钉的是**素材的宽高比原样落进窗里**这一条: 从前走 `BitmapDrawable` 的 `Gravity.FILL`, 187x224 的
 * 「东张西望」被拉成 224x224, 横向多出 20% —— 而七档素材宽度从 175 到 255 不等, 所以每换一次状态
 * 人物胖瘦都不一样。这个数漂回去的话, 球上看不出"哪边错了", 只觉得"人物有点怪"
 *
 * 纯算术, 没有设备也能量 (同 BallTest 那一套)
 */
class BallFitTest {

    /** 方窗的边长 (px): 72 dp @ 3x, 与 `ball-art` 那套预览 GIF 的窗一样 */
    private val box = 216

    @Test
    fun `东张西望的宽高比原样落进方窗`() {
        // art/peeked 那一支: 187x224 (高等于成品管线的 OUT_H)
        val fit = BallFit.contain(187, 224, box, box)
        assertEquals(box.toFloat(), fit.height, 0.001f)
        assertEquals(187f / 224f, fit.width / fit.height, 0.0001f)
    }

    @Test
    fun `比方窗还宽的素材不缩放高度, 只往两边对称超出`() {
        // art/idle/1 那一支: 255x224 —— 按高之后比方窗宽, 多出来的两份一样多
        val fit = BallFit.contain(255, 224, box, box)
        assertEquals(box.toFloat(), fit.height, 0.001f)
        assertTrue("按高之后应当比窗宽: ${fit.width}", fit.width > box)
        assertTrue("左侧应当为负: ${fit.left}", fit.left < 0f)
        assertEquals(fit.left, box - (fit.left + fit.width), 0.001f)
    }

    @Test
    fun `窄素材落在窗里居中, 两边留白一样多`() {
        // art/done 那一支: 179x224 —— 比窗窄, 于是左右各留一条透明边
        val fit = BallFit.contain(179, 224, box, box)
        assertTrue("按高之后应当比窗窄: ${fit.width}", fit.width < box)
        assertEquals((box - fit.width) / 2f, fit.left, 0.001f)
        assertEquals(fit.left, box - (fit.left + fit.width), 0.001f)
    }

    @Test
    fun `零尺寸不炸 (退化成空盒, 调用方直接不画)`() {
        assertEquals(BallFit.Box(0f, 0f, 0f, 0f), BallFit.contain(0, 224, box, box))
        assertEquals(BallFit.Box(0f, 0f, 0f, 0f), BallFit.contain(187, 224, 0, box))
    }
}
