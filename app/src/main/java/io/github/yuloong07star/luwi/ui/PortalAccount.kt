package io.github.yuloong07star.luwi.ui

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

/** 首启引导那张「账号」行现在是什么光景 (决定副标题与对话框里那句) */
internal enum class AccountPhase {
    /** 还没问过 (弹窗刚开, 问出去的那一拍还没回来) */
    IDLE,

    /** 正在问 / 正在登录 / 正在写 Key */
    WORKING,

    /** 问到了: 没有账号也没有 Key */
    SIGNED_OUT,

    /** 问到了: 账号已登录 */
    SIGNED_IN,

    /** Key 写进去了 (这一趟不必再问) */
    KEY_SAVED,

    /** 刚才那一下没成 ([PortalAccount.reason] 是原因) */
    FAILED,
}

/**
 * 账号那一行 (2026-11-14 主人: "直接调用 dsh 的登陆接口, 在新手引导里加入登陆帐号的引导项")
 *
 * **为什么走页面而不是 Kotlin 自己发请求**: dsh 的登录与凭据都是**宿主进程里的服务**
 * (`deepseekAccount.startSignIn` / `credentials.set`), 浏览器那侧只是它的客户端 (`remote.account` /
 * `remote.credentials`)。换 token 那一步发生在宿主的回环回调上, 手机上只有 app 里的 host 认那条路 ——
 * 所以这里借已经挂着的门户那一页当"客户端", 三个动作都走 `__LUWI_PORTAL__.account(...)`, 结果由页面
 * 通过 [PortalBridge.lwAccountResult] 报回来
 *
 * 状态全在这里 (一处一份): 引导卡那一行与对话框读同一份, 于是"登录完那一行自己变绿"
 */
internal object PortalAccount {

    private const val TAG = "LwAccountGate"

    /** 「稍后」那个记号: 与 `ReadyDialogSeen` 同一个偏好文件 */
    private const val STORE = "luwi"
    private const val LATER = "ready-account-later"

    /** 动作与结果各走一半: 结果从桥上来, 可能不在主线程 */
    private val main = Handler(Looper.getMainLooper())

    /** 这一行现在是什么光景 */
    var phase by mutableStateOf(AccountPhase.IDLE)
        private set

    /** 账号名 (已登录时那一行写「已登录 名字」) */
    var label by mutableStateOf("")
        private set

    /** 账号档模型那条凭据写了没有 (`DEEPSEEK_API_KEY`) */
    var keyConfigured by mutableStateOf(false)
        private set

    /**
     * 登录之后真正在用的那个模型名 (`DeepSeek-V4.1-Flash` 这种)
     *
     * 宿主在 status 里现算一份 (账号那条 route 的首个可用模型), 空串 = 还不知道 / 目录还没下来 ——
     * 卡片据此把话说全: 「已登录 名字 · 模型名」, 而不是只报登录态让人以为模型就能跑 (2026-11-15)
     */
    var model by mutableStateOf("")
        private set

    /** [AccountPhase.FAILED] 那一档要说给人听的那一句 */
    var reason by mutableStateOf("")
        private set

    /** 浏览器该打开的那个授权地址; 取走就清 (一次性) */
    var openUrl by mutableStateOf<String?>(null)
        private set

    /**
     * 主人点了「稍后在后台 dsh 完成」 (2026-11-14)
     *
     * **只改文案, 不算完成**: 进度条仍卡在这一格 (主人要的"不能跳过"), 只是不再把那一句劝说挂在脸上
     */
    var deferred by mutableStateOf(false)
        private set

    /** 读盘只做一次 (与 [PortalAccount.deferred] 同一个文件: `luwi`) */
    @Volatile
    private var loaded = false

    /** 「稍后」那个记号落偏好, 跨启动 */
    fun ensureLoaded(context: Context) {
        if (loaded) return
        loaded = true
        deferred = runCatching { prefs(context).getBoolean(LATER, false) }.getOrDefault(false)
    }

    /** 这一趟先不登录, 稍后去 dsh 后台办 (窗照关, 进度照卡) */
    fun defer(context: Context) {
        deferred = true
        runCatching { prefs(context).edit().putBoolean(LATER, true).apply() }
        Log.i(TAG, "the owner will finish the sign-in in dsh later")
    }

    private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    /** 这一行算不算办好了: 登录了或者写了 Key 都算 (账号档模型两条路都通) */
    val ready: Boolean get() = phase == AccountPhase.SIGNED_IN || keyConfigured

