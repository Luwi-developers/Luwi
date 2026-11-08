package io.github.yuloong07star.luwi.scaffolds

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.yuloong07star.luwi.scaffolds.settings.SettingsGroupLabel
import io.github.yuloong07star.luwi.scaffolds.settings.SettingsSectionHeader
import io.github.yuloong07star.luwi.scaffolds.settings.SettingsSpace
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 段标题: 名字与签名都没变, 里面换成了 [SettingsSectionHeader]
 *
 * 2026-11-08 之前这里是一行 `Row`: 段名 (14sp) 与摘要 (11.5sp) **并肩**排, 而段名只有两三个字,
 * 于是摘要那一列的起点随段名字数左一下右一下, 二十段看下来是一排锯齿; 两者字号又只差 2.5sp,
 * 读者分不出"哪一层是标题"
 *
 * 新版竖排两行 (15 / 12), 并且**只在有 [onToggle] 时才带折角** - 别的页面若只想借一个标题,
 * 拿到的仍然是纯文字
 */
@Composable
fun SectionTitle(
    title: String,
    summary: String? = null,
    collapsed: Boolean = false,
    onToggle: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    if (onToggle != null) {
        SettingsSectionHeader(
            title = title,
            summary = summary.orEmpty(),
            collapsed = collapsed,
            onToggle = onToggle,
            modifier = modifier,
        )
    } else {
        Column(
            modifier = modifier
                .fillMaxWidth()
                .padding(horizontal = SettingsSpace.Inset, vertical = SettingsSpace.RowVertical),
        ) {
            Text(
                text = title,
                style = MiuixTheme.textStyles.body1,
                color = colorScheme.onBackground,
            )
            if (!summary.isNullOrEmpty()) {
                Text(
                    text = summary,
                    style = MiuixTheme.textStyles.footnote1,
                    color = colorScheme.onBackgroundVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
    }
}

/**
 * 一级分组标题: 转给 [SettingsGroupLabel]
 *
 * 字号从 20sp 收到 11sp 加宽字距: 它原来是这一页最大的一行字, 结果"能力"两个字比下面任何一段
 * 都抢眼; 现在它是页眉, 段落才是内容 (段与组的距离由 `SettingsSpace.GroupTop` 给)
 */
@Composable
fun GroupTitle(text: String, modifier: Modifier = Modifier) {
    SettingsGroupLabel(text = text, modifier = modifier)
}
