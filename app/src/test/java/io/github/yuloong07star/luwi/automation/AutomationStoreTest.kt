package io.github.yuloong07star.luwi.automation

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 目录里那些"不是规则"的文件, 以及设置那一份的默认值 ([AutomationStore.isRuleFile] /
 * [AutomationStore.settingsFrom])
 *
 * 为什么值得单测: `$DSH_HOME/automations/` 里躺着四种文件, 其中 `settings.json` 与 `places.json`
 * 也以 `.json` 结尾 —— 按后缀收就会把它们当规则去解析, 解析必然失败, 于是设置页里凭空多出两条
 * **"BROKEN ..."**, 主人点进去才发现那是设置。这条线只错一次就够烦人, 所以要钉住。
 *
 * 设置那一份同理: 缺键默认是"开"(老版本升上来不会静悄悄关掉监测), 未知键丢弃(删掉的监测源不留残行),
 * `saidLimit` 越界要收进 1..10 —— 这三条都在 [AutomationStore.settingsFrom] 里。
 */
class AutomationStoreTest {

    // ---- 哪些文件算规则 ----

    @Test
    fun `设置与地点不是规则`() {
        assertFalse(
            "settings.json 是设置那一份",
            AutomationStore.isRuleFile(AutomationStore.SETTINGS_FILE),
        )
        assertFalse(
            "places.json 是地点缓存",
            AutomationStore.isRuleFile(AutomationStore.PLACES_FILE),
        )
    }

    @Test
    fun `不是 json 的都不算规则`() {
        assertFalse(AutomationStore.isRuleFile(AutomationStore.HISTORY_FILE))
        assertFalse(AutomationStore.isRuleFile("带伞.txt"))
        assertFalse(AutomationStore.isRuleFile("带伞"))
        assertFalse(AutomationStore.isRuleFile(""))
    }

    @Test
    fun `普通名字的 json 就是规则`() {
        assertTrue(AutomationStore.isRuleFile("带伞.json"))
        assertTrue(AutomationStore.isRuleFile("提醒-喝水.json"))
        assertTrue(
            "名字里带 settings 但整名不是 settings.json 的照收",
            AutomationStore.isRuleFile("settings-backup.json"),
        )
    }

    // ---- 设置那一份的默认值 ----

    @Test
    fun `什么都没有时每个监测源都是开`() {
        val settings = AutomationStore.settingsFrom(JsonObject(emptyMap()))
        assertEquals(
            "九个监测源一个都不能漏",
            AutomationRule.WATCH_KINDS.size,
            settings.monitors.size,
        )
        for (kind in AutomationRule.WATCH_KINDS) {
            assertTrue("$kind 缺键时是开", settings.monitor(kind))
        }
        assertTrue("静默时段缺键时是开", settings.quietEnabled)
        assertFalse("允许它自己动手缺键时是关", settings.allowActing)
        assertEquals(
            "每天主动说的次数缺键时是默认值",
            AutomationRule.SAID_LIMIT_DEFAULT,
            settings.saidLimit,
        )
    }

    @Test
    fun `文件里关掉的那个才是关`() {
        val settings = AutomationStore.settingsFrom(buildJsonObject {
            put(
                "monitors",
                buildJsonObject {
                    put("time", false)
                    put("weather", false)
                },
            )
        })
        assertFalse("写 false 的关掉", settings.monitor("time"))
        assertFalse("写 false 的关掉", settings.monitor("weather"))
        assertTrue("没写过的仍是开", settings.monitor("unlock"))
    }

    @Test
    fun `不认识的监测源会被丢掉`() {
        val settings = AutomationStore.settingsFrom(buildJsonObject {
            put(
                "monitors",
                buildJsonObject {
                    put("batteryLevel", true)
                    put("time", true)
                },
            )
        })
        assertFalse(
            "不认识的键不许留在表里",
            settings.monitors.containsKey("batteryLevel"),
        )
        assertEquals(
            "表的大小仍是九个监测源",
            AutomationRule.WATCH_KINDS.size,
            settings.monitors.size,
        )
    }

    @Test
    fun `每天的次数收进一到十`() {
        assertEquals(
            "太大收到上限",
            AutomationRule.SAID_LIMIT_MAX,
            AutomationStore.settingsFrom(buildJsonObject { put("saidLimit", 99) }).saidLimit,
        )
        assertEquals(
            "太小收到下限",
            AutomationRule.SAID_LIMIT_MIN,
            AutomationStore.settingsFrom(buildJsonObject { put("saidLimit", -3) }).saidLimit,
        )
        assertEquals(
            "界内原样",
            7,
            AutomationStore.settingsFrom(buildJsonObject { put("saidLimit", 7) }).saidLimit,
        )
    }

    @Test
    fun `静默时段那两层缺一个也不炸`() {
        val onlyEnabled = AutomationStore.settingsFrom(buildJsonObject {
            put(
                "quiet",
                buildJsonObject {
                    put("enabled", false)
                },
            )
        })
        assertFalse("写了的那个生效", onlyEnabled.quietEnabled)
        assertTrue("没写 window 时给个非空默认", onlyEnabled.quietWindow.isNotBlank())

        val notAnObject = AutomationStore.settingsFrom(buildJsonObject { put("quiet", "23:00-07:00") })
        assertTrue("不是对象时退回默认开着", notAnObject.quietEnabled)
        assertTrue("也还得有个非空时段", notAnObject.quietWindow.isNotBlank())
    }

    @Test
    fun `频率那三个数收进各自那几档`() {
        val settings = AutomationStore.settingsFrom(buildJsonObject {
            put("weatherMinutes", 99_999)
            put("placeMeters", 1)
        })
        assertTrue(
            "天气频率收进档位表里",
            settings.weatherMinutes in AutomationStore.WEATHER_CHOICES,
        )
        assertTrue(
            "地点半径收进档位表里",
            settings.placeMeters in AutomationStore.PLACE_METER_CHOICES,
        )
    }
}
