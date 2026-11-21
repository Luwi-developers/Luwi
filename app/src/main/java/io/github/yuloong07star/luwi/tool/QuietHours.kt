package io.github.yuloong07star.luwi.tool

import android.content.Context
import io.github.yuloong07star.luwi.automation.AutomationRule
import io.github.yuloong07star.luwi.automation.AutomationStore
import io.github.yuloong07star.luwi.wake.PowerWindow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.io.File
import java.time.ZoneId

/**
 * 静默时段那一个接口 (2026-11-20, 主人: "静默时段与 automations/settings.json 统一接口")
 *
 * 以前是两笔账:
 * - `sim.json` 的 `wake.quietEnabled / quietFrom / quietTo` —— 只有判断层读 (`readRouterInputs`)
 * - `automations/settings.json` 的 `quiet.enabled / quiet.window` —— 自动指令与到点主动场读
 *
 * 于是同一件事在设置页有两个名字、两个落点, 到点那一场与判断层各认一半。现在**只有一份真源**:
 * `automations/settings.json` 的 `quiet` 段 (自动指令那一段本来就是它的界面), 这一层再给它一个
 * "拆成两格 / 拼回一句" 的壳, 活动那一页的静默三行照旧是开关 + 起止, 写进去的是同一个文件。
 *
 * 老 `sim.json` 里的三个键由 [migrateLegacy] 搬一次, 搬完从旧文件里摘掉 —— 值不丢, 也不会再有两份
 */
internal object QuietHours {

    /** 与 `AutomationStore.DEFAULT_QUIET` (`23:00-07:00`) 是同一段 */
    const val DEFAULT_FROM = "23:00"
    const val DEFAULT_TO = "07:00"

    /** 一行是"开关", 另两格是起止 (界面按两行给, 文件里是一句 `23:00-07:00`) */
    data class Plan(
        val enabled: Boolean = true,
        val from: String = DEFAULT_FROM,
        val to: String = DEFAULT_TO,
    ) {
        /** 落盘那一句; 与 `PowerWindow.parse` 认的写法一致 (中间没有空格) */
        val window: String get() = "$from-$to"
    }

    private val json = Json { ignoreUnknownKeys = true }

    /** 老 `sim.json` 的 `wake` 段里那三个键 (2026-11-20 退役) */
    private val LEGACY_KEYS = listOf("quietEnabled", "quietFrom", "quietTo")

    /** 现在这一份 (读不到 / 认不出来的窗口都回到缺省那一段, 开关按文件) */
    fun read(context: Context): Plan {
        val settings = AutomationStore.settings(context)
        val parsed = PowerWindow.parse(settings.quietWindow)
        return Plan(
            enabled = settings.quietEnabled,
            from = parsed?.let { PowerWindow.label(it.start) } ?: DEFAULT_FROM,
            to = parsed?.let { PowerWindow.label(it.end) } ?: DEFAULT_TO,
        )
    }

    /**
     * 写回 `automations/settings.json` 的 `quiet` 段
     *
     * 走 [AutomationStore.saveSettings] 那一份**整份写**: monitors / 频率档那些键由 [AutomationStore.settings]
     * 读回来原样带回去, 所以两处界面 (活动 / 自动指令) 改的都是同一个文件、同一套缺省。
     *
     * @returns 起止认不出来 (或写盘失败) 就是 false, 调用方据此原样留着旧值并说一句
     */
    fun save(context: Context, plan: Plan): Boolean {
        val from = AutomationRule.minutesOf(plan.from) ?: return false
        val to = AutomationRule.minutesOf(plan.to) ?: return false
        val base = AutomationStore.settings(context)
        val window = "${PowerWindow.label(from)}-${PowerWindow.label(to)}"
        return runCatching {
            AutomationStore.saveSettings(context, base.copy(quietEnabled = plan.enabled, quietWindow = window))
            true
        }.getOrDefault(false)
    }

    /** 落到此刻了吗: 落在里面回那一句 (给人看/进读数), 不在就 null */
    fun why(context: Context, now: Long, zone: ZoneId = ZoneId.systemDefault()): String? {
        val plan = read(context)
        return why(plan.enabled, plan.window, now, zone)
    }

