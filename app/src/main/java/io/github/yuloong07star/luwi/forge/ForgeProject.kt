package io.github.yuloong07star.luwi.forge

import android.content.Context
import android.content.res.AssetManager
import org.json.JSONObject
import java.io.File

/**
 * 一个工坊项目 (2.8.1): `project.json` 的读写 + Manifest 的几处同步 + 模板摊开
 *
 * 项目目录里只有两类文件: 一类是**模型用普通文件工具改的** (Java / res / assets), 一类是这里管的
 * (`project.json` 与 Manifest 里那三个属性). 两边不会打架, 因为 `op=meta` 只碰后者, 而模型改 Java 与 res
 * 时根本不经过这里
 *
 * 模板从 `assets/forge/<template>/` 摊开 (第一个版本只有 `java-basic`): 单 Activity + 一个 TextView,
 * **不带图标** —— 图标由 `op=icon` 落地, 没设图标时用系统默认那个
 */
internal object ForgeProject {

    /** 模板名 */
    const val TEMPLATE_JAVA = "java-basic"

    /** `project.json` 的默认值 */
    private const val DEFAULT_MIN_SDK = 24
    private const val DEFAULT_TARGET_SDK = 37

    /** 一个项目读出来的样子 */
    data class Meta(
        val name: String,
        val packageName: String,
        val versionCode: Int,
        val versionName: String,
        val minSdk: Int,
        val targetSdk: Int,
        val language: String,
        val template: String,
        val icon: String,
    )

    /** 文件 `project.json` 的路径 */
    fun jsonFile(project: File): File = File(project, "project.json")

    /** 读; 读不动回 null + 一句为什么 */
    fun read(project: File): Pair<Meta?, String> {
        val file = jsonFile(project)
        if (!file.isFile) return null to "没有 project.json"
        val json = runCatching { JSONObject(file.readText()) }.getOrElse {
            return null to "project.json 读不动: ${it.message ?: it.javaClass.simpleName}"
        }
        val meta = Meta(
            name = json.optString("name").ifBlank { project.name },
            packageName = json.optString("package"),
            versionCode = json.optInt("versionCode", 1),
            versionName = json.optString("versionName").ifBlank { "1.0" },
            minSdk = json.optInt("minSdk", DEFAULT_MIN_SDK),
            targetSdk = json.optInt("targetSdk", DEFAULT_TARGET_SDK),
            language = json.optString("language").ifBlank { "java" },
            template = json.optString("template").ifBlank { TEMPLATE_JAVA },
            icon = json.optString("icon"),
        )
        return meta to ""
    }

    /** 写回; 回一句错 (空串 = 好了) */
    fun write(project: File, meta: Meta): String = runCatching {
        val json = JSONObject()
            .put("v", 1)
            .put("name", meta.name)
            .put("package", meta.packageName)
            .put("versionCode", meta.versionCode)
            .put("versionName", meta.versionName)
            .put("minSdk", meta.minSdk)
            .put("targetSdk", meta.targetSdk)
            .put("language", meta.language)
            .put("template", meta.template)
            .put("icon", meta.icon)
        jsonFile(project).writeText(json.toString(2))
        ""
    }.getOrElse { "project.json 写不进去: ${it.message ?: it.javaClass.simpleName}" }

    /**
     * 摊一份模板
     *
     * 只写模板目录里有的那几个文件; 目标已存在就不动 (第二次 `init` 在调用方那一层就被拒了, 这里只是
     * 不让"补文件"把模型改过的东西盖掉)
     */
    fun unpack(context: Context, project: File, template: String, meta: Meta): String {
        val root = "forge/$template"
        val files = listAssets(context.assets, root) ?: return "模板 $template 不在包里"
        if (files.isEmpty()) return "模板 $template 是空的"
        files.forEach { relative ->
            val target = File(project, relative.removePrefix("$root/"))
            if (target.isFile) return@forEach
            val parent = target.parentFile
            if (parent != null && !parent.isDirectory && !parent.mkdirs()) {
                return "建不出目录: ${target.parent}"
            }
            runCatching {
                context.assets.open(relative).use { input ->
                    target.outputStream().use { sink -> input.copyTo(sink) }
                }
            }.getOrElse { return "摊 $relative 失败: ${it.message ?: it.javaClass.simpleName}" }
        }
        // 名字与版本先落进 strings 与 Manifest (模板里写的是 @string/app_name 与 1.0)
        syncName(project, meta.name)
        syncVersion(project, meta.versionName, meta.versionCode)
        return ""
    }

