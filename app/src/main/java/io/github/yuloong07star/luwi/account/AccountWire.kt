package io.github.yuloong07star.luwi.account

import java.security.SecureRandom
import java.time.Instant
import java.time.ZoneId
import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

/**
 * 官网账号那几条线上协议: 起登录 / 取登录结果 / 读到期, 外加酒馆门闸那一条纯函数 (2026-10-25)
 *
 * **只有读, 没有写**: 签到与购买只在官网 `/tavern` 页里办 (签到 2026-10-26 恢复), 所以这一份里
 * 没有 `/api/checkin`, 也不该有人把它加回来 —— 判据在 `tools/check-tavern-account.mjs`
 *
 * 这一份是**纯 Kotlin**: 不碰 Android, 不碰网络, 于是单测 (`AccountWireTest`) 在 JVM 上跑真值表
 * 服务端契约见 `Luwi-html/functions/api/account/{poll,entitlement}.js` 与 `functions-lib/session.js`
 */

/** 官网的基址 (与反馈中转那一台是同一个) */
const val SITE_BASE = "https://luwi.dpdns.org"

/** 登录发起页: 带 `ls` 时它把「用 GitHub 登录」指向带 state 的那条路 */
const val LOGIN_PATH = "/login"

/** 官网的酒馆页 (`site/tavern.html`): 查看到期、签到与购买都在这里; 未登录的浏览器会被它送去登录页 */
const val TAVERN_PATH = "/tavern"

/** 官网的账号页 (`site/account.html`): 换账号、看同步与订单都在它后面 */
const val ACCOUNT_PATH = "/account"

/** 取登录结果 (插件那一侧叫 poll, 与官网同一个名字) */
const val POLL_PATH = "/api/account/poll"

/** 读到期 (续费 / 签到之后重签一份权益) */
const val ENTITLEMENT_PATH = "/api/account/entitlement"

/** 一次登录落地之后本机存的那一份 */
data class Account(
    val token: String,
    val login: String,
    val email: String,
    val expiresAt: Long?,
    val paidUntil: Long?,
    val fetchedAt: Long,
)

/** 到期的三档 (只看 `expiresAt` 与此刻) */
enum class PlanState { NONE, ACTIVE, EXPIRED }

/** 酒馆门闸的三档: 没登录 / 登录了但服务时长不在有效期内 / 放行 */
enum class TavernGate { SIGN_IN, SUBSCRIBE, OPEN }

/** `GET /api/account/poll?state=` 的四种结论 */
sealed interface PollResult {

    /** 浏览器里还没登录完 (404) */
    data object Pending : PollResult

    /** 这枚 state 已经用过, 或者过期了 (410) */
    data object Gone : PollResult

    /** 拿到了 device_token 与账号读数 (200) */
    data class SignedIn(
        val token: String,
        val login: String,
        val email: String,
        val expiresAt: Long?,
        val paidUntil: Long?,
    ) : PollResult

    /**
     * 没成
     * @param reason 一句人话 (界面上要念出来)
     * @param transient 网络那一档为 true, 可以接着等; HTTP 那一档为 false, 这一次登录已经没戏
     */
    data class Failed(val reason: String, val transient: Boolean) : PollResult
}

/** `GET /api/account/entitlement?token=` 的三种结论 */
sealed interface RefreshResult {

    data class Done(
        val login: String,
        val email: String,
        val expiresAt: Long?,
        val paidUntil: Long?,
    ) : RefreshResult

    /** token 不认了 (401): 这台机器上的登录已经失效 */
    data object Unauthorized : RefreshResult

    data class Failed(val reason: String) : RefreshResult
}

object AccountWire {

    /** 解析器: 官网以后加字段时老版本也读得下去 */
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    /** 一次登录的 state: 24 字节换 base64url (32 位), 服务端只认 16~128 位 URL 安全字符 */
    fun newState(random: SecureRandom = SecureRandom()): String = stateOf(ByteArray(24).also { random.nextBytes(it) })

