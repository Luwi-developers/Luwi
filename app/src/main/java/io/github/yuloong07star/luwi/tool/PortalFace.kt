package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import io.github.yuloong07star.luwi.host.DshHost
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.put
import java.io.File
import java.io.FileOutputStream

/**
 * 对话层 (门户) 的那张脸: 背景图与背景的不透明度 (2026-11-08 主人)
 *
 * 主人那两句话是「设置里的外观版块加上背景和透明度的设置, 可更改这一对话层的外观」—— 所以这份设置
 * **只作用在门户那一层**, dsh 原生界面与其它页面一个字节都不动 (门户本来就整块盖在 dsh 上面, 它的
 * 脸是它自己的事)
 *
 * 落 `$DSH_HOME/lw/face.json` + 一张图 `$DSH_HOME/lw/face/<名字>.jpg`:
 *
 * - **应用是唯一写者** (与 [SimSetting] 同一个分工), 宿主只读它该读的那一份
 * - **只留一张图**: 换一次先写新的再删旧的, 目录里永远只有当前这一张
 * - **读法逐键兜底**: 缺键 / 越界 / 类型不对 / `wall` 名字不合形状, 一律回缺省 —— 一份写坏的文件
 *   不该让这一层画不出来
 *
 * 页面那一侧不碰文件: 图由 `PortalBridge.portalLook()` 编成 data URL 交给它 (WebView 里的 JS 够不到
 * app 沙盒, 也不该为了一个背景去开文件通道)
 */
internal object PortalFace {

    /** 与 [SimSetting] 同一个父目录 (`$DSH_HOME/lw`) */
    const val DIRECTORY = "lw"

    /** 那份设置的正文 */
    const val FILE = "face.json"

    /** 背景图放哪 (相对 `$DSH_HOME`) —— 判据脚本盯这一处与 `client.js` 的名字对齐 */
    const val IMAGE_DIRECTORY = "lw/face"

    /** 透明度的缺省值: 四成, 既看得出是张图, 又不至于把字压住 */
    const val DEFAULT_ALPHA = 0.40f

    /** 长边上限 (与收件箱那几张图同一个口径: 够看清, 又不至于把一整个屏的图撑成几兆) */
    const val MAX_EDGE = 1600

    /**
     * 头像的长边上限 (2026-11-10): 头栏那块只有 28dp, 空态那张脸 96dp —— 512 已经够两倍屏用,
     * 再大只是让每次挂载多搬几万字节的 base64
     */
    const val AVATAR_MAX_EDGE = 512

    /** 昵称的字数上限 (超过就截断: 头栏那一行只有一个字的宽度, 长名字只会被省略号吃掉) */
    const val MAX_NAME_CHARS = 16

    /** JPEG 质量 (同上) */
    const val QUALITY = 88

    /** 原始文件上限: 超过这一份就不接了 (解码本身也要内存) */
    const val MAX_BYTES = 8L * 1024 * 1024

    /** 编成 data URL 之后的上限: 再大就不交给页面 (那一下会把 WebView 的字符串层撑爆) */
    const val MAX_DATA_URL_CHARS = 1_200_000

    /** `wall` 只认这一种形状: 自己写出来的名字, 别的一律当没有 (顺带挡掉路径) */
    private val WALL_NAME = Regex("^wall-[0-9]{10,19}\\.jpg$")

    /** 头像同理, 只是前缀不同 —— 两样各留各的, 换头像不该把背景删掉 */
    private val AVATAR_NAME = Regex("^avatar-[0-9]{10,19}\\.jpg$")

    /**
     * 这一层现在长什么样
     *
     * @property alpha 背景图的不透明度, 0 = 只剩底色, 1 = 原图
     * @property wall 背景图的文件名 (相对 [IMAGE_DIRECTORY]), 空串 = 没有背景
     * @property name 头栏与空态显示的名字 (空串 = 用 `Luwi`, 由页面那一侧兜)
     * @property avatar 头像的文件名 (相对 [IMAGE_DIRECTORY]), 空串 = 用品牌标记
     */
    data class Face(
        val alpha: Float = DEFAULT_ALPHA,
        val wall: String = "",
        val name: String = "",
        val avatar: String = "",
    )

    private val json = Json { ignoreUnknownKeys = true }

