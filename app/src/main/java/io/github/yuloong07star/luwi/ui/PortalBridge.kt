package io.github.yuloong07star.luwi.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.yuloong07star.luwi.host.DshHost
import io.github.yuloong07star.luwi.tool.LwIn
import io.github.yuloong07star.luwi.tool.OutFile
import io.github.yuloong07star.luwi.tool.OutPaths
import io.github.yuloong07star.luwi.tool.OutWatch
import io.github.yuloong07star.luwi.tool.PortalFace
import io.github.yuloong07star.luwi.tool.RouterChecks
import io.github.yuloong07star.luwi.tool.RouterTick
import io.github.yuloong07star.luwi.tool.SimSetting
import io.github.yuloong07star.luwi.voice.VoiceInbox
import io.github.yuloong07star.luwi.workspace.Workspace
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 门户开着没有, 以及"让页面收起 / 打开"的那条 JS 入口
 *
 * 两侧共用这一份: 页面在挂载与收起时报 `portalVisible`, 菜单 (右上那颗 Tune) 读 `open` 决定显示
 * "回到 dsh"还是"回到对话层", 点了就走 `run` 那一条 `evaluateJavascript`
 *
 * **界面上不放这两颗按钮** (2026-11-07 主人: "和返回 dsh 这些都加到 luwi 菜单里, 不放界面上"),
 * 所以这两个动作只有菜单一个入口
 */
internal object PortalState {
    /** 门户是不是盖在上面; 页面每次挂载/收起都会报一次 */
    var open by mutableStateOf(false)

    /**
     * 键盘那一格 (dp, 已减掉导航条; WebView 里 1 CSS px = 1 dp)
     *
     * 门户盖着时 **WebView 尺寸不动**: 让位改由页面自己做 (`--lwp-ime`), 于是背景图、头栏、底下
     * 那一屏 dsh 一个像素都不重排。这一笔是"最近一次推给页面的高度", 页面刷新 / 收起再张之后由
     * `LuwiPortal.portalIme()` 来问 (那一次正好错过了"变了才推"的那一下)
     *
     * 门户收起时写 0 (dsh 那一屏仍走旧的缩 WebView 那条路, 与它无关)
     */
    @Volatile
    var imePx: Int = 0

    /** 页面就绪时由 HostScreen 装上, 每次文档加载都重挂一次 */
    var run: ((String) -> Unit)? = null

    /** 她说的话那份文件变了就推一下 (只装一次; 与球共用同一个 observer, 见 [OutWatch]) */
    private var watching: (() -> Unit)? = null

    /**
     * 事件驱动: `lw/out` 下那份 jsonl 一变就让页面自己去取增量
     *
     * jsonl **不是** dsh 的快照, `chatTarget.subscribe` 不会因为它变化而触发 —— 一轮工具跑完、或者她
     * 主动开口时, 门户根本不会重画, 那些话就永远不上屏 (方案 §3.4「触发源」那一条)。所以走
     * `evaluateJavascript`, 与 Luwi 菜单那两条同一个入口
     */
    fun ensureWatch(context: Context) {
        if (watching != null) return
        watching = OutWatch.watch(context.applicationContext) {
            // 回调在 FileObserver 自己那条线程上: `evaluateJavascript` 必须在主线程
            val script = "window.__LUWI_PORTAL__ && window.__LUWI_PORTAL__.onOut" +
                " && window.__LUWI_PORTAL__.onOut()"
            val main = Handler(Looper.getMainLooper())
            // false = 主线程已经收摊 (退出中), 那就不推了
            main.post { run?.invoke(script) }
            Unit
        }
    }
}

