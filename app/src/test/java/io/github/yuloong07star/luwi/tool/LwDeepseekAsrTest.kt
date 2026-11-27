package io.github.yuloong07star.luwi.tool

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.sin

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
    fun `三段 60 秒的话切成三片, 接缝处叠 400 ms`() {
        val samples = FloatArray(LwDeepseekAsr.SAMPLE_RATE * 150) { it.toFloat() }
        val pieces = LwDeepseekAsr.pieces(samples)
        assertEquals(3, pieces.size)
        val overlap = LwDeepseekAsr.overlapSamples()
        assertEquals(6400, overlap)
        assertEquals(0.4, LwDeepseekAsr.secondsOf(overlap), 0.0001)
        val limit = LwDeepseekAsr.chunkSamples()
        val search = LwDeepseekAsr.searchSamples()
        // 切点可以在名义位置前后各 3 s 挪, 于是每一片落在 57 s ~ 63 s 之间
        for (piece in pieces.dropLast(1)) {
            assertTrue("${piece.size} 不在低谷窗里", piece.size in (limit - search)..(limit + search))
        }
        // 去掉重叠之后正好覆盖原段 (每一片都从上一片尾巴里那 400 ms 起)
        val covered = pieces.sumOf { it.size } - overlap * (pieces.size - 1)
        assertEquals(samples.size, covered)
        // 相邻两片首尾那 400 ms 逐采样相同: 那片音频两边各有一份
        for (index in 1 until pieces.size) {
            val tail = pieces[index - 1]
            assertArrayEquals(
                tail.copyOfRange(tail.size - overlap, tail.size),
                pieces[index].copyOfRange(0, overlap),
                0f,
            )
        }
        assertEquals(samples[0], pieces.first()[0])
        assertEquals(samples[samples.size - 1], pieces.last().last())
        assertEquals(60.0, LwDeepseekAsr.secondsOf(limit), 0.001)
    }

    @Test
    fun `切点落在能量低谷, 不在 60 秒那包能量上`() {
        val samples = synthetic()
        val pieces = LwDeepseekAsr.pieces(samples)
        assertEquals(2, pieces.size)
        val cut = pieces[0].size
        // 59 s 那条 V 形低谷是整段里唯一的最低点, 切点就该落在它正中 (前后 50 ms 都算对)
        assertEquals(59.0, LwDeepseekAsr.secondsOf(cut), 0.05)
        // 低谷的能量比 60 s 那包「设置」低一个量级以上: 那是真的避开了, 不是碰巧
        val window = LwDeepseekAsr.windowSamples()
        val atCut = meanSquare(samples, cut - window / 2, window)
        val atBurst = meanSquare(samples, 60 * LwDeepseekAsr.SAMPLE_RATE, window)
        assertTrue("切点 $atCut 不比能量包 $atBurst 低", atCut * 10 < atBurst)
        // 两片都在官方那两条上限之内
        for (piece in pieces) {
            assertTrue(LwDeepseekAsr.secondsOf(piece.size) <= LwDeepseekAsr.MAX_SECONDS)
            assertTrue(LwDeepseekAsr.HEADER_BYTES + piece.size * 2 <= LwDeepseekAsr.MAX_BYTES)
        }
    }

    /* ── 拼接: 重叠处重复的字只留一份 (2.8.1 #28) ─────────────────────────── */

    @Test
    fun `75 秒合成朗读, 两片接回来与原句逐字一致`() {
        val samples = synthetic()
        val pieces = LwDeepseekAsr.pieces(samples)
        val overlap = LwDeepseekAsr.overlapSamples()
        // 每个字 0.2 s: 75 s 正好 375 个字, 重叠那 400 ms 跨两个字
        val total = LwDeepseekAsr.SAMPLE_RATE * 75
        val truth = SENTENCE.repeat(14).take(total / CHAR_SAMPLES)
        assertEquals(375, truth.length)
        val first = spoken(truth, total, 0, pieces[0].size)
        val second = spoken(truth, total, pieces[0].size - overlap, total)
        // 不做去重会多出重叠区那两个音
        assertEquals(2, first.length + second.length - truth.length)
        assertEquals(truth, LwDeepseekAsr.stitch(first, second))
    }

    @Test
    fun `对不上时只留一个空格, 命中的那截剪掉`() {
        // 这两句在 400 ms 里确实是同一段音频: 上一片的结尾就是下一片的开头
        assertEquals("先打开设置 然后", LwDeepseekAsr.stitch("先打开设置", "然后"))
        assertEquals("先把代理改成手动，最后保存", LwDeepseekAsr.stitch("先把代理改成手动，", "手动，最后保存"))
        // 空格只留一个, 不叠成两个
        assertEquals("保存，最后", LwDeepseekAsr.stitch("保存 ", "保存，最后"))
        assertEquals("", LwDeepseekAsr.stitch("", ""))
    }

    /** 同一段合成音频两边各一份: 75 s, 59 s 处一条 V 形低谷, 60 s 处一包「设置」的能量 */
    private fun synthetic(
        sampleRate: Int = LwDeepseekAsr.SAMPLE_RATE,
        seconds: Int = 75,
    ): FloatArray {
        val total = sampleRate * seconds
        val samples = FloatArray(total)
        for (index in 0 until total) {
            val at = index.toDouble() / sampleRate
            var amplitude = 0.35
            val away = abs(at - 59.0)
            if (away < 0.5) amplitude = 0.02 + 0.6 * away
            if (at >= 60.0 && at < 60.2) amplitude = 0.9
            samples[index] = (amplitude * sin(2 * Math.PI * 180.0 * at)).toFloat()
        }
        return samples
    }

    /** 一个窗口里的均方 (与切点判据同一个量) */
    private fun meanSquare(samples: FloatArray, from: Int, window: Int): Double {
        var sum = 0.0
        for (index in from until from + window) {
            val value = samples[index].toDouble()
            sum += value * value
        }
        return sum / window
    }

    /** 这一段里被"听见"的那几个字: 与 [from, to) 有交集的字都算 (交叠处两边各听见一次) */
    private fun spoken(truth: String, total: Int, from: Int, to: Int): String {
        val per = total / truth.length
        val said = StringBuilder()
        for (index in truth.indices) {
            if ((index + 1) * per > from && index * per < to) said.append(truth[index])
        }
        return said.toString()
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

    private companion object {

        /** 真机那一段 75 s 朗读的原文 (验收用的就是这一句) */
        const val SENTENCE = "先打开设置，再点 WLAN，然后把代理改成手动，最后保存"

        /** 合成音频里一个字占 0.2 s: 重叠那 400 ms 正好跨两个字 (与 tools/check-voice-asr.mjs 同一份真值) */
        const val CHAR_SAMPLES = 3200
    }
}
