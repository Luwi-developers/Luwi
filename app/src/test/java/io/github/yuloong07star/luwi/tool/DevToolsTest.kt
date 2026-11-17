package io.github.yuloong07star.luwi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「开发」那一段外部地址的判据 (2.8.1, 2026-11-17 收成一份数据包)
 *
 * 现在只剩工具链一件事: 地址写错的样子是"下不下来", 而原因在界面上只有一句 —— 所以这里先钉住
 *
 * 断的是表本身 (纯数据), 不碰网络也不碰设备
 */
class DevToolsTest {

    @Test
    fun theToolchainIsADataPackNotAnApp() {
        assertTrue("工具链是数据包, 以 .zip 收", DevTools.TOOLCHAIN_ASSET.endsWith(".zip"))
        assertTrue("工具链包名不能再是 apk", !DevTools.TOOLCHAIN_ASSET.endsWith(".apk"))
        assertEquals("sha256 要整 64 位", 64, DevTools.TOOLCHAIN_SHA256.length)
    }

    @Test
    fun everyAddressIsHttpsAndResolvesTheToolchain() {
        val urls = DevTools.toolchainUrls()
        assertEquals("每条 base 一条", DevTools.HOSTS.size, urls.size)
        urls.forEach { url ->
            assertTrue("只收 https: $url", url.startsWith("https://"))
            assertTrue("地址落在 zip 上: $url", url.endsWith("/${DevTools.TOOLCHAIN_ASSET}"))
        }
        assertEquals("同一条地址不写两遍", urls.size, urls.toSet().size)
    }

    @Test
    fun largeFilesDoNotGoThroughJsdelivr() {
        // 真机上直连 github.com 下不完 113 MB, jsDelivr 的 TLS 又连不上 —— 三个代理在前, 直连与官网在后
        assertEquals(
            "代理在前, 直连与官网兜底",
            listOf(
                "https://ghproxy.net/https://github.com/Yuloong07/luwi-devtools/releases/download/devtools-v1",
                "https://gh-proxy.com/https://github.com/Yuloong07/luwi-devtools/releases/download/devtools-v1",
                "https://ghfast.top/https://github.com/Yuloong07/luwi-devtools/releases/download/devtools-v1",
                "https://github.com/Yuloong07/luwi-devtools/releases/download/devtools-v1",
                "https://luwi.dpdns.org/dl",
            ),
            DevTools.HOSTS,
        )
        DevTools.HOSTS.forEach { base ->
            assertTrue("不许再回到 jsDelivr: $base", !base.contains("jsdelivr"))
        }
    }

    @Test
    fun theDownloadPageIsARealPlace() {
        assertTrue("那一页要能直接交给浏览器", DevTools.PAGE.startsWith("https://github.com/"))
        assertTrue("它指向下载仓的 Release", DevTools.PAGE.endsWith("/luwi-devtools/releases"))
    }
}
