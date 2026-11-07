package io.github.yuloong07star.luwi.tool

import android.content.Context
import io.github.yuloong07star.luwi.host.DshHost
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.buildJsonArray
import java.io.File

/**
 * 「她记着你哪些事」那一份 (2026-11-07)
 *
 * 落 `$DSH_HOME/lw/wishes.json`, **平时由宿主写** (`lw_wish op=add`, 见 host-plugin), 判断层
 * (`judgeRouter`) 读它决定"今天该不该提一句"。这里存在只有一个用处: **设置页那一节要能看、能忘** ——
 * 于是它有两个写者, 而两边都只做"整份读、整份写", 撞上的几率按主人的点按频率算可以忽略; 真撞上时
 * 以最后写入为准 (这一份不是账, 丢一条不大于少提醒一次)
 *
 * 形状 (与宿主那一侧逐字对齐):
 *
 * ```json
 * { "v": 1, "at": 1759600000000, "items": [
 *   { "id": "w1abc", "what": "考四级", "due": "2026-12-14", "hint": "晚上提醒背单词",
 *     "said": ["2026-11-05"], "snoozeUntil": 0, "madeAt": 1759500000000 }
 * ] }
 * ```
 */
internal object Wishes {

    private const val DIRECTORY = "lw"
    private const val FILE_NAME = "wishes.json"

    private val json = Json { ignoreUnknownKeys = true }

    /** 一条记着的事 */
    data class Item(
        val id: String,
        val what: String,
        val due: String,
        val said: List<String>,
        val snoozeUntil: Long,
    )

    fun file(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), "$DIRECTORY/$FILE_NAME")

    /** 现在记着哪几件 (读不到 / 读坏了都是空表: 那一节写"还没记着"就好, 不该让设置页崩) */
    fun list(context: Context): List<Item> {
        val raw = runCatching { file(context).takeIf { it.isFile }?.readText() }.getOrNull() ?: return emptyList()
        val root = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return emptyList()
        val items = runCatching { root["items"]?.jsonArray }.getOrNull() ?: return emptyList()
        return items.mapNotNull { element ->
            val one = runCatching { element.jsonObject }.getOrNull() ?: return@mapNotNull null
            val what = one["what"]?.jsonPrimitive?.content?.trim().orEmpty()
            if (what.isEmpty()) return@mapNotNull null
            Item(
                id = one["id"]?.jsonPrimitive?.content.orEmpty(),
                what = what,
                due = one["due"]?.jsonPrimitive?.content.orEmpty(),
                said = runCatching {
                    one["said"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
                }.getOrDefault(emptyList()),
                snoozeUntil = one["snoozeUntil"]?.jsonPrimitive?.longOrNull ?: 0L,
            )
        }
    }

    /** 从设置页忘掉一条: 整份读、整份写 (宿主那一侧同一套, 见这个对象的文件头) */
    fun remove(context: Context, id: String): Boolean {
        val target = id.trim()
        if (target.isEmpty()) return false
        val raw = runCatching { file(context).takeIf { it.isFile }?.readText() }.getOrNull()
        val root = raw?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() }
        val items = root?.get("items")?.let { runCatching { it.jsonArray }.getOrNull() }
        if (root == null || items == null) return false
        val kept = items.filter { element ->
            runCatching { element.jsonObject["id"]?.jsonPrimitive?.content }.getOrNull() != target
        }
        if (kept.size == items.size) return false
        val payload = buildJsonObject {
            put("v", 1)
            put("at", System.currentTimeMillis())
            put("items", buildJsonArray { kept.forEach { add(it) } })
        }
        val file = file(context)
        val temporary = File(file.parentFile, "${file.name}.tmp")
        return runCatching {
            file.parentFile?.mkdirs()
            temporary.writeText("${payload}\n")
            if (!temporary.renameTo(file)) {
                file.writeText("${payload}\n")
                temporary.delete()
            }
            true
        }.getOrDefault(false)
    }
}
