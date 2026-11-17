package io.github.yuloong07star.luwi.tool

import android.content.Context
import io.github.yuloong07star.luwi.channel.LwForgeExec
import io.github.yuloong07star.luwi.channel.PrivilegedChannel
import io.github.yuloong07star.luwi.channel.VirtualScreen
import io.github.yuloong07star.luwi.forge.ForgeIcon
import io.github.yuloong07star.luwi.forge.ForgePlan
import io.github.yuloong07star.luwi.forge.ForgeProject
import io.github.yuloong07star.luwi.forge.ProjectPath
import io.github.yuloong07star.luwi.host.DshHost
import io.github.yuloong07star.luwi.plugin.CompanionApk
import io.github.yuloong07star.luwi.workspace.Workspace
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.json.JSONObject
import java.io.File

/**
 * 手机应用工坊的那一层 (2.8.1): 模型能调的十几个动作, 一个都不碰命令行
 *
 * 分工写死在这里:
 *
 * - `init` / `meta` / `icon` / `status` / `logs` 在**应用进程**里做 (文件 + Bitmap, 都不需要特权)
 * - `toolchain` / `build` 走特权通道 (工具链在 `/data/local/tmp/lwforge/`, 只有 shell uid 跑得动那些二进制)
 * - `install` 走 `installStaged` (与插件装机同一条路: 先抄进 /data/local/tmp 再 `pm install`)
 * - `screen` / `preview` / `back` 是虚拟屏那一套: `create` 建屏、`launch` 起应用、`release` 收屏
 *
 * **项目目录在会话工作区里** (`<workspace>/app-projects/<slug>`): 代码与 res 由模型用普通文件工具改, 这里
 * 只管那几件"要读二进制 / 要跑构建 / 要动设备"的事
 */
internal object LwForge {

    private const val TAG = "LwForge"

    /** 一次构建的预算 (五步 + 签名, 冷启动时 javac 最慢) */
    private const val BUILD_TIMEOUT_MS = 300_000L

    /** 装一次 APK 的预算 */
    private const val INSTALL_TIMEOUT_MS = 180_000L

    /** 建屏 / 起应用那两条的预算 */
    private const val LAUNCH_TIMEOUT_MS = 8_000L

    /** 设置页那一行「工具链」与 `op=status` 共用的一句话 */
    fun toolchainLine(context: Context): String = DevToolchain.status(context)

    /** 设置页那一行「连接开发台」与 `op=status` 共用的一句话 */
    /**
     * 开发台那一行**只读系统里的装没装** —— 这一个对象跑在特权进程 (shell uid) 里, 而开发台的
     * Service 要 signature 级权限, shell uid 绑不上; 真正的连接在应用进程里 (设置页「连接开发台」)
     */
    fun consoleLine(context: Context): String = "开发台: 就在 Luwi 里 (设置 → 开发 → 打开开发台)"

    /**
     * 设置页那一行「打开开发台（虚拟屏）」: 建屏 + 拉起开发台, 不推项目
     *
     * 与 `op=screen` 的区别只有一处: 那一头要一个项目 (它顺手 `project.open`), 这一头人在设置页点的时候
     * 还没有项目可言 —— 屏上先有开发台, 它自己会记得上一次打开的是哪个项目
     */
    fun openConsole(context: Context): String {
        val service = PrivilegedChannel.ensure()
            ?: return "建虚拟屏要特权通道: " + (PrivilegedChannel.state().error ?: "没有原因")
        val previous = VirtualScreen.screens.firstOrNull()
        val screen = VirtualScreen.create(name = "开发台")
            ?: return "虚拟屏没建起来: ${VirtualScreen.lastError ?: "没有原因"}"
        val launched = runCatching {
            val (code, output) = service.launch(
                displayId = screen.displayId,
                userId = 0,
                packageName = context.packageName,
                component = "${context.packageName}/.ui.DevConsoleActivity",
                timeoutMs = LAUNCH_TIMEOUT_MS,
            )
            "exit $code" + if (output.isBlank()) "" else " (${output.trim().take(120)})"
        }.getOrElse { it.message ?: it.javaClass.simpleName }
        saveScreen(context, screen.displayId, "")
        val replaced = previous?.let { " (换掉了 ${it.label})" }.orEmpty()
        return "开发屏 ${screen.displayId} 建好了$replaced; 开发台: $launched"
    }

