package io.github.yuloong07star.luwi.channel

import android.content.Context
import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.util.DisplayMetrics
import android.util.Log
import android.view.Display
import android.view.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.yuloong07star.luwi.workspace.Workspace
import java.io.File
import java.util.LinkedHashMap
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.ceil
import kotlin.math.min
import kotlin.math.sqrt

/**
 * A virtual screen that exists right now
 * @property displayId the system's id for it, which is what every other call names
 * @property width the screen's own width in its own pixels
 * @property height the screen's own height in its own pixels
 * @property dpi the screen's own density
 * @property label what the menu calls it, which is the name its creator gave it
 * @property acceptsControl whether tools may still act on it, which the user turns off from the
 *   menu when they want the model's hands off this screen. The user's own finger on the preview is
 *   never subject to it: pausing stops the model, not the person holding the phone
 */
data class ScreenState(
    val displayId: Int,
    val width: Int,
    val height: Int,
    val dpi: Int,
    val label: String,
    val acceptsControl: Boolean = true,
) {
    /** Width over height, which is the shape a picture of it has to keep */
    val aspect: Float get() = width.toFloat() / height.toFloat()

    /** The short side over the long one, which is what a landscape screen shrinks its box to */
    val shape: String get() = "$width x $height"
}

/**
 * The virtual screens, from the app's side
 *
 * The screens are built in the privileged process and this is the app's whole handle on them:
 * every call here is one transaction, and they all go through a single worker thread, because the
 * first of them may have to start that process and because the order of a detach and an attach is
 * the state of the preview
 *
 * What the app contributes is the half the privileged side cannot have - the surface the frames
 * land on, which belongs to this process and dies with its window. Those two lifetimes are the
 * reason attaching is separate from selecting: a screen outlives the preview, and a screen that is
 * not selected keeps running, because whatever is on it is not the app's business to stop
 */
object VirtualScreen {

    private const val TAG = "LwScreen"

    /**
     * 一次截图留下的那两个文件
     *
     * 两份都在工作区里, 而且**是一对**: 全尺寸那份给人看, [fitted] 那份给模型。名字由这一层说,
     * 因为只有它知道缩放那份叫什么 (`.model` 后缀是 [Picture] 里的常量) —— 让上面照着全尺寸那个名字
     * 去猜, 猜错过一次
     *
     * @property fitted 交给模型的那一份 (装得下预算时就是全尺寸那份本身)
     * @property full 工作区里的全尺寸那份
     */
    data class Shot(val fitted: Picture.Fitted, val full: File)

    /**
     * 一次连拍拼成的那一张网格
     * @property shot 拼出来的文件, 与一次截图一样是一对 (给人看的全尺寸 + 给模型的那份)
     * @property columns 一行几格
     * @property rows 一共几行
     */
    data class Sheet(val shot: Shot, val columns: Int, val rows: Int)

    /** Every screen the device is hosting, in the order they were made */
    var screens: List<ScreenState> by mutableStateOf(emptyList())
        private set

    /** The screen the preview is showing, null while none is selected */
    var selected: ScreenState? by mutableStateOf(null)
        private set

    /** Why the last attempt failed, cleared by the next one that works */
    var lastError: String? by mutableStateOf(null)
        private set

    /** Whether a call is in flight, which is what a caller waits on before asking again */
    var working: Boolean by mutableStateOf(false)
        private set

    /**
     * The surface each screen's preview draws into, by display id
     *
     * 这只是一路镜像的目标, 不是屏的输出面: 屏一直画在 [frames] 那块 reader 里, 所以预览报"面
     * 没了"的时候屏不会跟着没了。一块屏一个格子而不是全应用一个: 换屏时旧面被拆、新面挂上,
     * 那两个报告可能交错到达, 一个格子会把旧报当成新屏的
     */
    private val surfaces = mutableMapOf<Int, Surface?>()

    /**
     * 每块屏那个人不看也要有的输出面, 以及它最近一帧
     *
     * 屏从存在的那一刻起就画进这里, 预览只是从同一份缓存镜像出去 —— 有没有人看, 与能不能截图、
     * 能不能读屏因此是两件事。帧留在本进程里, 所以取图既不用跑 `screencap`, 也不用跨进程传文件
     */
    private val frames = mutableMapOf<Int, FrameCache>()

    /**
     * The screens that were closed lately, by display id, so a call on a dead id can say who
     * closed it. Bounded: only the most recent few are worth remembering, and an id that comes
     * back around would be a new screen anyway
     */
    private val closed = LinkedHashMap<Int, ClosedScreen>()

    /** Where a picture of the screen is left, which only the app's own directories can be */
    @Volatile
    private var pictures: File? = null

    /** The app, kept for the one thing here that needs to name a directory of its own */
    @Volatile
    private var application: Context? = null

