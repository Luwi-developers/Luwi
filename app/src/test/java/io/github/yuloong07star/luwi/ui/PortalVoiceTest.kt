package io.github.yuloong07star.luwi.ui

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 门户那颗「按住 说话」的纯算术 (2026-11-20; 2.8.1 #F10 跟着实时文字层一起抬上限)
 *
 * 三层都在这一份里钉住: **上限** (300 s / 12 MB, 与 `client.js` 的 `VOICE_MAX_MS` 同一个数;
 * 流式节拍 1500 ms, 与 `VOICE_CHUNK_MS` 同一个数)、**wav 认不认** (页面封的头不对时先在这里拦下,
 * 而不是让 `LwSpeech` 抛一句更难懂的话)、**回执长什么样** (页面拿 `{ok, id, error}` 三个字段认人,
 * 少一个就是"按了半天没反应")。
 *
 * 不碰设备、不碰 Android 资源: 这几个函数是纯的
 */
class PortalVoiceTest {

    /* ── 上限 ─────────────────────────────────────────────────────────────── */

    @Test
    fun `三百秒与十二兆是同一档`() {
        assertEquals(300, PortalVoice.MAX_SECONDS)
        assertEquals(12 * 1024 * 1024, PortalVoice.MAX_BYTES)
        // 300 s × 16 kHz × 2 B 是 9.6 MB, 落在上限之内 (再宽一点就到闸上)
        assertTrue(300 * 16000 * 2 <= PortalVoice.MAX_BYTES)
        // 流式那一块的节拍与页面同一个数 (0 = 关掉流式, 页面一块都不送)
        assertEquals(1500, PortalVoice.VOICE_CHUNK_MS)
        // 一块 1.5 s 的 PCM16 约 48 KB, 上限 1 MB 够宽 (超了只可能是页面封错了头)
        assertTrue(1500 * 16000 / 1000 * 2 < PortalVoice.CHUNK_BYTES)
    }

    /* ── 文件名 ───────────────────────────────────────────────────────────── */

    @Test
    fun `文件名带那一趟的编号`() {
        assertEquals("say-7.wav", PortalVoice.wavName(7))
        assertTrue(PortalVoice.wavName(0).endsWith(".wav"))
        // 流式那一块的文件名带"趟号 + 块号": 同一趟里块与块不会撞名 (executor 单线程, 但别留坑)
        assertEquals("chunk-7-12.wav", PortalVoice.chunkName(7, 12))
    }

    /* ── base64 ───────────────────────────────────────────────────────────── */

    @Test
    fun `base64 解得开就是那几个字节`() {
        val bytes = byteArrayOf(1, 2, 3, 4)
        val encoded = Base64.getEncoder().encodeToString(bytes)
        val decoded = PortalVoice.decode(encoded)
        assertNotNull(decoded)
        assertEquals(4, decoded!!.size)
        assertEquals(2, decoded[1].toInt())
        // 换行与空白照收 (页面那边分段拼过一串, 偶尔会带换行)
        assertEquals(4, PortalVoice.decode("AQID\nBA==")!!.size)
    }

    @Test
    fun `解不出采样的那些一律判死`() {
        // 空串 / 全是噪声解出来是空数组: 落不到 isWav 那一关之后
        for (junk in listOf("", "!!!!", "data:audio/wav;base64,")) {
            val bytes = PortalVoice.decode(junk)
            assertTrue("「" + junk + "」不该被当成 wav", bytes == null || !PortalVoice.isWav(bytes))
        }
    }

    /* ── wav 头 ───────────────────────────────────────────────────────────── */

    @Test
    fun `只认 RIFF WAVE 且有采样`() {
        assertTrue(PortalVoice.isWav(wav(samples = 8)))
        assertFalse("只有头不行", PortalVoice.isWav(wav(samples = 0)))
        assertFalse("短于 44 字节不行", PortalVoice.isWav(ByteArray(20)))
        val broken = wav(samples = 8)
        broken[0] = 'X'.code.toByte()
        assertFalse(PortalVoice.isWav(broken))
    }

    /* ── 回执 ─────────────────────────────────────────────────────────────── */

    @Test
    fun `拒绝那一句带 id 与原因`() {
        val answer = PortalVoice.refusal(3, "录音解不开")
        assertEquals(false, answer.optBoolean("ok"))
        assertEquals(3, answer.optInt("id"))
        assertEquals("录音解不开", answer.optString("error"))
    }

    @Test
    fun `异常的说话不许空着`() {
        assertEquals("boom", PortalVoice.failureOf(IllegalStateException("boom")))
        assertEquals("这一句没认出来", PortalVoice.failureOf(IllegalStateException("")))
        assertEquals("这一句没认出来", PortalVoice.failureOf(RuntimeException()))
    }

    @Test
    fun `常见的三档翻成人话, 其余的截短`() {
        // 真机 2026-11-20 读到的那一句就是这一档 (账号口令失效)
        assertEquals(
            "语音口令不对: 设置 → 账号里重新登录",
            PortalVoice.friendly(
                "the DeepSeek speech input answered 401: {\"error\":{\"message\":\"Authentication Fails\"}}",
            ),
        )
        assertEquals("还没登录: 设置 → 账号", PortalVoice.friendly("not signed in"))
        assertEquals(
            "语音模型还没下: 设置 → 唤醒 → 语音模型",
            PortalVoice.friendly("the SenseVoice model is not downloaded yet"),
        )
        assertEquals("语音那条路连不上: 稍后再试", PortalVoice.friendly("the route could not be reached"))
        val long = "x".repeat(120)
        assertEquals(41, PortalVoice.friendly(long).length)
    }

    /** 一段最小的 16 kHz 单声道 PCM16 wav (判据只认头与长度) */
    private fun wav(samples: Int): ByteArray {
        val data = samples * 2
        val bytes = ByteArray(44 + data)
        val view = java.nio.ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        fun ascii(offset: Int, text: String) {
            for (index in text.indices) bytes[offset + index] = text[index].code.toByte()
        }
        ascii(0, "RIFF")
        view.putInt(4, 36 + data)
        ascii(8, "WAVE")
        ascii(12, "fmt ")
        view.putInt(16, 16)
        view.putShort(20, 1)
        view.putShort(22, 1)
        view.putInt(24, 16000)
        view.putInt(28, 32000)
        view.putShort(32, 2)
        view.putShort(34, 16)
        ascii(36, "data")
        view.putInt(40, data)
        return bytes
    }
}
