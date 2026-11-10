package io.github.yuloong07star.luwi.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 连接接口的判定与形状
 *
 * 真机上造一个「不同签名」的调用方成本太高, 所以拒绝那几条路径在这里钉住; 真机只负责验
 * 「同签名能通」与「服务真的挂上了」
 */
class LinkTest {

    private val sameSign = LinkGrants.LinkCaller(uid = 10123, packageName = "com.luwi.companion", sameSignature = true)

    private val otherSign = sameSign.copy(uid = 10456, packageName = "com.example.other", sameSignature = false)

    @Test
    fun describeNamesTheApiAndTheOpenScope() {
        val json = LinkScope.describeJson()
        assertTrue(json.contains("\"api\":\"lw-link/1\""))
        assertTrue(json.contains("\"id\":\"state.read\""))
        assertTrue(json.contains("\"snapshot\""))
        // 还没开的那几个要写出来, 免得打电话的人以为是自己写错了
        assertTrue(json.contains("prompt.write"))
    }

    @Test
    fun lookupOnlyKnowsTheOpenScope() {
        assertNotNull(LinkScope.of("state.read"))
        assertNull(LinkScope.of("prompt.write"))
        assertNull(LinkScope.of(""))
        assertNull(LinkScope.of("state.read "))
    }

    @Test
    fun unknownScopeIsRefusedBeforeAnythingElse() {
        val decision = LinkGrants.decide(otherSign, null, "snapshot", nowMs = 0L, used = 99)
        assertEquals("unknown-scope", (decision as LinkDecision.Deny).code)
    }

    @Test
    fun unknownMethodIsRefused() {
        val decision = LinkGrants.decide(sameSign, LinkScope.STATE_READ, "开灯", nowMs = 0L, used = 0)
        assertEquals("unknown-method", (decision as LinkDecision.Deny).code)
        assertTrue(decision.because.contains("snapshot"))
    }

    @Test
    fun anotherCertificateIsRefused() {
        val decision = LinkGrants.decide(otherSign, LinkScope.STATE_READ, "snapshot", nowMs = 0L, used = 0)
        assertEquals("not-same-signature", (decision as LinkDecision.Deny).code)
    }

    @Test
    fun burstIsCappedPerWindow() {
        val ok = LinkGrants.decide(sameSign, LinkScope.STATE_READ, "snapshot", nowMs = 0L, used = 29)
        assertEquals(LinkDecision.Allow, ok)
        val over = LinkGrants.decide(sameSign, LinkScope.STATE_READ, "snapshot", nowMs = 0L, used = 30)
        assertEquals("too-many", (over as LinkDecision.Deny).code)
    }

    @Test
    fun counterCountsThenResetsWithTheWindow() {
        val counter = LinkGrants.Counter(windowMs = 1_000L)
        assertEquals(0, counter.take(7, nowMs = 0L))
        assertEquals(1, counter.take(7, nowMs = 10L))
        assertEquals(2, counter.take(7, nowMs = 20L))
        // 另一个 uid 自己一份, 不互相影响
        assertEquals(0, counter.take(8, nowMs = 30L))
        // 窗口一过从头算
        assertEquals(0, counter.take(7, nowMs = 1_100L))
    }

    @Test
    fun auditLineCarriesTheVerdictAndFlattensNewlines() {
        val allow = LinkAudit.line(
            at = "2026-11-10T19:20:00.000+0800",
            caller = sameSign,
            scope = "state.read",
            method = "snapshot",
            decision = LinkDecision.Allow,
            ms = 3L,
        )
        assertTrue(allow.contains("uid=10123"))
        assertTrue(allow.contains("pkg=com.luwi.companion"))
        assertTrue(allow.contains("ok=true"))
        assertTrue(allow.contains("ms=3"))
        assertEquals(allow.count { it == '\n' }, 0)

        val deny = LinkAudit.line(
            at = "2026-11-10T19:20:00.000+0800",
            caller = otherSign,
            scope = null,
            method = "snapshot\nsecond line",
            decision = LinkDecision.Deny("unknown-scope", "no such scope\nreally"),
            ms = 1L,
        )
        assertTrue(deny.contains("ok=false"))
        assertTrue(deny.contains("code=unknown-scope"))
        assertTrue(deny.contains("scope=-"))
        // 一条记录只能占一行
        assertEquals(deny.count { it == '\n' }, 0)
        assertTrue(deny.contains("second line"))
    }

    @Test
    fun snapshotJsonKeepsNullsApartFromFalse() {
        val json = LinkSnapshot(
            appVersion = "2.8.0",
            appCode = 19L,
            hostStamp = null,
            nodeMb = 65L,
            channelConnected = null,
            channelBackend = null,
            accessibilityRunning = false,
            screenCount = 0,
            screenDisplayId = null,
            screenWidth = null,
            screenHeight = null,
            screenDpi = null,
            storageFreeMb = 47578L,
        ).toJson()
        assertTrue(json.contains("\"app\":\"2.8.0\""))
        assertTrue(json.contains("\"host\":null"))
        assertTrue(json.contains("\"connected\":null"))
        assertTrue(json.contains("\"accessibility\":false"))
        assertTrue(json.contains("\"count\":0"))
        assertTrue(json.contains("\"storageFreeMb\":47578"))
    }
}
