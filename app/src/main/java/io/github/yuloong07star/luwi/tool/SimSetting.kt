package io.github.yuloong07star.luwi.tool

import android.content.Context
import io.github.yuloong07star.luwi.host.DshHost
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.File

/**
 * 「更多设置」那一份 (2026-11-07 晚, 活动段里的二级页)
 *
 * 主人那一句是"功能与 QQ 桥接里的二代仿真一致" —— 所以这里的键名与缺省值照 `qq-bridge` 的
 * `config.json → socialV2` 抄了一遍, 只把它搬到球这一侧能用的载体上:
 *
 * - **时机与节奏归这一页**: 多久敲一次钟 / 沉睡前等多久 / 一次说几条 / 条间多长 / 判断层那几个阈值
 * - **检测内容归探索**: `router.json` 的 `checks` 由探索收尾写 (见 [RouterChecks]), 这一页只列出来
 *   给主人开关与删掉
 *
 * 落 `$DSH_HOME/lw/sim.json`, **应用单写者**; 宿主只读 (见 `host-plugin` 的 `readRouterInputs`)。
 * 读法一律逐键兜底: 缺键取缺省、越界夹进范围、类型不对取缺省 —— 一份写坏的文件不该让敲钟停下来
 */
internal object SimSetting {

    const val DIRECTORY = "lw"
    const val FILE = "sim.json"

    /** 潜水的意思是不主动敲钟; 活跃的意思是到点就敲 (与 tick.enabled 任一为开都算开) */
    const val MODE_DIVING = "diving"
    const val MODE_ACTIVE = "active"

    /** 两个 gap 的范围: 一分钟到六小时 (桥接那边是 60 s ~ 无限, 这里给一个能用的上界) */
    val GAP_RANGE = 60_000L..21_600_000L

    /** 沉睡前观察的范围: 0 ~ 一小时 */
    val PRE_SLEEP_RANGE = 0L..3_600_000L

    /** 条间停顿的范围 */
    val BURST_GAP_RANGE = 200L..60_000L

    /** 每一档的缺省值 (与 `qq-bridge/config.json` 的 `socialV2` 对齐, 见 `tools/check-sim.mjs`) */
    object Default {
        const val WAKE_MODE = MODE_DIVING
        const val WAKE_GAP_MIN_MS = 1_500_000L
        const val WAKE_GAP_MAX_MS = 3_300_000L
        const val PRE_SLEEP_WAIT_MS = 300_000L
        const val MAX_WAKE_PER_MINUTE = 1
        const val MAX_WAKE_PER_HOUR = 5
        const val NO_ACTION_LIMIT = 3
        const val SEND_BURST_MAX = 6
        const val SEND_GAP_MIN_MS = 1_000L
        const val SEND_GAP_MAX_MS = 3_000L
        const val SEND_PER_CHAR_MS = 20L
        const val LONG_GAP_PROBABILITY = 0.2f
        const val LONG_GAP_MIN_MS = 5_000L
        const val LONG_GAP_MAX_MS = 10_000L
        const val MAX_MESSAGE_CHARS = 600
        const val MAX_SEND_PER_MINUTE = 7
        const val MAX_SEND_PER_HOUR = 60
        const val WAIT_DEFAULT_MS = 30_000L
        const val WAIT_QUIET_MS = 8_000L
        const val MIN_QUIET_AFTER_NEW_MS = 10_000L
        const val GAME_MINUTES = 100
        const val WISH_DAYS = 60
        const val COOLDOWN_MS = 1_800_000L
        const val CHAT_CHANCE = 0.35f
        const val CHAT_AFTER_MS = 14_400_000L
        const val IGNORED_COOLDOWN_MS = 86_400_000L
        const val WAKE_MESSAGE_LIMIT = 12
        const val WAKE_MAX_CHARS = 6_000
        const val QUIET_FROM = "23:00"
        const val QUIET_TO = "07:00"
    }

