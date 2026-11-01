package io.github.yuloong07star.luwi.channel

import android.graphics.Bitmap
import android.graphics.ColorSpace
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.hardware.HardwareBuffer
import android.media.Image
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import android.view.Surface
import kotlin.math.min

/**
 * 预览每秒最多搬这么多字节, 帧率由它按分辨率反推
 *
 * 写死一个帧率等于"给某一种分辨率调好的值": 1080p 每帧 10 MB、66ms 是 150 MB/s, 同一档放到
 * 2K 上就是每秒 1.1 GB 的白搬; 而 720p 又白等。同一个字节预算下 1080p 约 15fps、2K 约 8fps、
 * 720p 顶到 30fps
 */
internal const val PREVIEW_BYTES_PER_SECOND = 150_000_000L

/** 没有预览时缓存最新一帧的间隔 */
private const val FRAME_KEEP_MS = 250L

/** 预览间隔的下限与上限 (30fps / 5fps) */
private const val PREVIEW_GAP_MIN_MS = 33L
private const val PREVIEW_GAP_MAX_MS = 200L

/**
 * 这块屏的预览间隔: 每帧字节数 / 字节预算, 夹在 33~200ms
 *
 * 纯函数, 不碰 reader 也不碰 surface, 所以单测能直接量 (见 `FrameCacheTest`)
 */
internal fun previewGapFor(width: Int, height: Int): Long {
    if (width <= 0 || height <= 0) return FRAME_KEEP_MS
    val bytes = width.toLong() * height * 4L
    return (bytes * 1000L / PREVIEW_BYTES_PER_SECOND)
        .coerceIn(PREVIEW_GAP_MIN_MS, PREVIEW_GAP_MAX_MS)
}

/**
 * 一块屏从存在到消失都挂着的输出面, 以及它最近一帧
 *
 * 屏是给模型用的, 人看不看它都在跑, 而"人没在看"在系统侧不该有任何后果。让它是有的后果就是没有
 * 输出面: 虚拟屏的合成要写进一个面, 面没了合成器就不为它合成 —— 无障碍的 `windowsOnAllDisplays`
 * 里查不到它屏上的窗口 (`lw_ui` / `lw_tap` / `lw_type` 读的都是那份列表), 老的 `screencap -d`
 * 还会直接说这个 display id 不合法。所以这里的面**永远**挂着, 预览只是从缓存里另画一份
 *
 * 与上一版那个"没人看时的保活面"是同一个面, 只是多了两件事: 一是把最新一帧缓存成 Bitmap (取帧
 * 不再需要跑 `screencap`, 也不再需要跨进程传文件), 二是把这一帧镜像到预览那块 SurfaceView 上。
 * 这两件事都在本进程里做, 因为帧本来就在本进程的 reader 里
 *
 * buffer 的尺寸**必须**是屏自己的尺寸: 合成器不缩放, 给小了就是左上角的裁剪 (与预览那块
 * `SurfaceView` 的 `setFixedSize` 同一个道理)。屏改尺寸时旧 reader 不能改大小, 只能关掉换一个新的
 *
 * 帧没人要, 但也不能不取: 队列一旦满, 屏就卡在最后一帧上。取帧挂在 reader 自己的回调线程上, 拿到
 * 就关掉, 空闲时线程睡着, 不空转
 *
 * @param width 屏自己的宽, 也是这块 buffer 的宽
 * @param height 屏自己的高, 也是这块 buffer 的高
 */
internal class FrameCache(val width: Int, val height: Int) {

    private val lock = Any()

    private val reader: ImageReader

    private val thread: HandlerThread

    /** 交给虚拟屏的那个面, 直到屏被关掉或改了尺寸 */
    val surface: Surface

    /** 最近一帧, 由 [cachedAt] 记它是多久以前换上的. 读写都在 [lock] 里 */
    private var cached: Bitmap? = null

    private var cachedAt = 0L

    /** 缓存换过几回, 用来判断预览有没有必要再画一遍同一帧 */
    private var made = 0L

    private var drawn = -1L

    /** 预览那块面, 没人看的时候是 null */
    private var mirror: Surface? = null

    private var mirroredAt = 0L

    @Volatile
    private var closed = false

    private val paint = Paint().apply { isFilterBitmap = true }