/**
 * 门户那一层要的那几件事: 读判断层与工作结构, 写"球的那一场"的账, 敲一下钟
 *
 * **为什么在 app 这一侧**: `$DSH_HOME/lw` 下那几份 json 与 `$DSH_HOME/voice` 都在 app 沙盒里, 浏览器
 * 里的 JS 一个字节都碰不到 (WebView 拿到的是 host 发出来的那几个 http 响应), 而宿主插件那一侧只给
 * 页面开了一条**只读的图路由** (`/lw-out/assets`, 见 host-plugin 的 `serveLwOut`) —— 于是这一层走
 * `window.LuwiPortal` 那座桥 (与 [WakeBridge] 同一条信任边界: 页面就是本机 host 发的那个, 见
 * HostScreen 的 shouldOverrideUrlLoading)
 *
 * **三条分寸**:
 *
 * 1. **只读判断层, 不重算**: 该不该开口、为什么不说, 全是宿主 `judgeRouter` 判完落在 `router.json`
 *    的 `last` 上; 这里原样搬给页面, 于是界面上那句 `why` 与宿主真的判过的那一次逐字一致
 * 2. **动作只走已有入口**: 敲钟 = 往收件箱投一行 `source:"router"` (与 `RouterTick` 定时敲的是同一行),
 *    开探索 = 投一行 `source:"explore"`, 开关 = `RouterTick.setEnabled` —— 不新增第二条判断链路
 * 3. **写账与宿主同格式**: `voice/session.json` 是 `{id, at, origin, cwd}`, 宿主 `voiceCurrentSession()`
 *    只在 `cwd` 落在 `dsh-ball` 底下时认它 ([VOICE_SESSION_MS] 那 10 分钟也在那边), 所以这里写的是
 *    同一个形状、同一个 cwd
 */
internal class PortalBridge(private val context: Context) {

    /**
     * 桥一建起来就把"她说的话变了"那条通知接上 (幂等; 见 [PortalState.ensureWatch])
     *
     * 放在这里而不是 HostScreen: 门户与球**共用**同一个 `FileObserver`, 谁先起来都不会重复起第二个
     */
    init {
        runCatching { PortalState.ensureWatch(context) }
    }

    // ── 读 ────────────────────────────────────────────────────────────────────

    /** 判断层与工作结构的一次快照 (页面照着画, 不做合并判断) */
    @JavascriptInterface
    fun portalStatus(): String {
        val router = readJson(lwFile("router.json")) ?: JSONObject()
        val sim = readJson(lwFile("sim.json")) ?: JSONObject()
        val explore = readJson(lwFile("explore.json")) ?: JSONObject()
        val schedule = readJson(lwFile("explore-schedule.json")) ?: JSONObject()

        val rules = JSONObject()
        val hostRules = router.optJSONObject("rules")
        if (hostRules != null) {
            val names = hostRules.keys()
            while (names.hasNext()) {
                val name = names.next()
                rules.put(name, hostRules.opt(name))
            }
        }
        // 判断层的阈值有两处来源: router.json 的 rules 与 sim.json 的 router 段 (宿主读的时候后者覆盖前者)
        val simRules = sim.optJSONObject("router")
        if (simRules != null) {
            val names = simRules.keys()
            while (names.hasNext()) {
                val name = names.next()
                rules.put(name, simRules.opt(name))
            }
        }

        val wake = sim.optJSONObject("wake")
        // 静默窗口有两处来源: `sim.json` 的 `wake` 段 (设置 → 活动 → 更多设置) 优先, 没写就回落到
        // `automations/settings.json` 的 `quiet` —— 与宿主 `readRouterInputs` 的那一段同一条规则
        val automationSettings = readJson(homeFile("automations/settings.json"))
        val automationQuiet = automationSettings?.optJSONObject("quiet")
        val quiet = JSONObject().apply {
            val simFrom = wake?.optString("quietFrom").orEmpty()
            val simTo = wake?.optString("quietTo").orEmpty()
            if (simFrom.isNotEmpty() || simTo.isNotEmpty()) {
                put("enabled", wake?.optBoolean("quietEnabled") ?: true)
                put("from", simFrom)
                put("to", simTo)
            } else {
                put("enabled", automationQuiet?.optBoolean("enabled") ?: false)
                put("from", automationQuiet?.optString("window").orEmpty())
                put("to", "")
            }
        }

        val body = JSONObject().apply {
            put("now", System.currentTimeMillis())
            put("router", JSONObject().apply {
                put("last", router.optJSONObject("last") ?: JSONObject())
                put("rules", rules)
                put("quiet", quiet)
                put("lastSpokenAt", router.optLong("lastSpokenAt", 0L))
                put("checks", router.optJSONArray("checks") ?: JSONArray())
                put("tick", JSONObject().apply {
                    put("enabled", RouterTick.enabled(context))
                })
            })
            put("explore", JSONObject().apply {
                put("nextTask", explore.optString("nextTask").orEmpty())
                put("lastSummaryAt", explore.optLong("lastSummaryAt", 0L))
                put("schedule", schedule.optString("time").orEmpty())
            })
            // 「正在做」那一行: 与球上那三个字**同一份** `lw/ball-phase.json` (方案 §3.4 末段: 复用,
            // 不要另造)。门户只在流末尾画一句"正在做…", 长 turn 才不像卡死
            put("phase", JSONObject().apply {
                val turns = readJson(lwFile("ball-phase.json"))?.optJSONArray("turns") ?: JSONArray()
                put("thinking", turns.length() > 0)
                put("count", turns.length())
            })
        }
        return body.toString()
    }

