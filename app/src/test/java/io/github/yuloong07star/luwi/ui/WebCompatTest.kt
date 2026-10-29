package io.github.yuloong07star.luwi.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 老 WebView 那条兼容层的纯算术 (2.7.10)
 *
 * 这里只钉一件会影响**要不要吓人**的事: 版本号到底读出什么。
 *
 * - 读错成一个大数 (UA 里那个 `AppleWebKit/537.36`): 一台 108 的老机器会被判成"不老", 于是既不提示
 *   也不说明, 又回到"对着连接中干等"
 * - 读不出来 (0): [WebCompat.Info.isOld] 对 0 是 false —— **不知道就别吓人**, 这一条也钉住
 */
class WebCompatTest {

    @Test
    fun `版本号从 versionName 里取`() {
        assertEquals(133, WebCompat.majorOf("133.0.6943.137"))
        assertEquals(108, WebCompat.majorOf("108.0.5359.128"))
        assertEquals(119, WebCompat.majorOf("119.0.6045.163"))
    }

    @Test
    fun `UA 里优先认 Chrome 那一段, 不能把 AppleWebKit 的数字当版本`() {
        val agent = "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36"
        assertEquals(108, WebCompat.majorOf(agent))
        assertEquals(0, WebCompat.majorOf("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko)"))
        assertEquals(0, WebCompat.majorOf(""))
    }

    @Test
    fun `读不出年份时不算老`() {
        assertEquals(true, WebCompat.Info("com.google.android.webview", "108.0.5359.128", 108).isOld)
        assertEquals(false, WebCompat.Info("com.google.android.webview", "133.0.6943.137", 133).isOld)
        // 0 = 不知道: 不提示, 但也不假装它新 (那一档由 12 秒没画出来那条兜底)
        assertEquals(false, WebCompat.Info("android.webkit", "", 0).isOld)
    }

    @Test
    fun `弹窗里那句话把包名与版本一起说清`() {
        assertEquals(
            "com.google.android.webview 108.0.5359.128",
            WebCompat.Info("com.google.android.webview", "108.0.5359.128", 108).label,
        )
        // 版本读不到的机器只报包名 (总比"WebView 太旧 ( )"强)
        assertEquals("android.webkit", WebCompat.Info("android.webkit", "", 0).label)
    }
}
