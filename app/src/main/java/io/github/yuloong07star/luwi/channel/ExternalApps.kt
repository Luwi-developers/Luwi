package io.github.yuloong07star.luwi.channel

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import io.github.yuloong07star.luwi.host.DshHost
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.io.File

/**
 * 外部工具生态 (2.8.1 B2): 把主人自己装好的工具登记成稳定的名字
 *
 * 为什么要有这一层: `lw_apps` 给的是这台手机上能启动的**全部**应用, 名字还是随系统语言变的 label,
 * 于是模型每换一台手机就要重新猜一次包名. 这一份清单把"我要用的那个工具"固定成一个 id: 主人写一次
 * `external-apps.json`, 之后不论 label 怎么变, id 都指向同一个包
 *
 * 三件事: `list` 念出登记表, `probe` 只问装没装 (不发 Intent), `open` 走显式组件或启动器,
 * `handoff` 把一段**用户明说的**文字交给那个工具处理
 *
 * 边界 (与文档 22 一致):
 * - 不下载、不安装、不建虚拟屏, 也不替主人去装任何外部 App
 * - `open` 只认登记表里的 id; 显式组件优先, 退化到 launch intent, 都没有就回 unsupported
 * - `handoff` 的文本必须是人给的: 路径、URI、`$` 变量、token 一类一律拒, 见 [handoffProblem]
 */
internal object ExternalApps {

    /** 登记表的位置: `$DSH_HOME/lw/external-apps.json` (与 modes / automations 同一个家) */
    private const val DIRECTORY = "lw"
    private const val FILE = "external-apps.json"

    /** 一次 handoff 的文本上限: 一段话, 不是一份文件 */
    const val MAX_TEXT = 500

    /** 一条登记 */
    data class Entry(
        val id: String,
        val label: String,
        val packageName: String,
        val activity: String?,
        val sendAction: String?,
        val mime: String?,
    )

