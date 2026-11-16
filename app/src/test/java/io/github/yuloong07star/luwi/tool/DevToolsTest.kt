package io.github.yuloong07star.luwi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「开发」那一段那张表 ([DevTools]) 的判据 (2.8.1 #16)
 *
 * 这一段点下去要下东西, 所以表里写错一个字的样子都很安静: 镜像域名打错 → 两条都连不上, 包名写错 →
 * 下完了装不上还被 `mismatch` 一句听不懂的话挡回来, 文件名写错 → 404. 界面上一律只是 "没下下来" 加上
 * 那句原因, 而原因是网络还是表写错了, 这里先钉住
 *
 * 断的是表本身 (纯数据), 不碰网络也不碰设备 —— 下载与安装那两条路由
 * [io.github.yuloong07star.luwi.plugin.CompanionApk] 的既有判据管着
 */
class DevToolsTest {

    @Test
    fun catalogIsTheTwoThingsTheOwnerNamed() {
        assertEquals("这两件: 安卓开发工具 / Luwi 开发台", listOf("android-dev-tools", "dev-console"), DevTools.tools.map { it.id })
        assertEquals("id 不能重复", DevTools.tools.size, DevTools.tools.map { it.id }.toSet().size)
        DevTools.tools.forEach { tool ->
            assertTrue("${tool.id} 要有名字", tool.label != 0)
            assertTrue("${tool.id} 要有一句说明", tool.blurb != 0)
        }
    }

    @Test
    fun everyToolHasItsOwnPackage() {
        val packages = DevTools.tools.map { it.packageName }
        assertTrue("包名要像包名", packages.all { it.contains('.') && !it.contains(' ') })
        assertEquals("两件是两个包, 否则装一件两行一起变已装", packages.size, packages.toSet().size)
    }

    @Test
    fun assetsAreApkFilesNextToTheOtherCompanions() {
        DevTools.tools.forEach { tool ->
            assertTrue("${tool.id} 的包名要以 .apk 收", tool.asset.endsWith(".apk"))
            assertTrue("${tool.id} 的文件名不能带目录分隔符", !tool.asset.contains('/') && !tool.asset.contains('\\'))
            assertTrue("${tool.id} 的文件名不能带空格 (URL 里那一格会被截断)", !tool.asset.contains(' '))
        }
        assertEquals("两件是两个文件", DevTools.tools.size, DevTools.tools.map { it.asset }.toSet().size)
    }

    @Test
    fun everyAddressIsHttpsAndResolvesTheAsset() {
        DevTools.tools.forEach { tool ->
            val urls = DevTools.urlsOf(tool)
            assertEquals("一条主址 + 每一条镜像各一条", DevTools.HOSTS.size, urls.size)
            urls.forEach { url ->
                assertTrue("只收 https: $url", url.startsWith("https://"))
                assertTrue("地址里要落在这个文件上: $url", url.endsWith("/${tool.asset}"))
                assertTrue(
                    "镜像只在表里那几个域上: $url",
                    DevTools.HOSTS.any { url.startsWith("https://$it/") },
                )
            }
            assertEquals("同一条地址不写两遍", urls.size, urls.toSet().size)
        }
    }

    @Test
    fun mirrorsAreTheOnesThePluginIndexAlreadyUses() {
        assertEquals(
            "与 PluginIndex 同一套 jsDelivr: 主址在前, 镜像在后",
            listOf("cdn.jsdelivr.net", "fastly.jsdelivr.net"),
            DevTools.HOSTS,
        )
    }

    @Test
    fun theDownloadPageIsARealPlace() {
        assertTrue("那一页要能直接交给浏览器", DevTools.PAGE.startsWith("https://github.com/"))
        assertTrue("它指向生态仓", DevTools.PAGE.endsWith("/luwi-plugins"))
    }
}
