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
 * 两处都要过 [wav] 与 [pieces] 这一对 (前者封字节, 后者按 60 s 切开), 免得拿一段三分钟的话去撞官方
 * 那两条上限
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

    /** RIFF 那块头一共 44 字节 (16 位单声道 PCM: fmt 那一段 16 字节 + 8 字节的 RIFF/WAVE 壳 + 12 字节的 data 头) */
    const val HEADER_BYTES = 44

    /** 每一片最多几个采样 */
    fun chunkSamples(sampleRate: Int = SAMPLE_RATE): Int = sampleRate * CHUNK_SECONDS

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
     * 切的是采样而不是字节: 中途切开一个采样点听到的是咔哒声, 而这一侧拼回去的时候是按整片拼的
     */
    fun pieces(samples: FloatArray, sampleRate: Int = SAMPLE_RATE): List<FloatArray> {
        val limit = chunkSamples(sampleRate)
        if (samples.isEmpty()) return emptyList()
        if (samples.size <= limit) return listOf(samples)
        val pieces = ArrayList<FloatArray>((samples.size + limit - 1) / limit)
        var from = 0
        while (from < samples.size) {
            val to = minOf(from + limit, samples.size)
            pieces += samples.copyOfRange(from, to)
            from = to
        }
        return pieces
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
