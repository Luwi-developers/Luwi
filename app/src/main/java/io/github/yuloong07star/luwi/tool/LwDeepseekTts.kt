package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.util.Log
import io.github.yuloong07star.luwi.host.DshHost
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.serialization.json.Json

/**
 * 「DeepSeek 官方 TTS」那条引擎: 把稿子交给**宿主**那条回环路由, 拿回音频字节, 交给 [LwVoiceClip] 放
 *
 * 为什么绕一站 (2026-11-15, 2.8.1 #5): 官方那条接口要 `Authorization: Bearer <令牌>`, 而账号那枚令牌只
 * 活在宿主进程里 (dsh 的 `deepseekAccount.resolveToken`) —— 应用这一侧没有它, 也不该有它: 偏好文件是
 * 明文的, 把令牌抄一份过去等于多出一处要守的东西。于是分工是
 *
 * ```
 * 应用 (这里)           宿主 (host-plugin 的 /lw-tts)              官方
 *   POST 稿子      →   取令牌 (账号 → 没登录就用那把 API Key)  →   POST /v1/tools/tts
 *   收到音频字节   ←   音频字节原样转回来 (令牌一个字节都不外带) ←   流式音频
 * ```
 *
 * 于是"只要有登录状态即可用"这件事是真的: 选这条引擎, 不填地址、不填密钥, 登录过就直接有声音;
 * 没登录时宿主回一句"还没登录", 设置页那句提示与它逐字对得上
 *
 * 一次一片 (片长见 [LwDeepseekSpeech.CHUNK_CHARS]), 一片在放的时候下一片已经在取了 —— 与 [LwApiTts]
 * 同一套调度, 只是换了个对端. 两条的"等首包"与"换音色不叠音"也走同一份算术 (2026-11-16, 2.8.1 #14):
 * 起播先排一声垫话 (`LwSpeak.fillerFor`, 阈值 `SpeechTail.FILLER_AFTER_MS`), 第一片回来就叫 ready 掐掉它,
 * 而每一趟一个号 —— 上一趟晚回来的那一片不许再放
 */
internal object LwDeepseekTts {

    /** 现在有没有在放: 播放器是 [LwVoiceClip] 那一份, 这一条只多问一句"是不是我这一趟" */
    val speaking: Boolean get() = activeRun != 0 && LwVoiceClip.speaking

