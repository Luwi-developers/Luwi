package io.github.yuloong07star.luwi.scaffolds.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 三选一的分段控件: 外观那段用它选深浅
 *
 * 换成自己画是因为 Miuix 的 `TabRow` 会给**选中那一格铺一块淡底**, 而这一页别的选中态
 * (折角变主色 / 开关变蓝) 都不铺底 —— 于是页面上"有的有蓝底, 有的没有", 一眼就不齐
 * (2026-11-08 主人: "取消这个蓝底")
 *
 * 现在选中只靠两样: 文字换主色 + 底下那根 18dp 的短线。与"编辑式索引"同一个语言 —— 用线与
 * 颜色说层级, 不用填充块
 *
 * 点击反馈只留按下时的轻微底色 (`indication` 走默认 ripple 的话是一整块灰, 与段标题那个
 * 坑一样), 所以 `indication = null`, 反馈交给短线出现的那一下
 */
@Composable
fun SettingsTabs(
    options: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = SettingsSpace.Inset, vertical = SettingsSpace.RowVertical),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        options.forEachIndexed { index, label ->
            val on = index == selected
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { onSelect(index) }
                    .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = label,
                    style = MiuixTheme.textStyles.body1,
                    fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (on) colorScheme.primary else colorScheme.onBackgroundVariant,
                )
                Spacer(modifier = Modifier.height(6.dp))
                Box(
                    modifier = Modifier
                        .width(18.dp)
                        .height(2.dp)
                        .background(if (on) colorScheme.primary else Color.Transparent),
                )
            }
        }
    }
}
