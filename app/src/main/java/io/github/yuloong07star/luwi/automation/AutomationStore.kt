package io.github.yuloong07star.luwi.automation

import android.content.Context
import io.github.yuloong07star.luwi.host.DshHost
import io.github.yuloong07star.luwi.tool.bytes
import io.github.yuloong07star.luwi.tool.normalizeArtifactName
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 这一批四处用的那一份 JSON 写法: 模型写的文件要能容错读, 我们写的要给人看得清 */
internal object AutomationJson {

    /** 读: 忽略不认识的键 (以后加参数不至于是破坏性改动), 键大小写照原样 */
    val reader = Json { ignoreUnknownKeys = true }

    /** 写: 缩进过的, 主人打开文件看得懂 */
    val writer = Json { prettyPrint = true; prettyPrintIndent = "  " }

    /**
     * 写一行: `history.jsonl` 是**一行一条**的追加格式
     *
     * 这一条踩过: 一开始历史也用 [writer] 那份缩进写法, 于是"一行一条"变成"一条占五行", 读者按行
     * 解析时一条都读不出来 —— 现象是"它明明响过, 而 `op=history` 说还没有任何判定"
     */
    val lines = Json

    fun parse(text: String): JsonObject =
        reader.parseToJsonElement(text) as? JsonObject
            ?: throw IllegalArgumentException("the rule has to be one JSON object")
}

/**
 * `$DSH_HOME/automations/` 那一份家
 *
 * 与快捷指令同一个理由落在 `$DSH_HOME` 而不是工作区: 规则要**应用与模型共用** (设置页列它、模型写它、
 * 引擎读它), 而会话自己的 `read` / `write` 被 dsh 的 fs 沙箱关在工作区里, `lw_files` 又只认工作区
 *
 * 四个文件各是一种职责, 谁都不许替别人写:
 *
 * | 文件 | 写者 | 读者 |
 * | :-- | :-- | :-- |
 * | `rules/<名字>.json` | 模型 (`write`) 与设置页那个开关 | 引擎 / 设置页 / `list` |
 * | `<名字>.json` (根目录) | **只读兼容一版** (2.8.0 之前的旧位置) | 引擎 / 设置页 / `list` |
 * | `rejected/<名字>.json` + `<名字>.error.txt` | 读到坏规则时复制 | 人排查 / 设置页可删 |
 * | `settings.json` | 设置页 | 引擎 / `status` |
 * | `history.jsonl` | 引擎 | 设置页 / `history` / 冷却与上限那两笔账 |
 * | `places.json` | 引擎 | 地点与天气两条条件 |
 */
internal object AutomationStore {

    /** 目录名: 与设置页、创建提示词、工具说明里说的都是它 */
    const val DIRECTORY = "automations"

    /** 新写只落这个子目录 (2.8.0 #25); 根目录那份是旧位置, 只读兼容一版 */
    const val RULES_DIRECTORY = "rules"

    /** 坏规则的诊断副本 (规则原文 + 一份错误说明) */
    const val REJECTED_DIRECTORY = "rejected"

    /** 坏规则旁边那份错误说明的后缀 */
    const val REJECTED_ERROR_SUFFIX = ".error.txt"

    const val SETTINGS_FILE = "settings.json"
    const val HISTORY_FILE = "history.jsonl"
    const val PLACES_FILE = "places.json"

    /** 一次最多列多少条 */
    private const val MAX_LISTED = 200

    /** 判定历史长到这么大就从头截一段 (够 2000 行上下) */
    private const val HISTORY_CAP_BYTES = 1 shl 20

    private const val HISTORY_KEEP_LINES = 1000

    /** 一次最多读回多少条历史 */
    const val MAX_HISTORY = 200

    /**
     * 十二个监测器 + 频率档 + 静默时段 (每日总次数上限 2.8.0 起取消)
     *
     * **「允许它自己动手」那道总闸 2026-11-07 撤了**: `task` 那一种从此直接执行, 旧文件里留着的
     * `allowActing` 由读盘那一步忽略, 下一次保存设置时自然消失
     */
    data class Settings(
        val monitors: Map<String, Boolean>,
        val weatherMinutes: Int,
        val placeMinutes: Int,
        val placeMeters: Int,
        val quietEnabled: Boolean,
        val quietWindow: String,
    ) {
        fun monitor(kind: String): Boolean = monitors[kind] ?: true
    }

