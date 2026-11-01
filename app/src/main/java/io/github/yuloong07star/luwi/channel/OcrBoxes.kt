package io.github.yuloong07star.luwi.channel

import kotlin.math.abs
import kotlin.math.ceil

/**
 * OCR 前后处理里那几条纯规则
 *
 * 单独放一处是因为它们都能不碰模型、不碰设备地度量 (见 `OcrBoxesTest`), 而它们正好是"结果里为什么
 * 混进图标"与"长行为什么右边丢字"这两件事的全部原因
 */
object OcrBoxes {

    /** 两条边差得不超过长边的这个比例, 就算一个近正方形的框 */
    const val SQUARE_RATIO = 0.35f

    /**
     * 屏像素里边长小于屏长边这个比例, 才可能是一个图标
     *
     * 以前是绝对像素 (96px), 那等于"只在小屏上成立": 720p 上 96px 已经是很大一块 (判据形同虚设),
     * 2K 上又会误杀真字。改成屏长边的比例之后, 任何分辨率都是同一把尺子
     */
    const val ICON_MAX_RATIO = 0.09f

    /** 分数低于这个数的方形框当图标丢掉; 真正的单字分数在 0.9 上下, 图标实测在 0.5~0.8 */
    const val ICON_SCORE = 0.85f

    /**
     * 两个框的交集占**较小那个框**面积超过这个比例, 就算同一个东西被检出了两遍
     *
     * 检测器的缩放与滑窗会给同一行文字两三个重叠框, 表现是同一行报两遍 (小米13 上"微信(4)"就是
     * 0.986 与 0.75 两个重叠框)。`OcrDetect.merge` 只合并"相邻"的块, 收不了这种包含关系
     */
    const val BOX_OVERLAP = 0.6f

    /** 切段时的重叠, 单位是屏像素: 正好切在字上会丢掉半个字 */
    const val SEGMENT_OVERLAP = 12

    /**
     * 长宽比超过模型上限这么多倍才切
     *
     * 模型能一次认到 6.67:1, 超出的部分是被 `resized()` 横向压进 320 的**挤压**而不是裁掉 ——
     * 挤压 1.2 倍对中文那一行几乎无损, 而切段会在接缝处多认一个标点 (实测 "云服务、会员权益"
     * 拼成了 "云服务。、")。所以只有挤压到 1.5 倍以上 (约 10 个字以上的一行) 才值得切
     */
    const val SPLIT_FACTOR = 1.5f

    /** 一段切片, 与 `android.graphics.Rect` 一样右边与下边是开区间 */
    data class Slice(val left: Int, val right: Int) {
        val width: Int get() = right - left
    }

    /**
     * 这个框是不是一个图标
     *
     * 头像、表情、喇叭、底部导航都是近正方形、尺寸小、分数低的框。抬 `MIN_TEXT_SCORE` 会先误杀
     * 夜间深色模式下的灰字, 所以只加形状这一条 —— 这也是 2026-10-28 那份改动里唯一没争议的一条
     *
     * @param screenLong 这块屏的长边 (像素), 尺寸判据按它的比例算, 分辨率无关
     */
    fun isIconLike(widthPx: Int, heightPx: Int, score: Float, screenLong: Int): Boolean {
        val long = maxOf(widthPx, heightPx)
        if (long <= 0 || screenLong <= 0) return false
        if (long >= screenLong * ICON_MAX_RATIO) return false
        val square = abs(widthPx - heightPx).toFloat() / long < SQUARE_RATIO
        return square && score < ICON_SCORE
    }

    /**
     * 这个框里只有符号, 没有字
     *
     * 设置页右侧的 `>` / `›` 箭头会被单独检出来并认成 ">", 分数往往 0.98 以上, 形状又不方, 所以
     * 前两条都留不住它。一个框里连一个字母 / 数字 / 汉字都没有时它不可能是给人读的正文
     */
    fun isSymbolOnly(text: String): Boolean = text.isNotEmpty() && text.none { it.isLetterOrDigit() }

