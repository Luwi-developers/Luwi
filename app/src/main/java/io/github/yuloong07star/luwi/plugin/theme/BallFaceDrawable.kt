package io.github.yuloong07star.luwi.plugin.theme

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.Drawable

/**
 * `fit: contain` 那一档怎么把素材摆进球里: **按高贴满方窗, 宽度按比例居中**
 *
 * 素材是按**同一高度**出的 (`ball-art` 成品管线里那个 `OUT_H`, 七档都是 224), 宽度却由每支动作自己的
 * 包围盒决定 (成品里从 175 到 255 不等) —— 于是它本来就该按高度对齐: 换状态时人只有姿势在变, 不会被
 * 缩成另一个大小
 *
 * 从前这里走的是 `BitmapDrawable` + `Gravity.FILL`, 而 `FILL` 是**两个方向各缩一次**把图拉满方窗,
 * 于是越窄的动作被拉得越宽: 187 宽的「东张西望」横向多出 20%, 人物看着就是被压扁了 (主人 2026-10-25:
 * "鲸鱼娘的东张西望动作左右比例被挤压了")
 *
 * 为什么不用 `Gravity` 顶替: 它没有"按比例装进方窗"这一档 (`CENTER` 不缩放, `FILL` 一定拉形, 而
 * `CENTER_INSIDE` 那种是位图按原尺寸不放大), 而 `ImageView` 的 `FIT_CENTER` 要换掉球体那一层 ——
 * 那一层得留着当容器 (拖动缩放、圆裁剪都落在它身上), 所以自己画出这个 `Drawable`
 *
 * 纯算术那一半在 [BallFit] 里, 没有设备也能量 (见 BallFitTest)
 */
internal class BallFaceDrawable(private val bitmap: Bitmap) : Drawable() {

    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val dst = RectF()

    override fun draw(canvas: Canvas) {
        val bounds = bounds
        if (bounds.width() <= 0 || bounds.height() <= 0) return
        if (bitmap.isRecycled || bitmap.width <= 0 || bitmap.height <= 0) return
        val box = BallFit.contain(bitmap.width, bitmap.height, bounds.width(), bounds.height())
        dst.set(bounds.left + box.left, bounds.top + box.top, bounds.left + box.left + box.width, bounds.top + box.height)
        // 比方窗还宽的那几支 (伸出去的头发、手里的道具) 裁在窗里: 不裁的话会画到球窗外面去
        canvas.save()
        canvas.clipRect(bounds)
        canvas.drawBitmap(bitmap, null, dst, paint)
        canvas.restore()
    }

    override fun setAlpha(alpha: Int) {
        paint.alpha = alpha
        invalidateSelf()
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        paint.colorFilter = colorFilter
        invalidateSelf()
    }

    @Suppress("OVERRIDE_DEPRECATION")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}

/**
 * 「按高贴满、宽度按比例居中」那条算式
 *
 * 抽出来只为钉住它: 素材的**宽高比必须原样落到窗里** (187x224 的素材在方窗里画出来仍是 187:224),
 * 而这正是 `Gravity.FILL` 做不到的那一条 —— 2026-10-25 修的就是它
 */
internal object BallFit {

    /**
     * 那张图落在窗里的位置 (相对窗体左上角)
     *
     * @property height 永远等于窗高 ([contain] 的"按高"), 所以换状态时人物高度是一致的
     * @property width 按素材自己的比例, 比方窗宽时**左侧为负**、两边对称超出 (由调用方裁掉)
     */
    data class Box(val left: Float, val top: Float, val width: Float, val height: Float)

    fun contain(bitmapWidth: Int, bitmapHeight: Int, boxWidth: Int, boxHeight: Int): Box {
        if (bitmapWidth <= 0 || bitmapHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
            return Box(0f, 0f, 0f, 0f)
        }
        val scale = boxHeight.toFloat() / bitmapHeight
        val width = bitmapWidth * scale
        return Box((boxWidth - width) / 2f, 0f, width, boxHeight.toFloat())
    }
}
