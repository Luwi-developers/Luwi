package io.github.yuloong07star.luwi.automation

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 条件那一段的校验 ([AutomationRule.validateOne] 里每个 kind 自己的那几行)
 *
 * 为什么值得单测: 条件是**模型写的**, 不是人点出来的 —— 它少写一个 `below`、把 `above` 写反、
 * 或者把 `weekdays` 里的 0 当成周一, 整条规则在界面上看着一切正常, 但要等到那天它一次都没响,
 * 主人才会发现。校验闸是唯一能当场把这些说出来的地方, 所以每一句问题都得钉住。
 *
 * 这里挑的是三个"有内部算术"的条件: 光照要二选一且上下不打架、天气要三选一、时间要能解析且星期在 1..7。
 * 另外顺手钉住地点半径、解锁、活动时长三处的边界。
 */
class AutomationConditionsTest {

    /** 把一条 when 装进整条规则里过校验闸, 只回问题 */
    private fun problemsOf(when_: JsonObject): List<String> {
        val root = buildJsonObject {
            put("name", "带伞")
            put("when", when_)
            put(
                "then",
                buildJsonObject {
                    put("kind", "remind")
                    put("text", "提醒带伞")
                },
            )
        }
        return AutomationRule.validate("带伞", root)
    }

    // ---- 光照: 二选一, 且 above 必须比 below 小 ----

    @Test
    fun `光照要恰好给一边的门槛`() {
        val none = problemsOf(buildJsonObject { put("kind", "light") })
        assertTrue(
            "两边都没给时要说出得给一个",
            none.any { it.contains("when needs below or above") },
        )
        assertEquals("只给 below 就够", emptyList<String>(), problemsOf(buildJsonObject {
            put("kind", "light")
            put("below", 50)
        }))
        assertEquals("只给 above 也够", emptyList<String>(), problemsOf(buildJsonObject {
            put("kind", "light")
            put("above", 200)
        }))
    }

    @Test
    fun `光照的 above 不许大于等于 below`() {
        val reversed = problemsOf(buildJsonObject {
            put("kind", "light")
            put("below", 100)
            put("above", 300)
        })
        assertTrue(
            "写反了要报",
            reversed.any { it.contains("when.above has to be lower than when.below") },
        )
        assertEquals("正着写不报", emptyList<String>(), problemsOf(buildJsonObject {
            put("kind", "light")
            put("below", 300)
            put("above", 100)
        }))
    }

    @Test
    fun `光照的持续时间收在零到上限`() {
        assertEquals("不给就是不限时", emptyList<String>(), problemsOf(buildJsonObject { put("kind", "light"); put("below", 50) }))
        assertTrue(
            "负数要报",
            problemsOf(buildJsonObject {
                put("kind", "light")
                put("below", 50)
                put("forSeconds", -1)
            }).any { it.contains("when.forSeconds has to be 0..${AutomationRule.MAX_LIGHT_SECONDS}") },
        )
        assertTrue(
            "超上限要报",
            problemsOf(buildJsonObject {
                put("kind", "light")
                put("below", 50)
                put("forSeconds", AutomationRule.MAX_LIGHT_SECONDS + 1)
            }).any { it.contains("when.forSeconds has to be 0..${AutomationRule.MAX_LIGHT_SECONDS}") },
        )
    }

    // ---- 天气: 地点 + 指标 + 恰好一个比较符 ----

    @Test
    fun `天气要恰好一个比较符`() {
        assertTrue(
            "一个都没给要报",
            problemsOf(buildJsonObject {
                put("kind", "weather")
                put("place", "家")
                put("metric", "temperature")
            }).any { it.contains("when needs exactly one of below, above or atLeast") },
        )
        assertTrue(
            "给两个也要报",
            problemsOf(buildJsonObject {
                put("kind", "weather")
                put("place", "家")
                put("metric", "temperature")
                put("below", 10)
                put("above", 30)
            }).any { it.contains("when needs exactly one of below, above or atLeast") },
        )
        assertEquals("恰好一个就收", emptyList<String>(), problemsOf(buildJsonObject {
            put("kind", "weather")
            put("place", "家")
            put("metric", "precipitation")
            put("atLeast", 0.5)
        }))
    }

    @Test
    fun `天气的指标与地点都要说得出来`() {
        assertTrue(
            "不认识的指标要报",
            problemsOf(buildJsonObject {
                put("kind", "weather")
                put("place", "家")
                put("metric", "humidity")
                put("below", 10)
            }).any { it.contains("when.metric has to be one of") },
        )
        assertTrue(
            "没地点要报",
            problemsOf(buildJsonObject {
                put("kind", "weather")
                put("metric", "temperature")
                put("below", 10)
            }).any { it.contains("when.place has to name a place") },
        )
        for (metric in AutomationRule.WEATHER_METRICS) {
            assertEquals(
                "$metric 是认的",
                emptyList<String>(),
                problemsOf(buildJsonObject {
                    put("kind", "weather")
                    put("place", "家")
                    put("metric", metric)
                    put("below", 10)
                }),
            )
        }
    }

