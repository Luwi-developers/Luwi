package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.util.Log
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

/**
 * 「API TTS」那条引擎: 把文本 POST 给一个 **OpenAI 兼容的 `/v1/audio/speech`**, 拿回音频字节, 交给
 * [LwVoiceClip] 放
 *
 * 地址、密钥、模型与音色都是**念之前现读偏好** (见 [SpeakSettings.storedApi]): 进程被系统重启、界面
 * 还没画过的那一档也要能念, 不能拿一份没初始化过的内存态去发请求
 *
 * **音色可以来自音色库** (`$DSH_HOME/lw/tts-voices.json`, 见 [LwApiVoices]): 设计出来的音色在库里
 * 登记一条, 这一条带 `model` 时就只对这一条生效; 调用方还可以**单次点名** (`lw_speak voice=`), 不改
 * 设置页那一份
 *
 * 两处优化 (2026-10-25): 一片在放的时候下一片已经在取了 (句子之间的空白从"一次请求"缩到"一次播放"),
 * 网络异常 / 429 / 5xx 自动重试一次 —— 4xx 的其余各档不重试, 免得重复计费
 *
 * **等首包那一段先出一声** (2.8.1 #14): 第一片要等一趟网络, 那一段里喇叭是静的 —— 由
 * `LwSpeak.fillerFor` 排一声预录填音补上, 首片一到就掐掉再放真正的 (阈值见 `SpeechTail.FILLER_AFTER_MS`)
 *
 * 音量: 拿回来的是编码过的音频, 应用这一侧不解码就没有增益可加 —— 响度由服务与手机媒体音量决定,
 * 所以设置页对这条引擎显示的是"它自己决定"而不是那条滑块
 */
internal object LwApiTts {

    /** 现在有没有在放 */
    val speaking: Boolean get() = LwVoiceClip.speaking

