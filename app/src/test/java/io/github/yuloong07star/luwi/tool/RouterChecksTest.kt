package io.github.yuloong07star.luwi.tool

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 判断层那份清单怎么读 (2026-11-10, 方案 D)
 *
 * 三种判法里 `event` 多带了三个参数 (`beforeMinutes` / `titleContains` / `calendarIds`), 而设置页那行
 * 小字就是照它们拼出来的 —— 读错一档不会报错, 只会让主人看到一句"日历事件前 15 分钟"却完全不是他
 * 交的那一条. 所以这里钉两件事: **参数读得回来**, **`how` 说得对**
 */
class RouterChecksTest {

    private val json = Json

    private fun arrayOf(text: String): JsonArray = json.parseToJsonElement(text) as JsonArray

    @Test
    fun `event 那一支的三个参数都读回来`() {
        val list = RouterChecks.parse(
            arrayOf(
                """[{"id":"c1","what":"上班前提醒","when":{"kind":"event","beforeMinutes":30,"titleContains":"上班","calendarIds":["7","9"]},"enabled":true}]""",
            ),
        )

        assertEquals(1, list.size)
        val one = list.first()
        assertEquals("event", one.kind)
        assertEquals(30, one.beforeMinutes)
        assertEquals("上班", one.titleContains)
        assertEquals(listOf(7L, 9L), one.calendarIds)
    }

    @Test
    fun `how 三种判法各一句`() {
        val list = RouterChecks.parse(
            arrayOf(
                """[{"id":"a","what":"打游戏太久","when":{"kind":"usage","minutes":120,"package":"com.example"},"enabled":true},
                    {"id":"b","what":"出门前问一句","when":{"kind":"time"},"at":"07:40","enabled":true},
                    {"id":"c","what":"上班前提醒","when":{"kind":"event","beforeMinutes":30,"titleContains":"上班"},"enabled":true}]""",
            ),
        )

        assertEquals(
            listOf("某天用满 120 分钟 · com.example", "每天 07:40 之后", "日历事件前 30 分钟 · 含「上班」"),
            list.map { it.how },
        )
    }

    @Test
    fun `没给 beforeMinutes 的 event 按 15 说 (与宿主缺省同一个数)`() {
        val list = RouterChecks.parse(
            arrayOf("""[{"id":"c","what":"开会前提醒","when":{"kind":"event"},"enabled":true}]"""),
        )

        assertEquals(0, list.first().beforeMinutes)
        assertEquals("日历事件前 15 分钟", list.first().how)
    }

    @Test
    fun `没有标题的 event 只说前多少分钟`() {
        val list = RouterChecks.parse(
            arrayOf("""[{"id":"c","what":"开会前提醒","when":{"kind":"event","beforeMinutes":10},"enabled":true}]"""),
        )

        assertNull(list.first().titleContains)
        assertEquals("日历事件前 10 分钟", list.first().how)
    }

    @Test
    fun `日历 id 里混了读不动的值就只留数字那些`() {
        val list = RouterChecks.parse(
            arrayOf(
                """[{"id":"c","what":"开会前提醒","when":{"kind":"event","beforeMinutes":10,"calendarIds":["7","x",null]},"enabled":true}]""",
            ),
        )

        assertEquals(listOf(7L), list.first().calendarIds)
    }

    @Test
    fun `不认识的 kind 原样显示, 不当成 event`() {
        val list = RouterChecks.parse(
            arrayOf("""[{"id":"c","what":"某一件事","when":{"kind":"weekday"},"enabled":true}]"""),
        )

        assertEquals("weekday", list.first().how)
        assertEquals(0, list.first().beforeMinutes)
    }

    @Test
    fun `关掉的那一条照旧读出来, enabled 是 false`() {
        val list = RouterChecks.parse(
            arrayOf("""[{"id":"c","what":"开会前提醒","when":{"kind":"event","beforeMinutes":10},"enabled":false}]"""),
        )

        assertEquals(false, list.first().enabled)
    }
}