    /**
     * 两个框的交集占较小那个框面积的比例, 0 到 1
     *
     * 按"较小的那个"算而不是按并集 (IoU): 一个框把另一个整个包住时交集等于小框面积, 比例是 1,
     * 而 IoU 会因为这个框格外大而偏低, 于是那种"大到套住整行"的重复框反而漏过去
     */
    fun overlap(a: OcrBox, b: OcrBox): Float {
        val left = maxOf(a.left, b.left)
        val right = minOf(a.right, b.right)
        val top = maxOf(a.top, b.top)
        val bottom = minOf(a.bottom, b.bottom)
        if (right <= left || bottom <= top) return 0f
        val intersection = (right - left) * (bottom - top)
        val smaller = minOf(a.width * a.height, b.width * b.height)
        return if (smaller <= 0f) 0f else intersection / smaller
    }

    /**
     * 去掉同一行被检出两遍的框, 回"保留的框"与丢掉了几个
     *
     * 按分数从高到低扫一遍, 与已经保留的框重叠超过 [BOX_OVERLAP] 的那个丢掉: 保留的永远是分数
     * 高的那一份, 而返回的顺序仍是检测器给的阅读顺序 (上到下、左到右)
     */
    fun dedupe(boxes: List<OcrBox>): Pair<List<OcrBox>, Int> {
        if (boxes.size < 2) return boxes to 0
        val picked = BooleanArray(boxes.size)
        for (index in boxes.indices.sortedByDescending { boxes[it].score }) {
            val box = boxes[index]
            var duplicate = false
            for (kept in boxes.indices) {
                if (!picked[kept]) continue
                if (overlap(boxes[kept], box) > BOX_OVERLAP) {
                    duplicate = true
                    break
                }
            }
            if (duplicate) continue
            picked[index] = true
        }
        val kept = boxes.filterIndexed { index, _ -> picked[index] }
        return kept to (boxes.size - kept.size)
    }

    /**
     * 一条过宽的行要切成几段来识别
     *
     * 识别模型的输入是 48 高 320 宽, 长宽比超过 6.67 的部分会被 `resized()` 横向压进去 (不是裁掉):
     * 挤压到 1.5 倍以上时字形已经走样, 才值得切成几段分别认再拼 (`SPLIT_FACTOR`)。段与段之间留一点
     * 重叠, 认完用 `joinOverlap` 拼回
     *
     * @param left 行框的左边界 (屏像素, 含)
     * @param right 行框的右边界 (屏像素, 不含)
     * @param heightPx 行框的高, 决定这一段能放多宽
     * @param recWidth 识别模型的输入宽
     * @param recHeight 识别模型的输入高
     * @returns 每段的 `left..right`, 不用切时是空表
     */
    fun segments(
        left: Int,
        right: Int,
        heightPx: Int,
        recWidth: Int = 320,
        recHeight: Int = 48,
    ): List<Slice> {
        val widthPx = right - left
        if (widthPx <= 0 || heightPx <= 0 || recWidth <= 0 || recHeight <= 0) return emptyList()
        val limit = recWidth.toFloat() / recHeight * SPLIT_FACTOR
        val aspect = widthPx.toFloat() / heightPx
        if (aspect <= limit) return emptyList()
        val count = ceil(aspect / limit).toInt().coerceAtLeast(2)
        val step = ceil(widthPx.toDouble() / count).toInt().coerceAtLeast(1)
        val overlap = minOf(SEGMENT_OVERLAP, step / 4)
        val slices = ArrayList<Slice>(count)
        var start = left
        var index = 0
        while (start < right && index < count) {
            val end = if (index == count - 1) right else minOf(right, start + step + overlap)
            if (end <= start) break
            slices.add(Slice(start, end))
            start = end - overlap
            index += 1
        }
        return slices
    }

    /**
     * 把切段认出来的两截拼起来, 重叠部分只留一份
     *
     * 重叠是 12 屏像素, 认出来通常是半个到两个字的重复; 所以只看最多 4 个字符的前后缀, 免得把
     * 真的重复词 (比如"哈哈") 也吃掉
     */
    fun joinOverlap(prefix: String, next: String): String {
        if (prefix.isEmpty()) return next
        if (next.isEmpty()) return prefix
        val limit = minOf(4, prefix.length, next.length)
        for (size in limit downTo 1) {
            if (prefix.regionMatches(prefix.length - size, next, 0, size)) {
                return prefix + next.substring(size)
            }
        }
        return prefix + next
    }
}
