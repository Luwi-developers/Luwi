package io.github.yuloong07star.luwi.overlay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「看余额」那份文件的解析 ([BalanceFile])
 *
 * 为什么值得单测: 这一档最怕的是"拿不到就编一个 0" —— 文件没写 / 写坏 / 宿主报失败, 三种都得**如实**,
 * 而且哪一种都不能让那块文本框空着或崩掉。解析是纯的 (只吃一个 String), 所以四种都在这儿钉住
 */
class BalanceFileTest {

    @Test
    fun `宿主报了数就照单全收`() {
        val snapshot = BalanceFile.parse(
            """{"v":1,"at":1760000000000,"ok":true,"currency":"CNY","value":"12.34","bonus":"5.00","reason":""}""",
        )
        assertTrue(snapshot != null && snapshot.ok)
        snapshot!!
        assertEquals(1_760_000_000_000L, snapshot.at)
        assertEquals("CNY", snapshot.currency)
        assertEquals("12.34", snapshot.value)
        assertEquals("5.00", snapshot.bonus)
        assertEquals("", snapshot.reason)
    }

    @Test
    fun `赠金那一档没有时是空串`() {
        val snapshot = BalanceFile.parse(
            """{"v":1,"at":1760000000000,"ok":true,"currency":"USD","value":"0.01"}""",
        )
        assertTrue(snapshot != null && snapshot.ok)
        assertEquals("", snapshot!!.bonus)
    }

    @Test
    fun `失败也是一份完整的快照, 原话一个字不改`() {
        val snapshot = BalanceFile.parse(
            """{"v":1,"at":1760000000000,"ok":false,"reason":"the DeepSeek account is not signed in on this host"}""",
        )
        assertTrue(snapshot != null && !snapshot.ok)
        assertEquals("", snapshot!!.value)
        assertEquals("the DeepSeek account is not signed in on this host", snapshot.reason)
    }

    /**
     * 「当前模型不支持查询余额」那一档 (2026-10-16 主人定的口径): 宿主先认模型再认余额源, 提供方不在
     * 表里就带 `unsupported: true` —— 应用把它说成「当前模型不支持查询余额」, 不再念宿主的英文原话
     */
    @Test
    fun `当前模型没有余额源时带 unsupported 那一面`() {
        val snapshot = BalanceFile.parse(
            """{"v":1,"at":1760000000000,"ok":false,"unsupported":true,"reason":"no balance source for the current model (xiaomi/mimo-v2.6-flash)"}""",
        )
        assertTrue(snapshot != null && !snapshot.ok && snapshot!!.unsupported)
        // 旧宿主写的文件没有这一个键: 当 false, 走 reason 那条 (不把老文件误报成"不支持")
        val legacy = BalanceFile.parse(
            """{"v":1,"at":1760000000000,"ok":false,"reason":"the DeepSeek account is not signed in on this host"}""",
        )
        assertTrue(legacy != null && !legacy!!.unsupported)
    }

    /**
     * v2 那一份 (2026-10-17 加了厂商名与两档答案): 金额那一档照旧, 只是多带一个名字 —— 宿主用它说
     * 清"这一笔是谁家的", 而旧宿主写的那一份**没有那几个新键**, 缺省就是"没有名字的金额"
     */
    @Test
    fun `v2 的钱带上厂商名, 旧文件缺省是金额`() {
        val named = BalanceFile.parse(
            """{"v":2,"at":1760000000000,"ok":true,"provider":"moonshot","model":"kimi-k2","label":"Moonshot",
               "kind":"money","currency":"CNY","value":"12.34","bonus":"5.00","percent":0,"reason":""}""",
        )
        assertTrue(named != null && named.ok)
        assertEquals("Moonshot", named!!.label)
        assertEquals(BalanceFile.KIND_MONEY, named.kind)
        assertEquals(0, named.percent)

        val legacy = BalanceFile.parse(
            """{"v":1,"at":1760000000000,"ok":true,"currency":"CNY","value":"12.34"}""",
        )
        assertTrue(legacy != null && legacy.ok)
        legacy!!
        assertEquals("", legacy.label)
        assertEquals(BalanceFile.KIND_MONEY, legacy.kind)
        assertEquals(0, legacy.percent)
    }

