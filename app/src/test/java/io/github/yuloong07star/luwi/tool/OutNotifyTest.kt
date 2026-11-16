package io.github.yuloong07star.luwi.tool

import android.app.ActivityManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 她的话弹通知的那几条判据 (2.8.1 #7)
 *
 * 这一层坏了是**静默**的: 应用在后台时她说了话, 通知栏里什么都没有, 而日志一切正常。所以把三个决定
 * 拆成纯函数钉在这里:
 *
 * 1. [OutNotify.wants] —— 前台不弹 (那一屏本来就画着), 后台与前台服务那一档都弹
 * 2. [OutNotify.sayable] —— 可读的那一行才弹 (`text` 空的不弹, 表情看名字)
 * 3. [LwNotify.sayId] —— 一句一条 (会话 + `seq`), 且不撞宿主常驻那条 1 / 工具那条 2
 */
class OutNotifyTest {

    private fun line(kind: String, text: String = "", sticker: String = "", name: String = "") =
        OutFile.Line(
            seq = 1,
            at = 0L,
            gapMs = 0L,
            kind = kind,
            text = text,
            sticker = sticker,
            rel = "",
            thumb = "",
            w = 0,
            h = 0,
            name = name,
        )

    @Test
    fun `应用在前台时不弹`() {
        assertFalse(OutNotify.wants(ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND))
    }

    @Test
    fun `应用在后台时弹 (前台服务那一档也算后台)`() {
        assertTrue(OutNotify.wants(ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE))
        assertTrue(OutNotify.wants(ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE))
        assertTrue(OutNotify.wants(ActivityManager.RunningAppProcessInfo.IMPORTANCE_SERVICE))
        assertTrue(OutNotify.wants(ActivityManager.RunningAppProcessInfo.IMPORTANCE_CACHED))
    }

    @Test
    fun `有字的那句弹`() {
        assertTrue(OutNotify.sayable(line("text", text = "在的。")))
        // 图与文件带着正文时也是那句正文
        assertTrue(OutNotify.sayable(line("image", text = "这一屏就是那个开关")))
        assertTrue(OutNotify.sayable(line("file", text = "报告放这儿了", name = "报告.pdf")))
    }

    @Test
    fun `没有字的图与文件也弹 (通知里写一句代称)`() {
        assertTrue(OutNotify.sayable(line("image")))
        assertTrue(OutNotify.sayable(line("file", name = "报告.pdf")))
    }

    @Test
    fun `表情看名字, 不看那个占位符`() {
        assertTrue(OutNotify.sayable(line("sticker", text = "[…]", sticker = "开心")))
        assertFalse(OutNotify.sayable(line("sticker", text = "[…]")))
    }

    @Test
    fun `空正文的 text 行不弹`() {
        assertFalse(OutNotify.sayable(line("text", text = "   ")))
        assertFalse(OutNotify.sayable(line("voice")))
    }

    @Test
    fun `一句一条, 同一场里 seq 不同就是不同的 id`() {
        val first = LwNotify.sayId("session-a", 1)
        val second = LwNotify.sayId("session-a", 2)
        assertNotEquals(first, second)
        // 另一场的同一句也不该顶掉这一场那条
        assertNotEquals(first, LwNotify.sayId("session-b", 1))
        // 换了会话再回来还是那一条 (同一句重复读到是更新, 不是第二条)
        assertEquals(first, LwNotify.sayId("session-a", 1))
    }

    @Test
    fun `话的通知 id 不撞常驻那两条`() {
        for (seq in 1..5) {
            for (session in listOf("", "dsh-ball", "session-a", "会话-一")) {
                val id = LwNotify.sayId(session, seq)
                assertTrue("id should stay positive: $id", id > 0)
                assertNotEquals(1, id)
                assertNotEquals(2, id)
            }
        }
    }
}
