package io.github.yuloong07star.luwi.ui

import android.content.Context
import android.webkit.JavascriptInterface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.yuloong07star.luwi.host.DshHost
import io.github.yuloong07star.luwi.tool.RouterChecks
import io.github.yuloong07star.luwi.tool.RouterTick
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

    /** 页面就绪时由 HostScreen 装上, 每次文档加载都重挂一次 */
    var run: ((String) -> Unit)? = null
}

/**
 * 门户那一层要的那几件事: 读判断层与工作结构, 写"球的那一场"的账, 敲一下钟
 *
 * **为什么在 app 这一侧**: `$DSH_HOME/lw` 下那几份 json 与 `$DSH_HOME/voice` 都在 app 沙盒里, 浏览器
 * 里的 JS 一个字节都碰不到 (WebView 拿到的是 host 发出来的那几个 http 响应), 而宿主插件那一侧又不
 * 给页面开自定义路由 —— 于是这一层走 `window.LuwiPortal` 那座桥 (与 [WakeBridge] 同一条信任边界:
 * 页面就是本机 host 发的那个, 见 HostScreen 的 shouldOverrideUrlLoading)
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

    /** 门户开着还是收起了: 菜单那一项靠它换方向 */
    @JavascriptInterface
    fun portalVisible(on: Boolean) {
        PortalState.open = on
    }

    // ── 写 ────────────────────────────────────────────────────────────────────

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

    // ── 路径与文件 ────────────────────────────────────────────────────────────

    private fun home(): File = File(context.filesDir, DshHost.HOME_DIR)

    private fun homeFile(relative: String): File = File(home(), relative)

    private fun lwFile(name: String): File = homeFile("lw/$name")

    /** 球那一场所在的工作区 (`dsh-ball`), 与宿主 `ballWorkspace()` 拼的是同一个名字 */
    private fun ballWorkspace(): File = File(Workspace.resolve(context).directory, BALL_WORKSPACE)

    private fun readJson(file: File): JSONObject? = runCatching {
        if (!file.isFile) null else JSONObject(file.readText())
    }.getOrNull()

    private companion object {
        /** 工作区名: 宿主那一侧是 `BALL_WORKSPACE_NAME`, 判据脚本会比对这两个量 */
        const val BALL_WORKSPACE = "dsh-ball"

        /** 球那场账的有效期, 与宿主 `VOICE_SESSION_MS` 逐字相同 (10 分钟) */
        const val VOICE_SESSION_MS = 10 * 60 * 1000L

        /** 会话 id 的长度上限 (与 [WakeBridge] 那一处同一个数) */
        const val SESSION_ID_MAX = 128

        /** 敲钟那一行的正文: 宿主只看 source, 正文只是给人看的读数 */
        const val TICK_TEXT = "tick"

        /** 探索那一行没有 nextTask 时的兜底正文 (空正文会被收件箱拒掉) */
        const val DEFAULT_EXPLORE_TEXT = "接着上一趟看看"
    }
}
