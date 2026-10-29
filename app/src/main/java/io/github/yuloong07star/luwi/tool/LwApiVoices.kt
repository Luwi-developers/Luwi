package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.os.FileObserver
import io.github.yuloong07star.luwi.host.DshHost
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * 「设计出来的音色」那一份登记表: `$DSH_HOME/lw/tts-voices.json`
 *
 * 为什么要有这一份文件: API 那条朗读走的是**服务商的音色标识**, 而"设计一个音色"是服务商自己的
 * 能力 (有的家叫音色设计, 有的家叫声音复刻), 应用这一侧不绑定任何一家 —— 于是这里只认一个约定:
 * **服务商给的音色标识登记进来, 应用在音色选择里把它列出来**
 *
 * **谁来写** (2026-10-25): 会话自己的 `read` / `write` 被 dsh 的 fs 沙箱关在工作区里, 看不到
 * `$DSH_HOME` (与快捷指令 / 自动指令同一个道理), 所以登记走 **`lw_speak op=voice action=add`**,
 * 由应用代写 (原子的 `.tmp` + rename); 手改文件也行, 应用下次读的时候照格式认
 *
 * 形状 (版本只认 1):
 *
 * ```json
 * {"v":1,"voices":[{"id":"luwi-soft-01","name":"柔声","model":"cosyvoice-v3-plus","note":"女声, 偏轻"}]}
 * ```
 *
 * `model` 是可选的**逐音色模型**: 有的服务商把设计出来的音色挂在另一个模型上, 这一条给了就只对这一条
 * 生效, 没给就用设置页那个模型
 *
 * 上限与取舍都写死在 [parse] / [merge] 里 (条数 / 字段长度 / 重复 id 后者覆盖), 于是没有设备也能量
 * (见 LwApiVoicesTest)
 */
internal object LwApiVoices {

    /** 文件名: 与接口文档里写的同一个约定 (谁都不许单边改) */
    const val FILE = "tts-voices.json"

    /** 最多认多少条: 音色选择是一列可点的行, 再多也不像一张能用的列表了 */
    private const val MAX_VOICES = 32

    /** 整份文件的上限: 再大就不是"一张音色表", 而是别人传错了东西 */
    private const val MAX_BYTES = 256 * 1024

    private const val MAX_ID = 128
    private const val MAX_NAME = 48
    private const val MAX_MODEL = 128
    private const val MAX_NOTE = 120

    /** 登记与撤销是"读整份-改-写回去", 两条同时来会把一条挤掉 */
    private val lock = Any()

    /** 一条登记: [name] 一定非空 (缺省时 [parse] 用 id 填上), 所以显示直接用它 */
    internal data class Entry(
        val id: String,
        val name: String,
        val model: String,
        val note: String,
    ) {
        /** 列表里显示哪个名字 */
        val display: String get() = name.ifBlank { id }
    }

    /**
     * 一次读的答案
     *
     * [note] 不为空表示这份文件有问题 (读不出来 / 不是 JSON / 版本不对 / 有被跳过的条目), 设置页与
     * `lw_speak op=status` 都把这句话照原样报出去 —— 于是"为什么列表是空的"永远看得到
     */
    internal data class Snapshot(val entries: List<Entry>, val note: String)

    /** `$DSH_HOME/lw/tts-voices.json` */
    fun file(context: Context): File = File(DshHost.settingsDirectory(context), FILE)

    /** 读一次: 文件不在就是空表 (那是最常见的一种正常状态, 不算错) */
    fun read(context: Context): Snapshot {
        val source = file(context)
        if (!source.isFile) return Snapshot(emptyList(), "")
        if (source.length() > MAX_BYTES) {
            return Snapshot(emptyList(), "$FILE 超过 ${MAX_BYTES / 1024} KiB, 整份没有采用")
        }
        val raw = try {
            source.readText()
        } catch (error: Throwable) {
            return Snapshot(emptyList(), "$FILE 读不出来: ${error.message ?: error}")
        }
        return parse(raw)
    }

