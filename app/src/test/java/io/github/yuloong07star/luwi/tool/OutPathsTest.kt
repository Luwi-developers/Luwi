package io.github.yuloong07star.luwi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 长按文件那颗菜单的路径判据 (落实表 #41, 2026-11-13)
 *
 * "复制路径"与"用其它应用打开"都从门户行里那条相对路径出发 (`assets/<id>/<名字>` / `in/<名字>`),
 * 而这条路径最终会被**交给别的应用** —— 认错一段就是复制出一条不存在的路径, 认松一格就是
 * 从别人递来的名字里爬出工作区。两件事都不需要真机, 钉在这里
 */
class OutPathsTest {

    @Test
    fun `她说过的那些落 assets, 自己发上去的落 in`() {
        val asset = OutPaths.lookup("assets/s-1/2-报表.docx")
        assertTrue(asset is OutPaths.Lookup.Found)
        assertEquals(OutPaths.ASSETS, (asset as OutPaths.Lookup.Found).root)
        assertEquals("s-1/2-报表.docx", asset.leaf)

        val inbox = OutPaths.lookup("in/会议记录.pptx")
        assertTrue(inbox is OutPaths.Lookup.Found)
        assertEquals(OutPaths.INBOX, (inbox as OutPaths.Lookup.Found).root)
        assertEquals("会议记录.pptx", inbox.leaf)
    }

    @Test
    fun `前后空格不算路径的一部分`() {
        val found = OutPaths.lookup("  in/图.jpg  ") as OutPaths.Lookup.Found
        assertEquals("图.jpg", found.leaf)
    }

    @Test
    fun `往上爬的那种路径一律不认`() {
        for (bad in listOf("assets/../../etc/passwd", "in/..", "assets/..\\win.ini")) {
            assertTrue("$bad 该被拒", OutPaths.lookup(bad) is OutPaths.Lookup.Rejected)
        }
    }

    @Test
    fun `只认那两段, 别的一律不认并给一句原因`() {
        val cases = mapOf(
            "" to "没有路径",
            "   " to "没有路径",
            "/sdcard/DSH/x.doc" to "只认 assets/ 与 in/ 两段",
            "stickers/开心.png" to "只认 assets/ 与 in/ 两段",
        )
        for ((rel, reason) in cases) {
            val got = OutPaths.lookup(rel)
            assertTrue("$rel 该被拒", got is OutPaths.Lookup.Rejected)
            assertEquals(reason, (got as OutPaths.Lookup.Rejected).reason)
        }
        assertEquals("这不是一条相对路径", (OutPaths.lookup("assets/../x") as OutPaths.Lookup.Rejected).reason)
    }
}
