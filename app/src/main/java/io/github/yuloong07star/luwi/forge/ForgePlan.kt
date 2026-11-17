package io.github.yuloong07star.luwi.forge

import io.github.yuloong07star.luwi.channel.LwForgeExec
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * 一份构建计划 (2.8.1): 五步固定 argv + 合并 dex + 两个对账
 *
 * **这个文件是"模型碰不到命令行"这句话的落点**: 一条 argv 都不由调用方给, 全部在这里按工具链的固定落点
 * 拼出来; 外面只给项目与元信息. 单测直接比 `argv` 的每一项 (计划是纯函数, 不碰文件)
 *
 * 工具链的落点 (与 `tools/fetch-toolchain.ps1` 生成的目录一一对应):
 *
 * ```text
 * /data/local/tmp/lwforge/toolchain/
 *   jdk/bin/{java,javac,keytool}
 *   build-tools/aapt2
 *   build-tools/lib/{d8.jar,apksigner.jar}
 *   sdk/android.jar
 * ```
 *
 * **没有 zipalign**: 侧载不要求 4 字节对齐 (那是 Play 的门槛), 质量由 `aapt2 dump badging` 与
 * `apksigner verify` 兜
 */
internal object ForgePlan {

    /** 工具链里的几个固定落点 */
    private const val AAPT2 = "${LwForgeExec.TOOLCHAIN_DIRECTORY}/build-tools/aapt2"
    private const val D8_JAR = "${LwForgeExec.TOOLCHAIN_DIRECTORY}/build-tools/lib/d8.jar"
    private const val APKSIGNER_JAR = "${LwForgeExec.TOOLCHAIN_DIRECTORY}/build-tools/lib/apksigner.jar"
    private const val ANDROID_JAR = "${LwForgeExec.TOOLCHAIN_DIRECTORY}/sdk/android.jar"
    private const val JAVA = "${LwForgeExec.TOOLCHAIN_DIRECTORY}/jdk/bin/java"
    private const val JAVAC = "${LwForgeExec.TOOLCHAIN_DIRECTORY}/jdk/bin/javac"
    private const val KEYTOOL = "${LwForgeExec.TOOLCHAIN_DIRECTORY}/jdk/bin/keytool"
    private const val KEYSTORE = "${LwForgeExec.KEYS_DIRECTORY}/debug.jks"
    private const val KEY_PASS_FILE = "${LwForgeExec.KEYS_DIRECTORY}/pass"
    private const val KEY_KEY_PASS_FILE = "${LwForgeExec.KEYS_DIRECTORY}/key-pass"

    /** 一步给人看的名字 (进度与日志都用它) */
    private const val LABEL_COMPILE = "aapt2 编资源"
    private const val LABEL_LINK = "aapt2 链接"
    private const val LABEL_JAVAC = "javac 编 Java"
    private const val LABEL_JAR = "打包 class"
    private const val LABEL_DEX = "d8 转 dex"
    private const val LABEL_MERGE = "合并 dex 进 APK"
    private const val LABEL_ALIGN = "对齐资源表"
    private const val LABEL_SIGN = "apksigner 签名"
    private const val LABEL_BADGING = "aapt2 读清单"
    private const val LABEL_VERIFY = "apksigner 验签"

    /** 一份计划 */
    data class Built(
        val json: String,
        val workDir: File,
        val sources: List<File>,
        val notes: List<String>,
    )

    /** 计划里用到的那个 keytool (与 `LwForgeBuild` 里那一份配套, 判据脚本也读它) */
    const val KEYTOOL_BINARY = KEYTOOL