    /** 潜水与唤醒 */
    data class Wake(
        val mode: String = Default.WAKE_MODE,
        val gapMinMs: Long = Default.WAKE_GAP_MIN_MS,
        val gapMaxMs: Long = Default.WAKE_GAP_MAX_MS,
        val preSleepWaitMs: Long = Default.PRE_SLEEP_WAIT_MS,
        val nameTrigger: Boolean = true,
        val keywordTrigger: Boolean = false,
        val questionTrigger: Boolean = false,
        val pokeTrigger: Boolean = true,
        val probability: Float = 0f,
        val anyMessage: Boolean = false,
        val maxWakePerMinute: Int = Default.MAX_WAKE_PER_MINUTE,
        val maxWakePerHour: Int = Default.MAX_WAKE_PER_HOUR,
        val noActionLimit: Int = Default.NO_ACTION_LIMIT,
        val quietEnabled: Boolean = true,
        val quietFrom: String = Default.QUIET_FROM,
        val quietTo: String = Default.QUIET_TO,
    ) {
        val active: Boolean get() = mode == MODE_ACTIVE
    }

    /** 开口节奏与分条 */
    data class Send(
        val burstEnabled: Boolean = true,
        val burstMaxMessages: Int = Default.SEND_BURST_MAX,
        val gapMinMs: Long = Default.SEND_GAP_MIN_MS,
        val gapMaxMs: Long = Default.SEND_GAP_MAX_MS,
        val perCharMs: Long = Default.SEND_PER_CHAR_MS,
        val longGapProbability: Float = Default.LONG_GAP_PROBABILITY,
        val longGapMinMs: Long = Default.LONG_GAP_MIN_MS,
        val longGapMaxMs: Long = Default.LONG_GAP_MAX_MS,
        val maxMessageChars: Int = Default.MAX_MESSAGE_CHARS,
        val maxPerMinute: Int = Default.MAX_SEND_PER_MINUTE,
        val maxPerHour: Int = Default.MAX_SEND_PER_HOUR,
    )

    /** 等待与静默 */
    data class Wait(
        val defaultMs: Long = Default.WAIT_DEFAULT_MS,
        val quietMs: Long = Default.WAIT_QUIET_MS,
        val minQuietAfterNewMs: Long = Default.MIN_QUIET_AFTER_NEW_MS,
    )

    /** 判断层那几个阈值 (与 `host-plugin` 的 `ROUTER_DEFAULTS` 同一个数) */
    data class Router(
        val gameMinutes: Int = Default.GAME_MINUTES,
        val wishDays: Int = Default.WISH_DAYS,
        val cooldownMs: Long = Default.COOLDOWN_MS,
        val chatChance: Float = Default.CHAT_CHANCE,
        val chatAfterMs: Long = Default.CHAT_AFTER_MS,
        val ignoredCooldownMs: Long = Default.IGNORED_COOLDOWN_MS,
    )

    /** 唤醒时带多少上下文 */
    data class ContextSize(
        val wakeMessageLimit: Int = Default.WAKE_MESSAGE_LIMIT,
        val wakeMaxChars: Int = Default.WAKE_MAX_CHARS,
    )

    data class Plan(
        val wake: Wake = Wake(),
        val send: Send = Send(),
        val wait: Wait = Wait(),
        val router: Router = Router(),
        val context: ContextSize = ContextSize(),
    )

    private val json = Json { ignoreUnknownKeys = true }

