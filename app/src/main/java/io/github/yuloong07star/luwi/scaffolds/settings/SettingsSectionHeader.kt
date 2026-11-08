package io.github.yuloong07star.luwi.scaffolds.settings

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yuloong07star.luwi.R
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.ChevronForward
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 一段的标题行: 收起态是一行目录, 展开态是这一页的小标题
 *
 * **标题与摘要从此竖排** (2026-11-08): 旧版把两者放在同一 `Row` 里, 段名只有两三个字, 于是
 * 摘要那一列的起点随段名字数左右跳动, 二十段看下来像锯齿; 而且两者同字号, 读起来像一句被
 * 砍成两截的话。改成上下两行之后左边缘是一条直线, 字号也拉开了 (15 / 12)
 *
 * **折角是靠颜色说真话的那一个**: 收起时它是灰色 (没什么可说的), 展开时换成主色 (这一段就是
 * 你现在打开的这一页)。整页只有它一处用强调色, 所以"哪段开着"一眼就找到
 *
 * 摘要最多两行: 一行放不下是文案的问题, 不该靠缩字号解决 (见 2026-11-08 那九条改写)
 */
@Composable
fun SettingsSectionHeader(
    title: String,
    summary: String,
    collapsed: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // 旋转 180 度走 180 ms: 与 Miuix 自己的展开动画同一条时间轴, 不弹不缩
    val angle by animateFloatAsState(
        targetValue = if (collapsed) 90f else -90f,
        animationSpec = tween(durationMillis = 180, easing = FastOutSlowInEasing),
        label = "settings-chevron",
    )
    Row(
        modifier = modifier
            .fillMaxWidth()
            // 整行可点 (旧版也是这样, 别只让折角能点); 点击标签给读屏用
            //
            // **`indication = null` 是刻意的** (2026-11-08 真机截图量到): Miuix 主题下的默认
            // indication 是一整块不透明的灰底, 铺满这行的 16dp 内边距, 而且点过之后会留在焦点态
            // 上 —— 二十行里有一行突然顶着灰块, 看着像"这段被选中了"。这里只留折角的旋转当反馈
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClickLabel = stringResource(
                    if (collapsed) R.string.settings_section_expand else R.string.settings_section_collapse,
                ),
                onClick = onToggle,
            )
            .semantics(mergeDescendants = true) {}
            .padding(horizontal = SettingsSpace.Inset, vertical = SettingsSpace.RowVertical),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = if (collapsed) {
                    MiuixTheme.textStyles.body1
                } else {
                    MiuixTheme.textStyles.body1.copy(fontSize = 17.sp, lineHeight = 24.sp)
                },
                fontWeight = if (collapsed) FontWeight.Medium else FontWeight.SemiBold,
                color = colorScheme.onBackground,
            )
            if (summary.isNotEmpty()) {
                Text(
                    text = summary,
                    style = MiuixTheme.textStyles.footnote1,
                    color = colorScheme.onBackgroundVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        Icon(
            imageVector = MiuixIcons.ChevronForward,
            contentDescription = null,
            modifier = Modifier
                .padding(start = 10.dp)
                .size(SettingsSpace.Chevron)
                .rotate(angle),
            tint = if (collapsed) colorScheme.onBackgroundVariant else colorScheme.primary,
        )
    }
}