    /**
     * 订阅制那几家给的是「还剩百分之多少」, 不是金额 —— 那一档认 percent, 货币与金额两栏没有意义
     * (宿主写空), 所以它一个字都不许被读成钱
     */
    @Test
    fun `额度那一档认 percent`() {
        val snapshot = BalanceFile.parse(
            """{"v":2,"at":1760000000000,"ok":true,"provider":"zai","label":"Zhipu GLM","kind":"quota","percent":62,"reason":""}""",
        )
        assertTrue(snapshot != null && snapshot.ok)
        assertEquals(BalanceFile.KIND_QUOTA, snapshot!!.kind)
        assertEquals(62, snapshot.percent)
        assertEquals("", snapshot.value)
    }

    @Test
    fun `文件没写 or 写坏时就是 null (那是还没写过, 不是没余额)`() {
        assertNull(BalanceFile.parse(""))
        assertNull(BalanceFile.parse("不是 JSON"))
        assertNull(BalanceFile.parse("""{"ok":true,"value":"1"}"""))  // 缺 at, 那一份不可信
        assertNull(BalanceFile.parse("""{"at":1,"value":"1"}"""))     // 缺 ok, 那一份不可信
        assertTrue(BalanceFile.parse("""{"at":1,"ok":true,"value":"1"}""")!!.ok)
    }

    /* ── 2.8.0 余额快路径: 请求带 seq, 答案带 seq, 旧值按 5 分钟标旧 (2026-11-01) ───────────── */

    /**
     * 请求记号 (v2): `seq` 是"这一问"的编号, `force` 是人为重试 —— 宿主按 seq 去重, 按 force 记读数
     *
     * 老版本写的记号只有 `{"at":ms}`: 读回来要拿 at 当 seq, 否则新宿主会把老应用那一问当成"没问"
     */
    @Test
    fun `请求记号带 seq 与 force, v1 老记号仍然读得懂`() {
        val request = BalanceFile.Request(
            seq = 1_760_000_000_123,
            at = 1_760_000_000_123,
            provider = "deepseek",
            model = "deepseek-v4-flash",
            force = true,
        )
        val encoded = BalanceFile.encodeRequest(request)
        assertTrue(encoded.contains("\"seq\":1760000000123"))
        assertTrue(encoded.contains("\"force\":true"))
        assertEquals(request, BalanceFile.parseRequest(encoded))

        // 老记号: 只有 at, 拿它当 seq, force 缺省 false
        assertEquals(
            BalanceFile.Request(seq = 1_760_000_000_456, at = 1_760_000_000_456),
            BalanceFile.parseRequest("""{"at":1760000000456}"""),
        )
        // 没有 at 的那一份不可信 (与答案那一侧同一个口径)
        assertNull(BalanceFile.parseRequest("{}"))
        assertNull(BalanceFile.parseRequest("不是 JSON"))
    }

    /** 答案里的 seq 与 provider/model (2026-11-01): 应用按 seq 认出"这是我刚问的那一次" */
    @Test
    fun `答案带 seq 与厂商, 旧宿主缺省是 0 与空串`() {
        val snapshot = BalanceFile.parse(
            """{"v":3,"seq":1760000000123,"at":1760000000456,"ok":true,"provider":"moonshot",
               "model":"kimi-k2","label":"Moonshot","kind":"money","currency":"CNY","value":"12.34"}""",
        )
        assertTrue(snapshot != null && snapshot.ok)
        snapshot!!
        assertEquals(1_760_000_000_123L, snapshot.seq)
        assertEquals("moonshot", snapshot.provider)
        assertEquals("kimi-k2", snapshot.model)

        val legacy = BalanceFile.parse("""{"v":2,"at":1760000000000,"ok":true,"value":"1.00"}""")
        assertTrue(legacy != null)
        assertEquals(0L, legacy!!.seq)
        assertEquals("", legacy.provider)
        assertEquals("", legacy.model)
    }

    /** 失败那一份也是一份完整的快照: seq 照旧跟着走 (失败不代表"不知道对哪一问") */
    @Test
    fun `失败那一份也带 seq`() {
        val snapshot = BalanceFile.parse(
            """{"v":3,"seq":1760000000123,"at":1760000000456,"ok":false,"reason":"fetching the balance failed: timeout"}""",
        )
        assertTrue(snapshot != null && !snapshot.ok)
        assertEquals(1_760_000_000_123L, snapshot!!.seq)
        assertEquals("fetching the balance failed: timeout", snapshot.reason)
    }

    /**
     * 旧值那条口径 (2026-11-01): 5 分钟之内当正常数看, 更旧要明确标旧 —— 余额是"刚才那一下"的数,
     * 隔久了那个数可能早变了, 不能装作刚查过
     */
    @Test
    fun `旧值 5 分钟之内算新, 更旧要标旧`() {
        val at = 1_760_000_000_000L
        assertFalse(BalanceFile.isOld(at, now = at + BalanceFile.FRESH_MS))
        assertTrue(BalanceFile.isOld(at, now = at + BalanceFile.FRESH_MS + 1))
        // 未来的时间戳 (设备时间被改过) 不算旧, 免得一句话把主人挡在门外
        assertFalse(BalanceFile.isOld(at + 60_000L, now = at))
    }

