package io.github.yuloong07star.luwi.tool

import android.content.Context
import io.github.yuloong07star.luwi.host.DshHost
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import org.json.JSONObject
import java.io.File

/**
 * 她说的话: `$DSH_HOME/lw/out/<sessionId>.jsonl` (**唯一解析器**, 2026-11-08)
 *
 * 方案 §3.2–3.3 的中心口径是「发球 = 发对话层」: `lw_say` 一次调用只写这一份, 门户
 * ([io.github.yuloong07star.luwi.ui.PortalBridge.portalOut]) 与浮球
 * ([io.github.yuloong07star.luwi.overlay.OverlayService]) **读同一份** —— 一条 `seq`、一个 `gapMs`、
 * 同一个条数。所以读法只许有一处实现, 就是这里; 两边各自再写一份 `split('\n')` 就会漂。
 *
 * 一行一条 (宿主是唯一写者, 追加写):
 *
 * ```json
 * {"seq":1,"at":1730000000000,"gapMs":0,"kind":"text","text":"在的。"}
 * {"seq":2,"at":1730000001060,"gapMs":1060,"roll":0.41,"kind":"text","text":"刚才在写东西。"}
 * {"seq":3,"at":1730000002300,"gapMs":1240,"roll":0.37,"kind":"sticker","sticker":"开心","text":"[…]"}
 * {"seq":4,"at":1730000003300,"gapMs":1000,"roll":0.55,"kind":"image","rel":"assets/…/4-a.png",
 *  "thumb":"assets/…/4-a.png","w":1080,"h":2460,"text":"这一屏就是那个开关"}
 * ```
 *
 * 三条纪律 (与宿主 `host-plugin/index.mjs` 那一侧逐字对应):
 *
 * 1. **末行解不开就跳过, 不推进水位** —— 一面 append 一面读, 最后一行可能是半截 JSON; 推进了水位那条
 *    就永远丢了, 不推进则下一拍还能读到完整的一行
 * 2. **`seq` 是唯一顺序**, `at` 只用来显示与跟 dsh 快照拼时间轴 (宿主保证它单调)
 * 3. **`gapMs` 是"这一行上屏前要等多久"**, 而"等多久"从上一行上屏那一刻算起 (见 [dueAt])
 */
internal object OutFile {

    /** 与宿主那侧同一个约定 (谁都不许单边改) */
    const val DIRECTORY = "lw"
    const val SUBDIR = "out"
    const val ASSETS = "assets"
    const val SUFFIX = ".jsonl"

    /**
     * 图路由的前缀: 门户那一侧拼 `/lw-out/` + 行里的 `rel`, 宿主插件注册的是同一个串
     *
     * 它在这边只是**判据要比对的那串** (页面在 WebView 里自己拼 URL, 应用这一侧不发请求)
     */
    const val ROUTE = "/lw-out"

    /** `kind` 只有这几种 (`voice` 只由底层的 `lw_speak` 用, 模型侧不出现) */
    private val KINDS = setOf("text", "sticker", "image", "file", "voice")

    /** 一次最多回多少行 (历史很长时只回最近这些 —— 打开一场旧会话不该搬几兆 JSON) */
    private const val PAGE_LIMIT = 2000

    /** 解析那一份 jsonl 用的 (不认识的多余键忽略: 宿主以后加字段不该让旧版本读不动) */
    private val json = Json { ignoreUnknownKeys = true }

    /** 这一场一张文件 */
    fun dir(context: Context): File =
        File(File(File(context.filesDir, DshHost.HOME_DIR), DIRECTORY), SUBDIR)

    /**
     * 会话 id → 文件名 (不带后缀)
     *
     * **规则与宿主 `lwOutId()` 逐字相同**: 只留 `[0-9A-Za-z._-]`, 其余换成下划线, 最长 96。dsh 的会话
     * id 本来就只用这些字符, 这条映射是为了"万一不是"也不至于拼出一条路径
     */
    fun safeId(sessionId: String): String {
        val raw = sessionId.trim()
        if (raw.isEmpty()) return ""
        val kept = StringBuilder()
        for (ch in raw) {
            kept.append(if (ch.isLetterOrDigit() && ch.code < 128 || ch == '.' || ch == '_' || ch == '-') ch else '_')
        }
        return kept.toString().take(96)
    }

