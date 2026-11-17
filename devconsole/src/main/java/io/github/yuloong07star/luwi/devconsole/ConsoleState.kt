package io.github.yuloong07star.luwi.devconsole

import android.content.Context
import android.os.Environment
import org.json.JSONObject
import java.io.File

/**
 * 开发台读到的那一份事实 (2.8.1)
 *
 * 三个来源, 一个都不自己编:
 *
 * - **当前项目** 由 Luwi 经 `project.open{path,name}` 交过来, 落自己的 `current.json` (唯一写的东西)
 * - **元信息 / 上次构建 / 进度 / 日志** 全是项目目录里的文件: `project.json`、`.lwforge/last-build.json`、
 *   `.lwforge/progress.json`、`.lwforge/build.log` —— Luwi 那一侧是唯一写者, 这里只读
 * - **同级的其他项目** 从当前项目的父目录 (`app-projects/`) 里数, 于是列表不必再要一次路径
 */
internal object ConsoleState {

    private const val FILE = "current.json"
    private const val MAX_LOG_LINES = 200

    /** 一条项目 */
    data class Project(val path: String, val slug: String, val name: String)

    /** 现在开的那个 */
    fun current(context: Context): Project? {
        val file = File(context.filesDir, FILE)
        if (!file.isFile) return null
        val json = runCatching { JSONObject(file.readText()) }.getOrNull() ?: return null
        val path = json.optString("path")
        if (path.isEmpty()) return null
        val dir = File(path)
        if (!dir.isDirectory) return null
        return Project(path, dir.name, json.optString("name").ifBlank { dir.name })
    }

    /** Luwi 交过来一个项目: 记下来, 回这次能不能读 */
    fun open(context: Context, path: String, name: String): Project? {
        val dir = File(path)
        if (!dir.isDirectory) return null
        // 只认 app-projects/<slug> 这种形状: 路径是别的应用给的, 不替它猜
        if (dir.parentFile?.name != "app-projects") return null
        val project = Project(dir.absolutePath, dir.name, name.ifBlank { dir.name })
        val text = JSONObject()
            .put("path", project.path)
            .put("name", project.name)
            .put("at", System.currentTimeMillis())
            .toString()
        runCatching { File(context.filesDir, FILE).writeText(text) }
        return project
    }

    /** 与当前项目同一个 `app-projects/` 下的其他项目 */
    fun siblingProjects(context: Context): List<Project> {
        val current = current(context) ?: return emptyList()
        val root = File(current.path).parentFile ?: return listOf(current)
        val dirs = root.listFiles { file -> file.isDirectory && File(file, "project.json").isFile }
            ?: return listOf(current)
        return dirs.map { dir -> Project(dir.absolutePath, dir.name, nameOf(dir) { dir.name }) }
            .sortedBy { it.name }
    }

    /** `project.json` 里的名字 */
    fun nameOf(dir: File, fallback: () -> String): String {
        val json = runCatching { JSONObject(File(dir, "project.json").readText()) }.getOrNull()
        return json?.optString("name").orEmpty().ifBlank { fallback() }
    }

    /** `project.json` 的几行给人看的读数 */
    fun meta(dir: File): List<Pair<String, String>> {
        val json = runCatching { JSONObject(File(dir, "project.json").readText()) }.getOrNull()
            ?: return emptyList()
        return listOf(
            "包名" to json.optString("package"),
            "版本" to "${json.optString("versionName")} (${json.optInt("versionCode")})",
            "SDK" to "min ${json.optInt("minSdk")} / target ${json.optInt("targetSdk")}",
            "语言" to json.optString("language"),
            "模板" to json.optString("template"),
        ).filter { it.second.isNotBlank() }
    }

    /** 上次构建那几行 */
    fun lastBuild(dir: File): List<Pair<String, String>> {
        val json = runCatching { JSONObject(File(dir, ".lwforge/last-build.json").readText()) }.getOrNull()
            ?: return emptyList()
        return listOf(
            "结论" to if (json.optBoolean("ok")) "成功" else "失败",
            "APK" to json.optString("apk").substringAfterLast('/'),
            "体积" to json.optLong("bytes").takeIf { it > 0 }?.let { "${it / 1024} KB" }.orEmpty(),
            "label" to json.optString("label"),
            "错误" to json.optString("error"),
        ).filter { it.second.isNotBlank() }
    }

    /** 进度行: `3/5 javac …` */
    fun progress(dir: File): String {
        val json = runCatching { JSONObject(File(dir, ".lwforge/progress.json").readText()) }.getOrNull()
            ?: return ""
        val step = json.optString("step")
        val index = json.optInt("index")
        val total = json.optInt("total")
        val text = json.optString("text")
        return listOf("$index/$total", step, text).filter { it.isNotBlank() }.joinToString(" · ")
    }

    /** 日志尾; 读不动回一句为什么, 不吞 */
    fun logTail(dir: File, lines: Int = 60): String {
        val file = File(dir, ".lwforge/build.log")
        if (!file.isFile) return ""
        val all = runCatching { file.readLines() }.getOrElse {
            return "日志读不动: ${it.message ?: it.javaClass.simpleName}"
        }
        return all.takeLast(lines.coerceIn(1, MAX_LOG_LINES)).joinToString("\n")
    }

    /** `MANAGE_EXTERNAL_STORAGE` 有没有给 (没给就只能看见自己那点目录) */
    fun canReadShared(): Boolean = Environment.isExternalStorageManager()
}
