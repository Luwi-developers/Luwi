package io.github.yuloong07star.luwi.host

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * host 那条地址的对外形态 ([HostUrl.masked])
 *
 * 为什么值得单测: `dsh web` 把连接令牌放在 URL 的 query 里, 而这份串会顺着 `lw_overlay` 的工具
 * 结果进模型的上下文 —— 模型再写进聊天记录、日志、随手 `curl`, 令牌就出门了。工具那一侧只许给
 * 打码后的形态, 所以这里的判据是"令牌一个字符都不许原样留下", 而别的东西 (端口、路径、参数名)
 * 一个都不许丢
 */
class HostUrlTest {

    @Test
    fun `the token in the loopback url is masked but the rest is kept`() {
        val url = "http://127.0.0.1:3080/?token=0123456789abcdef0123456789abcdef01234567"
        val masked = HostUrl.masked(url)
        assertEquals("http://127.0.0.1:3080/?token=••••4567", masked)
    }

    @Test
    fun `the masked form never contains the secret`() {
        val secret = "abcdef0123456789abcdef0123456789abcdef01"
        val masked = HostUrl.masked("http://127.0.0.1:3080/?token=$secret")
        assertEquals(false, masked.contains(secret))
        assertEquals(false, masked.contains(secret.takeLast(8)))
    }

    @Test
    fun `a url without a secret comes back untouched`() {
        assertEquals("http://127.0.0.1:3080/", HostUrl.masked("http://127.0.0.1:3080/"))
        assertEquals("", HostUrl.masked(""))
        assertEquals("starting", HostUrl.masked("starting"))
    }

    @Test
    fun `other secret parameter names are masked too and later parameters survive`() {
        assertEquals(
            "http://127.0.0.1:3080/?auth=••••1234&tab=chat#top",
            HostUrl.masked("http://127.0.0.1:3080/?auth=9988776655441234&tab=chat#top"),
        )
    }

    @Test
    fun `a short secret is hidden whole`() {
        assertEquals("http://127.0.0.1:3080/?token=••••", HostUrl.masked("http://127.0.0.1:3080/?token=ab"))
    }
}
