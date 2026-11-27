package io.github.yuloong07star.luwi.ui

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import io.github.yuloong07star.luwi.channel.VirtualScreen
import io.github.yuloong07star.luwi.tool.DevToolchain
import io.github.yuloong07star.luwi.tool.DevTools
import io.github.yuloong07star.luwi.tool.ForgeConsole
import io.github.yuloong07star.luwi.tool.LwForge
import io.github.yuloong07star.luwi.tool.ToolchainPack
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * 前台「开发」面板那一层 (2026-11-17 主人: 面板要像判断 / 探索 / 虚拟屏那样画在这一页上)
 *
 * 2026-11-17 晚收成三行 (主人: "只保留 新建开发应用 / 打开开发台（虚拟屏）/ 下载 luwi 开发安卓工具"):
 * 下载那一行走 page 侧的第二层选直链还是镜像, 于是这里只认两个 id; 导入工具链仍在设置页那一段里
 *
 * 三条分寸与 [PortalMenu] 同一条:
 *
 * 1. **读数一处出**: 状态由 [status] 现算 (已有项目 / 工具链 / 上一句结论), 页面只画
 * 2. **动作一处执行**: 点一行回来的是 id, 真正干活的是 app 这一侧那几件现成函数
 * 3. **重活不占 JS 线程**: 下工具链 (113 MB) 与建开发屏都要几十秒, 这一层只把它丢到单线程池里,
 *    当场回一句「开始了」; 干完用 Toast 说结果, 下次打开面板 status 里也能看到
 */
internal object PortalDev {

    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "lw-dev-panel").apply { isDaemon = true }
    }

    private val main = Handler(Looper.getMainLooper())

    @Volatile
    private var lastLine: String = ""

    /** 面板顶上那几行读数 */
    fun status(context: Context): String {
        val all = ForgeConsole.all()
        val names = all.joinToString("、") { it.name }
        return JSONObject()
            .put("toolchain", DevToolchain.status(context))
            .put("projects", if (names.isBlank()) "" else "$names · ${all.size} 个")
            // 开发屏开着没有: 页面据此把那一行写成「打开」还是「关闭」(2026-11-17 主人) 
            .put("screenOpen", VirtualScreen.screens.isNotEmpty())
            .toString()
    }

    /** 面板里点了一行 */
    fun pick(context: Context, id: String): String = when (id) {
        "new" -> {
            PortalAsk.ask(PortalAsk.Target.DEV_NEW)
            "在弹窗里起个名字。"
        }
        "screen" -> start(context, "开发屏") { LwForge.openConsole(context) }
        // 再点一次是关: 把所有虚拟屏收掉 (主人 2026-11-17: "点击后释放所有虚拟屏")
        "screen.close" -> {
            val open = VirtualScreen.screens
            main.post { open.forEach { screen -> VirtualScreen.release(screen, byUser = true) } }
            if (open.isEmpty()) "本来就没有开发屏。" else "收掉 ${open.size} 块虚拟屏。"
        }
        "download:direct" -> start(context, "工具链 (直链)") {
            ToolchainPack.install(context, DevTools.directHosts())
        }
        "download:mirror" -> start(context, "工具链 (镜像)") {
            ToolchainPack.install(context, DevTools.mirrorHosts())
        }
        else -> "不认识这一行: $id"
    }

    /** 起一件重活: 当场回一句, 干完用 Toast 报结果 */
    private fun start(context: Context, label: String, block: () -> String): String {
        val app = context.applicationContext
        worker.execute {
            val line = runCatching { block() }.getOrElse { "出了点问题: ${it.message ?: it.javaClass.simpleName}" }
            lastLine = "$label: $line"
            main.post { Toast.makeText(app, "$label: $line", Toast.LENGTH_LONG).show() }
        }
        return "开始$label 了, 干完会弹一句。"
    }

    /** 应用层用完记一句 (新建完成后叫一声) */
    fun note(line: String) {
        lastLine = line
    }
}