    /** 一次判定留下的一行 */
    data class Fired(
        val at: Long,
        val rule: String,
        val kind: String,
        val hit: Boolean,
        val blocked: String?,
        val reason: String,
        val action: String?,
        val delivered: Boolean?,
        val count: Int,
        /** 设置页那个「立刻跑一次」: 它不算进 30 分钟闸那笔账, 历史里也标得出来 */
        val manual: Boolean = false,
    )

    /** 一条规则在磁盘上的样子: 读得出来就是 [rule], 读不出来就是 [problem] */
    data class Entry(val name: String, val rule: AutomationRule.Rule?, val problem: String?, val modified: Long)

    /** 这一份家的根: `settings.json` / `history.jsonl` / `places.json` 都在这 */
    fun directory(context: Context): File = File(File(context.filesDir, DshHost.HOME_DIR), DIRECTORY)

    /** 新写的规则只落这里 (2.8.0 #25) */
    fun rulesDirectory(context: Context): File = File(directory(context), RULES_DIRECTORY)

    /** 读不出来的规则会复制一份到这里 */
    fun rejectedDirectory(context: Context): File = File(directory(context), REJECTED_DIRECTORY)

    /** 规则文件的规范名字 (不带目录) */
    fun fileName(name: String): String =
        "${normalizeArtifactName(name, "an automatic command", ".json")}.json"

    /** 新写的那一份: 2.8.0 起一律在 `rules/` */
    fun file(context: Context, name: String): File = File(rulesDirectory(context), fileName(name))

    /** 2.8.0 之前的旧位置: 只读兼容, 不再往这里写 */
    fun legacyFile(context: Context, name: String): File = File(directory(context), fileName(name))

    /** 现在该读哪一份: 新目录优先, 旧目录兜底 */
    fun existingFile(context: Context, name: String): File? {
        val fileName = tolerantFileName(name)
        return File(rulesDirectory(context), fileName).takeIf { it.isFile }
            ?: File(directory(context), fileName).takeIf { it.isFile }
    }

    /** 名字不合规时也删得掉 / 也改得动 (坏规则或手写出来的文件名可能就是这样) */
    private fun tolerantFileName(name: String): String =
        runCatching { fileName(name) }.getOrElse { "$name.json" }

    /** 改一条现有规则时落盘的位置 (2.8.0 起一律 `rules/`) */
    private fun writeTarget(context: Context, name: String): File =
        File(rulesDirectory(context), tolerantFileName(name))

    /**
     * 这个文件是不是一条规则
     *
     * 同一个目录里还躺着 `settings.json` 与 `places.json` —— 它们也以 `.json` 结尾, 所以按后缀收会
     * 把它们当成规则去解析, 解析必然失败, 然后列表里就多出两条"坏掉的规则"(`BROKEN ...`), 主人点进去
     * 才发现那是设置。按名字排掉它们, 与后缀判断一起收在这一个地方
     */
    fun isRuleFile(name: String): Boolean =
        name.endsWith(".json") && name != SETTINGS_FILE && name != PLACES_FILE

    /** 一个目录里属于规则的那几个文件, 按名字排序 */
    fun ruleFiles(root: File): List<File> =
        (root.listFiles { file -> file.isFile && isRuleFile(file.name) } ?: emptyArray())
            .sortedBy { it.name }
            .take(MAX_LISTED)

    /** 一个目录里的规则名 (去掉 `.json`), 排序之后 */
    fun namesIn(root: File): List<String> = ruleFiles(root).map { it.name.removeSuffix(".json") }

    /** 两个目录合起来: `rules/` 优先, 旧根目录兜底 */
    fun mergedNames(primary: File, legacy: File): List<String> =
        (namesIn(primary) + namesIn(legacy)).distinct().sorted().take(MAX_LISTED)

    /** 现在的名字 (去掉 `.json`), 新 `rules/` 优先, 旧根目录也读 */
    fun names(context: Context): List<String> =
        mergedNames(rulesDirectory(context), directory(context))

    /**
     * 一个目录里的全部规则, 一条一行 (读不出来的也留着 —— 界面上要说得出"这一条坏了, 坏在哪")
     *
     * 每个文件都单独试: 一条坏的规则不该把整页变成空的。读不出来的那一份会被复制到 [rejected],
     * 原件不动 (主人还要能看到它、删掉它): 见 [copyRejected]
     */
    fun entriesIn(root: File, rejected: File? = null): List<Entry> =
        ruleFiles(root).map { file -> entryOf(file, rejected) }

