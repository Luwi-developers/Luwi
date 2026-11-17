package io.github.yuloong07star.luwi.channel

import android.util.Log
import io.github.yuloong07star.luwi.forge.ForgePlan
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * 手机应用工坊的构建执行器 (2.8.1, 特权进程这一侧)
 *
 * 一份 **固定的计划** 进来, 一步一步跑, 每一步都是一份 argv (`ProcessBuilder`, 不经 shell):
 *
 * ```json
 * {
 *   "project": "/sdcard/DSH/Luwi/app-projects/hello",
 *   "work": "/data/local/tmp/lwforge/work/<sha1>",
 *   "steps": [
 *     {"id":"compile","label":"aapt2 compile","argv":["/…/aapt2","compile","--dir","res","-o","work/res.zip"]},
 *     {"id":"link", …},
 *     {"id":"javac", …},
 *     {"id":"dex", …},
 *     {"id":"merge","kind":"dex-merge","apk":"…/unsigned.apk","dex":"…/dex","out":"…/signed-in.apk"},
 *     {"id":"sign", …}
 *   ],
 *   "final": {"from":"…/signed.apk","to":"<项目>/.lwforge/app.apk"}
 * }
 * ```
 *
 * 三道闸: 项目目录必须落在 `app-projects/` 下、work 目录必须在 `/data/local/tmp/lwforge/work/` 下、
 * 每个 argv[0] 必须是 `/data/local/tmp/lwforge/toolchain/` 下的可执行件 —— argv 由应用侧的
 * `forge/ForgePlan.kt` 这个纯函数产出, 模型碰不到命令行, 而这一侧不因为它自称来自应用就放行
 *
 * 进度只认文件: 每一步之前写 `.lwforge/progress.json`, 每步的尾巴追加进 `build.log`, 末尾写
 * `last-build.json` —— 开发台与 Luwi 都读这三个文件, 没有第二条通道
 */
internal object LwForgeBuild {

    private const val TAG = "LwForge"

    /** 计划最多几步 (五步 + 合并 + 收尾, 十六步是宽到不能再宽的上限) */
    private const val MAX_STEPS = 16

    /** 一步最多多久 */
    private const val STEP_TIMEOUT_MS = 240_000L

    /** `build.log` 超过这个大小就只留尾巴 */
    private const val LOG_LIMIT_BYTES = 512 * 1024

    /** 一条 argv 最多几个参数 */
    private const val MAX_ARGS = 64

    /** 计划里的一项 */
    private data class Step(
        val id: String,
        val label: String,
        val kind: String,
        val argv: List<String>,
        val apk: String,
        val dex: String,
        val out: String,
    )

