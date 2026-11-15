package io.github.yuloong07star.luwi.tool

import kotlin.math.roundToInt

/**
 * 门户那张脸的裁剪几何 (2026-11-15 主人: "头像选择时没有选择裁剪尺寸的弹窗, 背景应当也加上")
 *
 * 头像与背景共用同一套数: 一张源图按 [Frame] 缩放平移之后铺在屏上那一块框里, 框里看得见的那一块
 * 就是落盘的东西。这一份**只有算术**, 不碰 Bitmap 也不碰 Context —— 于是没有设备也能量
 * (判据 `PortalCropTest`), 而界面上那一层 (手势 / 蒙层 / 尺寸档) 只负责喂数与画图
 *
 * 三条纪律:
 *
 * - **框里不许露白**: [clamp] 之后缩放图必须盖满框 (`dx` 落在 `[boxW - w*scale, 0]`)
 * - **不放大到糊**: 最多到"铺满"的 [MAX_ZOOM] 倍, 再大只是把像素摊开
 * - **退化输入不崩**: 源图宽高为 0 / 框为 0 / 图比框还小, 一律回一个"只有一个像素"的合法矩形
 */
internal object PortalCrop {

    /** 最多放大到铺满那几倍 (头像那张 512 的图, 2 倍已经够挑构图) */
    const val MAX_ZOOM = 4f

    /**
     * 一张图怎么摆在框里
     *
     * @property scale 源图乘几 (以源图的像素为 1)
     * @property dx 缩放图左上角在框里的 x (框的像素)
     * @property dy 同上, y
     */
    data class Frame(val scale: Float, val dx: Float, val dy: Float)

    /** 源图上的那一块 (整数像素, 已夹在源图内) */
    data class Rect(val left: Int, val top: Int, val right: Int, val bottom: Int) {
        val width: Int get() = right - left
        val height: Int get() = bottom - top
    }

    /** 铺满框所需的最小倍率 (等比, 取两边较大的那一个) */
    fun baseScale(sourceW: Int, sourceH: Int, boxW: Float, boxH: Float): Float {
        if (sourceW <= 0 || sourceH <= 0 || boxW <= 0f || boxH <= 0f) return 1f
        val byWidth = boxW / sourceW.toFloat()
        val byHeight = boxH / sourceH.toFloat()
        return maxOf(byWidth, byHeight)
    }

    /** 起始那一档: 铺满 + 居中 */
    fun fit(sourceW: Int, sourceH: Int, boxW: Float, boxH: Float): Frame {
        val scale = baseScale(sourceW, sourceH, boxW, boxH)
        return clamp(
            Frame(
                scale = scale,
                dx = (boxW - sourceW * scale) / 2f,
                dy = (boxH - sourceH * scale) / 2f,
            ),
            sourceW, sourceH, boxW, boxH,
        )
    }

    /**
     * 把手势之后的那一档夹回合法范围
     *
     * 缩放夹在 `[铺满, 铺满 * MAX_ZOOM]`; 平移只许在"缩放图仍然盖满框"的那一段里 (框里露白就是把
     * 底色亮出来, 那一眼就知道界坏了)
     */
    fun clamp(frame: Frame, sourceW: Int, sourceH: Int, boxW: Float, boxH: Float): Frame {
        if (sourceW <= 0 || sourceH <= 0 || boxW <= 0f || boxH <= 0f) {
            return Frame(scale = 1f, dx = 0f, dy = 0f)
        }
        val base = baseScale(sourceW, sourceH, boxW, boxH)
        val low = base
        val high = base * MAX_ZOOM
        val scale = if (frame.scale.isNaN()) base else frame.scale.coerceIn(low, high)
        val width = sourceW * scale
        val height = sourceH * scale
        val dx = if (width <= boxW) (boxW - width) / 2f else frame.dx.coerceIn(boxW - width, 0f)
        val dy = if (height <= boxH) (boxH - height) / 2f else frame.dy.coerceIn(boxH - height, 0f)
        return Frame(scale = scale, dx = if (dx.isNaN()) 0f else dx, dy = if (dy.isNaN()) 0f else dy)
    }

    /** 框里那一块对应源图的哪一段 (落盘时按它 `Bitmap.createBitmap`) */
    fun rectOf(frame: Frame, sourceW: Int, sourceH: Int, boxW: Float, boxH: Float): Rect {
        if (sourceW <= 0 || sourceH <= 0) return Rect(0, 0, 1, 1)
        val safe = clamp(frame, sourceW, sourceH, boxW, boxH)
        // **四舍五入, 不截断**: 1:1 的框按截断会切出 255x256 这种差一像素的方图, 而"512 档"听起来
        // 就该是 512x512 (2026-11-15 真机读数发现的)
        val left = (-safe.dx / safe.scale).roundToInt()
        val top = (-safe.dy / safe.scale).roundToInt()
        val right = ((boxW - safe.dx) / safe.scale).roundToInt()
        val bottom = ((boxH - safe.dy) / safe.scale).roundToInt()
        val l = left.coerceIn(0, sourceW - 1)
        val t = top.coerceIn(0, sourceH - 1)
        val r = right.coerceIn(l + 1, sourceW)
        val b = bottom.coerceIn(t + 1, sourceH)
        return Rect(l, t, r, b)
    }

    /**
     * 按屏上那一段的宽高比, 框该多大 (框的宽已定, 高按比例反推)
     *
     * 头像那一档是 1:1; 背景那一档是屏的宽高比 —— 两边都用这一句, 只是 [aspect] 不同
     */
    fun boxHeight(boxW: Float, aspect: Float): Float {
        if (boxW <= 0f || aspect <= 0f) return boxW
        return boxW / aspect
    }
}
