package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.util.Log
import io.github.yuloong07star.luwi.channel.LwForgeExec
import io.github.yuloong07star.luwi.channel.PrivilegedChannel
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

/**
 * 开发工具链: **一份数据包**, 不是应用 (2026-11-17 主人改的口径)
 *
 * 三跳, 每一跳都只干一件事:
 *
 * 1. **下**: 从 [DevTools.toolchainUrls] 拿 `luwi-toolchain.zip` (113 MB) 到自己的外部目录
 *    —— 边读边数上限, 头两个字节得是 `PK`, 大小对不上不认
 * 2. **摊**: 解到同一目录下的 `unpacked/`, 逐条挡 `..` / 绝对路径 (线上包, 也得当成不可信的东西解)
 * 3. **装**: 读包里的 `toolchain.json` (逐文件 sha256), 交给特权进程的 `forge.stage` 搬进
 *    `/data/local/tmp/lwforge/toolchain` —— 那一步已经是现成的, 这一份只负责把来源换掉
 *
 * 为什么这条比"装一个伴侣 APK"好: 工具链没有界面、也拿不到任何系统权限, 它需要的东西只是一块能被
 * shell uid 执行的磁盘. 做成 application 要多过一道系统安装门 (HyperOS 还要登录小米账号), 换来的却是零
 */
internal object ToolchainPack {

    private const val TAG = "LwToolchainPack"

    /** 一次下载的上限: 113 MB 那一份足够, 400 MB 是"再大就不是它了" */
    private const val MAX_BYTES = 400L * 1024 * 1024

    /** 一条地址最多续几次 (每轮从已有字节接着下) */
    private const val ATTEMPTS = 8

    /** 搬运那一步的预算 (拷 245 MB + 逐文件 sha256) */
    private const val STAGE_TIMEOUT_MS = 300_000L

    /** 只认 https */
    private fun requireHttps(url: String) {
        if (!url.startsWith("https://", ignoreCase = true)) {
            throw IllegalArgumentException("只收 https 的链接, 这一条是 ${url.take(80)}")
        }
    }