    /** 计划: 只读项目目录, 不写 (中间产物全在 work 里, 源清单由特权那一侧写) */
    fun build(project: File, meta: ForgeProject.Meta): Built {
        val work = workDirOf(project)
        val notes = mutableListOf<String>()
        val res = File(project, "res")
        val src = File(project, "src")
        val manifest = File(project, "AndroidManifest.xml")
        val resZip = File(work, "res.zip")
        val unsigned = File(work, "unsigned.apk")
        val gen = File(work, "gen")
        val classes = File(work, "classes")
        val classesJar = File(work, "classes.jar")
        val dex = File(work, "dex")
        val merged = File(work, "merged.apk")
        val aligned = File(work, "aligned.apk")
        val signed = File(work, "signed.apk")
        val sourcesFile = File(work, "sources.txt")
        val sources = if (src.isDirectory) {
            src.walkTopDown().filter { it.isFile && it.extension == "java" }.toList()
        } else {
            emptyList()
        }
        if (sources.isEmpty()) notes += "项目里没有 Java 源码"

        val steps = JSONArray()
        if (res.isDirectory) {
            steps.put(
                step(
                    "compile",
                    LABEL_COMPILE,
                    listOf(AAPT2, "compile", "--dir", res.absolutePath, "-o", resZip.absolutePath),
                ),
            )
        } else {
            notes += "项目里没有 res/, 跳过 aapt2 compile"
        }
        steps.put(
            step(
                "link",
                LABEL_LINK,
                buildList {
                    add(AAPT2)
                    add("link")
                    add("-o")
                    add(unsigned.absolutePath)
                    add("-I")
                    add(ANDROID_JAR)
                    add("--manifest")
                    add(manifest.absolutePath)
                    if (res.isDirectory) {
                        add("-R")
                        add(resZip.absolutePath)
                    }
                    add("--java")
                    add(gen.absolutePath)
                    add("--auto-add-overlay")
                },
            ),
        )
        if (sources.isNotEmpty()) {
            steps.put(
                step(
                    "javac",
                    LABEL_JAVAC,
                    listOf(
                        JAVAC,
                        // Java 8 是这条链上唯一能同时满足两边的档: JDK 21 只在 `-source/-target 8` 时
                        // 还允许 `-bootclasspath` (拿 android.jar 当平台类), 而安卓侧 24+ 全收 v52 字节码
                        // (2026-11-17 真机: 17 + bootclasspath 被 javac 一句 "not allowed with target 17" 挡回)
                        "-source",
                        "8",
                        "-target",
                        "8",
                        "-Xlint:-options",
                        "-bootclasspath",
                        ANDROID_JAR,
                        "-sourcepath",
                        gen.absolutePath,
                        "-d",
                        classes.absolutePath,
                        "@${sourcesFile.absolutePath}",
                    ),
                ),
            )
            steps.put(
                JSONObject()
                    .put("id", "jar")
                    .put("label", LABEL_JAR)
                    .put("kind", "jar")
                    .put("apk", classes.absolutePath)
                    .put("out", classesJar.absolutePath),
            )
            steps.put(
                step(
                    "dex",
                    LABEL_DEX,
                    listOf(
                        JAVA,
                        "-cp",
                        D8_JAR,
                        "com.android.tools.r8.D8",
                        "--lib",
                        ANDROID_JAR,
                        "--min-api",
                        meta.minSdk.toString(),
                        "--output",
                        dex.absolutePath,
                        classesJar.absolutePath,
                    ),
                ),
            )
        }
        steps.put(
            JSONObject()
                .put("id", "merge")
                .put("label", LABEL_MERGE)
                .put("kind", "dex-merge")
                .put("apk", unsigned.absolutePath)
                .put("dex", dex.absolutePath)
                .put("out", merged.absolutePath),
        )
        steps.put(
            JSONObject()
                .put("id", "align")
                .put("label", LABEL_ALIGN)
                .put("kind", "align")
                .put("apk", merged.absolutePath)
                .put("out", aligned.absolutePath),
        )
        steps.put(
            step(
                "sign",
                LABEL_SIGN,
                listOf(
                    JAVA,
                    "-jar",
                    APKSIGNER_JAR,
                    "sign",
                    "--ks",
                    KEYSTORE,
                    "--ks-pass",
                    "file:$KEY_PASS_FILE",
                    "--key-pass",
                    "file:$KEY_KEY_PASS_FILE",
                    "--in",
                    aligned.absolutePath,
                    "--out",
                    signed.absolutePath,
                ),
            ),
        )
        steps.put(step("badging", LABEL_BADGING, listOf(AAPT2, "dump", "badging", signed.absolutePath)))
        steps.put(
            step(
                "verify",
                LABEL_VERIFY,
                listOf(JAVA, "-jar", APKSIGNER_JAR, "verify", signed.absolutePath),
            ),
        )

        val plan = JSONObject()
            .put("project", project.absolutePath)
            .put("work", work.absolutePath)
            .put("label", meta.name)
            .put("versionCode", meta.versionCode)
            .put("versionName", meta.versionName)
            .put("sources", JSONArray(sources.map { it.absolutePath }))
            .put("steps", steps)
            .put(
                "final",
                JSONObject()
                    .put("from", signed.absolutePath)
                    .put("to", File(project, ".lwforge/app.apk").absolutePath),
            )
        return Built(plan.toString(), work, sources, notes)
    }

    /** 中间产物落在哪: `/data/local/tmp/lwforge/work/<sha1(项目路径)>` (路径长的项目也只有一个短名字) */
    fun workDirOf(project: File): File {
        val digest = MessageDigest.getInstance("SHA-1").digest(project.absolutePath.toByteArray())
        val name = digest.joinToString("") { "%02x".format(it) }.take(16)
        return File(LwForgeExec.WORK_DIRECTORY, name)
    }

    /** 一步不带 kind 的形态 */
    private fun step(id: String, label: String, argv: List<String>): JSONObject = JSONObject()
        .put("id", id)
        .put("label", label)
        .put(
            "argv",
            JSONArray(argv),
        )
}
