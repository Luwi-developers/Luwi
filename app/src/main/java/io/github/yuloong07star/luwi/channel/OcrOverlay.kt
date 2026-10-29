package io.github.yuloong07star.luwi.channel

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.util.Log
import java.io.File
import java.util.Locale

/**
 * 一次读屏的调试图: 保留了哪些框, 丢掉了哪些, 各自多少分
 *
 * 只在调用方明确要 (`lw_ocr debug=true`) 时才写, 不是每次读屏都写: 一次覆盖一张全屏 PNG 在
 * 350ms 一次的读屏轮询里会把整条链路拖慢, 而需要它的人是在调过滤规则, 那时一次就够
 *
 * 两个文件总是一起写: `overlay.png` 给人看 (绿框 = 保留, 红框 + × = 丢弃, 每框标分数),
 * `overlay.txt` 给脚本与模型对 (逐行"框坐标 + 文字 + 三位小数分数")
 */
object OcrOverlay {

    const val IMAGE = "overlay.png"

    const val TEXT = "overlay.txt"

    /**
     * 画一张调试图并写一份逐行清单
     *
     * @param dir 落在哪个目录 (由 [VirtualScreen.ocrDebugDir] 给), 不存在会建
     * @param frame 这一次读的那一帧, 不会被改动
     * @param kept 留下的行
     * @param dropped 因为像图标被丢掉的行
     * @returns 两个文件, 写不出来时 null (读屏本身照常出结果)
     */
    fun write(dir: File, frame: Bitmap, kept: List<LwOcr.Line>, dropped: List<LwOcr.Line>): Pair<File, File>? {
        return try {
            dir.mkdirs()
            val overlay = frame.copy(Bitmap.Config.ARGB_8888, true) ?: return null
            try {
                val canvas = Canvas(overlay)
                val stroke = Paint().apply {
                    style = Paint.Style.STROKE
                    strokeWidth = maxOf(2f, frame.width / 540f)
                    isAntiAlias = true
                }
                val label = Paint().apply {
                    textSize = maxOf(18f, frame.height / 80f)
                    isAntiAlias = true
                }
                for (line in kept) {
                    stroke.color = KEPT
                    canvas.drawRect(rectOf(line), stroke)
                    label.color = KEPT
                    canvas.drawText(score(line), line.left.toFloat(), labelTop(line), label)
                }
                for (line in dropped) {
                    stroke.color = DROPPED
                    val box = rectOf(line)
                    canvas.drawRect(box, stroke)
                    // 一个 × 让它和"保留"一眼分得开, 颜色在缩过的图上不一定看得清
                    canvas.drawLine(box.left.toFloat(), box.top.toFloat(), box.right.toFloat(), box.bottom.toFloat(), stroke)
                    canvas.drawLine(box.right.toFloat(), box.top.toFloat(), box.left.toFloat(), box.bottom.toFloat(), stroke)
                    label.color = DROPPED
                    canvas.drawText(score(line), line.left.toFloat(), labelTop(line), label)
                }
                val image = File(dir, IMAGE)
                image.outputStream().use { overlay.compress(Bitmap.CompressFormat.PNG, 100, it) }
                val text = File(dir, TEXT)
                text.writeText(
                    buildString {
                        appendLine("KEPT ${kept.size}")
                        kept.forEach { appendLine(line("KEPT", it)) }
                        appendLine("DROPPED ${dropped.size}")
                        dropped.forEach { appendLine(line("DROPPED", it)) }
                    },
                )
                image to text
            } finally {
                overlay.recycle()
            }
        } catch (problem: Throwable) {
            Log.w(TAG, "the OCR overlay could not be written", problem)
            null
        }
    }

    private fun rectOf(line: LwOcr.Line): Rect = Rect(line.left, line.top, line.right, line.bottom)

    /** 分数写在框的左上角上面一点, 贴着屏幕上边时落到框里面 */
    private fun labelTop(line: LwOcr.Line): Float = maxOf(16f, line.top.toFloat() - 4f)

    private fun score(line: LwOcr.Line): String = String.format(Locale.US, "%.3f", line.score)

    private fun line(mark: String, line: LwOcr.Line): String = String.format(
        Locale.US,
        "%s [%d,%d,%d,%d] %s %.3f",
        mark,
        line.left,
        line.top,
        line.right,
        line.bottom,
        line.text,
        line.score,
    )

    private const val TAG = "LwOcr"

    private val KEPT = Color.rgb(0x00, 0xC8, 0x53)

    private val DROPPED = Color.rgb(0xFF, 0x17, 0x44)
}