    /**
     * 跑一份计划
     *
     * @param payload 计划 (JSON)
     * @param work 构建目录 (与计划里的 `work` 必须一致)
     * @param timeoutMs 这一条 Binder 事务的总预算; 每一步另按 [STEP_TIMEOUT_MS] 收
     */
    fun run(payload: String, work: String, timeoutMs: Long): LwLinuxSandbox.Outcome {
        val plan = runCatching { JSONObject(payload) }.getOrElse {
            return LwLinuxSandbox.Outcome(2, "forge.build 的参数不是 JSON: ${it.message ?: it.javaClass.simpleName}")
        }
        val projectDir = File(plan.optString("project"))
        projectProblem(projectDir)?.let { return LwLinuxSandbox.Outcome(2, it) }
        val workDir = File(plan.optString("work").ifBlank { work })
        if (!underRoot(workDir, File(LwForgeExec.WORK_DIRECTORY))) {
            return LwLinuxSandbox.Outcome(2, "work 目录必须在 ${LwForgeExec.WORK_DIRECTORY}/ 底下, 不认 ${workDir.path}")
        }
        val steps = readSteps(plan.optJSONArray("steps"))
        if (steps.isEmpty()) return LwLinuxSandbox.Outcome(2, "计划里一步都没有")
        if (steps.size > MAX_STEPS) return LwLinuxSandbox.Outcome(2, "计划有 ${steps.size} 步, 超过 $MAX_STEPS")
        // 源清单: 应用那一侧只给路径, 写在工位里是这一侧的事 (应用进程写不了 /data/local/tmp)
        val sources = plan.optJSONArray("sources")?.let { array ->
            (0 until array.length()).map { array.optString(it) }
        }.orEmpty()
        val stray = sources.firstOrNull { !it.endsWith(".java") || !underRoot(File(it), projectDir) }
        if (stray != null) {
            return LwLinuxSandbox.Outcome(2, "源文件必须都在项目里且是 .java: $stray")
        }
        workDir.mkdirs()
        if (sources.isNotEmpty()) {
            File(workDir, "sources.txt").writeText(sources.joinToString("\n"))
        }
        steps.firstOrNull { it.argv.isNotEmpty() && it.kind != "dex-merge" }?.let { step ->
            val binary = step.argv.first()
            if (!underRoot(File(binary), File(LwForgeExec.TOOLCHAIN_DIRECTORY))) {
                return LwLinuxSandbox.Outcome(2, "argv[0] 必须在工具链目录里, 不认 $binary")
            }
        }

        val forge = File(projectDir, ".lwforge").apply { mkdirs() }
        val log = File(forge, "build.log")
        workDir.mkdirs()
        // 签名密钥先备好: 它是这套流水线的固定前提, 不由计划给 (计划里只写它落在哪)
        ensureKeystore()?.let { failure ->
            writeLastBuild(forge, ok = false, apk = "", bytes = 0, sha = "", label = "", error = failure.output)
            logLine(log, "== failed: ${failure.output} ==")
            return failure
        }
        val started = System.currentTimeMillis()
        logLine(log, "== build ${projectDir.name} · ${steps.size} steps ==")
        // badging 那一步的输出留一份: 它是对账用的 —— 装出来叫什么名字, 以这一行为准
        var badging = ""

        steps.forEachIndexed { index, step ->
            val progress = JSONObject()
                .put("at", System.currentTimeMillis())
                .put("step", step.id)
                .put("index", index + 1)
                .put("total", steps.size)
                .put("text", step.label)
                .toString()
            writeProgress(forge, progress)
            logLine(log, "-- ${index + 1}/${steps.size} ${step.label}")

            val outcome = when (step.kind) {
                "dex-merge" -> mergeDex(step.apk, step.dex, step.out)
                "jar" -> zipClasses(step.apk, step.out)
                "copy" -> copyFile(step.apk, step.out)
                else -> LwLinuxSandbox.runArgv(
                    argv = step.argv,
                    cwd = workDir.absolutePath,
                    timeoutMs = minOf(STEP_TIMEOUT_MS, maxOf(1_000L, timeoutMs)),
                )
            }
            if (outcome.output.isNotBlank()) logLine(log, outcome.output.trim().takeLast(4000))
            if (step.id == "badging") badging = outcome.output
            if (outcome.code != 0) {
                val why = "${step.label} 失败 (exit ${outcome.code})"
                writeProgress(
                    forge,
                    JSONObject()
                        .put("at", System.currentTimeMillis())
                        .put("step", step.id)
                        .put("index", index + 1)
                        .put("total", steps.size)
                        .put("text", why)
                        .put("ok", false)
                        .toString(),
                )
                writeLastBuild(forge, ok = false, apk = "", bytes = 0, sha = "", label = "", error = why)
                logLine(log, "== failed: $why ==")
                return LwLinuxSandbox.Outcome(2, "$why\n${outcome.output.trim().takeLast(1500)}")
            }
        }

        // badging 对账: 清单里写的是不是真的进了 APK (名字与版本号)
        val expectedLabel = plan.optString("label")
        val expectedCode = plan.optInt("versionCode").toString()
        if (badging.isNotBlank() && expectedLabel.isNotBlank()) {
            val labelLine = badging.lineSequence().firstOrNull {
                it.startsWith("application-label:") || it.startsWith("application-label-")
            }.orEmpty()
            val codeLine = badging.lineSequence().firstOrNull { it.startsWith("package:") }.orEmpty()
            val mismatch = when {
                labelLine.isNotEmpty() && !labelLine.contains(expectedLabel) ->
                    "APK 里的名字是 $labelLine, project.json 要的是 $expectedLabel"

                codeLine.isNotEmpty() && !codeLine.contains("versionCode='$expectedCode'") ->
                    "APK 里的版本是 $codeLine, project.json 要的是 versionCode=$expectedCode"

                else -> ""
            }
            if (mismatch.isNotEmpty()) {
                writeLastBuild(forge, ok = false, apk = "", bytes = 0, sha = "", label = expectedLabel, error = mismatch)
                logLine(log, "== failed: $mismatch ==")
                return LwLinuxSandbox.Outcome(2, "badging 对不上: $mismatch")
            }
        }

        val final = plan.optJSONObject("final")
        var apk = File(steps.last().out.ifBlank { steps.last().apk })
        if (final != null) {
            val from = File(final.optString("from"))
            val to = File(final.optString("to"))
            if (!underRoot(to, projectDir)) {
                return LwLinuxSandbox.Outcome(2, "成品落点必须在项目目录里, 不认 ${to.path}")
            }
            val copied = copyFile(from.absolutePath, to.absolutePath)
            if (copied.code != 0) {
                writeLastBuild(forge, ok = false, apk = "", bytes = 0, sha = "", label = "", error = copied.output)
                return copied
            }
            apk = to
        }
        val sha = runCatching { LwForgeExec.sha256(apk) }.getOrDefault("")
        writeLastBuild(
            forge,
            ok = true,
            apk = apk.absolutePath,
            bytes = apk.length(),
            sha = sha,
            label = plan.optString("label"),
            error = "",
        )
        writeProgress(
            forge,
            JSONObject()
                .put("at", System.currentTimeMillis())
                .put("step", "done")
                .put("index", steps.size)
                .put("total", steps.size)
                .put("text", "构建完成")
                .put("ok", true)
                .toString(),
        )
        val spent = (System.currentTimeMillis() - started) / 1000
        logLine(log, "== ok ${apk.name} ${apk.length() / 1024} KB ${spent}s ==")
        Log.i(TAG, "built ${apk.absolutePath} (${apk.length()} bytes, ${spent}s)")
        return LwLinuxSandbox.Outcome(
            0,
            "构建成功: ${steps.size} 步, ${spent}s, ${apk.length() / 1024} KB, sha256 ${sha.take(12)}… " +
                "(成品 ${apk.absolutePath})",
        )
    }

