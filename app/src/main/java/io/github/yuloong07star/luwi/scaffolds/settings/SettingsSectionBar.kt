package io.github.yuloong07star.luwi.scaffolds.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 设置页顶部的段名索引条 (2026-11-14 主人: "顶部加上可选的版块名, 点击后跳转到对应板块,
 * 顶部的板块名可以左右滑到, 查看板块")
 *
 * 二十段收起来的时候这一页是一份目录, 而目录本身没有"跨段跳"的能力 —— 想改「接口」得先滚到底。
 * 这条横条把二十个段名摆在同一行上, 手指左右滑就能看全, 点一下跳到那一段
 *
 * **它自己不记任何状态**: 高亮哪一颗由调用方按"列表现在最上面是哪一段"算出来传进来, 跳转也是
 * 调用方的事 —— 这一层只管画, 于是"高亮"与"真的在看哪一段"永远是同一件事
 *
 * **不铺底** (与 `SettingsTabs` / 段标题同一条语言): 选中只靠文字变主色 + 底下那根 18dp 的短线;
 * `indication = null` 是因为 Miuix 主题下默认的 ripple 是一整块灰, 一行字顶着灰块会像"被选中"
 */
@Composable
fun SettingsSectionBar(
    entries: List<SettingsSectionEntry>,
    activeKey: String?,
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state = rememberLazyListState()
    // 高亮那颗要自己滚进可视区 (纵向滚到「接口」之后, 上面那一排也该跟着走)
    // **只认"换了一段"这一件事**: 用户横滑不改变高亮, 于是这里不会跟手指抢
    val activeIndex = entries.indexOfFirst { it.key == activeKey }
    LaunchedEffect(activeIndex) {
        if (activeIndex >= 0) state.animateScrollToItem(activeIndex)
    }

    // 整条要给一层不透明的底: LazyColumn 的 contentPadding 只是"起始偏移", 滚上去的内容仍会画进那一段
    // (2026-11-14 真机量到: 点「接口」滚到底之后, 被滚过去的「检查所需依赖」从条底下透出来) ——
    // 顶栏之所以没这问题是因为它自己有底, 这一条同理
    Column(modifier = modifier.fillMaxWidth().background(colorScheme.background)) {
        LazyRow(
            state = state,
            contentPadding = PaddingValues(horizontal = SettingsSpace.Inset),
            horizontalArrangement = Arrangement.spacedBy(SettingsSpace.ChipGap),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            items(entries.size) { index ->
                val entry = entries[index]
                val on = entry.key == activeKey
                Column(
                    modifier = Modifier
                        .heightIn(min = SettingsSpace.BarHeight)
                        .clip(RoundedCornerShape(10.dp))
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { onPick(entry.key) }
                        .padding(horizontal = SettingsSpace.ChipPadding),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        text = entry.label,
                        style = MiuixTheme.textStyles.body1,
                        fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (on) colorScheme.primary else colorScheme.onBackgroundVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    // 未选时留一条同尺寸的透明线: 切换时行高不动, 整排不会上下跳
                    Box(
                        modifier = Modifier
                            .width(SettingsSpace.IndicatorWidth)
                            .height(SettingsSpace.IndicatorHeight)
                            .background(if (on) colorScheme.primary else Color.Transparent),
                    )
                }
            }
        }
        // 与下面的「检查所需依赖」分开: 这一条是本页唯一的分割手段
        SettingsHairline()
    }
}

/** 索引条上的一件: 段名 (与 `SettingsSectionKeys` 同一个键) 与它的显示名 */
data class SettingsSectionEntry(
    val key: String,
    val label: String,
)
