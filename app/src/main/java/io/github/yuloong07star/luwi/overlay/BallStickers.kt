package io.github.yuloong07star.luwi.overlay

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import io.github.yuloong07star.luwi.host.DshHost
import io.github.yuloong07star.luwi.tool.SimSetting
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

    /**
     * 单张上限的**缺省**值 (2026-11-10 起这一条能改: 设置 → 活动 → 更多设置 → 表情)
     *
     * 真正常用的是 [capBytes]: 它读那一页的设置, 读不到才回落到这个数
     */
    const val MAX_BYTES = 2L * 1024 * 1024

    /**
     * 现在允许多大 (设置 → 活动 → 更多设置 → 表情)
     *
     * 与宿主 `lw_sticker op=fetch` 的下载闸、门户那条加表情的路读的是同一格 `sim.json` —— 三处只要
     * 有一处还写死 2 MB, 就会出现"她存下了、球上画不出来"那种安静的空框
     */
    fun capBytes(context: Context): Long = runCatching {
        SimSetting.plan(context).sticker.maxBytes
    }.getOrDefault(MAX_BYTES)

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
        return loadFile(File(directory(context), name), maxHeight, capBytes(context))
    }

    /**
     * 按**文件**读一张图 (2026-11-08: 她发来的图落在 `lw/out/assets/…`, 不在表情那个目录里)
     *
     * 上限与幂等那几条跟按名字读的一模一样: 超过 [maxBytes] 不解码、只解到 [maxHeight] 那一档
     */
    fun loadFile(file: File, maxHeight: Int, maxBytes: Long = MAX_BYTES): Bitmap? {
        if (!file.isFile || file.length() > maxBytes) return null
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
        val cap = capBytes(context)
        directory(context).listFiles()
            ?.filter { it.isFile && it.length() in 1..cap }
            ?.map { it.name }
            ?.sorted()
            .orEmpty()
    }.getOrDefault(emptyList())
}
