package io.github.yuloong07star.luwi.account

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** 一次登录的几种进行时 (账号行按它决定那句副标题) */
enum class LoginPhase { IDLE, WAITING, FAILED, EXPIRED, TIMEOUT }

/**
 * 酒馆首页那个账号 (2026-10-25)
 *
 * 走的是官网**已经有**的设备码那条路 (PC 同步面板在用): 应用生成一枚一次性 state, 浏览器打开
 * `/login?ls=<state>` 走 GitHub 登录, 应用这边轮询 `/api/account/poll?state=` 取回 device_token
 * 与账号读数 —— 官网一个字都不用改
 *
 * 三条纪律:
 *   · **只读不写**: 登录结果与到期是读来的; 签到只在官网 `/tavern` 页里点 (2026-10-26 恢复),
 *     签到与购买这一侧都只把浏览器送过去, 这里没有 `/api/checkin`
 *   · **token 只住在这个偏好文件里**: 不进日志、不上屏、不进 Toast
 *   · **一处一份状态**: 账号行 / 开通入口 / 聊天页门闸读的是同一份快照状态, 登录完三处一起变
 *
 * 时间口径: 轮询 15 秒一拍 (官网限流 60 次 / 10 分钟 / IP), 一次登录最多等 10 分钟; 回前台
 * (`ON_RESUME`) 另给一次立即拍 —— 人在浏览器里点完就回来了, 不该再等下一个 15 秒
 */
object LuwiAccount {

    private const val TAG = "LwAccount"

    /** 与设置页那些偏好同一个文件 */
    private const val STORE = "luwi"

    private const val KEY_TOKEN = "account-token"
    private const val KEY_LOGIN = "account-login"
    private const val KEY_EMAIL = "account-email"
    private const val KEY_EXPIRES = "account-expires-at"
    private const val KEY_PAID = "account-paid-until"
    private const val KEY_FETCHED = "account-fetched-at"
    private const val KEY_STATE = "account-login-state"
    private const val KEY_STARTED = "account-login-started-at"

    /** 首次进酒馆那句说明看过没有 (主人 2026-10-25: 只弹一次, 关掉就永久记住) */
    private const val KEY_NOTICE = "tavern-notice-seen"

    /** 轮询间隔: 官网限流是 60 次 / 10 分钟 / IP, 15 秒一拍最多 40 次 */
    private const val POLL_INTERVAL_MS = 15_000L

    /** 一次登录最多等多久 (服务端 state 的窗口是 30 分钟, 这边主动收得更早) */
    private const val LOGIN_WINDOW_MS = 10 * 60 * 1000L

    /** 回前台那一拍的去抖: 转屏 / 多页切换会让 ON_RESUME 连着来 */
    private const val RESUME_GUARD_MS = 2_000L

    /** 到期读数多久之内算新鲜 (再进首页就不重复问官网了) */
    private const val REFRESH_TTL_MS = 60_000L

    /** 最近一次 /api/account/poll 的读数; null = 这台机器没登录 */
    var account: Account? by mutableStateOf(null)
        private set

    /** 这一次登录走到哪一步了 */
    var login: LoginPhase by mutableStateOf(LoginPhase.IDLE)
        private set

    /** [LoginPhase.FAILED] 那一档要说给主人听的那句 (官网自己写的人话) */
    var loginReason: String by mutableStateOf("")
        private set

    /** 读盘只做一次 */
    @Volatile
    private var loaded = false

    private val scope: CoroutineScope by lazy { CoroutineScope(SupervisorJob() + Dispatchers.IO) }

    private var polling: Job? = null

    private var lastPollAt = 0L

    /** 轮询要用的是 application context (界面那条 lambda 随时会走) */
    private var appContext: Context? = null