    /** 桥方法: 一条一条落到这里 */
    fun dispatch(context: Context, request: JsonObject): JsonObject = when (val op = request.string("op")) {
        "init" -> init(context, request)
        "meta" -> meta(context, request)
        "icon" -> icon(context, request)
        "status" -> status(context, request)
        "logs" -> logs(context, request)
        "toolchain" -> text(DevToolchain.install(context))
        // 设置页「新建应用」那一行走同一条路; 单独留一条 op 是为了让真机能验它
        "create" -> text(newProject(context, request.string("name")))
        "build" -> build(context, request)
        "install" -> install(context, request)
        "screen" -> screen(context, request)
        "preview" -> preview(context, request)
        "back" -> back(context)
        else -> throw IllegalArgumentException(
            "op has to be one of init, meta, icon, status, logs, toolchain, create, build, install, screen," +
                " preview, back, not \"$op\"",
        )
    }

    // ---- 项目面 -------------------------------------------------------------------------------

    private fun init(context: Context, request: JsonObject): JsonObject {
        val workspace = workspaceOf(context, request)
        val slug = request.string("project")
        ProjectPath.slugProblem(slug)?.let { throw IllegalArgumentException(it) }
        ProjectPath.workspaceProblem(workspace)?.let { throw IllegalArgumentException(it) }
        val packageName = request.string("package")
        ProjectPath.packageProblem(packageName)?.let { throw IllegalArgumentException(it) }
        val meta = ForgeProject.Meta(
            name = request.string("name", slug),
            packageName = packageName,
            versionCode = request.int("versionCode", 1),
            versionName = request.string("versionName", "1.0"),
            minSdk = request.int("minSdk", 24),
            targetSdk = request.int("targetSdk", 37),
            language = request.string("language", "java"),
            template = request.string("template", ForgeProject.TEMPLATE_JAVA),
            icon = "",
        )
        val project = ProjectPath.projectDir(workspace, slug)
        val problem = ForgeProject.create(context, project, meta, request.bool("force", false))
        if (problem.isNotEmpty()) return text(problem)
        return text(
            "项目建好了: ${project.absolutePath}\n" +
                "改代码: 直接改 src/ 与 res/ (普通文件工具); 改名字 / 图标: op=meta / op=icon; " +
                "构建: op=build",
        )
    }

    private fun meta(context: Context, request: JsonObject): JsonObject {
        val project = projectOf(context, request)
        val (before, problem) = ForgeProject.read(project)
        if (before == null) return text(problem)
        val after = before.copy(
            name = request.string("name", before.name),
            versionName = request.string("versionName", before.versionName),
            versionCode = request.int("versionCode", before.versionCode),
            minSdk = request.int("minSdk", before.minSdk),
            targetSdk = request.int("targetSdk", before.targetSdk),
        )
        val written = ForgeProject.write(project, after)
        if (written.isNotEmpty()) return text(written)
        val named = ForgeProject.syncName(project, after.name)
        if (named.isNotEmpty()) return text(named)
        val versioned = ForgeProject.syncVersion(project, after.versionName, after.versionCode)
        if (versioned.isNotEmpty()) return text(versioned)
        val sdk = ForgeProject.syncSdk(project, after.minSdk, after.targetSdk)
        if (sdk.isNotEmpty()) return text(sdk)
        return text(
            "改好了: ${after.name} · ${after.packageName} · ${after.versionName} (${after.versionCode})" +
                " · min ${after.minSdk} / target ${after.targetSdk}",
        )
    }

    private fun icon(context: Context, request: JsonObject): JsonObject {
        val project = projectOf(context, request)
        val workspace = ProjectPath.workspaceOf(project) ?: File(workspaceOf(context, request))
        val raw = File(request.string("file"))
        val source = if (raw.isAbsolute) raw else File(workspace, request.string("file"))
        val canonical = runCatching { source.canonicalFile }.getOrNull()
            ?: return text("找不到这个图标文件: ${source.path}")
        val root = runCatching { workspace.canonicalFile }.getOrNull() ?: workspace
        if (!canonical.path.startsWith(root.path + File.separator)) {
            return text("图标只认工作区里的文件 (含 lw-in/), 不认 ${canonical.path}")
        }
        val said = ForgeIcon.apply(project, canonical)
        if (said.startsWith("图标已落地")) {
            val (meta, _) = ForgeProject.read(project)
            if (meta != null) ForgeProject.write(project, meta.copy(icon = canonical.name))
        }
        return text(said)
    }

