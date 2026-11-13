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
 * - **时机与节奏归这一页**: 多久唤醒一次 / 沉睡前等多久 / 一次说几条 / 条间多长 / 判断层那几个阈值
 * - **检测内容归探索**: `router.json` 的 `checks` 由探索收尾写 (见 [RouterChecks]), 这一页只列出来
 *   给主人开关与删掉
 *
 * 落 `$DSH_HOME/lw/sim.json`, **应用单写者**; 宿主只读 (见 `host-plugin` 的 `readRouterInputs`)。
 * 读法一律逐键兜底: 缺键取缺省、越界夹进范围、类型不对取缺省 —— 一份写坏的文件不该让唤醒停下来
 */
internal object SimSetting {

    const val DIRECTORY = "lw"
    const val FILE = "sim.json"

    /** 潜水的意思是不主动唤醒; 活跃的意思是到点就唤醒 (与 tick.enabled 任一为开都算开) */
    const val MODE_DIVING = "diving"
    const val MODE_ACTIVE = "active"

    /**
     * 主动场能做什么 (2026-11-10, 方案 `docs/Luwi-主动场硬闸与解闸开关-方案-2026-11-10.md`)
     *
     * 三个字面量与宿主 `PROACTIVE_ACTING_*` 是同一套, 判据 `check-proactive.mjs` 钉着这一条:
     * - [ACTING_REMIND] 只提醒 (缺省): 三张表全拒
     * - [ACTING_ACT] 允许动手: 写动与命令放开, A 表 (屏) 仍全拒
     * - [ACTING_FULL] 全放开: 连建虚拟屏与点屏一起放开
     */
    const val ACTING_REMIND = "remind"
    const val ACTING_ACT = "act"
    const val ACTING_FULL = "full"

    /** 两个 gap 的范围: 一分钟到六小时 (桥接那边是 60 s ~ 无限, 这里给一个能用的上界) */
    val GAP_RANGE = 60_000L..21_600_000L

    /** 沉睡前观察的范围: 0 ~ 一小时 */
    val PRE_SLEEP_RANGE = 0L..3_600_000L

    /** 条间停顿的范围 */
    val BURST_GAP_RANGE = 200L..60_000L

    /**
     * 表情那两格 (2026-11-10 主人: "在设置活动的更多设置版块里加表情包图片上限设置" / "表情包加上数量限制")
     *
     * - **单张表情最多几 MB**: 她存不存得下这一张 —— 宿主 `lw_sticker op=fetch` 的下载闸、
     *   [io.github.yuloong07star.luwi.overlay.BallStickers] 的解码闸 (超了就不解码, 于是球上画不出来)、
     *   门户那条加表情的路, 三处读同一个数
     * - **最多几张**: 防攒满盘 —— 两个**写入方**都按它拦: 她自己 `op=fetch`、门户里主人加的那条;
     *   超出时回执要点名"先删几张", 并列出最旧的那几张
     *
     * 缺键就回落到 2 MB / 200 张 (这台机器上一版 `sim.json` 里没有这两格, 读起来正是缺省)
     */
    val STICKER_MB_RANGE = 1..20
    val STICKER_COUNT_RANGE = 20..500

    /** 每一档的缺省值 (与 `qq-bridge/config.json` 的 `socialV2` 对齐, 见 `tools/check-sim.mjs`) */
    object Default {
        const val WAKE_MODE = MODE_DIVING
        const val WAKE_GAP_MIN_MS = 1_500_000L
        const val WAKE_GAP_MAX_MS = 3_300_000L
        const val PRE_SLEEP_WAIT_MS = 300_000L
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
        const val COOLDOWN_MS = 1_800_000L
        const val CHAT_CHANCE = 0.35f
        const val CHAT_AFTER_MS = 14_400_000L
        const val IGNORED_COOLDOWN_MS = 86_400_000L
        const val QUIET_FROM = "23:00"
        const val QUIET_TO = "07:00"
        const val ACTING = ACTING_REMIND
        const val STICKER_MAX_MB = 2
        const val STICKER_MAX_COUNT = 200
    }

