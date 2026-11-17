package io.github.yuloong07star.luwi.dev.api

import android.os.Bundle

/**
 * 开发台那一套的常量与回话形状 (2.8.1)
 *
 * 两处同读: Luwi 主进程按它绑服务与校验, 「Luwi 开发台」按它回话, `tools/check-devconsole.mjs` 拿它跟
 * manifest 与 `docs/Luwi-2.8.x/23-2.8.1-开发台与工坊.md` 对齐 —— 手写 Binder 没有编译器帮着对描述符与编号,
 * 一个常量写错就会变成"调不通而看不出原因"
 *
 * 工具链**不在这里**: 它不再是伴侣 APK, 只是 Luwi 自己下载并交给特权进程的一份数据包
 * (见 `tool/ToolchainPack.kt`)
 */
object DevApi {

    /** 开发台那一侧自述的接口版本 */
    const val API_CONSOLE = "lw-devconsole/1"

    /** 护住开发台 Service 的那条自定义权限 (signature; Luwi 定义, 伴侣 uses-permission) */
    const val PERMISSION = "io.github.yuloong07star.luwi.permission.DEV"

    /** 开发台 Service 的 intent action */
    const val BIND_CONSOLE = "io.github.yuloong07star.luwi.devconsole.BIND"

    /** 开发台的包名 (与 `tool/DevTools.kt` 的表逐字一致) */
    const val PACKAGE_CONSOLE = "io.github.yuloong07star.luwi.devconsole"

    /** 开发台那份 Binder 的描述符 */
    const val DESCRIPTOR_CONSOLE = "io.github.yuloong07star.luwi.dev.api.IDevConsole"

    /** 一次 handoff 的文本上限 (与 handoff 那条同一个尺度: 一段话, 不是一份文件) */
    const val MAX_TEXT = 2000

    /** 开发台一次最多报几条项目 */
    const val MAX_PROJECTS = 200

    /** 两个 Bundle 里那套键 (两侧与判据都按它读) */
    object Keys {
        const val API = "api"
        const val VERSION = "version"
        const val OK = "ok"
        const val TEXT = "text"
        const val CODE = "code"
        const val PROJECTS = "projects"
        const val CURRENT = "current"
        const val ROOT = "root"
        const val COUNT = "count"
        const val FILES = "files"
        const val PATH = "path"
        const val NAME = "name"
        const val LINES = "lines"
        const val ERROR = "error"
    }

    /** 一句话的回话: `ok` 由调用方给, `text` 是给人看的那句 */
    fun result(ok: Boolean, text: String, code: String = if (ok) "" else "REFUSED"): Bundle =
        Bundle().apply {
            putBoolean(Keys.OK, ok)
            putString(Keys.TEXT, text.take(MAX_TEXT))
            putString(Keys.CODE, code)
        }

    /** 带数据的回话 */
    fun result(ok: Boolean, text: String, data: Bundle?, code: String = if (ok) "" else "REFUSED"): Bundle =
        result(ok, text, code).apply { if (data != null) putBundle("data", data) }
}
