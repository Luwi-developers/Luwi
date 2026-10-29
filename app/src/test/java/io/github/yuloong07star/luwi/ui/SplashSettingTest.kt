package io.github.yuloong07star.luwi.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 开屏那份文件接口自己的纯算术 (2026-10-25 主人: "接口文档放当前已开放的接口")
 *
 * 只钉两件"错了不报错"的:
 *
 * - **`motion` 认不出来回缺省**: agent 写 `"Spin"` / `"rotate"` / 干脆不写, 那时开屏必须还是转圈,
 *   而不是黑着那一屏。这一条现在**大小写不敏感** (返回值各自归位, 不按字符串拼)
 * - **解码跳几个像素**: 一张 5000 万的手机照片按原尺寸解进开屏, 低端机上就是一次看得见的卡
 *   (`inSampleSize` 只认 2 的幂, 而且这里必须按**长边**算 —— 按短边算会把长边放过上限)
 */
class SplashSettingTest {

    @Test
    fun `认不出来的动画名一律回转圈`() {
        assertEquals(SplashSetting.Motion.SPIN, SplashSetting.motionOf(null))
        assertEquals(SplashSetting.Motion.SPIN, SplashSetting.motionOf(""))
        assertEquals(SplashSetting.Motion.SPIN, SplashSetting.motionOf("rotate"))
        assertEquals(SplashSetting.Motion.SPIN, SplashSetting.motionOf("spinning"))
        // 文档里写的是小写, 但大小写不该决定成败
        assertEquals(SplashSetting.Motion.PULSE, SplashSetting.motionOf("pulse"))
        assertEquals(SplashSetting.Motion.PULSE, SplashSetting.motionOf("PULSE"))
        assertEquals(SplashSetting.Motion.NONE, SplashSetting.motionOf(" NONE "))
        assertEquals(SplashSetting.Motion.NONE, SplashSetting.motionOf("none"))
    }

    @Test
    fun `解码按长边缩到上限以内`() {
        // 小图不缩
        assertEquals(1, SplashSetting.pickDecodeSample(300, 200, 480))
        assertEquals(1, SplashSetting.pickDecodeSample(480, 480, 480))
        // 长边超了就跳 2 的幂, 跳到"再跳一档就掉到上限以下"为止 —— 所以跳完的那一档仍**不小于**上限
        // (宁可多解一点也别糊: 480 那一档跳完是 500, 再跳一档就只剩 250)
        assertEquals(2, SplashSetting.pickDecodeSample(960, 480, 480))
        assertEquals(8, SplashSetting.pickDecodeSample(4000, 3000, 480))
        // 竖图与方图: 短边多大都不影响 (按长边算)
        assertEquals(8, SplashSetting.pickDecodeSample(300, 4000, 480))
        assertEquals(16, SplashSetting.pickDecodeSample(8000, 8000, 480))
        // 怪输入不抛
        assertEquals(1, SplashSetting.pickDecodeSample(0, 0, 480))
        assertEquals(1, SplashSetting.pickDecodeSample(4000, 3000, 0))
    }

    /** 自己配了底色时那句"深底上用浅字"的判据: 判错的样子是整屏字看不见 */
    @Test
    fun `深底判定`() {
        assertEquals(true, SplashSetting.isDark(0xFF101014.toInt()))
        assertEquals(true, SplashSetting.isDark(0xFF000000.toInt()))
        assertEquals(false, SplashSetting.isDark(0xFFFFFFFF.toInt()))
        assertEquals(false, SplashSetting.isDark(0xFFF0F0F0.toInt()))
        // 蓝底偏暗、橙底偏亮 (与 `TavernManageScreen` 那条同一个量级)
        assertEquals(true, SplashSetting.isDark(0xFF2040A0.toInt()))
        assertEquals(false, SplashSetting.isDark(0xFFFFB86B.toInt()))
    }

    /** 没写过 `splash.json` 时那一份: 与改配置之前完全一样 (转圈 + 默认标记 + 那行小字) */
    @Test
    fun `缺省那一份就是老样子`() {
        val defaults = SplashSetting.Config()
        assertEquals(SplashSetting.Motion.SPIN, defaults.motion)
        assertEquals(null, defaults.icon)
        assertEquals(null, defaults.accent)
        assertEquals(null, defaults.background)
        assertEquals(true, defaults.showLog)
        assertEquals("", defaults.title)
        assertEquals("", defaults.subtitle)
        assertEquals(SplashSetting.DEFAULT_CREDIT, defaults.credit)
    }
}
