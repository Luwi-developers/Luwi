package io.github.yuloong07star.luwi.tool

import android.content.Context
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.host.DshHost
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.io.File

/**
 * 可切换的图标套 (2026-11-22 主人: "在设置的外观里加上切换 luwi 图标的选项")
 *
 * 一套图标要同时喂饱五类位置, 所以每一项都是那一套自己的资源, 不靠运行时算:
 *
 * | 字段 | 谁读 |
 * | :-- | :-- |
 * | [alias] | 桌面图标 (activity-alias, 与 AndroidManifest 逐字一致) |
 * | [markRes] | 球 / 开屏 / 桌面组件 / 门户头像 (位图, 满幅紧裁) |
 * | [markInkRatio] | 球与开屏的尺寸换算 (内置那份矢量墨迹只占 0.46) |
 * | [markTintWhite] | 球上那份要不要染白 (内置那份是单色矢量, 女仆那份是彩色位图) |
 * | [notifyRes] | 五处通知的 small icon (单色白模) |
 * | [launcherRes] | 通知 extras 里的 `miui.appIcon` (彩色整图, 与桌面那一枚同一个资源) |
 *
 * **低分套与高分套不许写反**: [alias] 是与清单里 `<activity-alias android:name>` 的字符串对齐的唯一
 * 依据, 写成别的名字不会报错, 只是切过去之后桌面一个入口都没有 (见 [switchPlan] 的顺序与回滚)
 */
internal enum class IconSet(
    val id: String,
    val labelRes: Int,
    val alias: String,
    val markRes: Int,
    val markInkRatio: Float,
    val markTintWhite: Boolean,
    val notifyRes: Int,
    val launcherRes: Int,
) {
    /** 内置那套: 一圈水花里一只鲸尾, 从 2026-10-10 起一直是缺省 */
    BUILTIN(
        id = "builtin",
        labelRes = R.string.settings_luwi_icon_builtin,
        alias = ".IconBuiltin",
        markRes = R.drawable.ic_launcher_foreground,
        markInkRatio = 0.46f,
        markTintWhite = true,
        notifyRes = R.drawable.ic_notification,
        // 应用图标位 (`ic_launcher*`) 现在承载缺省套 (女仆), 内置那套另存成 `ic_launcher_builtin`
        launcherRes = R.mipmap.ic_launcher_builtin,
    ),

    /** 主人 2026-11-22 给的那张 (蓝发女仆), 也是这一版之后的缺省 */
    MAID(
        id = "maid",
        labelRes = R.string.settings_luwi_icon_maid,
        alias = ".IconMaid",
        markRes = R.drawable.ic_mark_maid,
        markInkRatio = 1.0f,
        markTintWhite = false,
        notifyRes = R.drawable.ic_notification_maid,
        launcherRes = R.mipmap.ic_launcher_maid,
    ),
    ;

    companion object {

        /** 没配过 / 写坏了 / 认不出的 id 都用这一套 (主人 2026-11-22: "并默认使用这张") */
        val DEFAULT = MAID

        /** 键 -> 套; 认不出回 [DEFAULT] (纯函数, 单测走这里) */
        fun of(raw: String?): IconSet {
            val key = raw?.trim().orEmpty()
            return values().firstOrNull { it.id == key } ?: DEFAULT
        }

        /**
         * 切一次要动哪几个组件, **顺序就是执行顺序** (纯函数, 单测走这里)
         *
         * 先启用目标、再停别的: 反过来那一瞬间桌面上一个入口都没有, 部分 ROM 会就此认不出这个应用
         * (图标飞了 / 桌面把它当卸载)。`from == to` 时只回一条"启用", 不做无意义的停用
         */
        fun switchPlan(from: IconSet, to: IconSet): List<Pair<IconSet, Boolean>> {
            val keep = values().filter { it != to }.map { it to false }
            return listOf(to to true) + keep
        }
    }
}

/**
 * 图标选择的落盘 (2026-11-22): `$DSH_HOME/lw/icon.json` 的 `set`
 *
 * 与 [PortalFace] / [SimSetting] 同一个分工: **应用单写**, 宿主只读该读的那一份。读法逐键兜底 ——
 * 缺文件 / 坏 JSON / 认不出的值一律回 [IconSet.DEFAULT], 一份写坏的文件不该让图标整片消失
 */
internal object IconSetting {

    /** 与 [SimSetting] / [PortalFace] 同一个父目录 (`$DSH_HOME/lw`) */
    const val DIRECTORY = "lw"

    /** 那份设置的名字 (与 `check-icon-sets.mjs` 盯的名字一致) */
    const val FILE = "icon.json"

    private val json = Json { ignoreUnknownKeys = true }

    fun file(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), "$DIRECTORY/$FILE")

    /** 现在用的是哪一套 */
    fun current(context: Context): IconSet = IconSet.of(read(context))

    /** 纯解析 (单测不需要设备): 只认 `set` 那一个字符串键 */
    fun of(root: JsonObject?): IconSet {
        val raw = runCatching { (root?.get("set") as? JsonPrimitive)?.contentOrNull }.getOrNull()
        return IconSet.of(raw)
    }

    private fun read(context: Context): String? = runCatching {
        val target = file(context)
        if (!target.isFile) return null
        val root = json.parseToJsonElement(target.readText()) as? JsonObject ?: return null
        (root["set"] as? JsonPrimitive)?.contentOrNull
    }.getOrNull()

    /** 落盘 (原子写, 与 [PortalFace.save] 同一条) */
    fun save(context: Context, set: IconSet): Boolean {
        val target = file(context)
        return runCatching {
            target.parentFile?.mkdirs()
            val root = buildJsonObject {
                put("v", 1)
                put("set", set.id)
            }
            val text = json.encodeToString(JsonObject.serializer(), root) + "\n"
            val temporary = File(target.parentFile, "${target.name}.tmp")
            temporary.writeText(text)
            if (!temporary.renameTo(target)) {
                target.writeText(text)
                temporary.delete()
            }
            true
        }.getOrDefault(false)
    }

    /**
     * 这份文件的大小与时间: 变了才重新解图
     *
     * 球那一侧每 400 ms 心跳读一次 (与 `BallTheme.currentId` 同一条路), 所以这里只做一次 `length` 与
     * `lastModified`, 不开文件
     */
    fun stamp(context: Context): Long = runCatching {
        val target = file(context)
        if (!target.isFile) 0L else target.length() * 31 + target.lastModified()
    }.getOrDefault(0L)
}
