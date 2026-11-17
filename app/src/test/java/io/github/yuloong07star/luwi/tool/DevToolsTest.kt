package io.github.yuloong07star.luwi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「开发」那一段那几张表 ([DevTools]) 的判据 (2.8.1 #16, 2026-11-17 改口径)
 *
 * 这一段点下去要下东西, 所以表里写错一个字的样子都很安静: 域名打错 → 两条都连不上, 包名写错 → 下完了
 * 装不上还被 `mismatch` 一句听不懂的话挡回来, 文件名写错 → 404. 界面上一律只是 "没下下来" 加上那句原因,
 * 而原因是网络还是表写错了, 这里先钉住
 *
 * 现在这一段是两样**不同种类**的东西: 开发台是 `.apk`, 工具链是 `.zip` —— 这一份也把那条界线钉住
 * (工具链再被写回 APK 就该红)
 *
 * 断的是表本身 (纯数据), 不碰网络也不碰设备
 */
class DevToolsTest {

    @Test
    fun theOnlyAppLeftIsTheDevConsole() {
        assertEquals("只剩开发台这一件应用", listOf("dev-console"), DevTools.tools.map { it.id })
        val tool = DevTools.tools.single()
        assertTrue("要有名字", tool.label != 0)
        assertTrue("要有一句说明", tool.blurb != 0)
        assertEquals("包名与 DevApi 那一份一致", "io.github.yuloong07star.luwi.devconsole", tool.packageName)
    }

    @Test
    fun theAppAssetIsAnApkAndTheToolchainIsNot() {
        val tool = DevTools.tools.single()
        assertTrue("开发台的包名以 .apk 收", tool.asset.endsWith(".apk"))
        assertTrue("文件名不能带目录分隔符", !tool.asset.contains('/') && !tool.asset.contains('\\'))
        assertTrue("文件名不能带空格", !tool.asset.contains(' '))
        assertTrue("工具链是数据包, 以 .zip 收", DevTools.TOOLCHAIN_ASSET.endsWith(".zip"))
        assertTrue("工具链包名不能再是 apk", !DevTools.TOOLCHAIN_ASSET.endsWith(".apk"))
    }

    @Test
    fun everyAddressIsHttpsAndResolvesTheAsset() {
        val tool = DevTools.tools.single()
        val urls = DevTools.urlsOf(tool)
        assertEquals("一条主址 + 每一条兜底各一条", DevTools.HOSTS.size, urls.size)
        urls.forEach { url ->
            assertTrue("只收 https: $url", url.startsWith("https://"))
            assertTrue("地址里要落在这个文件上: $url", url.endsWith("/${tool.asset}"))
            assertTrue(
                "每一条都接在表里某个 base 上: $url",
                DevTools.HOSTS.any { base -> url == "$base/${tool.asset}" },
            )
        }
        assertEquals("同一条地址不写两遍", urls.size, urls.toSet().size)
    }

    @Test
    fun theToolchainHasItsOwnUrlsAtTheSameBase() {
        val urls = DevTools.toolchainUrls()
        assertEquals("每条 base 一条", DevTools.HOSTS.size, urls.size)
        urls.forEach { url ->
            assertTrue("只收 https: $url", url.startsWith("https://"))
            assertTrue("地址落在 zip 上: $url", url.endsWith("/${DevTools.TOOLCHAIN_ASSET}"))
        }
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
