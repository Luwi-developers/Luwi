package io.github.yuloong07star.luwi.overlay

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File

/**
 * 图与文件在球上的那一格 (**尺寸与上限的唯一一份实现**, 2026-11-09)
 *
 * 为什么单独一处: 那两件事以前散在三处 —— `BallStickers.MAX_BYTES` (表情包 2 MB) 被顺手当成"她发来的
 * 图"的上限, 而宿主那一侧放行 20 MB (`host-plugin/index.mjs` 的 `LW_IMAGE_MAX_BYTES`)。于是真机上一张
 * 883 KB 的图能过 (见 `lw/out/assets/session-99a620a7…/7-__.png`), 而任何一张手机截屏 (常 2~4 MB) 都会
 * 被 `loadFile` 判成 null, 屏上只剩一句"图没取到"。两个数必须同一个来源。
 *
 * 另一半是**尺寸**: 以前那张图靠 `ImageView.adjustViewBounds` 现量, 量之前的高度是 0, 而框是
 * `WRAP_CONTENT` 的悬浮窗 —— 于是"图落地了但那一格是空的, 滚一下回复框才长出来"。现在宽高都由
 * [imageBox] 先算出来写进 `LayoutParams`, 有没有解完码都占同一块地。
 *
 * 全是纯函数 (只有一个 `decode` 摸文件), 没有设备也能量 (见 `BallMediaTest`)。
 */
internal object BallMedia {

    /**
     * 一份图最大多少字节: **与宿主同一个数** (20 MB)
     *
     * 宿主那一侧超了就不写这一行 (`lwOutPayload` 直接抛), 所以能到这里的一定 <= 20 MB; 这个数跟着它,
     * 不自己另立一个更小的
     */
    const val MAX_BYTES = 20L * 1024 * 1024

    /**
     * 她发来的图最多占屏高的百分之几 (**2026-11-10 主人: "图太大了, 最大长宽都缩短到原来一半"** ——
     * 原来 36, 现在 18 ); 表情包另有一档, 见 `BallStickers`
     */
    const val MAX_HEIGHT_PERCENT = 18

    /**
     * 那一格的宽最多占内容宽的百分之几 (**同一个一半**: 原来是"铺满", 现在收到一半)
     *
     * 两个上限一起用: 图按比例缩进 `(宽上限, 高上限)` 那个框里, 先顶到哪一边就停在哪一边 —— 于是
     * 方图正好是原来的一半宽、一半高, 竖屏截屏按高缩、横图按宽缩, 都不会把框撑回原来的尺寸
     */
    const val MAX_WIDTH_PERCENT = 50

    /** 一条消息最多挂几个附件 (与门户那侧同一个数, 见 `client.js` 的 `MAX_ATTACH`) */
    const val MAX_ATTACH = 6

    /** 读文本类文件时最多读多少字节 (预览窗里够看开头那一段就够) */
    const val MAX_TEXT_BYTES = 64 * 1024

    /** `w/h` 读不到时按 4:3 先占位: 高度等于宽乘这个分数的倒数 */
    private const val FALLBACK_W = 4
    private const val FALLBACK_H = 3

    /** 预览窗里那一份东西的种类 (决定预览窗画什么) */
    enum class Kind { IMAGE, TEXT, PDF, OFFICE, OTHER }

    /** 图片那几种 */
    private val IMAGE_EXTS = setOf("png", "jpg", "jpeg", "webp", "gif")

    /** 能当文本读的那几种 */
    private val TEXT_EXTS = setOf("txt", "md", "json", "csv", "log")

    /** 办公那几种 (球上不自己解, 交给系统应用) */
    private val OFFICE_EXTS = setOf(
        "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
    )

    /**
     * 图该占多大: 按比例缩进 `(宽上限, 高上限)` 那个框里, 先顶到哪一边就停在哪一边
     *
     * **2026-11-10 主人: "ball 和门户的图太大了, 最大长宽都缩短到原来一半"** —— 原来这里是"宽铺满
     * 那一格 + 高封顶", 现在宽也收到一半 ([MAX_WIDTH_PERCENT]), 高也收到一半 ([MAX_HEIGHT_PERCENT]):
     *
     * - 方图 (1024×1024): 宽顶到上限时高还没到 → 正好是原来的一半宽、一半高
     * - 竖屏截屏 (1080×2460): 宽顶到上限时高已经超了 → 按高缩, 宽跟着变窄 (仍然是"图里看得见什么")
     * - 横图 (2000×500): 按宽缩, 高本来就不高
     *
     * [contain] 而不是"裁": 缩到框里就不必裁, 点开预览窗还能看更大的那一份
     *
     * @param w 原图宽 (<=0 时按 [FALLBACK_W] 算)
     * @param h 原图高 (<=0 时按 [FALLBACK_H] 算)
     * @param maxWidth 那一格宽最多多少 (调用方按 [MAX_WIDTH_PERCENT] 算好)
     * @param maxHeight 那一格高最多多少 (调用方按 [MAX_HEIGHT_PERCENT] 算好)
     * @return `(宽, 高)`, 两个都至少 1
     */
    fun imageBox(w: Int, h: Int, maxWidth: Int, maxHeight: Int): Pair<Int, Int> {
        val capW = maxWidth.coerceAtLeast(1)
        val capH = maxHeight.coerceAtLeast(1)
        val sourceW = if (w > 0) w else FALLBACK_W
        val sourceH = if (h > 0) h else FALLBACK_H
        // 宽顶到上限时的高: 没超高就按宽, 超了才按高缩 (两个整数都不能是 0)
        val tallAtFullWidth = (capW.toLong() * sourceH / sourceW).coerceAtLeast(1L)
        if (tallAtFullWidth <= capH) return capW to tallAtFullWidth.toInt()
        val wideAtFullHeight = (capH.toLong() * sourceW / sourceH).coerceAtLeast(1L)
        return wideAtFullHeight.toInt() to capH
    }