    private fun entryOf(file: File, rejected: File?): Entry {
        val name = file.name.removeSuffix(".json")
        val raw = runCatching { file.readText() }.getOrNull()
            ?: return Entry(name, null, "the file could not be read", file.lastModified())
        return try {
            Entry(name, AutomationRule.parse(name, raw), null, file.lastModified())
        } catch (unreadable: Throwable) {
            val problem = unreadable.message ?: "unreadable"
            if (rejected != null) runCatching { copyRejected(rejected, name, raw, problem, file) }
            Entry(name, null, problem, file.lastModified())
        }
    }

    /** 两个目录合起来: 旧根目录先放, `rules/` 后放, 同名时新目录那一份说了算 */
    fun mergedEntries(rules: File, legacy: File, rejected: File? = null): List<Entry> {
        val merged = LinkedHashMap<String, Entry>()
        for (entry in entriesIn(legacy, rejected)) merged[entry.name] = entry
        for (entry in entriesIn(rules, rejected)) merged[entry.name] = entry
        return merged.values.sortedBy { it.name }.take(MAX_LISTED)
    }

    /** 全部规则: `rules/` 与旧根目录都在里面 (读不出来的也留着) */
    fun entries(context: Context): List<Entry> =
        mergedEntries(rulesDirectory(context), directory(context), rejectedDirectory(context))

    /**
     * 把读不出来的规则复制到 `rejected/`, 旁边再写一份 `.error.txt`
     *
     * 只复制不搬走: 原件还要在设置页里列着, 主人点一下才删。内容没变就不重写, 否则每次列规则
     * 都在改磁盘时间, 目录戳一直变, 引擎会跟着白重读
     */
    fun copyRejected(rejected: File, name: String, raw: String, problem: String, source: File? = null): File {
        rejected.mkdirs()
        val copy = File(rejected, "$name.json")
        if (!copy.isFile || copy.readText() != raw) copy.writeText(raw)
        val error = File(rejected, "$name$REJECTED_ERROR_SUFFIX")
        val message = (source?.absolutePath ?: "$name.json") + ": " +
            problem.trim().ifEmpty { "unreadable" } + "\n"
        if (!error.isFile || error.readText() != message) error.writeText(message)
        return copy
    }

    /** `rejected/` 里攒了几条坏规则 (设置页与 `status` 的读数) */
    fun rejectedCount(context: Context): Int =
        (rejectedDirectory(context).listFiles { file -> file.isFile && file.name.endsWith(".json") }
            ?: emptyArray()).size

    /** 能用的那些规则 (读不出来的不算) */
    fun rules(context: Context): List<AutomationRule.Rule> = entries(context).mapNotNull { it.rule }

    /** 一条按名字读 (新目录优先, 旧根目录兜底) */
    fun rule(context: Context, name: String): AutomationRule.Rule? {
        val file = existingFile(context, name) ?: return null
        return AutomationRule.parse(name, file.readText())
    }

    /**
     * 写一条 (新建或覆盖), 只写 `rules/`
     *
     * 写之前**先校验**: 校验不过的规则落下去只会在界面上变成"它从来没响过", 所以宁可当场拒
     */
    fun write(context: Context, name: String, json: String): Pair<File, List<String>> =
        writeTo(rulesDirectory(context), name, json)

    /** [write] 的那一段, 目标目录由调用方给 (测试拿临时目录, 不碰 Context) */
    fun writeTo(root: File, name: String, json: String): Pair<File, List<String>> {
        val rule = AutomationRule.parse(name, json)
        val file = File(root, fileName(name))
        file.parentFile?.mkdirs()
        file.writeText(AutomationJson.writer.encodeToString(JsonObject.serializer(), rule.toJson()) + "\n")
        val warnings = AutomationRule.unknownKeys(AutomationJson.parse(json))
            .map { "`$it` is not a key this version reads, so it was left out" }
        return file to warnings
    }

    /** 设置页那个开关: 只改 `enabled`, 其余原样写回 (旧根目录那一份会在这里落到 `rules/`) */
    fun setEnabled(context: Context, name: String, enabled: Boolean): Boolean {
        val rule = rule(context, name) ?: return false
        val file = writeTarget(context, name)
        file.parentFile?.mkdirs()
        file.writeText(
            AutomationJson.writer.encodeToString(
                JsonObject.serializer(),
                rule.copy(enabled = enabled).toJson(),
            ) + "\n",
        )
        return true
    }

