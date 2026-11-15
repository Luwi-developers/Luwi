package io.github.yuloong07star.luwi.tool

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * 「DeepSeek 官方 TTS」那条引擎的纯算术: 端点、音色表、请求体、回来的字节配什么后缀
 *
 * 与 [LwApiSpeech] 同一个理由单独立一份: 这几处最容易错 (端点少一段、字段名按 OpenAI 那套写成 `input`、
 * 拿回来的 wav 当成 mp3), 而它们都不碰安卓也不碰网络, 所以 JVM 单测能直接量 (见 LwDeepseekSpeechTest)
 *
 * 接口是 DeepSeek 官方那一条 (`POST /v1/tools/tts`, 2026-11-13 开放的独立接口):
 *
 * ```
 * 请求: {text, voice_id, format, filter_markdown}   头: Authorization: Bearer <令牌>
 * 回来: 音频, 默认 wav (format=pcm 时是 24 kHz / 16 bit / 单声道裸 PCM)
 * ```
 *
 * **令牌不在这里**: 账号那枚令牌只活在宿主进程里 (dsh 的 `deepseekAccount`), 应用这一侧拿到的是音频本身
 * —— 所以这条引擎的请求先走宿主自己那条回环路由 ([ROUTE_PATH]), 由宿主带上令牌再去打官方接口。
 * 应用偏好里**一个字符的令牌都没有**, 于是"只要有登录状态即可用"这件事没有第二份密钥要维护
 *
 * 两个限制照官方文档写死: 一次最多 10,000 个计费字符 (请求体 64 KiB 以内), 语种自己认 (没有语种参数)
 */
internal object LwDeepseekSpeech {

    /**
     * 官方那条 TTS 接口 (整段合成)
     *
     * 只用来**拼文档与报读数**; 真正的请求由宿主发 (它才有令牌)。宿主那一侧写的是同一串
     * (见 `host-plugin/index.mjs` 的 `LW_TTS_ENDPOINT`)
     */
    const val ENDPOINT = "https://api.deepseek.com/v1/tools/tts"

    /** 宿主那条回环路由: 应用把稿子交给它, 拿回来的就是音频字节 */
    const val ROUTE_PATH = "/lw-tts"

    /** 官方给的两个音色: `stella` 海星 (女声, 缺省), `tide` 暗潮 (男声) */
    const val DEFAULT_VOICE = "stella"

    /** 设置页那一列: 官方就这两个, 不铺开也不让填别的 (官方只认这两个 id) */
    val VOICES: List<Pair<String, String>> = listOf(
        "stella" to "海星 (女声)",
        "tide" to "暗潮 (男声)",
    )

    /** 回来的音频格式: wav 是缺省, 也是 MediaPlayer 一定吃得下的那一档 */
    const val FORMAT = "wav"

    /** 官方上限 (计费字符); 我们切得比它狠 (见 [CHUNK_CHARS]) */
    const val TEXT_MAX = 10_000

    /**
     * 一段最多几个字
     *
     * 比官方上限小得多, 理由与 [LwApiSpeech.CHUNK_CHARS] 一样: 合成与播放是串起来的两步, 一片一段能让
     * "停"有粒度, 也能让上一片在放的时候下一片已经在取
     */
    const val CHUNK_CHARS = 600

    /** 这个音色 id 官方认不认 (设置页只列两个, 点名那一档进来时还是要问一次) */
    fun known(voice: String): Boolean = VOICES.any { it.first == voice }

    /**
     * 这一次真正用哪个音色
     *
     * 优先级: **调用点名的 (且官方认)** > 设置页那个 > 缺省。点名了一个不认识的 id 时退回设置页那份,
     * 不把一串官方没听过的字发过去 —— 那只会拿回一个 400
     */
    fun voiceOf(asked: String?, stored: String): String {
        val named = asked?.trim().orEmpty()
        if (known(named)) return named
        val kept = stored.trim()
        return if (known(kept)) kept else DEFAULT_VOICE
    }

    /**
     * 官方那条的请求体
     *
     * 字段名按官方文档: `text` / `voice_id` / `format` / `filter_markdown`。**没有语速参数** —— 这条接口
     * 自己决定节奏, 所以设置页那个语速滑块对它不成立 (回执里会如实说没生效)
     *
     * `filter_markdown` 给 true: 稿子本来就是从回答里洗过的 (见宿主的 `readAloudText`), 但正文里偶尔还会
     * 留下 `**` 这类记号, 让服务端顺手去掉比念出"星号"好
     */
    fun requestBody(text: String, voice: String): String = buildJsonObject {
        put("text", text)
        put("voice_id", if (known(voice)) voice else DEFAULT_VOICE)
        put("format", FORMAT)
        put("filter_markdown", true)
    }.toString()

    /**
     * 回来的字节是什么格式: 只有 `Content-Type` 说了算
     *
     * 官方这一条默认 `audio/wav`, 要 pcm 才给裸 PCM —— 裸 PCM 没有头, MediaPlayer 认不出, 所以这一侧
     * 只请求 wav; 万一对端回了别的, 宁可猜 wav 也不留一个 `.tmp`
     */
    fun extension(contentType: String?): String {
        val type = contentType?.substringBefore(';')?.trim()?.lowercase().orEmpty()
        return when {
            type.contains("wav") -> "wav"
            type.contains("mpeg") || type.contains("mp3") -> "mp3"
            type.contains("ogg") -> "ogg"
            type.contains("aac") -> "aac"
            type.contains("flac") -> "flac"
            type.contains("mp4") || type.contains("m4a") -> "m4a"
            else -> "wav"
        }
    }

    /**
     * 这一趟该念哪些片: 按句切到 [CHUNK_CHARS]
     *
     * 切法复用 [LwSpeak.chunk] (系统那条与自带那条也走它): 优先在句末切, 切不出好位置才硬切
     */
    fun pieces(text: String): List<String> {
        val safe = text.trim()
        if (safe.isEmpty()) return emptyList()
        return LwSpeak.chunk(safe, CHUNK_CHARS)
    }
}
