package io.github.yuloong07star.luwi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `lw/out` 那一份的纯函数判据 (2026-11-08)
 *
 * 三件事都**只能在真机上悄悄坏**, 所以钉在这里:
 *
 * 1. `parse` —— 撕裂行 / 坏行 / 不认识的 `kind` 一律 null (水位全靠它, 解歪一条就整场卡住)
 * 2. `safeId` —— 与宿主 `lwOutId()` 逐字相同的名字规则 (两边对不上就是"写一份、读另一份")
 * 3. `dueAt` —— `gapMs` 的"等够没有" (隔很久说的那句要立刻上屏, 刚说完的下一句才等)
 */
class OutFileTest {

    @Test
    fun `正常一行解得开`() {
        val line = OutFile.parse("""{"seq":2,"at":1730000001060,"gapMs":1060,"roll":0.41,"kind":"text","text":"刚才在写东西。"}""")
        assertEquals(2, line?.seq)
        assertEquals(1060L, line?.gapMs)
        assertEquals("text", line?.kind)
        assertEquals("刚才在写东西。", line?.text)
        assertTrue(line?.hasText == true)
    }

    @Test
    fun `撕裂行与坏行都回 null`() {
        assertNull(OutFile.parse("""{"seq":3,"at":1730000002"""))
        assertNull(OutFile.parse(""))
        assertNull(OutFile.parse("not json at all"))
    }

    @Test
    fun `seq 不是正整数的行算坏行`() {
        assertNull(OutFile.parse("""{"seq":0,"kind":"text","text":"嗯"}"""))
        assertNull(OutFile.parse("""{"at":1,"kind":"text","text":"嗯"}"""))
    }

    @Test
    fun `不认识的 kind 不算一行`() {
        assertNull(OutFile.parse("""{"seq":1,"kind":"reasoning","text":"想"}"""))
    }

    @Test
    fun `表情与图片那两行带自己的字段`() {
        val sticker = OutFile.parse("""{"seq":3,"gapMs":1240,"kind":"sticker","sticker":"开心","text":"[…]"}""")
        assertEquals("sticker", sticker?.kind)
        assertEquals("开心", sticker?.sticker)
        val image = OutFile.parse("""{"seq":4,"gapMs":1000,"kind":"image","rel":"assets/s/4-a.png","thumb":"assets/s/4-a.png","w":1080,"h":2460}""")
        assertEquals("image", image?.kind)
        assertEquals("assets/s/4-a.png", image?.rel)
        assertEquals(1080, image?.w)
        assertEquals(2460, image?.h)
    }

    @Test
    fun `文件那一行带名字与字节数`() {
        // 字段名与宿主那一侧逐字相同: `rel` / `name` / `bytes` (toJson 走 org.json, JVM 单测里不碰)
        val file = OutFile.parse(
            """{"seq":5,"gapMs":1000,"kind":"file","rel":"assets/s/5-报告.pdf","name":"报告.pdf","bytes":20480}""",
        )
        assertEquals("file", file?.kind)
        assertEquals("assets/s/5-报告.pdf", file?.rel)
        assertEquals("报告.pdf", file?.name)
        assertEquals(20480L, file?.bytes)
        assertTrue(file?.hasText == false)
    }

    @Test
    fun `文件名规则与宿主同一套`() {
        assertEquals("session-abc_123.json", OutFile.safeId("session-abc_123.json"))
        // 路径分隔符与怪字符一律换下划线
        assertEquals("a_b_c", OutFile.safeId("a/b\\c"))
        assertEquals("", OutFile.safeId("   "))
        assertEquals(96, OutFile.safeId("x".repeat(200)).length)
    }

    @Test
    fun `隔了很久才说的那句立刻上屏`() {
        val now = 1_000_000L
        // 上一行是十分钟前放的: 间隔早就满足了
        assertEquals(now, OutFile.dueAt(now - 600_000L, 1_060L, now))
        // 还没有上一行 (刚打开)
        assertEquals(now, OutFile.dueAt(0L, 1_060L, now))
    }

    @Test
    fun `刚放完上一行才等它自己的 gapMs`() {
        val now = 1_000_000L
        assertEquals(now + 1_060L, OutFile.dueAt(now, 1_060L, now))
        // 已经等了 400 ms: 还差 660
        assertEquals(now + 660L, OutFile.dueAt(now - 400L, 1_060L, now))
    }
}
