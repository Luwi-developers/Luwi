package io.github.yuloong07star.luwi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * DeepSeek 官方 TTS 那条引擎的纯算术: 音色白名单、请求体、回来的字节配什么后缀、怎么切片
 *
 * 不开设备也不联网: 这几处是"明明登录着却报 400"与"拿回来放不出声"最常见的原因 (字段名按 OpenAI 那套
 * 写成 `input`、音色 id 打错一个字、把 wav 当 mp3), 所以先在 JVM 上钉死
 */
class LwDeepseekSpeechTest {

    /* ── 音色白名单: 官方只认两个 ───────────────────────────────────────── */

    @Test
    fun `官方那两个音色照收`() {
        assertEquals("stella", LwDeepseekSpeech.voiceOf("stella", "tide"))
        assertEquals("tide", LwDeepseekSpeech.voiceOf("tide", "stella"))
        assertTrue(LwDeepseekSpeech.known("stella"))
        assertTrue(LwDeepseekSpeech.known("tide"))
    }

    @Test
    fun `点名的音色官方不认时退回设置页那一份`() {
        assertEquals("tide", LwDeepseekSpeech.voiceOf("nova", "tide"))
        assertEquals(LwDeepseekSpeech.DEFAULT_VOICE, LwDeepseekSpeech.voiceOf("", ""))
        assertFalse(LwDeepseekSpeech.known("nova"))
    }

    @Test
    fun `设置页存了一个怪值时也退回缺省`() {
        assertEquals(LwDeepseekSpeech.DEFAULT_VOICE, LwDeepseekSpeech.voiceOf(null, "  "))
        assertEquals(LwDeepseekSpeech.DEFAULT_VOICE, LwDeepseekSpeech.voiceOf(null, "STELLA"))
    }

    /* ── 请求体: 字段名是官方那三个, 不是 OpenAI 那套 ─────────────────────── */

    @Test
    fun `请求体带 text 与 voice_id 与 wav`() {
        val body = LwDeepseekSpeech.requestBody("你好", "tide")
        assertTrue(body, body.contains("\"text\":\"你好\""))
        assertTrue(body, body.contains("\"voice_id\":\"tide\""))
        assertTrue(body, body.contains("\"format\":\"wav\""))
        assertTrue(body, body.contains("\"filter_markdown\":true"))
        // 官方这条没有语速参数: 带了反而会让这一趟白跑
        assertFalse(body, body.contains("speed"))
        // OpenAI 那套的字段名不该出现在这里 (名字写错就是 400)
        assertFalse(body, body.contains("\"input\""))
    }

    @Test
    fun `请求体里空白音色回落到缺省`() {
        val body = LwDeepseekSpeech.requestBody("hi", "  ")
        assertTrue(body, body.contains("\"voice_id\":\"${LwDeepseekSpeech.DEFAULT_VOICE}\""))
    }

    /* ── 后缀: 官方默认 wav, 认不出也按 wav ──────────────────────────────── */

    @Test
    fun `按 content type 认后缀`() {
        assertEquals("wav", LwDeepseekSpeech.extension("audio/wav"))
        assertEquals("wav", LwDeepseekSpeech.extension("audio/wav; charset=binary"))
        assertEquals("mp3", LwDeepseekSpeech.extension("audio/mpeg"))
        assertEquals("ogg", LwDeepseekSpeech.extension("audio/ogg"))
        // 拿不到类型时宁可猜 wav: 这条接口的缺省就是它
        assertEquals("wav", LwDeepseekSpeech.extension(null))
        assertEquals("wav", LwDeepseekSpeech.extension("application/octet-stream"))
    }

    /* ── 切片: 短稿一片, 长稿切成多片且一片都不丢 ─────────────────────────── */

    @Test
    fun `短稿就是一片`() {
        assertEquals(listOf("一段话"), LwDeepseekSpeech.pieces("一段话"))
        assertEquals(emptyList<String>(), LwDeepseekSpeech.pieces("   "))
    }

    @Test
    fun `长稿切成多片, 拼回去还是原稿`() {
        val text = "第一句话。".repeat(300)
        val pieces = LwDeepseekSpeech.pieces(text)
        assertTrue("切成了 ${pieces.size} 片", pieces.size > 1)
        assertEquals(text, pieces.joinToString(""))
        assertTrue(pieces.all { it.length <= LwDeepseekSpeech.CHUNK_CHARS })
    }
}