    private fun status(context: Context, request: JsonObject): JsonObject {
        val project = projectOf(context, request)
        val (meta, problem) = ForgeProject.read(project)
        if (meta == null) return text(problem)
        val build = lastBuild(project)
        val lines = mutableListOf<String>()
        lines += "项目: ${meta.name} (${project.name})"
        lines += "目录: ${project.absolutePath}"
        lines += "包名: ${meta.packageName}"
        lines += "版本: ${meta.versionName} (${meta.versionCode})"
        lines += "SDK: min ${meta.minSdk} / target ${meta.targetSdk}"
        lines += "语言: ${meta.language} · 模板: ${meta.template}"
        lines += if (meta.icon.isBlank()) "图标: 系统默认" else "图标: ${meta.icon}"
        lines += build
        lines += DevToolchain.status(context)
        // 设置页那一行只说"APK 装没装"; 真正在特权区里的是另一件事, 分开说, 免得"装好工具链却显示没装"
        val staged = runCatching {
            PrivilegedChannel.ensure()?.linux(
                operation = "forge.status",
                command = "",
                work = LwForgeExec.TOOLCHAIN_DIRECTORY,
                timeoutMs = 5_000L,
                source = "",
                version = "",
            )
        }.getOrNull()
        if (staged != null) {
            lines += "工具链 (特权区): " + staged.output.trim().replace('\n', '·')
        }
        lines += consoleLine(context)
        return text(lines.joinToString("\n"))
    }

    private fun logs(context: Context, request: JsonObject): JsonObject {
        val project = projectOf(context, request)
        val lines = request.int("lines", 60).coerceIn(1, 200)
        val file = File(project, ".lwforge/build.log")
        if (!file.isFile) return text("还没有构建日志")
        val all = runCatching { file.readLines() }.getOrElse {
            return text("日志读不动: ${it.message ?: it.javaClass.simpleName}")
        }
        return text(all.takeLast(lines).joinToString("\n"))
    }

    // ---- 构建与装机 ---------------------------------------------------------------------------

    private fun build(context: Context, request: JsonObject): JsonObject {
        val project = projectOf(context, request)
        val (meta, problem) = ForgeProject.read(project)
        if (meta == null) return text(problem)
        if (!File(project, "AndroidManifest.xml").isFile) return text("项目里没有 AndroidManifest.xml")
        // 幂等: project.json 是唯一真源, 构建前把 manifest 那三处 (包 / 版本 / SDK) 对一遍
        ForgeProject.syncPackage(project, meta.packageName).takeIf { it.isNotEmpty() }?.let { return text(it) }
        ForgeProject.syncVersion(project, meta.versionName, meta.versionCode).takeIf { it.isNotEmpty() }?.let {
            return text(it)
        }
        ForgeProject.syncSdk(project, meta.minSdk, meta.targetSdk).takeIf { it.isNotEmpty() }?.let { return text(it) }
        val plan = ForgePlan.build(project, meta)
        val service = PrivilegedChannel.ensure()
            ?: return text(
                "构建要特权通道 (工具链在 ${LwForgeExec.TOOLCHAIN_DIRECTORY}): " +
                    (PrivilegedChannel.state().error ?: "没有原因"),
            )
        // 先问工具链在不在: 没有它跑下去只会得到一句 keytool 的 exit 127, 那不是给人看的答案
        val toolchain = runCatching {
            service.linux(
                operation = "forge.status",
                command = "",
                work = LwForgeExec.TOOLCHAIN_DIRECTORY,
                timeoutMs = 10_000L,
                source = "",
                version = "",
            )
        }.getOrNull()
        val ready = toolchain?.output?.lineSequence()?.any { it.trim() == "installed=true" } == true
        if (!ready) {
            val why = toolchain?.output?.trim().orEmpty()
            return text(
                "工具链还没装好: 到设置 → 开发 → 「开发工具链」点一下 (下 113 MB 的 zip, 或从文件导入); " +
                    "工具链在 ${LwForgeExec.TOOLCHAIN_DIRECTORY}" +
                    if (why.isBlank()) "" else "\n($why)",
            )
        }
        val answer = service.linux(
            operation = "forge.build",
            command = plan.json,
            work = plan.workDir.absolutePath,
            timeoutMs = BUILD_TIMEOUT_MS,
            source = "",
            version = "",
        )
        val said = answer.output.ifBlank {
            if (answer.code == 0) "构建成功" else "构建失败 (exit ${answer.code})"
        }
        val notes = plan.notes.joinToString("; ")
        return text(if (notes.isBlank()) said else "$said\n($notes)")
    }

