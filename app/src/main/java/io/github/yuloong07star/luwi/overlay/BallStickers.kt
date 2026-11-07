package io.github.yuloong07star.luwi.overlay

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import io.github.yuloong07star.luwi.host.DshHost
import java.io.File

/**
 * 她能贴的那几张图 (2026-11-07 主人: "能让 luwi 发表情包更具人味")
 *
 * 素材就是 `$DSH_HOME/lw/stickers/` 里的文件, **主人自己放** (png / gif / webp, 单张 <= 2 MB) ——
 * 这里只管"从名字读到一张能画的图", 不做管理界面也不扫目录树
 *
 * GIF 只取第一帧: 逐帧动画是 [io.github.yuloong07star.luwi.plugin.theme.BallFaceDrawable] 的活
 * (那边一个状态 240 帧、42 MB 解码内存), 而这里要的是"贴一下", 一张静态图就够
 */
internal object BallStickers {

    /** 目录: 与宿主那一侧 `join(home, 'lw', 'stickers')` 是同一个约定 */
    const val DIRECTORY = "stickers"

    /** 贴上去那张图最多占屏高的百分之几 (再高就把框撑没了) */
    const val MAX_HEIGHT_PERCENT = 18

    /** 单张上限: 超过这一份不解码 (表情包不该有几兆) */
    const val MAX_BYTES = 2L * 1024 * 1024

    fun directory(context: Context): File =
        File(File(File(context.filesDir, DshHost.HOME_DIR), "lw"), DIRECTORY)

    /**
     * 按文件名读一张图, 读不动就回 null
     *
     * 文件名只认裸名字 (带路径分隔符或 `..` 的一律不认): 那个 id 从宿主那边来, 不能当路径用
     *
     * [maxHeight] 是贴上去那一格的高度上限, 解码时按它算 `inSampleSize` —— 一张 4000 px 的表情包
     * 直接解码是 12 MB 位图, 而屏幕上只画 18% 屏高
     */
    fun load(context: Context, id: String, maxHeight: Int): Bitmap? {
        val name = id.trim()
        if (name.isEmpty() || name.contains('/') || name.contains('\\') || name.contains("..")) return null
        val file = File(directory(context), name)
        if (!file.isFile || file.length() > MAX_BYTES) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        runCatching { BitmapFactory.decodeFile(file.absolutePath, bounds) }.getOrNull()
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        val wanted = maxHeight.coerceAtLeast(1)
        while (bounds.outHeight / (sample * 2) >= wanted) sample *= 2
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return runCatching { BitmapFactory.decodeFile(file.absolutePath, options) }.getOrNull()
    }

    /** 现在有哪几张 (给 `overlay op=state` 与排查用; 按名字排) */
    fun names(context: Context): List<String> = runCatching {
        directory(context).listFiles()
            ?.filter { it.isFile && it.length() in 1..MAX_BYTES }
            ?.map { it.name }
            ?.sorted()
            .orEmpty()
    }.getOrDefault(emptyList())
}
