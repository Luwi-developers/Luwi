package io.github.yuloong07star.luwi.voice

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.yuloong07star.luwi.tool.LwSpeech
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * 语音模型 (SenseVoice + silero VAD) 的 app 侧下载器
 *
 * 为什么 app 也要有一份: 宿主那一路 (`lw_speech op=prepare`) 是 dsh 页面点语音按钮时才走的, 而
 * **首启弹窗与设置页**要能在宿主还没起来、或者人根本没进 dsh 的时候把模型补上 —— 两处要的是同一份
 * 文件表与同一串地址, 所以这里照 [io.github.yuloong07star.luwi.wake.WakeWordDownload] 的样子再写一份
 *
 * **文件表与源地址必须与 `host-plugin/index.mjs` 的 `SPEECH_FILES` / `SPEECH_VAD` / `SPEECH_SOURCES`
 * 逐字节一致** (判据 `tools/check-model-files.mjs`): 两侧谁先下都不影响结果, 但改了一边忘了另一边,
 * 下一次校验就会说"模型坏了"
 *
 * 三个文件一共约 241 MB: SenseVoice int8 (约 228 MB) + tokens + 1.8 MB 的 silero VAD。落点与
 * [LwSpeech] 读的是同一个目录 (`files/speech-models/...`), 所以不用另立约定
 */
internal object SpeechModelDownload {

    /** 一个文件: 名字、字节数、钉死的 sha256 (与宿主那一侧同源) */
    internal class Item(val name: String, val bytes: Long, val sha256: String)

    /** 识别模型 (与 `LwSpeech.MODEL_FILE` / `TOKENS_FILE` 同一个名字) */
    val files: List<Item> = listOf(
        Item(
            LwSpeech.MODEL_FILE,
            239_233_841L,
            "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
        ),
        Item(
            LwSpeech.TOKENS_FILE,
            315_894L,
            "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
        ),
    )

    /** 切段模型: 1.8 MB, 与 dsh 自己那份 `speech-to-text-sensevoice` 钉的是同一个文件、同一个哈希 */
    val vad: Item = Item(
        "silero_vad.onnx",
        1_807_522L,
        "a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28",
    )

    /** huggingface.co 在手机上常常连不上, 镜像优先 (与宿主那一侧同一串地址) */
    private const val SPEECH_REPO =
        "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main"

    private const val SPEECH_REPO_BACKUP =
        "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main"

    private val SOURCES = listOf(SPEECH_REPO, SPEECH_REPO_BACKUP)

    private const val VAD_REPO = "https://hf-mirror.com/csukuangfj/vad/resolve/main"
    private const val VAD_REPO_BACKUP = "https://huggingface.co/csukuangfj/vad/resolve/main"

    private val VAD_SOURCES = listOf(VAD_REPO, VAD_REPO_BACKUP)