    /**
     * 纯函数那一半 (单测钉着): 开关关着 / 窗口认不出来 / 空窗都不算静默
     *
     * 到点那一刻落在窗口里就是"不开口", 与到点那一刻有没有东西可说无关 —— 静默时段挡的是"发出
     * 声音"这件事本身
     */
    fun why(
        enabled: Boolean,
        window: String?,
        now: Long,
        zone: ZoneId = ZoneId.systemDefault(),
    ): String? {
        if (!enabled) return null
        val parsed = window?.let { PowerWindow.parse(it) }?.takeIf { !it.empty } ?: return null
        if (!PowerWindow.inside(PowerWindow.minutesOfDay(now, zone), parsed)) return null
        return "静默时段 (${PowerWindow.describe(parsed)})"
    }

    /**
     * 老 `sim.json` 的 `wake.quiet*` 该不该搬、搬成什么 (纯函数, 单测钉着)
     *
     * 三条规矩: ① 旧文件里三个键一个都没有 → null (搬过了 / 本来没设)
     * ② 新家 (`automations/settings.json` 原文) 已经有 `quiet` 段 → null (主人已经在新家改过, 新家优先)
     * ③ 否则按旧值给一份 [Plan]; 认不出来的起止落到缺省
     */
    fun legacyPlan(wake: JsonObject?, settingsRoot: JsonObject?): Plan? {
        if (wake == null) return null
        if (LEGACY_KEYS.none { wake[it] != null }) return null
        if (settingsRoot?.get("quiet") is JsonObject) return null
        return Plan(
            enabled = (wake["quietEnabled"] as? JsonPrimitive)?.booleanOrNull ?: true,
            from = (wake["quietFrom"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
                ?: DEFAULT_FROM,
            to = (wake["quietTo"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
                ?: DEFAULT_TO,
        )
    }

    /** 从一份 `sim.json` 里摘掉那三个旧键 (纯函数; 别的段原样搬回去) */
    fun stripLegacy(root: JsonObject): JsonObject {
        val wake = root["wake"] as? JsonObject ?: return root
        return buildJsonObject {
            root.forEach { (key, value) -> if (key != "wake") put(key, value) }
            put("wake", buildJsonObject {
                wake.forEach { (key, value) -> if (key !in LEGACY_KEYS) put(key, value) }
            })
        }
    }

    /**
     * 把老 `sim.json` 的 `wake.quiet*` 搬进自动指令那一份 (2026-11-20)
     *
     * 判断在 [legacyPlan] 里 (纯函数), 这里只做两件副作用: 写新家、摘旧键。
     * 写失败就**不摘旧键** (值留在原处, 下次再来); 幂等: 摘完第二次进来就看不到旧键
     * @returns 这一趟真的动过文件没有
     */
    fun migrateLegacy(context: Context): Boolean {
        val sim = SimSetting.file(context)
        val text = runCatching { sim.takeIf { it.isFile }?.readText() }.getOrNull() ?: return false
        val root = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: return false
        val wake = root["wake"] as? JsonObject ?: return false
        val settingsFile = File(AutomationStore.directory(context), AutomationStore.SETTINGS_FILE)
        val settingsRaw = runCatching { settingsFile.takeIf { it.isFile }?.readText() }.getOrNull()
        val settingsRoot = settingsRaw?.let {
            runCatching { json.parseToJsonElement(it) as? JsonObject }.getOrNull()
        }
        val moved = legacyPlan(wake, settingsRoot)
        if (moved != null && !save(context, moved)) return false
        val payload = stripLegacy(root)
        return runCatching {
            sim.parentFile?.mkdirs()
            val body = json.encodeToString(JsonObject.serializer(), payload) + "\n"
            val temporary = File(sim.parentFile, "${sim.name}.tmp")
            temporary.writeText(body)
            if (!temporary.renameTo(sim)) {
                sim.writeText(body)
                temporary.delete()
            }
            true
        }.getOrDefault(false)
    }
}
