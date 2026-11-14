package io.github.yuloong07star.luwi.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「缺省展开哪几段」那条纯算术 ([defaultCollapsed] 与 [SettingsSectionsAlwaysOpen])
 *
 * 为什么值得单测: 2026-10-16 第 1 条把这条账翻了个面 —— 从前 `collapsed` 的初值是空集 (缺省全展开,
 * 于是以后新加一段时它自己就是展开的), 现在缺省只展开白名单那七段 (省电 + 「常用」组六段), 新加一段
 * 天然收起 (D2)。做错的样子都很安静: 白名单里多写一个段名, 那一段就跟着缺省展开; 页面上新加一段而
 * 忘了加进 [SettingsSectionKeys], 它会恰好展开着, 界面上一点异常都看不出来。所以判据钉在纯函数上,
 * 不需要设备
 */
class SettingsSectionsTest {

    /** D1 拍板的那六段: 省电那一段 + 「常用」一级分组下那五段 (导航那一段 2026-10-17 撤了) */
    private val common = listOf("power", "appearance", "channel", "ball", "wake", "speak")

    /** 「能力」那一组的 14 段, 缺省全收着 (接口那一段 2026-10-25 加在最末, 活动 2026-11-07 由探索与定时对话合成) */
    private val abilities = listOf(
        "notifications", "screenshot", "look", "lock",
        "activity", "automation", "quick", "plugin", "skills", "linux", "sync", "tavern", "permissions", "api",
    )

    @Test
    fun commonSectionsAreOpen() {
        val collapsed = defaultCollapsed(SettingsSectionKeys)

        assertEquals("白名单就是 D1 那六段 (导航撤了)", common.toSet(), SettingsSectionsAlwaysOpen)
        common.forEach { key ->
            assertFalse("$key 是常用那一段, 缺省应当开着", key in collapsed)
        }
    }

    @Test
    fun abilitySectionsAreCollapsed() {
        val collapsed = defaultCollapsed(SettingsSectionKeys)

        assertEquals("缺省收起来的就是能力那 15 段", abilities.toSet(), collapsed)
        abilities.forEach { key ->
            assertTrue("$key 在能力组, 缺省应当收着", key in collapsed)
        }
    }

    /** D2: 以后新加一段, 它天然是收起来的 —— 给一个页面上还没有的段名, 它也要进那一份 */
    @Test
    fun aSectionAddedLaterIsCollapsed() {
        val collapsed = defaultCollapsed(SettingsSectionKeys + "future-thing")

        assertTrue("新加的段必须缺省收起", "future-thing" in collapsed)
        assertEquals("只多收它一个", abilities.size + 1, collapsed.size)
    }

    /** 白名单里的名字必须真的在页面上有那一段 (写错一个字的话它会永远开不了) */
    @Test
    fun everyWhitelistedKeyIsOnThePage() {
        SettingsSectionsAlwaysOpen.forEach { key ->
            assertTrue("$key 不在 SettingsSectionKeys 里 (那一段名写错了?)", key in SettingsSectionKeys)
        }
    }

    /**
     * 退出设置页再进来: 冷启动是缺省那一份, 主人手动点开过一段之后照他那份
     *
     * 2026-10-17 在模拟器上量到的原样是"再进来又收起来了" —— `rememberSaveable` 只活一次界面,
     * 退出再进是新建的组合
     */
    @Test
    fun reenteringKeepsWhatTheUserToggled() {
        assertEquals(
            "冷启动 (进程里还没有那一份): 缺省那 15 段收着",
            defaultCollapsed(SettingsSectionKeys),
            initialCollapsed(null),
        )

        val toggled = defaultCollapsed(SettingsSectionKeys) - "notifications"
        assertEquals(
            "主人点开过「通知」: 再进来它仍是开的",
            toggled,
            initialCollapsed(toggled),
        )
        assertFalse("那一段真的不在收起的名单里", "notifications" in initialCollapsed(toggled))
    }