    /** 那一场那份文件; id 空时 null */
    fun file(context: Context, sessionId: String): File? {
        val id = safeId(sessionId)
        return if (id.isEmpty()) null else File(dir(context), "$id$SUFFIX")
    }

    /** 一行话 */
    data class Line(
        val seq: Int,
        val at: Long,
        val gapMs: Long,
        val kind: String,
        val text: String,
        val sticker: String,
        val rel: String,
        val thumb: String,
        val w: Int,
        val h: Int,
        /** `kind=file` 那一行的原文件名与字节数 (门户只写名字, 点开才预览) */
        val name: String = "",
        val bytes: Long = 0L,
    ) {
        /** 有正文才算"一句话" (表情与纯图没有) */
        val hasText: Boolean get() = text.isNotEmpty()

        fun toJson(): JSONObject = JSONObject().apply {
            put("seq", seq)
            put("at", at)
            put("gapMs", gapMs)
            put("kind", kind)
            put("text", text)
            put("sticker", sticker)
            put("rel", rel)
            put("thumb", thumb)
            put("w", w)
            put("h", h)
            put("name", name)
            put("bytes", bytes)
        }
    }

    /**
     * 一行文本 → [Line], 解不开就 null (撕裂行 / 坏行 / 不认识的 `kind`)
     *
     * `seq` 不是正整数的行**当作坏行**: 水位全靠它, 一条 `seq` 读歪的行会让后面全部卡住
     *
     * 解析用 `kotlinx.serialization` 而不是 `org.json`: 后者是 Android 框架里的类, 在 JVM 单测里只会抛
     * "not mocked" —— 而这几个纯函数正是要在没有设备的地方也量得动 (见 `OutFileTest`)
     */
    fun parse(text: String): Line? {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return null
        val root = runCatching { json.parseToJsonElement(trimmed) as? JsonObject }.getOrNull() ?: return null
        val seq = root.intOf("seq") ?: return null
        if (seq <= 0) return null
        val kind = root.textOf("kind").ifEmpty { "text" }
        if (kind !in KINDS) return null
        return Line(
            seq = seq,
            at = root.longOf("at") ?: 0L,
            gapMs = (root.longOf("gapMs") ?: 0L).coerceAtLeast(0L),
            kind = kind,
            text = root.textOf("text"),
            sticker = root.textOf("sticker"),
            rel = root.textOf("rel"),
            thumb = root.textOf("thumb"),
            w = root.intOf("w") ?: 0,
            h = root.intOf("h") ?: 0,
            name = root.textOf("name"),
            bytes = root.longOf("bytes") ?: 0L,
        )
    }

    private fun JsonObject.intOf(key: String): Int? =
        runCatching { this[key]?.jsonPrimitive?.intOrNull }.getOrNull()

    private fun JsonObject.longOf(key: String): Long? =
        runCatching { this[key]?.jsonPrimitive?.longOrNull }.getOrNull()

    private fun JsonObject.textOf(key: String): String =
        runCatching { this[key]?.jsonPrimitive?.contentOrNull }.getOrNull().orEmpty()

    /**
     * 一次读页: `next <= 0` 回**全量**(含历史), 否则只回 `seq > next` 的尾巴
     *
     * 两段水位是方案 §3.4 那一条, 别再只写"只回尾巴": 打开/换会话要拿全量 (直接画、不排队, 否则打开
     * 旧会话像慢放录像), 之后只取增量 (否则每次重开都是空的)
     */
    data class Page(
        val session: String,
        val lines: List<Line>,
        /** 这一页最后一条的 `seq` (没有行时原样回传入的 `next`) */
        val next: Int,
        /** 文件里最大的 `seq` (球那一侧按它定初始水位) */
        val max: Int,
    )