    /**
     * 读一次盘 (幂等)
     *
     * 放在 `remember { ... }` 里由界面第一帧调一次 (与 `TavernStore.token` 同一个写法): 已登录的
     * 机器不该先闪一下「未登录」
     * @param context 任意上下文
     */
    fun ensureLoaded(context: Context) {
        if (loaded) return
        loaded = true
        val app = context.applicationContext
        appContext = app
        val prefs = prefs(app)
        val token = prefs.getString(KEY_TOKEN, "").orEmpty()
        if (token.isNotEmpty()) {
            account = Account(
                token = token,
                login = prefs.getString(KEY_LOGIN, "").orEmpty(),
                email = prefs.getString(KEY_EMAIL, "").orEmpty(),
                expiresAt = prefs.getLong(KEY_EXPIRES, 0L).takeIf { it > 0L },
                paidUntil = prefs.getLong(KEY_PAID, 0L).takeIf { it > 0L },
                fetchedAt = prefs.getLong(KEY_FETCHED, 0L),
            )
        }
        // 上次那次登录还在窗口里就接着等 (进程被系统收过也认得出来)
        val state = prefs.getString(KEY_STATE, "").orEmpty()
        if (state.isEmpty()) return
        val startedAt = prefs.getLong(KEY_STARTED, 0L)
        val age = System.currentTimeMillis() - startedAt
        if (age >= 0 && age < LOGIN_WINDOW_MS) {
            login = LoginPhase.WAITING
            beginPolling(app, state, startedAt)
        } else {
            clearPending(prefs)
        }
    }

    /**
     * 起一次官网登录: 返回要在浏览器里打开的地址
     *
     * 上一次的 state 还在窗口里就复用 (人可能在浏览器里退了回来, 再点一次只是重开那一页)
     * @param context 任意上下文
     * @return 登录发起页
     */
    fun startSignIn(context: Context): String {
        ensureLoaded(context)
        val app = context.applicationContext
        appContext = app
        val prefs = prefs(app)
        val now = System.currentTimeMillis()
        val existing = prefs.getString(KEY_STATE, "").orEmpty()
        val startedAt = prefs.getLong(KEY_STARTED, 0L)
        val age = now - startedAt
        val reuse = existing.isNotEmpty() && age >= 0 && age < LOGIN_WINDOW_MS
        val state = if (reuse) {
            existing
        } else {
            AccountWire.newState().also {
                prefs.edit().putString(KEY_STATE, it).putLong(KEY_STARTED, now).apply()
            }
        }
        login = LoginPhase.WAITING
        loginReason = ""
        beginPolling(app, state, if (reuse) startedAt else now)
        return AccountWire.loginUrl(state)
    }

    /** 浏览器没开起来 (或者人放弃了): 把这次等待收掉, 下一次重新发一枚 state */
    fun cancelSignIn(context: Context) {
        polling?.cancel()
        polling = null
        login = LoginPhase.IDLE
        loginReason = ""
        clearPending(prefs(context))
    }

    /** 从浏览器回来那一刻: 立刻问一次 (2 秒去抖) */
    fun onResumePoll() {
        if (login != LoginPhase.WAITING) return
        val context = appContext ?: return
        val state = prefs(context).getString(KEY_STATE, "").orEmpty()
        if (state.isEmpty()) return
        val now = System.currentTimeMillis()
        if (now - lastPollAt < RESUME_GUARD_MS) return
        lastPollAt = now
        scope.launch { pollOnce(context, state) }
    }

    /**
     * 回前台顺手读一次到期
     *
     * 官网里续费过之后 `expiresAt` 会变, 而这边只有这一条读的路 —— 于是"买完回到应用, 小字
     * 日期跟着变"就靠它; 一分钟之内的读数直接用, 不再问官网
     * @param context 任意上下文
     */
    fun refreshQuiet(context: Context) {
        ensureLoaded(context)
        val current = account ?: return
        if (System.currentTimeMillis() - current.fetchedAt < REFRESH_TTL_MS) return
        val app = context.applicationContext
        appContext = app
        scope.launch { applyRefresh(app, current) }
    }

    /** 账号窗里手动刷一次: 结果原样交给界面去念 */
    suspend fun refresh(): RefreshResult {
        val context = appContext
        val current = account
        if (context == null || current == null) return RefreshResult.Failed("还没有登录")
        return applyRefresh(context, current)
    }

    /**
     * 退出登录: **只清本机这一份**
     *
     * 官网那条会话 (90 天) 与插件那边共用 `sessions` 表, 但 `/api/account/logout` 只认 cookie,
     * 应用这条 device_token 没有 cookie 可清 —— 与 PC 插件同一个做法, 不假装能吊销
     * @param context 任意上下文
     */
    fun logout(context: Context) {
        polling?.cancel()
        polling = null
        account = null
        login = LoginPhase.IDLE
        loginReason = ""
        prefs(context).edit()
            .remove(KEY_TOKEN)
            .remove(KEY_LOGIN)
            .remove(KEY_EMAIL)
            .remove(KEY_EXPIRES)
            .remove(KEY_PAID)
            .remove(KEY_FETCHED)
            .remove(KEY_STATE)
            .remove(KEY_STARTED)
            .apply()
    }