    /**
     * 一张图该多大才画得动: 超过 [maxWidth] / [maxHeight] 就按 2 的幂降采样
     *
     * 与 `BallStickers` 那一套同一个算式, 只是这里多一个宽度上限 (预览窗是横的, 只按高降采样会把
     * 一张全景图解得很大)
     */
    fun sampleFor(w: Int, h: Int, maxWidth: Int, maxHeight: Int): Int {
        if (w <= 0 || h <= 0) return 1
        var sample = 1
        val wantedW = maxWidth.coerceAtLeast(1)
        val wantedH = maxHeight.coerceAtLeast(1)
        while (w / (sample * 2) >= wantedW || h / (sample * 2) >= wantedH) sample *= 2
        return sample
    }

    /**
     * 读一张图; 读不动 / 太大一律 null (调用方必须如实说出来, 不假装贴过)
     *
     * @param maxWidth 解出来的宽上限 (px)
     * @param maxHeight 解出来的高上限 (px)
     */
    fun decode(file: File, maxWidth: Int, maxHeight: Int): Bitmap? {
        if (!file.isFile || file.length() <= 0L || file.length() > MAX_BYTES) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        runCatching { BitmapFactory.decodeFile(file.absolutePath, bounds) }.getOrNull()
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleFor(bounds.outWidth, bounds.outHeight, maxWidth, maxHeight)
        }
        return runCatching { BitmapFactory.decodeFile(file.absolutePath, options) }.getOrNull()
    }

    /** 这个文件名认哪一档 (只认扩展名, 大小写不敏感) */
    fun kindOf(name: String): Kind {
        val ext = extensionOf(name)
        return when {
            ext in IMAGE_EXTS -> Kind.IMAGE
            ext in TEXT_EXTS -> Kind.TEXT
            ext == "pdf" -> Kind.PDF
            ext in OFFICE_EXTS -> Kind.OFFICE
            else -> Kind.OTHER
        }
    }

    /** 扩展名 (小写, 没有就空串) */
    fun extensionOf(name: String): String {
        val base = File(name.trim()).name
        val dot = base.lastIndexOf('.')
        return if (dot > 0) base.substring(dot + 1).lowercase() else ""
    }

    /**
     * 字节数那一句 (`1.2 MB` / `838 KB`): 只进 chip 的 `title` 与预览窗的副标题, **不占屏上一格**
     *
     * 主人那一句是"只显示文件名" —— 所以大小不当正文, 只当读得到的那一层
     */
    fun sizeText(bytes: Long): String {
        if (bytes <= 0L) return ""
        if (bytes < 1024L) return "$bytes B"
        val kb = bytes / 1024.0
        if (kb < 1024.0) return "${round1(kb)} KB"
        return "${round1(kb / 1024.0)} MB"
    }

    /** 一位小数, 去掉尾巴那个 `.0` (纯字符串, 不走 Locale —— 那个在无设备的地方会抛) */
    private fun round1(value: Double): String {
        val scaled = Math.round(value * 10.0)
        val whole = scaled / 10
        val frac = (scaled % 10).toInt().let { if (it < 0) -it else it }
        return if (frac == 0) whole.toString() else "$whole.$frac"
    }

    /**
     * 已经解好、还没上屏的那一份 (框关着时先攒着, 见 `OverlayState.pendingMedia`)
     *
     * 与 `pendingSticker` 分开: 那一张从 `lw/stickers` 按名字读, 这一张已经解成位图了, 而且带着原尺寸
     * (上屏时要按它算那一格的高度)
     */
    data class Pending(
        val bitmap: Bitmap,
        val w: Int,
        val h: Int,
        val caption: String,
        /** 行里那一段 (`assets/…`), 点开预览窗时按它找文件 */
        val rel: String,
        /** 显示用的名字 */
        val name: String,
    )

    /** 一份文件那一行 (她递来的那份, 或点开自己发的那份) */
    data class FileItem(val name: String, val rel: String, val bytes: Long)
}
