package io.github.yuloong07star.luwi.tool

import org.json.JSONObject
import java.io.File

/**
 * 开发屏读的那一份事实 (2.8.1, 2026-11-17 并进主 APK)
 *
 * 三个来源, 一个都不自己编:
 *
 * - **当前项目**: `app-projects/.current` (Luwi 建屏时写一行路径), 没有就认盘上最近动过的那个
 * - **元信息 / 上次构建 / 进度 / 日志**: 全是项目目录里的文件 —— `project.json`、`.lwforge/last-build.json`、
 *   `.lwforge/progress.json`、`.lwforge/build.log`; Luwi 那一侧是唯一写者, 这里只读
 * - **同级的其他项目**: 从当前项目的父目录 (`app-projects/`) 里数
 *
 * 以前这一份住在「Luwi 开发台」那个伴侣 APK 里; 主人 2026-11-17 问「不能直接装在 Luwi 应用里吗」之后搬进来,
 * 于是手机上只剩 Luwi 一个应用
 */
internal object ForgeConsole {

    private const val MARKER = ".current"
    private const val MAX_LOG_LINES = 200

    private val ROOTS = listOf(
        "/sdcard/DSH/Luwi",
        "/sdcard/Android/media/io.github.yuloong07star.luwi/DSH/Luwi",
    )

    /** 一条项目 */
    data class Project(val path: String, val slug: String, val name: String)

    /** 现在开的那个: 先看建屏时写下的记号, 没有就认盘上最近动过的 */
    fun current(): Project? = marked() ?: latestOnDisk()

    /** 建屏时写的那一行 (`app-projects/.current`) */
    private fun marked(): Project? {
        ROOTS.forEach { root ->
            val marker = File(File(root, "app-projects"), MARKER)
            if (!marker.isFile) return@forEach
            val path = runCatching { marker.readText().trim() }.getOrNull().orEmpty()
            val dir = File(path)
            if (dir.isDirectory && File(dir, "project.json").isFile) {
                return Project(dir.absolutePath, dir.name, nameOf(dir) { dir.name })
            }
        }
        return null
    }

    /** 盘上最近动过的那一个 */
    private fun latestOnDisk(): Project? {
        val found = ROOTS.map { root -> File(root, "app-projects") }
            .filter { it.isDirectory }
            .flatMap { dir -> dir.listFiles()?.toList().orEmpty() }
            .filter { it.isDirectory && File(it, "project.json").isFile }
            .map { dir -> dir to File(dir, "project.json").lastModified() }
            .sortedByDescending { it.second }
            .map { it.first }
        val dir = found.firstOrNull() ?: return null
        return Project(dir.absolutePath, dir.name, nameOf(dir) { dir.name })
    }

    /** 盘上所有项目 (面板上「已有项目」那一行用; 按名字排) */
    fun all(): List<Project> = ROOTS.map { root -> File(root, "app-projects") }
        .filter { it.isDirectory }
        .flatMap { dir -> dir.listFiles()?.toList().orEmpty() }
        .filter { it.isDirectory && File(it, "project.json").isFile }
        .map { dir -> Project(dir.absolutePath, dir.name, nameOf(dir) { dir.name }) }
        .sortedBy { it.name }
    /** 与当前项目同一个 `app-projects/` 下的其他项目 */
    fun siblings(): List<Project> {
        val now = current() ?: return emptyList()
        val root = File(now.path).parentFile ?: return listOf(now)
        val dirs = root.listFiles { file -> file.isDirectory && File(file, "project.json").isFile }
            ?: return listOf(now)
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

    /** 进度行: `9/9 done 构建完成` */
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
        val all = runCatching { file.readLines() }.getOrElse { return "读不动 build.log: ${it.message}" }
        return all.takeLast(lines.coerceIn(1, MAX_LOG_LINES)).joinToString("\n")
    }
}
