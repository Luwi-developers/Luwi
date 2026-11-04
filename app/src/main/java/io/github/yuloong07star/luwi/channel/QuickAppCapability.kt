package io.github.yuloong07star.luwi.channel

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.util.Log

/**
 * 快应用 (quick app) 的能力探测与打开
 *
 * 快应用不是本应用里的一个 activity, 也没有一套别的应用可以直接调用的 API: 它由设备上已注册的
 * runtime 按 deep link 接管. 官方格式是 `hap://app/<package>/[path][?key=value]`, 原生应用还可以用
 * `http(s)://hapjs.org/app/<package>/...` ([快应用 Deeplink 教程](https://doc.quickapp.cn/tutorial/platform/deeplink.html)).
 * 所以"这台设备能不能开快应用"只有一个判据: ACTION_VIEW 加上那条链接, PackageManager 认不认一个
 * activity 来接下它 [1]
 *
 * **这条路上永远不建虚拟屏**: 快应用 runtime 自己决定把它画在哪, 它要的是手机自己的屏; 探测失败时
 * 唯一的答案是 unsupported, 不是"建一块屏再试" (12-2 / 12-3, 判据 `check-phone-actions.mjs`). 虚拟屏
 * 那一档是给"把某个 activity 放到一块自己控制的屏上"用的, 而快应用的界面根本不由本应用起
 *
 * [linkFor] / [linkProblem] / [candidatesFor] / [noRuntimeReason] 都是纯逻辑, JVM 单测直接跑;
 * [probe] / [open] 才碰 Context 与 PackageManager, 且都只读一次包表或发一个 Intent, 不经过特权通道
 *
 * [1] 本机真机读数 (2026-11-04, OJZD5D6TMNSKFYHM): `cmd package resolve-activity -a
 *     android.intent.action.VIEW -d hap://app/com.example.test` 答 `com.miui.hybrid.VendorDispatcherActivity`
 */
internal object QuickAppCapability {

    /** 快应用自己的 scheme; 标准链接的第一段永远是它 */
    const val SCHEME = "hap"

    /** 标准链接的第一段主机名: `hap://app/<package>` */
    const val HOST = "app"

    /** 网页形态那两条链接的主机与路径前缀: `https://hapjs.org/app/<package>` */
    const val WEB_HOST = "hapjs.org"
    const val WEB_PREFIX = "/app/"

    /** 只用来问"谁接快应用链接"的包名: 它不必真的存在, 有 runtime 注册就会解析出一个 activity */
    const val PROBE_PACKAGE = "com.example.luwi.probe"

    /** 失败那一句话里一定要有的词: 调用方据此把结果当 unsupported, 而不是"再建一块屏试试" */
    const val UNSUPPORTED = "unsupported"

    /**
     * 一条候选链接
     *
     * @property uri 完整的链接
     * @property scheme 走的哪一种: `hap` / `https` / `http`
     */
    data class Link(val uri: String, val scheme: String)

    /**
     * 探测结果
     *
     * @property ready 有没有 runtime 接得下标准链接
     * @property handlerPackage 接下的那个包 (没有时为空)
     * @property handlerComponent 接下的那个组件, 形如 `package/.Activity` (没有时为空)
     * @property link 真的被接下的那条链接 (没有时为空)
     * @property scheme 被接下的链接的 scheme (没有时为空)
     * @property tried 依次问过的链接
     * @property reason 不可用时的原因, 可用时为空
     */
    data class Probe(
        val ready: Boolean,
        val handlerPackage: String = "",
        val handlerComponent: String = "",
        val link: String = "",
        val scheme: String = "",
        val tried: List<String> = emptyList(),
        val reason: String = "",
    )

    /**
     * 打开的结果
     *
     * @property started Intent 有没有被 runtime 收下 (它之后画成什么样, 本应用不再管)
     * @property unsupported 是不是"这台设备做不到"; 为 true 时 [reason] 就是给模型的那句话
     * @property uri 实际发出去的那条链接 (一条都没发时为第一条候选或空)
     * @property scheme 实际发出去的那条链接的 scheme
     * @property handlerPackage 接下它的那个包
     * @property handlerComponent 接下它的那个组件
     * @property reason 没成功时的原因, 成功时为空
     */
    data class Opened(
        val started: Boolean,
        val unsupported: Boolean,
        val uri: String = "",
        val scheme: String = "",
        val handlerPackage: String = "",
        val handlerComponent: String = "",
        val reason: String = "",
    )

