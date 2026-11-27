package io.github.yuloong07star.luwi.wake

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.yuloong07star.luwi.tool.LwWakeWord
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * 唤醒词模型: 设置页那一个按钮背后的下载
 *
 * 为什么 app 这一侧也要有一份: 宿主插件那份 (`lw_wakeword op=prepare`) 是给模型用的, 而设置页是
 * 给人用的 —— 人按一下要看到进度、要当面知道校验过没过, 这中间没有一条"从 app 里叫一次宿主工具"
 * 的路 (那条路是 host → app 方向的回环通道, 反着不通)。所以两边各有一份同源的文件表, **地址与
 * sha256 必须与 host-plugin/index.mjs 的 WAKEWORD_FILES 一致**, 改一边就要改另一边
 *
 * 只装 int8 那一套 (4 个文件, 约 5.3 MB): 没量化那一套是 12 MB 的 encoder, 手机上 CPU 跑还慢,
 * 而两套并存在一个目录里时"按前缀取到哪一套"就变成"谁先下的算谁的", 所以装完把不属于这张表的
 * `.onnx` 清掉
 */
internal object WakeWordDownload {

    /** 一个文件: 名字、字节数、钉死的 sha256 (与 GitHub Release 自己算的那份一致) */
    internal class Item(val name: String, val bytes: Long, val sha256: String)

    /** 只留 int8 这一套 */
    val files: List<Item> = listOf(
        Item(
            "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
            4_777_666L,
            "dd784973fc9d2fabb3b800d6dcd20fc3b0ca84f8e2415afe54b032878e447f4d",
        ),
        Item(
            "decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
            675_349L,
            "fb581d6734511676e246e0dff2fea01b31b0913176cb3ca64576dbab0a177774",
        ),
        Item(
            "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
            65_242L,
            "f79760052b87239e325f0567c752ad3130b30d92effb847d4307743c20c59a24",
        ),
        Item("tokens.txt", 1_627L, "72316508d9119696145abc6f1f8cdc46287535c34e5ce7e595f845cb1499cf2e"),
    )

    /** 我们自己的 Release, 镜像优先: 这台设备上 github.com 直连只回 302, 真正的字节在下一跳上 */
    private const val RELEASE =
        "https://github.com/yuloong07-star/Luwi/releases/download/models-kws-2024-01-01"

    private val SOURCES = listOf("https://ghfast.top/$RELEASE", RELEASE)

    /** 这一趟总共要收多少字节, 进度按它算 (已经在对的文件不计进去) */
    private var pending: Long = 0

    enum class Phase { IDLE, DOWNLOADING, PAUSED, READY, FAILED }

    /** 这一趟被人按停的方式 (2026-11-15 主人: "下载加个暂停, 点击正在下载可暂停…可取消") */
    private enum class Stop { RUN, PAUSE, CANCEL }

    /** 把阻塞读从循环里拽出来的信号: 只在内部传, 不外抛给人 */
    private class Stopped(val stop: Stop) : RuntimeException("stopped")

    /** 现在在干什么, 以及一句人话 */
    var phase: Phase by mutableStateOf(Phase.IDLE)
        private set

    var detail: String by mutableStateOf("")
        private set

    /** 收了多少 / 这一趟总共多少 */
    var received: Long by mutableStateOf(0L)
        private set

    var total: Long by mutableStateOf(0L)
        private set

    /** 按停/取消的意图, 下载那一趟每一轮都看一眼 */
    @Volatile
    private var stop: Stop = Stop.RUN

    /** 手上那一条连接: 暂停就是把它断了, 阻塞读当场返回 */
    @Volatile
    private var connection: HttpURLConnection? = null

    /** 一趟只能有一个在跑: 暂停后马上按继续时, 上一趟可能还在收尾 (两个线程写同一个 .part 就是坏文件) */
    private val gate = Any()

    @Volatile
    private var running = false

    /** 暂停: 断连接, 已下的那一段留在 `.part` 里, 下次从这里接着下 (Range 续传) */
    fun pause() {
        if (phase != Phase.DOWNLOADING) return
        stop = Stop.PAUSE
        runCatching { connection?.disconnect() }
        // 当场就翻成"已暂停": 断连接之后线程还要一两帧才退出来, 界面上不能等它
        phase = Phase.PAUSED
        detail = "已暂停, 已下的那一段留着"
    }

    /**
     * 取消: 断连接, `.part` 一起清掉 —— 下次是从零开始
     *
     * 暂停之后线程已经退出了, 没有人来接这个意图: 那一档就地收尾 (2026-11-15 真机上踩到)
     */
    fun cancel(context: Context) {
        if (phase != Phase.DOWNLOADING && phase != Phase.PAUSED) return
        stop = Stop.CANCEL
        runCatching { connection?.disconnect() }
        if (!running) settleCancel(context)
    }

    /** 取消收尾: 半条文件清掉, 回到"还没下" (下载线程与 [cancel] 两处共用) */
    private fun settleCancel(context: Context) {
        stop = Stop.RUN
        val directory = LwWakeWord.directory(context)
        files.forEach { File(directory, "${it.name}.part").delete() }
        received = 0L
        phase = Phase.IDLE
        detail = "已取消, 一个字节都没留"
    }

    /** 四个文件都在、字节数都对 */
    fun present(context: Context): Boolean = files.all { sizeOf(context, it) == it.bytes }

    /** 已经对上的文件数, 状态行用它说"下了几个" */
    fun readyCount(context: Context): Int = files.count { sizeOf(context, it) == it.bytes }

