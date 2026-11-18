package io.github.yuloong07star.luwi.tool

import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 「DeepSeek 官方语音输入」那一档的纯算术: 端点、wav 怎么封、一段切成几片、回执怎么读 (2.8.1 #6)
 *
 * 与 [LwDeepseekSpeech] 同一个理由单独立一份: 这几处最容易错 (少写 `RIFF` 头那 44 个字节、把
 * 16 kHz 的采样当 44.1 kHz 算秒数、某一片超过官方 8 MiB), 而它们都不碰安卓也不碰网络, 所以 JVM 单测
 * 能直接量 (见 LwDeepseekAsrTest)
 *
 * 接口是 DeepSeek 官方那一条 (`POST /v1/tools/asr`, 与合成是同一天开放的那一组工具接口):
 *
 * ```
 * 请求: multipart/form-data, file 字段是一段 16 位 PCM WAV (8 / 16 / 22.05 / 24 / 32 / 44.1 / 48 kHz 都收)
 *       头: Authorization: Bearer <令牌>
 * 回来: {"request_id":"…","text":"上海今天天气怎么样？","duration_ms":3200}
 * 限制: 一次最长 120 s, 文件最大 8 MiB, 没有语种参数 (它自己认)
 * ```
 *
 * **令牌不在这里**: 账号那枚令牌只活在宿主进程里 (dsh 的 `deepseekAccount`), 应用这一侧拿到的是那句
 * 话 —— 于是这一档的请求先走宿主自己那条回环路由 ([ROUTE_PATH]), 由宿主带上令牌再去打官方接口。
 * 应用偏好里**一个字符的令牌都没有**
 *
 * 常驻链交上来的是**内存里的采样** (`FloatArray`, 16 kHz), 界面那条交上来的是**一个 wav 文件**;
 * 两处都要过 [wav] 与 [pieces] 这一对 (前者封字节, 后者按 60 s 切开并在接缝上叠 400 ms), 免得拿一段
 * 三分钟的话去撞官方那两条上限
 */
internal object LwDeepseekAsr {

    /**
     * 官方那条语音识别接口
     *
     * 只用来**拼文档与报读数**; 真正的请求由宿主发 (它才有令牌)。宿主那一侧写的是同一串
     * (见 `host-plugin/index.mjs` 的 `LW_ASR_ENDPOINT`)
     */
    const val ENDPOINT = "https://api.deepseek.com/v1/tools/asr"

    /** 宿主那条回环路由: 应用把 wav 字节交给它, 拿回来的是一句话 */
    const val ROUTE_PATH = "/lw-asr"

    /** 常驻链与切段器都按这个采样率, 别处对不上就是别处错 */
    const val SAMPLE_RATE = 16000

    /** 官方对文件的上限; 我们按片切, 所以真正发出去的远小于它 */
    const val MAX_BYTES = 8 * 1024 * 1024

    /** 官方一次最长 120 s 音频 */
    const val MAX_SECONDS = 120

    /**
     * 一片多少秒
     *
     * 取官方上限的一半: 一段三分钟的话切成 60 / 60 / 60 三片, 每片约 1.9 MB —— 既在 8 MiB 与 120 s
     * 之内, 也让"回执里那一句"与音频对得上号
     */
    const val CHUNK_SECONDS = 60

    /**
     * 相邻两片叠多长 (2.8.1 #28)
     *
     * 切点落到能量低谷也仍是一刀: 边界那两个字的韵母两边各听见半截, 于是相邻两片在这 400 ms 上是同一
     * 段音频, 拼的时候再按识别文本把重复的那一截剪掉 (见 [stitch])
     */
    const val PIECE_OVERLAP_MS = 400

    /** 找低谷的搜索半径: 名义切点前后各这么多毫秒 (2.8.1 #28) */
    const val CUT_SEARCH_MS = 3_000

    /** 低谷窗多长: 300 ms 里 RMS 最低的那一处才算两句话之间的缝 (2.8.1 #28) */
    const val CUT_WINDOW_MS = 300

    /** 扫低谷的步长: 10 ms, 16 kHz 下 160 个采样 */
    const val CUT_STEP_MS = 10

    /** 拼接时最多往两边看几个字 (400 ms 的中文大约两三个字, 留一倍余量) */
    const val SEAM_CHARS = 6

    /** RIFF 那块头一共 44 字节 (16 位单声道 PCM: fmt 那一段 16 字节 + 8 字节的 RIFF/WAVE 壳 + 12 字节的 data 头) */
    const val HEADER_BYTES = 44

    /** 每一片最多几个采样 */
    fun chunkSamples(sampleRate: Int = SAMPLE_RATE): Int = sampleRate * CHUNK_SECONDS

    /** 相邻两片叠几个采样 (16 kHz 下 6400) */
    fun overlapSamples(sampleRate: Int = SAMPLE_RATE): Int =
        (sampleRate.toLong() * PIECE_OVERLAP_MS / 1000L).toInt()

    /** 切点允许从名义位置前后挪多少采样 (3 s) */
    fun searchSamples(sampleRate: Int = SAMPLE_RATE): Int = sampleRate * CUT_SEARCH_MS / 1000

    /** 低谷窗多长 (300 ms) */
    fun windowSamples(sampleRate: Int = SAMPLE_RATE): Int = sampleRate * CUT_WINDOW_MS / 1000

    /** 扫低谷每步几个采样 (10 ms, 至少 1, 否则原地打转) */
    fun stepSamples(sampleRate: Int = SAMPLE_RATE): Int = maxOf(1, sampleRate * CUT_STEP_MS / 1000)

    /** 这么多采样是几秒 (报读数与判上限都用它) */
    fun secondsOf(samples: Int, sampleRate: Int = SAMPLE_RATE): Double =
        if (sampleRate <= 0) 0.0 else samples.toDouble() / sampleRate

    /**
     * 把内存里那一段采样封成 16 位单声道 PCM 的 wav
     *
     * 纯函数: 头是固定的 44 字节 (RIFF / WAVE / fmt / data), 采样按小端写成 Short —— 超出 ±1 的那些
     * 夹到边界上而不是绕回去 (绕回去是一声爆响), 而 `-1.0` 必须落到 `-32768` 而不是 `-32767`     */
    fun wav(samples: FloatArray, sampleRate: Int = SAMPLE_RATE): ByteArray {
        val dataBytes = samples.size * 2
        val out = ByteArrayOutputStream(HEADER_BYTES + dataBytes)
        fun le32(value: Int) {
            out.write(value and 0xff)
            out.write((value shr 8) and 0xff)
            out.write((value shr 16) and 0xff)
            out.write((value shr 24) and 0xff)
        }
        fun le16(value: Int) {
            out.write(value and 0xff)
            out.write((value shr 8) and 0xff)
        }
        out.write('R'.code)
        out.write('I'.code)
        out.write('F'.code)
        out.write('F'.code)
        le32(HEADER_BYTES - 8 + dataBytes)
        out.write('W'.code)
        out.write('A'.code)
        out.write('V'.code)
        out.write('E'.code)
        out.write('f'.code)
        out.write('m'.code)
        out.write('t'.code)
        out.write(' '.code)
        le32(16)
        le16(1)
        le16(1)
        le32(sampleRate)
        le32(sampleRate * 2)
        le16(2)
        le16(16)
        out.write('d'.code)
        out.write('a'.code)
        out.write('t'.code)
        out.write('a'.code)
        le32(dataBytes)
        for (sample in samples) {
            // 满量程按 32768 那一侧算: 于是 -1.0 落到 -32768 (只用 32767 会把它写成 -32767, 整段偏一个码),
            // 而 +1.0 与越界的那些夹到 32767
            val scaled = (sample.coerceIn(-1f, 1f) * 32768f).roundToInt().coerceIn(-32768, 32767)
            le16(scaled and 0xffff)
        }
        return out.toByteArray()
    }

    /**
     * 这一段按 [CHUNK_SECONDS] 切成几片 (不够一片时就是它自己)
     *
     * 与 2.8.1 #28 之前的硬切比, 两件事变了:
     *   1. 切点不再钉死在 60 s 上, 而是在名义切点前后各 [CUT_SEARCH_MS] 里找一段 [CUT_WINDOW_MS]
     *      的 RMS 最低点 —— 60 s 那一刀常常正落在一个字上, 那个字两边各认半截, 谁都认不出来
     *   2. 相邻两片按 [PIECE_OVERLAP_MS] 重叠: 下一片从切点**往前** 400 ms 起, 于是边界那句在两片
     *      里都完整, 拼回去时再剪掉重复的那一截 (见 [stitch])
     *
     * 采样本身一片不少: 重叠的那 400 ms 在相邻两片里各有一份, 所以"拼采样"不再等于原长 (原先那条
     * 判据是零重叠时代的), 判据改成"每一片首尾相接 + 去掉重叠正好覆盖原段"
     */
    fun pieces(samples: FloatArray, sampleRate: Int = SAMPLE_RATE): List<FloatArray> {
        val limit = chunkSamples(sampleRate)
        if (samples.isEmpty()) return emptyList()
        if (samples.size <= limit) return listOf(samples)
        val overlap = overlapSamples(sampleRate)
        val pieces = ArrayList<FloatArray>((samples.size + limit - 1) / limit)
        var from = 0
        while (from + limit < samples.size) {
            val nominal = from + limit
            // 窗口不越出这一段: 末尾只剩几秒时搜到边界就停
            val low = maxOf(from + 1, nominal - searchSamples(sampleRate))
            val high = minOf(samples.size - 1, nominal + searchSamples(sampleRate))
            val cut = quietCut(samples, low, high, windowSamples(sampleRate), stepSamples(sampleRate))
                .coerceIn(low, high)
            pieces += samples.copyOfRange(from, cut)
            // 下一片从切点往前 overlap 起; 至少往前一步, 否则原地打转
            from = maxOf(cut - overlap, from + 1)
        }
        pieces += samples.copyOfRange(from, samples.size)
        return pieces
    }

    /**
     * 在 `[low, high]` 里找一段 [window] 个采样的能量最低点 (2.8.1 #28)
     *
     * 比的是均方 (RMS 不开方也一样的排序, 少一次 sqrt), 返回那个窗口的**中线** —— 切在窗口正中,
     * 两边各留半个窗的余地; 都差不多时取最早的那一处, 于是同样的采样永远切在同一处 (判据钉得住)
     */
    fun quietCut(samples: FloatArray, low: Int, high: Int, window: Int, step: Int): Int {
        if (high <= low) return low
        val span = minOf(window, high - low + 1).coerceAtLeast(1)
        val stride = maxOf(1, step)
        var bestAt = low
        var best = Double.MAX_VALUE
        var at = low
        val last = high - span + 1
        while (at <= last) {
            var sum = 0.0
            for (index in at until at + span) {
                val value = samples[index].toDouble()
                sum += value * value
            }
            if (sum < best) {
                best = sum
                bestAt = at
            }
            at += stride
        }
        return bestAt + span / 2
    }

    /**
     * 把上一片与下一片的识别文本按重叠区拼起来 (2.8.1 #28)
     *
     * 相邻两片有 400 ms 是同一段音频, 于是那两三个字在两边各出现一次: 先看上一片的结尾是不是正好就是
     * 下一片开头那几个字 (从长到短试, 最多 [SEAM_CHARS]), 命中就把下一片那一截剪掉; 连两个字都对不上
     * (两片都把这半句认成了别的) 时只留一个空格 —— 与 2.8.1 #28 之前的接法一致, 宁可多一个空格也不猜
     */
    fun stitch(previous: String, next: String): String {
        if (previous.isEmpty()) return next
        if (next.isEmpty()) return previous
        val tail = previous.trimEnd()
        val head = next.trimStart()
        val room = minOf(SEAM_CHARS, tail.length, head.length)
        for (length in room downTo 2) {
            if (tail.endsWith(head.substring(0, length))) {
                return tail + next.substring(next.length - head.length + length)
            }
        }
        return "$previous $next"
    }

    /** 这一片封好之后是不是还在官方那条 8 MiB 之内 (按秒算, 不真去封) */
    fun fits(seconds: Double): Boolean = seconds <= MAX_SECONDS && seconds <= CHUNK_SECONDS

    /**
     * 宿主回执里那一句话
     *
     * 宿主成功时回 `{"ok":true,"text":"…","requestId":"…","durationMs":3200}`, 失败回
     * `{"ok":false,"error":"…"}`; 这里只取成功那一种, 其余回 null —— 失败那句由 [errorOf] 负责
     */
    fun textOf(routeAnswer: String): String? = field(routeAnswer, "text")

    /** 宿主回执里那一句失败原因 (没有就是 null) */
    fun errorOf(routeAnswer: String): String? = field(routeAnswer, "error")

    /** 回执里 `durationMs` 那个数 (官方按音频时长计费, 报读数要用它) */
    fun durationOf(routeAnswer: String): Long =
        field(routeAnswer, "durationMs")?.toLongOrNull() ?: 0L

    /** 回执里 `requestId` (排查一次具体请求时才有用的那个) */
    fun requestIdOf(routeAnswer: String): String = field(routeAnswer, "requestId").orEmpty()

    /** 这一段字节看起来是不是一个 wav (与宿主那道门同一个判据) */
    fun isWav(bytes: ByteArray): Boolean {
        if (bytes.size < 12) return false
        return bytes[0] == 'R'.code.toByte() && bytes[1] == 'I'.code.toByte()
            && bytes[2] == 'F'.code.toByte() && bytes[3] == 'F'.code.toByte()
            && bytes[8] == 'W'.code.toByte() && bytes[9] == 'A'.code.toByte()
            && bytes[10] == 'V'.code.toByte() && bytes[11] == 'E'.code.toByte()
    }

    /** 从那份 JSON 里取一个字符串字段: 拆不动就 null (不抛, 调用方据此说"回执没读懂") */
    private fun field(json: String, key: String): String? {
        val parsed = runCatching {
            Json.parseToJsonElement(json) as? JsonObject
        }.getOrNull() ?: return null
        val value = parsed[key] as? JsonPrimitive ?: return null
        return value.content.takeIf { it.isNotBlank() }
    }
}
