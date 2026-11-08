package io.github.yuloong07star.luwi.scaffolds.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 一条细线, 设置页里唯一的"分割"手段
 *
 * 不用阴影也不用色块: 二十段堆在一页上的时候, 一条 1dp 的线足够说清"这是两行", 而阴影会把
 * 每一段都抬成一张卡 —— 那就是"AI 卡片流"的样子
 *
 * 左侧留 [startInset]: 线与文字的左边缘错开, 读起来是"分隔"而不是"边框"
 */
@Composable
fun SettingsHairline(
    modifier: Modifier = Modifier,
    startInset: Dp = SettingsSpace.Inset,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = startInset)
            .height(SettingsSpace.Hairline)
            .background(colorScheme.dividerLine),
    )
}