    /**
     * 念一段: 成功回 `"said …"` (与其它引擎同形, 调用方据此判成败), 失败回一句人话
     *
     * @param context 用来放音频 (缓存目录) 的那一份
     * @param text 稿子
     * @param voice 本次点名的音色 (`stella` / `tide`); 空白或认不出就按设置页那一份
     */
    fun speak(context: Context, text: String, voice: String? = null): String {
        val wanted = LwDeepseekSpeech.voiceOf(voice, SpeakSettings.deepseekVoice)
        val pieces = LwDeepseekSpeech.pieces(text)
        if (pieces.isEmpty()) return "there is nothing to say"
        val started = System.currentTimeMillis()
        // 每一趟一个号 (2.8.1 #14): 换音色 / 再念一句时上一趟的号就过期 —— 它晚一步等回来的那一片
        // **不许再放**, 否则旧音色与新音色会叠在一起
        val mine = runs.incrementAndGet()
        activeRun = mine
        val pool: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "lw-deepseek-tts-fetch").apply { isDaemon = true }
        }
        var filler: LwSpeak.Filler? = null
        return try {
            fun queued(piece: String): Future<Clip> = pool.submit(
                Callable {
                    if (mine != runs.get()) throw IllegalStateException("the reading was stopped")
                    fetch(piece, wanted, mine)
                },
            )
            var pending = queued(pieces.first())
            // 等首包那一段先出一声垫话 (2.8.1 #14): 首片一到就叫 ready, 掐掉它再放真正的
            val waitForFirst = LwSpeak.fillerFor(context)
            filler = waitForFirst
            pieces.forEachIndexed { index, piece ->
                if (mine != runs.get()) {
                    return "stopped on request before saying \"${piece.take(SCRIBBLE)}\""
                }
                val clip = await(pending)
                // 第一片回来了: 这一声垫话到此为止 (两段声音不许叠)
                if (index == 0) waitForFirst.ready()
                // 放这一片的时候, 下一片已经在取了
                val next = pieces.getOrNull(index + 1)?.let { queued(it) }
                if (!LwVoiceClip.play(context, clip.bytes, clip.extension)) {
                    return if (mine != runs.get()) {
                        "stopped on request while saying \"${piece.take(SCRIBBLE)}\""
                    } else {
                        "the audio did not finish playing"
                    }
                }
                if (next != null) pending = next
            }
            "said ${text.length} characters in ${pieces.size} piece(s) with the DeepSeek voice $wanted," +
                " in ${System.currentTimeMillis() - started} ms"
        } catch (error: Throwable) {
            Log.w(TAG, "the DeepSeek TTS call failed", error)
            "the DeepSeek TTS call failed: ${error.message ?: error}"
        } finally {
            // 首片之后 cancel 是空的 (ready 已经撤过这一趟); 失败 / 被叫停那几档靠它把垫话撤掉
            filler?.cancel()
            // 只清自己那一趟: 后面可能已经起了新的一趟 (它的 activeRun 不许被这一趟抹掉)
            if (activeRun == mine) activeRun = 0
            pool.shutdownNow()
        }
    }

    /** 掐断: 这一趟不在念时回 null (与其它引擎同形, 调用方靠它分辨"谁停的") */
    fun stop(): String? {
        // **先作废这一趟**: 还在等网络的那一趟也要停 —— 否则它晚一步回来就与新的一句叠在一起 (换音色)
        runs.incrementAndGet()
        activeRun = 0
        if (!LwVoiceClip.speaking) return null
        return LwVoiceClip.stop()
    }

    /** 一次请求的产物: 字节与它的后缀 */
    private class Clip(val bytes: ByteArray, val extension: String)

    /** 宿主那边说"这一趟不行": 话已经是一句人话, 逐字往外带 */
    private class RouteError(message: String) : IllegalStateException(message)

    /** 取一片: 网络抖动时重试一次 (两次都空手就把宿主那句原话报出去) */
    private fun fetch(text: String, voice: String, mine: Int): Clip {
        var attempt = 0
        while (true) {
            attempt += 1
            try {
                return fetchOnce(text, voice)
            } catch (error: Throwable) {
                // 宿主自己给的原因 (没登录 / 官方 4xx) 不重试: 同一条稿子再发一遍只多花一次钱
                if (error is RouteError || attempt >= MAX_ATTEMPTS || mine != runs.get()) throw error
                Log.i(TAG, "attempt $attempt failed (${error.message}), retrying once")
                try {
                    Thread.sleep(RETRY_DELAY_MS)
                } catch (interrupted: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw error
                }
                if (mine != runs.get()) throw error
            }
        }
    }

    private fun fetchOnce(text: String, voice: String): Clip {
        val connection = URL(endpoint()).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.outputStream.use { stream ->
                stream.write(LwDeepseekSpeech.requestBody(text, voice).toByteArray(Charsets.UTF_8))
            }
            val code = connection.responseCode
            if (code !in 200..299) {
                val detail = runCatching {
                    connection.errorStream?.use { stream ->
                        stream.readBytes().decodeToString().take(MAX_ERROR_CHARS)
                    }
                }.getOrNull().orEmpty()
                throw RouteError(routeMessage(code, detail))
            }
            val type = connection.contentType
            val bytes = connection.inputStream.use { readCapped(it) }
            if (bytes.isEmpty()) throw RouteError("the DeepSeek TTS returned no audio")
            return Clip(bytes, LwDeepseekSpeech.extension(type))
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
        val parsed = runCatching {
            Json.parseToJsonElement(detail).let { it as? kotlinx.serialization.json.JsonObject }
        }.getOrNull()
        val said = parsed?.get("error")?.let {
            (it as? kotlinx.serialization.json.JsonPrimitive)?.content
        }?.takeIf { it.isNotBlank() }
        if (said != null) return said
        return "the host answered $code" + if (detail.isBlank()) "" else ": $detail"
    }

    /** 宿主那条路由的地址: 回环 + host 那个固定口 (`DshHost.PORT`), 不猜、不扫 */
    private fun endpoint(): String = "http://127.0.0.1:${DshHost.PORT}${LwDeepseekSpeech.ROUTE_PATH}"

    /** 等预取的那一片: 把 ExecutionException 拆开, 报出来的仍是那一次请求自己的话 */
    private fun await(future: Future<Clip>): Clip = try {
        future.get()
    } catch (error: ExecutionException) {
        throw error.cause ?: error
    } catch (error: InterruptedException) {
        Thread.currentThread().interrupt()
        throw IllegalStateException("the fetch was interrupted", error)
    }

    /** 读回来但夹住上限: 一个失控的响应不该把内存吃掉 */
    private fun readCapped(stream: InputStream): ByteArray {
        val buffer = ByteArrayOutputStream()
        val chunk = ByteArray(1 shl 16)
        while (true) {
            val read = stream.read(chunk)
            if (read <= 0) break
            if (buffer.size() + read > MAX_BYTES) {
                throw RouteError("the audio is larger than ${MAX_BYTES / 1024 / 1024} MB")
            }
            buffer.write(chunk, 0, read)
        }
        return buffer.toByteArray()
    }

    private const val TAG = "LwDeepseekTts"
    private const val SCRIBBLE = 12

    /** 回环这一跳: 连不上是"宿主没在跑", 一秒里就该知道 */
    private const val CONNECT_TIMEOUT_MS = 5_000

    /** 宿主还要替我们去官方那一条合成, 所以要给足 */
    private const val READ_TIMEOUT_MS = 90_000
    private const val MAX_BYTES = 24 * 1024 * 1024
    private const val MAX_ERROR_CHARS = 400
    private const val MAX_ATTEMPTS = 2
    private const val RETRY_DELAY_MS = 400L

    /** 正在念的那一趟的号 (0 = 没有); "正在说"与掐断都要分得开 */
    @Volatile
    private var activeRun = 0

    /**
     * 每一趟一个号 (2.8.1 #14): 换音色 / 再念一句 / 被掐断时加一, 上一趟的号就过期
     *
     * 原来是 `stopped` 那一个布尔: 新的一趟把它写回 false, 上一趟醒来看到 false 就接着放 —— 两条
     * `MediaPlayer` 各放各的, 就是"切换音色时叠音"
     */
    private val runs = AtomicInteger(0)
}
