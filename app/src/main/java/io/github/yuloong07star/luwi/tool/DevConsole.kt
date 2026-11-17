package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.os.Bundle
import io.github.yuloong07star.luwi.dev.api.DevApi
import io.github.yuloong07star.luwi.dev.api.IDevConsole

/**
 * 「Luwi 开发台」这一半: 连上、推项目、读状态 / 日志 (2.8.1)
 *
 * 五个 op 全是只读 (唯一写的是开发台自己的 `current.json`); 进度与日志由两边读同一份 `.lwforge/` 文件,
 * 所以"Luwi 看到的"与"开发台上画的"不会漂
 */
internal object DevConsole {

    /** 开发台现在连得上吗, 一句话 */
    fun status(context: Context): String {
        if (!DevBridge.installed(context, DevApi.PACKAGE_CONSOLE)) return "开发台: 没装 (先下 Luwi 开发台)"
        val answer = DevBridge.with(
            context = context,
            packageName = DevApi.PACKAGE_CONSOLE,
            action = DevApi.BIND_CONSOLE,
            adapter = IDevConsole::asInterface,
        ) { it.describe() }
        if (!answer.getBoolean(DevApi.Keys.OK)) return "开发台: ${answer.getString(DevApi.Keys.TEXT).orEmpty()}"
        val version = answer.getString(DevApi.Keys.VERSION).orEmpty()
        val current = answer.getString(DevApi.Keys.NAME).orEmpty().ifBlank { "没有当前项目" }
        val count = answer.getStringArrayList(DevApi.Keys.PROJECTS)?.size ?: 0
        val noAccess = answer.getString(DevApi.Keys.ERROR).orEmpty()
        return buildString {
            append("开发台: 已连 v").append(version).append(" · ").append(current).append(" · ")
            append(count).append(" 个项目")
            if (noAccess.isNotBlank()) append(" · ").append(noAccess)
        }
    }

    /** 把项目推给开发台; 回一句给人看的话 */
    fun open(context: Context, path: String, name: String): String {
        val answer = DevBridge.with(
            context = context,
            packageName = DevApi.PACKAGE_CONSOLE,
            action = DevApi.BIND_CONSOLE,
            adapter = IDevConsole::asInterface,
        ) { it.invoke("project.open", Bundle().apply {
            putString(DevApi.Keys.PATH, path)
            putString(DevApi.Keys.NAME, name)
        }) }
        return answer.getString(DevApi.Keys.TEXT) ?: "开发台没有回话"
    }

    /** 日志尾; 开发台读的是同一份 build.log */
    fun logTail(context: Context, lines: Int): String {
        val answer = DevBridge.with(
            context = context,
            packageName = DevApi.PACKAGE_CONSOLE,
            action = DevApi.BIND_CONSOLE,
            adapter = IDevConsole::asInterface,
        ) { it.invoke("log.tail", Bundle().apply { putInt(DevApi.Keys.LINES, lines) }) }
        return answer.getString(DevApi.Keys.TEXT) ?: ""
    }
}