    /**
     * 球那一场: 账本原文 + 它还算不算数 + 还剩多久
     *
     * `usable` 的判法是宿主 `voiceCurrentSession()` 的同一条: id 在、没超 [VOICE_SESSION_MS]、
     * cwd 落在 `dsh-ball` 底下 —— 判定放在页面那一侧做也行, 但两处算一次更省事, 页面按这个字段显示
     */
    @JavascriptInterface
    fun portalSession(): String {
        val ledger = readJson(homeFile("voice/session.json")) ?: JSONObject()
        val now = System.currentTimeMillis()
        val id = ledger.optString("id").orEmpty()
        val at = ledger.optLong("at", 0L)
        val cwd = ledger.optString("cwd").orEmpty()
        val ball = ballWorkspace()
        // 宿主那一侧比之前先过 realpath (`canonicalVoicePath`): 影子会话写的是 `/data/data/…` 而
        // `DSH_HOME` 在 `/data/user/0/…`, 所以这里也拿 canonicalPath 比, 否则会把合法的一本账判成过期
        val ballPath = runCatching { ball.canonicalPath }.getOrDefault(ball.path)
        val fresh = id.isNotEmpty() && at > 0L && now - at <= VOICE_SESSION_MS
        val inside = cwd.isNotEmpty() && (cwd == ballPath || cwd.startsWith("$ballPath/"))
        val usable = fresh && inside
        return JSONObject().apply {
            put("id", id)
            put("at", at)
            put("cwd", cwd)
            put("now", now)
            put("remainMs", if (fresh) VOICE_SESSION_MS - (now - at) else 0L)
            put("usable", usable)
            put("workspace", BALL_WORKSPACE)
            put("workspacePath", ballPath)
        }.toString()
    }

    /**
     * 「Luwi」工作区那个目录 (2.8.0 #37): 门户在"一个工作区都没有"时靠它把目录备好
     *
     * 为什么不让 dsh 自己去建: 它那条首启缺省工作区落在 `<系统 Documents>/deepseek-harness/default-workspace`,
     * 安卓上 `system Documents directory is unavailable` 必失败, 于是首启停在空态。工作区目录本来就由
     * 应用三档解析 (见 `Workspace.resolve`), 这里只是把同一份事实交给门户: 目录在不在, 以及要不要建
     *
     * @param make 目录不在时建它 (`mkdirs`), 只在人点了「选工作区」之后才传 true
     * @returns `{path, exists}` —— `path` 是绝对路径, `exists` 是建完之后它真的是个目录
     */
    @JavascriptInterface
    fun portalWorkspace(make: Boolean): String {
        val directory = channelWorkspace()
        var exists = directory.isDirectory
        if (!exists && make) exists = directory.mkdirs() || directory.isDirectory
        return JSONObject().apply {
            put("path", directory.absolutePath)
            put("exists", exists)
        }.toString()
    }

    /** 门户开着还是收起了: 菜单那一项靠它换方向 */
    @JavascriptInterface
    fun portalVisible(on: Boolean) {
        PortalState.open = on
    }

    /**
     * 键盘那一格: 页面挂载时问一次 (2026-11-09)
     *
     * 宿主只在**高度变了**的时候推 `setKeyboard`, 而页面刷新 / 收起再张之后那一下正好错过了 ——
     * 于是挂载时先来问一次, 拿到的就是"现在该让出多少"。取不到时页面按 0 处理
     *
     * @return `{"px": n}` (px = ime - nav, 与 Kotlin 那一侧推的是同一个数)
     */
    @JavascriptInterface
    fun portalIme(): String = JSONObject().put("px", PortalState.imePx).toString()

