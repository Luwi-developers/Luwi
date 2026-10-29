package io.github.yuloong07star.luwi.account

import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 官网账号那几条线上协议的真值表 (2026-10-25)
 *
 * 这一份只量 [AccountWire]: 地址怎么拼、四种状态码各是什么意思、到期三档、头像那个字、日期格式
 * 网络那一半 (`AccountApi`) 不在这里 —— 它只有两条 GET, 判据是"解析器认不认官网那几种应答"
 *
 * 应答形状照抄 `Luwi-html/functions/api/account/poll.js` 与 `entitlement.js` 的 `json(...)`
 */
class AccountWireTest {

    private val shanghai: ZoneId = ZoneId.of("Asia/Shanghai")

    /* ── 地址 ───────────────────────────────────────────────────────────── */

    /** 登录发起页带 `ls`, 酒馆页与账号页是两条固定路径 (签到 2026-10-26 已在官网恢复) */
    @Test
    fun `三条地址`() {
        assertEquals("https://luwi.dpdns.org/login?ls=abc123", AccountWire.loginUrl("abc123"))
        assertEquals("https://luwi.dpdns.org/tavern", AccountWire.tavernUrl())
        assertEquals("https://luwi.dpdns.org/account", AccountWire.accountUrl())
        // 基址能在测试里换掉 (换一台后端时不改调用点)
        assertEquals("http://127.0.0.1:8788/login?ls=x", AccountWire.loginUrl("x", base = "http://127.0.0.1:8788"))
        assertEquals("http://127.0.0.1:8788/tavern", AccountWire.tavernUrl(base = "http://127.0.0.1:8788"))
    }

    /** 官网必须是 https: 这条链上有 device_token */
    @Test
    fun `基址是 https 的官网`() {
        assertEquals("https://luwi.dpdns.org", SITE_BASE)
        assertTrue(SITE_BASE.startsWith("https://"))
    }

    /* ── state ──────────────────────────────────────────────────────────── */

    /** 24 字节换 32 位 base64url, 没有填充, 全落在服务端收的字符集里 */
    @Test
    fun `state 是 32 位 url 安全字符`() {
        val state = AccountWire.stateOf(ByteArray(24))
        assertEquals(32, state.length)
        assertTrue(state.matches(Regex("^[A-Za-z0-9_-]{16,128}$")))
        // 底数换一种字节, 结果也得跟着变 (不是把输入当字符串丢掉)
        val other = AccountWire.stateOf(ByteArray(24) { (it + 1).toByte() })
        assertEquals(32, other.length)
        assertFalse(state == other)
        // 真随机那一发也守同一个形状
        assertTrue(AccountWire.newState().matches(Regex("^[A-Za-z0-9_-]{16,128}$")))
    }

    /* ── poll 的四种结论 ────────────────────────────────────────────────── */

    /** 200: token 与账号读数一起回来 */
    @Test
    fun `poll 拿到凭据`() {
        val body = """
            {"ok":true,"account":{"login":"octocat","email":"octo@example.com"},
             "entitlement":"signed-blob","token":"device-token-1234567890",
             "expiresAt":1795406400000,"issuedAt":1795300000000,"paidUntil":1796000000000}
        """.trimIndent()
        val result = AccountWire.parsePoll(200, body)
        assertTrue(result is PollResult.SignedIn)
        result as PollResult.SignedIn
        assertEquals("device-token-1234567890", result.token)
        assertEquals("octocat", result.login)
        assertEquals("octo@example.com", result.email)
        assertEquals(1795406400000L, result.expiresAt ?: -1L)
        assertEquals(1796000000000L, result.paidUntil ?: -1L)
    }

    /** 404 是"还没登录完", 410 是"这枚 state 已经作废" —— 两个都不是失败 */
    @Test
    fun `poll 的 404 与 410`() {
        assertEquals(PollResult.Pending, AccountWire.parsePoll(404, """{"ok":false,"state":"pending"}"""))
        assertEquals(PollResult.Gone, AccountWire.parsePoll(410, """{"ok":false,"state":"consumed"}"""))
    }

    /** 其它状态码就是失败, 而且不该再等下去 (transient = false) */
    @Test
    fun `poll 的失败那一档`() {
        val result = AccountWire.parsePoll(500, """{"ok":false,"error":"account missing"}""")
        assertTrue(result is PollResult.Failed)
        result as PollResult.Failed
        assertEquals("account missing", result.reason)
        assertFalse(result.transient)
        // 200 但没给 token: 也算失败, 不能把空串存成登录态
        val empty = AccountWire.parsePoll(200, """{"ok":true,"account":{"login":"x"}}""")
        assertTrue(empty is PollResult.Failed)
        // 429 是限流: 同样不再接着打
        assertTrue(AccountWire.parsePoll(429, "") is PollResult.Failed)
    }