    /**
     * 设置页那条**直接改冷却**: 只换 `cooldownMinutes`, 其余键一个都不动
     *
     * 主人 2026-10-09 要的是"由用户决定冷却闸多少时间后再次触发", 而新建那条路是投一句话让模型写
     * JSON —— 模型万一没照写, 主人按的那个数就不算数。所以除了新建时把数写进提示词, 这里再给一条
     * **不经过模型**的路: 读出现有那份 JSON, 只替换冷却这一个键, 过一遍与 `write` 同一道校验闸, 再
     * 原样落盘 (未知键也留着, 以后的版本加的键不会被这一条吃掉)
     *
     * 旧根目录读到的那一份也在 `rules/` 里写一份 (新写只写 `rules/`)
     */
    fun setCooldown(context: Context, name: String, minutes: Int): Boolean {
        val source = existingFile(context, name) ?: return false
        return runCatching {
            val root = AutomationJson.parse(source.readText())
            val next = AutomationRule.withCooldown(root, minutes)
            val text = AutomationJson.writer.encodeToString(JsonObject.serializer(), next)
            // 与模型那条 `write` 同一道闸: 一条已经坏了的规则不许被这一条"改成"另一条坏的
            AutomationRule.parse(name, text)
            val target = writeTarget(context, name)
            target.parentFile?.mkdirs()
            target.writeText(text + "\n")
            true
        }.getOrDefault(false)
    }

    /**
     * 删一条: 原件 (新旧两处)、`rejected/` 里的副本与 `.error.txt` 一起删
     *
     * 返回 true 只说"确实删掉了东西, 而且一处都没剩下"; 名字不合规的坏规则也删得掉
     */
    fun deleteIn(rules: File, legacy: File, rejected: File, name: String): Boolean {
        val fileName = tolerantFileName(name)
        val stem = fileName.removeSuffix(".json")
        val files = listOf(
            File(rules, fileName),
            File(legacy, fileName),
            File(rejected, fileName),
            File(rejected, "$stem$REJECTED_ERROR_SUFFIX"),
        )
        val existed = files.any { it.isFile }
        files.forEach { runCatching { it.delete() } }
        return existed && files.none { it.exists() }
    }

    fun delete(context: Context, name: String): Boolean =
        deleteIn(rulesDirectory(context), directory(context), rejectedDirectory(context), name)

    /**
     * 目录戳: 根目录 (settings / history / places) 或 `rules/` 变一下都要重读
     *
     * 只盯根目录会在迁移后失灵: 新写都进了 `rules/`, 根目录的时间不再变, 引擎就永远读旧规则
     */
    fun stamp(context: Context): Long {
        val root = directory(context)
        val rules = rulesDirectory(context)
        return maxOf(
            if (root.isDirectory) root.lastModified() else 0L,
            if (rules.isDirectory) rules.lastModified() else 0L,
        )
    }

    /** 设置那一份, 缺键按默认值 */
    fun settings(context: Context): Settings {
        val raw = runCatching { File(directory(context), SETTINGS_FILE).takeIf { it.isFile }?.readText() }
            .getOrNull()
        val root = raw?.let { runCatching { AutomationJson.parse(it) }.getOrNull() } ?: JsonObject(emptyMap())
        return settingsFrom(root)
    }

    /**
     * 那份设置从 JSON 到 [Settings] 的那一段, 单独拎出来是为了能测
     *
     * 两条容易错的地方都在这里: ①`monitors` 严格按 [AutomationRule.WATCH_KINDS] 展开, 文件里多写的未知键
     * 一律丢掉 (否则以后删掉的监测源会永远留着一行) ②缺键默认是"开", 所以老版本升上来不会静悄悄关掉监测
     */
    fun settingsFrom(root: JsonObject): Settings {
        val monitors = AutomationRule.objectOrEmpty(root["monitors"])
        return Settings(
            monitors = AutomationRule.WATCH_KINDS.associateWith { kind ->
                AutomationRule.boolOr(monitors[kind], true)
            },
            weatherMinutes = coerce(
                AutomationRule.intOr(root["weatherMinutes"], DEFAULT_WEATHER_MINUTES),
                WEATHER_CHOICES,
            ),
            placeMinutes = coerce(
                AutomationRule.intOr(root["placeMinutes"], DEFAULT_PLACE_MINUTES),
                PLACE_MINUTE_CHOICES,
            ),
            placeMeters = coerce(
                AutomationRule.intOr(root["placeMeters"], DEFAULT_PLACE_METERS),
                PLACE_METER_CHOICES,
            ),
            quietEnabled = AutomationRule.boolOr(root["quiet"]?.let { (it as? JsonObject)?.get("enabled") }, true),
            quietWindow = AutomationRule.stringOr(root["quiet"]?.let { (it as? JsonObject)?.get("window") }, DEFAULT_QUIET),
        )
    }

