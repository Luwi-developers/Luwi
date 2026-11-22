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
 * | 球 / 开屏 / 桌面组件 / 门户头像 | [markRes] 与 [markBitmap] |
 * | 五处通知 | [notificationIcon] |
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

    /** 门户头像那个 28dp 圆框: 192px 是 2x 屏的两倍, 再大只是白搬 base64 */
    private const val PORTAL_MARK_PX = 192

    /** 门户那份 data URL 的单槽缓存 (只有当前套一个 key, 换套就作废) */
    private var cachedUrlKey: String = ""
    private var cachedUrl: String = ""

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
     * 门户那张缺省头像 (data URL)
     *
     * 页面跑在 WebView 里, 拿不到 app 画沙盒里的资源, 所以与背景 / 头像同一条路: 在宿主这一侧编成
     * base64 一起交出去。页面按 `markVer` (就是套的 id) 缓存, 换套才搬一次
     */
    @Synchronized
    fun markDataUrl(context: Context): String? {
        val set = current(context)
        if (cachedUrlKey == set.id && cachedUrl.isNotEmpty()) return cachedUrl
        val bitmap = markBitmap(context, set, PORTAL_MARK_PX) ?: return null
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
        if (enforce(context, set)) return true
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
