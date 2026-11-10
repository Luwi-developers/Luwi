package io.github.yuloong07star.luwi.tool

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 宿主写进 `explore.json` 的那段 `status` 怎么读 (2.7.9 T5)
 *
 * 错一档的样子很安静: 设置页多一行空的"为什么是它", 或者省电探针那次没读到却显示正常 —— 两种都不会
 * 报错, 所以把"读进来是什么"钉在这里
 */
class ExploreStatusTest {

    private val json = Json

    private fun root(text: String): JsonObject = json.parseToJsonElement(text) as JsonObject

    @Test
    fun theFourFactsAreReadBack() {
        val status = ExploreStatus.snapshotOf(
            root(
                """{"v":1,"run":null,"status":{"preset":"explore","presetWhy":"the explore preset (explore)","lastError":null,"powerSaveUnknown":true}}""",
            ),
        )

        assertEquals("explore", status?.preset)
        assertEquals("the explore preset (explore)", status?.presetWhy)
        assertNull(status?.lastError)
        assertEquals(true, status?.powerSaveUnknown)
    }

    /** 还没有这一段 (老版本宿主的文件): 整段 null, 设置页不画那四行 */
    @Test
    fun aFileWithoutStatusIsNull() {
        assertNull(ExploreStatus.snapshotOf(root("""{"v":1,"run":null}""")))
    }

    /** 空串与缺键都按"没有"算: 设置页不该多出一行只有标签的读数 */
    @Test
    fun blankTextsMeanNothing() {
        val status = ExploreStatus.snapshotOf(
            root("""{"status":{"preset":"","presetWhy":"","lastError":"","powerSaveUnknown":false}}"""),
        )

        assertNull(status?.preset)
        assertNull(status?.presetWhy)
        assertNull(status?.lastError)
        assertEquals(false, status?.powerSaveUnknown)
    }

    /** 运行时那本账的其它键 (run / said) 不影响这一段 */
    @Test
    fun otherKeysAreIgnored() {
        val status = ExploreStatus.snapshotOf(
            root("""{"run":{"session":"s1"},"said":2,"status":{"preset":"standard","lastError":"boom"}}"""),
        )

        assertEquals("standard", status?.preset)
        assertEquals("boom", status?.lastError)
        assertNull("没写就是空, 不是 false 之外的什么东西", status?.presetWhy)
    }

    /* ── 收尾账 (2026-11-10, 方案 B) ─────────────────────────────────────── */

    /** 上一场交了几条 / 连着几场没交 / 那一刻是什么时候: 设置页那一行读的就是这三个数 */
    @Test
    fun theFinishBookIsReadBack() {
        val status = ExploreStatus.snapshotOf(
            root(
                """{"v":1,"run":null,"status":{"preset":"explore"},
                   "lastFinish":{"at":1762764000000,"ended":"finish","written":2,"total":5,"session":"s9"},
                   "checksStreak":0}""",
            ),
        )

        assertEquals(2, status?.checksWritten)
        assertEquals(0, status?.checksStreak)
        assertEquals(1762764000000L, status?.lastFinishAt)
    }

    /** 一条都没交: `written` 是 0 (不是 null), streak 是连着几场 */
    @Test
    fun anEmptyHandIsRecordedAsZero() {
        val status = ExploreStatus.snapshotOf(
            root(
                """{"status":{},"lastFinish":{"at":1762764000000,"ended":"deadline","written":0,"total":4},"checksStreak":3}""",
            ),
        )

        assertEquals(0, status?.checksWritten)
        assertEquals(3, status?.checksStreak)
    }

    /** 老宿主写的文件没有这两笔: `status` 那四项照旧, 收尾账按"还没有" */
    @Test
    fun aFileWithoutTheFinishBookStillGivesTheFourFacts() {
        val status = ExploreStatus.snapshotOf(root("""{"status":{"preset":"explore"}}"""))

        assertEquals("explore", status?.preset)
        assertNull("还没有一场收尾", status?.checksWritten)
        assertEquals(0, status?.checksStreak)
        assertEquals(0L, status?.lastFinishAt)
    }

    /** 只有收尾账没有 `status` 时也要给一份 (否则设置页整段都不画) */
    @Test
    fun theFinishBookAloneIsEnough() {
        val status = ExploreStatus.snapshotOf(root("""{"lastFinish":{"written":1,"at":5},"checksStreak":2}"""))

        assertEquals(1, status?.checksWritten)
        assertEquals(2, status?.checksStreak)
        assertEquals(5L, status?.lastFinishAt)
        assertNull(status?.preset)
    }

    /** 坏值按"没有"读, 不显示编出来的数 */
    @Test
    fun brokenFinishValuesAreTreatedAsMissing() {
        val status = ExploreStatus.snapshotOf(
            root("""{"lastFinish":{"written":-4,"at":"x"},"checksStreak":-2}"""),
        )

        assertEquals(0, status?.checksWritten)
        assertEquals(0, status?.checksStreak)
        assertEquals(0L, status?.lastFinishAt)
    }
}
