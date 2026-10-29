package io.github.yuloong07star.luwi.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.util.Log
import io.github.yuloong07star.luwi.host.DshHost
import io.github.yuloong07star.luwi.plugin.theme.BallTheme
import java.io.File
import org.json.JSONObject

/**
 * 开屏那一屏的**文件接口** (2026-10-25 主人: "接口文档放当前已开放的接口", "让用户用 agent 自行设计开屏动画")
 *
 * 契约只有一个文件: `$DSH_HOME/lw/splash.json`, 素材落在 `$DSH_HOME/lw/splash/`。文档正文在
 * `assets/splash/README.md`, 每次开屏之前 [seedDoc] 把它抄进 `$DSH_HOME/lw/splash/README.md`
 * (里面把 `$DSH_HOME` 换成了这台机器的绝对路径) —— **agent 读那份就能干活**, 设置页那段对话框显示的
 * 也是同一份, 一个来源
 *
 * 为什么不做成设置页里那几个下拉/开关 (2026-10-25 当晚改的口径): 主人要的是"agent 自己设计", 而
 * 几个布尔值撑不起"设计" —— 一个 JSON 就能带走图标/动效/配色/文案, agent 直接写文件, 应用下一次开屏
 * 就换。设置页只留**文档**与两个动作 (交给 agent / 恢复默认)
 *
 * 三条纪律:
 *
 * 1. **逐字段回退**: 哪一项写错 (颜色不合法 / motion 认不出 / 图不在), 只有那一项回缺省, 其余照用;
 *    被拒的那几项进 logcat (tag `LwSplash`) —— 一份 JSON 写坏一个字段就整屏退回缺省, 那是 agent 最容易
 *    踩、又最难看懂的一种
 * 2. **图有两道闸**: 原始 ≤ [MAX_BYTES], 解码长边 ≤ [DECODE_MAX_PX] (手机照片直接解进开屏就是一次卡)
 * 3. **读不到一律回缺省**: 文件不在 / JSON 坏了 / 版本不认识 —— 开屏这一屏最不该让 app 看起来像坏了
 */
internal object SplashSetting {

    private const val TAG = "LwSplash"

    /** 契约文件: `$DSH_HOME/lw/splash.json` */
    private const val CONFIG_NAME = "splash.json"

    /** 素材目录: `$DSH_HOME/lw/splash/` (接口文档不在这儿了, 见 [io.github.yuloong07star.luwi.host.LwInterfaces]) */
    private const val FOLDER = "splash"

    /** 只认这一版; 别的值整份忽略 (留给以后换形状) */
    const val VERSION = 1

    /** 图标原文件的上限 (8 MB): 一张锁屏壁纸量级的图, 再大就不是"图标"了 */
    const val MAX_BYTES = 8L * 1024 * 1024

    /** 解码长边的上限 (px): 开屏这块再大也看不出差别 */
    const val DECODE_MAX_PX = 480

    /** 默认那一行小字 (文档里也写着同一句) */
    const val DEFAULT_CREDIT = "powered by deepseek harness"

    /** 转圈 / 呼吸 / 不转 */
    enum class Motion { SPIN, PULSE, NONE }

    /**
     * 这一屏现在该是什么样
     *
     * @property icon 解出来的那张图 (已经过路径与存在性检查); null = 用 Luwi 自己的标记
     * @property accent 环与进度条的颜色; null = 跟随主题
     * @property background 整屏底色; null = 跟随主题
     * @property title 图标下面那句话; 空 = 用当前阶段 (正在启动 host 等)
     * @property subtitle 再下面一行小字; 空 = 不显示
     * @property credit 最底下那行; 空 = 不显示
     */
    data class Config(
        val motion: Motion = Motion.SPIN,
        val icon: File? = null,
        val accent: Int? = null,
        val background: Int? = null,
        val showLog: Boolean = true,
        val title: String = "",
        val subtitle: String = "",
        val credit: String = DEFAULT_CREDIT,
    )

    private fun home(context: Context): File = File(context.filesDir, DshHost.HOME_DIR)

    fun configFile(context: Context): File = File(File(home(context), "lw"), CONFIG_NAME)

    fun assetsDir(context: Context): File = File(File(home(context), "lw"), FOLDER)

    /* ── 读那一份 JSON ─────────────────────────────────────────────────── */

    /**
     * 现在生效的那一份
     *
     * 每一段都单独 `runCatching`: 一个字段写坏了不该带走其余字段 (见文件头第 1 条纪律)
     */
    fun config(context: Context): Config {
        val defaults = Config()
        val file = configFile(context)
        if (!file.isFile) return defaults
        val root = runCatching { JSONObject(file.readText()) }.getOrElse {
            Log.w(TAG, "$CONFIG_NAME is not valid JSON, so the default splash is used: ${it.message}")
            return defaults
        }
        val version = runCatching { root.optInt("version", VERSION) }.getOrDefault(VERSION)
        if (version != VERSION) {
            Log.w(TAG, "$CONFIG_NAME declares version $version; this build only reads $VERSION, so it is ignored")
            return defaults
        }
        val motion = field("motion") {
            motionOf(root.optString("motion", "").ifBlank { null })
        } ?: defaults.motion
        val accent = field("accent") { BallTheme.parseColor(root.optString("accent", "").ifBlank { null }) }
        val background = field("background") { BallTheme.parseColor(root.optString("background", "").ifBlank { null }) }
        val showLog = field("log") { if (root.has("log")) root.getBoolean("log") else defaults.showLog }
            ?: defaults.showLog
        val title = text(root, "title") ?: defaults.title
        val subtitle = text(root, "subtitle") ?: defaults.subtitle
        // credit 的"空串 = 不显示"是有意的: 所以它不能走"空 = 缺省"那条路
        val credit = if (root.has("credit")) root.optString("credit", "") else defaults.credit
        return Config(
            motion = motion,
            icon = icon(context, root),
            accent = accent,
            background = background,
            showLog = showLog,
            title = if (title.length <= TEXT_MAX) title else "",
            subtitle = if (subtitle.length <= TEXT_MAX) subtitle else "",
            credit = if (credit.length <= TEXT_MAX) credit else defaults.credit,
        )
    }

