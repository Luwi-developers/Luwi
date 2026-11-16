package io.github.yuloong07star.luwi.tool

import android.app.ActivityManager
import android.content.Context
import android.util.Log
import io.github.yuloong07star.luwi.R

/**
 * 她说的一句也要弹到手机的通知栏 (2.8.1 落实表 #7)
 *
 * 门户与浮球读的是同一份 `$DSH_HOME/lw/out/<sessionId>.jsonl` (见 [OutFile]), 这里是**第三个听众**:
 * 同一个 [OutWatch] 观察者、同一份解析, 于是"她说了什么"这件事照旧由文件说了算 —— 通知只是它的另一种
 * 呈现: 应用不在前台时, 主人不看那一屏也能知道她说了一句
 *
 * 四条分寸:
 *
 * 1. **只在应用不在前台时弹**: 前台那一屏本来就画着这句话 (门户盖着, 或者那一场 dsh 会话就在眼前),
 *    再弹一条只是噪音。判据是 `getMyMemoryState` 的 importance —— 那是公开 API 问自己, 不是猜
 * 2. **首拍只记水位**: 进程起来时把目录里那几场的 `max` 记下, 历史一条都不补 —— 冷启动一次就把昨天
 *    那几十句全弹出来, 是这一层最容易变成灾难的写法
 * 3. **变化事件里第一次见到的一场算"新会话"**: 与球那一侧同一档, 从 `max - 1` 取最后一条, 不整场跳过
 *    (整场跳过的话, 新会话的第一句永远不弹)
 * 4. **可读的那几行才弹**: `kind=text` 看正文; 图与文件没有正文时写一句代称; 表情那行的 `text` 是
 *    门户用的占位符 `[…]`, 原样写出去等于什么都没说, 所以取表情名
 */
internal object OutNotify {

    private const val TAG = "LwNotify"

    /** 每一场读到哪了 (与浮球那一份水位分开记: 两个听众各读一份, 水位不该互相拖) */
    private val marks = HashMap<String, Int>()

    /** 挂上那个听众 ("摘掉它"的函数, 这里只当记号: 非空就是挂过了) */
    private var outWatch: (() -> Unit)? = null

    /**
     * 挂上 (幂等), 由宿主服务起来那一下调一次
     *
     * **先记水位再挂**: 进程刚起来时把那几场的 `max` 记下, 于是历史一条都不补。中间那一瞬里写下的一行
     * 会漏掉 (毫秒级), 那是这一层刻意选的方向 —— 少弹一条, 好过把整份历史弹一遍
     */
    fun ensure(context: Context) {
        if (outWatch != null) return
        val app = context.applicationContext
        synchronized(marks) {
            for (id in OutFile.sessions(app)) marks[id] = OutFile.maxSeq(app, id)
        }
        outWatch = OutWatch.watch(app) { changed ->
            // 回调在 FileObserver 自己那条线程上: 读文件与发通知都能在这一条上做, 不用再往主线程投
            runCatching { drain(app, changed) }.onFailure {
                Log.w(TAG, "the notification for what she said did not go out: ${it.message}")
            }
        }
    }

    /**
     * 读一次增量, 把新说的那几句弹出去
     *
     * @param changed 变的那一场 (空串 = 起来那一拍, 只记水位)
     */
    private fun drain(context: Context, changed: String) {
        val startup = changed.isEmpty()
        val ids = if (startup) OutFile.sessions(context) else listOf(changed)
        val importance = importance()
        for (id in ids) {
            val mark = watermark(context, id, startup) ?: continue
            val page = OutFile.page(context, id, mark)
            if (page.max <= mark) continue
            // **先推进水位再看要不要弹**: 前台那一屏已经画过的那几句不该在切出去之后补弹一遍
            synchronized(marks) { marks[id] = page.max }
            if (!wants(importance)) continue
            val title = title(context)
            for (line in page.lines) {
                if (!sayable(line)) continue
                if (LwNotify.say(context, id, line.seq, line.at, title, body(context, line))) {
                    Log.i(TAG, "posted a notification for $id seq ${line.seq}")
                }
            }
        }
    }

    /**
     * 这一场读到哪了 (顺手把第一次见到的记上)
     *
     * 起来那一拍只记 `max` 并回 null (这一场这拍不看); 变化事件里第一次见到的一场可能是新会话的第一条
     * —— 与球那一侧同一档, 从 `max - 1` 取最后一条, 不整场跳过
     *
     * @return 从哪一行之后开始读; null = 这一场这拍不看
     */
    private fun watermark(context: Context, id: String, startup: Boolean): Int? {
        synchronized(marks) { marks[id] }?.let { return it }
        val max = OutFile.maxSeq(context, id)
        val next = if (startup) max else (max - 1).coerceAtLeast(0)
        synchronized(marks) { marks[id] = next }
        return if (startup) null else next
    }

    /**
     * 这一行值不值得弹 (纯函数, 单测钉住)
     *
     * `voice` 只由底层的 `lw_speak` 用, 模型侧不出现, 但它同样是"一句可读的话"
     */
    fun sayable(line: OutFile.Line): Boolean = when (line.kind) {
        "text", "voice" -> line.text.isNotBlank()
        "sticker" -> line.sticker.isNotBlank()
        "image", "file" -> true
        else -> false
    }

    /**
     * 此刻该不该弹 (纯函数, 单测钉住)
     *
     * **应用在前台 (或更重要) 就不弹**: 那一屏本来就画着这句话。`IMPORTANCE_FOREGROUND_SERVICE` 正是
     * "应用在后台、前台服务还活着"那一档 —— 也就是说这一档要弹, 而那恰恰是宿主常驻时的常态
     *
     * @param importance `getMyMemoryState` 给出的这一进程的 importance
     */
    fun wants(importance: Int): Boolean =
        importance > ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND

    /** 通知标题: 门户那张脸上那个名字, 没设过就是应用名 */
    private fun title(context: Context): String =
        PortalFace.face(context).name.ifBlank { context.getString(R.string.app_name) }

    /**
     * 一条通知里写什么
     *
     * 有字就写那几个字 (图与文件带正文时也是正文); 没字的写一句代称, 文件带上名字
     */
    fun body(context: Context, line: OutFile.Line): String = when {
        line.kind == "sticker" -> context.getString(R.string.notification_speech_sticker, line.sticker)
        line.text.isNotBlank() -> line.text
        line.kind == "file" && line.name.isNotBlank() ->
            context.getString(R.string.notification_speech_file_named, line.name)
        line.kind == "file" -> context.getString(R.string.notification_speech_file)
        else -> context.getString(R.string.notification_speech_image)
    }

    /**
     * 这一进程此刻在系统眼里算什么
     *
     * 读不动时按"在前台"算: 弹不出去只丢一条通知, 而猜错的另一个方向是"跟着她每句都弹一条"
     */
    private fun importance(): Int = runCatching {
        val state = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(state)
        state.importance
    }.getOrDefault(ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND)
}
