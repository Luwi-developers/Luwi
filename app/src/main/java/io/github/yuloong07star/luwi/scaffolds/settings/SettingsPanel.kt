package io.github.yuloong07star.luwi.scaffolds.settings

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.CardColors
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 设置页的面板: 展开那一段的内容装在这里
 *
 * 与裸 `Card` 的差别只有一个 **1dp 描边** - 底色本来就和页面底差不了几档, 不给边就会糊成一片;
 * 而给阴影又太"漂"。描边是仪器面板的做法: 面在底上, 边说得清范围
 *
 * 圆角比 Miuix 默认小一档 (`SettingsSpace.PanelCorner`), 更接近"面板"而不是"药丸"
 *
 * **不给水平外边距**: 页面缩进由 `scaffolds/LazyColumn.kt` 一处给 (仓库纪律), 这里再写一遍就会
 * 出现"这段 12 那段 16"的错位
 */
@Composable
fun SettingsPanel(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(SettingsSpace.PanelCorner)
    Card(
        modifier = modifier
            .fillMaxWidth()
            .border(SettingsSpace.Hairline, colorScheme.outline, shape),
        cornerRadius = SettingsSpace.PanelCorner,
        colors = CardColors(
            color = colorScheme.surface,
            contentColor = colorScheme.onSurface,
        ),
        content = content,
    )
}