    /**
     * 下载客户端
     *
     * **只用 HTTP/1.1**: 真机上直接连 github.com 走 h2 会得到一句
     * `Required SETTINGS preface not received` (2026-11-17 实测; 那条链路上有东西把 h2 的 preface 弄丢了),
     * 退回 1.1 就正常。113 MB 的单文件也不指望 h2 的多路复用
     */
    private val client = OkHttpClient.Builder()
        .protocols(listOf(okhttp3.Protocol.HTTP_1_1))
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS)
        .build()

    /** 现在装好没有, 一句话 (设置页那一行与 `op=status` 都读它) */
    fun status(context: Context): String {
        val answer = forgeStatus(context) ?: return "工具链: 没装 (点一下下载)"
        val lines = answer.output.lineSequence()
            .mapNotNull { line -> line.split('=', limit = 2).takeIf { it.size == 2 } }
            .associate { it[0] to it[1] }
        val installed = lines["installed"] == "true"
        if (!installed) return "工具链: 没装 (点一下下载)"
        val version = lines["version"].orEmpty()
        val files = lines["files"].orEmpty()
        return "工具链: 已就绪 $version · $files 个文件"
    }

    /**
     * 下载 + 摊开 + 装进特权区, **阻塞**: 调用方放在 IO 上
     *
     * 已经装好就直接回一句 —— 不重下 113 MB
     */
    fun install(context: Context, hosts: List<String> = DevTools.HOSTS): String {
        val before = forgeStatus(context)?.output.orEmpty()
        if (before.lineSequence().any { it.trim() == "installed=true" }) {
            return "工具链已经在: " + before.lineSequence().firstOrNull { it.startsWith("version=") }
                .orEmpty().removePrefix("version=")
        }
        val root = context.getExternalFilesDir("toolchain-pack")
            ?: return "这块设备上没有外部目录可放工具链包"
        root.mkdirs()
        val zip = File(root, DevTools.TOOLCHAIN_ASSET)
        val ready = zip.isFile && sha256(zip).equals(DevTools.TOOLCHAIN_SHA256, true)
        if (!ready) {
            val reasons = mutableListOf<String>()
            val urls = hosts.map { base -> "$base/${DevTools.TOOLCHAIN_ASSET}" }
            for ((index, url) in urls.withIndex()) {
                try {
                    downloadResumable(url, zip)
                    break
                } catch (error: Throwable) {
                    Log.w(TAG, "download from $url failed: ${error.message}")
                    reasons += "${url.substringAfter("://").substringBefore('/')}: ${error.message}"
                    // 同一台主机留下的半截包留着 (下一趟接着下); 换主机前要删掉, 两边的字节不能拼
                    if (index < urls.lastIndex) zip.delete()
                }
            }
            if (!zip.isFile || zip.length() == 0L) {
                return "工具链包没下下来: " + reasons.distinct().joinToString("; ").ifBlank { "没有可用地址" }
            }
        }
        return installFromZip(context, zip)
    }

    /**
     * 拿一份**已经在盘上的** zip 去装 (设置页「从文件导入」与 [install] 共用这一条)
     *
     * 先验整包 sha256 再解 —— 一份 113 MB 的工具链里放的是会被当可执行件跑的东西, 这一条不能省
     */
    fun installFromZip(context: Context, zip: File): String {
        if (!zip.isFile) return "这份 zip 不在: ${zip.absolutePath}"
        val digest = runCatching { sha256(zip) }.getOrDefault("")
        if (DevTools.TOOLCHAIN_SHA256.isNotBlank() && !digest.equals(DevTools.TOOLCHAIN_SHA256, true)) {
            return "工具链包的 sha256 对不上: 这一份是 ${digest.take(16)}…, 要的是 ${DevTools.TOOLCHAIN_SHA256.take(16)}…"
        }
        val root = zip.parentFile ?: return "这份 zip 没有落点"
        val unpacked = File(root, "unpacked")
        val unzipped = runCatching { unzip(zip, unpacked) }.getOrElse {
            return "工具链包解不开: ${it.message ?: it.javaClass.simpleName}"
        }
        val manifest = runCatching { readManifest(File(unpacked, LwForgeExec.MANIFEST_NAME)) }.getOrElse {
            return "包里的 ${LwForgeExec.MANIFEST_NAME} 读不动: ${it.message ?: it.javaClass.simpleName}"
        }
        if (manifest.files.isEmpty()) return "包里的清单是空的"
        val payload = JSONObject()
            .put("source", unpacked.absolutePath)
            .put("version", manifest.version)
            .put("files", JSONArray().apply {
                manifest.files.forEach { file ->
                    put(
                        JSONObject()
                            .put("path", file.path)
                            .put("sha256", file.sha256)
                            .put("bytes", file.bytes),
                    )
                }
            })
        val service = PrivilegedChannel.ensure()
            ?: return "要特权通道才能把工具链装进 ${LwForgeExec.TOOLCHAIN_DIRECTORY}: " +
                (PrivilegedChannel.state().error ?: "没有原因")
        val answer = service.linux(
            operation = "forge.stage",
            command = payload.toString(),
            work = LwForgeExec.TOOLCHAIN_DIRECTORY,
            timeoutMs = STAGE_TIMEOUT_MS,
            source = "",
            version = "",
        )
        if (answer.code == 0) {
            // 成功了就把 100 MB 级的两份中间物清掉: 留着的唯一作用是占地方
            zip.delete()
            unpacked.deleteRecursively()
        }
        return answer.output.ifBlank { if (answer.code == 0) "工具链装好了" else "工具链没装成 (exit ${answer.code})" }
    }

    /** 一次 `forge.status` 的结论 */
    private data class Status(val code: Int, val output: String)

    /** 问一次特权侧现在什么样 (通道不在线回 null) */
    private fun forgeStatus(context: Context): Status? {
        val service = PrivilegedChannel.ensure() ?: return null
        return runCatching {
            val answer = service.linux(
                operation = "forge.status",
                command = "",
                work = LwForgeExec.TOOLCHAIN_DIRECTORY,
                timeoutMs = 10_000L,
                source = "",
                version = "",
            )
            Status(answer.code, answer.output)
        }.getOrNull()
    }

    /** 一个文件的 sha256 (十六进制小写) */
    private fun sha256(file: File): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * 下到 [target]; 断了就按已有字节 `Range` 续, 最多 [ATTEMPTS] 轮
     *
     * 113 MB 在真机那条链路上**一次下不完** (2026-11-17 实测: 92 秒后 `unexpected end of stream`),
     * 所以这一条不是"再试一次"而是"从断点接着下" —— 与模型下载那两条同一个手法 (保留 `.part`, 发 Range)
     */
    private fun downloadResumable(url: String, target: File) {
        requireHttps(url)
        var expected = -1L
        var attempt = 0
        while (attempt < ATTEMPTS) {
            attempt += 1
            val have = if (target.isFile) target.length() else 0L
            val request = Request.Builder()
                .url(url)
                .header("Accept", "*/*")
                .apply { if (have > 0) header("Range", "bytes=$have-") }
                .build()
            try {
                client.newCall(request).execute().use { response ->
                    if (response.code == 206) {
                        val range = response.header("Content-Range").orEmpty()
                        val total = range.substringAfter('/', "-1").trim().toLongOrNull() ?: -1L
                        if (total > 0) expected = total
                        response.body.byteStream().use { input ->
                            java.io.FileOutputStream(target, true).use { sink -> input.copyTo(sink) }
                        }
                    } else if (response.isSuccessful) {
                        expected = response.body.contentLength()
                        target.outputStream().use { sink -> response.body.byteStream().use { it.copyTo(sink) } }
                    } else {
                        throw IllegalStateException("这个链接回了 ${response.code}")
                    }
                }
            } catch (error: Throwable) {
                Log.w(TAG, "download attempt $attempt/$ATTEMPTS from $url failed at ${target.length()} bytes: ${error.message}")
                if (attempt >= ATTEMPTS) throw error
                Thread.sleep(1_500L)
                continue
            }
            if (expected <= 0 || target.length() >= expected) break
            Log.i(TAG, "download attempt $attempt got ${target.length()} / $expected, resuming")
        }
        val gone = expected - target.length()
        if (expected > 0 && gone != 0L) {
            throw IllegalStateException("下的字节数对不上: ${target.length()} / $expected (差 $gone)")
        }
        if (target.length() > MAX_BYTES) throw IllegalStateException("包太大: ${target.length()} 字节")
        val head = ByteArray(2)
        target.inputStream().use { it.read(head) }
        if (head[0] != 'P'.code.toByte() || head[1] != 'K'.code.toByte()) {
            throw IllegalStateException("这不是一份 zip (头两个字节不是 PK)")
        }
        Log.i(TAG, "downloaded $url -> ${target.length()} bytes in $attempt attempt(s)")
    }

    /** 解到 [destination]; 逐条挡穿越 —— 线上包也要当成不可信的东西 */
    private fun unzip(zip: File, destination: File) {
        destination.deleteRecursively()
        destination.mkdirs()
        var count = 0
        ZipInputStream(zip.inputStream().buffered()).use { input ->
            while (true) {
                val entry = input.nextEntry ?: break
                val name = entry.name.replace('\\', '/')
                if (name.startsWith("/") || name.split('/').any { it == ".." }) {
                    throw IllegalStateException("包里有不老实的路径: $name")
                }
                val out = File(destination, name)
                if (entry.isDirectory) {
                    out.mkdirs()
                } else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { sink -> input.copyTo(sink) }
                    count += 1
                }
                input.closeEntry()
            }
        }
        if (count == 0) throw IllegalStateException("包里一个文件都没有")
        Log.i(TAG, "unpacked $count files into ${destination.absolutePath}")
    }

    /** `toolchain.json` 的三样 */
    private data class Manifest(val version: String, val files: List<FileEntry>)
    private data class FileEntry(val path: String, val sha256: String, val bytes: Long)

    private fun readManifest(file: File): Manifest {
        if (!file.isFile) throw IllegalStateException("没有 ${file.name}")
        val root = JSONObject(file.readText())
        val array = root.optJSONArray("files") ?: JSONArray()
        val files = (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val path = item.optString("path")
            val sha = item.optString("sha256")
            if (path.isEmpty() || sha.length != 64) return@mapNotNull null
            FileEntry(path, sha.lowercase(), item.optLong("bytes", 0L))
        }
        return Manifest(root.optString("version").ifBlank { "unknown" }, files)
    }
}