    /**
     * 按 id 找一条, 找不到再按显示名找
     *
     * 两种都收是因为 [lw_speak][LwSpeak] 那边点名要的是"一条音色", 而人/模型手里可能是 id 也可能是
     * 列表上那个名字 —— 两样都试一次, 比要求调用方记住哪一种要少一次错
     */
    fun find(context: Context, wanted: String?): Entry? {
        val key = wanted?.trim().orEmpty()
        if (key.isEmpty()) return null
        val entries = read(context).entries
        return entries.firstOrNull { it.id == key } ?: entries.firstOrNull { it.name == key }
    }

    /** 这一条音色指定的模型; 没有就是 null (调用方回落到设置页那个模型) */
    fun modelFor(context: Context, wanted: String?): String? =
        find(context, wanted)?.model?.takeIf { it.isNotBlank() }

    /**
     * 登记一条 (由 `lw_speak op=voice action=add` 走到这里)
     *
     * 同一个 id 再登记一次就是**更新** (服务商那边重新设计了一版, 还叫原来的 id)
     */
    fun add(
        context: Context,
        id: String,
        name: String,
        model: String,
        note: String,
    ): Entry {
        val cleanId = id.trim()
        require(cleanId.isNotEmpty()) { "a voice needs an id" }
        require(cleanId.length <= MAX_ID) { "the voice id has to stay within $MAX_ID characters" }
        val entry = Entry(
            id = cleanId,
            name = name.trim().take(MAX_NAME).ifBlank { cleanId },
            model = model.trim().take(MAX_MODEL),
            note = note.trim().take(MAX_NOTE),
        )
        synchronized(lock) {
            val target = file(context)
            val raw = target.takeIf { it.isFile }?.readText()
            write(target, merge(raw, entry))
        }
        return entry
    }

    /** 撤销一条 (id 或登记名); 回 true 表示真的删了一条 */
    fun remove(context: Context, wanted: String): Boolean {
        val key = wanted.trim()
        if (key.isEmpty()) return false
        synchronized(lock) {
            val target = file(context)
            val raw = target.takeIf { it.isFile }?.readText()
            val (text, removed) = prune(raw, key)
            if (removed) write(target, text)
            return removed
        }
    }

    /**
     * 纯合并: 返回整份新文件的内容 (没有设备也能量)
     *
     * 这份文件读不懂时**拒绝写**而不是覆盖: 覆盖等于把读不懂的那几条一起删掉, 而它们可能只是某条
     * 字段写错 —— 让调用方先去修, 比替它做决定要好
     */
    internal fun merge(raw: String?, entry: Entry): String {
        val existing = readable(raw)
        val kept = existing.filterNot { it.id == entry.id }
        if (kept.size >= MAX_VOICES) {
            throw IllegalStateException("the voice library already holds $MAX_VOICES voices; remove one first")
        }
        return encode(kept + entry)
    }

    /** 纯撤销: 返回 (新内容, 是否真的删了一条); 读不懂时抛 (理由同 [merge]) */
    internal fun prune(raw: String?, wanted: String): Pair<String, Boolean> {
        val existing = readable(raw)
        val kept = existing.filterNot { it.id == wanted || it.name == wanted }
        if (kept.size == existing.size) return (raw.orEmpty() to false)
        return (encode(kept) to true)
    }

    /** 读得懂的那几条; 读不懂就抛一句人话 (拒绝在坏文件上做增量) */
    private fun readable(raw: String?): List<Entry> {
        if (raw.isNullOrBlank()) return emptyList()
        val parsed = parse(raw)
        if (parsed.entries.isEmpty() && parsed.note.isNotEmpty()) {
            throw IllegalStateException("the voice library could not be read (${parsed.note}); fix or clear it first")
        }
        return parsed.entries
    }

    /** 整份写回去时用的形状 (只写认识的字段, 顺序固定, 人读也顺) */
    internal fun encode(entries: List<Entry>): String = buildJsonObject {
        put("v", 1)
        putJsonArray("voices") {
            entries.forEach { one ->
                addJsonObject {
                    put("id", one.id)
                    if (one.name.isNotBlank() && one.name != one.id) put("name", one.name)
                    if (one.model.isNotBlank()) put("model", one.model)
                    if (one.note.isNotBlank()) put("note", one.note)
                }
            }
        }
    }.toString()