    /**
     * 标准链接: `hap://app/<package>/[path][?query]`
     *
     * 包名不像包名时回 null 而不是猜一个: 快应用的包名与 Android 包名同一个形状, 拿一个中文名字或
     * 一个网页地址进去只会得到 runtime 的一句"应用不存在", 那种失败看起来像设备不支持
     *
     * @param path 快应用内的页面, 可省略 (省略就是首页)
     * @param query `key=value` 串, 可省略; 前导 `?` 会被去掉
     */
    fun linkFor(packageName: String, path: String = "", query: String = ""): String? {
        val name = packageName.trim()
        if (!PACKAGE.matches(name)) return null
        val cleanPath = path.trim().trim('/')
        if (cleanPath.isNotEmpty() && !PAGE.matches(cleanPath)) return null
        val cleanQuery = query.trim().removePrefix("?")
        if (cleanQuery.isNotEmpty() && !QUERY.matches(cleanQuery)) return null
        return buildString {
            append(SCHEME).append("://").append(HOST).append('/').append(name)
            if (cleanPath.isNotEmpty()) append('/').append(cleanPath)
            if (cleanQuery.isNotEmpty()) append('?').append(cleanQuery)
        }
    }

    /**
     * 这条链接是不是快应用链接, 不是的话为什么
     *
     * 只认官方那三种写法. 别的链接 (普通网页 / 一个应用自己的 scheme) 发出去最多打开别的东西,
     * 而"打开了别的应用"在这里会被当成"快应用开成了" —— 所以宁可先拒掉
     */
    fun linkProblem(uri: String): String? {
        val link = uri.trim()
        if (link.isEmpty()) return "a quick app link is empty"
        val lower = link.lowercase()
        val rest = when {
            lower.startsWith("$SCHEME://$HOST/") -> link.substring("$SCHEME://$HOST/".length)
            lower.startsWith("https://$WEB_HOST$WEB_PREFIX") -> link.substring("https://$WEB_HOST$WEB_PREFIX".length)
            lower.startsWith("http://$WEB_HOST$WEB_PREFIX") -> link.substring("http://$WEB_HOST$WEB_PREFIX".length)
            else -> return "\"$link\" is not a quick app link: it has to read" +
                " $SCHEME://$HOST/<package>/... or https://$WEB_HOST$WEB_PREFIX<package>/..."
        }
        if (rest.isBlank()) return "\"$link\" names no quick app package"
        val name = rest.substringBefore('/').substringBefore('?')
        if (!PACKAGE.matches(name)) {
            return "\"$name\" is not a package name: a quick app is named like com.example.app"
        }
        return null
    }

    /**
     * 给一个包名, 按"最可能被接下"的顺序给出三条标准链接
     *
     * `hap://` 是快应用自己的 scheme, 原生应用发它最直接; 有些设备的 runtime 只登记了网页形态,
     * 所以两条 hapjs.org 链接排后面当退路 (官方文档: 原生应用三种都能用)
     */
    fun candidatesFor(packageName: String, path: String = "", query: String = ""): List<Link> {
        val hap = linkFor(packageName, path, query) ?: return emptyList()
        val tail = hap.substringAfter("$SCHEME://$HOST/")
        return listOf(
            Link(hap, SCHEME),
            Link("https://$WEB_HOST$WEB_PREFIX$tail", "https"),
            Link("http://$WEB_HOST$WEB_PREFIX$tail", "http"),
        )
    }

    /** 一条链接都没被接下的说法; 后半句是关键: 建屏也不会让快应用开起来 */
    fun noRuntimeReason(tried: List<String>): String =
        "no quick app runtime on this device answers to " +
            (if (tried.isEmpty()) "a quick app link" else tried.joinToString(" or ")) +
            "; a virtual screen cannot make a quick app open, so this is ${UNSUPPORTED}"

    /**
     * 问一次设备: 有没有 runtime 接得下标准链接
     *
     * 依次问 hap / https / http 三种写法, 第一条被接下的就是答案. **只问不发**: 探测不打开任何
     * 界面, 也不留下一个"刚才好像动了"的副作用
     */
    fun probe(context: Context): Probe {
        val tried = candidatesFor(PROBE_PACKAGE).map { it.uri }
        for (candidate in candidatesFor(PROBE_PACKAGE)) {
            val handler = handlerFor(context, candidate.uri) ?: continue
            return Probe(
                ready = true,
                handlerPackage = handler.packageName,
                handlerComponent = componentOf(handler),
                link = candidate.uri,
                scheme = candidate.scheme,
                tried = tried,
            )
        }
        return Probe(ready = false, tried = tried, reason = noRuntimeReason(tried))
    }

