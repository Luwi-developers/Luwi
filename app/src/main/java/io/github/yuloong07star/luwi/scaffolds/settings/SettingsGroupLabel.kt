package io.github.yuloong07star.luwi.scaffolds.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 一级分组标签 ("常用" / "能力")
 *
 * 原来是 20sp 的大字压在段名上面, 于是每一组都像"又起了一个标题"; 现在缩到 11sp 并放宽字距,
 * 左边配一小段 20dp 的横线当章节标记 - 它是"页眉", 不是标题, 段落因此退到第二层
 *
 * 横线用 `outline` (比 `dividerLine` 深一档): 它是标记而不是分隔线, 要压得住那一排 11sp 的字
 */
@Composable
fun SettingsGroupLabel(
    text: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(
                start = SettingsSpace.Inset,
                end = SettingsSpace.Inset,
                top = SettingsSpace.GroupTop,
                bottom = SettingsSpace.GroupBottom,
            ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .width(20.dp)
                .height(SettingsSpace.Hairline)
                .background(colorScheme.outline),
        )
        Spacer(modifier = Modifier.width(10.dp))
        Text(
            text = text,
            style = MiuixTheme.textStyles.footnote2.copy(letterSpacing = 0.9.sp),
            color = colorScheme.onBackgroundVariant,
        )
    }
}
