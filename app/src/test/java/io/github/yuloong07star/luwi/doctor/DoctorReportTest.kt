/*
 * 自检报告的**排版**是纯函数, 于是在 JVM 里就能钉住 —— 这张表最后会被用户复制出去、贴进群里,
 * 行首的方括号、每项的 id、末尾不留空行, 都是别人读它的依据, 不该随重构漂。
 *
 * 不测 [Doctor.collect]: 它要 Context 与真机状态, 那一层靠装机读数 (AGENTS.md 的「真机要出读数」)。
 */
package io.github.yuloong07star.luwi.doctor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DoctorReportTest {

    private fun report(vararg checks: DoctorCheck) = DoctorReport(checks.toList())

    @Test
    fun `报告从标题开始, 接着应用与设备两行`() {
        val text = report(DoctorCheck("应用", DoctorStatus.OK, "2.8.0 (19)"))
            .toText(app = "2.8.0 (19)", device = "Xiaomi 14 (houji) · Android 16 (SDK 36)")

        val lines = text.lines()
        assertEquals("Luwi 自检报告（本机生成，未上传）", lines[0])
        assertEquals("应用: 2.8.0 (19)", lines[1])
        assertEquals("设备: Xiaomi 14 (houji) · Android 16 (SDK 36)", lines[2])
    }

    @Test
    fun `每一项一行, 形如 方括号状态 名字 冒号 说明`() {
        val text = report(
            DoctorCheck("特权通道", DoctorStatus.OK, "已连 shizuku · uid=2000 · 13.5.4"),
            DoctorCheck("无障碍", DoctorStatus.FAIL, "服务没挂上：系统的无障碍列表里没有 Luwi"),
        ).toText(app = "2.8.0 (19)", device = "dev")

        val lines = text.lines()
        assertEquals("[OK] 特权通道: 已连 shizuku · uid=2000 · 13.5.4", lines[3])
        assertEquals("[FAIL] 无障碍: 服务没挂上：系统的无障碍列表里没有 Luwi", lines[4])
        assertEquals(5, lines.size)
    }

    @Test
    fun `末尾不留空行`() {
        val text = report(DoctorCheck("存储", DoctorStatus.WARN, "还剩 812 MB")).toText("app", "dev")
        assertFalse("结尾不该多一个空行", text.endsWith("\n"))
        assertEquals("dev", text.lines()[2].removePrefix("设备: "))
    }

    @Test
    fun `有一项 FAIL 就算最坏是 FAIL`() {
        val r = report(
            DoctorCheck("宿主程序", DoctorStatus.OK, "version=abc entries=17456 入口在"),
            DoctorCheck("Node", DoctorStatus.FAIL, "缺 libnode.so: 这个包跑不起宿主"),
            DoctorCheck("存储", DoctorStatus.WARN, "还剩 812 MB"),
        )
        assertEquals(DoctorStatus.FAIL, r.worst)
        assertTrue(r.needsAttention)
    }

    @Test
    fun `全绿时不需要人管`() {
        val r = report(DoctorCheck("存储", DoctorStatus.OK, "还剩 3200 MB"))
        assertEquals(DoctorStatus.OK, r.worst)
        assertFalse(r.needsAttention)
    }

    @Test
    fun `一项都没有时不炸, 且不带出多余的尾巴`() {
        val r = DoctorReport(emptyList())
        assertEquals(DoctorStatus.OK, r.worst)
        assertFalse(r.needsAttention)
        assertEquals(3, r.toText("app", "dev").lines().size)
    }
}
