package io.github.yuloong07star.luwi.overlay

import android.content.Context
import android.os.FileObserver
import io.github.yuloong07star.luwi.host.DshHost
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.io.File

/**
 * 「余额还有多少」: **一份文件, 宿主写, 应用读** (与 `ball-phase.json` 同一条路, 2026-10-16)
 *
 * 余额住在 dsh 的账号缝里 (宿主那一侧才有), 而球与那块文本框在应用进程里 —— 所以又是"宿主把事实落成
 * 文件, 应用想什么时候看就什么时候读"。谁都不许推送: 那条路送不到就没人补
 *
 * ```json
 * {"v":2,"at":1760000000000,"ok":true,"provider":"moonshot","model":"kimi-k2","label":"Moonshot",
 *  "kind":"money","currency":"CNY","value":"12.34","bonus":"5.00","percent":0,"reason":""}
 * ```
 *
 * `kind` 两档 (2026-10-17): `money` 是金额, `quota` 是订阅制那种"还剩百分之多少"的额度 —— 后者认
 * [Snapshot.percent], 货币与金额那两栏没有意义。旧宿主 (2026-10-17 之前) 只写金额那一档, 那几个新
 * 键一个都没有, 于是缺省按 `money` 读
 *
 * `ok:false` 时 [Snapshot.reason] 是一句**宿主自己写的人话** (未登录 / 没有账号缝 / 网络失败), 应用只
 * 负责把它递到主人眼前, 绝不自己编一个 0 出来
 *
 * 应用→宿主那条"现在刷一次"的方向走**请求记号** (`balance-request.json`, `{"at":ms}`): 宿主在它本来就
 * 有的那条 3 s 轮询里顺手看一眼, 有就刷一次。余额自己平时也按它自己的节拍刷新 (起来一次 / 每轮结束),
 * 所以这一条只是"主人正看着呢, 别让他等"
 */
internal object BalanceFile {

    /** 与宿主那侧同一个约定 (谁都不许单边改) */
    private const val DIRECTORY = "lw"
    private const val FILE_NAME = "balance.json"
    private const val REQUEST_NAME = "balance-request.json"

    /** 答案的那两档: 金额 (带币种) 与订阅额度 (带百分比) —— 与宿主那侧的 `kind` 一一对应 */
    const val KIND_MONEY = "money"
    const val KIND_QUOTA = "quota"

    /** 一次读的答案 */
    internal data class Snapshot(
        val at: Long,
        /**
         * 这一份是对哪一次请求的答案 (请求记号里的 `seq`, 2026-11-01 起)
         *
         * 旧宿主写的那一份没有这个键: 那是"不知道对哪一次", 当 0 —— 应用只按它判"这一份是不是我刚问
         * 的那一问", 0 与任何请求都对不上, 于是退回按 `at` 看新旧
         */
        val seq: Long,
        val ok: Boolean,
        /** 当前模型的提供方没有余额源 (宿主那侧 [ BALANCE_SOURCES ] 表里没有它) —— 应用说「不支持」 */
        val unsupported: Boolean,
        /** 这一笔钱是谁家的 (宿主给的展示名; 旧宿主写的那一份没有这个键, 那就是空串) */
        val label: String,
        /** 问的是哪一家 / 哪个模型 (宿主写的; 请求记号把这两个再带回去, 只当提示) */
        val provider: String,
        val model: String,
        /**
         * 这份答案是哪一档: [KIND_MONEY] 是金额, [KIND_QUOTA] 是订阅制那种"还剩百分之多少"
         *
         * 旧宿主 (2026-10-17 之前那一份) 只写金额, 没有这个键 —— 缺省按金额读
         */
        val kind: String,
        val currency: String,
        val value: String,
        /** 赠金那一份 (宿主那侧叫 bonusWallets), 空串 = 没有 */
        val bonus: String,
        /** [KIND_QUOTA] 那一档的剩余百分比 (其余档位没有意义) */
        val percent: Int,
        val reason: String,
    )

    /** 余额那一份在哪儿 (读与 Watch 共用) */
    fun file(context: Context): File = File(File(File(context.filesDir, DshHost.HOME_DIR), DIRECTORY), FILE_NAME)