    /** 先写 `.tmp` 再改名: 读的那个时刻要么是旧一份, 要么是新一份 */
    private fun write(target: File, text: String) {
        target.parentFile?.mkdirs()
        val temp = File(target.parentFile, "$FILE.tmp")
        temp.writeText(text)
        if (!temp.renameTo(target)) {
            target.writeText(text)
            temp.delete()
        }
    }

    /**
     * 纯解析 (没有设备也能量)
     *
     * 坏的那几条**跳过而不是整份作废**: 一份表里有一条写错了, 不该把别的能用的音色一起带走
     */
    internal fun parse(raw: String?): Snapshot {
        // 空文件与"一条都没登记"都是正常状态 (agent 可能先建个空壳), 不算错
        if (raw.isNullOrBlank()) return Snapshot(emptyList(), "")
        val root = runCatching { Json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
            ?: return Snapshot(emptyList(), "$FILE 不是 JSON 对象")
        val version = runCatching { root["v"]?.jsonPrimitive?.intOrNull }.getOrNull()
        if (version != null && version != 1) {
            return Snapshot(emptyList(), "$FILE 的 v 是 $version, 只认 1, 整份没有采用")
        }
        val rows = root["voices"] as? JsonArray
            ?: return Snapshot(emptyList(), "$FILE 里没有 voices 这个数组")
        val notes = mutableListOf<String>()
        val kept = LinkedHashMap<String, Entry>()
        var skipped = 0
        rows.forEach { row ->
            val one = row as? JsonObject ?: run { skipped += 1; return@forEach }
            val id = one.text("id")
            if (id.isEmpty()) {
                skipped += 1
                return@forEach
            }
            if (id.length > MAX_ID) {
                skipped += 1
                return@forEach
            }
            val name = one.text("name").take(MAX_NAME).ifBlank { id }
            val model = one.text("model")
            val usableModel = if (model.length <= MAX_MODEL) model else ""
            // 后出现的同 id 覆盖先出现的: "最后写的那条算数"是更容易解释的一条规矩
            kept[id] = Entry(id, name, usableModel, one.text("note").take(MAX_NOTE))
        }
        if (skipped > 0) notes += "跳过 $skipped 条 (缺 id / id 太长 / 不是对象)"
        val entries = kept.values.toList()
        if (entries.isEmpty() && skipped == 0) return Snapshot(emptyList(), "")
        val capped = entries.take(MAX_VOICES)
        if (entries.size > MAX_VOICES) notes += "只取前 $MAX_VOICES 条 (文件里有 ${entries.size} 条)"
        return Snapshot(capped, notes.joinToString("; "))
    }

    /** 一条里的字符串字段 (认不出/不是字符串都是空串) */
    private fun JsonObject.text(key: String): String =
        runCatching { this[key]?.jsonPrimitive?.contentOrNull }.getOrNull().orEmpty().trim()

    /**
     * 盯着 `$DSH_HOME/lw` 那个目录: 文件一改就叫醒 (inotify, 与球状态那一份同一个写法)
     *
     * 盯目录而不是盯文件: 文件可能还不存在 (agent 一次都没写过), 而原子写出来的是 `MOVED_TO` ——
     * 直接盯文件只能拿到第一次那个 inode 的事
     */
    internal class Watch(private val onChanged: () -> Unit) {

        private var observer: FileObserver? = null

        fun start(context: Context) {
            if (observer != null) return
            val directory = DshHost.settingsDirectory(context)
            val created = object : FileObserver(directory, MASK) {
                override fun onEvent(event: Int, name: String?) {
                    if (name != null && name != FILE && name != "$FILE.tmp") return
                    onChanged()
                }
            }
            observer = created
            created.startWatching()
        }

        fun stop() {
            observer?.stopWatching()
            observer = null
        }

        private companion object {
            /** 直接写走 `CLOSE_WRITE`, 原子写走 `MOVED_TO`, 新文件走 `CREATE` */
            private const val MASK =
                FileObserver.CLOSE_WRITE or FileObserver.MOVED_TO or FileObserver.CREATE
        }
    }
}
