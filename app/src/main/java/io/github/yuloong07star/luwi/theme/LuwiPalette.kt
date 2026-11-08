package io.github.yuloong07star.luwi.theme

import androidx.compose.ui.graphics.Color
import top.yukonga.miuix.kmp.theme.Colors
import top.yukonga.miuix.kmp.theme.darkColorScheme
import top.yukonga.miuix.kmp.theme.lightColorScheme

/**
 * Luwi 的配色: 冷白 + 墨蓝 + 一条钢蓝
 *
 * 2026-11-08 主人: "最好用可显示科技感的蓝白这类颜色" - 所以整页的底是冷白 (不是暖纸), 字是墨蓝
 * (不是纯黑), 强调色只有一条钢蓝, 而且只用来标"此刻生效"
 *
 * **刻意避开的三种蓝** (都是 AI 生成界面的指纹, 一眼就认得出来):
 * indigo / violet (#6366F1 / #8B5CF6) / Tailwind 默认蓝 (#3B82F6) / 任何紫蓝渐变
 *
 * 技术感来自"读数排得准" (等宽数字 + 1dp 描边 + 细分隔线), 不来自发光与毛玻璃
 *
 * 换主色只改这一个文件: 备选冷青 #0E7C9B / 深靛钢 #1D4E89
 */
object LuwiPalette {

    /**
     * 浅色: 冷白底 + 纯白面板
     *
     * **白卡与冷白底只差 3 个明度档, 分层靠 1dp 描边** - 不用阴影, 因为阴影一上就是"AI 卡片流"
     * 那副样子; 这也是本页与"科技感"之间唯一的形状语言
     */
    val light: Colors by lazy {
        lightColorScheme().copy(
            background = Color(0xFFF2F6FA),
            surface = Color(0xFFFFFFFF),
            surfaceContainer = Color(0xFFEFF1F4),
            surfaceContainerHigh = Color(0xFFE3E6EA),
            onBackground = Color(0xFF0E1A26),
            onBackgroundVariant = Color(0xFF5A6E82),
            onSurfaceVariantSummary = Color(0xFF5A6E82),
            onSurfaceVariantActions = Color(0xFF6B7F94),
            outline = Color(0xFFD3DFEA),
            dividerLine = Color(0xFFE2EAF2),
            primary = Color(0xFF0B63CE),
            onPrimary = Color(0xFFFFFFFF),
            primaryContainer = Color(0xFFEDF0F4),
            // 按钮 / 标签 / chip 那一族: 不覆盖的话它们用的是 Miuix 自带的暖灰 (深色下量到
            // "自检" 那颗按钮是棕灰), 一整页冷蓝里跳出两块暖色, 这就是默认值漏回来的样子
            secondaryContainer = Color(0xFFEFF1F4),
            onSecondaryContainer = Color(0xFF0E1A26),
            tertiaryContainer = Color(0xFFEDF0F4),
            onTertiaryContainer = Color(0xFF0E1A26),
            disabledPrimaryButton = Color(0xFFD3DFEA),
            disabledOnPrimaryButton = Color(0xFFA7B6C4),
            disabledOnSurface = Color(0xFFA7B6C4),
            sliderBackground = Color(0xFFD8E4F0),
            sliderKeyPoint = Color(0xFF0B63CE),
        )
    }

    /**
     * 深色: 墨蓝黑底 + 抬亮一档的同一族钢蓝
     *
     * 深色下那条钢蓝要抬亮 (#5EA4F7) 才有 7.6:1 的对比, 直接用浅色那一支会糊在底上
     */
    val dark: Colors by lazy {
        darkColorScheme().copy(
            background = Color(0xFF0A1118),
            surface = Color(0xFF101A24),
            surfaceContainer = Color(0xFF191D23),
            surfaceContainerHigh = Color(0xFF21262D),
            onBackground = Color(0xFFE8F1F8),
            onBackgroundVariant = Color(0xFF93A6B8),
            onSurfaceVariantSummary = Color(0xFF93A6B8),
            onSurfaceVariantActions = Color(0xFF8FA3B5),
            outline = Color(0xFF25323E),
            dividerLine = Color(0xFF1B2833),
            primary = Color(0xFF5EA4F7),
            onPrimary = Color(0xFF061019),
            primaryContainer = Color(0xFF202429),
            secondaryContainer = Color(0xFF191D23),
            onSecondaryContainer = Color(0xFFE8F1F8),
            tertiaryContainer = Color(0xFF202429),
            onTertiaryContainer = Color(0xFFE8F1F8),
            disabledPrimaryButton = Color(0xFF25323E),
            disabledOnPrimaryButton = Color(0xFF5D6E7E),
            disabledOnSurface = Color(0xFF5D6E7E),
            sliderBackground = Color(0xFF22303D),
            sliderKeyPoint = Color(0xFF5EA4F7),
        )
    }
}
