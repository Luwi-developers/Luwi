package io.github.yuloong07star.luwi.channel

import android.content.pm.PackageManager
import android.util.Log
import com.topjohnwu.superuser.Shell
import rikka.shizuku.Shizuku
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * What a channel can say about itself before it is used
 *
 * Nothing here drives a screen - the app has no privileged settings UI yet and step 3 explicitly
 * leaves it out - so this exists for the two things that cannot be answered anywhere else: a
 * route that cannot possibly work should not be tried at all, and a Shizuku grant has to be asked
 * for before Shizuku is usable
 */
interface RemoteAccessPermissionBackend {

    val backend: RemoteBackend

    /** Whether this route could exist on this device at all */
    fun isAvailable(): Boolean

    /**
     * Whether this route may ask for its permission right now
     *
     * 与 [isAvailable] 是两个问题 (2.8.1 #30): 那个问"这条路在不在", 这个问"现在允不允许去要授权".
     * 分成两句之前 root 的"在不在"是拿"有没有授权"答的, 于是没试过之前这条路真的不存在 —— 首启
     * 不弹 su 保住了, 但主人在设置里点过开关之后也没有第二条路可走
     *
     * 缺省 false: 没有人表态的通道不自己开口. Shizuku 自己覆盖成"在那才问" —— 它有系统对话框,
     * 要授权本来就是它的正常用法, 但它不在的时候问也只会回 false
     */
    fun canPrompt(): Boolean = false

    /** Whether everything needed to use it is already in place */
    fun isGranted(): Boolean

    /**
     * Ask for whatever is missing, blocking until the platform has answered
     *
     * Blocking because the callers are worker threads, and because the answer is what the next
     * step depends on; the caller must not hold a main thread while this runs
     */
    fun requestPermission(): Boolean

    fun addStateListener(listener: Listener)

    fun removeStateListener(listener: Listener)

    fun interface Listener {
        fun onStateChanged(backend: RemoteBackend)
    }
}

/** What a route should do next, out of the three facts its backend can answer */
internal enum class AccessStep { USE, ASK, SKIP }

/**
 * 「这条路在不在」与「现在能不能要授权」合成的那一步 (2.8.1 #30)
 *
 * 三条按序判: 已经有权限就直接用; 两个判断任一为假就不问 (首启那一声不响就是这一条 —— 没表态的
 * root 既不"在", 也不许问); 其余只有一种 —— 去问.
 *
 * 两个判断拆开写而不是合成一句 `!available && !canPrompt`, 是因为"在但不许问"也该跳过: 那张表只要
 * 有一格为假, 开口就没有理由
 *
 * **这张表 `tools/check-channel.mjs` 是真跑它的**: 每行条件与 `available` / `canPrompt` / `granted`
 * 三个布尔是同一种写法, 脚本从这份源码里抽出来穷举 8 种组合, 所以改这里不必改脚本
 */
internal fun accessStep(available: Boolean, canPrompt: Boolean, granted: Boolean): AccessStep = when {
    granted -> AccessStep.USE
    !available -> AccessStep.SKIP
    !canPrompt -> AccessStep.SKIP
    else -> AccessStep.ASK
}

/**
 * root
 *
 * There is nothing an app can inspect to decide whether it has root. A root manager hides the su
 * binary from apps that are not on its allow list - KernelSU does, and this device shows it:
 * `/system/bin/su` is there for the shell uid and reports "No such file or directory" from the
 * app's own uid - so the only honest answer is to try, and the first attempt is what the root
 * manager answers with its own prompt
 *
 * libsu is what runs that attempt, and it also remembers the answer without prompting again
 */
object RootAccessBackend : RemoteAccessPermissionBackend {

    override val backend = RemoteBackend.ROOT

    /**
     * 这一拍允不允许 root 被问一次 (2.8.1 #30; 2026-11-19 改成按钮驱动)
     *
     * 由 [ChannelSetting.reprobe] 在**点「刷新状态」那一趟**置真, 问完立刻收回 —— 不落盘, 也就没有
     * "开关开着一直问"这一档. 平时是 false, 首启一声不响仍然成立
     */
    @Volatile
    var optedIn: Boolean = false

    /**
     * 这条路在不在: 已经授权, 或者主人表态过要去要一次
     *
     * 以前这句只有 `rootState() == true` 那一半, 而那是"有没有授权", 不是"这条路在不在" —— 于是
     * 没试过的机器上 root 根本不进 [PrivilegedChannel.ensure] 的循环, 点了开关也没人问 su
     */
    override fun isAvailable(): Boolean = rootState() == true || optedIn

    /** 现在能不能要授权: 只看这一拍有没有人点过「刷新状态」 */
    override fun canPrompt(): Boolean = optedIn

