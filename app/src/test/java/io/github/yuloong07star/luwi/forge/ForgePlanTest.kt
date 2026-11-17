package io.github.yuloong07star.luwi.forge

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * 构建计划那一份 argv 的判据 (2.8.2)
 *
 * 这份计划是"模型碰不到命令行"那句话的落点, 所以每一步的参数顺序都按真值表钉住 —— 顺序错一步
 * (比如 `-o` 跑到输入前面) 在真机上只会得到一句 aapt2 的 usage, 而那种错误没有一条单测兜着就会一路
 * 漂到设备上
 */
class ForgePlanTest {

    @get:Rule
    val temp = TemporaryFolder()

    private fun project(): File {
        val dir = temp.newFolder("app-projects", "hello")
        File(dir, "AndroidManifest.xml").writeText("<manifest package=\"com.example.hello\"/>\n")
        File(dir, "res/layout").mkdirs()
        File(dir, "res/layout/activity_main.xml").writeText("<TextView/>\n")
        File(dir, "src/main/java/com/example/hello").mkdirs()
        File(dir, "src/main/java/com/example/hello/MainActivity.java").writeText(
            "package com.example.hello;\npublic class MainActivity {}\n",
        )
        return dir
    }

    private fun meta(minSdk: Int = 24) = ForgeProject.Meta(
        name = "你好",
        packageName = "com.example.hello",
        versionCode = 3,
        versionName = "1.2",
        minSdk = minSdk,
        targetSdk = 37,
        language = "java",
        template = ForgeProject.TEMPLATE_JAVA,
        icon = "",
    )

    private fun argvOf(plan: JSONObject, id: String): List<String> {
        val steps = plan.getJSONArray("steps")
        for (index in 0 until steps.length()) {
            val step = steps.getJSONObject(index)
            if (step.getString("id") == id) {
                val argv = step.getJSONArray("argv")
                return (0 until argv.length()).map { argv.getString(it) }
            }
        }
        return emptyList()
    }

    @Test
    fun stepsComeInTheOnlyOrderThatWorks() {
        val built = ForgePlan.build(project(), meta())
        val plan = JSONObject(built.json)
        val steps = plan.getJSONArray("steps")
        val ids = (0 until steps.length()).map { steps.getJSONObject(it).getString("id") }
        assertEquals(
            listOf("compile", "link", "javac", "jar", "dex", "merge", "sign", "badging", "verify"),
            ids,
        )
    }

    @Test
    fun everyBinaryComesFromTheToolchainDirectory() {
        val plan = JSONObject(ForgePlan.build(project(), meta()).json)
        val steps = plan.getJSONArray("steps")
        for (index in 0 until steps.length()) {
            val step = steps.getJSONObject(index)
            val argv = step.optJSONArray("argv") ?: continue
            val first = argv.getString(0)
            assertTrue(
                "${step.getString("id")} 的可执行件要在工具链里: $first",
                first.startsWith("/data/local/tmp/lwforge/toolchain/"),
            )
        }
    }

    @Test
    fun linkGetsTheManifestAndTheAndroidJar() {
        val plan = JSONObject(ForgePlan.build(project(), meta()).json)
        val link = argvOf(plan, "link")
        assertTrue("link 要用 -I 指 android.jar", link.contains("-I"))
        assertTrue(
            "android.jar 从工具链里拿",
            link.any { it.endsWith("/toolchain/sdk/android.jar") },
        )
        assertTrue("link 要 --manifest", link.contains("--manifest"))
    }

    @Test
    fun javacUsesTheGeneratedSourcePathAndTheSourceList() {
        val plan = JSONObject(ForgePlan.build(project(), meta()).json)
        val javac = argvOf(plan, "javac")
        assertEquals("javac 从工具链里拿", true, javac.first().endsWith("/toolchain/jdk/bin/javac"))
        assertTrue("要给 -sourcepath 找 R.java", javac.contains("-sourcepath"))
        assertTrue("源清单走 @file", javac.any { it.startsWith("@") && it.endsWith("sources.txt") })
        assertEquals("计划里带一条源路径", 1, plan.getJSONArray("sources").length())
    }

    @Test
    fun d8GetsTheMinimumSdkFromTheProject() {
        val plan = JSONObject(ForgePlan.build(project(), meta(minSdk = 26)).json)
        val dex = argvOf(plan, "dex")
        val at = dex.indexOf("--min-api")
        assertTrue("--min-api 后面要跟着 26", at >= 0 && dex.getOrNull(at + 1) == "26")
    }

    @Test
    fun nothingRunsZipalignOrAShell() {
        val plan = JSONObject(ForgePlan.build(project(), meta()).json)
        val steps = plan.getJSONArray("steps")
        for (index in 0 until steps.length()) {
            val step = steps.getJSONObject(index)
            val argv = step.optJSONArray("argv") ?: continue
            for (argIndex in 0 until argv.length()) {
                val arg = argv.getString(argIndex)
                assertEquals("计划里不许有 zipalign ($arg)", false, arg.contains("zipalign"))
                assertEquals("计划里不许让 shell 接活 ($arg)", false, arg == "sh" || arg == "-c")
            }
        }
    }

    @Test
    fun theFinishedApkLandsInsideTheProject() {
        val project = project()
        val plan = JSONObject(ForgePlan.build(project, meta()).json)
        val target = plan.getJSONObject("final").getString("to")
        assertEquals(File(project, ".lwforge/app.apk").path, File(target).path)
        assertFalse("work 目录不在项目里", plan.getString("work").startsWith(project.path))
    }

    @Test
    fun aProjectWithoutResourcesSkipsCompile() {
        val project = project()
        File(project, "res").deleteRecursively()
        val plan = JSONObject(ForgePlan.build(project, meta()).json)
        val steps = plan.getJSONArray("steps")
        val ids = (0 until steps.length()).map { steps.getJSONObject(it).getString("id") }
        assertFalse("没有 res 就不该有 compile", ids.contains("compile"))
        assertTrue("link 还在", ids.contains("link"))
    }
}
