package io.github.yuloong07star.luwi.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import io.github.yuloong07star.luwi.R
import java.io.File
import java.io.FileInputStream
import org.json.JSONObject

/**
 * 点一下图 / 文件名弹出来的那一块窗 (**悬浮窗, 2026-11-09; 2026-11-10 与门户那一窗对齐**)
 *
 * 主人这一批的两句原话:
 *
 * 1. "office 文件在 ball 打不开, 这个也修一下" —— 原来球上对 docx / pptx / xlsx 只说一句"要在别的
 *    应用里看", 而这台手机上开 docx 只会弹 QQ、飞书那几个 (2026-11-09 的读数)。现在**自己解**:
 *    正文走那块小 WebView, 里面装的是 `assets/web/lw-office.js` —— 它与门户那张窗用的是**同一份
 *    渲染核心** (`presets/docx-preview/src/index.js` 打出来的 lite bundle, 见
 *    `tools/build-office-lite.mjs`), 于是"门户能看、球不能看"这件事不会再有
 * 2. "门户和 ball 的预览弹窗应该要一样的" —— 外壳照门户那一窗抄: 78% 屏高的浅色卡、28 圆角、
 *    左边文件名 + 右边 `×`、正文区自己滚。差别只剩一个: PDF 在这一侧是原生 `PdfRenderer` 画第一页
 *    (WebView 自己不解 PDF), 其余三档 (图 / 文本 / office) 都在页面里, 与门户同一套 CSS
 *
 * 收口三条: 点遮罩关、点 `×` 关、返回键关。同一刻只留一块 (再点一次先关旧的)
 */
internal object BallPreview {

    /** 要预览的那一份 (图与文件走的都是它) */
    data class Request(
        /** 盘上那一份; 不在时回一句"这一份不在了" */
        val file: File,
        /** 标题上那个名字 */
        val name: String,
        val bytes: Long,
    )

    private var root: View? = null
    private var manager: WindowManager? = null

    /** 现在开着没有: 输入框那笔"没人碰就收"的账要认它 (见 `OverlayService` 的 boxIdle) */
    val isOpen: Boolean get() = root != null