    /**
     * 页面报"这张图没发出去" (落实表 #35, 2026-11-12)
     *
     * 只做一件事: 把原因与**机型 + WebView 版本各一行**写进 logcat。issue #53 里用户在群里报
     * "选图 → 点确定 → 没反应" 时, 维护者手上就只有这三样能对上 —— 机型读 `Build`, 版本读
     * [WebCompat.info] (与开屏那行 `webview …` 同一份读数)
     *
     * **为什么三样都由页面报**: 三种原因里两种 (`文件过大` / `上传超时`) 只有页面知道; 第三种
     * (`webview 未回调`) 也是页面在计时器到点后报的 —— 一条口径, 不必在两边各写一遍
     * @param reason 页面给的那句话 ('webview 未回调' / '文件过大' / '上传超时')
     * @return `{ok:true}` (页面不看, 留给将来对账)
     */
    @JavascriptInterface
    fun portalImageFail(reason: String): String {
        val text = reason.trim().ifEmpty { UNKNOWN_FAIL }
        Log.w(LOOK_TAG, "image send failed: $text")
        Log.i(
            LOOK_TAG,
            "device ${Build.MANUFACTURER} ${Build.MODEL}, android ${Build.VERSION.RELEASE}" +
                " (sdk ${Build.VERSION.SDK_INT})",
        )
        val info = runCatching { WebCompat.info(context.applicationContext) }.getOrNull()
        // 读不到版本就照实说 "unknown": 那一行是给人拿去对账的, 空着比写错更糟
        val label = info?.label.orEmpty().ifEmpty { UNKNOWN_FAIL }
        Log.i(LOOK_TAG, "webview $label (major ${info?.major ?: 0})")
        return JSONObject().put("ok", true).toString()
    }

    /**
     * 这一层的脸: 背景图与背景的不透明度 (2026-11-08 主人)
     *
     * **图只能从这座桥过去**: WebView 里的页面是 http 那一片, 够不到 app 沙盒里的文件, 而宿主又不给
     * 页面开自定义路由 (见类注释), 所以这里把图编成 data URL 一起交出去。一次几百 KB, 页面按 `ver`
     * 缓存, 换一张才搬一次
     *
     * @param wantWall true 才编那张图; 只要读数 (与"图换没换") 时传 false, 一次几十字节 —— 重挂门户
     *   每次都会问一次, 不该每次都搬几万字
     */
    @JavascriptInterface
    fun portalLook(wantWall: Boolean): String {
        val face = PortalFace.face(context)
        val wall = if (wantWall) PortalFace.dataUrl(context).orEmpty() else ""
        // 头像与背景同一条规矩: 读数随时给, 图只在 wantWall 那一次搬 (2026-11-10 加的两样)
        val avatar = if (wantWall) PortalFace.avatarDataUrl(context).orEmpty() else ""
        // 一行读数: 背景为什么没上屏时, 这一行能分清"没配"与"配了但没搬过去"
        Log.i(
            LOOK_TAG,
            "portalLook alpha=${face.alpha} ver=${face.wall.ifEmpty { "-" }} wantWall=$wantWall" +
                " wall=${wall.length} name=${face.name.ifEmpty { "-" }}" +
                " avatarVer=${face.avatar.ifEmpty { "-" }} avatar=${avatar.length}",
        )
        return JSONObject().apply {
            put("alpha", face.alpha)
            put("wall", wall)
            put("ver", face.wall)
            put("name", face.name)
            put("avatar", avatar)
            put("avatarVer", face.avatar)
        }.toString()
    }

    // ── 写 ────────────────────────────────────────────────────────────────────

