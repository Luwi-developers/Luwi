package io.github.yuloong07star.luwi.tool

/**
 * 门户行里那条相对路径, 认成哪一份文件 (落实表 #41, 2026-11-13)
 *
 * 门户手里只有两种形状: `assets/<id>/<名字>` (她说过的图与文件, 落在 `$DSH_HOME/lw/out` 下) 与
 * `in/<名字>` (自己发上去的那份, 落在工作区的 `lw-in` 下)。"复制路径"与"用其它应用打开"要的都是
 * 能交出去的绝对路径, 而认哪两段、挡 `..` 与反斜杠这一层**与设备无关** —— 单独拎出来, 没有真机也能量
 * (见 `OutPathsTest`); 落在哪个根下由调用方给, 因为只有 app 这一侧知道 `$DSH_HOME` 与工作区在哪
 */
internal object OutPaths {

    /** 她说过的图与文件那一段 */
    const val ASSETS = "assets/"

    /** 自己发上去的那份那一段 */
    const val INBOX = "in/"

    /** 认下来的结果: 挂哪个根 + 根下面那一段, 或者一句为什么不成 */
    sealed interface Lookup {
        data class Found(val root: String, val leaf: String) : Lookup

        data class Rejected(val reason: String) : Lookup
    }

    /**
     * @param rel 行里那条相对路径 (`/lw-out/` 后面那一段)
     * @returns [Lookup.Found] 或 [Lookup.Rejected]
     */
    fun lookup(rel: String): Lookup {
        val clean = rel.trim()
        if (clean.isEmpty()) return Lookup.Rejected("没有路径")
        // `..` 与反斜杠一律不认: 这条路径最终会交给别的应用, 不能从它这儿爬出工作区
        if (clean.contains("..") || clean.contains('\\') || clean.contains('\u0000')) {
            return Lookup.Rejected("这不是一条相对路径")
        }
        return when {
            clean.startsWith(ASSETS) -> Lookup.Found(ASSETS, clean.removePrefix(ASSETS))
            clean.startsWith(INBOX) -> Lookup.Found(INBOX, clean.removePrefix(INBOX))
            else -> Lookup.Rejected("只认 assets/ 与 in/ 两段")
        }
    }
}
