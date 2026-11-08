package io.github.yuloong07star.luwi.scaffolds.settings

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.ChevronForward
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 页面顶上那条"检查所需依赖"
 *
 * 原来它是一张 `Card`, 而 Card 的底色与页面底几乎同色, 于是滚到顶时只看见一条白边 - 既不像
 * 卡片也不像说明, 是这页最明显的一处"没做完"
 *
 * 现在改成**描边块**: 1dp 线 + 不填底色。它说的是一件"提示"而不是"一段设置", 所以不进索引,
 * 也不跟段争视觉重量
 */
@Composable
fun SettingsNote(
    title: String,
    summary: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(SettingsSpace.PanelCorner)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .border(SettingsSpace.Hairline, colorScheme.outline, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = SettingsSpace.Inset, vertical = SettingsSpace.RowVertical),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MiuixTheme.textStyles.body1,
                color = colorScheme.onBackground,
            )
            Text(
                text = summary,
                style = MiuixTheme.textStyles.footnote1,
                color = colorScheme.onBackgroundVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Icon(
            imageVector = MiuixIcons.ChevronForward,
            contentDescription = null,
            modifier = Modifier
                .padding(start = 10.dp)
                .size(16.dp),
            tint = colorScheme.onBackgroundVariant,
        )
    }
}