    /** 读出来的结果: 坏一个条目不影响其余, 但要把话带出去 */
    data class Loaded(val entries: List<Entry>, val error: String)

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    fun file(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), "$DIRECTORY/$FILE")

    fun load(context: Context): Loaded {
        val file = file(context)
        if (!file.isFile) return Loaded(emptyList(), "还没有登记表: ${file.absolutePath}")
        val text = runCatching { file.readText() }.getOrElse {
            return Loaded(emptyList(), "登记表读不出来: ${it.message ?: it.javaClass.simpleName}")
        }
        return parse(text)
    }

    /**
     * 解析登记表. 纯函数, 单测直接喂字符串
     *
     * 坏条目不抛: 记一句 why 丢进 error, 其余照常返回 —— 主人手写这个文件时最常犯的错是漏 package,
     * 一条漏了不该让整张表都不认
     */
    fun parse(text: String): Loaded {
        val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrElse {
            return Loaded(emptyList(), "登记表不是 JSON 对象: ${it.message ?: it.javaClass.simpleName}")
        }
        val apps = runCatching { root["apps"]!!.jsonArray }.getOrElse {
            return Loaded(emptyList(), "登记表里没有 apps 数组")
        }
        val seen = LinkedHashMap<String, Entry>()
        val problems = ArrayList<String>()
        apps.forEachIndexed { index, element ->
            val item = runCatching { element.jsonObject }.getOrNull()
            if (item == null) {
                problems += "#$index 不是对象"
                return@forEachIndexed
            }
            val id = item.str("id")
            val packageName = item.str("package")
            when {
                id.isBlank() -> {
                    problems += "#$index 没有 id"
                    return@forEachIndexed
                }

                !ID.matches(id) -> {
                    problems += "#$index 的 id 只能用字母数字与横线: $id"
                    return@forEachIndexed
                }

                packageName.isBlank() -> {
                    problems += "$id 没有 package"
                    return@forEachIndexed
                }

                !PACKAGE.matches(packageName) -> {
                    problems += "$id 的 package 不像包名: $packageName"
                    return@forEachIndexed
                }

                seen.containsKey(id) -> {
                    problems += "$id 重复了, 后面那条不算"
                    return@forEachIndexed
                }
            }
            val activity = item.str("activity").takeIf { it.isNotBlank() }
            if (activity != null && !COMPONENT.matches(activity)) {
                problems += "$id 的 activity 要写成 包名/类名: $activity"
                return@forEachIndexed
            }
            seen[id] = Entry(
                id = id,
                label = item.str("label").ifBlank { id },
                packageName = packageName,
                activity = activity,
                sendAction = item.str("sendAction").takeIf { it.isNotBlank() },
                mime = item.str("mime").takeIf { it.isNotBlank() },
            )
        }
        return Loaded(seen.values.toList(), problems.joinToString("; "))
    }

    /**
     * handoff 的文本能不能递出去. null = 可以, 否则是给模型看的那句话
     *
     * 拦的是"把手机里的东西递出去"这一类: 绝对路径、URI、`$` 变量、token 一类的键名. 主人自己打的
     * 一段话里出现 `/` 很常见 (日期、分数), 所以只拦**以斜杠开头**的片段与已知的 scheme,
     * 不是见斜杠就拒
     */
    fun handoffProblem(text: String): String? {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return "handoff 要一段文字: text 不能是空的"
        if (trimmed.length > MAX_TEXT) {
            return "handoff 的 text 最多 $MAX_TEXT 个字符, 现在是 ${trimmed.length}: " +
                "要递文件就先用别的工具把内容读成文字"
        }
        RETURNED.firstOrNull { trimmed.contains(it, ignoreCase = true) }?.let {
            return "handoff 不递 URI 或路径 (提到了 $it): 把要说的那段话直接写进 text"
        }
        ABSOLUTE_PATH.find(trimmed)?.let {
            return "handoff 不递路径 (${it.value}): 把要说的那段话直接写进 text"
        }
        SECRET.firstOrNull { trimmed.contains(it, ignoreCase = true) }?.let {
            return "handoff 不递凭据 (提到了 $it)"
        }
        return null
    }

    /** `list`: 念登记表, 顺带说清每一条现在装没装 —— 一次读完就不必再 probe 一遍 */
    fun dispatch(context: Context, request: JsonObject): JsonElement {
        val op = request["op"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        return when (op) {
            "", "list" -> list(context)
            "probe" -> probe(context, request)
            "open" -> open(context, request)
            "handoff" -> handoff(context, request)
            else -> buildJsonObject {
                put("error", "不认识的 op: $op (list / probe / open / handoff)")
            }
        }
    }

    private fun list(context: Context): JsonObject {
        val loaded = load(context)
        val pm = context.packageManager
        return buildJsonObject {
            put("file", file(context).absolutePath)
            put("count", loaded.entries.size)
            put("error", loaded.error)
            putJsonArray("apps") {
                loaded.entries.forEach { entry ->
                    add(
                        buildJsonObject {
                            put("id", entry.id)
                            put("label", entry.label)
                            put("package", entry.packageName)
                            put("activity", entry.activity.orEmpty())
                            put("mime", entry.mime.orEmpty())
                            put("installed", installed(pm, entry.packageName))
                        },
                    )
                }
            }
        }
    }

    private fun probe(context: Context, request: JsonObject): JsonObject {
        val loaded = load(context)
        val id = request["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val wanted = if (id.isEmpty()) loaded.entries else loaded.entries.filter { it.id == id }
        if (id.isNotEmpty() && wanted.isEmpty()) {
            return buildJsonObject {
                put("id", id)
                put("known", false)
                put("error", if (loaded.error.isBlank()) "登记表里没有这个 id" else loaded.error)
            }
        }
        val pm = context.packageManager
        return buildJsonObject {
            put("count", wanted.size)
            put("error", loaded.error)
            putJsonArray("apps") {
                wanted.forEach { entry ->
                    add(
                        buildJsonObject {
                            put("id", entry.id)
                            put("package", entry.packageName)
                            val present = installed(pm, entry.packageName)
                            put("installed", present)
                            put("canOpen", present && resolve(pm, entry) != null)
                            put("canSend", present && sendTarget(pm, entry) != null)
                        },
                    )
                }
            }
        }
    }

    private fun open(context: Context, request: JsonObject): JsonObject {
        val loaded = load(context)
        val id = request["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (id.isEmpty()) return failure("", "open 要 id: 先用 list 看登记表里有什么")
        val entry = loaded.entries.firstOrNull { it.id == id }
            ?: return failure(id, "登记表里没有 $id" + loaded.error.takeIf { it.isNotBlank() }?.let { " ($it)" }.orEmpty())
        val pm = context.packageManager
        if (!installed(pm, entry.packageName)) return failure(id, "${entry.label} 没装")
        val intent = resolve(pm, entry) ?: return failure(id, "${entry.label} 打不开: 登记表里的组件不在, 启动器也没有它")
        return runCatching {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            buildJsonObject {
                put("id", id)
                put("started", true)
                put("package", entry.packageName)
                put("activity", intent.component?.flattenToShortString().orEmpty())
                put("error", "")
            }
        }.getOrElse { failure(id, "启动失败: ${it.message ?: it.javaClass.simpleName}") }
    }

    private fun handoff(context: Context, request: JsonObject): JsonObject {
        val loaded = load(context)
        val id = request["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val text = request["text"]?.jsonPrimitive?.contentOrNull.orEmpty()
        if (id.isEmpty()) return failure("", "handoff 要 id: 先用 list 看登记表里有什么")
        handoffProblem(text)?.let { return failure(id, it) }
        val entry = loaded.entries.firstOrNull { it.id == id } ?: return failure(id, "登记表里没有 $id")
        val pm = context.packageManager
        if (!installed(pm, entry.packageName)) return failure(id, "${entry.label} 没装")
        val action = entry.sendAction ?: Intent.ACTION_SEND
        val intent = Intent(action).apply {
            type = entry.mime ?: "text/plain"
            putExtra(Intent.EXTRA_TEXT, text.trim())
            setPackage(entry.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        if (sendTarget(pm, intent) == null) {
            return failure(id, "${entry.label} 不收 ${intent.type} 这种文字: 登记表里的 sendAction 或 mime 要改")
        }
        return runCatching {
            context.startActivity(intent)
            buildJsonObject {
                put("id", id)
                put("sent", true)
                put("package", entry.packageName)
                put("chars", text.trim().length)
                put("mime", intent.type.orEmpty())
                put("error", "")
            }
        }.getOrElse { failure(id, "递不过去: ${it.message ?: it.javaClass.simpleName}") }
    }

    private fun failure(id: String, why: String): JsonObject = buildJsonObject {
        put("id", id)
        put("started", false)
        put("sent", false)
        put("error", why)
    }

    private fun installed(pm: PackageManager, packageName: String): Boolean =
        runCatching { pm.getPackageInfo(packageName, 0) }.isSuccess

    /** 显式组件优先 (登记表写了 activity 就用它), 退化到启动器 */
    private fun resolve(pm: PackageManager, entry: Entry): Intent? {
        entry.activity?.let { raw ->
            parseComponent(raw)?.let { named ->
                val component = named.toComponent()
                runCatching { pm.getActivityInfo(component, 0) }.getOrNull()?.let {
                    return Intent(Intent.ACTION_MAIN)
                        .addCategory(Intent.CATEGORY_LAUNCHER)
                        .setComponent(component)
                }
            }
        }
        return pm.getLaunchIntentForPackage(entry.packageName)
    }

    private fun sendTarget(pm: PackageManager, entry: Entry): ComponentName? {
        val intent = Intent(entry.sendAction ?: Intent.ACTION_SEND).apply {
            type = entry.mime ?: "text/plain"
            setPackage(entry.packageName)
        }
        return runCatching { pm.resolveActivity(intent, 0)?.activityInfo?.let {
            ComponentName(it.packageName, it.name)
        } }.getOrNull()
    }

    private fun sendTarget(pm: PackageManager, intent: Intent): ComponentName? =
        runCatching { pm.resolveActivity(intent, 0)?.activityInfo?.let {
            ComponentName(it.packageName, it.name)
        } }.getOrNull()

    /** 一个显式组件, 自己的一份而不是 ComponentName: 后者是 Android 的类, 单测里点不动 */
    data class Named(val packageName: String, val className: String) {
        fun toComponent(): ComponentName = ComponentName(packageName, className)
    }

    /** `com.example.app/.Main` 与 `com.example.app/com.example.app.Main` 两种写法 */
    fun parseComponent(raw: String): Named? = runCatching {
        val packageName = raw.substringBefore('/')
        val className = raw.substringAfter('/', "").takeIf { it.isNotBlank() }
            ?: return@runCatching null
        val full = if (className.startsWith('.')) packageName + className else className
        if (packageName.isBlank()) return@runCatching null
        Named(packageName, full)
    }.getOrNull()

    private fun JsonObject.str(key: String): String =
        (this[key] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()

    private val ID = Regex("^[A-Za-z0-9-]{1,32}$")
    private val PACKAGE = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")
    private val COMPONENT = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+/[A-Za-z0-9_.]+$")
    private val RETURNED = listOf(
        "file://", "content://", "android.resource://", "/data/", "/sdcard/", "/storage/",
        "data/local/tmp", "run-as",
    )
    private val ABSOLUTE_PATH = Regex("""(^|\s)/\S""")
    private val SECRET = listOf("token", "api key", "apikey", "secret", "password", "cookie")
}