    /**
     * Everything that changes which screen draws where, one at a time and in order
     *
     * A single thread is what makes a switch safe: detaching the old screen and attaching the new
     * one are two transactions, and a preview that came and went between them would otherwise be
     * able to leave the surface on a screen nobody is looking at
     */
    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "lw-screen").apply { isDaemon = true }
    }

    /** Touch, queued on a thread of its own so a gesture never waits for a screen switch */
    private val touches = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "lw-screen-touch").apply { isDaemon = true }
    }

    /**
     * Build the one thing here that needs a context: somewhere to write a captured picture
     *
     * The picture is written by the privileged process, which runs as the uid Shizuku or root gave
     * it rather than as the app, and that uid is what decides where it may write. It cannot open
     * anything inside the app's sandbox - that is what a sandbox is - and the external cache is no
     * better: `/storage/emulated/0` belongs to the `media_rw` group, a process that came up as the
     * shell uid is not in it, and every write under it is refused outright. What that process can
     * write is the shell scratch directory, which belongs to the shell uid itself, and the app can
     * read a file left there, which is the pair this needs
     *
     * The staged name carries a random part because that directory is traversable by every process
     * on the device: a file in it is readable by anything that can guess the name, and a picture of
     * the phone is not something to leave where the name can be guessed
     */
    fun initialize(context: Context) {
        application = context.applicationContext
        val scratch = File(SHELL_SCRATCH)
        val directory = if (scratch.isDirectory) scratch else context.applicationContext.cacheDir
        pictures = File(directory, "$PICTURE_PREFIX${UUID.randomUUID()}$PICTURE_SUFFIX")
    }

    /**
     * Ask for the screen and show it, blocking
     *
     * 同一时刻只允许一块: 已经有一块时**先把它关掉再建新的** (2026-10-28 主人定的硬限制), 不是
     * 拒绝也不是并排 —— 旧屏上的应用随屏一起结束。特权侧也钉了同一条 (`LwVirtualDisplay.create`),
     * 两层任一层被绕过都到不了"两块屏"
     *
     * Blocking because nobody in the app calls this: a screen is made by whatever is driving the
     * device - a tool, over the bridge - and that caller wants the screen it just asked for. It
     * runs on the worker so it cannot interleave with a release or a preview attach
     *
     * @param name what its creator wants it called, or a plain one when nothing was said
     * @param width the screen's own size, or 0 to take this device's
     * @param height the screen's own size, or 0 to take this device's
     * @param dpi the screen's density, or 0 to take this device's
     */
    fun create(name: String? = null, width: Int = 0, height: Int = 0, dpi: Int = 0): ScreenState? {
        val metrics = Resources.getSystem().displayMetrics
        val pixelsWide = if (width > 0) width else metrics.widthPixels
        val pixelsHigh = if (height > 0) height else metrics.heightPixels
        val density = if (dpi > 0) dpi else metrics.densityDpi
        Log.i(TAG, "asking for a ${pixelsWide}x$pixelsHigh screen at ${density}dpi named ${name ?: "(none)"}")
        return try {
            var made: ScreenState? = null
            worker.submit {
                val service = requireService()
                // 单槽: 旧屏先关, 旧屏上的应用也一起走
                screens.toList().forEach { old ->
                    closeLocal(old, byUser = false, replaced = true)
                    try {
                        service.releaseDisplay(old.displayId)
                    } catch (problem: Throwable) {
                        report("release", problem)
                    }
                }
                val frame = FrameCache(pixelsWide, pixelsHigh)
                try {
                    // 这个面从建屏那一刻就交上去: 预览可能过很久才挂上, 也可能一直不挂, 而屏从
                    // 存在的那一刻起就该有画面 —— 有画面才有窗口, 窗口才是工具找得到它的东西
                    val id = service.createDisplay(pixelsWide, pixelsHigh, density, frame.surface)
                    val screen = ScreenState(id, pixelsWide, pixelsHigh, density, label(name))
                    frames[id] = frame
                    screens = listOf(screen)
                    selected = screen
                    lastError = null
                    made = screen
                } catch (problem: Throwable) {
                    frame.close()
                    throw problem
                }
            }.get(CREATE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            made
        } catch (problem: Throwable) {
            report("create", problem.cause ?: problem)
            null
        }
    }

    /**
     * Give one screen another shape, with whatever is running on it left running
     *
     * Blocking, because the caller is a tool that will look at the result next: an app on the screen
     * is re-laid out rather than restarted, and the size it now has is what the next picture and the
     * next coordinates have to be read against
     *
     * @param width the screen's new width, or 0 to keep the one it has
     * @param height the screen's new height, or 0 to keep the one it has
     * @param dpi the screen's new density, or 0 to keep the one it has
     * @param swap trade width for height instead of naming a size, which is the same change said
     *   the way a caller thinks about it: the density does not move
     */
    fun resize(
        screen: ScreenState,
        width: Int = 0,
        height: Int = 0,
        dpi: Int = 0,
        swap: Boolean = false,
    ): ScreenState? {
        // 暂停是"别碰这块屏", 换尺寸也在碰它: 用户刚说过别动, 底下的布局不该在他手底下换掉
        requireAcceptsControl(screen)
        val pixelsWide = if (swap) screen.height else if (width > 0) width else screen.width
        val pixelsHigh = if (swap) screen.width else if (height > 0) height else screen.height
        val density = if (dpi > 0) dpi else screen.dpi
        requireSize(pixelsWide, "width")
        requireSize(pixelsHigh, "height")
        return try {
            var resized: ScreenState? = null
            worker.submit {
                val service = requireService()
                // reader 的 buffer 是按尺寸定死的, 改尺寸只能换一个新的: 合成器不缩放, 旧面只装
                // 得下新屏的左上角
                val next = FrameCache(pixelsWide, pixelsHigh)
                try {
                    service.resizeDisplay(screen.displayId, pixelsWide, pixelsHigh, density)
                    service.setDisplaySurface(screen.displayId, next.surface)
                } catch (problem: Throwable) {
                    next.close()
                    throw problem
                }
                frames.remove(screen.displayId)?.close()
                frames[screen.displayId] = next
                // 预览还是同一块面, 换了帧源要重新挂上去, 否则预览停在上一帧
                surfaces[screen.displayId]?.let { next.mirror(it) }
                val updated = screen.copy(width = pixelsWide, height = pixelsHigh, dpi = density)
                screens = screens.map { if (it.displayId == screen.displayId) updated else it }
                if (selected?.displayId == screen.displayId) selected = updated
                lastError = null
                resized = updated
            }.get(CREATE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            resized
        } catch (problem: Throwable) {
            report("resize", problem.cause ?: problem)
            null
        }
    }

    /** Refuse a size that is a typo rather than a screen, before the device tries to allocate it */
    private fun requireSize(pixels: Int, side: String) {
        if (pixels in MIN_DISPLAY_SIDE..MAX_DISPLAY_SIDE) return
        throw IllegalArgumentException(
            "$side of $pixels is not a screen: a side is between $MIN_DISPLAY_SIDE and" +
                " $MAX_DISPLAY_SIDE pixels",
        )
    }

    /** What to call a screen: the name its creator gave it, or a plain one when it said none */
    private fun label(name: String?): String = name?.trim().orEmpty().ifEmpty { "虚拟屏" }

    /** Show one screen, or stop showing the one that is already showing */
    fun toggle(screen: ScreenState) {
        select(if (selected?.displayId == screen.displayId) null else screen)
    }

    /**
     * Let tools act on one screen again, or stop them
     *
     * A screen accepts control from the moment it is made; this is the user's brake on the model,
     * for when they want to take over by hand or stop what it is doing. It does not touch the
     * screen, does not close it and does not stop the preview - it only makes every acting call
     * refuse until it is turned back on
     */
    fun setAcceptsControl(screen: ScreenState, accepts: Boolean) {
        screens = screens.map {
            if (it.displayId == screen.displayId) it.copy(acceptsControl = accepts) else it
        }
        // 选中的那个是列表里的一份旧拷贝, 不跟着换菜单里就还是旧状态
        if (selected?.displayId == screen.displayId) {
            selected = screens.firstOrNull { it.displayId == screen.displayId }
        }
    }

    /**
     * Refuse an action while the user has this screen paused
     *
     * Reads the current list rather than the caller's copy: a call that was queued before the user
     * pressed pause has to see the pause too
     */
    fun requireAcceptsControl(screen: ScreenState) {
        val current = screens.firstOrNull { it.displayId == screen.displayId } ?: return
        if (current.acceptsControl) return
        throw IllegalStateException(
            "the user paused control of the virtual screen \"${current.label}\"" +
                " (displayId ${current.displayId}), so nothing may act on it" +
                " - tell them to resume it from the phone's menu" +
                " (虚拟屏 -> ${current.label} -> 继续接受控制)",
        )
    }

    /**
     * The phone's own screen, which every acting call can name like any other
     *
     * Read out of the display manager on each call rather than remembered, because its size turns
     * with the device and the coordinates a caller sends have to be in the space it has right now.
     * It is deliberately never one of [screens]: it is not ours to preview, to pause or to give
     * back, and it exists whether or not this app is running
     */
    @Suppress("DEPRECATION")
    fun mainScreen(): ScreenState {
        val metrics = DisplayMetrics()
        application
            ?.getSystemService(DisplayManager::class.java)
            ?.getDisplay(Display.DEFAULT_DISPLAY)
            ?.getRealMetrics(metrics)
        // An app that has not been initialized, or a device with no display manager, falls back to
        // the same metrics a screen of ours would be made with - both name this phone's own screen
        if (metrics.widthPixels <= 0 || metrics.heightPixels <= 0) {
            val system = Resources.getSystem().displayMetrics
            return ScreenState(MAIN_DISPLAY, system.widthPixels, system.heightPixels, system.densityDpi, MAIN_LABEL)
        }
        return ScreenState(MAIN_DISPLAY, metrics.widthPixels, metrics.heightPixels, metrics.densityDpi, MAIN_LABEL)
    }

    /** Show a screen, or none: 预览只是一路镜像, 显不显示都不影响这块屏与它的帧 */
    private fun select(screen: ScreenState?) {
        if (selected?.displayId == screen?.displayId) return
        selected = screen
    }

    /**
     * Give one screen back, and with it whatever the system put on it
     * @param screen the screen to close.
     * @param byUser true when the phone's own menu asked for this, false when a tool did, which is
     *   what lets a later call on this id say who closed it
     */
    fun release(screen: ScreenState, byUser: Boolean = false) {
        closeLocal(screen, byUser, replaced = false)
        working = true
        worker.execute {
            try {
                requireService().releaseDisplay(screen.displayId)
                lastError = null
            } catch (problem: Throwable) {
                report("release", problem)
            } finally {
                working = false
            }
        }
    }

    /**
     * 这一侧先当它已经不在了: 列表、预览、帧源一起收
     *
     * 与 [release] 分开是因为建屏那条路也要用它 —— 那里已经在 worker 上, 不能再往 worker 上排一次
     */
    private fun closeLocal(screen: ScreenState, byUser: Boolean, replaced: Boolean) {
        screens = screens.filterNot { it.displayId == screen.displayId }
        surfaces.remove(screen.displayId)
        frames.remove(screen.displayId)?.close()
        if (selected?.displayId == screen.displayId) selected = null
        remember(screen, byUser, replaced)
    }

    /**
     * Why one displayId points at nothing right now
     *
     * The three cases are told apart on purpose, because what to do about them differs:
     *
     * - it never existed (or was forgotten): a bad id, so go and list the screens
     * - the user closed it from the phone: a person's decision, so stop and ask them
     * - an agent closed it through `lw_screen_release`: screens are shared, so another session may
     *   be the one that did it, and making a replacement is the user's call rather than the model's
     */
    fun missingScreenReason(displayId: Int): String {
        val gone = closed[displayId]
        return when {
            gone == null ->
                "no screen with displayId $displayId, ask screen for the ones that exist"

            // 单槽: 建新屏会把旧屏关掉, 与"用户关的 / 别的会话关的"都不一样
            gone.replaced ->
                "displayId $displayId was closed when another screen was built: only one virtual" +
                    " screen may exist at a time, so a new one replaces the old one and whatever" +
                    " was running on it - lw_screen lists the screen that is there now"

            gone.byUser ->
                "the user closed the virtual screen \"${gone.label}\" (displayId $displayId) from" +
                    " the phone's menu, so it is gone - stop and ask them what they want before" +
                    " acting again (lw_screen lists the one that is left)"

            else ->
                "the virtual screen \"${gone.label}\" (displayId $displayId) was closed by an" +
                    " agent calling lw_screen_release rather than by the user, so the id is gone -" +
                    " do not make a replacement without asking, and if one has to be made, that" +
                    " closes the screen that is there now as well (lw_screen lists it)"
        }
    }

    /** Remember one closed screen, keeping only the last few, for the sentence above */
    private fun remember(screen: ScreenState, byUser: Boolean, replaced: Boolean) {
        closed[screen.displayId] = ClosedScreen(screen.label, byUser, replaced)
        while (closed.size > CLOSED_REMEMBERED) {
            closed.remove(closed.keys.first())
        }
    }

    /**
     * Follow the preview's surface for one screen
     *
     * 预览只是一路镜像: 面记在这里, 帧还是那块屏自己的 reader 出的。面没了 (收起预览 / app 切后台 /
     * 窗口被拆) 是正常状态, 屏照旧合成、照旧能拍, 工具照旧看得见它
     */
    fun attach(screen: ScreenState, surface: Surface?) {
        surfaces[screen.displayId] = surface
        frames[screen.displayId]?.mirror(surface)
    }

    /** A finger touched the screen, at a point in the screen's own coordinates */
    fun press(screen: ScreenState, x: Float, y: Float) = touch(screen.displayId, LwServiceProtocol.TOUCH_DOWN, x, y)

    /** A finger moved across the screen */
    fun move(screen: ScreenState, x: Float, y: Float) = touch(screen.displayId, LwServiceProtocol.TOUCH_MOVE, x, y)

    /** A finger left the screen */
    fun release(screen: ScreenState, x: Float, y: Float) = touch(screen.displayId, LwServiceProtocol.TOUCH_UP, x, y)

    /**
     * Press and lift at one point, waiting until the device has taken it
     *
     * Blocking, unlike the preview's own touches: the caller here is a tool that will look at the
     * screen the moment this returns, and "queued" would be a lie it could not tell apart from
     * "done". The screen is named by the caller rather than taken from the selection, which is the
     * user's to change at any moment
     *
     * A press that is held is the one gesture here that can be taken away while it is happening on
     * the phone's own screen: a real finger arriving lifts it where it stands, and the answer says
     * how long it lasted, because a caller that thinks its press was held reads what follows as the
     * result of something that never finished
     *
     * @param screen the screen to touch.
     * @param x the point in the screen's own pixels.
     * @param y the point in the screen's own pixels.
     * @param holdMs how long the finger stays down, [LONG_PRESS_MS][LwServiceProtocol.LONG_PRESS_MS]
     *   or more being what a long press is.
     */
    fun tap(screen: ScreenState, x: Float, y: Float, holdMs: Long = 0L) {
        requireAcceptsControl(screen)
        gesture(screen, "tap") { service ->
            service.tap(screen.displayId, x, y, holdMs)
        }
    }

    /**
     * Drag from one point to another, waiting until the finger has been lifted again
     */
    fun swipe(screen: ScreenState, fromX: Float, fromY: Float, toX: Float, toY: Float, durationMs: Long) {
        requireAcceptsControl(screen)
        gesture(screen, "swipe") { service ->
            service.swipe(screen.displayId, fromX, fromY, toX, toY, durationMs)
        }
    }

    /**
     * 多指手势: 每条路径一根手指, 一起走
     *
     * 与单指的拖同一条路 (队列 + 那道暂停闸), 只是"步"里所有手指一起动
     */
    fun multiGesture(screen: ScreenState, paths: List<LwInput.Path>, durationMs: Long) {
        requireAcceptsControl(screen)
        gesture(screen, "gesture") { service ->
            service.gesture(screen.displayId, paths, durationMs)
        }
    }

    /** 捏合: 两根手指在中心两侧分合, 是 [multiGesture] 的糖衣 */
    fun pinch(screen: ScreenState, x: Float, y: Float, scale: Float, durationMs: Long) {
        requireAcceptsControl(screen)
        gesture(screen, "pinch") { service ->
            service.pinch(screen.displayId, x, y, scale, durationMs)
        }
    }

    /**
     * Press one key on a screen, waiting until the device has taken it
     *
     * Pressing a key is acting on a screen like any other call here, so it goes through the same
     * queue and past the same gate: the menu's pause on a screen of ours
     *
     * @param holdMs how long the key stays down, [LONG_PRESS_MS][LwServiceProtocol.LONG_PRESS_MS] or
     *   more being what the platform reads as a long press
     */
    fun key(screen: ScreenState, keyCode: Int, holdMs: Long) {
        requireAcceptsControl(screen)
        if (screen.displayId != MAIN_DISPLAY && keyCode in KeyCodes.WHOLE_SCREEN) {
            throw IllegalStateException(
                "the key ${KeyCodes.nameOf(keyCode)} is about a whole screen rather than about" +
                    " what is on it, and \"${screen.label}\" (displayId ${screen.displayId}) is a" +
                    " screen of ours: it has no launcher and no system UI, so this key does nothing" +
                    " useful there and can leave the display asleep with its last picture still" +
                    " coming out of lw_screenshot - press it on the phone's own screen (displayId" +
                    " 0), or give this screen back with lw_screen_release and make a new one",
            )
        }
        gesture(screen, "key") { service ->
            val accepted = service.key(screen.displayId, keyCode, holdMs)
            if (!accepted) {
                throw IllegalStateException(
                    "the device refused the key press on displayId ${screen.displayId}" +
                        " (\"${screen.label}\") - the screen may have gone or the key may not be" +
                        " one it can take",
                )
            }
        }
    }

    /**
     * Type a string as key presses, answering how many characters went through
     *
     * The narrow half of typing: it is here for a screen that reports no field, because then the
     * only thing left is the keys a keyboard would have pressed. It goes through the touch queue
     * with everything else, so it cannot land in the middle of a gesture
     */
    fun text(screen: ScreenState, text: String): Int {
        requireAcceptsControl(screen)
        var typed = NOTHING_TYPED
        gesture(screen, "type") { service -> typed = service.text(screen.displayId, text) }
        return typed
    }

    /**
     * Run one gesture on the touch queue and wait for the device to answer
     *
     * The queue is what keeps a gesture in order against the preview's own fingers, and waiting on
     * it is what lets a caller report what happened instead of hoping. The pause is asked again
     * inside the queued block: whatever is behind this one in the queue would otherwise still run
     * after the user pressed pause
     */
    private fun gesture(screen: ScreenState, name: String, block: (LwServiceProxy) -> Unit) {
        try {
            touches.submit {
                requireAcceptsControl(screen)
                block(requireService())
            }.get(GESTURE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            lastError = null
        } catch (problem: Throwable) {
            // The queue hands back what the transaction threw, which is the message worth keeping
            val cause = problem.cause ?: problem
            report(name, cause)
            throw IllegalStateException(lastError ?: "$name failed", cause)
        }
    }

    /**
     * Capture one screen and leave the picture where the model and the user can both open it
     *
     * Blocking, because its callers are the ones that want the bytes: a tool call, or a check. 我们
     * 自己的屏直接从缓存那帧写出来, 不经过特权进程, 也不跑 `screencap`; 只有手机自己那块屏才
     * 交给特权侧, 因为它是唯一需要 shell uid 才拍得到的东西
     *
     * The scaling happens here rather than at the far end: once a picture is stored nothing on this
     * device can re-encode it, so what the model will read has to be the right size by the time it
     * is handed over
     * @param screen the screen to capture, named rather than taken from the selection.
     * @param maxPixels the pixel budget the picture is scaled to fit.
     * @param maxBytes the byte budget the picture is scaled to fit.
     * @param region the part of the screen to hand over, or null for all of it: 那一块仍然按整屏的坐标
     *   量, 而答案里带它的左上角, 所以模型能把图上的点换算回屏幕上的点
     * @param suffix 文件名后缀, 连拍时一个序号: `screen-2-1.png`
     * @returns both files of the capture, or null with [lastError] set.
     */
    fun screenshot(
        screen: ScreenState,
        maxPixels: Int = Picture.DEFAULT_MAX_PIXELS,
        maxBytes: Int = Picture.DEFAULT_MAX_BYTES,
        region: Rect? = null,
        suffix: String = "",
    ): Shot? {
        val picture = File(screens(), "screen-${screen.displayId}$suffix.png")
        return try {
            if (screen.displayId == MAIN_DISPLAY) {
                val staging = pictures ?: run {
                    lastError = "no directory to write a picture into"
                    return null
                }
                val stale = captureSettled(screen, staging)
                if (stale != null) {
                    lastError = stale
                    return null
                }
                staging.copyTo(picture, overwrite = true)
            } else {
                val frame = frames[screen.displayId]?.latest() ?: run {
                    lastError = NOTHING_DRAWN
                    return null
                }
                try {
                    picture.outputStream().use { frame.compress(Bitmap.CompressFormat.PNG, 100, it) }
                } finally {
                    frame.recycle()
                }
            }
            lastError = null
            Shot(Picture.fit(picture, maxPixels, maxBytes, region), picture)
        } catch (problem: Throwable) {
            report("screenshot", problem)
            null
        }
    }

    /**
     * 一次连拍的几张, 拼成一张网格
     *
     * 连拍要回答的是"这段过程里画面怎么走的", 而十二张图是十二份上下文; 拼成一张网格就把那件事变成
     * 一次读图。**它是用来看动起来的, 不是用来量坐标或读小字的** —— 每一格都被缩过, 格上的点回不到
     * 屏幕上任何地方, 所以它不进"图上的点乘多少回到屏幕"那一套, 小字留给那几张原图
     *
     * @param frames 交给模型的那几份 (各自都装得下预算了), 按拍的顺序, 至少两张
     * @param name 文件名, 与那几张落在同一个目录
     * @param maxPixels 拼出来这一张自己的像素预算
     * @param maxBytes 拼出来这一张自己的字节预算
     * @returns 拼好的那一张与它的行列数, 或 null 并设 [lastError]
     */
    fun contactSheet(frames: List<File>, name: String, maxPixels: Int, maxBytes: Int): Sheet? {
        if (frames.size < 2) {
            lastError = "a sheet needs at least two pictures"
            return null
        }
        val cell = Picture.sizeOf(frames.first()) ?: run {
            lastError = "could not read ${frames.first().name}, so there is nothing to lay out"
            return null
        }
        val columns = ceil(sqrt(frames.size.toDouble())).toInt().coerceAtLeast(1)
        val rows = (frames.size + columns - 1) / columns
        // 拼出来这张自己在预算之内的做法是先把每一格缩到位, 而不是拼一张大的再整张缩一遍: 后者要在
        // 内存里先开一张 12 倍大的图, 而交出去的是同一张缩小的
        val natural = cell.first.toDouble() * cell.second * columns * rows
        val shrink = min(1.0, sqrt(maxPixels.coerceAtLeast(1) / natural))
        val tileWidth = (cell.first * shrink).toInt().coerceAtLeast(1)
        val tileHeight = (cell.second * shrink).toInt().coerceAtLeast(1)
        return try {
            val sheet = Bitmap.createBitmap(
                columns * tileWidth,
                rows * tileHeight,
                Bitmap.Config.ARGB_8888,
            )
            val canvas = Canvas(sheet)
            // 空着的格子留黑, 这样"这里没有一张"与"这一格是一屏白的"分得开
            canvas.drawColor(Color.BLACK)
            val paint = Paint().apply { isFilterBitmap = true }
            frames.forEachIndexed { index, file ->
                val decoded = BitmapFactory.decodeFile(file.absolutePath) ?: return@forEachIndexed
                val scaled = if (decoded.width == tileWidth && decoded.height == tileHeight) {
                    decoded
                } else {
                    Bitmap.createScaledBitmap(decoded, tileWidth, tileHeight, true)
                }
                canvas.drawBitmap(
                    scaled,
                    ((index % columns) * tileWidth).toFloat(),
                    ((index / columns) * tileHeight).toFloat(),
                    paint,
                )
                if (scaled !== decoded) scaled.recycle()
                decoded.recycle()
            }
            val target = File(screens(), "$name.png")
            target.outputStream().use { sheet.compress(Bitmap.CompressFormat.PNG, 100, it) }
            sheet.recycle()
            lastError = null
            Sheet(Shot(Picture.fit(target, maxPixels, maxBytes), target), columns, rows)
        } catch (problem: Throwable) {
            report("sheet", problem)
            null
        }
    }

    /**
     * Take a picture of the screen, and keep taking it while the device hands back the old frame
     *
     * A screen that has just been given another size has not drawn a frame at that size yet, and
     * `screencap` answers with the last frame there was - the size before, without saying so. A
     * caller that resized a screen and then looked would measure every coordinate on a picture of
     * the screen as it used to be, so what came back is checked against the size the screen has and
     * the capture is taken again until the two agree. The budget is short because the wait is one
     * frame: measured on the device, the second attempt in a row is already the right size
     *
     * @returns why the picture never matched, or null once one did
     */
    private fun captureSettled(screen: ScreenState, staging: File): String? {
        var last = "nothing"
        repeat(CAPTURE_ATTEMPTS) { attempt ->
            // 特权侧回的是"为什么没有图": 屏没了, 与屏在而应用还没画上去, 是两件事
            val problem = requireService().screenshot(screen.displayId, staging.absolutePath)
            if (problem.isNotEmpty()) return problem
            val size = Picture.sizeOf(staging) ?: return null
            if (size.first == screen.width && size.second == screen.height) return null
            last = "${size.first}x${size.second}"
            Log.i(TAG, "display ${screen.displayId} is ${screen.width}x${screen.height} but the" +
                " capture came back $last, taking it again")
            if (attempt < CAPTURE_ATTEMPTS - 1) Thread.sleep(CAPTURE_SETTLE_MS)
        }
        return "the device is still handing back a $last picture of a ${screen.width}x" +
            "${screen.height} screen, which is the frame from before it changed size: take it again"
    }

    /** Where captured pictures are left: inside the workspace, under a directory of our own */
    private fun screens(): File {
        val context = application ?: throw IllegalStateException("the app has not been initialized")
        return File(Workspace.resolve(context).directory, SCREENSHOTS).apply { mkdirs() }
    }

    /**
     * Where an OCR debug picture goes, when the caller asked for one
     *
     * 用应用自己的外部目录而不是工作区: 它只是给人看的一张图, 不进模型的上下文, 也不想被当成
     * 一次会话的产物混在 `screenshots/` 里
     */
    fun ocrDebugDir(): File? = application?.getExternalFilesDir(OCR_DEBUG)

    /**
     * Whether one screen is awake, because two things go wrong when it is not
     *
     * A sleeping display keeps showing the last frame it drew, so `screencap` hands back a picture
     * of an interface that is no longer on the screen - reading it reports text that cannot be
     * pressed. And an injected touch does not wake a display, so the press lands nowhere. Both are
     * silent, which is why the answer carries this rather than a caller having to guess
     */
    fun displayPower(displayId: Int): String {
        val context = application ?: throw IllegalStateException("the app has not been initialized")
        val display = context.getSystemService(DisplayManager::class.java).getDisplay(displayId)
            ?: return "gone"
        return when (display.state) {
            Display.STATE_OFF -> "off"
            Display.STATE_DOZE, Display.STATE_DOZE_SUSPEND -> "dozing"
            Display.STATE_UNKNOWN -> "unknown"
            else -> "on"
        }
    }

    /**
     * One screen at its own resolution, for OCR
     *
     * Two differences from [screenshot], both deliberate: this one is **not** scaled to the pixel
     * budget (that budget exists so the model can read a picture at all, and halving a 12sp glyph
     * makes it unreadable), and nothing is left in the workspace - OCR wants pixels, not a file
     * for the model to open. 我们自己的屏连文件都不经过: 直接拿缓存那一帧的拷贝
     */
    fun capture(screen: ScreenState): Bitmap? {
        return try {
            if (screen.displayId == MAIN_DISPLAY) {
                val staging = pictures ?: run {
                    lastError = "no directory to write a picture into"
                    return null
                }
                val stale = captureSettled(screen, staging)
                if (stale != null) {
                    lastError = stale
                    return null
                }
                BitmapFactory.decodeFile(staging.absolutePath)
            } else {
                frames[screen.displayId]?.latest()
            }.also { bitmap ->
                lastError = if (bitmap == null) NOTHING_DRAWN else null
            }
        } catch (problem: Throwable) {
            report("capture", problem)
            null
        }
    }

    /**
     * Queue one moment of a finger
     *
     * Asynchronous, because its caller is the preview following a finger of its own: a frame that
     * waited for a round trip would drop the next one, and the queue is what keeps the order right
     * against whatever else is touching the same screen
     */
    private fun touch(displayId: Int, action: Int, x: Float, y: Float) {
        touches.execute {
            try {
                requireService().touch(displayId, action, x, y)
            } catch (problem: Throwable) {
                // A touch that failed is not worth a line in the UI: the finger is still moving,
                // and the next call will say the same thing
                Log.w(TAG, "touch $action at $x,$y failed", problem)
            }
        }
    }

    /** The channel, connected if it was not, or the reason there is none */
    private fun requireService(): LwServiceProxy = PrivilegedChannel.ensure()
        ?: throw IllegalStateException(PrivilegedChannel.state().error ?: "no privileged process")

    private fun report(name: String, problem: Throwable) {
        Log.w(TAG, "$name failed", problem)
        lastError = problem.message ?: problem.javaClass.simpleName
    }

    /** Where a non-root privileged process may write, which is the shell uid's own directory */
    private const val SHELL_SCRATCH = "/data/local/tmp"

    /** What a staged picture is called, around a random part that makes the name unguessable */
    private const val PICTURE_PREFIX = "lw-screen-"

    private const val PICTURE_SUFFIX = ".png"

    /** Where in the workspace pictures are kept, which the model can read and the user can open */
    private const val SCREENSHOTS = "screenshots"

    /** 调试图那个目录的名字, 落在应用自己的外部文件里, 不进工作区 */
    private const val OCR_DEBUG = "ocr"

    /** A gesture is one transaction, so this only has to outlast the longest swipe asked for */
    private const val GESTURE_TIMEOUT_MS = 30_000L

    /** How many closed screens are remembered for [missingScreenReason] */
    private const val CLOSED_REMEMBERED = 8

    /** The phone's own screen, which is nobody's to create, to preview or to give back */
    private const val MAIN_DISPLAY = LwServiceProtocol.MAIN_DISPLAY

    /** What the phone's own screen is called, which is how a tool's answer shows it */
    private const val MAIN_LABEL = "主屏"

    /** What typing by key answers when the keyboard cannot produce the text */
    private const val NOTHING_TYPED = -1

    /**
     * What a screen's side is allowed to be
     *
     * A side is a number a caller types, so this is a guard against a wrong one rather than a
     * statement about displays: nothing is smaller than a few dozen pixels, and the largest phone
     * or tablet panel is far below the ceiling, while a surface at a made-up size is a picture
     * nobody can see and memory the device has to find
     */
    private const val MIN_DISPLAY_SIDE = 64
    private const val MAX_DISPLAY_SIDE = 8192

    /** How many times a capture is taken again while it is still the frame from before a resize */
    private const val CAPTURE_ATTEMPTS = 5

    /** How long to let the screen draw at its new size before looking again */
    private const val CAPTURE_SETTLE_MS = 120L

    /**
     * 一次建屏最多等多久
     *
     * 里面含"先把旧屏关掉"与"起特权进程"两笔, 实测都在一秒上下; 给的预算宽一点, 但必须有一个,
     * 否则通道卡住时调用方会无限期等下去
     */
    private const val CREATE_TIMEOUT_MS = 30_000L

    /** 屏在, 但没有任何东西画上去过: 与"屏没了"必须分得开 */
    private const val NOTHING_DRAWN =
        "the screen is there but nothing has drawn on it yet, so launch an app on that screen and" +
            " take the picture again"
}

/** A screen that is gone, whether the person holding the phone closed it, and whether a new one took its place */
private data class ClosedScreen(val label: String, val byUser: Boolean, val replaced: Boolean)
