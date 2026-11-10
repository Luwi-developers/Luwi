package io.github.yuloong07star.luwi.tool

import java.io.File

/**
 * 主人发上来的文件落在哪、怎么落 (**唯一一份实现**)
 *
 * 两条路都走它: 门户那个 `+` (`ui/PortalBridge.portalStash` 收一段 base64) 与球输入框那个 `+`
 * (`ui/PickMediaActivity` 收一个 uri)。2026-11-09 主人: "ball 时的输入框那个加号改成与门户时 +
 * 同功能, 可发图片和文件" —— 同功能的前提是**同一套规矩**, 两处各写一份迟早漂
 *
 * 规矩 (与 2026-11-08 写进 `portalStash` 的那几条逐字相同):
 *
 * 1. 名字只取 basename, 含 `..` 或 NUL 的一律不认
 * 2. 扩展名走白名单 ([EXTS]) —— 她自己读得动的那些
 * 3. 一份最大 [MAX_BYTES] (12 MB)
 * 4. 同名不覆盖, 顺延成 `名字-2.扩展名`
 * 5. 写完读回长度, 对不上就不认这一份 ("传上去了"与"文件在"是两件事)
 */
internal object LwIn {

    /** 落在工作区里那一个子目录 (门户与球共用一个名字) */
    const val DIRECTORY = "lw-in"

    /** 收的那几种扩展名 (与门户 `<input accept>` 那一串对齐, 写侧再挡一次) */
    val EXTS = setOf(
        "png", "jpg", "jpeg", "webp", "gif",
        "pdf", "txt", "md", "json", "csv", "log",
        "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "apk",
    )

    /** 一份最大多少: 12 MB 够发一张原图或一份 PDF */
    const val MAX_BYTES = 12 * 1024 * 1024

    /**
     * 落好的一份: 名字、绝对路径、字节数、是不是图, 以及图的原尺寸
     *
     * `w`/`h` 是给球那块框用的 —— 有了它, 图还没解完码就能把"那一格多高"先算出来 (见
     * `BallMedia.imageBox`), 于是不会出现"图落地了而那一格是空的, 滚一下才长出来"
     */
    data class Pick(
        val name: String,
        val path: String,
        val bytes: Long,
        val image: Boolean,
        val w: Int = 0,
        val h: Int = 0,
    )

    /** 落盘的结果: 成的那份是 [pick], 不成的看 [error] (给人看的一句话) */
    data class Result(val pick: Pick?, val error: String) {
        val ok: Boolean get() = pick != null
    }

    /** 这个工作区里的 `lw-in/` (调用方给根: 门户给 `DSH`, 球给 `dsh-ball`) */
    fun dir(root: File): File = File(root, DIRECTORY)

    /** 这张图/这份文件认不认 (扩展名那一档) */
    fun extensionOf(rawName: String): String {
        val name = File(rawName.trim()).name
        val dot = name.lastIndexOf('.')
        return if (dot > 0) name.substring(dot + 1).lowercase() else ""
    }

    /**
     * 把一段字节落进 [root]/`lw-in/`
     *
     * 失败一律回一句人话 (`error`), 调用方原样说给主人 —— 静默吞掉是这一层最不该发生的事
     */
    fun put(root: File, rawName: String, bytes: ByteArray): Result {
        val trimmed = rawName.trim()
        if (trimmed.isEmpty()) return Result(null, "名字缺了")
        if (trimmed.contains('\u0000')) return Result(null, "名字里有个非法字符")
        val name = File(trimmed).name
        if (name.isEmpty() || name == "." || name == ".." || name.contains("..")) {
            return Result(null, "这不是一个文件名字")
        }
        val ext = extensionOf(name)
        if (ext !in EXTS) return Result(null, "不收这种文件: $name")
        if (bytes.isEmpty()) return Result(null, "读出来是空的: $name")
        if (bytes.size > MAX_BYTES) {
            return Result(null, "太大了: ${bytes.size / (1024 * 1024)} MB, 一次最多 12 MB")
        }
        val folder = dir(root)
        runCatching { folder.mkdirs() }
        val dot = name.lastIndexOf('.')
        val stem = name.substring(0, if (dot > 0) dot else name.length).take(64).ifEmpty { "file" }
        var target = File(folder, "$stem.$ext")
        var suffix = 2
        while (target.exists()) {
            target = File(folder, "$stem-$suffix.$ext")
            suffix += 1
        }
        val written = runCatching { target.writeBytes(bytes) }.isSuccess
        if (!written || !target.isFile || target.length() <= 0L) {
            return Result(null, "写不进去: ${target.name}")
        }
        // 写完读回: 字节数对不上就不认这一份
        if (target.length() != bytes.size.toLong()) return Result(null, "写歪了: ${target.name}")
        val isImage = target.extension.lowercase() in IMAGE_EXTS
        // 图顺手量一次原尺寸 (只解边界, 不解像素): 球那一格靠它算高度
        val size = if (isImage) imageSize(target) else null
        return Result(
            Pick(
                name = target.name,
                path = target.absolutePath,
                bytes = target.length(),
                image = isImage,
                w = size?.first ?: 0,
                h = size?.second ?: 0,
            ),
            "",
        )
    }

