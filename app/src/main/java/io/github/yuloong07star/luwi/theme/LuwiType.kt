package io.github.yuloong07star.luwi.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import top.yukonga.miuix.kmp.theme.TextStyles
import top.yukonga.miuix.kmp.theme.defaultTextStyles

/**
 * Luwi 的字阶: 十四档一起收一号, 两档字重
 *
 * **为什么全都动**: Miuix 默认那套是给系统设置页用的 (main 17 / paragraph 17 / body1 16 /
 * headline1 17 / footnote1 13), 而设置页里的 preference 标题取的是 main 或 headline 那一档 ——
 * 2026-11-08 第一版只压了 body1 / footnote1, 结果面板里那几行 (17) 比段标题 (15) 还大, 层级是反的
 *
 * 现在全部落成同一把尺:
 *   段标题与面板内标题都是 15 (靠字重分), 摘要 12, 分组标签 11, 顶栏 18
 * 一屏因此能多放两段, 二十段才收得成一份目录
 *
 * 行高统一按 1.45 倍给 (15/22, 12/17): 中文在两行摘要之间不会挤在一起
 */
object LuwiType {

    val textStyles: TextStyles by lazy {
        defaultTextStyles(
            main = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
            paragraph = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
            body1 = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
            body2 = TextStyle(fontSize = 13.sp, lineHeight = 19.sp),
            button = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
            footnote1 = TextStyle(fontSize = 12.sp, lineHeight = 17.sp),
            footnote2 = TextStyle(fontSize = 11.sp, lineHeight = 16.sp),
            headline1 = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
            headline2 = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
            subtitle = TextStyle(fontSize = 13.sp, lineHeight = 19.sp, fontWeight = FontWeight.Medium),
            title1 = TextStyle(fontSize = 28.sp, lineHeight = 36.sp, fontWeight = FontWeight.Medium),
            title2 = TextStyle(fontSize = 21.sp, lineHeight = 29.sp, fontWeight = FontWeight.Medium),
            title3 = TextStyle(fontSize = 18.sp, lineHeight = 26.sp, fontWeight = FontWeight.Medium),
            title4 = TextStyle(fontSize = 16.sp, lineHeight = 23.sp, fontWeight = FontWeight.Medium),
        )
    }
}