    /**
     * 预览两帧之间至少隔多久
     *
     * 按这块屏每帧的字节数算, 不再是写死的 66ms: 1080p 约 66ms、2K 约 123ms、720p 顶到 33ms,
     * 同一常数在所有分辨率上都落在 33~200ms 里
     */
    private val previewGap: Long = previewGapFor(width, height)

    init {
        // usage 位不是可有可无: 交给 VirtualDisplay 的面必须能被合成器当渲染目标用, 而 4 参数的
        // newInstance 拿不到那两个位 —— 那样 setSurface 不报错, 可 SurfaceFlinger 当这块屏没有有效
        // 输出, `screencap -d` 会说这个 display id 不合法, 老的截图链路就是这么断的
        reader = ImageReader.newInstance(
            width,
            height,
            PixelFormat.RGBA_8888,
            MAX_IMAGES,
            HardwareBuffer.USAGE_GPU_COLOR_OUTPUT or HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE,
        )
        surface = reader.surface
        thread = HandlerThread("lw-frames-${width}x$height").apply { start() }
        reader.setOnImageAvailableListener({ source -> onFrame(source) }, Handler(thread.looper))
    }

    /** 这个面还是不是这块屏现在该有的那一块: 屏改过尺寸就得换新的 */
    fun matches(screen: ScreenState): Boolean = width == screen.width && height == screen.height

    /**
     * 预览现在画在哪块面上, 或者没有人看
     *
     * 只是记下一个目标, 帧还是这块屏自己的 reader 出的: 预览没了屏也在画, 反过来才是要防的那件事
     */
    fun mirror(surface: Surface?) {
        synchronized(lock) {
            mirror = surface
            if (surface == null || closed) return
            // 刚挂上时先把手里这帧画出来, 否则要等屏下一次变化才有画面
            if (cached != null) {
                mirroredAt = SystemClock.uptimeMillis()
                drawn = made
                drawLocked(surface)
            }
        }
    }

    /**
     * 最近一帧的一份拷贝, 没有帧时等到 [timeoutMs] 为止
     *
     * 回的是拷贝而不是缓存本身: 缓存会在下一帧被回收, 而拿到它的人可能还要画图、缩图、认字
     */
    fun latest(timeoutMs: Long = FRAME_TIMEOUT_MS): Bitmap? {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (true) {
            synchronized(lock) {
                cached?.let { return it.copy(Bitmap.Config.ARGB_8888, false) }
                if (closed) return null
            }
            if (SystemClock.uptimeMillis() >= deadline) return null
            try {
                Thread.sleep(POLL_MS)
            } catch (interrupted: InterruptedException) {
                Thread.currentThread().interrupt()
                return null
            }
        }
    }

    /** 连 reader 带它的线程一起交还, 屏没了之后没有别的用处 */
    fun close() {
        val already = synchronized(lock) {
            if (closed) {
                true
            } else {
                closed = true
                mirror = null
                cached?.recycle()
                cached = null
                false
            }
        }
        if (already) return
        // 关 reader 之前先摘监听: 回调正在跑时关会等它, 而它等的是上面那把锁
        try {
            reader.setOnImageAvailableListener(null, null)
        } catch (problem: Throwable) {
            Log.w(TAG, "the frame source for ${width}x$height had no listener to clear", problem)
        }
        try {
            reader.close()
        } catch (problem: Throwable) {
            Log.w(TAG, "the frame source for ${width}x$height did not close cleanly", problem)
        }
        thread.quitSafely()
    }

    /**
     * 一帧到了: 该缓存就缓存, 该画预览就画一遍
     *
     * 预览挂上时缓存换得勤 (按 [previewGap]), 没挂时换得慢 (4fps): 只有人在看的时候那个刷新率才有
     * 意义, 而每次换缓存都要把一整帧从 GPU 缓冲区拷出来, 那是这块屏平时最大的一笔固定开销
     */
    private fun onFrame(source: ImageReader) {
        val image = try {
            source.acquireLatestImage()
        } catch (problem: Throwable) {
            Log.w(TAG, "the frame source for ${width}x$height could not hand over a frame", problem)
            null
        } ?: return
        try {
            if (closed) return
            val now = SystemClock.uptimeMillis()
            val target = mirror
            val interval = if (target != null) previewGap else FRAME_KEEP_MS
            synchronized(lock) {
                if (closed) return
                if (cached == null || now - cachedAt >= interval) {
                    val next = frameOf(image)
                    if (next != null) {
                        cached?.recycle()
                        cached = next
                        cachedAt = now
                        made += 1
                    }
                }
                // 预览只画新帧, 而且两帧之间至少隔 previewGap: 静态屏不空转, 动起来的屏也不会
                // 因为同一帧被画了十几遍而白烧内存带宽
                if (target != null && made != drawn && now - mirroredAt >= previewGap) {
                    mirroredAt = now
                    drawn = made
                    drawLocked(target)
                }
            }
        } finally {
            // 不取走合成器就停画, 所以每一帧无论用不用都要还回去
            image.close()
        }
    }