    fun saveSettings(context: Context, settings: Settings): File {
        val file = File(directory(context), SETTINGS_FILE)
        file.parentFile?.mkdirs()
        val root = buildJsonObject {
            put("monitors", buildJsonObject {
                settings.monitors.forEach { (kind, on) -> put(kind, on) }
            })
            put("weatherMinutes", settings.weatherMinutes)
            put("placeMinutes", settings.placeMinutes)
            put("placeMeters", settings.placeMeters)
            put("quiet", buildJsonObject {
                put("enabled", settings.quietEnabled)
                put("window", settings.quietWindow)
            })
        }
        file.writeText(AutomationJson.writer.encodeToString(JsonObject.serializer(), root) + "\n")
        return file
    }

    /** 追加一行判定; 文件太大就从尾部留一段重写 */
    fun appendHistory(context: Context, fired: Fired) {
        val file = File(directory(context), HISTORY_FILE)
        file.parentFile?.mkdirs()
        if (file.length() > HISTORY_CAP_BYTES) {
            val kept = file.readLines().takeLast(HISTORY_KEEP_LINES)
            file.writeText(kept.joinToString("\n", postfix = if (kept.isEmpty()) "" else "\n"))
        }
        val line = buildJsonObject {
            put("at", fired.at)
            put("rule", fired.rule)
            put("kind", fired.kind)
            put("hit", fired.hit)
            fired.blocked?.let { put("blocked", it) }
            put("reason", fired.reason)
            fired.action?.let { put("action", it) }
            fired.delivered?.let { put("delivered", it) }
            if (fired.manual) put("manual", true)
            if (fired.count > 1) put("count", fired.count)
        }
        file.appendText(AutomationJson.lines.encodeToString(JsonObject.serializer(), line) + "\n")
    }

    /** 最近若干条判定, 最新的在前 */
    fun history(context: Context, limit: Int = 20, rule: String? = null): List<Fired> {
        val file = File(directory(context), HISTORY_FILE)
        if (!file.isFile) return emptyList()
        return records(file.readText())
            .asReversed()
            .asSequence()
            .filter { rule == null || it.rule == rule }
            .take(limit.coerceIn(1, MAX_HISTORY))
            .toList()
    }

    /**
     * 冷启动时把"每一条规则上次真的响过的时刻"与"今天响了几次"读回来
     *
     * 这两笔账从历史里现算而不是记在规则文件里: 规则文件是模型与设置页都在写的那一份, 多一个写者
     * 就多一种打架的写法
     */
    fun counters(context: Context, today: String): Map<String, Pair<Long, Int>> {
        val file = File(directory(context), HISTORY_FILE)
        if (!file.isFile) return emptyMap()
        val last = HashMap<String, Long>()
        val todayCount = HashMap<String, Int>()
        for (fired in records(file.readText())) {
            if (fired.hit && fired.blocked == null) {
                last[fired.rule] = maxOf(last[fired.rule] ?: 0L, fired.at)
                if (AutomationRule.dayKey(fired.at) == today) {
                    todayCount[fired.rule] = (todayCount[fired.rule] ?: 0) + 1
                }
            }
        }
        return last.keys.union(todayCount.keys).associateWith { name ->
            (last[name] ?: 0L) to (todayCount[name] ?: 0)
        }
    }

    /**
     * 一份历史里的所有记录
     *
     * 按大括号配对切, 而不是按行切: 缩进过的那一份 (老写法留下的) 与一行一条的那一份读起来一样,
     * 而末尾那个写了一半的行也会被丢掉, 不会让整份文件读不出来
     */
    private fun records(text: String): List<Fired> {
        val found = mutableListOf<Fired>()
        var depth = 0
        var start = -1
        text.forEachIndexed { index, character ->
            when {
                character == '{' -> {
                    if (depth == 0) start = index
                    depth += 1
                }

                character == '}' -> {
                    depth -= 1
                    if (depth == 0 && start >= 0) {
                        runCatching { parseFired(text.substring(start, index + 1)) }
                            .getOrNull()
                            ?.let { found += it }
                        start = -1
                    }
                }
            }
        }
        return found
    }