    /**
     * 念一段: 成功回 "said …" (与其它引擎同形, 调用方据此判成败), 失败回一句人话
     *
     * [context] 用来找 cache 目录与音色库
     * [voice] 本次点名的音色 (id 或登记名), null / 空白就按设置页那一份
     */
    fun speak(context: Context, text: String, speed: Float, voice: String? = null): String {
        val api = SpeakSettings.storedApi(context)
        val endpoint = LwApiSpeech.endpoint(api.url)
        if (endpoint.isEmpty()) {
            return "the API engine has no address yet: fill it in on the settings page"
        }
        val pieces = LwSpeak.chunk(text, LwApiSpeech.CHUNK_CHARS)
        if (pieces.isEmpty()) return "there is nothing to say"
        val wanted = LwApiSpeech.effectiveVoice(voice, api.voice)
        // 逐音色模型: 设计出来的那条可能挂在另一个模型上, 没写就用设置页那个
        val model = LwApiVoices.modelFor(context, wanted) ?: api.model
        val started = System.currentTimeMillis()
        // 每一趟一个号 (2.8.1 #14): 换音色 / 再念一句时上一趟的号就过期 —— 它晚一步等回来的那一片
        // **不许再放**, 否则旧音色与新音色会叠在一起
        val mine = runs.incrementAndGet()
        val pool: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "lw-api-tts-fetch").apply { isDaemon = true }
        }
        var filler: LwSpeak.Filler? = null
        return try {
            // 取一片: 叫停之后不再发新请求 (已经发出去的那一趟让它在 finally 里被丢弃)
            fun queued(piece: String): Future<Clip> = pool.submit(
                Callable {
                    if (mine != runs.get()) throw IllegalStateException("the reading was stopped")
                    fetch(endpoint, api.key, model, wanted, speed, piece, mine)
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
                // 放这一片的时候, 下一片已经在取了 —— 它要是在这一片放完之前回来, 两片之间就没有空白
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
            "said ${text.length} characters in ${pieces.size} piece(s) with API $model," +
                " voice $wanted, in ${System.currentTimeMillis() - started} ms"
        } catch (error: Throwable) {
            Log.w(TAG, "the API TTS call failed", error)
            "the API TTS call failed: ${error.message ?: error}"
        } finally {
            // 首片之后 cancel 是空的 (ready 已经撤过这一趟); 失败 / 被叫停那几档靠它把垫话撤掉
            filler?.cancel()
            pool.shutdownNow()
        }
    }

    /** 掐断: 没在放时回 null (与自带那条同形) */
    fun stop(): String? {
        // **先作废这一趟**: 还在等网络的那一趟也要停 —— 否则它晚一步回来就与新的一句叠在一起 (换音色)
        runs.incrementAndGet()
        if (!LwVoiceClip.speaking) return null
        return LwVoiceClip.stop()
    }

    /** 一次请求的产物: 字节与它的后缀 */
    private class Clip(val bytes: ByteArray, val extension: String)

    /** 服务端非 2xx: 只有这几档值得再来一次 (4xx 的其余各档重试只会白花一遍钱) */
    private class EndpointError(val code: Int, message: String) : IllegalStateException(message) {
        val retryable: Boolean get() = code == 408 || code == 429 || code in 500..599
    }

    /** 取一片, 网络抖动或服务端 5xx 时重试一次 */
    private fun fetch(
        endpoint: String,
        key: String,
        model: String,
        voice: String,
        speed: Float,
        input: String,
        mine: Int,
    ): Clip {
        var attempt = 0
        while (true) {
            attempt += 1
            try {
                return fetchOnce(endpoint, key, model, voice, speed, input)
            } catch (error: Throwable) {
                val retryable = error is IOException || (error is EndpointError && error.retryable)
                if (!retryable || attempt >= MAX_ATTEMPTS || mine != runs.get()) throw error
                Log.i(TAG, "attempt $attempt failed (${error.message}), retrying once")
                try {
                    Thread.sleep(RETRY_DELAY_MS)
                } catch (interrupted: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw error
                }
                // 等待那 400 ms 里被叫停: 不再发第二趟
                if (mine != runs.get()) throw error
            }
        }
    }

    private fun fetchOnce(
        endpoint: String,
        key: String,
        model: String,
        voice: String,
        speed: Float,
        input: String,
    ): Clip {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            if (key.isNotBlank()) connection.setRequestProperty("Authorization", "Bearer $key")
            connection.outputStream.use { stream ->
                stream.write(LwApiSpeech.requestBody(model, input, voice, speed).toByteArray(Charsets.UTF_8))
            }
            val code = connection.responseCode
            if (code !in 200..299) {
                val detail = runCatching {
                    connection.errorStream?.use { stream ->
                        stream.readBytes().decodeToString().take(MAX_ERROR_CHARS)
                    }
                }.getOrNull().orEmpty()
                throw EndpointError(code, "the endpoint answered $code${if (detail.isBlank()) "" else ": $detail"}")
            }
            val bytes = connection.inputStream.use { readCapped(it) }
            if (bytes.isEmpty()) throw IllegalStateException("the endpoint returned no audio")
            return Clip(bytes, LwApiSpeech.extension(connection.contentType))
        } finally {
            runCatching { connection.disconnect() }
        }
    }

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
                throw IllegalStateException("the endpoint returned more than ${MAX_BYTES / 1024 / 1024} MB")
            }
            buffer.write(chunk, 0, read)
        }
        return buffer.toByteArray()
    }

    private const val TAG = "LwApiTts"
    private const val SCRIBBLE = 12
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 60_000
    private const val MAX_BYTES = 24 * 1024 * 1024
    private const val MAX_ERROR_CHARS = 400

    /** 一次念最多发几次请求 (1 = 不重试) */
    private const val MAX_ATTEMPTS = 2

    /** 重试之前等多久: 429 / 5xx 常常是瞬时的, 半秒就够 */
    private const val RETRY_DELAY_MS = 400L

    /**
     * 每一趟一个号 (2.8.1 #14): 换音色 / 再念一句 / 被掐断时加一, 上一趟的号就过期
     *
     * 原来是 `stopped` 那一个布尔: 新的一趟把它写回 false, 上一趟醒来看到 false 就接着放 —— 两条
     * `MediaPlayer` 各放各的, 就是"切换音色时叠音"
     */
    private val runs = AtomicInteger(0)
}
