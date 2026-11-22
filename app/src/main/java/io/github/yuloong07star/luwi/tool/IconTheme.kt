package io.github.yuloong07star.luwi.tool

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 图标套的运行时那一侧 (2026-11-22): 切桌面入口、给应用内那几处供图、给通知供 small icon
 *
 * **一套图标要同时喂五类位置** (主人: "切换时要确保所有用到图标的情况都要切换"):
 *
 * | 位置 | 走哪一条 |
 * | :-- | :-- |
 * | 桌面图标 / roundIcon / 启动闪屏 / 最近任务 / 应用信息 | `activity-alias` ([apply]) |
 * | 球 / 开屏 / 桌面组件 | [markRes] 与 [markBitmap] (画布原样, 尺寸按 [boxDpForInk] 换算) |
 * | 门户头像 / 空态那张脸 / 设置里的缩略图 | [markTightBitmap] (**紧裁填满**, 见那一支的注释) |
 * | 五处通知 | [notificationIcon]; 三条常驻通知由 [watch] 随切随重投 |
 *
 * 桌面那一条**只有 alias 一条路**: 启动器读的是 APK 里的资源, 系统没有"运行时替换自己 launcher
 * icon"的 API, 所以每套图标必须在构建时就有一份资源与一个 alias (`IconSet.alias` 与清单逐字对齐)
 *
 * 切的时候**先启用新的、再停旧的** (见 [IconSet.switchPlan]): 反过来那一瞬间桌面上一个入口都没有,
 * 部分 ROM 会就此把图标清掉。任何一步失败都回滚到原来那一套并回 `false`, 由界面如实说一句
 */
internal object IconTheme {

    private const val TAG = "LwIcon"

    /**
     * 内置那份矢量里墨迹占画布的比例 (2026-10-06 定下的 0.46, 球与开屏都按它换算)
     *
     * 它是**内置那一套自己的数**, 别拿它去套别的图: 新套的 [IconSet.markInkRatio] 各有各的值
     * (女仆那张是满幅紧裁, 于是 1.0)
     */
    const val BASE_INK_RATIO = 0.46f

    /** 应用内标记解码的上限 (球 48dp / 开屏 112dp, 3x 屏上 512 已经两倍有余) */
    private const val MARK_BITMAP_PX = 512

    /**
     * 交出去那份 (门户 / 缩略图) 先按这个边长渲染一遍
     *
     * 内置那份矢量只有 108dp (`ic_launcher_foreground`) 的 intrinsic, 在 3x 屏上约 300px; 直接按
     * intrinsic 画, 紧裁之后只剩 0.46 那一小块, 再放到 96dp 的空态里就糊了。矢量按请求边长重绘
     * 不吃这个亏 —— 紧裁完再缩回 [PORTAL_MARK_PX]
     */
    private const val PORTAL_MARK_RAW_PX = 1024

    /** 门户那份 data URL 的边长上限 (96dp 的空态在 3x 屏上是 288px, 384 已经有余) */
    private const val PORTAL_MARK_PX = 384

    /** 紧裁时算作"有墨"的最低 alpha: 描出来的矢量边缘有一圈近透明杂点, 拿它当边界框会白留一圈 */
    private const val INK_ALPHA_MIN = 8

    /** 门户那份 data URL 的单槽缓存 (只有当前套一个 key, 换套就作废) */
    private var cachedUrlKey: String = ""
    private var cachedUrl: String = ""

    /**
     * 换完套要跟着动的那些人 (三条常驻通知各订一个, 见 [watch])
     *
     * 常驻通知是**起服务那一刻 build 一次**, 之后不再重投 —— 切图标只重画球的话, 状态栏里就一直是
     * 旧那套的图 (2026-11-22 主人: "通知图标没有随图标变化")。这里只负责"叫一声", 重投那一下由
     * 订阅方自己做 (它们才知道自己的通知 id 与文案)
     */
    private val listeners = LinkedHashSet<() -> Unit>()

    /** 现在用的是哪一套 */
    fun current(context: Context): IconSet = IconSetting.current(context)

    /** 设置文件变了没有 (球与开屏靠它"下一拍就换") */
    fun stamp(context: Context): Long = IconSetting.stamp(context)

    /** 应用内标记的资源 id (桌面组件那种只能吃 res id 的地方用它) */
    fun markRes(context: Context): Int = current(context).markRes

    /** 通知 small icon 的资源 id */
    fun notificationIcon(context: Context): Int = current(context).notifyRes

    /**
     * 一块"墨迹占 [inkDp]"的标记要画多大 (dp)
     *
     * 球与开屏都是"标记本身多大"的语义, 而素材画布里的留白各套不同: 内置矢量的墨迹只占 0.46,
     * 女仆那张是紧裁过的满幅。除一下就让两套看起来一样大 —— 内置那一档算出来与旧算式
     * (`ballDraw * 0.65 / 0.46`) 逐字节相同
     */
    fun boxDpForInk(inkDp: Float, set: IconSet): Int =
        max(1, (inkDp / set.markInkRatio).toInt())

