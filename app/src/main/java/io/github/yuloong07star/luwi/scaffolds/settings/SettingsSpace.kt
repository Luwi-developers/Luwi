package io.github.yuloong07star.luwi.scaffolds.settings

import androidx.compose.ui.unit.dp

/**
 * 设置页的间距与形状刻度
 *
 * 全部是 4 的倍数, 而且**只有这一份** - 页面里不再出现 `padding(13.dp)` 这种一步一写的数字,
 * 也就不可能出现"这一段 12 那一段 16"的走岔 (`tools/check-settings-visual.mjs` 会拦字面量)
 *
 * 与 `constants/UiSpacing.kt` 分开是因为那一份是全局的 (首页 / 会话 / 其它页都在用), 改它会
 * 连带改别的页; 这一份只属于设置页
 */
object SettingsSpace {

    /** 页面左右缩进: 比全局那 12dp 宽一档, 让"索引"看起来是排过版的 */
    val Inset = 16.dp

    /** 段行内的上下留白: 收起态一行 56dp 高, 手指好点 */
    val RowVertical = 12.dp

    /** 段行的最小高度 */
    val RowMinHeight = 56.dp

    /** 展开时标题与面板之间的空 */
    val PanelGap = 10.dp

    /** 一段结束到下一段标题之间的空 (展开态的呼吸) */
    val SectionGap = 20.dp

    /** 分组标签上方的空: 比段间距大一档, 于是"分组 > 段"这层关系不用字重也看得出 */
    val GroupTop = 28.dp

    val GroupBottom = 8.dp

    /** 折角与箭头的尺寸 */
    val Chevron = 18.dp

    /** 顶部段名索引条那一行的高度: 与段行同一个"手指好点"的下限, 但比它矮一档, 免得占掉一屏 */
    val BarHeight = 40.dp

    /** 索引条里每个段名的左右留白 (文字与文字之间靠 [ChipGap] 分开) */
    val ChipPadding = 10.dp

    /** 相邻两个段名之间的距离 */
    val ChipGap = 6.dp

    /** 选中段名底下那条短线的长与粗: 与外观段的分段控件同一套 (18dp / 2dp) */
    val IndicatorWidth = 18.dp

    val IndicatorHeight = 2.dp

    /** 细线的粗细 */
    val Hairline = 1.dp

    /** 面板圆角: 比 Miuix 默认小一档, 更像仪器面板而不是药丸 */
    val PanelCorner = 14.dp
}
