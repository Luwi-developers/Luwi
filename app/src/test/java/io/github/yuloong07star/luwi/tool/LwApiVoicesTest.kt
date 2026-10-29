package io.github.yuloong07star.luwi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 音色库那份登记表的解析 (没有设备, 也不读文件)
 *
 * 这份表是**别人写的** (agent / 人), 所以这里量的是"写坏了会怎样": 坏一条不该把整份带走, 也不能静默
 * 变成一张空表 —— 每种坏法都要留一句给界面看的读数
 */
class LwApiVoicesTest {

    @Test
    fun `正常两条都读出来, 名字 模型 备注都在`() {
        val parsed = LwApiVoices.parse(
            """
            {"v":1,"voices":[
              {"id":"luwi-soft-01","name":"柔声","model":"cosyvoice-v3-plus","note":"女声, 偏轻"},
              {"id":"luwi-deep","name":"低沉"}
            ]}
            """.trimIndent(),
        )
        assertEquals("", parsed.note)
        assertEquals(2, parsed.entries.size)
        val first = parsed.entries[0]
        assertEquals("luwi-soft-01", first.id)
        assertEquals("柔声", first.display)
        assertEquals("cosyvoice-v3-plus", first.model)
        assertEquals("女声, 偏轻", first.note)
        assertEquals("", parsed.entries[1].model)
    }

    @Test
    fun `没写名字就用 id 当显示名`() {
        val parsed = LwApiVoices.parse("""{"v":1,"voices":[{"id":"plain-voice"}]}""")
        assertEquals("plain-voice", parsed.entries.single().display)
    }

    @Test
    fun `同一个 id 后写的覆盖先写的`() {
        val parsed = LwApiVoices.parse(
            """{"v":1,"voices":[{"id":"same","name":"旧"},{"id":"same","name":"新"}]}""",
        )
        assertEquals(1, parsed.entries.size)
        assertEquals("新", parsed.entries.single().name)
    }

    @Test
    fun `坏的条目跳过, 好的照用, 而且留一句读数`() {
        val parsed = LwApiVoices.parse(
            """
            {"v":1,"voices":[
              "not an object",
              {"name":"没有 id"},
              {"id":"ok","name":"能用"},
              {"id":"${"x".repeat(200)}"}
            ]}
            """.trimIndent(),
        )
        assertEquals(listOf("ok"), parsed.entries.map { it.id })
        assertTrue(parsed.note, parsed.note.contains("跳过"))
    }

    @Test
    fun `模型太长就不采用, 免得拿一个坏名字去发请求`() {
        val longModel = "m".repeat(200)
        val parsed = LwApiVoices.parse("""{"v":1,"voices":[{"id":"a","model":"$longModel"}]}""")
        assertEquals("", parsed.entries.single().model)
    }

    @Test
    fun `最多认三十二条, 多的截掉并报数`() {
        val rows = (1..40).joinToString(",") { """{"id":"v$it","name":"v$it"}""" }
        val parsed = LwApiVoices.parse("""{"v":1,"voices":[$rows]}""")
        assertEquals(32, parsed.entries.size)
        assertTrue(parsed.note, parsed.note.contains("32"))
    }

    @Test
    fun `版本不认识就整份不采用`() {
        val parsed = LwApiVoices.parse("""{"v":2,"voices":[{"id":"a"}]}""")
        assertTrue(parsed.entries.isEmpty())
        assertTrue(parsed.note, parsed.note.contains("v"))
    }

    @Test
    fun `不是 JSON 有一句原因, 空文件算还没有音色`() {
        assertTrue(LwApiVoices.parse("not json at all").note.isNotEmpty())
        assertTrue(LwApiVoices.parse("").entries.isEmpty())
        assertTrue(LwApiVoices.parse("").note.isEmpty())
        assertTrue(LwApiVoices.parse(null).note.isEmpty())
    }

    @Test
    fun `没有 voices 数组也说得清`() {
        val parsed = LwApiVoices.parse("""{"v":1}""")
        assertTrue(parsed.entries.isEmpty())
        assertTrue(parsed.note, parsed.note.contains("voices"))
    }

    @Test
    fun `名字与备注超长就截断, 不整条丢掉`() {
        val longName = "n".repeat(200)
        val parsed = LwApiVoices.parse(
            """{"v":1,"voices":[{"id":"a","name":"$longName","note":"${"z".repeat(400)}"}]}""",
        )
        val one = parsed.entries.single()
        assertEquals(48, one.name.length)
        assertEquals(120, one.note.length)
    }

    /* ── 登记 / 撤销: 应用代写那一半 (纯函数) ─────────────────────────── */

    @Test
    fun `登记一条写出 v1 的形状, 再读回来是同一条`() {
        val text = LwApiVoices.merge(
            null,
            LwApiVoices.Entry("luwi-soft-01", "柔声", "cosyvoice-v3-plus", "偏轻"),
        )
        assertTrue(text, text.contains("\"v\":1"))
        val one = LwApiVoices.parse(text).entries.single()
        assertEquals("luwi-soft-01", one.id)
        assertEquals("柔声", one.name)
        assertEquals("cosyvoice-v3-plus", one.model)
        assertEquals("偏轻", one.note)
    }

    @Test
    fun `同一个 id 再登记是更新, 别的条目保住`() {
        val before = LwApiVoices.encode(
            listOf(
                LwApiVoices.Entry("keep", "留住", "", ""),
                LwApiVoices.Entry("same", "旧名", "", ""),
            ),
        )
        val after = LwApiVoices.parse(
            LwApiVoices.merge(before, LwApiVoices.Entry("same", "新名", "m2", "")),
        )
        assertEquals(listOf("keep", "same"), after.entries.map { it.id })
        assertEquals("新名", after.entries.first { it.id == "same" }.name)
        assertEquals("m2", after.entries.first { it.id == "same" }.model)
    }

    @Test
    fun `满了三十二条就不收新的`() {
        val full = LwApiVoices.encode((1..32).map { LwApiVoices.Entry("v$it", "v$it", "", "") })
        assertThrows(IllegalStateException::class.java) {
            LwApiVoices.merge(full, LwApiVoices.Entry("one-more", "多一个", "", ""))
        }
    }

    @Test
    fun `读不懂的文件拒绝增量写, 免得把旧条目覆盖掉`() {
        assertThrows(IllegalStateException::class.java) {
            LwApiVoices.merge("not json", LwApiVoices.Entry("x", "x", "", ""))
        }
    }

    @Test
    fun `撤销按 id 与登记名都认, 没匹配到就什么都不改`() {
        val before = LwApiVoices.encode(
            listOf(
                LwApiVoices.Entry("one", "第一个", "", ""),
                LwApiVoices.Entry("two", "第二个", "", ""),
            ),
        )
        val (byName, removedByName) = LwApiVoices.prune(before, "第一个")
        assertTrue(removedByName)
        assertEquals(listOf("two"), LwApiVoices.parse(byName).entries.map { it.id })

        val (byId, removedById) = LwApiVoices.prune(before, "two")
        assertTrue(removedById)
        assertEquals(listOf("one"), LwApiVoices.parse(byId).entries.map { it.id })

        val (untouched, removedNothing) = LwApiVoices.prune(before, "没有这个")
        assertTrue(!removedNothing)
        assertEquals(before, untouched)
    }
}
