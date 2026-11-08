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
    }

    @Test
    fun `旧文件里的 allowActing 读进来不影响任何事`() {
        // 2026-11-07: 那道总闸撤了, 旧文件里留着的键只是被忽略 —— 读得出来, 不再有对应的字段
        val settings = AutomationStore.settingsFrom(buildJsonObject {
            put("allowActing", false)
            put("quiet", buildJsonObject { put("enabled", true) })
        })
        assertTrue("静默时段那一份照旧读", settings.quietEnabled)
        assertEquals("监测源还是九个", AutomationRule.WATCH_KINDS.size, settings.monitors.size)
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

    // ---- 目录迁移 (2.8.0 #25) ----

    private fun ruleJson(name: String, cooldown: Int = 30): String =
        """
        {"name":"$name","enabled":true,"when":{"kind":"time","at":"07:30"},
         "then":{"kind":"remind","text":"提醒带伞"},"cooldownMinutes":$cooldown}
        """.trimIndent()

    @Test
    fun `新写只落 rules 子目录`() {
        val root = kotlin.io.path.createTempDirectory("lw-rules-write").toFile()
        try {
            val rules = java.io.File(root, AutomationStore.RULES_DIRECTORY)
            val (file, warnings) = AutomationStore.writeTo(rules, "带伞", ruleJson("带伞"))
            assertEquals(
                "新写落在 rules/ 下",
                java.io.File(rules, "带伞.json"),
                file,
            )
            assertFalse("根目录不再出新规则", java.io.File(root, "带伞.json").exists())
            assertTrue("这份规则写得进去", file.isFile)
            assertTrue("没有未知键就没有提醒", warnings.isEmpty())
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun `根目录旧规则读得出来, 同名时 rules 那一份说了算`() {
        val root = kotlin.io.path.createTempDirectory("lw-rules-legacy").toFile()
        try {
            val rules = java.io.File(root, AutomationStore.RULES_DIRECTORY).apply { mkdirs() }
            val old = java.io.File(root, "旧规则.json")
            old.writeText(ruleJson("旧规则", cooldown = 60))
            java.io.File(rules, "旧规则.json").writeText(ruleJson("旧规则", cooldown = 5))

            val both = AutomationStore.mergedEntries(rules, root)
            assertEquals("同名只算一条", 1, both.size)
            assertEquals("rules/ 那一份说了算", 5, both.single().rule?.cooldownMinutes)

            java.io.File(rules, "旧规则.json").delete()
            val legacy = AutomationStore.mergedEntries(rules, root)
            assertEquals("旧根目录那一份仍读得出来", 1, legacy.size)
            assertEquals("旧规则", legacy.single().name)
            assertTrue("读得出来就不是坏规则", legacy.single().problem == null)
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun `目录里的设置与地点不会被当成规则`() {
        val root = kotlin.io.path.createTempDirectory("lw-rules-filter").toFile()
        try {
            val rules = java.io.File(root, AutomationStore.RULES_DIRECTORY).apply { mkdirs() }
            java.io.File(root, AutomationStore.SETTINGS_FILE).writeText("{}")
            java.io.File(root, AutomationStore.PLACES_FILE).writeText("{}")
            java.io.File(rules, AutomationStore.SETTINGS_FILE).writeText("{}")
            java.io.File(rules, AutomationStore.PLACES_FILE).writeText("{}")

            assertEquals("根目录只剩设置与地点时一条规则都没有", emptyList<String>(), AutomationStore.namesIn(root))
            assertEquals("rules/ 里也一样", emptyList<String>(), AutomationStore.namesIn(rules))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun `读不出来的规则复制到 rejected, 原件不动`() {
        val root = kotlin.io.path.createTempDirectory("lw-rules-rejected").toFile()
        try {
            val rules = java.io.File(root, AutomationStore.RULES_DIRECTORY).apply { mkdirs() }
            val rejected = java.io.File(root, AutomationStore.REJECTED_DIRECTORY)
            val broken = java.io.File(rules, "坏规则.json")
            broken.writeText("{ this is not json")

            val entries = AutomationStore.mergedEntries(rules, root, rejected)
            assertEquals("坏规则也要列出来", 1, entries.size)
            val problem = entries.single().problem
            assertTrue("读不出来要带原因", problem != null && problem.contains("not valid JSON"))
            assertTrue("原件留给主人看与删", broken.isFile)
            assertEquals(
                "副本逐字节是原件",
                "{ this is not json",
                java.io.File(rejected, "坏规则.json").readText(),
            )
            val error = java.io.File(rejected, "坏规则.error.txt").readText()
            assertTrue("错误说明非空", error.isNotBlank())
            assertTrue("错误说明点名原因", error.contains("not valid JSON"))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun `删坏规则时原件与 rejected 副本一起删`() {
        val root = kotlin.io.path.createTempDirectory("lw-rules-delete").toFile()
        try {
            val rules = java.io.File(root, AutomationStore.RULES_DIRECTORY).apply { mkdirs() }
            val rejected = java.io.File(root, AutomationStore.REJECTED_DIRECTORY)
            val broken = java.io.File(rules, "坏规则.json")
            broken.writeText("{ this is not json")
            AutomationStore.mergedEntries(rules, root, rejected)
            assertTrue("先有副本", java.io.File(rejected, "坏规则.json").isFile)

            assertTrue(AutomationStore.deleteIn(rules, root, rejected, "坏规则"))
            assertFalse("原件删掉", broken.exists())
            assertFalse("rejected/ 副本删掉", java.io.File(rejected, "坏规则.json").exists())
            assertFalse("错误说明也删掉", java.io.File(rejected, "坏规则.error.txt").exists())
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun `删旧根目录的规则也认`() {
        val root = kotlin.io.path.createTempDirectory("lw-rules-delete-legacy").toFile()
        try {
            val rules = java.io.File(root, AutomationStore.RULES_DIRECTORY).apply { mkdirs() }
            val rejected = java.io.File(root, AutomationStore.REJECTED_DIRECTORY)
            val old = java.io.File(root, "旧规则.json")
            old.writeText(ruleJson("旧规则"))
            assertTrue(AutomationStore.deleteIn(rules, root, rejected, "旧规则"))
            assertFalse("旧位置那一份也删掉", old.exists())
        } finally {
            root.deleteRecursively()
        }
    }
}
