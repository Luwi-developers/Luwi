package io.github.yuloong07star.luwi.voice

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.File
import java.io.FileOutputStream

/**
 * 收件箱里那些图 (2026-11-07)
 *
 * 落点是 `$DSH_HOME/voice/inbox-media/<名字>` —— 与 `inbox.jsonl` 同一层, 宿主那一侧按同一个表达式
 * 算路径 (它拿的是 `DSH_HOME` 环境变量), 于是"应用写名字, 宿主搬文件"两边对得上
 *
 * **为什么要先缩放**: 相册里一张图 5~12 MB, 而这张图的意义只是"她看一眼"。长边压到 [MAX_EDGE] 之后
 * 落盘体积小一个量级, 宿主往工作区复制的那一份也跟着小 —— 一次投递不该因为一张截图背上十兆
 *
 * 读不动 / 太大一律回 null, 由调用方如实说一句 (不假装发出去了)
 */
internal object InboxMedia {

    /** 与宿主那一侧 `join(home, 'voice', 'inbox-media')` 是同一个约定, 谁都不许单边改 */
    const val DIRECTORY = "inbox-media"

    /** 长边上限: 够她看清是什么, 又不至于把收到的一行撑成几兆 */
    const val MAX_EDGE = 1600

    /** 原始文件上限: 超过这一份就不接了 (解码本身也要内存) */
    const val MAX_BYTES = 8L * 1024 * 1024

    /** 目录在哪 (与 [VoiceInbox.file] 同一个父目录) */
    fun directory(context: Context): File = File(VoiceInbox.file(context).parentFile, DIRECTORY)

    /**
     * 把选中的那张图落盘, 回它的**文件名** (相对 [DIRECTORY])
     *
     * 文件名带毫秒 + 一个自增序号: 同一毫秒选两张也不会互相覆盖
     */
    fun stage(context: Context, uri: Uri): String? {
        val bytes = runCatching {
            context.contentResolver.openInputStream(uri)?.use { stream -> stream.readBytes() }
        }.getOrNull() ?: return null
        if (bytes.size > MAX_BYTES) return null
        val decoded = runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()
            ?: return null
        val scaled = scaleDown(decoded)
        val name = "${System.currentTimeMillis()}-${serial.incrementAndGet()}.jpg"
        val target = File(directory(context), name)
        val written = runCatching {
            target.parentFile?.mkdirs()
            FileOutputStream(target).use { out -> scaled.compress(Bitmap.CompressFormat.JPEG, 88, out) }
        }.isSuccess
        if (scaled !== decoded) runCatching { scaled.recycle() }
        runCatching { decoded.recycle() }
        return if (written) name else null
    }

    /** 长边压到 [MAX_EDGE] 之内; 本来就够小就原样交回去 */
    private fun scaleDown(bitmap: Bitmap): Bitmap {
        val longest = maxOf(bitmap.width, bitmap.height)
        if (longest <= MAX_EDGE) return bitmap
        val ratio = MAX_EDGE.toFloat() / longest
        val width = (bitmap.width * ratio).toInt().coerceAtLeast(1)
        val height = (bitmap.height * ratio).toInt().coerceAtLeast(1)
        return runCatching { Bitmap.createScaledBitmap(bitmap, width, height, true) }.getOrDefault(bitmap)
    }

    private val serial = java.util.concurrent.atomic.AtomicInteger(0)
}