    /** 首次进酒馆那句说明看过没有 */
    fun noticeSeen(context: Context): Boolean = prefs(context).getBoolean(KEY_NOTICE, false)

    /** 记下"看过" (点按钮 / 点空白 / 按返回都算) */
    fun markNoticeSeen(context: Context) {
        prefs(context).edit().putBoolean(KEY_NOTICE, true).apply()
    }

    /** 把登录阶段那句错字收掉 (账号行上那个 10 秒的小闹钟用) */
    fun clearLoginNote() {
        if (login == LoginPhase.WAITING) return
        login = LoginPhase.IDLE
        loginReason = ""
    }

    /* ── 登录轮询 ───────────────────────────────────────────────────────── */

    private fun beginPolling(context: Context, state: String, startedAt: Long) {
        polling?.cancel()
        polling = scope.launch {
            while (isActive) {
                lastPollAt = System.currentTimeMillis()
                if (!pollOnce(context, state)) return@launch
                if (System.currentTimeMillis() - startedAt >= LOGIN_WINDOW_MS) {
                    settle(context, LoginPhase.TIMEOUT, "")
                    return@launch
                }
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    /**
     * 问一次
     * @return true = 还要接着等
     */
    private suspend fun pollOnce(context: Context, state: String): Boolean {
        when (val result = AccountApi.poll(state)) {
            is PollResult.SignedIn -> {
                save(context, result)
                login = LoginPhase.IDLE
                loginReason = ""
                clearPending(prefs(context))
                return false
            }

            PollResult.Pending -> return true

            PollResult.Gone -> {
                settle(context, LoginPhase.EXPIRED, "")
                return false
            }

            is PollResult.Failed -> {
                // 网络那一档接着等 (人可能正在切网络), HTTP 那一档这一次就没戏了
                if (result.transient) return true
                settle(context, LoginPhase.FAILED, result.reason)
                return false
            }
        }
    }

    private fun settle(context: Context, phase: LoginPhase, reason: String) {
        login = phase
        loginReason = reason
        clearPending(prefs(context))
    }

    /* ── 落地 ───────────────────────────────────────────────────────────── */

    private suspend fun applyRefresh(context: Context, current: Account): RefreshResult {
        val result = AccountApi.refresh(current.token)
        when (result) {
            is RefreshResult.Done -> save(
                context,
                current.copy(
                    login = result.login.ifEmpty { current.login },
                    email = result.email.ifEmpty { current.email },
                    expiresAt = result.expiresAt,
                    paidUntil = result.paidUntil,
                    fetchedAt = System.currentTimeMillis(),
                ),
            )

            RefreshResult.Unauthorized -> {
                // token 已经在服务端不认了: 唯一会因为服务端而退登录的地方
                logout(context)
                login = LoginPhase.EXPIRED
            }

            is RefreshResult.Failed -> Unit
        }
        return result
    }

    private fun save(context: Context, result: PollResult.SignedIn) {
        save(
            context,
            Account(
                token = result.token,
                login = result.login,
                email = result.email,
                expiresAt = result.expiresAt,
                paidUntil = result.paidUntil,
                fetchedAt = System.currentTimeMillis(),
            ),
        )
    }

    private fun save(context: Context, value: Account) {
        account = value
        prefs(context).edit()
            .putString(KEY_TOKEN, value.token)
            .putString(KEY_LOGIN, value.login)
            .putString(KEY_EMAIL, value.email)
            .putLong(KEY_EXPIRES, value.expiresAt ?: 0L)
            .putLong(KEY_PAID, value.paidUntil ?: 0L)
            .putLong(KEY_FETCHED, value.fetchedAt)
            .apply()
        // 只念登录名: token 一个字节都不进日志
        Log.i(TAG, "signed in as ${value.login.ifEmpty { "(no name)" }}")
    }

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    private fun clearPending(prefs: SharedPreferences) {
        prefs.edit().remove(KEY_STATE).remove(KEY_STARTED).apply()
    }
}
