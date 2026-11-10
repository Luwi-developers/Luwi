package io.github.yuloong07star.luwi.tool

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 对话层那张脸的读法: 缺键 / 越界 / 类型不对 / `wall` 名字不合形状, 一律回缺省
 *
 * 这三件事都没有设备也能量, 而它们恰好是"写坏一份文件"能踩到的全部: `face.json` 是**应用单写者**
 * 落盘的, 可它也会被手改、被一次断电截断、被旧版本留下一个没有 `wall` 的版本 —— 那一层不该因此
 * 画不出来, 顶多回到"只有底色"
 */
class PortalFaceTest {

    /** 合法的那一种名字: `wall-<毫秒>.jpg` */
    private val goodName = "wall-1762500000000.jpg"

    @Test
    fun `空的文件就是缺省那张脸`() {
        val face = PortalFace.faceFrom(null)
        assertEquals(PortalFace.DEFAULT_ALPHA, face.alpha, 0.0001f)
        assertEquals("", face.wall)
    }

    @Test
    fun `两个键都在时照读`() {
        val root = buildJsonObject {
            put("alpha", JsonPrimitive(0.75f))
            put("wall", JsonPrimitive(goodName))
        }
        val face = PortalFace.faceFrom(root)
        assertEquals(0.75f, face.alpha, 0.0001f)
        assertEquals(goodName, face.wall)
    }

    @Test
    fun `alpha 越界夹进 0 到 1`() {
        assertEquals(0f, PortalFace.faceFrom(rootWith(JsonPrimitive(-2f))).alpha, 0.0001f)
        assertEquals(1f, PortalFace.faceFrom(rootWith(JsonPrimitive(9f))).alpha, 0.0001f)
    }

    @Test
    fun `alpha 不是数就回缺省`() {
        assertEquals(PortalFace.DEFAULT_ALPHA, PortalFace.faceFrom(rootWith(JsonPrimitive("half"))).alpha, 0.0001f)
    }

    @Test
    fun `wall 名字不合形状一律当没有`() {
        val bad = listOf(
            "../face.jpg",
            "wall-.jpg",
            "wall-123.jpg",
            "wall-1762500000000.png",
            "/data/data/wall-1762500000000.jpg",
            "",
        )
        for (name in bad) {
            assertEquals(name, "", PortalFace.faceFrom(wallRoot(name)).wall)
        }
    }

    @Test
    fun `wall 名字合规时留着`() {
        assertEquals(goodName, PortalFace.faceFrom(wallRoot(goodName)).wall)
    }

    private fun rootWith(alpha: JsonPrimitive) = buildJsonObject { put("alpha", alpha) }

    private fun wallRoot(name: String) = buildJsonObject { put("wall", JsonPrimitive(name)) }
}
