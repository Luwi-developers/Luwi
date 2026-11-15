package io.github.yuloong07star.luwi.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 语音输入选的是哪一条 (2026-11-15, 2.8.1 #4)
 *
 * 两件事要钉住: ① 文件里那个串只有两档, 缺文件 / 写坏 / 认不出来一律回本地 (一份坏设置不该把语音
 * 整条哑掉) ② "语音这一件办没办"对两条来路都要答对 —— 本地模型在位算办过, 选了账号那条也算, 因为
 * 它不需要那 240 MB
 */
class VoiceSourceTest {

    @Test
    fun `缺省是本地模型`() {
        assertEquals(VoiceSource.LOCAL, VoiceSource.normalise(null))
        assertEquals(VoiceSource.LOCAL, VoiceSource.normalise(""))
        assertEquals(VoiceSource.LOCAL, VoiceSource.normalise("   "))
    }

    @Test
    fun `认不出来的值也回本地模型`() {
        assertEquals(VoiceSource.LOCAL, VoiceSource.normalise("sensevoice"))
        assertEquals(VoiceSource.LOCAL, VoiceSource.normalise("DEEPSEEK-OFFICIAL"))
    }

    @Test
    fun `账号那条能认出来, 前后空白不算数`() {
        assertEquals(VoiceSource.DEEPSEEK, VoiceSource.normalise("deepseek"))
        assertEquals(VoiceSource.DEEPSEEK, VoiceSource.normalise("  deepseek\n"))
    }

    @Test
    fun `本地模型在位就算办过`() {
        assertTrue(VoiceSource.satisfied(VoiceSource.LOCAL, modelPresent = true))
        assertTrue(VoiceSource.satisfied(VoiceSource.DEEPSEEK, modelPresent = true))
    }

    @Test
    fun `选了账号那条, 没下模型也算办过`() {
        assertTrue(VoiceSource.satisfied(VoiceSource.DEEPSEEK, modelPresent = false))
    }

    @Test
    fun `本地那条没下模型就是没办`() {
        assertFalse(VoiceSource.satisfied(VoiceSource.LOCAL, modelPresent = false))
        // 写坏的值按本地算, 于是照样是"缺模型"
        assertFalse(VoiceSource.satisfied("", modelPresent = false))
    }
}