    private fun requestFile(context: Context): File =
        File(File(File(context.filesDir, DshHost.HOME_DIR), DIRECTORY), REQUEST_NAME)

    /** 现在那份余额 (文件不存在或读不出来就是 null —— 那是"宿主还没写过", 不是"没余额") */
    fun snapshot(context: Context): Snapshot? {
        val file = file(context)
        if (!file.isFile) return null
        return runCatching { parse(file.readText()) }.getOrNull()
    }

    /** 解析那一份 JSON: 纯函数 (只吃一个 String), 判据在 `BalanceFileTest` */
    fun parse(text: String): Snapshot? {
        val root = runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
        val at = (root["at"] as? JsonPrimitive)?.longOrNull ?: return null
        // `ok` 与 `at` 一样是宿主一定会写的那两个键: 缺一个那一份就不可信, 当"还没写过"
        // (旧文件里 `unsupported` 可以缺, 那一条另有口径, 见下面)
        val ok = (root["ok"] as? JsonPrimitive)?.booleanOrNull ?: return null
        fun text(key: String): String = (root[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
        return Snapshot(
            at = at,
            seq = (root["seq"] as? JsonPrimitive)?.longOrNull ?: 0,
            ok = ok,
            // 旧宿主写的文件没有这一个键 (那是 2026-10-16 之前那一份), 当 false —— 老文件走 reason 那条
            unsupported = (root["unsupported"] as? JsonPrimitive)?.booleanOrNull ?: false,
            // 2026-10-17 之前那份文件没有 label / kind / percent 三个键: 那是只有一家 (DeepSeek 账号缝)
            // 的年代, 按"没有名字的金额"读 —— 老宿主配新应用照样显示得出来
            label = text("label"),
            provider = text("provider"),
            model = text("model"),
            kind = text("kind").ifBlank { KIND_MONEY },
            currency = text("currency"),
            value = text("value"),
            bonus = text("bonus"),
            percent = (root["percent"] as? JsonPrimitive)?.intOrNull ?: 0,
            reason = text("reason"),
        )
    }

    /**
     * 一次「看余额」的请求记号 (v2, 2026-11-01)
     *
     * 老记号只有 `at`, 那一条的毛病是"同一秒点两次"与"重试"分不开: 宿主按时间戳去重, 主人再点一次
     * 只是把同一个数又写一遍. 新记号多两样 —— `seq` 是这一问的编号 (宿主**同一个 seq 只刷一次**),
     * `force` 是"主人自己按的重新取" (重试那条路)
     */
    internal data class Request(
        val seq: Long,
        val at: Long,
        /** 上一次答案问的是哪一家 / 哪个模型 (只当提示, 宿主每一问都自己再认一次当前模型) */
        val provider: String = "",
        val model: String = "",
        val force: Boolean = false,
    )

    /** 请求记号写成 JSON (纯函数, 判据在 `BalanceFileTest`) */
    fun encodeRequest(request: Request): String = buildJsonObject {
        put("v", JsonPrimitive(2))
        put("seq", JsonPrimitive(request.seq))
        put("at", JsonPrimitive(request.at))
        put("provider", JsonPrimitive(request.provider))
        put("model", JsonPrimitive(request.model))
        put("force", JsonPrimitive(request.force))
    }.toString()

    /** 读回一个请求记号: v1 那一份只有 `at`, 拿它当 `seq` (老应用配新宿主照样能刷) */
    fun parseRequest(text: String): Request? {
        val root = runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
        val at = (root["at"] as? JsonPrimitive)?.longOrNull ?: return null
        fun text(key: String): String = (root[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
        return Request(
            seq = (root["seq"] as? JsonPrimitive)?.longOrNull ?: at,
            at = at,
            provider = text("provider"),
            model = text("model"),
            force = (root["force"] as? JsonPrimitive)?.booleanOrNull ?: false,
        )
    }

    /**
     * 写一个"现在刷一次"的请求记号, 返回这一问的 `seq`
     *
     * 那个 `seq` 是"主人又要了一次"的唯一凭据: 宿主只认它比上一问新 (见 `startBalance` 的 handled),
     * 所以**每问一次就写一个新数** —— 同一毫秒里点两次也要不同 (`max(now, 上一份 + 1)`)
     *
     * [force] 是"重新取一次"那条重试路: 它同样是一个新 seq, 只是多带一个记号, 让宿主把这一问记成
     * 人为重试 (两者都绕不过"同一个 seq 只刷一次", 那一条是幂等, 不是节流)
     */
    fun request(context: Context, force: Boolean = false): Long {
        val now = System.currentTimeMillis()
        val last = snapshot(context)
        val previous = parseRequest(runCatching { requestFile(context).readText() }.getOrDefault(""))
        val request = Request(
            seq = maxOf(now, (previous?.seq ?: 0L) + 1),
            at = now,
            provider = last?.provider.orEmpty(),
            model = last?.model.orEmpty(),
            force = force,
        )
        runCatching {
            requestFile(context).parentFile?.mkdirs()
            requestFile(context).writeText(encodeRequest(request) + "\n")
        }
        return request.seq
    }

    /**
     * 这份答案是不是"旧值": 5 分钟内当正常数看 (2026-11-01)
     *
     * **上屏不再拿它标旧** (2026-11-02 主人: 只给余额 + 时间, 不要「可能不是最新的」那一句) —— 它现在
     * 只是这个窗口的公共判据, 与 [FRESH_MS] 同一个数, 免得两边各写一个
     */
    fun isOld(at: Long, now: Long = System.currentTimeMillis()): Boolean = now - at > FRESH_MS

    /** 旧值还能当"正常数"看的窗口 (5 分钟): 现在只决定要不要发后台那一问, 判据在 `BalanceFileTest` */
    const val FRESH_MS = 5 * 60_000L

    /**
     * 金额上屏的写法: **只留两位小数** (2026-11-01 主人: "小数点部分应只显示小数点后两位")
     *
     * 宿主那边算出来的数已经定点到两位, 可账号缝与几家直读接口给的是原始串 (`236.9677291600000000`),
     * 原样贴上去就是二十位小数 —— 所以显示这一层再统一一次。读不成数的 (空串 / 带单位 / 中文) 原样留着,
     * 不拿 `0.00` 顶替: 那是"没读到", 不是"没钱"
     */
    fun moneyText(raw: String): String {
        val text = raw.trim()
        if (text.isEmpty()) return ""
        val value = text.toDoubleOrNull() ?: return text
        if (!value.isFinite()) return text
        return String.format(java.util.Locale.ROOT, "%.2f", value)
    }

    /**
     * 点「看余额」这一下该干什么 (2026-11-01, B1-b): 五档
     *
     * - [Ask.FRESH]: [freshMs] 以内的数, 直接上屏; **照样发一次确认请求** (2026-11-01 主人:
     *   "点击查询余额时刷新, 但要立即显示上次的") —— 屏上马上就有数, 宿主那一拍回来再把那一行换掉
     * - [Ask.OLD]: 有数但过了 [freshMs], 先把旧数给主人看 (那一行**只有余额 + 时间**, 2026-11-02 主人
     *   改口径: 不标「正在刷新」), 同时发一个新请求
     * - [Ask.PENDING]: 手上没有数, 或者刚问过那一问还没回音 —— 「正在取余额…」
     * - [Ask.RETRY]: 上一次那份是失败, 那一行就是重试的入口: 新 `seq` + `force` (同样不标「正在重试」)
     * - [Ask.UNSUPPORTED]: 当前模型没有余额源, 那是稳定事实, 重试也问不出数来
     *
     * 缓存由宿主覆盖写 (两份触发: 每轮对话结束那一拍与这一次点击), 所以"点上就有数"几乎是常态;
     * "在路上"那一段仍靠 [IN_FLIGHT_MS] 挡连点, 不会因为 FRESH 也发请求就一次点出几十问
     */
    enum class Ask { FRESH, OLD, PENDING, RETRY, UNSUPPORTED }

    /** [decide] 的答案: 上哪一档的话, 要不要写请求, 写的时候带不带 `force` */
    internal data class Decision(
        val ask: Ask,
        /** 这一档要显示的那份答案 (只有 [Ask.PENDING] 是 null) */
        val snapshot: Snapshot?,
        val request: Boolean,
        val force: Boolean,
    )

    /** 一问在路上最多算这么久 (宿主网络预算 6 s + 落盘那两拍), 过了就当没等到, 主人可以再问 */
    const val IN_FLIGHT_MS = 8_000L

    /**
     * 这一下点下去该走哪条路 (纯函数, 判据在 `BalanceFileTest`)
     *
     * 「那一问还在路上」判的是**答案里的 `seq` 对不对得上**那一问, 不是"距离上次点击多少秒" ——
     * 宿主的网络预算 6 s, 答案一到就该能再问 (判据 10-3 断网 6.2 s 内可重试)
     */
    internal fun decide(
        snapshot: Snapshot?,
        askedAt: Long,
        askedSeq: Long,
        freshMs: Long,
        now: Long = System.currentTimeMillis(),
    ): Decision {
        val inFlight = askedAt > 0 && now - askedAt < IN_FLIGHT_MS &&
            (snapshot == null || snapshot.seq != askedSeq)
        if (snapshot == null) return Decision(Ask.PENDING, null, request = !inFlight, force = false)
        if (!snapshot.ok) {
            // 「不支持」是稳定事实: 重试也答不出数, 不绕那一圈
            if (snapshot.unsupported) return Decision(Ask.UNSUPPORTED, snapshot, request = false, force = false)
            return if (inFlight) {
                Decision(Ask.PENDING, null, request = false, force = false)
            } else {
                Decision(Ask.RETRY, snapshot, request = true, force = true)
            }
        }
        // 未来的时间戳 (设备时间被改过) 落进这一档, 不把主人挡在门外
        if (now - snapshot.at <= freshMs) {
            // 点上就上屏 (缓存), 同时再问一次 (2026-11-01 主人: "点击查询余额时刷新"): 屏上是上次那份,
            // 宿主回来再把那一行换成新的; 已经在路上 (8 s 内还没答) 就不再叠一问
            return Decision(Ask.FRESH, snapshot, request = !inFlight, force = false)
        }
        return Decision(Ask.OLD, snapshot, request = !inFlight, force = false)
    }

    /** 这个记号是不是主人刚写的 (宿主那侧判"要不要刷"用; 两侧同一个数, 谁都不许单边改) */
    fun requestFresh(context: Context, withinMs: Long, now: Long = System.currentTimeMillis()): Boolean {
        val file = requestFile(context)
        if (!file.isFile) return false
        val at = runCatching {
            (Json.parseToJsonElement(file.readText()).jsonObject["at"] as? JsonPrimitive)?.longOrNull
        }.getOrNull() ?: return false
        return now - at in 0..withinMs
    }

    /**
     * 盯着那个目录: 宿主一写余额 (或那个请求记号被写出来) 就叫醒
     *
     * 形状与 [BallPhaseFile.Watch] 一模一样 —— 盯**目录**而不是文件 (文件可能是第一次写, 而它是
     * 原子写出来的, `rename` 在目录上留下的是 `MOVED_TO`)
     */
    internal class Watch(private val onChanged: () -> Unit) {

        private var observer: FileObserver? = null

        fun start(context: Context) {
            if (observer != null) return
            val directory = file(context).parentFile ?: return
            directory.mkdirs()
            val created = object : FileObserver(directory, MASK) {
                override fun onEvent(event: Int, name: String?) {
                    if (name != FILE_NAME && name != "$FILE_NAME.tmp" && name != REQUEST_NAME) return
                    onChanged()
                }
            }
            observer = created
            created.startWatching()
        }

        fun stop() {
            observer?.stopWatching()
            observer = null
        }

        private companion object {
            /** 原子写走的是 `CLOSE_WRITE` (直接写) 与 `MOVED_TO` (rename), `CREATE` 兜住新文件 */
            private const val MASK =
                FileObserver.CLOSE_WRITE or FileObserver.MOVED_TO or FileObserver.CREATE
        }
    }
}
