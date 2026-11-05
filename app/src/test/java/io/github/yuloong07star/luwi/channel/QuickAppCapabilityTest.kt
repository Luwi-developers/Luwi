package io.github.yuloong07star.luwi.channel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 快应用那一条的纯逻辑 [QuickAppCapability]
 *
 * 设备那一半 (PackageManager 认不认 activity) 只有在机器上才问得到, 这里钉的是它前后的形状:
 * 标准链接怎么拼, 什么链接才许发, 一条都不被接下的说法是什么. 这三件事任何一件漂开, 现象都是
 * "模型以为快应用开不了" 或 "发了一条别的链接出去却说开成了" —— 都不能靠真机碰运气发现
 */
internal class QuickAppCapabilityTest {

    @Test
    fun `标准链接是 hap app 加包名, 可带页面与查询参数`() {
        assertEquals(
            "hap://app/com.example.quickapp",
            QuickAppCapability.linkFor("com.example.quickapp"),
        )
        assertEquals(
            "hap://app/com.example.quickapp/Detail",
            QuickAppCapability.linkFor("com.example.quickapp", path = "Detail"),
        )
        assertEquals(
            "hap://app/com.example.quickapp/pages/index?key=value",
            QuickAppCapability.linkFor(
                packageName = "com.example.quickapp",
                path = "/pages/index/",
                query = "?key=value",
            ),
        )
    }

    @Test
    fun `不像包名的名字不给链接`() {
        assertNull(QuickAppCapability.linkFor(""))
        assertNull(QuickAppCapability.linkFor("not-a-package"))
        assertNull(QuickAppCapability.linkFor("com..example"))
        assertNull(QuickAppCapability.linkFor("com.example", path = "a b"))
        assertNull(QuickAppCapability.linkFor("com.example", query = "key=two words"))
    }

    @Test
    fun `三条候选按 hap https http 排, 尾段同一个`() {
        val candidates = QuickAppCapability.candidatesFor("com.example.quickapp", path = "Detail")
        assertEquals(listOf("hap", "https", "http"), candidates.map { it.scheme })
        assertEquals("hap://app/com.example.quickapp/Detail", candidates[0].uri)
        assertEquals("https://hapjs.org/app/com.example.quickapp/Detail", candidates[1].uri)
        assertEquals("http://hapjs.org/app/com.example.quickapp/Detail", candidates[2].uri)
        assertTrue(QuickAppCapability.candidatesFor("not a package").isEmpty())
    }

    @Test
    fun `只认快应用自己的三种链接`() {
        assertNull(QuickAppCapability.linkProblem("hap://app/com.example.quickapp"))
        assertNull(QuickAppCapability.linkProblem("https://hapjs.org/app/com.example.quickapp/page?k=v"))
        assertNull(QuickAppCapability.linkProblem("http://hapjs.org/app/com.example.quickapp"))
        assertNotNull(QuickAppCapability.linkProblem(""))
        assertNotNull(QuickAppCapability.linkProblem("https://example.com/com.example.quickapp"))
        assertNotNull(QuickAppCapability.linkProblem("hap://app/"))
        assertNotNull(QuickAppCapability.linkProblem("hap://app/not a package"))
        assertNotNull(QuickAppCapability.linkProblem("com.example.quickapp"))
    }

    @Test
    fun `一条 runtime 都没有时明确说 unsupported, 而且点名建屏没用`() {
        val reason = QuickAppCapability.noRuntimeReason(
            listOf("hap://app/com.example.quickapp", "https://hapjs.org/app/com.example.quickapp"),
        )
        assertTrue(reason, reason.contains(QuickAppCapability.UNSUPPORTED))
        assertTrue(reason, reason.contains("virtual screen"))
        assertTrue(reason, reason.contains("hap://app/com.example.quickapp"))
    }

    @Test
    fun `scheme 从链接本身读出来`() {
        assertEquals("hap", QuickAppCapability.schemeOf("hap://app/com.example"))
        assertEquals("https", QuickAppCapability.schemeOf("https://hapjs.org/app/com.example"))
        assertEquals("http", QuickAppCapability.schemeOf("http://hapjs.org/app/com.example"))
        assertEquals("", QuickAppCapability.schemeOf("content://media/1"))
    }
}
