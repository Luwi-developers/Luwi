package io.github.yuloong07star.luwi.forge

import java.io.File

/**
 * 工坊的项目路径 (2.8.1)
 *
 * 一条规矩: **项目只能落在会话工作区的 `app-projects/<slug>/` 底下**. 这不是洁癖 —— 模型给的 workspace
 * 是路径的唯一来源, 而这条路径会进特权进程的 argv 与文件操作; 放行任意目录就等于把"模型能写哪"交给模型
 *
 * 纯函数, 不碰文件系统以外的东西 (单测直接摆弄它)
 */
internal object ProjectPath {

    /** `app-projects` 这一层的名字 (与开发台那侧的判断逐字一致) */
    const val PARENT = "app-projects"

    /** slug 只收小写字母 / 数字 / 横线与下划线: 它同时进路径与包名, 中文与空格在这一层没有好处 */
    private val SLUG = Regex("^[a-z][a-z0-9_-]{0,31}$")

    /** 包名: 与 Android 那一套一致 */
    private val PACKAGE = Regex("^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$")

    /** 一次最多认多长的工作区路径 */
    private const val MAX_PATH = 400

    /** slug 合格吗 */
    fun slugProblem(slug: String): String? = when {
        slug.isBlank() -> "project 不能为空 (只用小写字母 / 数字 / 横线, 例如 hello)"
        !SLUG.matches(slug) -> "project 只收小写字母 / 数字 / 横线与下划线, 且以字母开头: $slug"
        else -> null
    }

    /** 包名合格吗 */
    fun packageProblem(name: String): String? = when {
        name.isBlank() -> "package 不能为空 (例如 com.example.hello)"
        !PACKAGE.matches(name) -> "package 不像一个包名: $name"
        else -> null
    }

    /**
     * 工作区能不能用
     *
     * 三个根与 `Workspace.resolve` 那三档一致: 共享存储 / 应用的外部媒体目录 / 沙盒. 别处一律不认
     */
    fun workspaceProblem(path: String): String? {
        if (path.isBlank()) return "workspace 不能为空"
        if (!path.startsWith("/")) return "workspace 要是绝对路径: $path"
        if (path.length > MAX_PATH) return "workspace 太长"
        if (path.any { it == '\u0000' || it == '\n' }) return "workspace 里有控制字符"
        val allowed = listOf("/sdcard/", "/storage/emulated/", "/data/data/", "/data/user/")
        if (allowed.none { path.startsWith(it) }) return "workspace 只认共享存储或应用自己的目录: $path"
        val dir = File(path)
        if (!dir.isDirectory) return "workspace 不是一个目录: $path"
        return null
    }

    /** 项目目录: `<workspace>/app-projects/<slug>` */
    fun projectDir(workspace: String, slug: String): File = File(File(workspace, PARENT), slug)

    /**
     * 从一条绝对路径找回 `<workspace>`
     *
     * 开发台与构建都只拿到项目目录, 而"它属于哪个工作区"由 `app-projects` 那一层反推; 反推不出来就是
     * 不在这套规矩里, 一句拒
     */
    fun workspaceOf(project: File): File? {
        val parent = project.parentFile ?: return null
        if (parent.name != PARENT) return null
        return parent.parentFile
    }
}