    fun file(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), "$DIRECTORY/$FILE")

    fun plan(context: Context): Plan = planFrom(readRoot(context))

    /** 读盘的结果 (读不到 / 读坏了都是空对象, 于是逐键兜底到缺省) */
    private fun readRoot(context: Context): JsonObject? = runCatching {
        file(context).takeIf { it.isFile }?.readText()?.let { json.parseToJsonElement(it) as? JsonObject }
    }.getOrNull()

    /** 纯解析 (单测与判据都走这里, 不需要设备) */
    fun planFrom(root: JsonObject?): Plan {
        val wake = root?.obj("wake")
        val send = root?.obj("send")
        val wait = root?.obj("wait")
        val router = root?.obj("router")
        val contextSize = root?.obj("context")
        val gapMin = wake.long("gapMinMs", Default.WAKE_GAP_MIN_MS, GAP_RANGE)
        val gapMax = wake.long("gapMaxMs", Default.WAKE_GAP_MAX_MS, GAP_RANGE)
        return Plan(
            wake = Wake(
                mode = wake.text("mode", Default.WAKE_MODE).takeIf { it == MODE_DIVING || it == MODE_ACTIVE }
                    ?: Default.WAKE_MODE,
                gapMinMs = minOf(gapMin, gapMax),
                gapMaxMs = maxOf(gapMin, gapMax),
                preSleepWaitMs = wake.long("preSleepWaitMs", Default.PRE_SLEEP_WAIT_MS, PRE_SLEEP_RANGE),
                nameTrigger = wake.obj("triggers").bool("name", true),
                keywordTrigger = wake.obj("triggers").bool("keywords", false),
                questionTrigger = wake.obj("triggers").bool("question", false),
                pokeTrigger = wake.obj("triggers").bool("poke", true),
                probability = wake.obj("triggers").float("probability", 0f, 0f..1f),
                anyMessage = wake.obj("triggers").bool("anyMessage", false),
                maxWakePerMinute = wake.int("maxWakePerMinute", Default.MAX_WAKE_PER_MINUTE, 1..60),
                maxWakePerHour = wake.int("maxWakePerHour", Default.MAX_WAKE_PER_HOUR, 1..600),
                noActionLimit = wake.int("noActionLimit", Default.NO_ACTION_LIMIT, 1..20),
                quietEnabled = wake.bool("quietEnabled", true),
                quietFrom = wake.text("quietFrom", Default.QUIET_FROM),
                quietTo = wake.text("quietTo", Default.QUIET_TO),
            ),
            send = Send(
                burstEnabled = send.bool("burstEnabled", true),
                burstMaxMessages = send.int("burstMaxMessages", Default.SEND_BURST_MAX, 1..6),
                gapMinMs = send.long("gapMinMs", Default.SEND_GAP_MIN_MS, BURST_GAP_RANGE),
                gapMaxMs = send.long("gapMaxMs", Default.SEND_GAP_MAX_MS, BURST_GAP_RANGE),
                perCharMs = send.long("perCharMs", Default.SEND_PER_CHAR_MS, 0L..500L),
                longGapProbability = send.float("longGapProbability", Default.LONG_GAP_PROBABILITY, 0f..1f),
                longGapMinMs = send.long("longGapMinMs", Default.LONG_GAP_MIN_MS, BURST_GAP_RANGE),
                longGapMaxMs = send.long("longGapMaxMs", Default.LONG_GAP_MAX_MS, BURST_GAP_RANGE),
                maxMessageChars = send.int("maxMessageChars", Default.MAX_MESSAGE_CHARS, 60..4_000),
                maxPerMinute = send.int("maxPerMinute", Default.MAX_SEND_PER_MINUTE, 1..60),
                maxPerHour = send.int("maxPerHour", Default.MAX_SEND_PER_HOUR, 1..600),
            ),
            wait = Wait(
                defaultMs = wait.long("defaultMs", Default.WAIT_DEFAULT_MS, 1_000L..600_000L),
                quietMs = wait.long("quietMs", Default.WAIT_QUIET_MS, 1_000L..120_000L),
                minQuietAfterNewMs = wait.long("minQuietAfterNewMs", Default.MIN_QUIET_AFTER_NEW_MS, 0L..120_000L),
            ),
            router = Router(
                gameMinutes = router.int("gameMinutes", Default.GAME_MINUTES, 5..1_440),
                wishDays = router.int("wishDays", Default.WISH_DAYS, 1..365),
                cooldownMs = router.long("cooldownMs", Default.COOLDOWN_MS, 60_000L..86_400_000L),
                chatChance = router.float("chatChance", Default.CHAT_CHANCE, 0f..1f),
                chatAfterMs = router.long("chatAfterMs", Default.CHAT_AFTER_MS, 60_000L..172_800_000L),
                ignoredCooldownMs = router.long(
                    "ignoredCooldownMs",
                    Default.IGNORED_COOLDOWN_MS,
                    60_000L..604_800_000L,
                ),
            ),
            context = ContextSize(
                wakeMessageLimit = contextSize.int("wakeMessageLimit", Default.WAKE_MESSAGE_LIMIT, 1..100),
                wakeMaxChars = contextSize.int("wakeMaxChars", Default.WAKE_MAX_CHARS, 500..40_000),
            ),
        )
    }

    /**
     * 落盘 (原子写)
     *
     * **整份重写**: `sim.json` 只有应用这一个写者, 与 `router.json` (宿主也在写) 不同, 所以这里
     * 不需要读-改-写 —— 逐键兜底已经在 [planFrom] 做过了
     */
    fun save(context: Context, plan: Plan): Boolean {
        val target = file(context)
        val root = buildJsonObject {
            put("v", 1)
            put("wake", buildJsonObject {
                put("mode", plan.wake.mode)
                put("gapMinMs", plan.wake.gapMinMs)
                put("gapMaxMs", plan.wake.gapMaxMs)
                put("preSleepWaitMs", plan.wake.preSleepWaitMs)
                put("triggers", buildJsonObject {
                    put("name", plan.wake.nameTrigger)
                    put("keywords", plan.wake.keywordTrigger)
                    put("question", plan.wake.questionTrigger)
                    put("poke", plan.wake.pokeTrigger)
                    put("probability", plan.wake.probability)
                    put("anyMessage", plan.wake.anyMessage)
                })
                put("maxWakePerMinute", plan.wake.maxWakePerMinute)
                put("maxWakePerHour", plan.wake.maxWakePerHour)
                put("noActionLimit", plan.wake.noActionLimit)
                put("quietEnabled", plan.wake.quietEnabled)
                put("quietFrom", plan.wake.quietFrom)
                put("quietTo", plan.wake.quietTo)
            })
            put("send", buildJsonObject {
                put("burstEnabled", plan.send.burstEnabled)
                put("burstMaxMessages", plan.send.burstMaxMessages)
                put("gapMinMs", plan.send.gapMinMs)
                put("gapMaxMs", plan.send.gapMaxMs)
                put("perCharMs", plan.send.perCharMs)
                put("longGapProbability", plan.send.longGapProbability)
                put("longGapMinMs", plan.send.longGapMinMs)
                put("longGapMaxMs", plan.send.longGapMaxMs)
                put("maxMessageChars", plan.send.maxMessageChars)
                put("maxPerMinute", plan.send.maxPerMinute)
                put("maxPerHour", plan.send.maxPerHour)
            })
            put("wait", buildJsonObject {
                put("defaultMs", plan.wait.defaultMs)
                put("quietMs", plan.wait.quietMs)
                put("minQuietAfterNewMs", plan.wait.minQuietAfterNewMs)
            })
            put("router", buildJsonObject {
                put("gameMinutes", plan.router.gameMinutes)
                put("wishDays", plan.router.wishDays)
                put("cooldownMs", plan.router.cooldownMs)
                put("chatChance", plan.router.chatChance)
                put("chatAfterMs", plan.router.chatAfterMs)
                put("ignoredCooldownMs", plan.router.ignoredCooldownMs)
            })
            put("context", buildJsonObject {
                put("wakeMessageLimit", plan.context.wakeMessageLimit)
                put("wakeMaxChars", plan.context.wakeMaxChars)
            })
        }
        return runCatching {
            target.parentFile?.mkdirs()
            val text = json.encodeToString(JsonObject.serializer(), root) + "\n"
            val temporary = File(target.parentFile, "${target.name}.tmp")
            temporary.writeText(text)
            if (!temporary.renameTo(target)) {
                target.writeText(text)
                temporary.delete()
            }
            true
        }.getOrDefault(false)
    }

    /* ── 逐键兜底那几行 ─────────────────────────────────────────────────── */

    private fun JsonObject?.obj(key: String): JsonObject? = this?.get(key) as? JsonObject

    private fun JsonObject?.prim(key: String): JsonPrimitive? = this?.get(key) as? JsonPrimitive

    private fun JsonObject?.bool(key: String, fallback: Boolean): Boolean =
        prim(key)?.booleanOrNull ?: fallback

    private fun JsonObject?.text(key: String, fallback: String): String =
        prim(key)?.contentOrNull?.takeIf { it.isNotBlank() } ?: fallback

    private fun JsonObject?.int(key: String, fallback: Int, range: IntRange): Int =
        (prim(key)?.intOrNull ?: prim(key)?.floatOrNull?.toInt() ?: fallback)
            .coerceIn(range.first, range.last)

    private fun JsonObject?.long(key: String, fallback: Long, range: LongRange): Long =
        (prim(key)?.longOrNull ?: prim(key)?.floatOrNull?.toLong() ?: fallback)
            .coerceIn(range.first, range.last)

    private fun JsonObject?.float(key: String, fallback: Float, range: ClosedFloatingPointRange<Float>): Float =
        (prim(key)?.floatOrNull ?: prim(key)?.longOrNull?.toFloat() ?: fallback)
            .coerceIn(range.start, range.endInclusive)
}
