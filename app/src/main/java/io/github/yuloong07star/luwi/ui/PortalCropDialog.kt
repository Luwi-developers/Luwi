package io.github.yuloong07star.luwi.ui

import android.graphics.Bitmap
import android.util.Log
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.tool.PortalCrop
import kotlin.math.roundToInt
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.textStyles
import kotlin.math.roundToInt

/** 裁剪窗的 logcat tag: 真机上"手势没反应"要靠这一行分清是没进来还是被夹回去了 */
private const val PORTAL_CROP_TAG = "LwCrop"

/** 裁的是哪一格 (两边的框比例不同) */
internal enum class PortalCropKind {
    /** 头像: 圆框 1:1 (头栏那一格是圆的) */
    AVATAR,

    /** 前台背景: 按屏的比例 (页面那边是 `background-size:cover`, 比例不对会再被切一次) */
    WALL,
}

/**
 * 门户那张脸的裁剪窗 (2026-11-15 主人: "头像选择时没有选择裁剪尺寸的弹窗, 背景应当也加上")
 *
 * 与 `scaffolds/InputDialog` 同一套外壳 (Compose `Dialog` + `decorFitsSystemWindows = false` +
 * 居中 + Miuix 卡片): 那些坑 (`OverlayDialog` 贴底 / 被外层弹窗盖住 / 吃掉 ime inset) 一条都不必再踩
 *
 * **只有两条手势**: 单指拖动换构图, 双指放大缩小 (2026-11-15 主人: "要求双指放大缩小, 不加那个固定
 * 像素"). 缩放的下限就是"铺满框"、上限是铺满的四倍 —— 框里不露白, 也不把像素摊成一团糊
 *
 * 算术全在 [PortalCrop] 里, 这里只把结果画出来: 框里看得见的那一块就是落盘的东西, 所见即所得。
 * **落盘尺寸不是一个要人选的档**: 切出来就是源图那块区域, 真正写盘前由 `PortalFace.setWall` /
 * `setAvatar` 按它们各自的上限收一次 (头像是 512, 背景 1600)
 *
 * **切图不在这里做**: 界面线程只算一个源图矩形, 真正的 `Bitmap.createBitmap` 与压缩由调用方丢到 IO 上
 */
@Composable
internal fun PortalCropDialog(
    kind: PortalCropKind,
    source: Bitmap,
    onDismiss: () -> Unit,
    /** @param rect 源图上的裁剪矩形 */
    onDone: (PortalCrop.Rect) -> Unit,
) {
    val haptic = LocalHapticFeedback.current
    val configuration = LocalConfiguration.current
    val screenHeightDp = configuration.screenHeightDp
    // 背景按屏的比例 (页面 cover), 头像 1:1
    val aspect = if (kind == PortalCropKind.AVATAR) {
        1f
    } else {
        val w = configuration.screenWidthDp.toFloat().coerceAtLeast(1f)
        val h = screenHeightDp.toFloat().coerceAtLeast(1f)
        w / h
    }
    val image: ImageBitmap = remember(source) { source.asImageBitmap() }
    var box by remember { mutableStateOf(IntSize.Zero) }
    /**
     * 一张图怎么摆 —— **只能有一个 State 对象**
     *
     * 2026-11-15 真机踩到: 原来写 `remember(box) { mutableStateOf(fit(...)) }`, 框尺寸一就绪它就把
     * State 换成一个新的, 而 `pointerInput(Unit)` 里的 lambda 捕获的还是**旧的**那个 —— 于是手势一直在
     * 改旧 State, 界面读新 State, 表现是"拖了、日志也有, 画面纹丝不动"。改成单一 State + 一个
     * `LaunchedEffect(box)` 去摆初值
     */
    var frame by remember { mutableStateOf(PortalCrop.Frame(1f, 0f, 0f)) }
    LaunchedEffect(box) {
        if (box.width > 0 && box.height > 0) {
            frame = PortalCrop.fit(source.width, source.height, box.width.toFloat(), box.height.toFloat())
        }
    }
    val title = stringResource(
        if (kind == PortalCropKind.AVATAR) R.string.settings_portal_crop_avatar else R.string.settings_portal_crop_wall,
    )

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp)) {
                    Text(text = title, style = textStyles.title3, color = colorScheme.onSurface)
                    Text(
                        text = stringResource(R.string.settings_portal_crop_hint),
                        style = textStyles.body2,
                        color = colorScheme.onSurfaceVariantSummary,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                    // 框: 头像略小一点 (圆), 背景按屏比例但不超过屏高的四成 —— 下面还要放两颗按钮
                    BoxWithConstraints(modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
                        val maxH = (screenHeightDp * 0.44f).dp
                        val boxWidth = minOf(maxWidth, maxH * aspect)
                        Box(
                            modifier = Modifier
                                .size(boxWidth, boxWidth / aspect)
                                .clip(if (kind == PortalCropKind.AVATAR) CircleShape else RoundedCornerShape(14.dp))
                                // 底色只在图还没画出来那一帧看得见 (图按 cover 铺满整框)
                                .background(colorScheme.onSurface.copy(alpha = 0.08f))
                                .onSizeChanged { box = it }
                                // **key 用 Unit, 不在里面早退**: 首帧 box 还是 0, 早退就等于这块画面上
                                // 一个手势都没装上 (2026-11-15 真机: 拖动与缩放都毫无反应)。尺寸在
                                // 回调里现读, `box` 是 State, 读到的永远是最新那一拍
                                //
                                // 一行读数: 真机上"手势没反应"要能分清是没进来还是被 clamp 夹回去了
                                .pointerInput(Unit) {
                                    detectTransformGestures { _, pan, zoom, _ ->
                                        Log.i(
                                            PORTAL_CROP_TAG,
                                            "crop gesture zoom=$zoom pan=$pan box=${box.width}x${box.height}" +
                                                " scale=${frame.scale}",
                                        )
                                        if (box.width > 0 && box.height > 0) {
                                            frame = PortalCrop.clamp(
                                                PortalCrop.Frame(
                                                    scale = frame.scale * zoom,
                                                    dx = frame.dx + pan.x,
                                                    dy = frame.dy + pan.y,
                                                ),
                                                source.width,
                                                source.height,
                                                box.width.toFloat(),
                                                box.height.toFloat(),
                                            )
                                        }
                                    }
                                },
                        ) {
                            Canvas(modifier = Modifier.fillMaxSize()) {
                                if (box.width <= 0 || box.height <= 0) return@Canvas
                                val scaledW = (source.width * frame.scale).roundToInt().coerceAtLeast(1)
                                val scaledH = (source.height * frame.scale).roundToInt().coerceAtLeast(1)
                                drawImage(
                                    image = image,
                                    dstOffset = IntOffset(frame.dx.roundToInt(), frame.dy.roundToInt()),
                                    dstSize = IntSize(scaledW, scaledH),
                                    filterQuality = FilterQuality.Medium,
                                )
                            }
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        TextButton(
                            text = stringResource(R.string.button_cancel),
                            onClick = {
                                haptic.contextClick()
                                onDismiss()
                            },
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(20.dp))
                        TextButton(
                            text = stringResource(R.string.button_confirm),
                            onClick = {
                                haptic.confirm()
                                onDone(
                                    PortalCrop.rectOf(
                                        frame,
                                        source.width,
                                        source.height,
                                        box.width.toFloat(),
                                        box.height.toFloat(),
                                    ),
                                )
                            },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.textButtonColorsPrimary(),
                        )
                    }
                }
            }
        }
    }
}