    /* ── 读到期 ─────────────────────────────────────────────────────────── */

    /** 200 只回读数 (token 不变), 401 是登录已经失效 */
    @Test
    fun `refresh 的两档`() {
        val body = """
            {"ok":true,"account":{"login":"octocat","email":"octo@example.com"},
             "entitlement":"blob","expiresAt":1795406400000,"paidUntil":null}
        """.trimIndent()
        val done = AccountWire.parseRefresh(200, body)
        assertTrue(done is RefreshResult.Done)
        done as RefreshResult.Done
        assertEquals("octocat", done.login)
        assertEquals(1795406400000L, done.expiresAt ?: -1L)
        assertNull(done.paidUntil)

        assertEquals(RefreshResult.Unauthorized, AccountWire.parseRefresh(401, """{"ok":false,"error":"token is not valid any more; sign in again"}"""))
        val failed = AccountWire.parseRefresh(503, """{"ok":false,"error":"server not configured: DB"}""")
        assertTrue(failed is RefreshResult.Failed)
        assertEquals("server not configured: DB", (failed as RefreshResult.Failed).reason)
    }

    /* ── 到期三档 ───────────────────────────────────────────────────────── */

    /** 没有权益 / 还没到期 / 已经到期 (等于此刻算到期) */
    @Test
    fun `到期三档`() {
        val now = 1795406400000L
        assertEquals(PlanState.NONE, AccountWire.planStateOf(null, now))
        assertEquals(PlanState.NONE, AccountWire.planStateOf(0L, now))
        assertEquals(PlanState.ACTIVE, AccountWire.planStateOf(now + 1, now))
        assertEquals(PlanState.EXPIRED, AccountWire.planStateOf(now, now))
        assertEquals(PlanState.EXPIRED, AccountWire.planStateOf(now - 86_400_000, now))
    }

    /* ── 酒馆门闸 ───────────────────────────────────────────────────────── */

    /** 没登录 → 去登录; 登录了但没时长或已到期 → 去签到; 有效期内 → 放行 */
    @Test
    fun `酒馆门闸三档`() {
        val now = 1795406400000L
        val active = Account("t", "octocat", "o@example.com", expiresAt = now + 1, paidUntil = null, fetchedAt = now)
        val expired = active.copy(expiresAt = now)
        val none = active.copy(expiresAt = null)
        assertEquals(TavernGate.SIGN_IN, AccountWire.tavernGateOf(null, now))
        assertEquals(TavernGate.OPEN, AccountWire.tavernGateOf(active, now))
        assertEquals(TavernGate.SUBSCRIBE, AccountWire.tavernGateOf(expired, now))
        assertEquals(TavernGate.SUBSCRIBE, AccountWire.tavernGateOf(none, now))
        // 到期那一刻就算到期 (与 planStateOf 同一口径)
        assertEquals(TavernGate.SUBSCRIBE, AccountWire.tavernGateOf(active.copy(expiresAt = now - 1), now))
    }

    /* ── 头像与日期 ─────────────────────────────────────────────────────── */

    /** 头像那个字: 登录名首字母大写, 没名字给 L */
    @Test
    fun `头像首字母`() {
        assertEquals("O", AccountWire.avatarLetter("octocat"))
        assertEquals("A", AccountWire.avatarLetter("  alice"))
        assertEquals("L", AccountWire.avatarLetter(""))
        assertEquals("L", AccountWire.avatarLetter("   "))
        // 中文登录名 (理论上不会有) 原样, 不炸
        assertEquals("张", AccountWire.avatarLetter("张三"))
    }

    /** 到期那一行是 ISO 日期, 按给定时区算 */
    @Test
    fun `日期格式`() {
        assertEquals("2026-11-23", AccountWire.dateText(1795406400000L, shanghai))
        // 同一刻在 UTC 是 11-23 04:00, 日期不变; 换成西半球那一档才会跨日
        assertEquals("2026-01-05", AccountWire.dateText(1767544200000L, shanghai))
        assertEquals("2026-01-04", AccountWire.dateText(1767544200000L, ZoneId.of("America/Los_Angeles")))
    }
}
