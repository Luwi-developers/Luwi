package io.github.yuloong07star.luwi.forge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * `project.json` 与 Manifest 那几处同步 (2.8.1)
 *
 * 这三条是"改名字 / 改版本 / 换包名"在磁盘上的样子: 三处 (json / strings.xml / Manifest) 只要有一处没跟上,
 * 装出来的 APK 就会是旧名字或旧版本, 而界面上看不出哪里错了
 */
class ForgeProjectTest {

    @get:Rule
    val temp = TemporaryFolder()

    private fun project(): File = temp.newFolder("hello").apply {
        File(this, "AndroidManifest.xml").writeText(
            """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.hello">
    <application android:versionCode="1" android:versionName="1.0" android:label="@string/app_name" />
</manifest>
""",
        )
        File(this, "res/values").mkdirs()
        File(this, "res/values/strings.xml").writeText(
            """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Hello</string>
</resources>
""",
        )
        File(this, "src/main/java/com/example/hello").mkdirs()
        File(this, "src/main/java/com/example/hello/MainActivity.java").writeText(
            "package com.example.hello;\n\npublic class MainActivity {}\n",
        )
    }

    @Test
    fun metaRoundTripsThroughTheJsonFile() {
        val dir = project()
        val meta = ForgeProject.Meta(
            name = "你好",
            packageName = "com.example.hello",
            versionCode = 3,
            versionName = "1.2",
            minSdk = 24,
            targetSdk = 37,
            language = "java",
            template = ForgeProject.TEMPLATE_JAVA,
            icon = "",
        )
        assertEquals("写回不该出错", "", ForgeProject.write(dir, meta))
        val (read, problem) = ForgeProject.read(dir)
        assertEquals("读回不该出错", "", problem)
        assertNotNull(read)
        assertEquals(meta, read)
    }

    @Test
    fun nameGoesIntoStringsNotIntoTheManifest() {
        val dir = project()
        assertEquals("", ForgeProject.syncName(dir, "鲸鱼"))
        val strings = File(dir, "res/values/strings.xml").readText()
        assertTrue("strings 里要改掉", strings.contains(">鲸鱼<"))
        assertTrue("Manifest 仍引用同一个键", File(dir, "AndroidManifest.xml").readText().contains("@string/app_name"))
    }

    @Test
    fun versionGoesIntoBothAttributes() {
        val dir = project()
        assertEquals("", ForgeProject.syncVersion(dir, "2.0", 7))
        val manifest = File(dir, "AndroidManifest.xml").readText()
        assertTrue("versionName 要换", manifest.contains("""android:versionName="2.0""""))
        assertTrue("versionCode 要换", manifest.contains("""android:versionCode="7""""))
    }

    @Test
    fun changingThePackageMovesTheJavaFile() {
        val dir = project()
        assertEquals("", ForgeProject.syncPackage(dir, "com.example.hi"))
        assertTrue("Manifest 的 package 要换", File(dir, "AndroidManifest.xml").readText().contains("""package="com.example.hi""""))
        val moved = File(dir, "src/main/java/com/example/hi/MainActivity.java")
        assertTrue("类要搬到新包名那条目录下", moved.isFile)
        assertTrue("声明要一起换", moved.readText().startsWith("package com.example.hi;"))
        assertTrue("老文件不该留着", !File(dir, "src/main/java/com/example/hello/MainActivity.java").exists())
    }

    @Test
    fun versionAndSdkLandWhereAapt2LooksForThem() {
        val dir = project()
        assertEquals("", ForgeProject.syncVersion(dir, "2.0", 7))
        assertEquals("", ForgeProject.syncSdk(dir, 26, 37))
        val manifest = File(dir, "AndroidManifest.xml").readText()
        val application = manifest.indexOf("<application")
        val version = manifest.indexOf("android:versionName=\"2.0\"")
        assertTrue("versionName 要在 <application> 之前 (aapt2 只认 <manifest> 上那个)", version in 0 until application)
        assertEquals("旧的 versionCode 只留一份", 1, Regex("android:versionCode=").findAll(manifest).count())
        assertTrue("uses-sdk 要写进去", manifest.contains("""<uses-sdk android:minSdkVersion="26" android:targetSdkVersion="37" />"""))
    }

    @Test
    fun aMissingProjectJsonReadsAsAProblemNotAsDefaults() {
        val dir = temp.newFolder("empty")
        val (meta, problem) = ForgeProject.read(dir)
        assertNull(meta)
        assertTrue("要说出是缺了文件", problem.contains("project.json"))
    }
}
