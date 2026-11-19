package io.github.yuloong07star.luwi.channel

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.concurrent.Executors

/**
 * One way of reaching a privileged process, and where it stands right now
 *
 * @property backend which route this is
 * @property available whether the route could exist at all - for root that is "already granted, or
 *   the user has turned on `connect with root`" (2.8.1 #30), not "granted", because a route that
 *   was never asked for is not a missing one
 * @property granted `true` when the permission is in place, `false` when it was asked for and was
 *   not given, and `null` when nothing has asked yet - only root can be `null`, because Shizuku
 *   answers the question without being tried
 */
data class RouteState(
    val backend: RemoteBackend,
    val available: Boolean,
    val granted: Boolean?,
)

/**
 * The privileged channel, for the settings page
 *
 * Step 3 deliberately left this without a UI - the tools were the only consumers, and `lw_probe`
 * was the only way to see whether the channel was up. What that costs is the first run: a fresh
 * install shows nothing but tools failing, and nothing on the phone says which of root and Shizuku
 * is missing or where to allow it. Hence this: the state of the channel, what each route is still
 * waiting for, and one button that tries
 *
 * Everything that asks the system runs on a thread of its own. The first connection is where
 * KernelSU puts its prompt up, and Shizuku puts its own dialog up, so the try can take a minute -
 * which on a main thread is an ANR rather than a wait
 */
object ChannelSetting {

    private const val TAG = "LwChannel"

    /** 与 [io.github.yuloong07star.luwi.host.HostSettings] / `PreviewControl` 同一个偏好文件, 全 app 一个 */
    private const val STORE = "luwi"

    /**
     * 「用 root 连接」那个开关的落点 (2.8.1 #30)
     *
     * 关着 = root 那条路一声不响 (首启就是这样), 点开才允许它去要一次授权. 这是"现在能不能要授权",
     * 与"这条路在不在" ([RouteState.available]) 是两个判断; 界面那份读数由 [readRootOptedIn] 直接取
     */
    private const val ROOT_OPT_IN = "channel-root-opt-in"

    /** One call at a time, since they all ask the same two backends */
    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "lw-channel-ui").apply { isDaemon = true }
    }

    /** Whether a connection attempt is in flight, including however long a prompt stays up */
    var working: Boolean by mutableStateOf(false)
        private set

    /**
     * What the channel is, or null before it has been read
     *
     * Not read at construction: that would be a binder round trip on whichever thread happened to
     * touch this first, which is the thread drawing the first frame
     */
    var state: ChannelState? by mutableStateOf(null)
        private set

    /** Both routes in the order the channel tries them, root first */
    var routes: List<RouteState> by mutableStateOf(emptyList())
        private set

    /** Read the state once, without connecting anything and without any prompt */
    fun refresh() {
        worker.execute { read() }
    }

    /** 磁盘上那个选择, 界面第一帧读它 (没有这个键 = 不许要授权) */
    fun readRootOptedIn(context: Context): Boolean =
        preferences(context).getBoolean(ROOT_OPT_IN, false)

    /**
     * 拨「用 root 连接」: 先落盘再动通道, 点开的那一趟顺带要一次授权
     *
     * 关掉只是不再去问, 已经连上的 root 不动 —— 授权在 root 管理器那边, 这里只管"要不要开口".
     * 点开时走 [connect]: 它本来就在 worker 线程上, 而且有 [working] 这道闸
     */
    fun setRootOptedIn(context: Context, optedIn: Boolean, done: () -> Unit = {}) {
        RootAccessBackend.optedIn = optedIn
        preferences(context).edit().putBoolean(ROOT_OPT_IN, optedIn).apply()
        if (optedIn) connect(done) else refresh()
    }

    /**
     * Try to connect, which is also how a permission is asked for on the route that needs one
     *
     * @param done called back on the worker thread once the state has been read again
     */
    fun connect(done: () -> Unit = {}) {
        if (working) return
        working = true
        worker.execute {
            try {
                PrivilegedChannel.ensure()
            } catch (error: Throwable) {
                Log.w(TAG, "connecting the privileged channel failed", error)
            }
            // A failure is not lost by not being kept here: the channel remembers why, and
            // [read] puts that reason straight into the state
            read()
            working = false
            done()
        }
    }

    /** Ask both routes where they stand, on the worker thread */
    private fun read() {
        // 开关的落点在磁盘上, 进程刚起来时内存里那份还是缺省 false —— 先回填, 再问两个问题
        PrivilegedChannel.context()?.let { app ->
            RootAccessBackend.optedIn = readRootOptedIn(app)
        }
        state = PrivilegedChannel.state()
        routes = listOf(
            RouteState(
                backend = RootAccessBackend.backend,
                available = RootAccessBackend.isAvailable(),
                granted = RootAccessBackend.rootState(),
            ),
            RouteState(
                backend = ShizukuAccessBackend.backend,
                available = ShizukuAccessBackend.isAvailable(),
                granted = ShizukuAccessBackend.isGranted(),
            ),
        )
        // 通道真的通了就把"默认允许无障碍"那一趟走一次 (2.7.9 第 7 条): 记号管着只开一次, 这里只负责
        // 时机 —— 刚在 KernelSU / Shizuku 里给完授权、点连接之后那一趟也走得到
        if (state?.connected == true) AccessibilitySetting.autoEnableOnce()
    }

    private fun preferences(context: Context): SharedPreferences =
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
}
