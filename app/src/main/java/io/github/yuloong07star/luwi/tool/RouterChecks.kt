package io.github.yuloong07star.luwi.tool

import android.content.Context
import io.github.yuloong07star.luwi.host.DshHost
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.File

/**
 * 判断层「盯着什么」那一份清单 (2026-11-07 晚, 主人: "检测的内容应由探索时加上")
 *
 * 主人这一条把两件事分开了: **什么时候敲钟归设置页** (见 [SimSetting]), **敲钟之后看什么归探索**。
 * 探索那一场每天跑一次, 它看得见手机上真有什么 (哪个应用用得久、几点还在刷), 而这些恰恰是坐在
 * 设置页里想不出来的 —— 所以清单的写者是探索 (宿主 `finishExplore` 收 `checks` 写进
 * `$DSH_HOME/lw/router.json` 的 `checks`), 应用这一侧只做三件事:
 *
 * 1. 读出来给设置页列 (一句人话 + 判法)
 * 2. 单条开关 ([setEnabled])
 * 3. 单条忘掉 ([drop])
 *
 * **`router.json` 有两个写者** (宿主写判断层的账与探索交的清单, 应用写 `tick` 与这里的开关), 所以
 * 每次都是读-改-写整份、只动自己那一段, 原子写 —— 与 [RouterTick.setEnabled] 同一个手法。整份覆盖
 * 会把"她刚说过话"那笔账抹掉, 于是冷却失效、退让清零
 */
internal object RouterChecks {

    const val DIRECTORY = "lw"
    const val FILE = "router.json"

    /** 一条检测项 (只读形状; 真正的判法在宿主那一侧, 这里不判) */
    data class Check(
        val id: String,
        val what: String,
        val kind: String,
        val packageName: String?,
        val minutes: Int,
        val at: String?,
        val enabled: Boolean,
        val from: String?,
    ) {
        /** 那行小字: 判法本身 (给人看的, 与宿主 `routerCheckHit` 同一套说法) */
        val how: String
            get() = when (kind) {
                "usage" -> buildString {
                    append("某天用满 ").append(minutes).append(" 分钟")
                    packageName?.let { append(" · ").append(it) }
                }

                "time" -> at?.let { "每天 $it 之后" } ?: "到点"
                else -> kind
            }
    }

    private val json = Json { ignoreUnknownKeys = true }

    fun file(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), "$DIRECTORY/$FILE")

    /** 读整份 (读不到 / 读坏了都当空对象) */
    private fun readRoot(context: Context): JsonObject = runCatching {
        file(context).takeIf { it.isFile }?.readText()?.let { json.parseToJsonElement(it) as? JsonObject }
    }.getOrNull() ?: JsonObject(emptyMap())

    fun list(context: Context): List<Check> = parse(readRoot(context)["checks"] as? JsonArray)

    /** 盘子那一行读数用 */
    fun count(context: Context): Int = list(context).size

    /** 纯解析 (判据与单测走这一条, 不需要设备) */
    fun parse(array: JsonArray?): List<Check> {
        if (array == null) return emptyList()
        return array.mapNotNull { element ->
            val one = element as? JsonObject ?: return@mapNotNull null
            val id = (one["id"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
            val what = (one["what"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
            if (id.isEmpty() || what.isEmpty()) return@mapNotNull null
            val whenOne = (one["when"] as? JsonObject) ?: JsonObject(emptyMap())
            val kind = (whenOne["kind"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
            Check(
                id = id,
                what = what,
                kind = kind,
                packageName = (whenOne["package"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() },
                minutes = (whenOne["minutes"] as? JsonPrimitive)?.intOrNull ?: 0,
                at = (one["at"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() },
                enabled = (one["enabled"] as? JsonPrimitive)?.booleanOrNull ?: true,
                from = (one["from"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() },
            )
        }
    }

    /** 单条开关: 只改那一条的 `enabled`, 其余键原样搬回去 */
    fun setEnabled(context: Context, id: String, on: Boolean): Boolean = rewrite(context) { array ->
        buildJsonArray {
            array.forEach { element ->
                val one = element as? JsonObject
                if (one == null || (one["id"] as? JsonPrimitive)?.contentOrNull != id) {
                    add(element)
                } else {
                    add(
                        buildJsonObject {
                            one.forEach { (key, value) -> if (key != "enabled") put(key, value) }
                            put("enabled", on)
                        },
                    )
                }
            }
        }
    }

    /** 忘掉一条: 从清单里摘掉, 别的什么都不动 */
    fun drop(context: Context, id: String): Boolean = rewrite(context) { array ->
        buildJsonArray {
            array.forEach { element ->
                val one = element as? JsonObject
                val same = one != null && (one["id"] as? JsonPrimitive)?.contentOrNull == id
                if (!same) add(element)
            }
        }
    }

    /**
     * 读-改-写整份 `router.json`, 只替换 `checks` 这一项
     *
     * 写完叫一次 [RouterTick.ensure] —— 清单变了不影响闹钟, 但"页面刚改过"那一刻重排一次是最省的
     * 一致化方式 (它内部读开关, 关着就撤销, 幂等)
     */
    private fun rewrite(context: Context, transform: (JsonArray) -> JsonArray): Boolean {
        val target = file(context)
        val root = readRoot(context)
        val current = root["checks"] as? JsonArray ?: JsonArray(emptyList())
        val payload = buildJsonObject {
            root.forEach { (key, value) -> if (key != "checks") put(key, value) }
            put("checks", transform(current))
        }
        val written = runCatching {
            target.parentFile?.mkdirs()
            val text = json.encodeToString(JsonObject.serializer(), payload) + "\n"
            val temporary = File(target.parentFile, "${target.name}.tmp")
            temporary.writeText(text)
            if (!temporary.renameTo(target)) {
                target.writeText(text)
                temporary.delete()
            }
            true
        }.getOrDefault(false)
        if (written) RouterTick.ensure(context)
        return written
    }
}