    /** 计划里的步骤表; 坏一步只丢那一步, 但 id / argv 缺了要说话 (回空表 = 一步都没有) */
    private fun readSteps(array: JSONArray?): List<Step> {
        if (array == null) return emptyList()
        val steps = mutableListOf<Step>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val id = item.optString("id").trim()
            if (id.isEmpty()) continue
            val argv = item.optJSONArray("argv")?.let { args ->
                (0 until args.length()).map { args.optString(it) }.filter { it.isNotEmpty() }
            }.orEmpty()
            if (argv.size > MAX_ARGS) continue
            if (argv.any { it.contains('\u0000') || it.contains('\n') }) continue
            val kind = item.optString("kind")
            if (kind != "dex-merge" && kind != "copy" && argv.isEmpty()) continue
            steps += Step(
                id = id,
                label = item.optString("label").ifBlank { id },
                kind = kind,
                argv = argv,
                apk = item.optString("apk"),
                dex = item.optString("dex"),
                out = item.optString("out"),
            )
        }
        return steps
    }

    /** 把 `dex/classes.dex` 塞进 `unsigned.apk` (Kotlin 自己干, 不另找一个 zip 可执行件) */
    private fun mergeDex(apk: String, dexDir: String, out: String): LwLinuxSandbox.Outcome {
        val source = File(apk)
        if (!source.isFile) return LwLinuxSandbox.Outcome(2, "合并 dex 时找不到 $apk")
        val dexes = File(dexDir).listFiles { file -> file.isFile && file.name.endsWith(".dex") }
            ?: return LwLinuxSandbox.Outcome(2, "合并 dex 时读不到 $dexDir")
        if (dexes.isEmpty()) return LwLinuxSandbox.Outcome(2, "合并 dex 时 $dexDir 里没有 .dex")
        File(out).parentFile?.mkdirs()
        return runCatching {
            ZipOutputStream(File(out).outputStream()).use { sink ->
                ZipInputStream(source.inputStream()).use { input ->
                    while (true) {
                        val entry = input.nextEntry ?: break
                        // 旧的那份 classes.dex 丢掉: 这一趟重新编的就是它
                        if (entry.name == "classes.dex") continue
                        sink.putNextEntry(ZipEntry(entry.name).apply { time = entry.time })
                        input.copyTo(sink)
                        sink.closeEntry()
                    }
                }
                dexes.sortedBy { it.name }.forEach { dex ->
                    sink.putNextEntry(ZipEntry(dex.name))
                    dex.inputStream().use { it.copyTo(sink) }
                    sink.closeEntry()
                }
            }
            LwLinuxSandbox.Outcome(0, "merged ${dexes.size} dex into ${File(out).name}")
        }.getOrElse {
            LwLinuxSandbox.Outcome(2, "合并 dex 失败: ${it.message ?: it.javaClass.simpleName}")
        }
    }

    /** 把 `classes/` 打成一个 jar (d8 吃 jar 最稳; 目录递归在 D8 上不保证) */
    private fun zipClasses(dir: String, out: String): LwLinuxSandbox.Outcome {
        val root = File(dir)
        if (!root.isDirectory) return LwLinuxSandbox.Outcome(2, "打包 class 时读不到 $dir")
        val files = root.walkTopDown().filter { it.isFile && it.extension == "class" }.toList()
        if (files.isEmpty()) return LwLinuxSandbox.Outcome(2, "打包 class 时 $dir 里没有 .class")
        return runCatching {
            File(out).parentFile?.mkdirs()
            ZipOutputStream(File(out).outputStream()).use { sink ->
                files.forEach { file ->
                    val name = file.relativeTo(root).invariantSeparatorsPath
                    sink.putNextEntry(ZipEntry(name))
                    file.inputStream().use { it.copyTo(sink) }
                    sink.closeEntry()
                }
            }
            LwLinuxSandbox.Outcome(0, "packed ${files.size} classes into ${File(out).name}")
        }.getOrElse {
            LwLinuxSandbox.Outcome(2, "打包 class 失败: ${it.message ?: it.javaClass.simpleName}")
        }
    }

    /**
     * 签名密钥: 没有就现建一把 (JDK 自带的 `keytool`), 口令写进 `keys/pass` 0600
     *
     * 这一把 key 的身份是**每台设备一份**: 换设备或 `/data/local/tmp` 被清之后, 之前装的应用升不上去,
     * 只能先卸载 —— 上层那句话由 `LwForge` 说, 这里只负责把 key 备出来
     */
    private fun ensureKeystore(): LwLinuxSandbox.Outcome? {
        val keys = File(LwForgeExec.KEYS_DIRECTORY)
        val store = File(keys, "debug.jks")
        val pass = File(keys, "pass")
        if (store.isFile && pass.isFile) {
            // 老机器上可能只有 `pass`: 补一份 key-pass, 但**不重造 key** (那会让已装的应用升不上去)
            val keyPass = File(keys, "key-pass")
            if (!keyPass.isFile) {
                runCatching { keyPass.writeText(pass.readText()) }
                keyPass.setReadable(true, true)
                keyPass.setWritable(true, true)
            }
            return null
        }
        keys.mkdirs()
        val secret = (1..24).map { "0123456789abcdef"[(Math.random() * 16).toInt()] }.joinToString("")
        // 两份口令文件: apksigner 的 `--ks-pass file:` 与 `--key-pass file:` 各自把文件读到 EOF,
        // 同一个文件用两次时第二条会得到 "end of file reached" (2026-11-17 真机踩到)
        listOf("pass", "key-pass").forEach { name ->
            val file = File(keys, name)
            file.writeText(secret)
            file.setReadable(true, true)
            file.setWritable(true, true)
            file.setExecutable(false, false)
        }
        val outcome = LwLinuxSandbox.runArgv(
            argv = listOf(
                ForgePlan.KEYTOOL_BINARY,
                "-genkeypair",
                "-keystore", store.absolutePath,
                "-storepass", secret,
                "-keypass", secret,
                "-alias", "lwforge",
                "-keyalg", "RSA",
                "-keysize", "2048",
                "-validity", "10000",
                "-dname", "CN=Luwi Forge,O=Luwi,C=CN",
            ),
            cwd = keys.absolutePath,
            timeoutMs = 60_000L,
        )
        if (outcome.code != 0) {
            pass.delete()
            return LwLinuxSandbox.Outcome(
                2,
                "签名密钥建不出来 (keytool exit ${outcome.code}): ${outcome.output.takeLast(500)}",
            )
        }
        Log.i(TAG, "keystore created at ${store.absolutePath}")
        return null
    }

    /** 复制一个文件 (成品落点那一趟) */
    private fun copyFile(from: String, to: String): LwLinuxSandbox.Outcome {
        val source = File(from)
        if (!source.isFile) return LwLinuxSandbox.Outcome(2, "要复制的那份不存在: $from")
        return runCatching {
            File(to).parentFile?.mkdirs()
            source.inputStream().use { input -> File(to).outputStream().use { sink -> input.copyTo(sink) } }
            LwLinuxSandbox.Outcome(0, "copied ${source.name} -> ${File(to).name}")
        }.getOrElse {
            LwLinuxSandbox.Outcome(2, "复制失败: ${it.message ?: it.javaClass.simpleName}")
        }
    }

    /** 项目目录的形状: 必须是一个 `app-projects/<slug>` */
    fun projectProblem(project: File): String? {
        if (!project.isAbsolute) return "project 要是绝对路径"
        if (!project.isDirectory) return "项目目录不存在: ${project.path}"
        if (project.parentFile?.name != "app-projects") {
            return "项目必须落在 app-projects/<slug> 底下, 不认 ${project.path}"
        }
        if (!File(project, "AndroidManifest.xml").isFile) return "项目里没有 AndroidManifest.xml"
        return null
    }

    private fun underRoot(file: File, root: File): Boolean {
        val target = runCatching { file.canonicalFile }.getOrElse { return false }
        val base = runCatching { root.canonicalFile }.getOrElse { return false }
        return target.path == base.path || target.path.startsWith(base.path + File.separator)
    }

    private fun writeProgress(forge: File, text: String) {
        runCatching { File(forge, "progress.json").writeText(text) }
            .onFailure { Log.w(TAG, "progress.json 写不进去: ${it.message}") }
    }

    private fun writeLastBuild(
        forge: File,
        ok: Boolean,
        apk: String,
        bytes: Long,
        sha: String,
        label: String,
        error: String,
    ) {
        val json = JSONObject()
            .put("at", System.currentTimeMillis())
            .put("ok", ok)
            .put("apk", apk)
            .put("bytes", bytes)
            .put("sha256", sha)
            .put("label", label)
            .put("error", error)
        runCatching { File(forge, "last-build.json").writeText(json.toString()) }
            .onFailure { Log.w(TAG, "last-build.json 写不进去: ${it.message}") }
    }

    /** 追加一行日志; 过了上限只留最后那段 (构建日志可以很长, 而尾巴才是出错时要看的那一段) */
    private fun logLine(file: File, text: String) {
        runCatching {
            file.appendText("$text\n")
            if (file.length() > LOG_LIMIT_BYTES) {
                val tail = file.readText().takeLast(LOG_LIMIT_BYTES / 2)
                file.writeText("… (前面的截断了)\n$tail")
            }
        }.onFailure { Log.w(TAG, "build.log 写不进去: ${it.message}") }
    }
}
