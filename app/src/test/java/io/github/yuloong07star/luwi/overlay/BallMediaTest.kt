package io.github.yuloong07star.luwi.overlay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 图与文件那一格的算式判据 (2026-11-09)
 *
 * 这几个数全都在真机上出过一次事故才会被钉在这里:
 *
 * - **上限**: 原来"她发来的图"借用了表情包那一档 2 MB, 而手机截屏常 2~4 MB —— 图在, 球上只剩一句
 *   "图没取到"。这一条要求它与宿主同一个数 (20 MB)
 * - **尺寸**: 那一格的高度以前靠 `adjustViewBounds` 现量, 量之前是 0 —— 真机读数就是"图落地了而那一格
 *   是空的, 滚一下回复框才长出来"。现在由 [BallMedia.imageBox] 先算好, 没有设备也能量
 * - **分路**: 点开预览窗时"画图 / 给字 / PDF / 交给系统"按扩展名分, 分错一路就是"点开什么都不对"
 */
class BallMediaTest {

    /* ── 上限 ──────────────────────────────────────────────────────────────── */

    @Test
    fun `读图上限与宿主那侧同一个数`() {
        // 宿主: host-plugin/index.mjs 的 LW_IMAGE_MAX_BYTES = 20 * 1024 * 1024
        assertEquals(20L * 1024 * 1024, BallMedia.MAX_BYTES)
    }

    @Test
    fun `球上的图最多占屏高十八`() {
        // 2026-11-10 主人: "图太大了, 最大长宽都缩短到原来一半" —— 高从 36% 收到 18%
        assertEquals(18, BallMedia.MAX_HEIGHT_PERCENT)
    }

    @Test
    fun `那一格的宽最多占一半`() {
        // 宽原来是"铺满", 现在收到 50%: 与高那一条合起来才是"长宽各一半"
        assertEquals(50, BallMedia.MAX_WIDTH_PERCENT)
    }

    @Test
    fun `一条消息最多挂六个附件`() {
        // 与门户 client.js 的 MAX_ATTACH 同一个数
        assertEquals(6, BallMedia.MAX_ATTACH)
    }

    /* ── 那一格该多大 (2026-11-10: 长宽各收一半之后) ────────────────────── */

    @Test
    fun `方图正好是原来的一半宽`() {
        // 734 宽的框: 宽上限 367, 高上限 900 → 方图 367×367 (原来是 734×734)
        val (w, h) = BallMedia.imageBox(1024, 1024, 367, 900)
        assertEquals(367, w)
        assertEquals(367, h)
    }

    @Test
    fun `竖屏截屏先顶到高上限, 宽跟着变窄`() {
        // 1080x2460 的截屏: 宽顶到 367 时高要 835, 没超 900 → 还是按宽 (835 高)
        val (w, h) = BallMedia.imageBox(1080, 2460, 367, 900)
        assertEquals(367, w)
        assertEquals(835, h)
        // 高上限收紧到 424 (18% 屏高) 时: 宽也跟着变窄, 高正好 424
        val (w2, h2) = BallMedia.imageBox(1080, 2460, 367, 424)
        assertEquals(424, h2)
        assertEquals(186, w2)
    }

    @Test
    fun `超宽的图按宽缩, 高不满也不补白`() {
        // 2000x500 的横图: 宽 367 → 高 91, 不为了"整齐"拉到高上限
        val (w, h) = BallMedia.imageBox(2000, 500, 367, 900)
        assertEquals(367, w)
        assertEquals(91, h)
    }

    @Test
    fun `读不到原尺寸就按四比三占位`() {
        val (w, h) = BallMedia.imageBox(0, 0, 200, 900)
        assertEquals(200, w)
        assertEquals(150, h)
    }

    @Test
    fun `宽高至少是一`() {
        val (w, h) = BallMedia.imageBox(1, 100000, 1, 1)
        assertEquals(1, w)
        assertEquals(1, h)
    }

    /* ── 解码降采样 ────────────────────────────────────────────────────────── */

    @Test
    fun `本来就比上限小就不降`() {
        assertEquals(1, BallMedia.sampleFor(400, 300, 800, 600))
    }

    @Test
    fun `大图按二的幂降到位`() {
        // 4000x3000 解到 800x600 那一档: 4 倍刚刚好
        assertEquals(4, BallMedia.sampleFor(4000, 3000, 800, 600))
    }

    @Test
    fun `宽度那一条也会逼着降`() {
        // 一张很宽很矮的图 (4000x200): 只按高降不下来, 得按宽降
        assertEquals(4, BallMedia.sampleFor(4000, 200, 800, 10000))
    }

    /* ── 分路与文本 ────────────────────────────────────────────────────────── */

    @Test
    fun `按扩展名分四路`() {
        assertEquals(BallMedia.Kind.IMAGE, BallMedia.kindOf("7-__.png"))
        assertEquals(BallMedia.Kind.IMAGE, BallMedia.kindOf("A.JPEG"))
        assertEquals(BallMedia.Kind.TEXT, BallMedia.kindOf("notes.md"))
        assertEquals(BallMedia.Kind.TEXT, BallMedia.kindOf("run.log"))
        assertEquals(BallMedia.Kind.PDF, BallMedia.kindOf("说明书.pdf"))
        assertEquals(BallMedia.Kind.OFFICE, BallMedia.kindOf("14-luwi-test.docx"))
        assertEquals(BallMedia.Kind.OFFICE, BallMedia.kindOf("probe.xlsx"))
        assertEquals(BallMedia.Kind.OTHER, BallMedia.kindOf("app.apk"))
        assertEquals(BallMedia.Kind.OTHER, BallMedia.kindOf("没有扩展名"))
    }

    @Test
    fun `扩展名取最后那一段且小写`() {
        assertEquals("png", BallMedia.extensionOf("/a/b/C.PNG"))
        assertEquals("", BallMedia.extensionOf("README"))
        assertEquals("", BallMedia.extensionOf(".hidden"))
    }

    @Test
    fun `字节数给一句人话`() {
        assertEquals("", BallMedia.sizeText(0))
        assertEquals("838 KB", BallMedia.sizeText(858_112))
        assertEquals("1.2 MB", BallMedia.sizeText(1_258_291))
        assertEquals("12 MB", BallMedia.sizeText(12L * 1024 * 1024))
    }

    @Test
    fun `附件段那一句与门户逐字相同`() {
        assertEquals("[附件 2 个, 图片用 read_image 打开]", io.github.yuloong07star.luwi.tool.BallAttach.header(2))
    }

    @Test
    fun `附件段能整段摘掉`() {
        val text = "看一下这个\n\n[附件 1 个, 图片用 read_image 打开]\n1. /sdcard/DSH/lw-in/a.png"
        assertEquals("看一下这个", io.github.yuloong07star.luwi.tool.BallAttach.strip(text))
    }

    @Test
    fun `不是附件段的那种方括号原样留着`() {
        // 主人自己写过 "[附件 2 个" 这样的字: 后面不是路径表就不该被切
        val text = "我说 [附件 2 个] 这件事不算数"
        assertTrue(io.github.yuloong07star.luwi.tool.BallAttach.strip(text) == text)
    }
}
