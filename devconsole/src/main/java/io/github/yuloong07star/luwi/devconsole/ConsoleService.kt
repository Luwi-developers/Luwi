package io.github.yuloong07star.luwi.devconsole

import android.app.Service
import android.content.Intent
import android.os.Bundle
import android.os.IBinder
import io.github.yuloong07star.luwi.dev.api.DevApi
import io.github.yuloong07star.luwi.dev.api.IDevConsole
import java.io.File

/**
 * 开发台被 Luwi 调的那条 Service (2.8.1)
 *
 * 五个 op, 全都只读 (唯一写的是自己的 `current.json`):
 *
 * | op | 做什么 |
 * | :-- | :-- |
 * | `ping` | 回一句在 |
 * | `project.open` | 记下当前项目, 回它的元信息 |
 * | `project.refresh` | 重新数一遍同级项目 (读的是盘上的事实) |
 * | `status` | 当前项目 + 元信息 + 上次构建 + 进度 |
 * | `log.tail` | 日志尾 n 行 |
 *
 * 没有事件通道: 进度与日志由调用方按文件读 (Luwi 那一侧写 `.lwforge/`), 开发台这一侧只是把同一份文件
 * 说成人话 —— 两处口径因此不会漂
 */
class ConsoleService : Service() {

    override fun onBind(intent: Intent?): IBinder = Console()

    private inner class Console : IDevConsole() {

        override fun describe(): Bundle {
            val current = ConsoleState.current(this@ConsoleService)
            val projects = ConsoleState.siblingProjects(this@ConsoleService)
            return Bundle().apply {
                putString(DevApi.Keys.API, DevApi.API_CONSOLE)
                putString(DevApi.Keys.VERSION, versionName())
                putString(DevApi.Keys.CURRENT, current?.path.orEmpty())
                putString(DevApi.Keys.NAME, current?.name.orEmpty())
                putStringArrayList(
                    DevApi.Keys.PROJECTS,
                    ArrayList(projects.take(DevApi.MAX_PROJECTS).map { "${it.slug}\t${it.name}\t${it.path}" }),
                )
                putBoolean(DevApi.Keys.OK, true)
                putString(DevApi.Keys.ERROR, if (ConsoleState.canReadShared()) "" else "没有文件访问权限")
            }
        }

        override fun invoke(op: String, args: Bundle?): Bundle = when (op) {
            "", "ping" -> DevApi.result(true, "开发台在")
            "project.open" -> open(args)
            "project.refresh" -> describe().let { DevApi.result(true, "刷新了 ${it.getStringArrayList(DevApi.Keys.PROJECTS)?.size ?: 0} 个项目", it) }
            "status" -> status()
            "log.tail" -> logTail(args)
            else -> DevApi.result(false, "不认识的 op: $op (ping / project.open / project.refresh / status / log.tail)", "UNKNOWN")
        }

        private fun open(args: Bundle?): Bundle {
            val path = args?.getString(DevApi.Keys.PATH).orEmpty()
            if (path.isBlank()) return DevApi.result(false, "project.open 要 path", "MISSING")
            if (!ConsoleState.canReadShared()) {
                return DevApi.result(false, this@ConsoleService.getString(R.string.console_no_access), "NO_ACCESS")
            }
            val project = ConsoleState.open(
                this@ConsoleService,
                path,
                args?.getString(DevApi.Keys.NAME).orEmpty(),
            ) ?: return DevApi.result(false, "这个路径不像 app-projects/<slug>: $path", "BAD_PATH")
            return status().apply { putString(DevApi.Keys.TEXT, "已打开 ${project.name}") }
        }

        private fun status(): Bundle {
            val current = ConsoleState.current(this@ConsoleService)
                ?: return DevApi.result(false, this@ConsoleService.getString(R.string.console_no_project), "NO_PROJECT")
            val dir = File(current.path)
            val data = Bundle().apply {
                putString(DevApi.Keys.PATH, current.path)
                putString(DevApi.Keys.NAME, current.name)
                putStringArrayList(
                    "meta",
                    ArrayList(ConsoleState.meta(dir).map { "${it.first}\t${it.second}" }),
                )
                putStringArrayList(
                    "build",
                    ArrayList(ConsoleState.lastBuild(dir).map { "${it.first}\t${it.second}" }),
                )
                putString("progress", ConsoleState.progress(dir))
            }
            return DevApi.result(true, "${current.name} · ${ConsoleState.progress(dir).ifBlank { "没有在构建" }}", data)
        }

        private fun logTail(args: Bundle?): Bundle {
            val current = ConsoleState.current(this@ConsoleService)
                ?: return DevApi.result(false, this@ConsoleService.getString(R.string.console_no_project), "NO_PROJECT")
            val lines = args?.getInt(DevApi.Keys.LINES, 60)?.coerceIn(1, 200) ?: 60
            val text = ConsoleState.logTail(File(current.path), lines)
            return DevApi.result(true, text.ifBlank { "(还没有日志)" })
        }

        private fun versionName(): String = runCatching {
            packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
        }.getOrDefault("")
    }
}