    /**
     * 弹一块预览窗
     *
     * @param note 说不出口的那几句 (窗被系统拒了 / 打不开这一份) 走调用方的提示
     */
    fun show(context: Context, window: WindowManager, request: Request, note: (String) -> Unit) {
        close()
        val metrics = context.resources.displayMetrics
        val dp = { value: Int -> (value * metrics.density).toInt() }
        val cardWidth = (metrics.widthPixels - dp(MARGIN_DP) * 2).coerceAtLeast(dp(240))
        val cardHeight = (metrics.heightPixels * HEIGHT_PERCENT / 100).coerceAtLeast(dp(240))

        // 遮罩: 全屏, 40% 黑; 点它自己 (不是卡片) 就关
        val scrim = FrameLayout(context).apply {
            setBackgroundColor(SCRIM)
            isClickable = true
            setOnClickListener { close() }
        }
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                cornerRadius = dp(CARD_CORNER_DP).toFloat()
                setColor(BACKGROUND)
            }
            // 卡片自己吃掉点击: 不然点在卡片空白处会穿到遮罩上把窗关掉
            isClickable = true
            clipToOutline = true
        }

        val head = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(14), dp(10), dp(10))
        }
        val title = TextView(context).apply {
            text = request.name.ifEmpty { request.file.name }
            setTextColor(TEXT)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val closeButton = TextView(context).apply {
            text = "×"
            setTextColor(HINT)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            gravity = Gravity.CENTER
            setPadding(dp(10), dp(2), dp(10), dp(2))
            contentDescription = context.getString(R.string.ball_preview_close)
            setOnClickListener { close() }
        }
        head.addView(title)
        head.addView(
            closeButton,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )
        card.addView(
            head,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )

        val body = FrameLayout(context).apply {
            setPadding(dp(18), 0, dp(18), dp(16))
        }
        card.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        if (!request.file.isFile || request.file.length() <= 0L) {
            body.addView(caption(context, context.getString(R.string.ball_preview_missing)))
        } else if (BallMedia.kindOf(request.file.name) == BallMedia.Kind.PDF) {
            // PDF 这一档留在原生: WebView 自己不解 PDF (门户那一窗也是把它交给系统)
            fillPdf(context, body, cardWidth, cardHeight, request)
        } else {
            fillPage(context, body, request, note)
        }

        card.layoutParams = FrameLayout.LayoutParams(cardWidth, cardHeight).apply { gravity = Gravity.CENTER }
        scrim.addView(card)

        val layout = WindowManager.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            // 能获焦才收得到返回键
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            android.graphics.PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
        }
        try {
            window.addView(scrim, layout)
        } catch (error: Throwable) {
            note(context.getString(R.string.overlay_refused, error.message ?: error.toString()))
            return
        }
        root = scrim
        manager = window
        scrim.isFocusableInTouchMode = true
        scrim.requestFocus()
        scrim.setOnKeyListener { _, keyCode, event ->
            if (keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
                close()
                true
            } else {
                false
            }
        }
    }

    /** 关掉 (幂等; 没开着就什么都不做) */
    fun close() {
        val view = root ?: return
        root = null
        val window = manager
        manager = null
        runCatching { window?.removeView(view) }
    }

    /* ── 页面那一档: 图 / 文本 / office (与门户同一套 CSS) ──────────────────── */

    /**
     * 一块小 WebView 装那一页
     *
     * **文件字节怎么进去**: 不塞 base64 (office 十二兆时那串会卡死桥), 而是让页面 `fetch('/file')`,
     * 由 [WebViewClient.shouldInterceptRequest] 拦下来, 直接从盘上开一条流回去。只认这一个路径 ——
     * 其余一律 403, 于是页面里跑的东西够不到别处
     */
    @SuppressLint("SetJavaScriptEnabled")
    private fun fillPage(
        context: Context,
        body: FrameLayout,
        request: Request,
        note: (String) -> Unit,
    ) {
        val web = WebView(context).apply {
            setBackgroundColor(Color.TRANSPARENT)
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.domStorageEnabled = false
            settings.blockNetworkImage = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    req: WebResourceRequest,
                ): WebResourceResponse? {
                    val url = req.url
                    // **只认自己那一条**: 返回 null = "这条我不拦, 交给 WebView 自己处理" ——
                    // 少了这一句, 连 `loadDataWithBaseURL` 那一份主文档 (data:) 都会走到下面 403,
                    // 屏幕上就是 net::ERR_HTTP_RESPONSE_CODE_FAILURE (2026-11-10 第一次装机读数)
                    if (url.scheme != "https" || url.host != HOST) return null
                    if (url.path != "/file") return forbidden()
                    val stream = runCatching { FileInputStream(request.file) }.getOrNull()
                        ?: return WebResourceResponse(
                            "text/plain",
                            "utf-8",
                            404,
                            "Not Found",
                            mapOf("Cache-Control" to "no-store"),
                            java.io.ByteArrayInputStream(ByteArray(0)),
                        )
                    return WebResourceResponse(
                        mimeOf(request.file.name),
                        null,
                        200,
                        "OK",
                        mapOf("Cache-Control" to "no-store"),
                        stream,
                    )
                }

                override fun onReceivedError(
                    view: WebView,
                    req: WebResourceRequest,
                    error: android.webkit.WebResourceError,
                ) {
                    note(req.url?.toString() ?: error.description.toString())
                }
            }
        }
        web.addJavascriptInterface(
            object {
                @JavascriptInterface
                fun close() {
                    BallPreview.close()
                }
            },
            "LwPreview",
        )
        body.addView(
            web,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        val html = page(context, request)
        web.loadDataWithBaseURL("https://$HOST/", html, "text/html", "utf-8", null)
    }

    /**
     * 那一页: 外壳照门户 `#lwp-preview` 的卡片, 正文按档分
     *
     * office 那一份渲染核心是 `assets/web/lw-office.js` (打出来的 lite bundle), 直接内联进来 —— 于是
     * 这一页**不依赖网络**, 也不依赖 dsh 的模块表
     */
    private fun page(context: Context, request: Request): String {
        val kind = BallMedia.kindOf(request.file.name)
        val office = if (kind == BallMedia.Kind.OFFICE) readOfficeBundle(context) else ""
        // 内联进 `<script>` 之前把结束标签挡掉 (bundle 里万一有那一串, 页面会从那儿截断)
        val inline = office.replace("</script", "<\\/script")
        val kindName = when (kind) {
            BallMedia.Kind.IMAGE -> "image"
            BallMedia.Kind.TEXT -> "text"
            else -> "office"
        }
        // 名字 / 文案进 JS 之前过一遍 JSON 引号 (它们可能带引号 / 反斜杠)
        val name = JSONObject.quote(request.name.ifEmpty { request.file.name })
        val mime = JSONObject.quote(mimeOf(request.file.name))
        val truncated = JSONObject.quote(context.getString(R.string.ball_preview_truncated))
        val limit = BallMedia.MAX_TEXT_BYTES
        return """
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<style>
:root{color-scheme:light}
html,body{margin:0;height:100%;background:transparent}
body{display:flex;flex-direction:column;font:14px/1.5 system-ui,sans-serif;color:#18181b}
#body{flex:1;min-height:0;overflow:auto;padding:0 18px 16px}
#body.image{display:flex;align-items:center;justify-content:center;padding:0 18px 18px}
#body.image img{display:block;max-width:100%;max-height:100%;border-radius:12px}
pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;color:#18181b}
.note{font-size:12px;line-height:1.7;color:#6b7280;padding-top:6px}
</style></head><body>
<div id="body"></div>
<script>$inline</script>
<script>
(function(){
  var KIND = '$kindName', NAME = $name, MIME = $mime;
  var body = document.getElementById('body');
  function note(text){
    var d = document.createElement('div');
    d.className = 'note';
    d.textContent = text;
    body.appendChild(d);
  }
  function fail(error){
    body.textContent = '';
    note('这一份打不开：' + ((error && error.message) || error || '读不出来'));
  }
  async function run(){
    var res = await fetch('/file', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var bytes = new Uint8Array(await res.arrayBuffer());
    if (KIND === 'image') {
      body.className = 'image';
      var img = document.createElement('img');
      img.alt = '';
      img.src = URL.createObjectURL(new Blob([bytes], { type: MIME }));
      body.appendChild(img);
      return;
    }
    if (KIND === 'text') {
      var pre = document.createElement('pre');
      pre.textContent = new TextDecoder('utf-8').decode(bytes.subarray(0, $limit));
      body.appendChild(pre);
      if (bytes.length > $limit) note($truncated);
      return;
    }
    var core = window.__LW_OFFICE__;
    if (!core) throw new Error('渲染器没装进来');
    var out = await core.renderOffice(bytes, NAME);
    var host = document.createElement('div');
    body.appendChild(host);
    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>' + out.style + '</style>' + out.body;
  }
  run().catch(fail);
})();
</script></body></html>
""".trimIndent()
    }

    /** 那份 lite bundle (读不到就空串, 页面里那句"渲染器没装进来"会说清) */
    private fun readOfficeBundle(context: Context): String = runCatching {
        context.assets.open("web/lw-office.js").bufferedReader(Charsets.UTF_8).use { it.readText() }
    }.getOrDefault("")

    /** PDF: 原生画第一页 (WebView 自己不解 PDF), 其余外观与上面那张卡同一套 */
    private fun fillPdf(
        context: Context,
        body: FrameLayout,
        cardWidth: Int,
        cardHeight: Int,
        request: Request,
    ) {
        val metrics = context.resources.displayMetrics
        val dp = { value: Int -> (value * metrics.density).toInt() }
        val rendered = renderPdfFirstPage(request.file, cardWidth - dp(36), cardHeight - dp(HEAD_DP + FOOT_DP))
        if (rendered == null) {
            body.addView(caption(context, context.getString(R.string.ball_preview_missing)))
            return
        }
        val view = ImageView(context).apply {
            setImageBitmap(rendered.first)
            scaleType = ImageView.ScaleType.FIT_CENTER
            adjustViewBounds = true
        }
        val scroll = android.widget.ScrollView(context).apply { addView(view) }
        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(caption(context, context.getString(R.string.ball_preview_pages, rendered.second)))
            val size = BallMedia.sizeText(request.bytes)
            if (size.isNotEmpty()) addView(caption(context, size))
        }
        body.addView(
            column,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
    }

    /**
     * PDF 第一页 → 位图 (读不动 / 空文件 / 没有页 → null)
     *
     * 手写 `try`/`finally` 而不是 `use`: `PdfRenderer` 与 `PdfRenderer.Page` 的 `close()` 走的是
     * `AutoCloseable`, 两个都关干净这件事写清楚比省两行重要
     */
    private fun renderPdfFirstPage(file: File, maxWidth: Int, maxHeight: Int): Pair<Bitmap, Int>? {
        val descriptor = runCatching {
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        }.getOrNull() ?: return null
        var renderer: PdfRenderer? = null
        var page: PdfRenderer.Page? = null
        try {
            renderer = runCatching { PdfRenderer(descriptor) }.getOrNull() ?: return null
            if (renderer.pageCount <= 0) return null
            page = runCatching { renderer.openPage(0) }.getOrNull() ?: return null
            val scale = minOf(
                maxWidth.coerceAtLeast(1).toFloat() / page.width,
                maxHeight.coerceAtLeast(1).toFloat() / page.height,
            ).coerceAtMost(3f)
            val width = (page.width * scale).toInt().coerceAtLeast(1)
            val height = (page.height * scale).toInt().coerceAtLeast(1)
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply {
                eraseColor(Color.WHITE)
            }
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            return bitmap to renderer.pageCount
        } finally {
            runCatching { page?.close() }
            runCatching { renderer?.close() }
            runCatching { descriptor.close() }
        }
    }

    /** 这一份给页面时说什么 mime (图要它, 文本与 office 只当字节流) */
    private fun mimeOf(name: String): String = when (BallMedia.extensionOf(name)) {
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "gif" -> "image/gif"
        "txt", "md", "json", "csv", "log" -> "text/plain; charset=utf-8"
        "pdf" -> "application/pdf"
        "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        else -> "application/octet-stream"
    }

    /** 页面里跑到别的路径 → 403 (页面只该取 `/file` 那一条) */
    private fun forbidden(): WebResourceResponse = WebResourceResponse(
        "text/plain",
        "utf-8",
        403,
        "Forbidden",
        mapOf("Cache-Control" to "no-store"),
        java.io.ByteArrayInputStream(ByteArray(0)),
    )

    /** 一行小字 (说不出口的那几句都长这样) */
    private fun caption(context: Context, text: String): TextView = TextView(context).apply {
        this.text = text
        setTextColor(HINT)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        setPadding(0, (6 * context.resources.displayMetrics.density).toInt(), 0, 0)
    }

    /* ── 常量 (2026-11-10: 与门户那一窗对齐) ───────────────────────────────── */

    /** 拦截用的假域名: 页面只认 `https://lw.local/file` 这一条 */
    private const val HOST = "lw.local"

    /** 左右各留多少 (dp): 与门户的 `20px` 同一个数 */
    private const val MARGIN_DP = 20

    /** 卡片高 = 屏高乘这个比例: 与门户的 `78vh` 同一个数 */
    private const val HEIGHT_PERCENT = 78

    /** 卡片圆角 (dp): 门户那一窗是 `--dsw-radius-panel` 28 */
    private const val CARD_CORNER_DP = 28

    /** 头顶那一行 / 脚下那一句各占多少 (算图能有多大时扣掉) */
    private const val HEAD_DP = 56
    private const val FOOT_DP = 40

    private val SCRIM = 0x66000000
    private val BACKGROUND = 0xFFFFFFFF.toInt()
    private val TEXT = 0xFF18181B.toInt()
    private val HINT = 0xFF6B7280.toInt()
}
