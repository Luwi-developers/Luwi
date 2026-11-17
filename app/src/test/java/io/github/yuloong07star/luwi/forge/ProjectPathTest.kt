package io.github.yuloong07star.luwi.forge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/**
 * 项目路径那几条白名单的判据 (2.8.2)
 *
 * 这一层的价值全在"不许去哪": 模型给的 workspace 会进特权进程的 argv 与文件操作, 所以每条拒法都要有
 * 一条用例钉着 —— 拒得晚一点, 就是有人能写到别处去
 */
class ProjectPathTest {

    @Test
    fun slugAcceptsTheShapeTheDocsPromise() {
        listOf("hello", "my-app", "app_2", "a").forEach {
            assertNull("$it 应该合格", ProjectPath.slugProblem(it))
        }
    }

    @Test
    fun slugRefusesEverythingThatCannotBeAPathSegment() {
        listOf("", "Hello", "1app", "a/b", "../x", "a b", "a".repeat(40)).forEach {
            assertNotNull("[$it] 应该被拒", ProjectPath.slugProblem(it))
        }
    }

    @Test
    fun packageLooksLikeAnApplicationId() {
        assertNull(ProjectPath.packageProblem("com.example.hello"))
        assertNull(ProjectPath.packageProblem("io.github.yuloong07star.luwi.devconsole"))
        listOf("", "hello", "com", "Com.Example", "com.example.", "com..x").forEach {
            assertNotNull("[$it] 应该被拒", ProjectPath.packageProblem(it))
        }
    }

    @Test
    fun workspaceHasToBeAbsoluteSharedOrAppOwned() {
        assertNotNull("空的不行", ProjectPath.workspaceProblem(""))
        assertNotNull("相对路径不行", ProjectPath.workspaceProblem("Luwi"))
        assertNotNull("别人的目录不行", ProjectPath.workspaceProblem("/etc"))
        assertNotNull("带换行的不行", ProjectPath.workspaceProblem("/sdcard/DSH\nx"))
    }

    @Test
    fun projectDirIsAlwaysUnderAppProjects() {
        val dir = ProjectPath.projectDir("/sdcard/DSH/Luwi", "hello")
        assertEquals("/sdcard/DSH/Luwi/app-projects/hello", dir.path.replace('\\', '/'))
        assertEquals(
            "从项目目录能反推回工作区",
            File("/sdcard/DSH/Luwi").path,
            ProjectPath.workspaceOf(dir)?.path,
        )
        assertNull("不在 app-projects 下就没有工作区", ProjectPath.workspaceOf(File("/sdcard/DSH/Luwi/hello")))
    }
}