    /* ── 点「看余额」那一拍 (2026-11-01, B1-b): 四档与重试 ────────────────── */

    /** 一份够用的快照 (这一节只关心"成功 / 失败 / 不支持"这三档) */
    private fun snapshot(
        at: Long,
        ok: Boolean = true,
        seq: Long = 0L,
        unsupported: Boolean = false,
    ) = BalanceFile.Snapshot(
        at = at,
        seq = seq,
        ok = ok,
        unsupported = unsupported,
        label = "",
        provider = "",
        model = "",
        kind = BalanceFile.KIND_MONEY,
        currency = "CNY",
        value = if (ok) "12.34" else "",
        bonus = "",
        percent = 0,
        reason = if (ok) "" else "fetching the balance failed: timeout",
    )

    /** 判据里的两个时间点: "现在" 与那一档窗口 (与 `OverlayService` 的 `BALANCE_FRESH_MS` 同一个数) */
    private val now = 1_760_000_100_000L
    private val freshMs = BalanceFile.FRESH_MS

    /**
     * ⑤ 的前半截 (2026-11-01 深夜改口径, B1-c 改成 5 分钟): 窗口内的数照旧**直接给**, 但这一下照样
     * 发一次确认请求 —— 主人要的是"点了就刷新, 屏上先给上次那份"
     */
    @Test
    fun `五分钟内的数先上屏, 同时发一次确认请求`() {
        val decision = BalanceFile.decide(
            snapshot(at = now - 30_000),
            askedAt = 0,
            askedSeq = 0,
            freshMs = freshMs,
            now = now,
        )
        assertEquals(BalanceFile.Ask.FRESH, decision.ask)
        assertTrue(decision.request)
        assertFalse(decision.force)
    }

    /** 已经有一问在路上时, 连点不再叠: 8 s 之内只发一次, 答案一到就能再问 (10-4) */
    @Test
    fun `在路上连点不叠请求`() {
        val decision = BalanceFile.decide(
            snapshot(at = now - 400_000, seq = 3L),
            askedAt = now - 1_000,
            askedSeq = 9L,
            freshMs = freshMs,
            now = now,
        )
        assertFalse(decision.request)
    }

    /** ⑤ 的后半截: 过了那 5 分钟, **先给旧值再问** —— 主人点一下要马上看见数, 不能先干等 */
    @Test
    fun `旧值先给旧数, 同时发一个新请求`() {
        val decision = BalanceFile.decide(
            snapshot(at = now - (BalanceFile.FRESH_MS + 120_000)),
            askedAt = 0,
            askedSeq = 0,
            freshMs = freshMs,
            now = now,
        )
        assertEquals(BalanceFile.Ask.OLD, decision.ask)
        assertTrue(decision.request)
        // 这一问是"主人要看", 不是"主人自己按的重试": 不带 force
        assertFalse(decision.force)
    }

    /** ⑥: 手上没有数 (宿主还没写过那份文件) 就是「正在取余额…」, 并且现在就去问 */
    @Test
    fun `没有旧值就是 pending, 并且要请求`() {
        val decision = BalanceFile.decide(null, askedAt = 0, askedSeq = 0, freshMs = freshMs, now = now)
        assertEquals(BalanceFile.Ask.PENDING, decision.ask)
        assertTrue(decision.request)
    }

    /** ⑦⑧: 上一次是失败, 那一行就是重试的入口 —— 这一下**新开一问并带 `force`** */
    @Test
    fun `失败那一份是重试的入口, 新一问带 force`() {
        val decision = BalanceFile.decide(
            snapshot(at = now - 5_000, ok = false, seq = 5L),
            askedAt = 0,
            askedSeq = 0,
            freshMs = freshMs,
            now = now,
        )
        assertEquals(BalanceFile.Ask.RETRY, decision.ask)
        assertTrue(decision.request)
        assertTrue(decision.force)
    }

    /** 「当前模型不支持查询余额」是稳定事实: 重试也问不出数来, 不该每次都绕一圈 */
    @Test
    fun `不支持那一档不进重试`() {
        val decision = BalanceFile.decide(
            snapshot(at = now - 5_000, ok = false, unsupported = true),
            askedAt = 0,
            askedSeq = 0,
            freshMs = freshMs,
            now = now,
        )
        assertEquals(BalanceFile.Ask.UNSUPPORTED, decision.ask)
        assertFalse(decision.request)
    }