    /** 一个地名缓存的经纬度 */
    data class Place(val latitude: Double, val longitude: Double, val at: Long)

    fun places(context: Context): Map<String, Place> {
        val file = File(directory(context), PLACES_FILE)
        if (!file.isFile) return emptyMap()
        val root = runCatching { AutomationJson.parse(file.readText()) }.getOrNull() ?: return emptyMap()
        return root.mapNotNull { (name, value) ->
            val entry = value as? JsonObject ?: return@mapNotNull null
            val lat = entry["lat"]?.toString()?.toDoubleOrNull() ?: return@mapNotNull null
            val lon = entry["lon"]?.toString()?.toDoubleOrNull() ?: return@mapNotNull null
            name to Place(lat, lon, entry["at"]?.toString()?.toLongOrNull() ?: 0L)
        }.toMap()
    }

    fun place(context: Context, name: String): Place? = places(context)[name]

    fun rememberPlace(context: Context, name: String, latitude: Double, longitude: Double, at: Long) {
        val file = File(directory(context), PLACES_FILE)
        file.parentFile?.mkdirs()
        val merged = LinkedHashMap<String, Place>()
        merged.putAll(places(context))
        merged[name] = Place(latitude, longitude, at)
        val root = buildJsonObject {
            merged.forEach { (place, value) ->
                put(place, buildJsonObject {
                    put("lat", value.latitude)
                    put("lon", value.longitude)
                    put("at", value.at)
                })
            }
        }
        file.writeText(AutomationJson.writer.encodeToString(JsonObject.serializer(), root) + "\n")
    }

    /** 一行历史 -> 那一条记录 */
    private fun parseFired(line: String): Fired {
        val root = AutomationJson.parse(line)
        return Fired(
            at = root["at"]?.toString()?.toLongOrNull() ?: 0L,
            rule = root["rule"]?.toString()?.trim('"').orEmpty(),
            kind = root["kind"]?.toString()?.trim('"').orEmpty(),
            hit = root["hit"]?.toString()?.toBooleanStrictOrNull() ?: false,
            blocked = root["blocked"]?.toString()?.trim('"')?.takeIf { it.isNotEmpty() },
            reason = root["reason"]?.toString()?.trim('"').orEmpty(),
            action = root["action"]?.toString()?.trim('"')?.takeIf { it.isNotEmpty() },
            delivered = root["delivered"]?.toString()?.toBooleanStrictOrNull(),
            count = root["count"]?.toString()?.toIntOrNull() ?: 1,
            manual = root["manual"]?.toString()?.toBooleanStrictOrNull() ?: false,
        )
    }

    /** 一行历史给人看的样子 (设置页那 10 条与 `history` 那个 op 都用它) */
    fun line(fired: Fired): String {
        val when_ = SimpleDateFormat("MM-dd HH:mm", Locale.US).format(Date(fired.at))
        val what = when {
            !fired.hit -> "没命中"
            fired.blocked != null -> "拦下了 (${fired.blocked})"
            else -> "做了"
        }
        return "$when_  ${fired.rule}  $what  ${fired.reason}" + if (fired.manual) " (手动)" else ""
    }

    /** 规则文件多大 (设置页那一行与 `read` 都用) */
    fun size(file: File): String = bytes(file.length())

    private fun coerce(value: Int, choices: List<Int>): Int =
        if (value in choices) value else choices.first()

    /** 天气多久问一次 (分钟) */
    val WEATHER_CHOICES = listOf(15, 30, 60, 180)
    const val DEFAULT_WEATHER_MINUTES = 60

    /** 位置多久要一次 (分钟) 与最小移动多少才要 (米) */
    val PLACE_MINUTE_CHOICES = listOf(5, 10, 30)
    const val DEFAULT_PLACE_MINUTES = 10
    val PLACE_METER_CHOICES = listOf(300, 500, 1000)
    const val DEFAULT_PLACE_METERS = 500

    /** 静默时段默认那一段 (解析复用 `PowerWindow`) */
    const val DEFAULT_QUIET = "23:00-07:00"
}