    /**
     * 她说的话: `next <= 0` 回**全量**, 否则只回 `seq > next` 的尾巴 (方案 §3.4 的「两段水位」)
     *
     * 为什么两段都要: 打开 / 换会话时得拿全量 (直接画、不排队, 否则打开旧会话像逐条慢放); 之后只取
     * 增量 (否则每次重开应用、收起再开, 门户都是空的)。返回里带着 `max` —— 页面拿它把水位推到文件尾,
     * 于是"历史已画完"与"新的才开始排队"这两件事分得开
     *
     * 解析只走 [OutFile] 那一处 (与浮球读的是同一份代码), 于是"门户 5 条、球 3 条"不会因为两边各写一份
     * `split` 而出现
     */
    @JavascriptInterface
    fun portalOut(id: String, next: Int): String {
        val page = OutFile.page(context, id, next)
        val lines = JSONArray()
        for (line in page.lines) lines.put(line.toJson())
        return JSONObject().apply {
            put("session", page.session)
            put("next", page.next)
            put("max", page.max)
            put("lines", lines)
        }.toString()
    }

    /**
     * 把这一场记成"球的那一场"
     *
     * 门户里发的第一句之后调一次: 于是球接下来 10 分钟内说的话接的也是这一场, 两边看到同一个流
     * (宿主的 `voiceSessionBump` 只对球自己那一句记账, 门户这一侧没有别的路能写这本账)
     */
    @JavascriptInterface
    fun portalBind(id: String): String {
        val wanted = id.trim()
        if (wanted.isEmpty() || wanted.length > SESSION_ID_MAX) return portalSession()
        val ball = ballWorkspace()
        val cwd = runCatching { ball.canonicalPath }.getOrDefault(ball.path)
        val record = JSONObject().apply {
            put("id", wanted)
            put("at", System.currentTimeMillis())
            put("origin", "ball")
            put("cwd", cwd)
        }
        runCatching {
            val file = homeFile("voice/session.json")
            file.parentFile?.mkdirs()
            file.writeText("$record\n")
        }
        return portalSession()
    }

    /** 敲一下钟: 与 `RouterTick` 定时投的那一行同源, 判断与开口都在宿主那一侧 */
    @JavascriptInterface
    fun portalTick(): String {
        val seq = runCatching { VoiceInbox.append(context, TICK_TEXT, source = VoiceInbox.SOURCE_ROUTER) }.getOrNull()
        RouterTick.ensure(context)
        return JSONObject().apply {
            put("queued", seq != null)
            put("seq", seq ?: 0L)
        }.toString()
    }

    /** 开关那一份: 写回 `router.json` 的 `tick.enabled` (缺省关, 打开后 25-55 分钟不定长敲一次) */
    @JavascriptInterface
    fun portalTickEnabled(on: Boolean): String {
        RouterTick.setEnabled(context, on)
        return portalStatus()
    }

    /** 一条检测项处理掉了: 从 `router.json` 的 `checks` 里摘掉 (与设置页那一栏写的是同一份) */
    @JavascriptInterface
    fun portalCheckDone(id: String): String {
        val wanted = id.trim()
        if (wanted.isNotEmpty()) RouterChecks.drop(context, wanted)
        return portalStatus()
    }

    /** 开始这一趟探索: 投一行 `source:"explore"`, 正文就是 `explore.json` 排好的那个 nextTask */
    @JavascriptInterface
    fun portalExplore(): String {
        val explore = readJson(lwFile("explore.json")) ?: JSONObject()
        val task = explore.optString("nextTask").orEmpty().trim().ifEmpty { DEFAULT_EXPLORE_TEXT }
        val seq = runCatching { VoiceInbox.append(context, task, source = VoiceInbox.SOURCE_EXPLORE) }.getOrNull()
        return JSONObject().apply {
            put("queued", seq != null)
            put("seq", seq ?: 0L)
            put("task", task)
        }.toString()
    }