    /**
     * 一张图的原始宽高 (只读文件头, 不解像素); 读不动回 null
     *
     * 纯量尺寸: 一张 4 MB 的截屏调它的代价是"打开文件读几百字节", 而有了这两个数, 球那块框里
     * 那一格的高度在解码之前就定下来了
     */
    fun imageSize(file: File): Pair<Int, Int>? {
        if (!file.isFile || file.length() <= 0L) return null
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        runCatching { android.graphics.BitmapFactory.decodeFile(file.absolutePath, bounds) }.getOrNull()
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        return bounds.outWidth to bounds.outHeight
    }

    /** 图片那几种 (缩略图那一格按它判) */
    private val IMAGE_EXTS = setOf("png", "jpg", "jpeg", "webp", "gif")
}

/**
 * 附件那一段正文 (**与门户那一侧逐字相同**)
 *
 * 门户是 `client.js` 的 `attachLines()`:
 *
 * ```
 * \n\n[附件 N 个, 图片用 read_image 打开]\n1. <绝对路径>\n2. <绝对路径>
 * ```
 *
 * 为什么两端必须是同一串: 门户拿它反解"自己发过的那张图"(`splitAttach`), 宿主拿它给模型看路标,
 * 球这一侧写出去的也得是同一段 —— 否则同一条消息在三个地方读出三种样子
 */
internal object BallAttach {

    /** 抬头那一句 (与门户同一个串, 只把个数留成占位) */
    fun header(count: Int): String = "$HEAD_PREFIX$count 个, 图片用 read_image 打开]"

    /** 抬头的前缀: [strip] 按它认"附件从这儿开始" */
    private const val HEAD_PREFIX = "[附件 "

    /**
     * 去掉正文末尾那一整段附件 (**只给"给人看"的地方用**)
     *
     * 附件段是给模型看的路标 (`1. /abs/path` 那几行), 而桌面对话那一格、通知那一条里它只是一串路径
     * —— 主人要看的是自己说了什么。发出去的那一句**一个字都不动** (模型得读得到那几条路径), 这里只是
     * 同一句话的另一种呈现
     *
     * 认不出来就原样交回去: 宁可多留一段, 也不要把主人自己写的 "[附件 2 个" 切掉
     */
    fun strip(text: String): String {
        val marker = "\n\n$HEAD_PREFIX"
        val at = text.lastIndexOf(marker)
        if (at < 0) return text
        val tail = text.substring(at + marker.length)
        val dash = tail.indexOf(']')
        if (dash < 0) return text
        // `]` 之后只许是 `序号. 路径` 那几行 (空行不算)
        for (line in tail.substring(dash + 1).split('\n')) {
            val row = line.trim()
            if (row.isEmpty()) continue
            val dot = row.indexOf(". ")
            if (dot <= 0) return text
            val number = row.substring(0, dot).toIntOrNull() ?: return text
            if (number <= 0) return text
        }
        return text.substring(0, at).trimEnd()
    }

    /** 整段 (没有附件回空串: 调用方直接 `text + block`) */
    fun block(paths: List<String>): String {
        if (paths.isEmpty()) return ""
        val rows = StringBuilder()
        for ((index, path) in paths.withIndex()) {
            if (path.isBlank()) continue
            rows.append('\n').append(index + 1).append(". ").append(path)
        }
        if (rows.isEmpty()) return ""
        return "\n\n" + header(paths.size) + rows
    }
}
