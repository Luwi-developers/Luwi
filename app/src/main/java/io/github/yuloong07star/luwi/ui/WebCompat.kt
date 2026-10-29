package io.github.yuloong07star.luwi.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import io.github.yuloong07star.luwi.R
import java.util.Locale
import org.json.JSONObject
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 老 WebView 的兼容层 (2.7.10, 主人 2026-10-25): 前端最早处垫 polyfill + 卡住时让人去更新
 *
 * **病根在前端产物里, 不在 Luwi**: dsh 往页面里塞的第一行就是
 * `(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()`, 而 `Promise.withResolvers`
 * 是 Chrome 119 才有的。2022 年前后出厂、WebView 一直没更新过的机器停在 100~116, 那一行**在解析期
 * 就抛**, 入口脚本一个都没跑起来 —— 屏幕上于是永远停在"连接中"。同一批 API 在客户端产物里也散着用
 *
 * 治本的两半:
 *
 * 1. **[install] 在"文档开始"时把 `assets/web/lw-compat.js` 先跑一遍** —— 用
 *    `WebViewCompat.addDocumentStartJavaScript` (`WebViewFeature.DOCUMENT_START_SCRIPT`, WebView 83+
 *    都有), 它保证在页面自己那一段之前执行。垫上之后老机器不用折腾更新 WebView
 * 2. **[WebViewTroubleDialog] 兜住"还是卡住了"那一档**: 页面把"还缺什么"报回来 ([Bridge]), 或者
 *    12 秒还没 ready 就弹窗, 说清当前版本并给「去更新 WebView」—— 别让人对着转圈干等
 *
 * 更新那条路对普通人本来就不友好 (国内没有 Play, vivo 分身空间还是独立用户), 所以**它是第二条路,
 * 不是唯一的**: polyfill 能垫的一律垫掉, 只有真垫不上的才叫人去更新
 */
internal object WebCompat {

    private const val TAG = "LwWebCompat"

    /** 页面看到的桥名 ([Bridge]); 与 asset 里那句 `window.LuwiWeb.report(...)` 是同一个 */
    const val BRIDGE = "LuwiWeb"

    /**
     * 前端产物真正要的那条线: **`AbortSignal.any` 从 Chrome 116 起才有**
     *
     * 以前写的是 119, 只盯着 `Promise.withResolvers`; 而 vivo Y77 那批机器缺的是
     * `AbortSignal.any` —— dsh 的 `dsh-api-gateway` client 在开 SSE 流 / 每帧投递 / 每代连接
     * 生命周期三处都调它, 缺了连接层整条起不来, 界面永远"重新连接中"。它**不在主产物里**, 而在
     * 按插件单独加载的 client chunk 里, 所以当初只扫 `dsh-web-frontend/dist` 漏掉了
     *
     * 现在 `lw-compat.js` 把这两条都垫上, 这条线降到 116 就够 (再往下只剩 CSS 的降级)
     */
    const val MIN_MAJOR = 116

    /** 注入的那段脚本只有 6 KB 左右, 读一次就够了 (每次开屏都读盘不值当) */
    private var cached: String? = null

    /** 当前 WebView 是哪一版 (读不到就回空串 / 0 —— 国产 ROM 上这条真的可能读不到) */
    data class Info(val packageName: String, val version: String, val major: Int) {
        val isOld: Boolean get() = major in 1 until MIN_MAJOR
        /** 界面上那一句: 读不到版本时只给包名 */
        val label: String get() = if (version.isBlank()) packageName else "$packageName $version"
    }

    fun info(context: Context): Info {
        val fromPackage = runCatching { WebViewCompat.getCurrentWebViewPackage(context) }.getOrNull()
        val name = fromPackage?.packageName.orEmpty()
        val version = fromPackage?.versionName.orEmpty()
        // 版本号读不到时退到 UA (`... Chrome/108.0.5359.128 ...`): 那条几乎所有 WebView 都有
        val major = majorOf(version).takeIf { it > 0 }
            ?: majorOf(runCatching { android.webkit.WebSettings.getDefaultUserAgent(context) }.getOrDefault(""))
        return Info(name.ifBlank { UNKNOWN_PACKAGE }, version, major)
    }

