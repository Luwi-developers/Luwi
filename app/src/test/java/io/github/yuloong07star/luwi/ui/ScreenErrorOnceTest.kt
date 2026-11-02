package io.github.yuloong07star.luwi.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 主页那条一次性错误 Dialog 的去重判据 (2.8.0 B2-c)
 *
 * 以前主页常驻一行「虚拟屏: …」, 失败那次留下的句子一直挂着 —— 人分不清它是刚刚发生的还是昨天
 * 留下的。改成弹一次就走, 而**同一个 reason 30 s 内只弹一次**: 连点几下会连着失败三四回, 每回
 * 都弹一个窗等于什么都没说
 *
 * 钉四件事: 第一次弹; 同一句窗口内不再弹; 窗口过了再弹; 空理由一律不弹 (没有错误就不该弹窗)。
 * 时钟是参数, 所以这里量的是规则本身, 不碰系统时间
 */
class ScreenErrorOnceTest {

    private val window = 30_000L

    @Test
    fun `first reason is shown`() {
        val once = ScreenErrorOnce(window)
        assertEquals(true, once.take("the privileged channel is down", 1_000L))
    }

    @Test
    fun `same reason inside the window is dropped`() {
        val once = ScreenErrorOnce(window)
        assertEquals(true, once.take("no privileged process", 1_000L))
        // 三个读数都在窗口内: 连点三下失败, 只该弹第一个
        assertEquals(false, once.take("no privileged process", 1_500L))
        assertEquals(false, once.take("no privileged process", 20_000L))
        // 窗口是 [at, at + 30 s): 29 999 ms 仍算同一句
        assertEquals(false, once.take("no privileged process", 1_000L + window - 1))
    }

    @Test
    fun `same reason comes back after the window`() {
        val once = ScreenErrorOnce(window)
        assertEquals(true, once.take("no privileged process", 1_000L))
        // 30 s 整就是新的一次 (过一会儿再失败, 该再说一遍)
        assertEquals(true, once.take("no privileged process", 1_000L + window))
        // 紧接着那一句又进窗口
        assertEquals(false, once.take("no privileged process", 1_000L + window + 5))
    }

    @Test
    fun `a different reason is shown at once`() {
        val once = ScreenErrorOnce(window)
        assertEquals(true, once.take("the user closed the virtual screen", 1_000L))
        // 换了一句就是另一件事, 不该被上一句的窗口吃掉
        assertEquals(true, once.take("the privileged channel is down", 1_100L))
        assertEquals(false, once.take("the privileged channel is down", 1_200L))
        // 再回到前一句: 它上一次弹在 1 s, 已经过窗口了, 所以也算新的一次
        assertEquals(true, once.take("the user closed the virtual screen", 1_300L))
    }

    @Test
    fun `no reason never pops`() {
        val once = ScreenErrorOnce(window)
        assertEquals(false, once.take(null, 1_000L))
        assertEquals(false, once.take("", 2_000L))
        assertEquals(false, once.take("   ", 3_000L))
        // 前面几次空读数不该把窗口算进去: 第一句真理由仍然要弹
        assertEquals(true, once.take("no directory to write a picture into", 4_000L))
    }

    @Test
    fun `the window is thirty seconds`() {
        assertEquals(30_000L, SCREEN_ERROR_WINDOW_MS)
    }
}
