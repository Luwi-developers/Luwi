package io.github.yuloong07star.luwi.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「这一次打开要不要弹首启引导」的判据 (2.8.0 #39)
 *
 * 这一条同时决定两件事: 那一窗弹不弹, 以及 dsh 那一页要不要先等一等 —— 引导在场期间不挂 WebView,
 * 关掉之后才挂, 于是 dsh 自己的登录弹窗只能出现在引导之后。判错一处就是两种老毛病之一: 记过还弹
 * (每一次打开都撞一遍), 或者一台新机器上永远不弹 (页面也就永远不等, 登录弹窗又抢在前面)
 *
 * 只量纯判据: [GettingStarted.prepare] / [GettingStarted.release] 里那两行 logcat 读数靠真机日志
 */
class GettingStartedTest {

    @Test
    fun `a machine that never saw the guide waits for it`() {
        // 全新装的机器: 偏好里没记号, 这一趟也还没弹 —— 弹, 并且页面让路
        assertTrue(firstRunWaits(seen = false, promptedThisRun = false))
    }

    @Test
    fun `a machine that saw it before never waits again`() {
        // 记过就是记过: 重启之后照旧直接进页面, 不该再拦一次
        assertFalse(firstRunWaits(seen = true, promptedThisRun = false))
    }

    @Test
    fun `the guide already shown in this run does not wait again`() {
        // 这一趟已经弹过 (Activity 重建 / 转屏): 页面不该被同一窗再压一次
        assertFalse(firstRunWaits(seen = false, promptedThisRun = true))
        assertFalse(firstRunWaits(seen = true, promptedThisRun = true))
    }
}
