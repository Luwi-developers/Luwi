package io.github.yuloong07star.luwi.tool

import android.content.Context
import java.io.File
import java.security.MessageDigest
import java.util.Locale

/**
 * 朗读音频的合成缓存 (2026-11-10, 方案 `docs/Luwi-朗读与显示分离-方案-2026-11-09.md` §4.7)
 *
 * 为什么要有: Edge 那条是**联网合成**, 一段长回答要几百毫秒到几秒; 同一句话再念一次 (重播、重试、
 * 主人又叫了一声) 不该再连一趟网。缓存键是 `sha1(稿子 | 音色 | 语速)`, 命中就直接出声
 *
 * 落 `cacheDir/read/` —— 与 [LwVoiceClip] 放临时音频同一个目录, 但**文件名分得开**:
 * 这一层只认 `r-<sha1>.mp3`, 清理也只删这一种, 临时文件 (`lw-voice*.mp3`) 一个都不碰
 *
 * 上限 (方案 §4.7): 20 条 / 单条 200 KB, 先进先出。超了就按最后修改时间从旧的删
 */
internal object ReadCache {

    const val DIRECTORY = "read"

    /** 缓存条目名前缀: 与临时文件 (`lw-voice`) 分开, 清理时只认这一种 */
    private const val PREFIX = "r-"

    /** 上限: 20 条 / 单条 200 KB (方案 §4.7) */
    const val MAX_ENTRIES = 20
    const val MAX_BYTES = 200 * 1024

    fun directory(context: Context): File = File(context.cacheDir, DIRECTORY)

    /** 键: 稿子 + 音色 + 语速 (同一句话换个音色就是另一份音频, 不能共用) */
    fun key(text: String, voice: String, speed: Float): String {
        // 语速按两位小数写死 (Locale.US): 换个语言环境不会换出一个新键, 缓存才对得上
        val raw = "$text\u0001$voice\u0001${String.format(Locale.US, "%.2f", speed)}"
        val digest = MessageDigest.getInstance("SHA-1").digest(raw.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { byte -> String.format(Locale.US, "%02x", byte) }
    }

    fun file(context: Context, key: String): File = File(directory(context), "$PREFIX$key.mp3")

    /** 命中就给那份音频, 没有 / 读不动就是 null (调用方照常去合成) */
    fun read(context: Context, key: String): ByteArray? {
        val file = file(context, key)
        if (!file.isFile) return null
        return runCatching { file.readBytes() }.getOrNull()?.takeIf { it.isNotEmpty() }
    }

    /**
     * 存一份
     *
     * 超过单条上限的不存 (存了也不会命中); 存完顺手清一次旧的
     */
    fun write(context: Context, key: String, bytes: ByteArray): Boolean {
        if (bytes.isEmpty() || bytes.size > MAX_BYTES) return false
        val target = file(context, key)
        return runCatching {
            target.parentFile?.mkdirs()
            val temporary = File(target.parentFile, "${target.name}.tmp")
            temporary.writeBytes(bytes)
            if (!temporary.renameTo(target)) {
                target.writeBytes(bytes)
                temporary.delete()
            }
            sweep(context)
            true
        }.getOrDefault(false)
    }

    /** 现在有几条 / 一共多大 (设置页与 status 的读数) */
    fun entries(context: Context): List<File> {
        val directory = directory(context)
        if (!directory.isDirectory) return emptyList()
        return directory.listFiles()
            ?.filter { it.isFile && it.name.startsWith(PREFIX) && it.name.endsWith(".mp3") }
            ?.sortedBy { it.lastModified() }
            ?: emptyList()
    }

    fun bytes(context: Context): Long = entries(context).sumOf { it.length() }

    /** 先进先出: 超过 20 条或总量超了就删最旧的那几条 */
    fun sweep(context: Context) {
        val files = entries(context)
        if (files.isEmpty()) return
        var total = files.sumOf { it.length() }
        var count = files.size
        for (file in files) {
            if (count <= MAX_ENTRIES && total <= MAX_ENTRIES.toLong() * MAX_BYTES) break
            val size = file.length()
            if (file.delete()) {
                count -= 1
                total -= size
            }
        }
    }

    /** 清空 (设置页那个"清掉朗读缓存") */
    fun clear(context: Context): Int {
        var removed = 0
        for (file in entries(context)) if (file.delete()) removed += 1
        return removed
    }
}
