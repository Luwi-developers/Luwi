package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.util.Log
import io.github.yuloong07star.luwi.host.DshHost
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * 「DeepSeek 官方语音输入」那条链: 把一段 wav 交给**宿主**那条回环路由, 拿回一句话
 *
 * 与 [LwDeepseekTts] 完全对称的一站, 理由也一样 (2026-11-15, 2.8.1 #6): 官方那条接口要
 * `Authorization: Bearer <令牌>`, 而账号那枚令牌只活在宿主进程里 (dsh 的
 * `deepseekAccount.resolveToken`) —— 应用这一侧没有它, 也不该有它
 *
 * ```
 * 应用 (这里)                宿主 (host-plugin 的 /lw-asr)              官方
 *   POST wav 字节     →   取令牌 (账号 → 没登录就用那把 API Key)  →   POST /v1/tools/asr
 *   收到 {"text":…}   ←   text / requestId / durationMs 转回来      ←   {"request_id","text","duration_ms"}
 * ```
 *
 * **什么时候走这一条由调用方定** (`LwSpeech` 按 `lw/voice-source.json` 那一份选择分岔), 这里只管
 * "把这一段发出去、把那句话拿回来"; 半双工、切段、投递都不在这一层
 *
 * 两次重试只对**网络抖动**发生一次: 宿主自己给的原因 (没登录 / 官方 4xx) 不重试 —— 同一段音频再发
 * 一遍只多花一次钱
 */
internal object LwDeepseekTranscribe {

    /** 一次转写的结果: 那一句话, 以及官方报的音频时长 (按秒计费用它) */
    class Answer(val text: String, val durationMs: Long, val requestId: String)

    /** 宿主那边说"这一趟不行": 话已经是一句人话, 逐字往外带 */
    private class RouteError(message: String) : IllegalStateException(message)

    /**
     * 把内存里那一段采样认成一句话
     *
     * 按 [LwDeepseekAsr.CHUNK_SECONDS] 切片, 一片一问, 回来按顺序接起来 (片与片之间一个空格, 中文
     * 那一侧不影响阅读)。任何一片失败就整段失败: 半句接上半句比"没认出来"更难查
     */
    fun text(context: Context, samples: FloatArray): String {
        val pieces = LwDeepseekAsr.pieces(samples)
        if (pieces.isEmpty()) return ""
        val said = StringBuilder()
        for (piece in pieces) {
            val answer = answer(context, LwDeepseekAsr.wav(piece))
            if (answer.text.isBlank()) continue
            if (said.isNotEmpty()) said.append(' ')
            said.append(answer.text)
        }
        return said.toString()
    }

    /** 认一段已经封好的 wav (界面那条麦克风与 `lw_speech op=transcribe` 走它) */
    fun answer(context: Context, wav: ByteArray): Answer {
        if (wav.isEmpty()) throw RouteError("there is nothing to transcribe: the recording is empty")
        if (!LwDeepseekAsr.isWav(wav)) {
            throw RouteError("the recording is not a 16-bit PCM WAV")
        }
        var attempt = 0
        while (true) {
            attempt += 1
            try {
                return answerOnce(wav)
            } catch (error: Throwable) {
                // 宿主自己给的原因 (没登录 / 官方 4xx) 不重试
                if (error is RouteError || attempt >= MAX_ATTEMPTS) throw error
                Log.i(TAG, "attempt $attempt failed (${error.message}), retrying once")
                try {
                    Thread.sleep(RETRY_DELAY_MS)
                } catch (interrupted: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw error
                }
            }
        }
    }

    private fun answerOnce(wav: ByteArray): Answer {
        val connection = URL(endpoint()).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "audio/wav")
            connection.outputStream.use { stream -> stream.write(wav) }
            val code = connection.responseCode
            if (code !in 200..299) {
                val detail = runCatching {
                    connection.errorStream?.use { stream ->
                        stream.readBytes().decodeToString().take(MAX_ERROR_CHARS)
                    }
                }.getOrNull().orEmpty()
                throw RouteError(routeMessage(code, detail))
            }
            val body = connection.inputStream.use { readCapped(it) }.decodeToString()
            val text = LwDeepseekAsr.textOf(body)
                ?: throw RouteError(routeMessage(code, body))
            return Answer(
                text = text,
                durationMs = LwDeepseekAsr.durationOf(body),
                requestId = LwDeepseekAsr.requestIdOf(body),
            )
        } finally {
            runCatching { connection.disconnect() }
        }
    }

    /**
     * 宿主回的那一段错话拆成一句人话
     *
     * 宿主给的是 `{"ok":false,"error":"…"}`; 拆不动就把整段原文带出去 (它是我们自己那一路的话, 不含令牌)
     */
    private fun routeMessage(code: Int, detail: String): String {
        val said = LwDeepseekAsr.errorOf(detail)
        if (said != null) return said
        return "the host answered $code" + if (detail.isBlank()) "" else ": $detail"
    }

    /** 宿主那条路由的地址: 回环 + host 那个固定口 (`DshHost.PORT`), 不猜、不扫 */
    private fun endpoint(): String = "http://127.0.0.1:${DshHost.PORT}${LwDeepseekAsr.ROUTE_PATH}"

    /** 读回来但夹住上限: 一句转写只有几 KB, 一个失控的响应不该把内存吃掉 */
    private fun readCapped(stream: InputStream): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val chunk = ByteArray(1 shl 14)
        while (true) {
            val read = stream.read(chunk)
            if (read <= 0) break
            if (out.size() + read > MAX_ANSWER_BYTES) {
                throw RouteError("the answer is larger than ${MAX_ANSWER_BYTES / 1024} KB")
            }
            out.write(chunk, 0, read)
        }
        return out.toByteArray()
    }

    private const val TAG = "LwDeepseekAsr"

    /** 回环这一跳: 连不上是"宿主没在跑", 一秒里就该知道 */
    private const val CONNECT_TIMEOUT_MS = 5_000

    /** 宿主还要替我们上传并等官方那一条认完, 所以要给足 (官方自己最长 120 s 的音频) */
    private const val READ_TIMEOUT_MS = 150_000
    private const val MAX_ANSWER_BYTES = 1 shl 20
    private const val MAX_ERROR_CHARS = 400
    private const val MAX_ATTEMPTS = 2
    private const val RETRY_DELAY_MS = 400L
}