    // ---- 时间: 时刻能解析, 星期在 1..7 ----

    @Test
    fun `时间的时刻要能解析`() {
        for (broken in listOf("", "八点", "25:00", "07:70")) {
            assertTrue(
                "「$broken」要报",
                problemsOf(buildJsonObject {
                    put("kind", "time")
                    put("at", broken)
                }).any { it.contains("when.at has to be a time of day like 07:30") },
            )
        }
        assertEquals("07:30 是认的", emptyList<String>(), problemsOf(buildJsonObject {
            put("kind", "time")
            put("at", "07:30")
        }))
    }

    @Test
    fun `时间的星期收在一到七`() {
        fun weekdays(vararg days: Int): List<String> = problemsOf(buildJsonObject {
            put("kind", "time")
            put("at", "07:30")
            put(
                "weekdays",
                buildJsonArray { days.forEach { add(it) } },
            )
        })

        assertTrue("0 要报", weekdays(0, 1).any { it.contains("when.weekdays has to be a list of 1..7") })
        assertTrue("8 要报", weekdays(1, 8).any { it.contains("when.weekdays has to be a list of 1..7") })
        assertTrue(
            "写成一个数而不是表也要报",
            problemsOf(buildJsonObject {
                put("kind", "time")
                put("at", "07:30")
                put("weekdays", 3)
            }).any { it.contains("when.weekdays has to be a list of 1..7") },
        )
        assertEquals("1..7 都收", emptyList<String>(), weekdays(1, 3, 7))
    }

    // ---- 顺手钉住的三处边界 ----

    @Test
    fun `地点半径收在上下限之间`() {
        fun radius(meters: Int): List<String> = problemsOf(buildJsonObject {
            put("kind", "place")
            put("place", "公司")
            put("radiusMeters", meters)
        })

        assertTrue(
            "太小要报",
            radius(AutomationRule.MIN_RADIUS_METERS - 1)
                .any { it.contains("when.radiusMeters has to be") },
        )
        assertTrue(
            "太大要报",
            radius(AutomationRule.MAX_RADIUS_METERS + 1)
                .any { it.contains("when.radiusMeters has to be") },
        )
        assertEquals(
            "界内不报",
            emptyList<String>(),
            radius((AutomationRule.MIN_RADIUS_METERS + AutomationRule.MAX_RADIUS_METERS) / 2),
        )
    }

    @Test
    fun `解锁的 firstOfDay 只收真假`() {
        assertTrue(
            "字符串要报",
            problemsOf(buildJsonObject {
                put("kind", "unlock")
                put("firstOfDay", "yes")
            }).any { it.contains("when.firstOfDay has to be true or false") },
        )
        assertEquals("布尔不报", emptyList<String>(), problemsOf(buildJsonObject {
            put("kind", "unlock")
            put("firstOfDay", true)
        }))
    }

    @Test
    fun `活动时长收在一到上限`() {
        assertTrue(
            "0 要报",
            problemsOf(buildJsonObject {
                put("kind", "activity")
                put("withinMinutes", 0)
            }).any { it.contains("when.withinMinutes has to be 1..${AutomationRule.ACTIVITY_MAX_MINUTES}") },
        )
        assertTrue(
            "超上限要报",
            problemsOf(buildJsonObject {
                put("kind", "activity")
                put("withinMinutes", AutomationRule.ACTIVITY_MAX_MINUTES + 1)
            }).any { it.contains("when.withinMinutes has to be 1..${AutomationRule.ACTIVITY_MAX_MINUTES}") },
        )
        assertEquals("界内不报", emptyList<String>(), problemsOf(buildJsonObject {
            put("kind", "activity")
            put("withinMinutes", 30)
        }))
    }

    /**
     * 不认识的 kind 要当场点名, 并把认识的都列出来
     *
     * 注意这句**不回声**写错的那个名字 (只列认得的): 于是下面只钉"它报了"和"认得的都列全了",
     * 不钉那句文案的措辞 —— 文案以后要改, 这条测试不该跟着红
     */
    @Test
    fun `不认识的 kind 会被点名`() {
        val problems = problemsOf(buildJsonObject { put("kind", "batteryLevel") })
        val line = problems.firstOrNull { it.startsWith("when.kind has to be one of") }
        assertTrue("要点出 when.kind 不认得: $problems", line != null)
        for (kind in AutomationRule.WHEN_KINDS) {
            assertTrue("认得的 $kind 要列在里面: $line", line!!.contains(kind))
        }
    }

    /** 上面每一句都必须是 JSON 里拿得出来的字符串, 不是空表 (防止哪天 validate 被改成静默通过) */
    @Test
    fun `校验永远不会静默通过一条坏规则`() {
        val problems = problemsOf(buildJsonObject { put("kind", "weather") })
        assertTrue("至少有两条问题: $problems", problems.size >= 2)
        assertTrue("问题都得是非空字符串", problems.all { it.isNotBlank() })
    }
}
