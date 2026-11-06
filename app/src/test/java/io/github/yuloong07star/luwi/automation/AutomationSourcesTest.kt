package io.github.yuloong07star.luwi.automation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 2.8.0 B5-b 三个数据源的判据: 形状校验 / 说人话 / 摘要缓存去重与窗口 / 电量只在跨阈值时命中
 *
 * 这几条都是**纯函数**那一半: 真去读日程、收广播、数通知的那一半要设备, 而它们最怕漂开的地方正是
 * "什么算合法"与"什么算一次" —— 前者写错就是一条静默不响的规则, 后者写错就是同一条提醒刷屏
 */
class AutomationSourcesTest {

    private fun rule(when_: String): AutomationRule.Rule = AutomationRule.parse(
        "probe",
        """{"name":"probe","when":$when_,"then":{"kind":"remind","text":"说一句"}}""",
    )

    private fun problemOf(when_: String): String =
        runCatching { rule(when_) }.exceptionOrNull()?.message.orEmpty()

    /* ── 一、日历临近 ────────────────────────────────────────────────────── */

    @Test
    fun calendarSoonNeedsAWindowInsideItsBounds() {
        assertTrue(problemOf("""{"kind":"calendarSoon"}""").contains("withinMinutes"))
        assertTrue(problemOf("""{"kind":"calendarSoon","withinMinutes":0}""").contains("1..1440"))
        assertTrue(problemOf("""{"kind":"calendarSoon","withinMinutes":1441}""").contains("1..1440"))
        assertTrue(
            problemOf("""{"kind":"calendarSoon","withinMinutes":20,"titleContains":3}""")
                .contains("titleContains"),
        )
        assertTrue(
            problemOf("""{"kind":"calendarSoon","withinMinutes":20,"calendarIds":["x"]}""")
                .contains("calendarIds"),
        )
    }

    @Test
    fun calendarSoonTakesTheTitleAndCalendarIds() {
        val one = rule(
            """{"kind":"calendarSoon","withinMinutes":20,"titleContains":"会议","calendarIds":[3,7]}""",
        )

        assertEquals("20 分钟内标题里有「会议」的日程开始时", one.condition())
        assertEquals(listOf(3L, 7L), AutomationRule.longs(one.whenParams["calendarIds"]))
        assertEquals("calendarSoon", one.whenKind)
    }

    /* ── 二、电量阈值 ────────────────────────────────────────────────────── */

    @Test
    fun batteryNeedsSomethingToWatch() {
        assertTrue(problemOf("""{"kind":"battery"}""").contains("below"))
        assertTrue(problemOf("""{"kind":"battery","below":120}""").contains("0..100"))
        assertTrue(problemOf("""{"kind":"battery","above":-1}""").contains("0..100"))
        assertTrue(problemOf("""{"kind":"battery","below":30,"above":40}""").contains("lower than"))
        assertTrue(problemOf("""{"kind":"battery","charging":"yes"}""").contains("charging"))
    }

    @Test
    fun batterySaysTheThresholdAndTheChargingState() {
        assertEquals(
            "电量低于 20% 且在充电时",
            rule("""{"kind":"battery","below":20,"charging":true}""").condition(),
        )
        assertEquals(
            "电量高于 80% 时",
            rule("""{"kind":"battery","above":80}""").condition(),
        )
    }

    @Test
    fun batteryOnlyFiresOnTheCrossing() {
        assertFalse(AutomationBattery.shouldHit(inside = false, was = false, asSub = false))
        assertTrue(AutomationBattery.shouldHit(inside = true, was = false, asSub = false))
        assertFalse("一直在阈值内不该每一条广播都报", AutomationBattery.shouldHit(true, true, false))
        assertTrue("组合里的子条件要一直算成立", AutomationBattery.shouldHit(true, true, true))
    }

