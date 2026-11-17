package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.util.Log
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.plugin.CompanionApk
import io.github.yuloong07star.luwi.plugin.PluginCompanion

/**
 * 设置里「开发」那一段的下载位 (2.8.1 #16 / 2026-11-17 改口径)
 *
 * 这一段现在只管两样东西, 而且它们**不是同一种东西**:
 *
 * - **Luwi 开发台**: 一个伴侣 APK (`tool/DevConsole.kt` 连它). 它有界面、要独立运行, 所以只能装成应用
 * - **开发工具链**: 一份数据包 (`luwi-toolchain.zip`, 见 [ToolchainPack]). 它没有界面, 由 Luwi 自己下到
 *   自己的目录, 再交给特权进程搬进 `/data/local/tmp/lwforge/toolchain` —— **不装任何应用**
 *
 * 2026-11-17 之前工具链是第二件 APK; 主人问「为什么是两个 apk, 开发工具不是下载到 luwi 应用里的吗」之后
 * 改成数据包: 少装一个应用, 也少过一道系统的安装门
 *
 * 三处与别处对齐的口径:
 *
 * - **下载与安装走 `.lwp` 那一套** ([PluginCompanion.ensure]): https 只收, 边读边数上限, 下完先看它是
 *   不是一份能装的 APK, 包名对得上才交出去
 * - **地址只有一张表** ([HOSTS]): 主址不通就换兜底, 两条都写在这一份里 —— 发布侧换了地方只改这里
 * - **装没装读系统那一份事实** ([installed]): 不记自己的账, 卸掉之后这一行自己就回到 "没装"
 */
internal object DevTools {

    private const val TAG = "LwDevTools"

    /**
     * 两件东西的下载位 (2026-11-17 真机踩出来的顺序)
     *
     * 直连 github.com 在这台机器上一次下不完 113 MB (92 秒后 `unexpected end of stream`, 续传也常连不上),
     * jsDelivr 的 TLS 在这边直接连不上, 所以**加速代理在前**: 三个能用的 GitHub 代理 → 直连 → 官网兜底。
     * 代理只做转发, 内容仍由下载仓的 Release 给
     */
    val HOSTS: List<String> = listOf(
        "https://ghproxy.net/https://github.com/Yuloong07/luwi-devtools/releases/download/devtools-v1",
        "https://gh-proxy.com/https://github.com/Yuloong07/luwi-devtools/releases/download/devtools-v1",
        "https://ghfast.top/https://github.com/Yuloong07/luwi-devtools/releases/download/devtools-v1",
        "https://github.com/Yuloong07/luwi-devtools/releases/download/devtools-v1",
        "https://luwi.dpdns.org/dl",
    )

    /** 直链下不动时人还能自己去翻的那一页 (下载仓的 Release) */
    const val PAGE = "https://github.com/Yuloong07/luwi-devtools/releases"

    /** 工具链数据包的名字 (与发布侧那份逐字一致) */
    const val TOOLCHAIN_ASSET = "luwi-toolchain.zip"

    /** 整包 sha256 (与 `toolchain/` 打出来的 zip 逐字节一致; 少一个字节就当场回红) */
    const val TOOLCHAIN_SHA256 = "f6a56e34a730dc0179bead9b115d77c2ffb4118282c1b01326b9e149e3b067dd"

    /**
     * 一件伴侣软件 (现在只有开发台)
     *
     * @property id 内部记号 (日志与判据用)
     * @property label 那一行的名字
     * @property blurb 那一行的小字 (它是什么)
     * @property packageName 伴侣 APK 的包名: 装没装读它, 下完也用它核对 (装错一份是同一类错)
     * @property asset 发布侧的文件名
     */
    data class Tool(
        val id: String,
        val label: Int,
        val blurb: Int,
        val packageName: String,
        val asset: String,
    )

    /** 要装的那一行: 开发台 */
    val tools: List<Tool> = listOf(
        Tool(
            id = "dev-console",
            label = R.string.settings_dev_console,
            blurb = R.string.settings_dev_console_summary,
            packageName = "io.github.yuloong07star.luwi.devconsole",
            asset = "luwi-dev-console.apk",
        ),
    )

    /** 一件软件的全部下载地址 (主址 + 兜底; 顺序即尝试顺序) */
    fun urlsOf(tool: Tool): List<String> = HOSTS.map { base -> "$base/${tool.asset}" }

    /** 工具链数据包的全部下载地址 */
    fun toolchainUrls(): List<String> = HOSTS.map { base -> "$base/$TOOLCHAIN_ASSET" }

    /** 这个包现在装着没有 (装着回版本名) */
    fun installed(context: Context, tool: Tool): String? = CompanionApk.installed(context, tool.packageName)

    /**
     * 下一份并交出去, **阻塞**: 调用方放在 IO 上
     *
     * 回一句给人看的话. 三条路都算 "办成了": 本来就装着 / 静默装上了 / 交给了系统安装器 (人在那一页点安装).
     * 两条地址都下不动时把原因拼成一句 —— "下载失败" 这四个字解决不了任何问题, 而两条报同一句错时只留一句
     */
    fun download(context: Context, tool: Tool): String {
        val reasons = mutableListOf<Pair<String, String>>()
        for (url in urlsOf(tool)) {
            val outcome = PluginCompanion.ensure(
                context = context,
                packageName = tool.packageName,
                apkUrl = url,
                allowSystemInstaller = true,
            )
            if (outcome.handled || outcome.waitingForUser) {
                Log.i(TAG, "${tool.id} from $url (handled=${outcome.handled} waiting=${outcome.waitingForUser})")
                return outcome.text.ifBlank {
                    installed(context, tool)?.let { version ->
                        context.getString(R.string.settings_dev_installed, version)
                    }.orEmpty()
                }
            }
            reasons += (url.substringAfter("://").substringBefore('/')) to
                outcome.text.ifBlank { "没下下来" }
        }
        Log.w(TAG, "${tool.id} did not come down: $reasons")
        val said = reasons.map { it.second }.distinct()
        if (said.size == 1) return said.first()
        return reasons.joinToString("; ") { (host, why) -> "$host: $why" }
    }
}
