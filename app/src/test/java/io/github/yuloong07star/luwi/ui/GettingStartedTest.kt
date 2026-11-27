package io.github.yuloong07star.luwi.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「这一次打开要不要弹首启引导」与「引导排在哪一步」的判据 (2.8.0 #44)
 *
 * 两条判据各管一件事: [firstRunWaits] 决定那一窗弹不弹; [guideWaitsLoading] 决定它要不要等加载界面
 * (开屏 + 页面加载) 走完 —— 顺序是**加载界面在前, 引导在后**, #39 那条"引导在前、页面在引导之后才挂"
 * 已经被推翻。判错一处就是两种老毛病之一: 记过还弹 (每一次打开都撞一遍), 或者一台新机器上永远不弹
 *
 * 只量纯判据: [GettingStarted.prepare] / [GettingStarted.settle] 里那两行 logcat 读数靠真机日志
 */
class GettingStartedTest {

    @Test
    fun `a machine that never saw the guide waits for it`() {
        // 全新装的机器: 偏好里没记号, 这一趟也还没弹 —— 弹
        assertTrue(firstRunWaits(seen = false, promptedThisRun = false))
    }

    @Test
    fun `a machine that saw it before never waits again`() {
        // 记过就是记过: 重启之后照旧直接进页面, 不该再拦一次
        assertFalse(firstRunWaits(seen = true, promptedThisRun = false))
    }

    @Test
    fun `the guide already shown in this run does not wait again`() {
        // 这一趟已经弹过 (Activity 重建 / 转屏): 不该被同一窗再拦一次
        assertFalse(firstRunWaits(seen = false, promptedThisRun = true))
        assertFalse(firstRunWaits(seen = true, promptedThisRun = true))
    }

    @Test
    fun `the loading screen comes before the guide`() {
        // 首启: 加载界面还没走完, 引导就得等着 (加载界面在前)
        assertTrue(guideWaitsLoading(firstRun = true, loadingDone = false))
        // 页面画出来了 (或 host 起不来 / 兜底到点): 引导这一帧起可以弹
        assertFalse(guideWaitsLoading(firstRun = true, loadingDone = true))
    }

    @Test
    fun `a machine that has seen the guide never waits for loading`() {
        // 不是首启: 加载界面收不收尾都与引导无关 —— 页面照旧一就绪就挂
        assertFalse(guideWaitsLoading(firstRun = false, loadingDone = false))
        assertFalse(guideWaitsLoading(firstRun = false, loadingDone = true))
    }

    @Test
    fun `the backstop is long enough for a first unpack but still bounded`() {
        // 首启解压三万多个文件比半分钟长是正常的; 但兜底不能没有, 也不能长到让人以为引导永远不会来
        assertTrue(LOADING_BACKSTOP_MS >= 30_000L)
        assertTrue(LOADING_BACKSTOP_MS <= 90_000L)
    }
}
