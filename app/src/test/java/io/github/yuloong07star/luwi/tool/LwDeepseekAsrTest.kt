package io.github.yuloong07star.luwi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * DeepSeek 官方语音输入那一档的纯算术: wav 怎么封、一段切成几片、回执怎么读 (2.8.1 #6)
 *
 * 不开设备也不联网: 这几处是"宿主说认了, 官方回 400"与"明明有声音却认不出字"最常见的原因 (头少写
 * 44 字节里的一个数、采样按大端写、某一片超过官方那两条上限), 所以先在 JVM 上钉死
 */
class LwDeepseekAsrTest {

    /* ── 两个字面量: 宿主那一侧写的是同一串 ───────────────────────────────── */

    @Test
    fun `端点与回环路由照官方文档写死`() {
        assertEquals("https://api.deepseek.com/v1/tools/asr", LwDeepseekAsr.ENDPOINT)
        assertEquals("/lw-asr", LwDeepseekAsr.ROUTE_PATH)
        // 官方那两条上限: 8 MiB 与 120 s
        assertEquals(8 * 1024 * 1024, LwDeepseekAsr.MAX_BYTES)
        assertEquals(120, LwDeepseekAsr.MAX_SECONDS)
    }

    /* ── wav: 44 字节头 + 小端 PCM16 ─────────────────────────────────────── */

    @Test
    fun `头是那 44 个字节, RIFF WAVE fmt data 都对`() {
        val wav = LwDeepseekAsr.wav(FloatArray(10), LwDeepseekAsr.SAMPLE_RATE)
        assertEquals(LwDeepseekAsr.HEADER_BYTES + 20, wav.size)
        assertEquals("RIFF", String(wav, 0, 4, Charsets.US_ASCII))
        assertEquals("WAVE", String(wav, 8, 4, Charsets.US_ASCII))
        assertEquals("fmt ", String(wav, 12, 4, Charsets.US_ASCII))
        assertEquals("data", String(wav, 36, 4, Charsets.US_ASCII))
        // 16 位单声道: 声道数是 1, 位深是 16, 采样率照给
        assertEquals(1, le16(wav, 22))
        assertEquals(16, le16(wav, 34))
        assertEquals(LwDeepseekAsr.SAMPLE_RATE, le32(wav, 24))
        // 采样率 * 2 的字节率与 2 的块对齐: 官方按内容判断格式, 这两个数错了就整段读不动
        assertEquals(LwDeepseekAsr.SAMPLE_RATE * 2, le32(wav, 28))
        assertEquals(2, le16(wav, 32))
        // 两个长度: RIFF 那个是"后面还有多少字节", data 那个是"数据多少字节"
        assertEquals(wav.size - 8, le32(wav, 4))
        assertEquals(20, le32(wav, 40))
        assertTrue(LwDeepseekAsr.isWav(wav))
    }

    @Test
    fun `采样按小端写成 short, 越界的夹住而不是绕回去`() {
        val wav = LwDeepseekAsr.wav(floatArrayOf(0f, 1f, -1f, 2f, -2f), LwDeepseekAsr.SAMPLE_RATE)
        assertEquals(0, le16(wav, 44))
        assertEquals(32767, le16(wav, 46))
        // -1.0 必须落到 -32768 而不是 -32767: 差一个码在整段里是一声可闻的偏置
        assertEquals(0x8000, le16(wav, 48))
        // 超出的那些夹到边界, 不是绕回去 (绕回去是一声爆响)
        assertEquals(32767, le16(wav, 50))
        assertEquals(0x8000, le16(wav, 52))
        assertEquals(5 * 2, wav.size - LwDeepseekAsr.HEADER_BYTES)
    }

    @Test
    fun `不是 wav 的字节过不了那道门`() {
        assertFalse(LwDeepseekAsr.isWav(ByteArray(0)))
        assertFalse(LwDeepseekAsr.isWav("hello".toByteArray()))
        assertFalse(LwDeepseekAsr.isWav(ByteArray(44) { 0x7f }))
    }

    /* ── 切片: 60 s 一片, 一片不丢, 拼回去还是那一段 ───────────────────────── */

    @Test
    fun `不到一片时就是它自己`() {
        val samples = FloatArray(LwDeepseekAsr.SAMPLE_RATE * 3)
        assertEquals(1, LwDeepseekAsr.pieces(samples).size)
        assertEquals(emptyList<FloatArray>(), LwDeepseekAsr.pieces(FloatArray(0)))
    }

    @Test
    fun `三段 60 秒的话切成三片, 一片不多一片不少`() {
        val samples = FloatArray(LwDeepseekAsr.SAMPLE_RATE * 150) { it.toFloat() }
        val pieces = LwDeepseekAsr.pieces(samples)
        assertEquals(3, pieces.size)
        val limit = LwDeepseekAsr.chunkSamples()
        assertEquals(limit, pieces[0].size)
        assertEquals(30 * LwDeepseekAsr.SAMPLE_RATE, pieces[2].size)
        // 拼回去一个采样都不差 (切在整片上, 不是字节上)
        assertEquals(samples.size, pieces.sumOf { it.size })
        assertEquals(samples[0], pieces[0][0])
        assertEquals(samples[samples.size - 1], pieces[2].last())
        assertEquals(60.0, LwDeepseekAsr.secondsOf(limit), 0.001)
    }

    @Test
    fun `每一片的秒数都在官方两条上限之内`() {
        val limit = LwDeepseekAsr.chunkSamples()
        val seconds = LwDeepseekAsr.secondsOf(limit)
        assertTrue("$seconds s 超过了一片的上限", LwDeepseekAsr.fits(seconds))
        assertFalse(LwDeepseekAsr.fits(150.0))
        // 1.9 MB 量级, 离 8 MiB 很远
        assertTrue(LwDeepseekAsr.HEADER_BYTES + limit * 2 < LwDeepseekAsr.MAX_BYTES)
    }

    /* ── 回执: 成功那一句、失败那一句、时长 ─────────────────────────────── */

    @Test
    fun `成功回执里的那句话与时长都读得出来`() {
        val body = """{"ok":true,"text":"上海今天天气怎么样？","requestId":"req-1","durationMs":3200}"""
        assertEquals("上海今天天气怎么样？", LwDeepseekAsr.textOf(body))
        assertEquals(3200L, LwDeepseekAsr.durationOf(body))
        assertEquals("req-1", LwDeepseekAsr.requestIdOf(body))
        assertNull(LwDeepseekAsr.errorOf(body))
    }

    @Test
    fun `失败回执里是那句人话, 没有 text`() {
        val body = """{"ok":false,"signedIn":false,"error":"not signed in: sign in to the DeepSeek account"}"""
        assertNull(LwDeepseekAsr.textOf(body))
        assertTrue(LwDeepseekAsr.errorOf(body)!!.startsWith("not signed in"))
        assertEquals(0L, LwDeepseekAsr.durationOf(body))
    }

    @Test
    fun `读不懂的回执不抛, 只是没有那句话`() {
        assertNull(LwDeepseekAsr.textOf("not json"))
        assertNull(LwDeepseekAsr.errorOf(""))
        assertNull(LwDeepseekAsr.textOf("""{"ok":true,"text":"   "}"""))
        assertEquals(0L, LwDeepseekAsr.durationOf("""{"durationMs":"abc"}"""))
    }

    /** 小端读一个 16 位无符号 */
    private fun le16(bytes: ByteArray, at: Int): Int =
        (bytes[at].toInt() and 0xff) or ((bytes[at + 1].toInt() and 0xff) shl 8)

    /** 小端读一个 32 位 */
    private fun le32(bytes: ByteArray, at: Int): Int =
        (bytes[at].toInt() and 0xff) or
            ((bytes[at + 1].toInt() and 0xff) shl 8) or
            ((bytes[at + 2].toInt() and 0xff) shl 16) or
            ((bytes[at + 3].toInt() and 0xff) shl 24)
}