    /** What the root manager last decided, which is unknown until something has been run */
    override fun isGranted(): Boolean = rootState() == true

    /**
     * What the root manager decided, or null when nothing has been tried yet
     *
     * There is no way to find out without trying, and that is the root manager's doing rather than
     * a gap here: KernelSU takes the `su` command away from apps that are not on its list instead
     * of offering it and asking. An app that has not run one therefore cannot tell "not allowed"
     * from "never asked" - and neither can this
     */
    fun rootState(): Boolean? = runCatching { Shell.isAppGrantedRoot() }.getOrNull()

    /**
     * Asking is running something: the root manager prompts on the first su and remembers it
     *
     * This blocks for as long as the prompt is up, which is why it is only ever called from a
     * worker thread
     */
    override fun requestPermission(): Boolean =
        runCatching { Shell.getShell().isRoot }.getOrDefault(false)

    override fun addStateListener(listener: RemoteAccessPermissionBackend.Listener) = Unit

    override fun removeStateListener(listener: RemoteAccessPermissionBackend.Listener) = Unit
}

/**
 * Shizuku
 *
 * Unlike root this really does have a permission, granted through Shizuku's own dialog, and the
 * binder arriving or dying is a state worth observing even without a UI to show it in
 */
object ShizukuAccessBackend : RemoteAccessPermissionBackend {

    override val backend = RemoteBackend.SHIZUKU

    private val listeners = CopyOnWriteArraySet<RemoteAccessPermissionBackend.Listener>()

    private val observing = AtomicBoolean(false)

    override fun isAvailable(): Boolean =
        runCatching { Shizuku.pingBinder() }
            .onFailure { Log.w(TAG, "could not reach the Shizuku binder", it) }
            .getOrDefault(false)

    /** Shizuku 在那儿就谈得上问它要授权; 不在的时候 `requestPermission` 本来也只回 false */
    override fun canPrompt(): Boolean = isAvailable()

    override fun isGranted(): Boolean {
        if (!isAvailable()) return false
        return runCatching { Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED }
            .getOrDefault(false)
    }

    override fun requestPermission(): Boolean {
        observeState()
        if (!isAvailable()) return false
        // Before permission existed as a concept the binder being alive was the whole check
        if (Shizuku.isPreV11()) return true
        if (isGranted()) return true

        val code = REQUEST_CODE
        val answered = CountDownLatch(1)
        val granted = AtomicBoolean(false)
        val listener = Shizuku.OnRequestPermissionResultListener { resultCode, result ->
            if (resultCode != code) return@OnRequestPermissionResultListener
            granted.set(result == PackageManager.PERMISSION_GRANTED)
            answered.countDown()
        }
        Shizuku.addRequestPermissionResultListener(listener)
        try {
            Log.i(TAG, "asking Shizuku for permission, code=$code")
            Shizuku.requestPermission(code)
            // The result arrives on the main thread, which is free while this worker waits
            if (!answered.await(PERMISSION_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                Log.w(TAG, "nobody answered the Shizuku permission request")
            }
        } catch (error: Throwable) {
            Log.w(TAG, "the Shizuku permission request failed", error)
        } finally {
            Shizuku.removeRequestPermissionResultListener(listener)
        }
        notifyStateChanged()
        return granted.get()
    }

    override fun addStateListener(listener: RemoteAccessPermissionBackend.Listener) {
        observeState()
        listeners += listener
    }

    override fun removeStateListener(listener: RemoteAccessPermissionBackend.Listener) {
        listeners -= listener
    }

    /** Watch the binder so a Shizuku restart is noticed without polling it */
    private fun observeState() {
        if (!observing.compareAndSet(false, true)) return
        runCatching {
            Shizuku.addBinderReceivedListenerSticky {
                Log.i(TAG, "the Shizuku binder arrived")
                notifyStateChanged()
            }
            Shizuku.addBinderDeadListener {
                Log.w(TAG, "the Shizuku binder died")
                notifyStateChanged()
            }
        }.onFailure { Log.w(TAG, "could not watch Shizuku's binder", it) }
    }

    private fun notifyStateChanged() {
        listeners.forEach { listener ->
            runCatching { listener.onStateChanged(backend) }
                .onFailure { Log.w(TAG, "a Shizuku state listener threw", it) }
        }
    }

    private const val TAG = "ShizukuAccess"

    /** Shizuku echoes it back, so any value works as long as it is this app's */
    private const val REQUEST_CODE = 4321

    /** Long enough for a human to read Shizuku's dialog and answer it */
    private const val PERMISSION_TIMEOUT_SECONDS = 60L
}