    @Test
    fun batteryThresholdsAreStrictAndChargingIsPartOfTheCondition() {
        assertTrue(AutomationBattery.inside(19, false, below = 20.0, above = null, chargingWanted = null))
        assertFalse(AutomationBattery.inside(20, false, below = 20.0, above = null, chargingWanted = null))
        assertTrue(AutomationBattery.inside(81, false, below = null, above = 80.0, chargingWanted = null))
        assertFalse(AutomationBattery.inside(80, false, below = null, above = 80.0, chargingWanted = null))
        assertTrue(AutomationBattery.inside(50, true, below = null, above = null, chargingWanted = true))
        assertFalse(AutomationBattery.inside(50, false, below = null, above = null, chargingWanted = true))
    }

    /* ── 三、通知摘要 ────────────────────────────────────────────────────── */

    @Test
    fun noticeDigestNeedsAWindowAndACount() {
        assertTrue(problemOf("""{"kind":"noticeDigest"}""").contains("withinMinutes"))
        assertTrue(problemOf("""{"kind":"noticeDigest","withinMinutes":1441,"minCount":3}""").contains("1..1440"))
        assertTrue(problemOf("""{"kind":"noticeDigest","withinMinutes":30,"minCount":0}""").contains("minCount"))
        assertTrue(
            problemOf("""{"kind":"noticeDigest","withinMinutes":30,"minCount":3,"packages":[""]}""")
                .contains("packages"),
        )
    }

    @Test
    fun noticeDigestSaysTheWindowTheCountAndThePackages() {
        assertEquals(
            "30 分钟内收到至少 3 条通知 (只看 com.tencent.mm 发的)",
            rule(
                """{"kind":"noticeDigest","withinMinutes":30,"minCount":3,"packages":["com.tencent.mm"]}""",
            ).condition(),
        )
        assertEquals(
            "30 分钟内收到至少 3 条通知",
            rule("""{"kind":"noticeDigest","withinMinutes":30,"minCount":3}""").condition(),
        )
    }

    private fun entry(
        key: String,
        at: Long,
        packageName: String = "com.tencent.mm",
        title: String = "新消息",
        text: String = "在吗",
    ) = AutomationDigest.Entry(key, packageName, title, text, at)

    @Test
    fun digestDeduplicatesByKeyAndByContent() {
        val cache = LinkedHashMap<String, AutomationDigest.Entry>()
        AutomationDigest.remember(cache, entry("k1", 1_000))
        AutomationDigest.remember(cache, entry("k1", 2_000))

        assertEquals("同一把 key 是更新同一条通知", 1, cache.size)
        assertEquals(2_000L, cache["k1"]!!.at)

        AutomationDigest.remember(cache, entry("k2", 3_000))
        assertEquals("同一句话换一把 key 也只算一条", 1, cache.size)
    }

    @Test
    fun digestCountsOnlyTheWindowAndTheNamedPackages() {
        val cache = LinkedHashMap<String, AutomationDigest.Entry>()
        val now = 60 * 60_000L
        AutomationDigest.remember(cache, entry("recent", now - 60_000, title = "最近一条"))
        AutomationDigest.remember(cache, entry("edge", now - 30 * 60_000, title = "刚好在窗口边上"))
        AutomationDigest.remember(cache, entry("old", now - 31 * 60_000, title = "窗口外"))
        AutomationDigest.remember(cache, entry("other", now - 60_000, packageName = "com.x", title = "别的应用"))

        assertEquals(3, AutomationDigest.recent(cache, now, withinMinutes = 30).size)
        assertEquals(
            listOf("别的应用"),
            AutomationDigest.recent(cache, now, withinMinutes = 30, packages = listOf("com.x")).map { it.title },
        )
    }

    @Test
    fun digestCacheHasACapAndPrunesOldEntries() {
        val cache = LinkedHashMap<String, AutomationDigest.Entry>()
        repeat(AutomationDigest.MAX_ENTRIES + 5) { index ->
            AutomationDigest.remember(cache, entry("k$index", index.toLong(), title = "t$index", text = "b$index"))
        }
        assertEquals(AutomationDigest.MAX_ENTRIES, cache.size)

        val now = 2L * AutomationRule.MAX_DIGEST_MINUTES * 60_000L
        AutomationDigest.prune(cache, now)
        assertTrue("窗口外的旧条目要被清掉", cache.isEmpty())
    }
}
