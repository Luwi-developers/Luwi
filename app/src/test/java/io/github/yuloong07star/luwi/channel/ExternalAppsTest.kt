package io.github.yuloong07star.luwi.channel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 登记表的解析与 handoff 的门槛
 *
 * 这两条都是纯函数, 所以不碰设备也能验: 主人手写的那份 `external-apps.json` 长什么样的错都该在这里
 * 被接住 (漏 package / id 重名 / 包名不像包名), 而 handoff 该拦的是"把手机里的东西递出去",
 * 不该拦主人自己打的普通句子
 */
class ExternalAppsTest {

    @Test
    fun `正常的两条都认`() {
        val loaded = ExternalApps.parse(
            """
            {"v":1,"apps":[
              {"id":"termux","label":"Termux","package":"com.termux",
               "activity":"com.termux/.app.TermuxActivity","mime":"text/plain"},
              {"id":"ide","package":"com.example.ide","sendAction":"android.intent.action.SEND"}
            ]}
            """.trimIndent(),
        )
        assertEquals("", loaded.error)
        assertEquals(listOf("termux", "ide"), loaded.entries.map { it.id })
        assertEquals("Termux", loaded.entries[0].label)
        assertEquals("com.example.ide", loaded.entries[1].packageName)
        // label 没写就拿 id 顶上, 不空着
        assertEquals("ide", loaded.entries[1].label)
        assertNull(loaded.entries[1].activity)
    }

    @Test
    fun `不是 JSON 就把话说清楚而不是抛`() {
        val loaded = ExternalApps.parse("这不是 json")
        assertTrue(loaded.entries.isEmpty())
        assertTrue(loaded.error.startsWith("登记表不是 JSON 对象"))
    }

    @Test
    fun `没有 apps 数组`() {
        val loaded = ExternalApps.parse("""{"v":1}""")
        assertTrue(loaded.error.contains("没有 apps 数组"))
    }

    @Test
    fun `一条坏的不连累其余`() {
        val loaded = ExternalApps.parse(
            """
            {"apps":[
              {"id":"ok","package":"com.example.ok"},
              {"id":"nopkg"},
              {"id":"bad/name","package":"com.example.bad"}
            ]}
            """.trimIndent(),
        )
        assertEquals(listOf("ok"), loaded.entries.map { it.id })
        assertTrue(loaded.error.contains("nopkg 没有 package"))
        assertTrue(loaded.error.contains("id 只能用字母数字与横线"))
    }

    @Test
    fun `id 重名只认第一条`() {
        val loaded = ExternalApps.parse(
            """
            {"apps":[
              {"id":"dup","package":"com.example.one"},
              {"id":"dup","package":"com.example.two"}
            ]}
            """.trimIndent(),
        )
        assertEquals(1, loaded.entries.size)
        assertEquals("com.example.one", loaded.entries[0].packageName)
        assertTrue(loaded.error.contains("dup 重复了"))
    }

    @Test
    fun `包名不像包名就丢`() {
        val loaded = ExternalApps.parse("""{"apps":[{"id":"x","package":"not a package"}]}""")
        assertTrue(loaded.entries.isEmpty())
        assertTrue(loaded.error.contains("不像包名"))
    }

    @Test
    fun `activity 要写成 包名 斜杠 类名`() {
        val loaded = ExternalApps.parse(
            """{"apps":[{"id":"x","package":"com.example.x","activity":"MainActivity"}]}""",
        )
        assertTrue(loaded.entries.isEmpty())
        assertTrue(loaded.error.contains("要写成 包名/类名"))
    }

    @Test
    fun `组件名两种写法都认`() {
        assertEquals(
            ExternalApps.Named("com.example.app", "com.example.app.Main"),
            ExternalApps.parseComponent("com.example.app/.Main"),
        )
        assertEquals(
            ExternalApps.Named("com.example.app", "com.example.app.Main"),
            ExternalApps.parseComponent("com.example.app/com.example.app.Main"),
        )
        assertNull(ExternalApps.parseComponent("没有斜杠"))
    }

    @Test
    fun `handoff 收下普通的一句话`() {
        assertNull(ExternalApps.handoffProblem("把这段笔记记到备忘里: 明天买 3/4 斤虾"))
        assertNull(ExternalApps.handoffProblem("  前后有空格也算  "))
    }

    @Test
    fun `handoff 拒空与超长`() {
        assertNotNull(ExternalApps.handoffProblem("   "))
        val long = "字".repeat(ExternalApps.MAX_TEXT + 1)
        assertTrue(ExternalApps.handoffProblem(long)!!.contains("最多"))
    }

    @Test
    fun `handoff 拒 URI 与路径`() {
        assertNotNull(ExternalApps.handoffProblem("打开 file:///sdcard/a.txt"))
        assertNotNull(ExternalApps.handoffProblem("content://media/external/images/1"))
        assertNotNull(ExternalApps.handoffProblem("读一下 /data/local/tmp/x"))
        assertNotNull(ExternalApps.handoffProblem("路径 /storage/emulated/0/DCIM"))
    }

    @Test
    fun `handoff 拒凭据`() {
        assertNotNull(ExternalApps.handoffProblem("这是我的 token: abc"))
        assertNotNull(ExternalApps.handoffProblem("API KEY 在下面"))
    }
}