    /** 一段字段的读法: 抛出去的都只算"这一项不认", 记一行日志 */
    private inline fun <T> field(name: String, read: () -> T?): T? = runCatching { read() }.getOrElse {
        Log.w(TAG, "splash.json 的 $name 用不了, 这一项回缺省: ${it.message}")
        null
    }

    private fun text(root: JSONObject, key: String): String? =
        runCatching { root.optString(key, "").trim() }.getOrNull()

    /**
     * `icon` 那一条: 相对 `splash/` 的文件名
     *
     * 路径纪律与插件那一摊同一条 ([PluginPaths.requireRelative] 的规则): 不许绝对路径、不许 `..`、
     * 不许反斜杠。查不过 / 文件不在都只算"这一项不认"
     */
    private fun icon(context: Context, root: JSONObject): File? = field("icon") {
        val name = root.optString("icon", "").trim()
        if (name.isEmpty()) return@field null
        if (name.startsWith("/") || name.contains('\\') || name.split('/').any { it.isEmpty() || it == "." || it == ".." }) {
            Log.w(TAG, "splash.json 的 icon 只能是 splash/ 里的相对路径, 这一个被拒: $name")
            return@field null
        }
        val file = File(assetsDir(context), name)
        if (!file.isFile) {
            Log.w(TAG, "splash.json 说的 icon 不在: ${file.absolutePath}")
            return@field null
        }
        file
    }

    /** 一张图的大小与时间: 换了图 (或删了) 才重新解码, 免得每次重组都解一遍 */
    fun stamp(file: File?): Long = runCatching {
        if (file == null || !file.isFile) 0L else file.length() * 31 + file.lastModified()
    }.getOrDefault(0L)

    /* ── 解那一张图 ─────────────────────────────────────────────────────── */

    /** 解一张: 长边压到 [maxPx] 以内, 并认 EXIF 的那个方向; 解不出来回 null (调用方用默认标记) */
    fun decode(file: File?, maxPx: Int = DECODE_MAX_PX): Bitmap? {
        if (file == null || !file.isFile) return null
        if (file.length() > MAX_BYTES) {
            Log.w(TAG, "the splash icon is larger than ${MAX_BYTES / 1024 / 1024} MB, so it is ignored")
            return null
        }
        return runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            val options = BitmapFactory.Options().apply {
                inSampleSize = pickDecodeSample(bounds.outWidth, bounds.outHeight, maxPx)
            }
            val bitmap = BitmapFactory.decodeFile(file.absolutePath, options) ?: return null
            rotate(bitmap, orientationOf(file))
        }.onFailure { Log.w(TAG, "the splash icon could not be decoded", it) }.getOrNull()
    }

    private fun orientationOf(file: File): Int = runCatching {
        ExifInterface(file.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)

    private fun rotate(bitmap: Bitmap, orientation: Int): Bitmap {
        val degrees = when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> return bitmap
        }
        return runCatching {
            val matrix = Matrix().apply { postRotate(degrees) }
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        }.getOrDefault(bitmap)
    }

    /* ── 纯算术: 判据在 SplashSettingTest ────────────────────────────────── */

    /** 存着的那个名字 -> 枚举; 认不出来 (没写 / 写坏) 回 [Motion.SPIN] */
    fun motionOf(raw: String?): Motion = when (raw?.trim()?.lowercase()) {
        "pulse" -> Motion.PULSE
        "none" -> Motion.NONE
        else -> Motion.SPIN
    }

    /**
     * 解码时该跳几个像素: 长边缩到 `maxPx` 以内
     *
     * `inSampleSize` 只能取 2 的幂, 所以跳完那一档仍**不小于** `maxPx` (宁可多解一点也别糊);
     * 按**长边**算而不是短边 —— 开屏那张图多半是方图或竖图, 按短边算会把长边放过上限
     */
    fun pickDecodeSample(width: Int, height: Int, maxPx: Int): Int {
        val longest = maxOf(width, height)
        if (maxPx <= 0 || longest <= 0) return 1
        var sample = 1
        while (longest / (sample * 2) >= maxPx) sample *= 2
        return sample
    }

    /**
     * 底色深不深 (给"自己配了底色"那一档挑字色用)
     *
     * 不按转换后的线性空间算: 开屏上那几行字要的是"看得清", 而 sRGB 加权已经够判断深浅
     * (阈值 0.5 与 `TavernManageScreen` 那条同一个量级)。**认不出来一律按浅底** —— 那样至少不会把
     * 深色字写到深底上
     */
    fun isDark(color: Int): Boolean {
        val red = (color shr 16) and 0xFF
        val green = (color shr 8) and 0xFF
        val blue = color and 0xFF
        val luminance = (0.2126f * red + 0.7152f * green + 0.0722f * blue) / 255f
        return luminance < 0.5f
    }

    /** 文案的上限: 开屏那一屏只有几行, 太长的句子会把图标挤掉 */
    const val TEXT_MAX = 80
}
