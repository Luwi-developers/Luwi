package io.github.yuloong07star.luwi.forge

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import java.io.File

/**
 * 图标落地 (2.8.1): 一张图 → 五档 mipmap + 一份自适应图标
 *
 * 与门户那两张脸同一套解码上限 (`inSampleSize` 预缩), 但这里只做方裁: 图标是方的, 拖拽裁剪那一套在这里
 * 没有意义 —— 主人给的图多半已经是方图, 不方的居中裁一刀就够了
 *
 * 写四样:
 * - `mipmap-<dpi>/ic_launcher.png` 五档 (legacy, 48~192 px)
 * - `mipmap-<dpi>/ic_launcher_foreground.png` 五档 (自适应用的前景, 画布留 33% 边)
 * - `mipmap-anydpi-v26/ic_launcher.xml` + `values/colors.xml` 的 `ic_launcher_background`
 * - Manifest 的 `android:icon` / `android:roundIcon`
 */
internal object ForgeIcon {

    /** 最多先缩到这个边长再裁 (与 `PortalFace.decodeBounded` 同一个尺度) */
    private const val MAX_DECODE = 1024

    /** 五档: 目录名 to 边长 */
    private val DENSITIES = listOf(
        "mdpi" to 48,
        "hdpi" to 72,
        "xhdpi" to 96,
        "xxhdpi" to 144,
        "xxxhdpi" to 192,
    )

    /** 把一张图落成项目图标; 回一句结果 (失败时那句话就是原因) */
    fun apply(project: File, source: File): String {
        if (!source.isFile) return "图标文件不存在: ${source.absolutePath}"
        if (source.length() > 20L * 1024 * 1024) return "图标太大 (${source.length() / 1024} KB), 上限 20 MB"
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return "这不是一张能解码的图: ${source.name}"
        val sample = sampleSize(bounds.outWidth, bounds.outHeight)
        val decoded = runCatching {
            BitmapFactory.decodeFile(source.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
        }.getOrNull() ?: return "解码失败: ${source.name}"
        val square = centerCrop(decoded)
        if (square !== decoded) decoded.recycle()

        val background = averageColor(square)
        var written = 0
        DENSITIES.forEach { (density, size) ->
            val legacy = File(project, "res/mipmap-$density/ic_launcher.png")
            val foreground = File(project, "res/mipmap-$density/ic_launcher_foreground.png")
            // `writePng` 成功时回 null, 失败时回一句原因 —— 这里要的是"非 null 就走人"
            writePng(legacy, render(square, size, inset = 0f))?.let { return "写不进 ${legacy.path}: $it" }
            writePng(foreground, render(square, size, inset = size * 0.17f))?.let {
                return "写不进 ${foreground.path}: $it"
            }
            written += 2
        }
        writeAdaptive(project)
        writeBackgroundColor(project, background)
        val manifest = syncManifest(project)
        if (manifest.isNotEmpty()) return manifest
        square.recycle()
        return "图标已落地: $written 张 png + 自适应图标 (底色 #${"%06x".format(background and 0xFFFFFF)})"
    }

    /** 一张方图, 按目标边长画出来; `inset` 是四周留白 */
    private fun render(source: Bitmap, size: Int, inset: Float): Bitmap {
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        canvas.drawColor(Color.TRANSPARENT)
        val inner = (size - inset * 2).toInt().coerceAtLeast(1)
        val target = Rect(inset.toInt(), inset.toInt(), inset.toInt() + inner, inset.toInt() + inner)
        canvas.drawBitmap(source, null, target, Paint(Paint.ANTI_ALIAS_FLAG).apply { isFilterBitmap = true })
        return out
    }

    /** 居中裁一个正方形 */
    private fun centerCrop(source: Bitmap): Bitmap {
        val side = minOf(source.width, source.height)
        val x = (source.width - side) / 2
        val y = (source.height - side) / 2
        return Bitmap.createBitmap(source, x, y, side, side)
    }

    /** 平均色当自适应图标的底色 (全透明就到那个深灰) */
    private fun averageColor(source: Bitmap): Int {
        var r = 0L
        var g = 0L
        var b = 0L
        var n = 0L
        val step = maxOf(1, source.width / 32)
        var y = 0
        while (y < source.height) {
            var x = 0
            while (x < source.width) {
                val pixel = source.getPixel(x, y)
                if (Color.alpha(pixel) > 32) {
                    r += Color.red(pixel)
                    g += Color.green(pixel)
                    b += Color.blue(pixel)
                    n += 1
                }
                x += step
            }
            y += step
        }
        if (n == 0L) return Color.parseColor("#0F1115")
        return Color.rgb((r / n).toInt(), (g / n).toInt(), (b / n).toInt())
    }

    private fun writePng(target: File, bitmap: Bitmap): String? = runCatching {
        target.parentFile?.mkdirs()
        val ok = target.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        if (ok) null else "编码失败 (compress 回了 false)"
    }.getOrElse { it.message ?: it.javaClass.simpleName }

    /** 自适应图标的描述文件 */
    private fun writeAdaptive(project: File) {
        val file = File(project, "res/mipmap-anydpi-v26/ic_launcher.xml")
        file.parentFile?.mkdirs()
        file.writeText(
            """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
""",
        )
    }

    /** 底色写进 `values/colors.xml` (没有就建一份, 有就往 `<resources>` 里补一行) */
    private fun writeBackgroundColor(project: File, color: Int) {
        val file = File(project, "res/values/colors.xml")
        val line = """    <color name="ic_launcher_background">#${"%06x".format(color and 0xFFFFFF)}</color>"""
        if (!file.isFile) {
            file.parentFile?.mkdirs()
            file.writeText("""<?xml version="1.0" encoding="utf-8"?>
<resources>
$line
</resources>
""")
            return
        }
        val text = runCatching { file.readText() }.getOrNull() ?: return
        if (text.contains("ic_launcher_background")) return
        file.writeText(text.replace("</resources>", "$line\n</resources>"))
    }

    /** Manifest 里补上 `android:icon` 与 `android:roundIcon` */
    private fun syncManifest(project: File): String {
        val file = File(project, "AndroidManifest.xml")
        if (!file.isFile) return "项目里没有 AndroidManifest.xml"
        val text = runCatching { file.readText() }.getOrElse {
            return "Manifest 读不动: ${it.message ?: it.javaClass.simpleName}"
        }
        var next = text
        if (!next.contains("android:icon=")) {
            next = next.replace("<application", """<application
        android:icon="@mipmap/ic_launcher"""")
        }
        if (!next.contains("android:roundIcon=")) {
            next = next.replace("<application", """<application
        android:roundIcon="@mipmap/ic_launcher"""")
        }
        return runCatching { file.writeText(next); "" }
            .getOrElse { "Manifest 写不进去: ${it.message ?: it.javaClass.simpleName}" }
    }

    /** 预缩倍数: 目标边长 1024 以内 */
    private fun sampleSize(width: Int, height: Int): Int {
        var sample = 1
        while (width / sample > MAX_DECODE || height / sample > MAX_DECODE) sample *= 2
        return sample
    }
}