    private const val CONNECT_MS = 15_000L
    private const val READ_MS = 60_000L

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(CONNECT_MS, TimeUnit.MILLISECONDS)
            .readTimeout(READ_MS, TimeUnit.MILLISECONDS)
            .build()
    }

    enum class Phase { IDLE, DOWNLOADING, PAUSED, READY, FAILED }

    /** 这一趟被人按停的方式 (2026-11-15 主人: "下载加个暂停, 点击正在下载可暂停…可取消") */
    private enum class Stop { RUN, PAUSE, CANCEL }

    /** 把阻塞读从循环里拽出来的信号: 只在内部传, 不外抛给人 */
    private class Stopped(val stop: Stop) : RuntimeException("stopped")

    /** 现在在干什么, 以及一句人话 (与 WakeWordDownload 同一套, 设置页与弹窗都读它) */
    var phase: Phase by mutableStateOf(Phase.IDLE)
        private set

    var detail: String by mutableStateOf("")
        private set

    var received: Long by mutableStateOf(0L)
        private set

    var total: Long by mutableStateOf(0L)
        private set

    /** 按停/取消的意图, 下载那一趟每一轮都看一眼 */
    @Volatile
    private var stop: Stop = Stop.RUN

    /** 手上那一条连接: 暂停就是把它掐了, 阻塞读当场返回 */
    @Volatile
    private var call: okhttp3.Call? = null

    /** 一趟只能有一个在跑: 暂停后马上按继续时, 上一趟可能还在收尾 (两个线程写同一个 .part 就是坏文件) */
    private val gate = Any()

    @Volatile
    private var running = false

    /**
     * 暂停: 掐掉连接, 已下的那一段留在 `.part` 里, 下次从这里接着下 (Range 续传)
     *
     * 只在真下载中有意义 —— 暂停之后再点就是继续 (再走一次 [download]), 见卡片那一行
     */
    fun pause() {
        if (phase != Phase.DOWNLOADING) return
        stop = Stop.PAUSE
        runCatching { call?.cancel() }
        // 当场就翻成"已暂停": 连接掐掉之后线程还要一两帧才退出来, 界面上不能等它
        phase = Phase.PAUSED
        detail = "已暂停, 已下的那一段留着"
    }

    /**
     * 取消: 连接掐掉, `.part` 一起清掉 —— 下次是从零开始, 不是接着来
     *
     * 暂停之后线程已经退出了, 没有人来接这个意图: 那一档就地收尾 (真机上按过一次 ×, 界面
     * 停在"已暂停"不动就是这个原因, 2026-11-15)
     */
    fun cancel(context: Context) {
        if (phase != Phase.DOWNLOADING && phase != Phase.PAUSED) return
        stop = Stop.CANCEL
        runCatching { call?.cancel() }
        if (!running) settleCancel(context)
    }

    /** 取消收尾: 半条文件清掉, 回到"还没下" (下载线程与 [cancel] 两处共用) */
    private fun settleCancel(context: Context) {
        stop = Stop.RUN
        (files + vad).forEach { partialOf(context, it).delete() }
        received = 0L
        phase = Phase.IDLE
        detail = "已取消, 一个字节都没留"
    }

    /** 三个文件都在、字节数都对 */
    fun present(context: Context): Boolean =
        files.all { sizeOf(context, it) == it.bytes } && sizeOf(context, vad) == vad.bytes

    /** 已经对上的文件数 (0..3), 状态行用它说"下了几个" */
    fun readyCount(context: Context): Int =
        files.count { sizeOf(context, it) == it.bytes } + if (sizeOf(context, vad) == vad.bytes) 1 else 0

    /** 不联网地看一眼磁盘 */
    fun refresh(context: Context) {
        // 下载中与暂停中都不许被这一眼改写: 暂停是人的决定, 不是"磁盘上没下完"
        if (phase == Phase.DOWNLOADING || phase == Phase.PAUSED) return
        val ready = readyCount(context)
        val all = files.size + 1
        phase = if (ready == all) Phase.READY else Phase.IDLE
        detail = when {
            ready == all -> "$all 个文件都在, 下的时候逐个对过 sha256"
            ready == 0 -> "还没下过, 一共约 ${mib(files.sumOf { it.bytes } + vad.bytes)}"
            else -> "只对了 $ready/$all 个, 按一下补齐"
        }
    }

    /**
     * 下载缺的那几个, 每个都对 sha256
     *
     * **同步阻塞**: 调用方放在 IO 上。失败时抛, 句子已经写清是哪个镜像、哪一步
     */
    fun download(context: Context): String {
        synchronized(gate) {
            // 上一趟还在收尾 (刚按了暂停/取消): 等它两百 ms 见外的收尾时间, 再不行才回话
            var waited = 0
            while (running && waited < 40) {
                Thread.sleep(50)
                waited += 1
            }
            if (running) return "上一趟还在收尾, 等一下再按"
            running = true
        }
        try {
            return downloadMissing(context)
        } finally {
            running = false
        }
    }

    /** [download] 的主体: 缺哪个下哪个, 有 `.part` 就接着下 */
    private fun downloadMissing(context: Context): String {
        val missing = files.filter { sizeOf(context, it) != it.bytes } +
            (if (sizeOf(context, vad) != vad.bytes) listOf(vad) else emptyList())
        pending = missing.sumOf { it.bytes }
        // 上次暂停留下的那几段算进来: 界面上的百分比接着涨, 不从 0 再走一遍
        received = missing.sumOf { partialOf(context, it).length() }.coerceAtMost(pending)
        total = pending
        stop = Stop.RUN
        phase = Phase.DOWNLOADING
        detail = "正在下 ${missing.size} 个文件, 约 ${mib(pending)}"
        val fetched = mutableListOf<String>()
        try {
            for (item in missing) {
                val target = targetOf(context, item)
                target.parentFile?.mkdirs()
                fetch(item, target, if (item === vad) VAD_SOURCES else SOURCES)
                fetched += item.name
            }
        } catch (stopped: Stopped) {
            if (stopped.stop == Stop.CANCEL) {
                // 取消: 半条文件一起清掉, 下次是从零开始
                settleCancel(context)
            } else {
                phase = Phase.PAUSED
                detail = "已暂停, 已下的那一段留着"
            }
            return detail
        } catch (error: Throwable) {
            phase = Phase.FAILED
            detail = error.message ?: error.toString()
            throw error
        }
        phase = Phase.READY
        detail = buildString {
            append(
                if (fetched.isEmpty()) {
                    "三个文件本来就在, 一个字节没下"
                } else {
                    val bytes = fetched.sumOf { name -> (files + vad).first { it.name == name }.bytes }
                    "下好了 ${fetched.size} 个文件 (${mib(bytes)})"
                },
            )
            append(", 每个都对过 sha256")
        }
        return detail
    }

    /** 那一条 `.part`: 暂停时它留着, 取消时它被删掉 */
    private fun partialOf(context: Context, item: Item): File =
        File(targetOf(context, item).parentFile, "${item.name}.part")

    /**
     * 一个文件: 逐个镜像试, 有 `.part` 就走 Range 续传
     *
     * 被按停 (暂停 / 取消) 时不删 `.part`、也不记镜像的失败账 —— 那是人按的, 不是网络坏了
     */
    private fun fetch(item: Item, target: File, sources: List<String>) {
        val partial = File(target.parentFile, "${item.name}.part")
        val attempts = mutableListOf<String>()
        for (base in sources) {
            try {
                fetchOnce(base, item, partial, target)
                return
            } catch (stopped: Stopped) {
                throw stopped
            } catch (error: Throwable) {
                partial.delete()
                attempts += "${runCatching { java.net.URI(base).host }.getOrDefault(base)}: " +
                    (error.message ?: error.toString())
            }
        }
        throw IllegalStateException("${item.name} 下不下来 (${attempts.joinToString("; ")})")
    }

    /** 一趟 HTTP: 从 `.part` 已有的字节数接着收, 收完整文件算一遍 sha256 */
    private fun fetchOnce(base: String, item: Item, partial: File, target: File) {
        val start = if (partial.exists()) partial.length() else 0L
        val builder = Request.Builder()
            .url("$base/${item.name}")
            .header("Accept", "*/*")
            .header("User-Agent", "Luwi")
        if (start > 0L) builder.header("Range", "bytes=$start-")
        val current = client.newCall(builder.build())
        call = current
        try {
            val response = current.execute()
            try {
                val resumed = response.code == 206
                if (response.code != 200 && !resumed) throw IllegalStateException("HTTP ${response.code}")
                // 服务器不理 Range: 从头来, 别在旧字节后面接一段
                val append = resumed && start > 0L
                response.body.byteStream().use { input ->
                    java.io.FileOutputStream(partial, append).use { output ->
                        val buffer = ByteArray(1 shl 16)
                        while (true) {
                            if (stop != Stop.RUN) throw Stopped(stop)
                            val read = input.read(buffer)
                            if (read <= 0) break
                            output.write(buffer, 0, read)
                            received += read
                        }
                    }
                }
                val actual = sha256Of(partial)
                if (actual != item.sha256) {
                    throw IllegalStateException("sha256 是 $actual, 不是钉住的 ${item.sha256}")
                }
                // 删的必须是目标那一条: 先删目标再 rename, 否则第二次下载会失败 (与 WakeWordDownload 同一个坑)
                target.delete()
                if (!partial.renameTo(target)) {
                    throw IllegalStateException("下好了却放不到 ${target.absolutePath}")
                }
            } finally {
                response.close()
            }
        } catch (error: Throwable) {
            // 连接是我们自己掐的 (`pause` / `cancel`): 读上来的 IOException 不是"镜像坏了"
            if (error !is Stopped && stop != Stop.RUN) throw Stopped(stop)
            throw error
        } finally {
            call = null
        }
    }

    /** 整文件算一遍 (续传时不做增量, 239 MB 本地读一遍比"拼 sha256 状态"稳) */
    private fun sha256Of(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(1 shl 16)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /** 目标文件: 识别模型两个落在 LwSpeech 的目录里, VAD 落它自己的那一个文件 */
    private fun targetOf(context: Context, item: Item): File =
        if (item === vad) LwSpeech.vadModel(context) else File(LwSpeech.modelDirectory(context), item.name)

    private fun sizeOf(context: Context, item: Item): Long = targetOf(context, item).length()

    private fun mib(bytes: Long): String = "%.1f MB".format(bytes / 1024.0 / 1024.0)

    /** 这一趟要收多少字节 (与 WakeWordDownload 一样, 只给状态行看) */
    private var pending: Long = 0
}