    /**
     * 把模板的 `com.example.hello` 换成人给的那个包名
     *
     * 三处一起改: Manifest 的 `package`、每个 `.java` 的 `package` 声明、以及文件所在的目录 (Java 的
     * 目录要跟包名对上, 否则 javac 报"类在错误的目录里"). 模板只有一个类, 所以这一条只需要搬一次
     */
    fun syncPackage(project: File, packageName: String): String {
        val manifest = File(project, "AndroidManifest.xml")
        if (manifest.isFile) {
            val text = runCatching { manifest.readText() }.getOrElse {
                return "Manifest 读不动: ${it.message ?: it.javaClass.simpleName}"
            }
            val next = if (Regex("""package="[^"]*"""").containsMatchIn(text)) {
                text.replace(Regex("""package="[^"]*""""), """package="$packageName"""")
            } else {
                text
            }
            runCatching { manifest.writeText(next) }.onFailure {
                return "Manifest 写不进去: ${it.message ?: it.javaClass.simpleName}"
            }
        }
        val srcRoot = File(project, "src/main/java")
        if (!srcRoot.isDirectory) return ""
        val targetDir = File(srcRoot, packageName.replace('.', '/'))
        val files = srcRoot.walkTopDown().filter { it.isFile && it.extension == "java" }.toList()
        files.forEach { file ->
            val text = runCatching { file.readText() }.getOrNull() ?: return@forEach
            val declaration = Regex("""^package\s+[\w.]+;""", RegexOption.MULTILINE)
            val current = Regex("""^package\s+([\w.]+);""", RegexOption.MULTILINE)
                .find(text)?.groupValues?.get(1)
            if (current == packageName) return@forEach
            val next = if (declaration.containsMatchIn(text)) {
                declaration.replaceFirst(text, "package $packageName;")
            } else {
                "package $packageName;\n\n$text"
            }
            val target = File(targetDir, file.name)
            if (target.canonicalPath == file.canonicalPath) {
                runCatching { file.writeText(next) }
                return@forEach
            }
            targetDir.mkdirs()
            val written = runCatching { target.writeText(next) }.isSuccess
            if (written) runCatching { file.delete() }
        }
        return ""
    }

    /**
     * 把 min / target SDK 写进 `<uses-sdk>` (2.8.1 真机补的一条)
     *
     * 不写这两个数时 aapt2 当作 "targetSdkVersion 缺失", 真机上会多出两条 implied permission
     * (`WRITE_EXTERNAL_STORAGE` / `READ_PHONE_STATE`, 理由写着 `targetSdkVersion < 4`) —— 那既不是我们
     * 想要的, 也会让系统的兼容开关按十几年前的行为打开
     */
    fun syncSdk(project: File, minSdk: Int, targetSdk: Int): String {
        val file = File(project, "AndroidManifest.xml")
        if (!file.isFile) return "项目里没有 AndroidManifest.xml"
        val text = runCatching { file.readText() }.getOrElse {
            return "Manifest 读不动: ${it.message ?: it.javaClass.simpleName}"
        }
        val cleaned = text.replace(Regex("""\s*<uses-sdk\b[^>]*/>"""), "")
        val tag = """<uses-sdk android:minSdkVersion="$minSdk" android:targetSdkVersion="$targetSdk" />"""
        val next = cleaned.replace(Regex("""<manifest\b[^>]*>"""), "$0\n    $tag")
        return runCatching { file.writeText(next); "" }
            .getOrElse { "Manifest 写不进去: ${it.message ?: it.javaClass.simpleName}" }
    }

    /** 把名字写进 `values/strings.xml` 的 `app_name` */
    fun syncName(project: File, name: String): String {
        val file = File(project, "res/values/strings.xml")
        if (!file.isFile) return "项目里没有 res/values/strings.xml"
        val text = runCatching { file.readText() }.getOrElse {
            return "strings.xml 读不动: ${it.message ?: it.javaClass.simpleName}"
        }
        val escaped = name.replace("&", "&amp;").replace("<", "&lt;").replace("'", "\\'")
        val pattern = Regex("""<string name="app_name">.*?</string>""", RegexOption.DOT_MATCHES_ALL)
        val next = if (pattern.containsMatchIn(text)) {
            pattern.replace(text) { """<string name="app_name">$escaped</string>""" }
        } else {
            text.replace("</resources>", """    <string name="app_name">$escaped</string>
</resources>""")
        }
        return runCatching { file.writeText(next); "" }
            .getOrElse { "strings.xml 写不进去: ${it.message ?: it.javaClass.simpleName}" }
    }

    /** 把版本号写进 Manifest 的 `<manifest>` 那两个属性 (aapt2 只认这里) */
    fun syncVersion(project: File, versionName: String, versionCode: Int): String {
        val file = File(project, "AndroidManifest.xml")
        if (!file.isFile) return "项目里没有 AndroidManifest.xml"
        val text = runCatching { file.readText() }.getOrElse {
            return "Manifest 读不动: ${it.message ?: it.javaClass.simpleName}"
        }
        // 先把旧的两个属性从哪儿都摘掉 (老模板放在 `<application>` 上, aapt2 不认那一处), 再写到
        // `<manifest` 的起始标签里 —— 只留一份, 免得同一份清单里两处各说一个版本
        var next = text.replace(Regex("""\s*android:version(?:Code|Name)="[^"]*""""), "")
        next = next.replace(
            Regex("""<manifest\b"""),
            "<manifest\n    android:versionCode=\"$versionCode\"\n    android:versionName=\"$versionName\"",
        )
        return runCatching { file.writeText(next); "" }
            .getOrElse { "Manifest 写不进去: ${it.message ?: it.javaClass.simpleName}" }
    }

    /** 建项目: 目录 + 模板 + project.json; 已存在就拒 (调用方给 `force` 才继续) */
    fun create(
        context: Context,
        project: File,
        meta: Meta,
        force: Boolean,
    ): String {
        if (project.isDirectory && !force) {
            return "项目 $project 已经在, 要覆盖请带 force=true"
        }
        if (!project.isDirectory && !project.mkdirs()) return "建不出目录: ${project.path}"
        val manifested = unpack(context, project, meta.template, meta)
        if (manifested.isNotEmpty()) return manifested
        val packaged = syncPackage(project, meta.packageName)
        if (packaged.isNotEmpty()) return packaged
        val sdk = syncSdk(project, meta.minSdk, meta.targetSdk)
        if (sdk.isNotEmpty()) return sdk
        return write(project, meta)
    }

    /** 模板 assets 里那几份文件 (递归; 没有就是 null) */
    private fun listAssets(assets: AssetManager, path: String): List<String>? = runCatching {
        val out = mutableListOf<String>()
        fun walk(dir: String) {
            val names = assets.list(dir) ?: return
            names.forEach { name ->
                val child = "$dir/$name"
                val nested = assets.list(child).orEmpty()
                if (nested.isEmpty()) out += child else walk(child)
            }
        }
        walk(path)
        out
    }.getOrNull()
}
