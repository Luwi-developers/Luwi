package io.github.yuloong07star.luwi.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 键盘避让那支纯函数的判据 (2026-10-28)
 *
 * 钉两件事: 贴底键盘要抬 imeBottom - navBottom; 悬浮键盘 / 贴底以外一律不抬
 */
class KeyboardInsetsTest {

    private val windowWidth = 1080
    private val windowHeight = 2400
    private val nav = 60

    private fun lift(
        imeBottom: Int,
        left: Int = 0,
        right: Int = 0,
        frames: List<ImeFrame> = emptyList(),
    ): Int = dockedImeLiftPx(
        imeBottom = imeBottom,
        imeLeft = left,
        imeRight = right,
        navBottom = nav,
        windowWidth = windowWidth,
        windowHeight = windowHeight,
        frames = frames,
    )

    @Test
    fun `没有键盘时不动它`() {
        assertEquals(0, lift(imeBottom = 0))
    }

    @Test
    fun `贴底全宽键盘让出键盘高度减导航条`() {
        val frame = ImeFrame(left = 0, top = 1500, right = windowWidth, bottom = windowHeight)
        assertEquals(840, lift(imeBottom = 900, frames = listOf(frame)))
    }

    @Test
    fun `三键导航时键盘停在导航条上沿也算贴底`() {
        val frame = ImeFrame(left = 0, top = 1500, right = windowWidth, bottom = windowHeight - nav)
        assertEquals(840, lift(imeBottom = 900, frames = listOf(frame)))
    }

    @Test
    fun `分体键盘取并集仍按贴底处理`() {
        val frames = listOf(
            ImeFrame(left = 0, top = 1500, right = 540, bottom = windowHeight),
            ImeFrame(left = 540, top = 1500, right = windowWidth, bottom = windowHeight),
        )
        assertEquals(840, lift(imeBottom = 900, frames = frames))
    }

    @Test
    fun `悬浮窄键盘不抬`() {
        val frame = ImeFrame(left = 200, top = 1500, right = 880, bottom = windowHeight)
        assertEquals(0, lift(imeBottom = 900, frames = listOf(frame)))
    }

    @Test
    fun `全宽但没贴到底的悬浮键盘不抬`() {
        val frame = ImeFrame(left = 0, top = 1200, right = windowWidth, bottom = 2100)
        assertEquals(0, lift(imeBottom = 900, frames = listOf(frame)))
    }

    @Test
    fun `拿不到边框时左右两侧没有 inset 才按贴底处理`() {
        assertEquals(840, lift(imeBottom = 900))
        assertEquals(0, lift(imeBottom = 900, left = 12))
        assertEquals(0, lift(imeBottom = 900, right = 12))
    }

    @Test
    fun `键盘比导航条还矮时不抬`() {
        assertEquals(0, lift(imeBottom = 40, frames = listOf(
            ImeFrame(left = 0, top = 2360, right = windowWidth, bottom = windowHeight),
        )))
    }

    @Test
    fun `边框容差内仍算贴底`() {
        val frame = ImeFrame(
            left = 0,
            top = 1498,
            right = windowWidth - 2,
            bottom = windowHeight - nav - 2,
        )
        assertEquals(840, lift(imeBottom = 900, frames = listOf(frame)))
    }
}