    /** 打开对话框 / 回到前台时问一次 */
    fun refresh() {
        phase = AccountPhase.WORKING
        reason = ""
        kick("'status'")
    }

    /** 起一次登录: 页面问宿主要件授权地址, 拿到了就从 [openUrl] 交出去 */
    fun login() {
        phase = AccountPhase.WORKING
        reason = ""
        kick("'login'")
    }

    /**
     * 写一把 API Key (留空 = 清掉这一把, 由宿主那一侧 `credentials.unset` 收尾)
     * @param key 用户粘进来的那个串
     */
    fun saveKey(key: String) {
        val value = key.trim()
        phase = AccountPhase.WORKING
        reason = ""
        kick("'key', " + JSONObject.quote(JSONObject().put("key", value).toString()))
    }

    /** 把授权地址取走 (取完就清, 免得回来又开一次浏览器) */
    fun takeUrl(): String? {
        val url = openUrl ?: return null
        openUrl = null
        return url
    }

    /** 关掉对话框时把"刚失败"那一档收回去 (下次打开是干净的一次) */
    fun settle() {
        if (phase == AccountPhase.FAILED) {
            phase = AccountPhase.SIGNED_OUT
            reason = ""
        }
    }

    /**
     * 页面报回来的那一条 (在 [PortalBridge.lwAccountResult] 里叫, 线程不定)
     * @param payload 一段 JSON: `{action, ok, ...}`
     */
    fun adopt(payload: String) {
        val body = runCatching { JSONObject(payload) }.getOrNull() ?: return
        main.post {
            when (val action = body.optString("action")) {
                "status" -> adoptStatus(body)
                "login" -> adoptLogin(body)
                "key" -> adoptKey(body)
                else -> Log.w(TAG, "account: unexpected report $action")
            }
        }
    }

    private fun adoptStatus(body: JSONObject) {
        val ok = body.optBoolean("ok", false)
        keyConfigured = body.optBoolean("keyConfigured", keyConfigured)
        val signedIn = body.optBoolean("signedIn", false)
        label = body.optString("label").orEmpty()
        // 宿主那份 `account-model.json` 的结论: 有就报模型名, 没有就留空 (卡片那半句自然省掉)
        model = body.optJSONObject("model")?.optString("label").orEmpty()
        phase = when {
            signedIn -> AccountPhase.SIGNED_IN
            !ok && !keyConfigured -> AccountPhase.FAILED
            else -> AccountPhase.SIGNED_OUT
        }
        if (!ok) reason = "读不到账号状态"
        // 真登录上了就没什么"稍后"可说了
        if (signedIn) deferred = false
        Log.i(TAG, "status signedIn=$signedIn key=$keyConfigured label=$label model=$model ok=$ok")
    }

    private fun adoptLogin(body: JSONObject) {
        if (body.optBoolean("pending", false)) return
        if (!body.optBoolean("ok", false)) {
            phase = AccountPhase.FAILED
            reason = body.optString("error").orEmpty().ifEmpty { "登录没有起来" }
            return
        }
        val url = body.optString("url").orEmpty()
        if (url.isEmpty()) {
            // 宿主说已经登录了 (status = credential-stored): 直接再读一次状态
            phase = AccountPhase.WORKING
            kick("'status'")
            return
        }
        openUrl = url
        phase = AccountPhase.WORKING
        Log.i(TAG, "sign-in started: handing the authorize url to the browser")
    }

    private fun adoptKey(body: JSONObject) {
        if (body.optBoolean("ok", false)) {
            keyConfigured = true
            phase = AccountPhase.KEY_SAVED
            reason = ""
            return
        }
        phase = AccountPhase.FAILED
        reason = body.optString("error").orEmpty().ifEmpty { "这把 Key 没写进去" }
    }

    /** 先放进 [PortalState.run] 那条 `evaluateJavascript` 的入口 */
    private fun kick(args: String) {
        val run = PortalState.run
        if (run == null) {
            phase = AccountPhase.FAILED
            reason = "界面还没起来"
            Log.w(TAG, "no page yet: the account action waits (args=$args)")
            return
        }
        // 这一行是"到底有没有问出去"的唯一读数: 页面那侧一条回话都没有时, 先看它有没有出现
        Log.i(TAG, "asking the page: account($args)")
        run(
            "window.__LUWI_PORTAL__ && window.__LUWI_PORTAL__.account" +
                " && window.__LUWI_PORTAL__.account(" + args + ")",
        )
    }
}
