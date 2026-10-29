package io.github.yuloong07star.luwi.host

import io.github.yuloong07star.luwi.tool.LwApiSpeech
import io.github.yuloong07star.luwi.tool.SpeakSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 接口文档那一段替换: 实况要紧, 占位符一个都不许漏, **密钥一个字符都不许出现**
 *
 * 这一段最容易出错的是两件事:
 *
 * 1. 替换值的字符: 地址里带 `$`、`\` 是最正常不过的事, 用正则替换会把它们当分组引用
 * 2. 密钥漏进文档 (2026-10-25 主人: "接口文档里带着明文密钥，删掉，不能放") —— 所以这里量的是
 *    "那串字符不在结果里", 而不是"它出现了"
 */
class LwInterfacesTest {

    private val key = "sk-üse\$/token\\with-backslash"

    private val api = SpeakSettings.ApiConfig(
        url = "https://gateway.example/tts",
        key = key,
        model = "tts-1-hd",
        voice = "luwi-soft-01",
    )

    @Test
    fun `占位符都换成实况, 而密钥只报有没有设置`() {
        val raw = """
            home: ${'$'}DSH_HOME
            api-url: {{API_URL}}
            api-endpoint: {{API_ENDPOINT}}
            api-key: {{API_KEY_STATE}}
            api-model: {{API_MODEL}}
            api-voice: {{API_VOICE}}
        """.trimIndent()
        val text = LwInterfaces.render(raw, "/data/user/0/luwi/files/dsh-home", api)
        assertTrue(text, text.contains("home: /data/user/0/luwi/files/dsh-home"))
        assertTrue(text, text.contains("api-url: https://gateway.example/tts"))
        assertTrue(text, text.contains("api-endpoint: ${LwApiSpeech.endpoint(api.url)}"))
        // 密钥本身一个字符都不许在
        assertFalse(text, text.contains(key))
        assertFalse(text, text.contains("sk-"))
        assertTrue(text, text.contains("api-key: 已设置（值不写进文档）"))
        assertTrue(text, text.contains("api-model: tts-1-hd"))
        assertTrue(text, text.contains("api-voice: luwi-soft-01"))
        assertFalse(text, text.contains("{{"))
    }

    @Test
    fun `什么都没填时说清是没填, 不是留一个占位符`() {
        val empty = SpeakSettings.ApiConfig(url = "", key = "", model = "", voice = "")
        val text = LwInterfaces.render("{{API_URL}}|{{API_ENDPOINT}}|{{API_KEY_STATE}}", "/h", empty)
        val pieces = text.split("|")
        assertEquals(3, pieces.size)
        pieces.forEach { assertTrue(it, it.contains("还没填")) }
    }
}
