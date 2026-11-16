package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.util.Log
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.plugin.CompanionApk
import io.github.yuloong07star.luwi.plugin.PluginCompanion

/**
 * 设置里「开发」那一段要装的两件伴侣软件 (2.8.1 #16)
 *
 * 主人 2026-11-16 20:51: "在 luwi 设置里加个开发板块, 上面加上可以让用户自行下载'安卓开发工具'和
 * 'luwi 开发台'伴侣软件". 于是这一段只做一件事: **把两件包下下来交出去**, 装不装由人在系统安装器那一
 * 页点的那一下定 —— "自行下载" 这四个字在这里就是这个意思, 应用不替谁按那个安装键
 *
 * 三处与别处对齐的口径:
 *
 * - **下载与安装走 `.lwp` 那一套** ([PluginCompanion.ensure]): https 只收, 边读边数上限, 下完先看它是
 *   不是一份能装的 APK, 包名对得上才交出去. 伴侣软件与插件那一半是同一类东西, 没有第二套下载器
 * - **地址只有一张表** ([urlsOf]): 主址不通就换镜像, 两条都写在这一份里 —— 发布侧换了地方只改这里
 * - **装没装读系统那一份事实** ([installed]): 不记自己的账, 卸掉之后这一行自己就回到 "没装"
 *
 * 这两件软件目前还没出包 (2026-11-16), 所以表里那条路径按发布约定先写好: 包一进
 * `luwi-plugins` 的 `packages/`, 这一段就能直接下 —— 在那之前点下载会如实回一句 "没下下来",
 * 末尾那一行「打开下载页」也不会装作下到了
 */
internal object DevTools {

    private const val TAG = "LwDevTools"

    /**
     * 伴侣软件住在生态仓 `yuloong07-star/luwi-plugins` 的 `packages/` 下 (与已经发出去的那几件同一个家)
     *
     * 走 jsDelivr: 与 [io.github.yuloong07star.luwi.plugin.PluginIndex] 同一个理由 —— 那边发的是
     * 别人的 CDN, 能不能连上不由我们定, 所以地址是一条多镜像的表而不是一条死链
     */
    private const val REPO_PATH = "gh/yuloong07-star/luwi-plugins@main/packages/"

    /** 主址在前, 镜像在后; 逐条试, 谁通用谁 (2026-10-13 实测 `cdn` 有时 SSL 直接失败) */
    val HOSTS: List<String> = listOf("cdn.jsdelivr.net", "fastly.jsdelivr.net")

    /** 直链下不动时人还能自己去翻的那一页 (生态仓, 真实存在) */
    const val PAGE = "https://github.com/yuloong07-star/luwi-plugins"

    /**
     * 一件伴侣软件
     *
     * @property id 内部记号 (日志与判据用)
     * @property label 那一行的名字
     * @property blurb 那一行的小字 (它是什么)
     * @property packageName 伴侣 APK 的包名: 装没装读它, 下完也用它核对 (装错一份是同一类错)
     * @property asset 包在 `packages/` 下的文件名
     */
    data class Tool(
        val id: String,
        val label: Int,
        val blurb: Int,
        val packageName: String,
        val asset: String,
    )

    /** 这一页上的两行, 顺序就是主人点名的顺序: 先工具, 再开发台 */
    val tools: List<Tool> = listOf(
        Tool(
            id = "android-dev-tools",
            label = R.string.settings_dev_android,
            blurb = R.string.settings_dev_android_summary,
            packageName = "io.github.yuloong07star.luwi.devtools",
            asset = "luwi-android-devtools.apk",
        ),
        Tool(
            id = "dev-console",
            label = R.string.settings_dev_console,
            blurb = R.string.settings_dev_console_summary,
            packageName = "io.github.yuloong07star.luwi.devconsole",
            asset = "luwi-dev-console.apk",
        ),
    )

    /** 一件软件的全部下载地址 (主址 + 镜像; 顺序即尝试顺序) */
    fun urlsOf(tool: Tool): List<String> = HOSTS.map { host -> "https://$host/$REPO_PATH${tool.asset}" }

    /** 这个包现在装着没有 (装着回版本名) */
    fun installed(context: Context, tool: Tool): String? = CompanionApk.installed(context, tool.packageName)

    /**
     * 下一份并交出去, **阻塞**: 调用方放在 IO 上
     *
     * 回一句给人看的话. 三条路都算 "办成了": 伴侣本来就装着 / 静默装上了 / 交给了系统安装器 (人在那一
     * 页点安装). 两条都下不动时把原因拼成一句 —— "下载失败" 这四个字解决不了任何问题, 而两条镜像
     * 报同一句错时只留一句 (那通常就是那边还没出包, 说两遍不会更清楚)
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