    /**
     * 打开一个快应用
     *
     * 名字与链接二选一: 给了 [uri] 就用它 (必须先过 [linkProblem]), 否则用 [packageName] 拼标准链接.
     * 无论哪条路, 只有 PackageManager 认得出一个 activity 时才发 Intent —— 认不出就是 unsupported,
     * 这一层根本没有"建一块屏再试"的分支
     */
    fun open(
        context: Context,
        uri: String = "",
        packageName: String = "",
        path: String = "",
        query: String = "",
    ): Opened {
        val explicit = uri.trim()
        val candidates = if (explicit.isNotEmpty()) {
            val problem = linkProblem(explicit)
            if (problem != null) {
                return Opened(started = false, unsupported = true, uri = explicit, reason = problem)
            }
            listOf(Link(explicit, schemeOf(explicit)))
        } else {
            val name = packageName.trim()
            if (name.isEmpty()) {
                return Opened(
                    started = false,
                    unsupported = true,
                    reason = "name the quick app by package (com.example.app), or give its" +
                        " $SCHEME://$HOST/... link",
                )
            }
            val built = candidatesFor(name, path, query)
            if (built.isEmpty()) {
                return Opened(
                    started = false,
                    unsupported = true,
                    reason = "\"$name\" is not a package name: a quick app is named like com.example.app",
                )
            }
            built
        }
        val tried = ArrayList<String>(candidates.size)
        for (candidate in candidates) {
            tried += candidate.uri
            val handler = handlerFor(context, candidate.uri) ?: continue
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(candidate.uri)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            return try {
                context.startActivity(intent)
                Opened(
                    started = true,
                    unsupported = false,
                    uri = candidate.uri,
                    scheme = candidate.scheme,
                    handlerPackage = handler.packageName,
                    handlerComponent = componentOf(handler),
                )
            } catch (problem: Throwable) {
                // 解析到了 activity 却起不动: 这是一句"没打开", 不是"设备不支持". 仍然不建屏
                Log.w(TAG, "the quick app runtime refused ${candidate.uri}", problem)
                Opened(
                    started = false,
                    unsupported = true,
                    uri = candidate.uri,
                    scheme = candidate.scheme,
                    handlerPackage = handler.packageName,
                    handlerComponent = componentOf(handler),
                    reason = "the quick app runtime refused it: " +
                        (problem.message ?: problem.javaClass.simpleName),
                )
            }
        }
        return Opened(started = false, unsupported = true, reason = noRuntimeReason(tried))
    }

    /** 这条链接自己的 scheme, 给答案用 */
    fun schemeOf(uri: String): String = when {
        uri.trim().lowercase().startsWith("$SCHEME://") -> SCHEME
        uri.trim().lowercase().startsWith("https://") -> "https"
        uri.trim().lowercase().startsWith("http://") -> "http"
        else -> ""
    }

    /** 谁接得下这条链接: 只问一次, 问不到就是 null (设备没有 runtime, 或包表读不到) */
    private fun handlerFor(context: Context, uri: String): ActivityInfo? = try {
        context.packageManager
            .queryIntentActivities(Intent(Intent.ACTION_VIEW, Uri.parse(uri)), 0)
            .firstOrNull { it.activityInfo != null }
            ?.activityInfo
    } catch (problem: Throwable) {
        Log.w(TAG, "could not ask who answers $uri", problem)
        null
    }

    /** 一个 activity 的短名, 形如 `com.miui.hybrid/.VendorDispatcherActivity` */
    private fun componentOf(info: ActivityInfo): String =
        ComponentName(info.packageName, info.name).flattenToShortString()

    /** 与 Android 包名同一个形状: 至少两段, 每段字母开头 */
    private val PACKAGE = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")

    /** 快应用内的页面: 常见是 `Detail` / `pages/index`, 只有 URI 安全字符 */
    private val PAGE = Regex("^[A-Za-z0-9._~/-]+$")

    /** 查询串: `key=value&key2=value2`, 不接空格与 `#` (它们要编码, 而这里不做编码) */
    private val QUERY = Regex("^[A-Za-z0-9._~=&%+-]+$")

    private const val TAG = "LwQuickApp"
}