    /**
     * 一帧的画面, 优先走 GPU 那条路
     *
     * `wrapHardwareBuffer` 把合成器那块缓冲区直接当纹理读, 再拷成软件位图, 全程不经过 CPU 逐像素;
     * 它要的是 USAGE_GPU_SAMPLED_IMAGE 那个位 (上面给了)。拿不到时退回逐行拷贝, 那条慢但不会让
     * 截图变成"没有画面"
     */
    private fun frameOf(image: Image): Bitmap? {
        val hardware = try {
            image.hardwareBuffer
        } catch (problem: Throwable) {
            Log.w(TAG, "a ${width}x$height frame came without a hardware buffer", problem)
            null
        }
        if (hardware != null) {
            try {
                val wrapped = Bitmap.wrapHardwareBuffer(hardware, ColorSpace.get(ColorSpace.Named.SRGB))
                val copy = wrapped?.copy(Bitmap.Config.ARGB_8888, false)
                if (copy != null) return copy
                Log.w(TAG, "the ${width}x$height frame would not copy out of its buffer")
            } catch (problem: Throwable) {
                Log.w(TAG, "a ${width}x$height frame could not be wrapped", problem)
            } finally {
                hardware.close()
            }
        }
        return copyPlane(image)
    }

    /** 没有硬件缓冲区时的退路: 按 stride 逐行读 RGBA 字节再拼成一张图 */
    private fun copyPlane(image: Image): Bitmap? {
        val plane = image.planes.firstOrNull() ?: return null
        val buffer = plane.buffer
        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        if (pixelStride < 4) {
            Log.w(TAG, "a ${width}x$height frame came with a $pixelStride byte pixel")
            return null
        }
        val row = ByteArray(rowStride.coerceAtLeast(width * pixelStride))
        val pixels = IntArray(width * height)
        buffer.rewind()
        val limit = buffer.limit()
        for (y in 0 until height) {
            val start = y * rowStride
            if (start >= limit) break
            buffer.position(start)
            val length = min(rowStride, limit - start)
            buffer.get(row, 0, length)
            val base = y * width
            for (x in 0 until width) {
                val at = x * pixelStride
                if (at + 3 >= length) break
                val r = row[at].toInt() and 0xFF
                val g = row[at + 1].toInt() and 0xFF
                val b = row[at + 2].toInt() and 0xFF
                val a = row[at + 3].toInt() and 0xFF
                pixels[base + x] = (a shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
        return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
    }

    /** 把缓存那帧画到预览面上; 面已经不认了就摘掉, 不每帧重试 */
    private fun drawLocked(target: Surface) {
        val frame = cached ?: return
        val canvas = try {
            target.lockCanvas(null)
        } catch (problem: Throwable) {
            Log.w(TAG, "the preview for ${width}x$height is gone: ${problem.message}")
            mirror = null
            return
        }
        try {
            canvas.drawBitmap(frame, null, Rect(0, 0, canvas.width, canvas.height), paint)
        } catch (problem: Throwable) {
            Log.w(TAG, "a preview frame of ${width}x$height did not go out", problem)
            mirror = null
        } finally {
            try {
                target.unlockCanvasAndPost(canvas)
            } catch (problem: Throwable) {
                Log.w(TAG, "a preview frame of ${width}x$height could not be posted", problem)
                mirror = null
            }
        }
    }

    private companion object {
        const val TAG = "LwScreen"

        /**
         * 留三块: 一块正被合成器写着, 一块刚交出去还在被拷, 一块等着被丢
         *
         * 一帧是 w×h×4 字节 (1080×2316 约 10 MB), 所以这是这块屏的一点固定开销
         */
        const val MAX_IMAGES = 3

        /** 屏刚建出来或刚改过尺寸时, 等第一帧的预算 */
        const val FRAME_TIMEOUT_MS = 1200L

        /** 等第一帧时多久看一眼 */
        const val POLL_MS = 20L
    }
}