    /** 那份设置在哪 */
    fun file(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), "$DIRECTORY/$FILE")

    /** 背景图那个目录 */
    fun imageDirectory(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), IMAGE_DIRECTORY)

    /** 盘上那份 (读不到就是缺省) */
    fun face(context: Context): Face = faceFrom(readRoot(context))

    /** 纯解析, 单测与判据走这里 (不需要设备) */
    fun faceFrom(root: JsonObject?): Face {
        val alpha = (root?.prim("alpha")?.floatOrNull ?: DEFAULT_ALPHA).coerceIn(0f, 1f)
        val wall = root?.prim("wall")?.contentOrNull?.trim().orEmpty()
        val name = cleanName(root?.prim("name")?.contentOrNull.orEmpty())
        val avatar = root?.prim("avatar")?.contentOrNull?.trim().orEmpty()
        return Face(
            alpha = alpha,
            wall = if (WALL_NAME.matches(wall)) wall else "",
            name = name,
            avatar = if (AVATAR_NAME.matches(avatar)) avatar else "",
        )
    }

    /**
     * 昵称的清洗 (纯函数, 单测走这里)
     *
     * 三条: 换行/制表符这类空白压成一个空格、首尾去掉、超过 [MAX_NAME_CHARS] 截断。**空串是合法的**
     * —— 它的意思是"用缺省那个名字", 页面那一侧会兜成 `Luwi`
     */
    fun cleanName(raw: String): String {
        val collapsed = raw.replace(Regex("[\\p{Cntrl}\\s]+"), " ").trim()
        return if (collapsed.length <= MAX_NAME_CHARS) collapsed else collapsed.substring(0, MAX_NAME_CHARS).trim()
    }

    /** 落盘 (原子写, 与 [SimSetting.save] 同一条) */
    fun save(context: Context, face: Face): Boolean {
        val target = file(context)
        val root = buildJsonObject {
            put("v", 1)
            put("alpha", face.alpha.coerceIn(0f, 1f))
            put("wall", if (WALL_NAME.matches(face.wall)) face.wall else "")
            put("name", cleanName(face.name))
            put("avatar", if (AVATAR_NAME.matches(face.avatar)) face.avatar else "")
        }
        return runCatching {
            target.parentFile?.mkdirs()
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

    /** 改昵称: 只有真的写进去了才回新的 [Face] */
    fun setName(context: Context, name: String): Face? {
        val next = face(context).copy(name = cleanName(name))
        return if (save(context, next)) next else null
    }

    /**
     * 把选中的那张图落成头像, 回新的 [Face]
     *
     * 与 [setWall] 同一条纪律: **先写新的, 写成了才删旧的** —— 换头像换到一半失败时, 原来那张还在
     */
    fun setAvatar(context: Context, uri: Uri): Face? {
        val bytes = runCatching {
            context.contentResolver.openInputStream(uri)?.use { stream -> stream.readBytes() }
        }.getOrNull() ?: return null
        if (bytes.size > MAX_BYTES) return null
        val decoded = runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()
            ?: return null
        val scaled = scaleDown(decoded, AVATAR_MAX_EDGE)
        val name = "avatar-${System.currentTimeMillis()}.jpg"
        val target = File(imageDirectory(context), name)
        val written = runCatching {
            target.parentFile?.mkdirs()
            FileOutputStream(target).use { out -> scaled.compress(Bitmap.CompressFormat.JPEG, QUALITY, out) }
        }.isSuccess
        if (scaled !== decoded) runCatching { scaled.recycle() }
        runCatching { decoded.recycle() }
        if (!written) {
            runCatching { target.delete() }
            return null
        }
        val next = face(context).copy(avatar = name)
        if (!save(context, next)) {
            runCatching { target.delete() }
            return null
        }
        dropOthers(context, keep = name, pattern = AVATAR_NAME)
        return next
    }

    /** 清掉头像: 先改设置, 再删文件 (设置写成之前都不算换过) */
    fun clearAvatar(context: Context): Face? {
        val now = face(context)
        val next = now.copy(avatar = "")
        if (!save(context, next)) return null
        if (now.avatar.isNotEmpty()) runCatching { File(imageDirectory(context), now.avatar).delete() }
        return next
    }

    /**
     * 头像的 data URL (与背景同一条路: 页面拿不到 app 沙盒里的文件)
     *
     * @return `data:image/jpeg;base64,…`; 没配 / 读不动 / 编出来太大都回 null
     */
    fun avatarDataUrl(context: Context): String? = encode(context, face(context).avatar)

    /**
     * 把选中的那张图落盘, 回新的 [Face]
     *
     * **先写新的, 写成了才删旧的**: 选图选到一半失败时, 原来那张还在 (背景不该被一次失败的换图弄丢)
     *
     * @return 落好之后的脸; 解不开 / 太大 / 写不进去都回 null, 由调用方如实说一句
     */
    fun setWall(context: Context, uri: Uri): Face? {
        val bytes = runCatching {
            context.contentResolver.openInputStream(uri)?.use { stream -> stream.readBytes() }
        }.getOrNull() ?: return null
        if (bytes.size > MAX_BYTES) return null
        val decoded = runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()
            ?: return null
        val scaled = scaleDown(decoded, MAX_EDGE)
        val name = "wall-${System.currentTimeMillis()}.jpg"
        val target = File(imageDirectory(context), name)
        val written = runCatching {
            target.parentFile?.mkdirs()
            FileOutputStream(target).use { out -> scaled.compress(Bitmap.CompressFormat.JPEG, QUALITY, out) }
        }.isSuccess
        if (scaled !== decoded) runCatching { scaled.recycle() }
        runCatching { decoded.recycle() }
        if (!written) {
            runCatching { target.delete() }
            return null
        }
        val next = face(context).copy(wall = name)
        if (!save(context, next)) {
            runCatching { target.delete() }
            return null
        }
        dropOthers(context, keep = name, pattern = WALL_NAME)
        return next
    }

    /** 清掉背景: 先改那份设置, 再删文件 (设置写成之前都不算换过) */
    fun clearWall(context: Context): Face? {
        val now = face(context)
        val next = now.copy(wall = "")
        if (!save(context, next)) return null
        if (now.wall.isNotEmpty()) runCatching { File(imageDirectory(context), now.wall).delete() }
        return next
    }

    /**
     * 现在这张背景的 data URL
     *
     * 页面上是 CSS 的 `background-image`, 而 WebView 拿不到 app 沙盒里的文件, 所以图只能这样过去。
     * 一次几百 KB, 页面按文件名做缓存 —— 换一张才搬一次
     *
     * @return `data:image/jpeg;base64,…`; 没图 / 读不动 / 编出来太大都回 null
     */
    fun dataUrl(context: Context): String? = encode(context, face(context).wall)

    /** 编一张 `lw/face/<名字>` 成 data URL (背景与头像共用这一条, 上限也共用) */
    private fun encode(context: Context, name: String): String? {
        if (name.isEmpty()) return null
        val target = File(imageDirectory(context), name)
        val bytes = runCatching { if (target.isFile) target.readBytes() else null }.getOrNull() ?: return null
        val encoded = runCatching { Base64.encodeToString(bytes, Base64.NO_WRAP) }.getOrNull() ?: return null
        val url = "data:image/jpeg;base64,$encoded"
        return if (url.length > MAX_DATA_URL_CHARS) null else url
    }

    /**
     * 目录里只留当前那一张
     *
     * 只删**同一类**的 (背景删背景、头像删头像): 换头像时把背景一起删掉就是"改一样丢一样"
     */
    private fun dropOthers(context: Context, keep: String, pattern: Regex) {
        val directory = imageDirectory(context)
        val names = runCatching { directory.list() }.getOrNull() ?: return
        for (name in names) {
            if (name == keep) continue
            if (!pattern.matches(name)) continue
            runCatching { File(directory, name).delete() }
        }
    }

    /** 长边压到 [maxEdge] 之内; 本来就够小就原样交回去 */
    private fun scaleDown(bitmap: Bitmap, maxEdge: Int = MAX_EDGE): Bitmap {
        val longest = maxOf(bitmap.width, bitmap.height)
        if (longest <= maxEdge) return bitmap
        val ratio = maxEdge.toFloat() / longest
        val width = (bitmap.width * ratio).toInt().coerceAtLeast(1)
        val height = (bitmap.height * ratio).toInt().coerceAtLeast(1)
        return runCatching { Bitmap.createScaledBitmap(bitmap, width, height, true) }.getOrDefault(bitmap)
    }

    /* ── 逐键兜底那几行 ─────────────────────────────────────────────────── */

    private fun readRoot(context: Context): JsonObject? = runCatching {
        file(context).takeIf { it.isFile }?.readText()?.let { json.parseToJsonElement(it) as? JsonObject }
    }.getOrNull()

    private fun JsonObject?.prim(key: String): JsonPrimitive? = this?.get(key) as? JsonPrimitive
}