    /**
     * 主人从门户传上来一个文件 (`+` 那颗, 2026-11-08)
     *
     * **为什么不走 dsh 自己的 attachment 上传**: 那条链在安卓上必然失败 —— `dsh-attachment-local`
     * 落盘前会把目标目录的每一层祖先 `open()` + `fsync()` 一遍 (它要证明"目录项已经落盘"), 而
     * 安卓的 DAC 不让应用打开 `/data/user/0`、`/storage/emulated` 这种祖先目录, 真机读数就是
     * `EACCES: permission denied, open '/data/user/0'`。所以这一条改成**落到她看得见的地方**:
     * `$DSH_HOME/lw/up/<名字>`, 她在对话里用 fs 工具直接读 (`read_image` 也认这个路径)。
     *
     * 入参是一段 JSON (`{name, data}`, `data` 是 base64): 桥上一个方法一个字符串参数最省事。
     *
     * **落盘那几条规矩现在只有一处实现** (`tool/LwIn`): 球输入框那个 `+` 走的是同一个函数
     * (2026-11-09 主人: "ball 时的输入框那个加号改成与门户时 + 同功能") —— 两处各写一份 basename /
     * 白名单 / 顺延 / 读回, 迟早漂。这里只剩"解 base64"与"把结果说成一句话"
     */
    @JavascriptInterface
    fun portalStash(payload: String): String {
        fun fail(reason: String): String = JSONObject().apply {
            put("ok", false)
            put("error", reason)
        }.toString()
        val body = runCatching { JSONObject(payload) }.getOrNull() ?: return fail("传上来的不是一段 JSON")
        val rawName = body.optString("name", "").trim()
        val data = body.optString("data", "")
        if (rawName.isEmpty() || data.isEmpty()) return fail("名字或内容缺了")
        val bytes = runCatching { android.util.Base64.decode(data, android.util.Base64.DEFAULT) }.getOrNull()
            ?: return fail("内容解不开")
        // **落在工作区里**: dsh 的读图/读文件工具只认工作区与完全权限那一片, 落在 `$DSH_HOME` 里她
        // 读不动 (2026-11-08 真机: "图我打不开, 这台的看图通道给我报权限错")。`lw-in` 就放在工作区根下
        val result = LwIn.put(Workspace.resolve(context).directory, rawName, bytes)
        val pick = result.pick ?: return fail(result.error)
        return JSONObject().apply {
            put("ok", true)
            put("path", pick.path)
            put("bytes", pick.bytes)
            put("name", pick.name)
        }.toString()
    }

    /**
     * 表情包目录里有哪几张 (2026-11-09 主人: "`+` 右边增加表情包图标, 点击弹出表情包选择")
     *
     * 读的就是 `$DSH_HOME/lw/stickers` —— 与宿主 `lw_sticker op=list`、`lw_say({sticker})` 认的是
     * **同一个目录**: 球上贴的、她说出来的、门户面板里列的永远是同一批文件, 不另造一份清单
     */
    @JavascriptInterface
    fun portalStickers(): String {
        val folder = lwFile("stickers")
        val names = runCatching {
            folder.listFiles()
                ?.filter { it.isFile && it.extension.lowercase() in STICKER_EXTS }
                ?.map { it.name }
                ?.sorted()
                .orEmpty()
        }.getOrDefault(emptyList())
        return JSONObject().apply {
            put("ok", true)
            put("names", JSONArray(names))
        }.toString()
    }

    /**
     * 主人往表情包里加一张 (同一个目录, 同一个白名单)
     *
     * 与 [portalStash] 同一套规矩: 只取 basename, 拒 `..` 与 NUL, 扩展名白名单, 同名顺延不覆盖,
     * 写完读回字节数对不上就不认这一份
     */
    @JavascriptInterface
    fun portalStickerAdd(payload: String): String {
        fun fail(reason: String): String = JSONObject().apply {
            put("ok", false)
            put("error", reason)
        }.toString()
        val body = runCatching { JSONObject(payload) }.getOrNull() ?: return fail("传上来的不是一段 JSON")
        val rawName = body.optString("name", "").trim()
        val data = body.optString("data", "")
        if (rawName.isEmpty() || data.isEmpty()) return fail("名字或内容缺了")
        if (rawName.contains('\u0000')) return fail("名字里有个非法字符")
        val name = File(rawName).name
        if (name.isEmpty() || name == "." || name == ".." || name.contains("..")) return fail("这不是一个文件名字")
        val dot = name.lastIndexOf('.')
        val ext = if (dot > 0) name.substring(dot + 1).lowercase() else ""
        if (ext !in STICKER_EXTS) return fail("表情只收 png / gif / webp / jpg: $name")
        val bytes = runCatching { android.util.Base64.decode(data, android.util.Base64.DEFAULT) }.getOrNull()
            ?: return fail("内容解不开")
        val cap = stickerCap()
        if (bytes.size > cap) {
            val mb = (bytes.size + 1024L * 1024L - 1L) / (1024L * 1024L)
            return fail("太大了: $mb MB, 一张表情最多 ${cap / (1024 * 1024)} MB")
        }
        val folder = lwFile("stickers")
        runCatching { folder.mkdirs() }
        // 张数上限 (2026-11-10 主人: "表情包加上数量限制"): 两个写入方 (这里与宿主 `op=fetch`) 同一个数
        val maxCount = stickerMaxCount()
        val present = runCatching {
            folder.listFiles()?.count { it.isFile && it.extension.lowercase() in STICKER_EXTS } ?: 0
        }.getOrDefault(0)
        if (present >= maxCount) {
            return fail("表情已经 $present 张了, 上限 $maxCount 张 (设置 → 活动 → 更多设置 → 表情); 先删几张再加")
        }
        val stem = name.substring(0, if (dot > 0) dot else name.length).take(64).ifEmpty { "sticker" }
        var target = File(folder, "$stem.$ext")
        var suffix = 2
        while (target.exists()) {
            target = File(folder, "$stem-$suffix.$ext")
            suffix += 1
        }
        val written = runCatching { target.writeBytes(bytes) }.isSuccess
        if (!written || !target.isFile || target.length() <= 0L) return fail("写不进去: ${target.name}")
        if (target.length() != bytes.size.toLong()) return fail("写歪了: ${target.name}")
        return JSONObject().apply {
            put("ok", true)
            put("name", target.name)
            put("bytes", target.length())
        }.toString()
    }

