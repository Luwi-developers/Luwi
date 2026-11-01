package io.github.yuloong07star.luwi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 卡上音色的前缀 (2026-10-29): `sys:` / `dev:` / `edge:` / `api:` 各指一条引擎
 *
 * 老写法 (没有前缀, 比如 `zh@zh-CN`) 必须仍然被当成"引擎跟设置页" —— 已经存过的卡不能因为这次改动
 * 换一个声音
 */
class LwSpeakVoiceRefTest {

    @Test
    fun `no prefix keeps the old behaviour`() {
        val ref = LwSpeak.parseVoiceRef("zh@zh-CN")
        assertNull(ref.engine)
        assertEquals("zh@zh-CN", ref.voice)
    }

    @Test
    fun `blank is blank`() {
        val ref = LwSpeak.parseVoiceRef("  ")
        assertNull(ref.engine)
        assertEquals("", ref.voice)
    }

    @Test
    fun `each prefix picks its engine`() {
        assertEquals(SpeakSettings.Engine.SYSTEM, LwSpeak.parseVoiceRef("sys:zh@zh-CN").engine)
        assertEquals("zh@zh-CN", LwSpeak.parseVoiceRef("sys:zh@zh-CN").voice)
        assertEquals(SpeakSettings.Engine.ON_DEVICE, LwSpeak.parseVoiceRef("dev:model-a").engine)
        assertEquals("model-a", LwSpeak.parseVoiceRef("dev:model-a").voice)
        assertEquals(SpeakSettings.Engine.EDGE, LwSpeak.parseVoiceRef("edge:zh-CN-XiaoxiaoNeural").engine)
        assertEquals(SpeakSettings.Engine.API, LwSpeak.parseVoiceRef("api:luwi-soft-01").engine)
        assertEquals("luwi-soft-01", LwSpeak.parseVoiceRef("api:luwi-soft-01").voice)
    }

    @Test
    fun `unknown prefix stays raw`() {
        val ref = LwSpeak.parseVoiceRef("web:something")
        assertNull(ref.engine)
        assertEquals("web:something", ref.voice)
    }
}