    /** 开屏那一块的盒子: 112dp 画布里墨迹原本占 `112 * 0.46` */
    fun splashBoxDp(set: IconSet = IconSet.DEFAULT): Int =
        boxDpForInk(112f * BASE_INK_RATIO, set)

    /** 一套图标的标记解成位图 (矢量与位图走同一条: 都先变成 Drawable 再画进画布) */
    fun markBitmap(
        context: Context,
        set: IconSet = current(context),
        maxPx: Int = MARK_BITMAP_PX,
    ): Bitmap? = runCatching {
        val drawable = context.getDrawable(set.markRes) ?: return null
        val width = drawable.intrinsicWidth.takeIf { it > 0 } ?: maxPx
        val height = drawable.intrinsicHeight.takeIf { it > 0 } ?: maxPx
        val scale = min(1f, maxPx.toFloat() / max(width, height))
        val targetWidth = max(1, (width * scale).roundToInt())
        val targetHeight = max(1, (height * scale).roundToInt())
        val bitmap = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
        drawable.setBounds(0, 0, targetWidth, targetHeight)
        drawable.draw(Canvas(bitmap))
        bitmap
    }.onFailure { Log.w(TAG, "mark bitmap failed for ${set.id}", it) }.getOrNull()

    /**
     * 一套图标的标记, **紧裁之后铺满整格** (给门户与设置里的缩略图)
     *
     * 与 [markBitmap] 的差别就是那一圈留白: 内置那套是 108dp 画布里一只 0.46 的鲸尾, 女仆那张是满幅
     * 紧裁 —— 同样塞进 96px 的空态圆框, 鲸尾只剩女仆那张的 46%, 主人 2026-11-22 报的"尺寸太小"
     * 就是它。球与开屏不能吃这一份: 它们的盒子按 [boxDpForInk] 用 [IconSet.markInkRatio] 反算,
     * 换成紧裁的就白乘了一趟
     */
    fun markTightBitmap(
        context: Context,
        set: IconSet = current(context),
        side: Int = PORTAL_MARK_PX,
    ): Bitmap? = runCatching {
        val raw = renderSquare(context, set, PORTAL_MARK_RAW_PX) ?: return null
        val box = inkBox(raw)
        val cropped = if (box == null) {
            raw
        } else {
            val cut = Bitmap.createBitmap(raw, box[0], box[1], box[2] - box[0], box[3] - box[1])
            if (cut !== raw) runCatching { raw.recycle() }
            cut
        }
        val longest = max(cropped.width, cropped.height)
        if (longest <= side) return cropped
        val scale = side.toFloat() / longest
        val scaled = Bitmap.createScaledBitmap(
            cropped,
            max(1, (cropped.width * scale).roundToInt()),
            max(1, (cropped.height * scale).roundToInt()),
            true,
        )
        if (scaled !== cropped) runCatching { cropped.recycle() }
        scaled
    }.onFailure { Log.w(TAG, "tight mark failed for ${set.id}", it) }.getOrNull()

    /** 按 [side] 的方画布渲染一次 (矢量因此按请求的分辨率重绘, 不再被 108dp 的 intrinsic 卡住) */
    private fun renderSquare(context: Context, set: IconSet, side: Int): Bitmap? {
        val drawable = context.getDrawable(set.markRes) ?: return null
        val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
        drawable.setBounds(0, 0, side, side)
        drawable.draw(Canvas(bitmap))
        return bitmap
    }

    /**
     * 墨迹实际占的那块矩形 (`left / top / right / bottom`), 整幅都空时回 null
     *
     * 逐行取, 只分配一行宽的数组: 门户那一趟是 1024 见方的中间图, 整张 `getPixels` 要多搬 4 MB
     */
    private fun inkBox(bitmap: Bitmap): IntArray? {
        val width = bitmap.width
        val height = bitmap.height
        val row = IntArray(width)
        var left = width
        var right = -1
        var top = -1
        var bottom = -1
        for (y in 0 until height) {
            bitmap.getPixels(row, 0, width, 0, y, width, 1)
            var x = 0
            while (x < width) {
                // alpha 低于这一档当空白: 描出来的矢量边缘有近透明的杂点, 别把整幅都当成墨
                if (row[x] ushr 24 > INK_ALPHA_MIN) {
                    if (top < 0) top = y
                    bottom = y
                    if (x < left) left = x
                    if (x > right) right = x
                }
                x += 1
            }
        }
        if (right < 0 || bottom < 0) return null
        return intArrayOf(left, top, right + 1, bottom + 1)
    }

    /**
     * 订"换套了"这一声, 回一个摘掉自己的函数
     *
     * 回调在**发起切换那个线程**上 (`apply` 从设置页的 IO 上调进来), 谁要动界面或通知就自己
     * `Handler.post` 一下 —— 与 `OutWatch` 同一条写法
     */
    fun watch(listener: () -> Unit): () -> Unit {
        synchronized(listeners) { listeners.add(listener) }
        return { synchronized(listeners) { listeners.remove(listener) } }
    }