    /**
     * `lw/out` 里那一份的绝对路径 (2026-11-09 主人: "doc 这些文档打不开, 补一下")
     *
     * 门户手里只有行里的相对路径 (`assets/<id>/<名字>` / `in/<名字>`), 而交给系统 (那条
     * `luwi-open://` 通道, 见 `HostScreen.openWithSystem`) 要的是能读的绝对路径。**这里只做拼路**:
     * 能不能交出去仍由 `OpenFile.allowed` 判 (只放行工作区与 `$DSH_HOME` 之下)
     */
    @JavascriptInterface
    fun portalAbsPath(rel: String): String {
        val (file, why) = outTarget(rel)
        if (file == null) return refused(why)
        return JSONObject().apply {
            put("ok", true)
            put("path", file.absolutePath)
            put("name", file.name)
            put("bytes", file.length())
        }.toString()
    }

    /**
     * 把这一份的绝对路径放进系统剪贴板 (落实表 #41, 2026-11-13: "可选复制路径")
     *
     * 路径与 [portalAbsPath] 同一条拼法 (认 `assets/` 与 `in/` 两段, 挡 `..`); 复制这边放在 app
     * 侧, 因为 WebView 里的 `navigator.clipboard` 要有焦点、要算用户手势 —— 长按菜单点下来那一下
     * 不是每次都算数, 而系统剪贴板一定成
     */
    @JavascriptInterface
    fun portalCopyPath(rel: String): String {
        val (file, why) = outTarget(rel)
        if (file == null) return refused(why)
        val manager = context.getSystemService(ClipboardManager::class.java)
            ?: return refused("系统的剪贴板不在")
        runCatching {
            manager.setPrimaryClip(ClipData.newPlainText(CLIP_LABEL, file.absolutePath))
        }.getOrElse { return refused("剪贴板写不进去") }
        Log.i(LOOK_TAG, "copied path of ${file.name} (${file.length()} bytes)")
        return JSONObject().apply {
            put("ok", true)
            put("path", file.absolutePath)
            put("name", file.name)
        }.toString()
    }

    /** 一句"不成立"的回话 (页面照原话给 `showNote`) */
    private fun refused(reason: String?): String = JSONObject().apply {
        put("ok", false)
        put("error", reason ?: "这一份打不开")
    }.toString()

    /**
     * 行里那条相对路径 -> 一个真在的文件 (或者一句为什么不成)
     *
     * 认哪两段、挡 `..` 那一层在 [OutPaths] (没有设备也能量); 这里只补上"落在哪个根下"与
     * "它还在不在"
     */
    private fun outTarget(rel: String): Pair<File?, String?> {
        val lookup = OutPaths.lookup(rel)
        if (lookup is OutPaths.Lookup.Rejected) return null to lookup.reason
        val found = lookup as OutPaths.Lookup.Found
        val file = when (found.root) {
            OutPaths.ASSETS -> File(File(home(), "lw/out"), OutPaths.ASSETS + found.leaf)
            else -> File(LwIn.dir(Workspace.resolve(context).directory), found.leaf)
        }
        if (!file.isFile || file.length() <= 0L) return null to "这一份不在了"
        return file to null
    }