    private fun install(context: Context, request: JsonObject): JsonObject {
        val project = projectOf(context, request)
        val apk = File(project, ".lwforge/app.apk")
        if (!apk.isFile) return text("还没有成品: 先 op=build 一次")
        val (meta, _) = ForgeProject.read(project)
        val packageName = meta?.packageName.orEmpty()
        val result = LwSystemCommand.run(
            operation = "installStaged",
            arguments = listOf(apk.absolutePath),
            timeoutMs = INSTALL_TIMEOUT_MS,
        )
        val said = result.output.ifBlank { if (result.code == 0) "装上了" else "没装上" }
        if (result.code == 0) {
            return text("装 ${apk.name} (${apk.length() / 1024} KB): $said")
        }
        // HyperOS / MIUI 对"新包"把 shell 的安装一律挡掉 (`INSTALL_FAILED_USER_RESTRICTED`)。
        // 那一关只能由人在系统安装器那一页点一下, 所以这里把包交给它, 而不是留一句红字
        if (said.contains("USER_RESTRICTED", ignoreCase = true)) {
            val handed = CompanionApk.install(context, apk, packageName.ifBlank { null })
            return text(
                "系统不让后台装 (HyperOS 对非更新包一律拒), 已经把它交给系统安装器: $handed",
            )
        }
        return text("装 ${apk.name} (${apk.length() / 1024} KB): $said\n(exit ${result.code})")
    }

    // ---- 虚拟屏那一套 -------------------------------------------------------------------------

    /**
     * 设置页「新建应用」: 只建项目, 不构建 (构建是 `op=build` 的事)
     *
     * 名字当显示名; slug 从名字里挑字母数字, 包名固定 `com.example.<slug 去横线>`
     */
    fun newProject(context: Context, rawName: String): String {
        val title = rawName.trim()
        if (title.isEmpty()) return "名字不能是空的"
        val slug = title.lowercase().map { if (it in 'a'..'z' || it in '0'..'9') it else '-' }
            .joinToString("").trim('-').replace(Regex("-+"), "-")
        // 中文名字挑不出字母时给一个稳定的 slug (`app` + 名字的 hash), 而不是拒掉
        val safe = slug.ifEmpty { "app" + Integer.toHexString(title.hashCode()) }
        ProjectPath.slugProblem(safe)?.let { return it }
        val workspace = listOf(
            "/sdcard/DSH/Luwi",
            "/sdcard/Android/media/${context.packageName}/DSH/Luwi",
        ).firstOrNull { File(it).isDirectory } ?: return "还没有工作区目录 (/sdcard/DSH/Luwi)"
        ProjectPath.workspaceProblem(workspace)?.let { return it }
        val project = ProjectPath.projectDir(workspace, safe)
        if (File(project, "project.json").isFile) return "已经有叫 $safe 的项目了"
        val meta = ForgeProject.Meta(
            name = title,
            packageName = "com.example." + safe.replace("-", ""),
            versionCode = 1,
            versionName = "1.0",
            minSdk = 24,
            targetSdk = 37,
            language = "java",
            template = "java-basic",
            icon = "",
        )
        val problem = ForgeProject.create(context, project, meta, force = false)
        if (problem.isNotBlank()) return problem
        return "建好了 ${meta.name} → ${project.absolutePath} (包名 ${meta.packageName}); 下一步 op=build"
    }

    private fun screen(context: Context, request: JsonObject): JsonObject {
        val project = projectOf(context, request)
        val (meta, problem) = ForgeProject.read(project)
        if (meta == null) return text(problem)
        val service = PrivilegedChannel.ensure()
            ?: return text("建虚拟屏要特权通道: " + (PrivilegedChannel.state().error ?: "没有原因"))
        val previous = VirtualScreen.screens.firstOrNull()
        val screen = VirtualScreen.create(name = "开发台")
            ?: return text("虚拟屏没建起来: ${VirtualScreen.lastError ?: "没有原因"}")
        // 开发屏读的是 `app-projects/.current` 这一行; 建屏前先把它写成这个项目
        val pushed = runCatching {
            File(project.parentFile, ".current").writeText(project.absolutePath)
            "已选中 ${meta.name}"
        }.getOrElse { "记号没写成 (${it.message ?: it.javaClass.simpleName})" }
        val launched = runCatching {
            val (code, output) = service.launch(
                displayId = screen.displayId,
                userId = 0,
                packageName = context.packageName,
                component = "${context.packageName}/.ui.DevConsoleActivity",
                timeoutMs = LAUNCH_TIMEOUT_MS,
            )
            "exit $code" + if (output.isBlank()) "" else " (${output.trim().take(120)})"
        }.getOrElse { it.message ?: it.javaClass.simpleName }
        saveScreen(context, screen.displayId, project.absolutePath)
        val replaced = previous?.let { " (换掉了 ${it.label})" }.orEmpty()
        return text(
            "开发屏 ${screen.displayId} 建好了$replaced; 开发台: $launched; 项目: $pushed\n" +
                "看在 Luwi 上面那块预览, 构建时它会跟着 .lwforge/progress.json 走",
        )
    }