    fun page(context: Context, sessionId: String, next: Int): Page {
        val id = safeId(sessionId)
        val target = file(context, sessionId)
        if (target == null || !target.isFile) return Page(id, emptyList(), next.coerceAtLeast(0), 0)
        val lines = mutableListOf<Line>()
        var max = 0
        var last = next.coerceAtLeast(0)
        // 读全文再按行切: 一份 jsonl 一场几十 KB, 而 `RandomAccessFile` 那套按字节找行号更容易出错
        val body = runCatching { target.readText() }.getOrNull().orEmpty()
        for (raw in body.split('\n')) {
            val line = parse(raw) ?: continue
            if (line.seq > max) max = line.seq
            if (next > 0 && line.seq <= next) continue
            lines.add(line)
            last = line.seq
        }
        val kept = if (lines.size > PAGE_LIMIT) lines.subList(lines.size - PAGE_LIMIT, lines.size) else lines
        return Page(id, kept, if (kept.isEmpty()) last else kept.last().seq, max)
    }

    /** 文件里最大的 `seq` (没有文件 / 空文件 = 0) */
    fun maxSeq(context: Context, sessionId: String): Int {
        val target = file(context, sessionId) ?: return 0
        if (!target.isFile) return 0
        val body = runCatching { target.readText() }.getOrNull().orEmpty()
        var max = 0
        for (raw in body.split('\n')) {
            val line = parse(raw) ?: continue
            if (line.seq > max) max = line.seq
        }
        return max
    }

    /** 现在有哪几场 (按 jsonl 的修改时间从新到旧; 空 = 一场都还没说过话) */
    fun sessions(context: Context): List<String> = runCatching {
        dir(context).listFiles()
            ?.filter { it.isFile && it.name.endsWith(SUFFIX) }
            ?.sortedByDescending { it.lastModified() }
            ?.map { it.name.removeSuffix(SUFFIX) }
            .orEmpty()
    }.getOrDefault(emptyList())

    /**
     * 行里那个 `rel` → 盘上的那张图 (读侧的 `..` 那几条挡在这里)
     *
     * 只认 `assets/` 下面、且 canonical 路径真的落在 `lw/out/assets` 之内; 扩展名不查 (宿主写侧已经查过),
     * 这里只保证"读不到就回 null", 于是球那侧照实画一句"图没取到"而不是静默
     */
    fun asset(context: Context, rel: String): File? {
        val wanted = rel.trim()
        if (wanted.isEmpty() || wanted.contains("..") || wanted.contains('\\') || wanted.contains('\u0000')) return null
        if (!wanted.startsWith("$ASSETS/")) return null
        val root = File(dir(context), ASSETS)
        val target = File(dir(context), wanted)
        val rootPath = runCatching { root.canonicalPath }.getOrDefault(root.path)
        val targetPath = runCatching { target.canonicalPath }.getOrDefault(target.path)
        if (!targetPath.startsWith("$rootPath/")) return null
        return target.takeIf { it.isFile }
    }

    /**
     * "这一行什么时候该上屏" (纯算术, 两个渲染器同一套)
     *
     * `gapMs` 是"距上一行上屏要隔多久", 而上一行可能已经上屏很久了 —— 所以真正的到期时刻取
     * `max(现在, 上一行时刻 + gapMs)`。于是:
     *
     * - 一屏齐出的三条 (宿主同一拍写进来) 会按 `gapMs` 一条一条放
     * - 隔了十分钟才说的那一句**立刻**上屏 (间隔早就满足了, 不是再等 1 秒)
     * - 会话第一行 `gapMs = 0`, 天然立刻
     */
    fun dueAt(lastReleaseAt: Long, gapMs: Long, now: Long): Long {
        if (lastReleaseAt <= 0L) return now
        val due = lastReleaseAt + gapMs.coerceAtLeast(0L)
        return if (due < now) now else due
    }
}