    /** 不联网地看一眼磁盘, 状态行与刚进设置页时用 */
    fun refresh(context: Context) {
        // 下载中与暂停中都不许被这一眼改写: 暂停是人的决定, 不是"磁盘上没下完"
        if (phase == Phase.DOWNLOADING || phase == Phase.PAUSED) return
        val ready = readyCount(context)
        phase = if (ready == files.size) Phase.READY else Phase.IDLE
        detail = when {
            ready == files.size -> "${files.size} 个文件都在, 下的时候逐个对过 sha256"
            ready == 0 -> "还没下过, 一共约 ${mib(files.sumOf { it.bytes })}"
            else -> "只对了 $ready/${files.size} 个, 按一下补齐"
        }
    }

    /**
     * 下载缺的那几个, 每个都对 sha256, 收工把别的 .onnx 清掉
     *
     * **同步阻塞**: 调用方放在 IO 上 (设置页那边是 `withContext(Dispatchers.IO)`)。失败时抛, 抛出来
     * 的句子已经写清了是哪个镜像、哪一步, 界面直接念它
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
        val directory = LwWakeWord.directory(context)
        directory.mkdirs()
        val missing = files.filter { sizeOf(context, it) != it.bytes }
        pending = missing.sumOf { it.bytes }
        // 上次暂停留下的那几段算进来: 百分比接着涨, 不从 0 再走一遍
        received = missing.sumOf { File(directory, "${it.name}.part").length() }.coerceAtMost(pending)
        total = pending
        stop = Stop.RUN
        phase = Phase.DOWNLOADING
        detail = "正在下 ${missing.size} 个文件, 约 ${mib(pending)}"
        val fetched = mutableListOf<String>()
        try {
            for (item in missing) {
                fetch(item, File(directory, item.name))
                fetched += item.name
            }
        } catch (stopped: Stopped) {
            if (stopped.stop == Stop.CANCEL) {
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
        val pruned = prune(directory)
        phase = Phase.READY
        detail = buildString {
            append(
                if (fetched.isEmpty()) {
                    "${files.size} 个文件本来就在, 一个字节没下"
                } else {
                    val bytes = fetched.sumOf { name -> files.first { file -> file.name == name }.bytes }
                    "下好了 ${fetched.size} 个文件 (${mib(bytes)})"
                },
            )
            append(", 每个都对过 sha256")
            if (pruned.isNotEmpty()) append(", 顺手清掉另一套的 ${pruned.size} 个文件")
        }
        return detail
    }

    /**
     * 一个文件: 逐个镜像试, 有 `.part` 就走 Range 续传
     *
     * 被按停 (暂停 / 取消) 时不删 `.part`、也不记镜像的失败账 —— 那是人按的, 不是网络坏了
     */
    private fun fetch(item: Item, target: File) {
        val partial = File(target.parentFile, "${item.name}.part")
        val attempts = mutableListOf<String>()
        for (base in SOURCES) {
            try {
                fetchOnce(base, item, partial, target)
                return
            } catch (stopped: Stopped) {
                throw stopped
            } catch (error: Throwable) {
                partial.delete()
                attempts += "${runCatching { URL(base).host }.getOrDefault(base)}: ${error.message ?: error}"
            }
        }
        throw IllegalStateException("${item.name} 下不下来 (${attempts.joinToString("; ")})")
    }

    /** 一趟 HTTP: 从 `.part` 已有的字节数接着收, 收完整文件算一遍 sha256 */
    private fun fetchOnce(base: String, item: Item, partial: File, target: File) {
        val start = if (partial.exists()) partial.length() else 0L
        val current = (URL("$base/${item.name}").openConnection() as HttpURLConnection).apply {
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "Luwi")
            if (start > 0L) setRequestProperty("Range", "bytes=$start-")
        }
        connection = current
        try {
            val code = current.responseCode
            val resumed = code == HttpURLConnection.HTTP_PARTIAL
            if (code != HttpURLConnection.HTTP_OK && !resumed) throw IllegalStateException("HTTP $code")
            val append = resumed && start > 0L
            current.inputStream.use { input ->
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
            // 删的必须是**目标**那一条, 不是刚下好的 .part —— 2026-10-09 真机上踩过:
            // 这里原来写的是 partial.delete(), 源文件先没了, renameTo 于是必然回 false,
            // 两个镜像都下完、sha256 也对上, 界面却每次都说"下好了却放不到"
            target.delete()
            if (!partial.renameTo(target)) {
                throw IllegalStateException("下好了却放不到 ${target.absolutePath}")
            }
        } catch (error: Throwable) {
            // 连接是我们自己断的 (`pause` / `cancel`): 读上来的 IOException 不是"镜像坏了"
            if (error !is Stopped && stop != Stop.RUN) throw Stopped(stop)
            throw error
        } finally {
            connection = null
            runCatching { current.disconnect() }
        }
    }

    /** 整文件算一遍 (续传时不做增量, 几 MB 本地读一遍比"拼 sha256 状态"稳) */
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

    /** 只留 [files] 里那几个 .onnx: 另一套构建的残留会让"取到哪一套"说不清 */
    private fun prune(directory: File): List<String> {
        val keep = files.map { it.name }.toSet()
        val removed = mutableListOf<String>()
        directory.listFiles()?.forEach { file ->
            if (file.isFile && file.name.endsWith(".onnx") && file.name !in keep && file.delete()) {
                removed += file.name
            }
        }
        return removed
    }

    private fun sizeOf(context: Context, item: Item): Long =
        File(LwWakeWord.directory(context), item.name).length()

    private fun mib(bytes: Long): String = "%.1f MB".format(bytes / 1024.0 / 1024.0)

    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 60_000
}
