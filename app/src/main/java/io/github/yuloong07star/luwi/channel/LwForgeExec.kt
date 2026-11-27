package io.github.yuloong07star.luwi.channel

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * 手机应用工坊在特权进程这一侧的地基 (2.8.1): 工具链的落位与复核
 *
 * 三件事, 全都在 `/data/local/tmp/lwforge/` 底下:
 *
 * 1. `stage`: 把「安卓开发工具」摊在自己外部目录里的那一份工具链 (JDK / aapt2 / d8 / apksigner /
 *    android.jar) 逐文件搬进 `toolchain/`, **边搬边算 sha256**, 与清单一条条对上才算数
 * 2. `status`: 装没装 / 版本 / 文件数 / 体积 —— 判据与设置页都读这一份
 * 3. `build`: 见 [LwForgeBuild]
 *
 * 为什么二进制放这儿而不是 rootfs 里: 工具链是 bionic 的, 进不了 musl 的 proot; 而 `/data/local/tmp`
 * 是特权 uid (shell) 能 exec 的真文件系统. **不是安全边界** —— 能写这个目录的人本来就能让特权进程跑东西,
 * 边界在"谁能调这一条" (只有应用那一侧过桥) 与"路径白名单" (这一份文件)
 *
 * `work/` 放中间产物: `/sdcard` 是 FUSE, exec 位与符号链接都不完整, 编译不了东西
 */
internal object LwForgeExec {

    private const val TAG = "LwForge"

    /** 工坊的家 */
    const val BASE_DIRECTORY = "/data/local/tmp/lwforge"

    /** 工具链落点 (清单也在里面: `toolchain.json`) */
    const val TOOLCHAIN_DIRECTORY = "$BASE_DIRECTORY/toolchain"

    /** 中间产物: 一次构建一个 `<sha1(项目路径)>/` (构建完不删, 下次覆盖) */
    const val WORK_DIRECTORY = "$BASE_DIRECTORY/work"

    /** 签名密钥: `debug.jks` + `pass` (0600) */
    const val KEYS_DIRECTORY = "$BASE_DIRECTORY/keys"

    /** 装好之后写戳: 内容就是这个版本串 */
    const val STAMP_FILE = "$BASE_DIRECTORY/stamp"

    /** 工具链在 `toolchain/` 里的清单文件名 */
    const val MANIFEST_NAME = "toolchain.json"

    /** 一次 stage 最多搬多少文件 (一个 JDK 大约几千个, 一万是宽到不能再宽的上限) */
    private const val MAX_FILES = 12_000

    /** 清单里的一条 */
    data class Entry(val path: String, val sha256: String, val bytes: Long)

    /**
     * 搬一次工具链
     *
     * @param source 工具 APK 摊出来的那个目录 (绝对路径; 只认外部目录与 /data/local/tmp 两类)
     * @param version 版本串 (`toolchain.json` 的 version)
     * @param entries 清单; 空表直接拒 —— "没带工具链"不该被当成装好了
     */
    fun stage(source: String, version: String, entries: List<Entry>): LwLinuxSandbox.Outcome {
        if (entries.isEmpty()) return LwLinuxSandbox.Outcome(2, "清单是空的: 那一份 APK 里没带工具链")
        if (entries.size > MAX_FILES) {
            return LwLinuxSandbox.Outcome(2, "清单有 ${entries.size} 条, 超过 $MAX_FILES 这一档")
        }
        sourceProblem(source)?.let { return LwLinuxSandbox.Outcome(2, it) }
        val from = File(source)
        val target = File(TOOLCHAIN_DIRECTORY)
        target.mkdirs()

        var copied = 0
        var kept = 0
        val problems = mutableListOf<String>()
        entries.forEach { entry ->
            val origin = File(from, entry.path)
            val out = File(target, entry.path)
            shapeProblem(entry.path)?.let {
                problems += it
                return@forEach
            }
            if (!origin.isFile) {
                problems += "${entry.path} 在那个目录里不存在"
                return@forEach
            }
            if (origin.length() != entry.bytes && entry.bytes > 0) {
                problems += "${entry.path} 的体积与清单不符 (${origin.length()} vs ${entry.bytes})"
                return@forEach
            }
            // 已经对得上就不重搬: 一次 100 MB 的复制不值得每问一次再来一遍
            if (out.isFile && out.length() == origin.length() && sha256(out).equals(entry.sha256, true)) {
                kept += 1
                out.setExecutable(true, false)
                return@forEach
            }
            val parent = out.parentFile
            if (parent != null && !parent.isDirectory && !parent.mkdirs()) {
                problems += "${entry.path} 的目录建不出来"
                return@forEach
            }
            runCatching {
                origin.inputStream().use { input -> out.outputStream().use { sink -> input.copyTo(sink) } }
            }.onFailure {
                problems += "${entry.path} 搬不动: ${it.message ?: it.javaClass.simpleName}"
                return@forEach
            }
            val digest = runCatching { sha256(out) }.getOrElse {
                problems += "${entry.path} 搬完读不回: ${it.message ?: it.javaClass.simpleName}"
                return@forEach
            }
            if (!digest.equals(entry.sha256, ignoreCase = true)) {
                out.delete()
                problems += "${entry.path} 的 sha256 对不上 (搬过来是 ${digest.take(12)}…)"
                return@forEach
            }
            out.setExecutable(true, false)
            copied += 1
        }
        if (problems.isNotEmpty()) {
            Log.w(TAG, "stage problems: ${problems.take(5)}")
            return LwLinuxSandbox.Outcome(
                2,
                "工具链没装全 (搬了 $copied 个, 已有 $kept 个): ${problems.take(4).joinToString("; ")}",
            )
        }
        writeManifest(target, version, entries)
        File(STAMP_FILE).writeText(version)
        val bytes = entries.sumOf { it.bytes }
        Log.i(TAG, "toolchain staged: $version, ${entries.size} files, $bytes bytes (moved $copied, kept $kept)")
        return LwLinuxSandbox.Outcome(
            0,
            "工具链就位: $version · ${entries.size} 个文件 · ${bytes / (1024 * 1024)} MB (新搬 $copied 个)",
        )
    }

