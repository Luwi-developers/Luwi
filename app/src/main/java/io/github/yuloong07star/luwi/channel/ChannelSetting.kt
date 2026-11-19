package io.github.yuloong07star.luwi.channel

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

    /**
     * 重新确认两条路现在在哪一档 (2.8.1 #30 改口径: 2026-11-19 主人「不要那个开关, 换成刷新状态按钮」)
     *
     * 点这一下就是主人的明确表态 —— 只在**这一次刷新期间**允许 root 被问一次 (`optedIn` 一过性置真),
     * 问完立刻收回, **不落盘**: 首启仍然一声不响 (那是 #30 保住的那半), 而"我想让它试一次"这句话由
     * 按钮说, 不靠一个常驻开关记着
     *
     * 顺序照 [PrivilegedChannel] 那份 routes: **Shizuku 在前, root 在后** —— 已经把活干着的机器不会
     * 再去碰 root 管理器 (`ensure()` 里 `live()` 先短路)
     *
     * @param done 读完状态之后在 worker 线程上回调
     */
    fun reprobe(done: () -> Unit = {}) {
        if (working) return
        working = true
        worker.execute {
            RootAccessBackend.optedIn = true
            try {
                PrivilegedChannel.ensure()
            } catch (error: Throwable) {
                Log.w(TAG, "re-reading the privileged channel failed", error)
            } finally {
                // 这一拍的许可用完就还: 下一次 ensure() 不该自己又去打扰 root 管理器
                RootAccessBackend.optedIn = false
            }
            read()
            working = false
            done()
        }
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
        state = PrivilegedChannel.state()
        // 顺序与 [PrivilegedChannel] 那份 routes 一致: **Shizuku 先, root 后** (主人 2026-11-19
        // "优先 shizuku") —— 界面读数的先后跟着实际尝试的先后走, 两处不会一个说 A 一个说 B
        routes = listOf(
            RouteState(
                backend = ShizukuAccessBackend.backend,
                available = ShizukuAccessBackend.isAvailable(),
                granted = ShizukuAccessBackend.isGranted(),
            ),
            RouteState(
                backend = RootAccessBackend.backend,
                available = RootAccessBackend.isAvailable(),
                granted = RootAccessBackend.rootState(),
            ),
        )
        // 通道真的通了就把"默认允许无障碍"那一趟走一次 (2.7.9 第 7 条): 记号管着只开一次, 这里只负责
        // 时机 —— 刚在 KernelSU / Shizuku 里给完授权、点连接之后那一趟也走得到
        if (state?.connected == true) AccessibilitySetting.autoEnableOnce()
    }
}