    /** 同一件事的纯形态: 单测拿固定字节读长度与字符集 */
    fun stateOf(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    /** 浏览器里要打开的那一页: 登录走完了官网会自己回到账号页 */
    fun loginUrl(state: String, base: String = SITE_BASE): String = "$base$LOGIN_PATH?ls=$state"

    /** 酒馆页: **签到与购买只在这一页里发生** */
    fun tavernUrl(base: String = SITE_BASE): String = base + TAVERN_PATH

    /** 账号页: 换账号 / 看同步与订单 */
    fun accountUrl(base: String = SITE_BASE): String = base + ACCOUNT_PATH

    /** 取登录结果那一趟 (404 还没好 / 410 已作废 / 200 拿到) */
    fun parsePoll(code: Int, body: String): PollResult = when (code) {
        404 -> PollResult.Pending
        410 -> PollResult.Gone
        200 -> {
            val root = objectOf(body)
            val token = root?.text("token").orEmpty()
            if (root == null || !root.flag("ok") || token.isEmpty()) {
                val reason = root?.text("error").orEmpty().ifEmpty { "官网没有给出凭据 (HTTP $code)" }
                PollResult.Failed(reason, transient = false)
            } else {
                val account = root.child("account")
                PollResult.SignedIn(
                    token = token,
                    login = account?.text("login").orEmpty(),
                    email = account?.text("email").orEmpty(),
                    expiresAt = root.number("expiresAt"),
                    paidUntil = root.number("paidUntil"),
                )
            }
        }
        else -> PollResult.Failed(reasonOf(body, code), transient = false)
    }

    /** 读到期那一趟 (401 = 登录失效) */
    fun parseRefresh(code: Int, body: String): RefreshResult = when (code) {
        401 -> RefreshResult.Unauthorized
        200 -> {
            val root = objectOf(body)
            if (root == null || !root.flag("ok")) {
                RefreshResult.Failed(root?.text("error").orEmpty().ifEmpty { "官网没有给出权益 (HTTP $code)" })
            } else {
                val account = root.child("account")
                RefreshResult.Done(
                    login = account?.text("login").orEmpty(),
                    email = account?.text("email").orEmpty(),
                    expiresAt = root.number("expiresAt"),
                    paidUntil = root.number("paidUntil"),
                )
            }
        }
        else -> RefreshResult.Failed(reasonOf(body, code))
    }

    /** 到期三档: 没有权益 / 还没到期 / 已经到期 */
    fun planStateOf(expiresAt: Long?, now: Long): PlanState = when {
        expiresAt == null || expiresAt <= 0L -> PlanState.NONE
        expiresAt > now -> PlanState.ACTIVE
        else -> PlanState.EXPIRED
    }

    /**
     * 酒馆门闸: 登录 + 有效的服务时长 (签到与购买换来的天数)
     *
     * 与同步 P2P 那条闸同一个口径 (有效期内放行, 到期拦), 差别只在宽限: 这里**不给** 7 天 ——
     * 酒馆是本地聊天, 到期就该停下, 宽限留给离线同步那一侧
     */
    fun tavernGateOf(account: Account?, now: Long): TavernGate = when {
        account == null -> TavernGate.SIGN_IN
        planStateOf(account.expiresAt, now) == PlanState.ACTIVE -> TavernGate.OPEN
        else -> TavernGate.SUBSCRIBE
    }

    /** 头像那个字: 登录名的首字母大写, 没有登录名时给 `L` (与官网顶栏同一个做法) */
    fun avatarLetter(login: String): String {
        val first = login.trim().firstOrNull() ?: return "L"
        return first.uppercaseChar().toString()
    }

    /** 到期那一行要的日期: `2026-11-23` (本地时区) */
    fun dateText(ms: Long, zone: ZoneId = ZoneId.systemDefault()): String =
        Instant.ofEpochMilli(ms).atZone(zone).toLocalDate().toString()

    private fun objectOf(body: String): JsonObject? =
        runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull()

    private fun reasonOf(body: String, code: Int): String =
        objectOf(body)?.text("error")?.takeIf { it.isNotEmpty() } ?: "HTTP $code"

    private fun JsonObject.child(key: String): JsonObject? = this[key] as? JsonObject

    private fun JsonObject.text(key: String): String {
        val value = this[key] as? JsonPrimitive ?: return ""
        return if (value.isString) value.content else ""
    }

    private fun JsonObject.number(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

    private fun JsonObject.flag(key: String): Boolean =
        (this[key] as? JsonPrimitive)?.content == "true"
}