    /**
     * `forge.stage` 的入口: 应用那一侧把 source / version / files 打成一段 JSON 送过来
     *
     * 解析坏一条就只丢那一条 (并让 [stage] 的清单为空时开口拒), 不把整段当成"没带工具链"
     */
    fun stageFromJson(payload: String): LwLinuxSandbox.Outcome {
        val json = runCatching { JSONObject(payload) }.getOrElse {
            return LwLinuxSandbox.Outcome(2, "forge.stage 的参数不是 JSON: ${it.message ?: it.javaClass.simpleName}")
        }
        val array = json.optJSONArray("files") ?: JSONArray()
        val entries = (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val path = item.optString("path")
            val sha = item.optString("sha256")
            if (path.isEmpty() || sha.length != 64) return@mapNotNull null
            Entry(path, sha.lowercase(), item.optLong("bytes", 0L))
        }
        return stage(
            source = json.optString("source"),
            version = json.optString("version").ifBlank { "unknown" },
            entries = entries,
        )
    }

    /** 装没装 / 版本 / 文件数 / 体积, 一行一个键 (与 Linux 沙盒那一条同一个格式) */
    fun status(): LwLinuxSandbox.Outcome {
        val stamp = File(STAMP_FILE)
        val manifest = readManifest()
        val root = File(TOOLCHAIN_DIRECTORY)
        val installed = stamp.isFile && root.isDirectory && manifest.isNotEmpty() &&
            manifest.all { File(root, it.path).isFile }
        val text = buildString {
            append("installed=").append(installed).append('\n')
            append("version=").append(if (stamp.isFile) runCatching { stamp.readText().trim() }.getOrDefault("") else "")
                .append('\n')
            append("files=").append(manifest.size).append('\n')
            append("sizeKb=").append(manifest.sumOf { it.bytes } / 1024).append('\n')
            append("root=").append(TOOLCHAIN_DIRECTORY)
        }
        return LwLinuxSandbox.Outcome(if (installed) 0 else 2, text)
    }

    /** 清单读回来 (读不动就是空表: "没装"与"读不出来"在这一条上走同一条路, 状态行里说得清) */
    fun readManifest(): List<Entry> {
        val file = File(TOOLCHAIN_DIRECTORY, MANIFEST_NAME)
        if (!file.isFile) return emptyList()
        return runCatching {
            val root = JSONObject(file.readText())
            val array = root.optJSONArray("files") ?: JSONArray()
            (0 until array.length()).mapNotNull { index ->
                val item = array.optJSONObject(index) ?: return@mapNotNull null
                val path = item.optString("path")
                val sha = item.optString("sha256")
                if (path.isEmpty() || sha.length != 64) return@mapNotNull null
                Entry(path, sha.lowercase(), item.optLong("bytes", 0L))
            }
        }.getOrDefault(emptyList())
    }

    /** `toolchain.json`: 与工具 APK 那一侧同一个形状, 换一份写在这边 */
    private fun writeManifest(target: File, version: String, entries: List<Entry>) {
        val files = entries.joinToString(",") { entry ->
            """{"path":"${entry.path}","sha256":"${entry.sha256}","bytes":${entry.bytes}}"""
        }
        File(target, MANIFEST_NAME).writeText("""{"v":1,"version":"$version","files":[$files]}""")
    }

    /**
     * 一条路径能不能当工具链里的一条
     *
     * 只放行"相对路径 + 字母数字与 `._/-`": `..`、绝对路径、控制字符、反斜杠都不行 —— 这些拼进
     * `File(root, path)` 之后会把目标带到 root 外面去, 而这里搬的是会当可执行件跑的东西
     */
    fun shapeProblem(path: String): String? {
        if (path.isBlank()) return "空路径"
        if (path.length > 300) return "路径太长: ${path.take(40)}…"
        if (path.startsWith("/") || path.contains('\\')) return "路径不许是绝对的或带反斜杠: $path"
        if (path.split('/').any { it == ".." || it == "." || it.isEmpty() }) return "路径里有 .. / . / 空段: $path"
        // `+` 要在白名单里: libc++_shared.so 这类名字带它, 而它与路径穿越无关
        if (!path.matches(Regex("[A-Za-z0-9._+/-]+"))) return "路径里有用不上的字符: $path"
        return null
    }

    /** 工具 APK 摊出来的那个目录能不能读: 只认外部目录与 /data/local/tmp, 其余一句拒 */
    fun sourceProblem(source: String): String? {
        if (source.isBlank() || !source.startsWith("/")) return "source 要是绝对路径"
        // `/sdcard` 与 `/storage/emulated/0` 是同一块盘的两种写法 (应用侧报给这里的是后者),
        // `/storage/emulated/<user>/...` 也一样 —— 三种都认, 但仍然要求落在外部目录里
        val allowed = listOf(
            "/sdcard/Android/data/",
            "/sdcard/Android/media/",
            "/storage/emulated/0/Android/data/",
            "/storage/emulated/0/Android/media/",
            "/data/local/tmp/lwforge/",
        )
        if (allowed.none { source.startsWith(it) }) {
            return "source 只认外部目录或 /data/local/tmp/lwforge/ 底下, 不认 $source"
        }
        if (!File(source).isDirectory) return "source 不是目录: $source"
        return null
    }

    /** 一个文件的 sha256 (十六进制小写) */
    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
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
}