    private fun preview(context: Context, request: JsonObject): JsonObject {
        val project = projectOf(context, request)
        val (meta, problem) = ForgeProject.read(project)
        if (meta == null) return text(problem)
        val apk = File(project, ".lwforge/app.apk")
        if (!apk.isFile) return text("还没有成品: 先 op=build 一次")
        val installed = install(context, request)
        val said = installed["text"]?.jsonPrimitive?.contentOrNull ?: "装了一次"
        if (said.contains("系统安装器")) {
            return text("$said\n装上之后再 op=preview 一次, 那时才拉得起来")
        }
        val service = PrivilegedChannel.ensure()
            ?: return text("拉应用要特权通道: " + (PrivilegedChannel.state().error ?: "没有原因"))
        val displayId = savedScreen(context) ?: VirtualScreen.create(name = "开发台")?.displayId
        if (displayId == null) return text("没有可用的开发屏, 先 op=screen 一次")
        val launched = runCatching {
            val (code, output) = service.launch(
                displayId = displayId,
                userId = 0,
                packageName = meta.packageName,
                component = "${context.packageName}/.ui.DevConsoleActivity",
                timeoutMs = LAUNCH_TIMEOUT_MS,
            )
            "exit $code" + if (output.isBlank()) "" else " (${output.trim().take(120)})"
        }.getOrElse { it.message ?: it.javaClass.simpleName }
        return text("$said\n把 ${meta.name} 拉到屏 $displayId: $launched")
    }

    private fun back(context: Context): JsonObject {
        val displayId = savedScreen(context)
        clearScreen(context)
        if (displayId == null) return text("没有记着的开发屏")
        val screen = VirtualScreen.screens.firstOrNull { it.displayId == displayId }
            ?: return text("屏 $displayId 已经不在了")
        VirtualScreen.release(screen)
        return text("收掉开发屏 $displayId")
    }

    // ---- 小件 ---------------------------------------------------------------------------------

    /** 当前项目目录 (slug 与 workspace 都过白名单) */
    private fun projectOf(context: Context, request: JsonObject): File {
        val workspace = workspaceOf(context, request)
        val slug = request.string("project")
        ProjectPath.slugProblem(slug)?.let { throw IllegalArgumentException(it) }
        val project = ProjectPath.projectDir(workspace, slug)
        if (!project.isDirectory) {
            throw IllegalArgumentException("项目 $slug 不在 ${workspace}/app-projects 底下 (先 op=init)")
        }
        return project
    }

    /** `workspace` 参数缺省时退到当前解析出来的那个工作区 */
    private fun workspaceOf(context: Context, request: JsonObject): String {
        val asked = request.string("workspace", "")
        return asked.ifBlank { Workspace.resolve(context).directory.absolutePath }
    }

    /** `last-build.json` 说成人话 */
    private fun lastBuild(project: File): String {
        val file = File(project, ".lwforge/last-build.json")
        if (!file.isFile) return "上次构建: 还没有"
        val json = runCatching { JSONObject(file.readText()) }.getOrNull() ?: return "上次构建: 读不出来"
        val ok = json.optBoolean("ok")
        val apk = json.optString("apk").substringAfterLast('/')
        val bytes = json.optLong("bytes")
        val error = json.optString("error")
        return if (ok) {
            "上次构建: 成功 · $apk · ${bytes / 1024} KB"
        } else {
            "上次构建: 失败 · ${error.ifBlank { "没有写原因" }}"
        }
    }

    private fun stateFile(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), "lw/dev/screen.json")

    private fun saveScreen(context: Context, displayId: Int, project: String) {
        val file = stateFile(context)
        file.parentFile?.mkdirs()
        runCatching {
            file.writeText(
                JSONObject()
                    .put("displayId", displayId)
                    .put("project", project)
                    .put("at", System.currentTimeMillis())
                    .toString(),
            )
        }
    }

    private fun savedScreen(context: Context): Int? {
        val file = stateFile(context)
        if (!file.isFile) return null
        val json = runCatching { JSONObject(file.readText()) }.getOrNull() ?: return null
        return json.optInt("displayId", -1).takeIf { it > 0 }
    }

    private fun clearScreen(context: Context) {
        runCatching { stateFile(context).delete() }
    }

    /** 给 `PrivilegedBridge` 用的一句话回执 */
    private fun text(value: String): JsonObject = buildJsonObject { put("text", value) }
}