    /**
     * "119.0.6045.163" 取到 119; UA 那条取 `Chrome/119` 后面那个数
     *
     * **顺序是有意的**: UA 里先出现的是 `AppleWebKit/537.36`, 先按"开头那串数字"去抓就会把 537 当版本
     * (那是个 2000 年前的当次, 也永远不会是 119)。版本号读不出来时回 0 = "不知道", 而 [Info.isOld]
     * 对 0 判 false —— 不知道就别吓人
     */
    fun majorOf(text: String): Int {
        Regex("Chrome/(\\d+)").find(text)?.let { return it.groupValues[1].toIntOrNull() ?: 0 }
        Regex("^(\\d+)").find(text.trim())?.let { return it.groupValues[1].toIntOrNull() ?: 0 }
        return 0
    }

    /** assets 里那段 polyfill (读不出来就只有空串 = 不注入, 功能不受影响只是老机器没垫上) */
    fun script(context: Context): String = cached ?: runCatching {
        context.assets.open(SCRIPT).bufferedReader().use { it.readText() }
    }.getOrDefault("").also { cached = it }

    /**
     * 把 polyfill 装到"文档开始"那一刻
     *
     * @return true = 真的装上了 (老 WebView 也走得通这条路); false = 这台 WebView 太老没有这个钩子,
     *   那时只剩 [WebViewTroubleDialog] 那一半 —— 日志里会留一行, 判据在真机上才看得见
     */
    fun install(view: WebView, script: String): Boolean {
        if (script.isBlank()) return false
        if (!runCatching { WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) }
                .getOrDefault(false)
        ) {
            Log.w(TAG, "this WebView has no document-start hook; the polyfill cannot be installed")
            return false
        }
        return runCatching {
            WebViewCompat.addDocumentStartJavaScript(view, script, setOf("*"))
            Log.i(TAG, "the compat polyfill runs at document start")
            true
        }.getOrElse {
            Log.w(TAG, "the compat polyfill could not be installed", it)
            false
        }
    }

    /**
     * 打开 WebView 那一份的**应用详情页**
     *
     * 那正是指引第 2 步要看的地方: 它是不是被停用了、有没有「卸载更新」那一行 (先退回出厂版再回
     * 商店更新, 是国产 ROM 上最常见的那条自救路)
     *
     * @return 打开了哪儿 (给日志看); 起不来时回 null
     */
    fun openDetails(context: Context, info: Info): String? {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.parse("package:${info.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return if (runCatching { context.startActivity(intent) }.isSuccess) "details:${info.packageName}" else null
    }

    /**
     * 打开应用商店里那一份的详情页 (商店自己会给那个「更新」按钮)
     *
     * 与详情页分开两个按钮: 国内很多机器上 `market://` 落不到"这一份"上, 而应用详情页一定能开
     * @return 打开了哪儿 (给日志看); 起不来时回 null
     */
    fun openMarket(context: Context, info: Info): String? {
        val intent = Intent(Intent.ACTION_VIEW)
            .setData(Uri.parse("market://details?id=${info.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return if (runCatching { context.startActivity(intent) }.isSuccess) "market:${info.packageName}" else null
    }

    private const val SCRIPT = "web/lw-compat.js"
    private const val UNKNOWN_PACKAGE = "android.webkit"

    /**
     * 页面报上来的那一段 (见 asset 末尾): `{"ua":…,"fixed":[…],"missing":[…]}` 的 JSON 字符串
     *
     * 回调可能在 JS 那条线程上, 所以一律 post 回主线程再动 Compose 状态 —— 直接写会撞
     * "Snapshot apply is not allowed" 那一类错
     */
    class Bridge(private val onReport: (List<String>, List<String>) -> Unit) {

        @JavascriptInterface
        fun report(json: String) {
            val parsed = runCatching { JSONObject(json) }.getOrNull() ?: return
            val missing = strings(parsed, "missing")
            val fixed = strings(parsed, "fixed")
            Handler(Looper.getMainLooper()).post { onReport(missing, fixed) }
        }

        private fun strings(source: JSONObject, key: String): List<String> {
            val array = source.optJSONArray(key) ?: return emptyList()
            return (0 until array.length()).mapNotNull { array.optString(it)?.takeIf { it.isNotBlank() } }
        }
    }
}

/**
 * "界面起不来"那一问 (真 `Dialog`: WebView 是同窗口的子 View, Miuix 的 OverlayDialog 盖不住它)
 *
 * 两种触发, 正文不同、下面那几步一样:
 * - 页面报上来"还缺这些 API" ([missing] 非空) —— polyfill 没垫全, 这一档最该去更新
 * - 12 秒还没 ready ([stuck]) —— 连报告都没上来, 可能是更老的引擎在解析期就死了
 *
 * **正文是分步的更新指引** (2026-10-26 主人: "加 webview 更新指引"): 只说"去更新 WebView"对普通人
 * 不够用 —— 到底更新哪一个包、商店里没有更新怎么办、分身里那一份算不算、更新完怎么确认, 四步都要
 * 写在眼前。两个入口 (应用详情页 / 应用商店) 是分开的: `market://` 在国产 ROM 上经常落不对地方,
 * 而应用详情页一直有; 「重试」与「先这样用」照旧 (关窗不记任何记号, 下次进来还会再判一次)
 */
@Composable
internal fun WebViewTroubleDialog(
    info: WebCompat.Info,
    missing: List<String>,
    stuck: Boolean,
    onDismiss: () -> Unit,
    onRetry: () -> Unit,
) {
    if (missing.isEmpty() && !stuck) return
    val context = LocalContext.current
    val noDetails = stringResource(R.string.webview_trouble_no_settings)
    val noMarket = stringResource(R.string.webview_trouble_no_market)
    val reason = if (missing.isNotEmpty()) {
        stringResource(R.string.webview_trouble_missing, info.label, missing.joinToString(", "))
    } else {
        stringResource(R.string.webview_trouble_slow, STUCK_SECONDS, info.label)
    }
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        val scrim = remember { MutableInteractionSource() }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.4f))
                .clickable(interactionSource = scrim, indication = null) { onDismiss() },
            contentAlignment = Alignment.Center,
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    // 卡片自己吃掉点击, 不然点正文也会关窗
                    .clickable(interactionSource = scrim, indication = null) {},
            ) {
                // 只有正文滚, 按钮钉在卡片底下 —— 弹窗自己不会滚, 四步加读数在小屏上会超出去
                Column(
                    modifier = Modifier
                        .heightIn(max = 520.dp)
                        .verticalScroll(rememberScrollState())
                        .padding(start = 24.dp, end = 24.dp, top = 24.dp),
                ) {
                    Text(
                        text = stringResource(R.string.webview_trouble_title),
                        style = MiuixTheme.textStyles.title3,
                    )
                    Text(
                        text = reason,
                        style = MiuixTheme.textStyles.body2,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                    Text(
                        text = stringResource(R.string.webview_trouble_steps),
                        style = MiuixTheme.textStyles.body2,
                        modifier = Modifier.padding(top = 16.dp),
                    )
                    Text(
                        text = stringResource(R.string.webview_trouble_step_store, info.packageName),
                        style = MiuixTheme.textStyles.body2,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    Text(
                        text = stringResource(R.string.webview_trouble_step_manual),
                        style = MiuixTheme.textStyles.body2,
                        color = colorScheme.onSurfaceVariantSummary,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    Text(
                        text = stringResource(R.string.webview_trouble_step_multi),
                        style = MiuixTheme.textStyles.body2,
                        color = colorScheme.onSurfaceVariantSummary,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    Text(
                        text = stringResource(R.string.webview_trouble_step_reopen),
                        style = MiuixTheme.textStyles.body2,
                        color = colorScheme.onSurfaceVariantSummary,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    Text(
                        text = stringResource(R.string.webview_trouble_target, WebCompat.MIN_MAJOR),
                        style = MiuixTheme.textStyles.footnote1,
                        color = colorScheme.onSurfaceVariantSummary,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
                Column(modifier = Modifier.padding(24.dp)) {
                    TextButton(
                        text = stringResource(R.string.webview_trouble_details),
                        onClick = {
                            if (WebCompat.openDetails(context, info) == null) {
                                Toast.makeText(context, noDetails, Toast.LENGTH_LONG).show()
                            }
                            onDismiss()
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.textButtonColorsPrimary(),
                    )
                    Row(horizontalArrangement = Arrangement.SpaceBetween) {
                        TextButton(
                            text = stringResource(R.string.webview_trouble_market),
                            onClick = {
                                if (WebCompat.openMarket(context, info) == null) {
                                    Toast.makeText(context, noMarket, Toast.LENGTH_LONG).show()
                                }
                                onDismiss()
                            },
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(20.dp))
                        TextButton(
                            text = stringResource(R.string.webview_trouble_later),
                            onClick = onDismiss,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    TextButton(
                        text = stringResource(R.string.webview_trouble_retry),
                        onClick = {
                            onDismiss()
                            onRetry()
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp),
                    )
                }
            }
        }
    }
}

/** 卡住那一档在正文里报的秒数, 与 [HostScreen] 那个计时器同一个数 */
internal const val STUCK_SECONDS = 12