    /** 切成功了叫一声 (失败回滚那条不叫, 通知不该跟着一次没成的切换动) */
    private fun publish() {
        val copy = synchronized(listeners) { listeners.toList() }
        for (listener in copy) {
            runCatching { listener() }
        }
    }

    /**
     * 门户那张缺省头像 (data URL), 以及设置里那两格缩略图吃的同一份紧裁图
     *
     * 页面跑在 WebView 里, 拿不到 app 画沙盒里的资源, 所以与背景 / 头像同一条路: 在宿主这一侧编成
     * base64 一起交出去。页面按 `markVer` (就是套的 id) 缓存, 换套才搬一次
     *
     * **紧裁之后才交** (2026-11-22): 画布原样那份里内置那套的鲸尾只占 0.46, 96dp 的圆框里看着像
     * 半个; 页面侧同一份 key 还换了名字 (`MARK_CACHE` 那个 `mark2`), 老机器上缓存的旧小数一起作废
     */
    @Synchronized
    fun markDataUrl(context: Context): String? {
        val set = current(context)
        if (cachedUrlKey == set.id && cachedUrl.isNotEmpty()) return cachedUrl
        val bitmap = markTightBitmap(context, set, PORTAL_MARK_PX) ?: return null
        val encoded = runCatching {
            val buffer = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, buffer)
            Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP)
        }.getOrElse { "" }
        runCatching { bitmap.recycle() }
        if (encoded.isEmpty()) return null
        val url = "data:image/png;base64,$encoded"
        cachedUrlKey = set.id
        cachedUrl = url
        return url
    }

    /** 某一个 alias 现在是不是启用着 (显式设过就看设置, 没设过看清单里的初值) */
    fun isEnabled(context: Context, set: IconSet): Boolean {
        val manager = context.packageManager
        val component = component(context, set)
        val setting = runCatching { manager.getComponentEnabledSetting(component) }
            .getOrDefault(PackageManager.COMPONENT_ENABLED_STATE_DEFAULT)
        return when (setting) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED -> false
            else -> runCatching {
                manager.getActivityInfo(component, PackageManager.MATCH_DISABLED_COMPONENTS).enabled
            }.getOrDefault(false)
        }
    }

    /**
     * 切到 [set]: 先落盘, 再动 alias, 回读校验, 任何一步不成就回到原来那一套
     *
     * @return true = 设置写进去了且目标 alias 确实启用着; false = 什么都没变 (调用方如实说一句)
     */
    fun apply(context: Context, set: IconSet): Boolean {
        val previous = current(context)
        if (!IconSetting.save(context, set)) return false
        if (enforce(context, set)) {
            // 三条常驻通知靠这一声重投自己 (`DshHostService` / `OverlayService` / `WakeWordService`),
            // 否则状态栏里一直是起服务那一刻那套的图 (2026-11-22 主人: "通知图标没有随图标变化")
            publish()
            return true
        }
        runCatching { IconSetting.save(context, previous) }
        enforce(context, previous)
        return false
    }

    /**
     * 把"该开的只有一个"这件事落实一次 (不写设置)
     *
     * 冷启动对账也走这里: `icon.json` 是权威, 而 PackageManager 里的状态可能被桌面 / ROM 改过
     * (最坏是两套都停用 = 桌面上一个入口都没有, 于是下次只能靠系统设置或 adb 找回来)
     */
    fun enforce(context: Context, set: IconSet): Boolean {
        val manager = context.packageManager
        val plan = IconSet.switchPlan(set, set)
        return runCatching {
            for ((target, enable) in plan) {
                val component = component(context, target)
                val want = if (enable) {
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                } else {
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                }
                if (runCatching { manager.getComponentEnabledSetting(component) }.getOrNull() != want) {
                    manager.setComponentEnabledSetting(component, want, PackageManager.DONT_KILL_APP)
                }
            }
            isEnabled(context, set)
        }.onFailure { Log.w(TAG, "switching to ${set.id} failed", it) }.getOrDefault(false)
    }

    /**
     * 冷启动对一次账 (MainActivity.onCreate 叫一次, 放在 IO 上)
     *
     * 只在真的不一致时才动 PackageManager: 每次冷启动都写一遍会让桌面重绘一次 (图标闪一下)
     */
    fun sync(context: Context) {
        val want = current(context)
        val consistent = isEnabled(context, want) &&
            IconSet.values().filter { it != want }.none { isEnabled(context, it) }
        if (consistent) return
        Log.i(TAG, "icon state disagrees with ${want.id}, re-applying")
        enforce(context, want)
    }

    /** alias 的组件名: 字符串必须与 AndroidManifest 里 `<activity-alias android:name>` 逐字相同 */
    fun component(context: Context, set: IconSet): ComponentName =
        ComponentName(context.packageName, context.packageName + set.alias)
}