    /** 表情认的那几种 (与宿主 `lw_sticker op=list` 那张正则同一个集合) */
    private val STICKER_EXTS = setOf("png", "gif", "webp", "jpg", "jpeg")

    /** 单张表情的**缺省**上限 (2026-11-10 起这一条能改, 见 [stickerCap]) */
    private val STICKER_MAX_BYTES = 2 * 1024 * 1024

    /**
     * 单张表情现在允许多大 (设置 → 活动 → 更多设置 → 表情)
     *
     * 与 `BallStickers.capBytes`、宿主 `lw_sticker op=fetch` 读的是同一格 —— 三处只要有一处还写死
     * 2 MB, 就会出现"门户能加、球上画不出来"那种安静的空框
     */
    private fun stickerCap(): Long = runCatching { SimSetting.plan(context).sticker.maxBytes }
        .getOrDefault(STICKER_MAX_BYTES.toLong())

    /** 目录里最多几张 (设置 → 活动 → 更多设置 → 表情); 与宿主 `op=fetch` 那道闸同一个数 */
    private fun stickerMaxCount(): Int = runCatching { SimSetting.plan(context).sticker.maxCount }
        .getOrDefault(DEFAULT_STICKER_COUNT)

    /** 张数的缺省 (超过 `sim.json` 里那一格没写时用它, 与 `SimSetting.Default.STICKER_MAX_COUNT` 同数) */
    private val DEFAULT_STICKER_COUNT = 200

    // ── 路径与文件 ────────────────────────────────────────────────────────────

    private fun home(): File = File(context.filesDir, DshHost.HOME_DIR)

    private fun homeFile(relative: String): File = File(home(), relative)

    private fun lwFile(name: String): File = homeFile("lw/$name")

    /** 球那一场所在的工作区 (`dsh-ball`), 与宿主 `ballWorkspace()` 拼的是同一个名字 */
    private fun ballWorkspace(): File = File(Workspace.resolve(context).directory, BALL_WORKSPACE)

    /** 「Luwi」那条通道工作区 (探索 / 主动场那条, 与宿主 `EXPLORE_WORKSPACE_NAME` 同一个名字) */
    private fun channelWorkspace(): File = File(Workspace.resolve(context).directory, CHANNEL_WORKSPACE)

    private fun readJson(file: File): JSONObject? = runCatching {
        if (!file.isFile) null else JSONObject(file.readText())
    }.getOrNull()

    private companion object {
        /** 工作区名: 宿主那一侧是 `BALL_WORKSPACE_NAME`, 判据脚本会比对这两个量 */
        const val BALL_WORKSPACE = "dsh-ball"

        /** 「Luwi」那条通道工作区: 宿主那一侧是 `EXPLORE_WORKSPACE_NAME`, 两处同一个字面量 */
        const val CHANNEL_WORKSPACE = "Luwi"

        /** 球那场账的有效期, 与宿主 `VOICE_SESSION_MS` 逐字相同 (10 分钟) */
        const val VOICE_SESSION_MS = 10 * 60 * 1000L

        /** 会话 id 的长度上限 (与 [WakeBridge] 那一处同一个数) */
        const val SESSION_ID_MAX = 128

        /** 敲钟那一行的正文: 宿主只看 source, 正文只是给人看的读数 */
        const val TICK_TEXT = "tick"

        /** 探索那一行没有 nextTask 时的兜底正文 (空正文会被收件箱拒掉) */
        const val DEFAULT_EXPLORE_TEXT = "接着上一趟看看"

        /** 那一张脸的日志 tag (与 HostScreen 的 WEB_TAG 同一族) */
        const val LOOK_TAG = "DshWebView"

        /** [portalImageFail] 收到一句空原因时的兜底 (页面不会给空串, 但这行日志不能是空的) */
        const val UNKNOWN_FAIL = "unknown"

        /** 复制路径那一下剪贴板上的说明 (Android 13 起系统会在左下角给一眼预览) */
        const val CLIP_LABEL = "Luwi path"
    }
}