    /** 连点 20 次只发一次请求: 那一问还在路上时, 再点只把屏上的话换成「正在取余额…」 */
    @Test
    fun `一问在路上时连点不再写请求`() {
        val askedSeq = 7L
        // 旧值那一档: 旧数照样显示, 但不再写第二笔
        val old = BalanceFile.decide(
            snapshot(at = now - (BalanceFile.FRESH_MS + 120_000), seq = 5L),
            askedAt = now - 1_000,
            askedSeq = askedSeq,
            freshMs = freshMs,
            now = now,
        )
        assertEquals(BalanceFile.Ask.OLD, old.ask)
        assertFalse(old.request)
        // 失败那一档: 重试已经在路上, 这一下只显示「正在取」
        val retry = BalanceFile.decide(
            snapshot(at = now - 5_000, ok = false, seq = 5L),
            askedAt = now - 1_000,
            askedSeq = askedSeq,
            freshMs = freshMs,
            now = now,
        )
        assertEquals(BalanceFile.Ask.PENDING, retry.ask)
        assertFalse(retry.request)
    }

    /**
     * 断网可以在 6.2 s 内重试 (判据 10-3): 那一问的**答案一到就不再算在路上** —— 判的是答案里的
     * `seq`, 不是"距离上一次点击多少秒", 否则 6 s 的网络预算之后主人还要干等
     */
    @Test
    fun `答案到了就能马上再问, 不等那个窗口走完`() {
        val askedSeq = 7L
        val decision = BalanceFile.decide(
            // 宿主 6.2 s 后答了, seq 对得上, 答案是一句失败
            snapshot(at = now - 200, ok = false, seq = askedSeq),
            askedAt = now - 6_200,
            askedSeq = askedSeq,
            freshMs = freshMs,
            now = now,
        )
        assertEquals(BalanceFile.Ask.RETRY, decision.ask)
        assertTrue(decision.request)
        assertTrue(decision.force)
    }

    /** 宿主一直不答 (死了 / 卡住): 过了那一问的预算就不能永远把主人挡在门外 */
    @Test
    fun `宿主一直不答也能再问一次`() {
        val overdue = BalanceFile.decide(
            snapshot(at = now - (BalanceFile.FRESH_MS + 120_000), seq = 5L),
            askedAt = now - (BalanceFile.IN_FLIGHT_MS + 1_000),
            askedSeq = 7L,
            freshMs = freshMs,
            now = now,
        )
        assertEquals(BalanceFile.Ask.OLD, overdue.ask)
        assertTrue(overdue.request)
    }

    /**
     * ⑨ 那条窗口真的接在 5 分钟上 (B1-c): 4 分 59 秒还算正常数, 超过 5 分钟就是旧值 —— 这一条与
     * `isOld` 的边界是同一个数 (`BalanceFile.FRESH_MS`), 服务那一侧只认它
     */
    @Test
    fun `旧值窗口按 5 分钟接上, 边界那一毫秒分得开`() {
        val almost = BalanceFile.decide(
            snapshot(at = now - (BalanceFile.FRESH_MS - 1_000)),
            askedAt = 0,
            askedSeq = 0,
            freshMs = BalanceFile.FRESH_MS,
            now = now,
        )
        assertEquals(BalanceFile.Ask.FRESH, almost.ask)
        val over = BalanceFile.decide(
            snapshot(at = now - (BalanceFile.FRESH_MS + 1)),
            askedAt = 0,
            askedSeq = 0,
            freshMs = BalanceFile.FRESH_MS,
            now = now,
        )
        assertEquals(BalanceFile.Ask.OLD, over.ask)
    }

    /** 上屏只留两位小数 (2026-11-01 主人): 账号缝给的是原始串, 别把二十位小数贴给人看 */
    @Test
    fun `金额上屏只留两位小数`() {
        assertEquals("236.97", BalanceFile.moneyText("236.9677291600000000"))
        assertEquals("12.30", BalanceFile.moneyText("12.3"))
        assertEquals("0.01", BalanceFile.moneyText("0.01"))
        assertEquals("12.34", BalanceFile.moneyText(" 12.34 "))
        // 四舍五入到两位, 不是截断
        assertEquals("0.13", BalanceFile.moneyText("0.125"))
        // 读不成数的原样留着: 那不是 0, 是不认识
        assertEquals("", BalanceFile.moneyText(""))
        assertEquals("n/a", BalanceFile.moneyText("n/a"))
    }
}