    /**
     * 主动程度 (2026-11-10 改名, 原「潜水与唤醒」; 2026-11-10 去群味: 群里那 9 条"什么算一次唤醒"
     * 在这里没有语义 —— 单聊里你开口就是对她说的 —— 已撤, 这段只剩"她多主动、隔多久唤醒一次"
     */
    data class Wake(
        val mode: String = Default.WAKE_MODE,
        val gapMinMs: Long = Default.WAKE_GAP_MIN_MS,
        val gapMaxMs: Long = Default.WAKE_GAP_MAX_MS,
        val preSleepWaitMs: Long = Default.PRE_SLEEP_WAIT_MS,
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

    /**
     * 判断层那几个阈值 (与 `host-plugin` 的 `ROUTER_DEFAULTS` 同一个数)
     *
     * 2026-11-10 起「游戏多久算久」「记着的事提前几天提」**不在这里**: 那两把尺子由探索收尾的 `rules`
     * 或对话里的 `lw_router op=rules` 写进 `router.json`, 缺省仍由宿主那侧给 (100 分钟 / 60 天)
     */
    data class Router(
        val cooldownMs: Long = Default.COOLDOWN_MS,
        val chatChance: Float = Default.CHAT_CHANCE,
        val chatAfterMs: Long = Default.CHAT_AFTER_MS,
        val ignoredCooldownMs: Long = Default.IGNORED_COOLDOWN_MS,
    )

    /**
     * 主动场那一档 (只有一条: 能做什么)
     *
     * 与 [ProactiveSchedule.Plan] 分开: 排期与权限是两件事 (方案 §3.3), 配置与运行账也不混写 ——
     * `proactive.json` 是宿主单写者, 这一份是应用单写者
     */
    data class Acting(val tier: String = Default.ACTING) {
        val remind: Boolean get() = tier == ACTING_REMIND
        val act: Boolean get() = tier == ACTING_ACT
        val full: Boolean get() = tier == ACTING_FULL
    }

    /**
     * 表情那一格 (2026-11-10, 主人: "在设置活动的更多设置版块里加表情包图片上限设置" 与 "表情包加上数量限制")
     *
     * 两条: [maxMb] 单张多大、[maxCount] 最多几张。它们是两件事 —— 一条管"这一张存不存得下",
     * 一条管"攒多了会不会把目录撑满"; 两个写入方 (她 `op=fetch` / 门户里主人加) 都按这两条拦
     */
    data class Sticker(
        val maxMb: Int = Default.STICKER_MAX_MB,
        val maxCount: Int = Default.STICKER_MAX_COUNT,
    ) {
        val maxBytes: Long get() = maxMb.toLong() * 1024L * 1024L
    }

    data class Plan(
        val wake: Wake = Wake(),
        val send: Send = Send(),
        val router: Router = Router(),
        val proactive: Acting = Acting(),
        val sticker: Sticker = Sticker(),
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
        val router = root?.obj("router")
        val proactive = root?.obj("proactive")
        val sticker = root?.obj("sticker")
        val gapMin = wake.long("gapMinMs", Default.WAKE_GAP_MIN_MS, GAP_RANGE)
        val gapMax = wake.long("gapMaxMs", Default.WAKE_GAP_MAX_MS, GAP_RANGE)
        return Plan(
            wake = Wake(
                mode = wake.text("mode", Default.WAKE_MODE).takeIf { it == MODE_DIVING || it == MODE_ACTIVE }
                    ?: Default.WAKE_MODE,
                gapMinMs = minOf(gapMin, gapMax),
                gapMaxMs = maxOf(gapMin, gapMax),
                preSleepWaitMs = wake.long("preSleepWaitMs", Default.PRE_SLEEP_WAIT_MS, PRE_SLEEP_RANGE),
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
            router = Router(
                cooldownMs = router.long("cooldownMs", Default.COOLDOWN_MS, 60_000L..86_400_000L),
                chatChance = router.float("chatChance", Default.CHAT_CHANCE, 0f..1f),
                chatAfterMs = router.long("chatAfterMs", Default.CHAT_AFTER_MS, 60_000L..172_800_000L),
                ignoredCooldownMs = router.long(
                    "ignoredCooldownMs",
                    Default.IGNORED_COOLDOWN_MS,
                    60_000L..604_800_000L,
                ),
            ),
            proactive = Acting(
                // 不认识的串按最保守的那一档; 旧布尔 allowActing 只读迁移一次 (true → act, false → remind)
                tier = proactive.text("acting", "").takeIf {
                    it == ACTING_REMIND || it == ACTING_ACT || it == ACTING_FULL
                } ?: when (proactive.bool("allowActing", false)) {
                    true -> ACTING_ACT
                    false -> Default.ACTING
                },
            ),
            sticker = Sticker(
                maxMb = sticker.int("maxMb", Default.STICKER_MAX_MB, STICKER_MB_RANGE),
                maxCount = sticker.int("maxCount", Default.STICKER_MAX_COUNT, STICKER_COUNT_RANGE),
            ),
        )
    }

    /**
     * 落盘 (原子写)
     *
     * **整份重写**: `sim.json` 只有应用这一个写者, 与 `router.json` (宿主也在写) 不同, 所以这里
     * 不需要读-改-写 —— 逐键兜底已经在 [planFrom] 做过了
     */
    /**
     * 写盘那一份的形状 (纯函数)
     *
     * 2026-11-10 去群味之后**只写留下来的键**: 老 `sim.json` 里那 14 个群味键从此不再出现,
     * 主人下一次保存就自己瘦身. 这一段抽出来是为了让单测不碰设备就能断言"老键一个都不写"
     */
    fun toJson(plan: Plan): JsonObject = buildJsonObject {
        put("v", 1)
        put("wake", buildJsonObject {
            put("mode", plan.wake.mode)
            put("gapMinMs", plan.wake.gapMinMs)
            put("gapMaxMs", plan.wake.gapMaxMs)
            put("preSleepWaitMs", plan.wake.preSleepWaitMs)
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
        put("router", buildJsonObject {
            put("cooldownMs", plan.router.cooldownMs)
            put("chatChance", plan.router.chatChance)
            put("chatAfterMs", plan.router.chatAfterMs)
            put("ignoredCooldownMs", plan.router.ignoredCooldownMs)
        })
        put("proactive", buildJsonObject {
            put("acting", plan.proactive.tier)
        })
        put("sticker", buildJsonObject {
            put("maxMb", plan.sticker.maxMb)
            put("maxCount", plan.sticker.maxCount)
        })
    }

    fun save(context: Context, plan: Plan): Boolean {
        val target = file(context)
        val root = toJson(plan)
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
