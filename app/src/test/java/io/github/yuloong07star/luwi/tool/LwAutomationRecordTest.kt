package io.github.yuloong07star.luwi.tool

import io.github.yuloong07star.luwi.automation.AutomationJson
import io.github.yuloong07star.luwi.automation.AutomationRule
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 录制那一半的纯函数 (2.8.1 #15): 一串窗口事件 -> 一条规则
 *
 * 这一批最容易漂的是那条**一一对应**: 录了几步就该有几个子条件, 而且顺序不动 —— 主人拿 `op=list` 读回来
 * 时, 规则里那几片叶子要能一步一步指着说"这一步是我点的"。第二处是叶子本身: 一次 GUI 录制给不出"哪一屏",
 * 只给得出"切到某个应用"与"手机刚被碰过", 所以一个包的第一段是 foreground, 同一个包后面那几段是 activity。
 *
 * 折出来的那一份还要过 `op=write` 同一道校验 (`AutomationStore.write` 里那一句), 否则落盘的就是一条
 * "从来没响过"的规则。
 */
class LwAutomationRecordTest {

    private fun step(packageName: String, title: String, screen: String): LwAutomation.RecordedStep =
        LwAutomation.RecordedStep(packageName, title, screen, 0L)

    private fun conds(when_: JsonObject): List<JsonObject> =
        (when_["conds"] as JsonArray).map { it.jsonObject }

    private fun kindOf(one: JsonObject): String = one["kind"]!!.jsonPrimitive.content

    @Test
    fun `三步录成三个子条件, 顺序与叶子逐条对上`() {
        val steps = listOf(
            step("com.android.settings", "设置", "com.android.settings.Settings"),
            step("com.android.settings", "WLAN", "com.android.settings.Settings\$WifiSettingsActivity"),
            step("com.android.settings", "WLAN", "com.android.settings.wifi.WifiSettings"),
        )
        val when_ = LwAutomation.recordedRule("wifi", "task", "提醒主人看看 WLAN", steps)["when"]!!.jsonObject
        assertEquals("all", when_["kind"]!!.jsonPrimitive.content)
        val conds = conds(when_)
        assertEquals(3, conds.size)
        assertEquals(listOf("foreground", "activity", "activity"), conds.map { kindOf(it) })
        assertEquals("com.android.settings", conds.first()["package"]!!.jsonPrimitive.content)
        assertEquals(
            LwAutomation.RECORDED_ACTIVITY_MINUTES.toString(),
            conds[1]["withinMinutes"]!!.jsonPrimitive.content,
        )
    }

    @Test
    fun `每换一个应用就重新是 foreground`() {
        val steps = listOf(
            step("com.miui.home", "桌面", "com.miui.home.launcher.Launcher"),
            step("com.android.settings", "设置", "com.android.settings.Settings"),
            step("com.android.settings", "WLAN", "com.android.settings.wifi.WifiSettings"),
            step("com.tencent.mm", "微信", "com.tencent.mm.ui.LauncherUI"),
        )
        assertEquals(
            listOf("foreground", "foreground", "activity", "foreground"),
            LwAutomation.recordedLeaves(steps).map { kindOf(it) },
        )
    }

    @Test
    fun `只有一步时那一步就是全部, 不套组合`() {
        val rule = LwAutomation.recordedRule("one", "remind", "说一声", listOf(step("com.tencent.mm", "微信", "x.Y")))
        val when_ = rule["when"]!!.jsonObject
        assertEquals("foreground", when_["kind"]!!.jsonPrimitive.content)
        assertEquals("com.tencent.mm", when_["package"]!!.jsonPrimitive.content)
    }

    @Test
    fun `同一步刷两次只留一步, 换屏才是新的一步`() {
        val merged = LwAutomation.mergeRecordedSteps(
            listOf(
                step("com.android.settings", "设置", "com.android.settings.Settings"),
                step("com.android.settings", "设置", "com.android.settings.Settings"),
                step("com.android.settings", "", "com.android.settings.wifi.WifiSettings"),
                step("com.android.settings", "", "com.android.settings.wifi.WifiSettings"),
            ),
        )
        assertEquals(2, merged.size)
        assertEquals("com.android.settings.Settings", merged[0].screen)
        assertEquals("com.android.settings.wifi.WifiSettings", merged[1].screen)
    }

    @Test
    fun `折出来的那一份过同一道校验`() {
        val steps = (1..3).map { step("com.android.settings", "WLAN", "com.android.settings.S$it") }
        val text = AutomationJson.writer.encodeToString(
            JsonObject.serializer(),
            LwAutomation.recordedRule("wifi", "task", "提醒主人看看 WLAN", steps),
        )
        val rule = AutomationRule.parse("wifi", text)
        assertEquals("all", rule.whenKind)
        assertEquals(3, rule.conds.size)
        assertTrue(rule.summary().contains("录的那一串"))
    }

    @Test
    fun `超过五步只收前五步, 后面的不进规则`() {
        val steps = (1..7).map { step("com.android.settings", "屏 $it", "com.android.settings.S$it") }
        val rule = LwAutomation.recordedRule("long", "task", "提醒", steps)
        assertEquals(5, conds(rule["when"]!!.jsonObject).size)
        val thenText = rule["then"]!!.jsonObject["text"]!!.jsonPrimitive.content
        assertTrue(thenText.contains("屏 5"))
        assertFalse(thenText.contains("屏 6"))
    }

    @Test
    fun `录的那一串跟在 then 后面, 一步一步都在`() {
        val steps = listOf(
            step("com.android.settings", "设置", "com.android.settings.Settings"),
            step("com.android.settings", "WLAN", "com.android.settings.wifi.WifiSettings"),
        )
        val rule = LwAutomation.recordedRule("wifi", "task", "提醒主人看看 WLAN", steps)
        val thenText = rule["then"]!!.jsonObject["text"]!!.jsonPrimitive.content
        assertEquals(
            "提醒主人看看 WLAN\n录的那一串: 设置 (com.android.settings) -> WLAN (com.android.settings)",
            thenText,
        )
    }

    @Test
    fun `缺省那两个上限与 write 那条路是同一份数`() {
        val rule = LwAutomation.recordedRule("w", "task", "做", listOf(step("p", "t", "s")))
        assertEquals(
            AutomationRule.DEFAULT_COOLDOWN_MINUTES.toString(),
            rule["cooldownMinutes"]!!.jsonPrimitive.content,
        )
        assertEquals(
            AutomationRule.DEFAULT_DAILY_LIMIT.toString(),
            rule["dailyLimit"]!!.jsonPrimitive.content,
        )
        assertEquals("true", rule["quietHours"]!!.jsonPrimitive.content)
    }
}