    /** 21 段一份名单, 各自只出现一次 —— 重复了的话 `collapsed` 那份集合会把两段看成一段 */
    @Test
    fun sectionKeysAreUnique() {
        assertEquals("段名不能重复", SettingsSectionKeys.size, SettingsSectionKeys.toSet().size)
        // 2026-11-07: 「探索」与「定时对话」合成「活动」那一段之后是 20 段 (原来写死 21, 这条一直红着)
        assertEquals("现在页面上是 20 段", 20, SettingsSectionKeys.size)
        assertEquals("常用六段 + 能力十四段", SettingsSectionKeys.size, common.size + abilities.size)
    }

    /* ── 顶部索引条那张下标表 (2026-11-14) ───────────────────────────────── */

    /**
     * 每一段都有一个下标, 且严格递增
     *
     * 公式错一格的样子很安静: 点「接口」跳到「权限」, 界面上一点异常都没有 —— 所以这里连末项的
     * 绝对值也钉住 (页面上 23 项: 1 条提示 + 20 段 + 2 处组标题)
     */
    @Test
    fun everySectionHasADistinctRow() {
        val rows = SettingsSectionKeys.map { settingsSectionRowIndex(SettingsSectionKeys, it) }
        assertEquals("每一段都要有下标", SettingsSectionKeys.size, rows.filterNotNull().size)
        assertTrue("下标必须严格递增", rows.filterNotNull().zipWithNext().all { (a, b) -> a < b })
        assertEquals("第一段紧跟在那条「检查所需依赖」后面", 1, rows.first())
        assertEquals("末项落在最后一项上", SettingsSectionKeys.size + SettingsGroupTitleBefore.size + 1 - 1, rows.last())
    }

    /** 页面上的两处组标题各占一个 item, 于是它后面那一段的下标要挪一格 */
    @Test
    fun groupTitlesShiftTheRows() {
        assertEquals("省电站在提示下面第一项", 1, settingsSectionRowIndex(SettingsSectionKeys, "power"))
        assertEquals("外观排在「常用」这个组标题之后", 3, settingsSectionRowIndex(SettingsSectionKeys, "appearance"))
        assertEquals("通知排在「能力」这个组标题之后", 9, settingsSectionRowIndex(SettingsSectionKeys, "notifications"))
    }

    /** 下标 → 段名那一趟要能原路回来 (索引条的高亮就是靠它) */
    @Test
    fun rowToSectionRoundTrip() {
        SettingsSectionKeys.forEach { key ->
            val row = settingsSectionRowIndex(SettingsSectionKeys, key)
            assertTrue("$key 没有下标", row != null)
            assertEquals("$key 的下标反查回来不是它", key, settingsSectionAtRow(SettingsSectionKeys, row!!))
        }
    }

    /** 顶上那条提示 (0) 不算任何一段; 组标题那一行算它上面那一段 */
    @Test
    fun rowZeroAndGroupRow() {
        assertEquals("下标 0 是「检查所需依赖」, 不算一段", null, settingsSectionAtRow(SettingsSectionKeys, 0))
        assertEquals("组标题那一行算它上面那一段", "power", settingsSectionAtRow(SettingsSectionKeys, 2))
        assertEquals("再往后一项才是外观", "appearance", settingsSectionAtRow(SettingsSectionKeys, 3))
        assertEquals("越界也不炸", SettingsSectionKeys.last(), settingsSectionAtRow(SettingsSectionKeys, 999))
    }

    /** 写错一个段名只该"没有那一颗 chip", 不该抛异常 */
    @Test
    fun unknownKeyHasNoRow() {
        assertEquals(null, settingsSectionRowIndex(SettingsSectionKeys, "nope"))
        assertEquals(null, settingsSectionAtRow(emptyList(), 5))
    }

    /** 索引条的段名表必须与段名表一一对上 (多一条 / 少一条 / 顺序走岔, 界面上都看不出来) */
    @Test
    fun titleResCoversEverySection() {
        assertEquals("段名表的键与顺序必须与 SettingsSectionKeys 一致", SettingsSectionKeys, SettingsSectionTitleRes.keys.toList())
    }
}
