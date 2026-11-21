package io.github.yuloong07star.luwi.ui

import android.content.Context
import android.os.Handler
import android.os.Looper
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.channel.PreviewControl
import io.github.yuloong07star.luwi.channel.VirtualScreen
import io.github.yuloong07star.luwi.sync.SyncSetting
import org.json.JSONArray
import org.json.JSONObject

/**
 * 前台那一层要的那一份菜单 (2026-11-14 主人: "把 luwi 设置浮标菜单内容都塞到 ··· 即可")
 *
 * 门户盖着的时候浮球不画 (它挡着 dsh 的界面, 而右上角已经有一扇门 —— 页面头栏那颗 `⋯`), 于是球菜单里
 * 那几件**必须原样搬进抽屉**: 虚拟屏 / 虚拟屏触摸控制 / 同步 / 酒馆 / 回到后台 / 反馈 / 设置。少一条就是
 * 少一个入口, 而"前台出不去"这种缺口页面自己补不上
 *
 * 三条分寸:
 *
 * 1. **清单一处出**: 页面只画它收到的东西, 不抄第二份中文与第二份状态 —— 开关态 (`on`) 与当前屏名都由
 *    这里现算, 于是抽屉里那几行与 dsh 里看到的是同一件事
 * 2. **动作一处执行**: 点一行回来的是 id (`pick`), 执行的仍是 app 这一侧的真函数
 *    (`VirtualScreen.toggle` / `SyncSetting.setSyncOn` / `PortalState.run` …) —— 页面一个字节不碰设备
 * 3. **跨到界面那三件走 [PortalAsk]**: 开设置页 / 进酒馆 / 弹反馈窗都要 navigator 或这一页的状态, 而
 *    object 拿不到 CompositionLocal, 于是只落一个掷标由 `HostScreen` 消费
 *
 * 球菜单 (`HostScreen` 的 `mainMenu`) **没有撤**: 回到 dsh 后台之后门户不在了, 那时只有球能开门,
 * 两份的语义必须逐条对齐 (判据 `check-luwi-portal.mjs`)
 */
internal object PortalMenu {

    /**
     * 一行 (或一组) 菜单
     *
     * @param id `pick` 回来的那个词; 只有容器的那个 id 点了也不执行
     * @param on 开关态 / 选中态, 页面照它画 `data-on`
     * @param children 二级项 (只有「虚拟屏」有)
     */
    data class Item(
        val id: String,
        val title: String,
        val summary: String = "",
        val on: Boolean = false,
        val enabled: Boolean = true,
        val children: List<Item> = emptyList(),
    )

    /** 抽屉里那一份现算的清单; 顺带写进回执 */
    fun json(context: Context): String = encode(items(context))

    /**
     * 点了一行: 执行, 并且回一份**最新**清单
     *
     * 执行走主线程 (它写的是 Compose 状态与偏好), 回执却是当场算的 —— 于是页面拿到的那一份可能还差
     * 一拍。页面在收到回执后 120 ms 再拉一次 `portalMenu()` 就对上了 (见 `client.js`), 这里不做等待
     */
    fun pick(context: Context, id: String): String {
        onMain { run(context, id) }
        return json(context)
    }

    private fun items(context: Context): List<Item> {
        val selected = VirtualScreen.selected
        val screens = VirtualScreen.screens
        val sync = SyncSetting.snapshot(context)
        val windowToggle = context.getString(
            if (ScreenWindow.hidden) R.string.screen_window_show else R.string.screen_window_hide,
        )
        val screensItem = Item(
            id = "screens",
            title = "虚拟屏",
            // 2026-11-17 主人: 触摸控制收进这一层; 屏名与那行"接受控制"的刹车撤掉
            // (同一时刻只一块屏, 名字与刹车都不必在这里点)
            children = buildList {
                if (screens.isEmpty()) {
                    add(Item(id = "none", title = "还没有已创建的虚拟屏", enabled = false))
                }
                // "现在这块画面能不能摸"要边看边切, 所以放在这一层第一条
                add(
                    Item(
                        id = "touch",
                        title = "虚拟屏触摸控制",
                        summary = "禁用以避免误操作",
                        on = PreviewControl.allowed,
                    ),
                )
                add(
                    Item(
                        id = "screen-release",
                        title = "释放虚拟屏",
                        enabled = selected != null,
                    ),
                )
                // 减号收掉的窗从这里叫回来 (窗收得干净, 界面上不留把手)
                add(
                    Item(
                        id = "screen-window",
                        title = windowToggle,
                        enabled = selected != null,
                    ),
                )
            },
        )
        return listOf(
            screensItem,
            Item(
                id = "sync",
                title = context.getString(R.string.menu_sync),
                // 2026-11-21: 这一行不再翻开关, 点进去是**终端那一页** (手机管电脑); 开关仍归设置页
                summary = if (sync.paired) {
                    context.getString(R.string.menu_sync_paired, sync.pairedFrom.ifBlank { "PC" })
                } else {
                    context.getString(R.string.menu_sync_need_remote)
                },
                on = false,
            ),
            // 公开构建 (LuwiTavern.enabled = false) 就没有这一行, 与球菜单同一个口径
            Item(
                id = "tavern",
                title = "酒馆",
                enabled = LuwiTavern.enabled,
            ),
            Item(
                id = "portal",
                title = if (PortalState.open) "回到后台" else "回到前台",
            ),
            Item(
                id = "feedback",
                title = "Luwi反馈",
            ),
            Item(
                id = "settings",
                title = "设置",
            ),
        ).filter { it.enabled }
    }

    private fun run(context: Context, id: String) {
        when {
            id == "screens" || id == "none" -> Unit
            id == "screen-release" -> VirtualScreen.selected?.let { VirtualScreen.release(it, byUser = true) }
            id == "screen-window" -> ScreenWindow.hidden = !ScreenWindow.hidden
            id == "touch" -> PreviewControl.set(context, !PreviewControl.allowed)
            // 页面那一行「开发」(排在探索下面) 走这里: 落一个掷标, 由 HostScreen 弹原生面板
            id == "dev" -> PortalAsk.ask(PortalAsk.Target.DEV)
            id == "sync" -> PortalTerminal.open(context)
            id == "tavern" -> PortalAsk.ask(PortalAsk.Target.TAVERN)
            // 与球菜单那一条同一句: 方向由页面报上来的 `PortalState.open` 决定
            id == "portal" -> PortalState.run?.invoke(
                if (PortalState.open) {
                    "window.__LUWI_PORTAL__ && window.__LUWI_PORTAL__.hide()"
                } else {
                    "window.__LUWI_PORTAL__ && window.__LUWI_PORTAL__.show()"
                },
            )
            id == "feedback" -> PortalAsk.ask(PortalAsk.Target.FEEDBACK)
            id == "settings" -> PortalAsk.ask(PortalAsk.Target.SETTINGS)
        }
    }

    // 2026-11-21: 这里原来那个 `toggleSync` 撤了 —— 终端那一行改成"打开终端那一页",
    // 开关本身只在设置页那一段翻 (改完仍要重启 host 才生效, 那一段自己会做)

    private fun encode(items: List<Item>): String {
        val array = JSONArray()
        items.forEach { array.put(encodeItem(it)) }
        return array.toString()
    }

    private fun encodeItem(item: Item): JSONObject = JSONObject().apply {
        put("id", item.id)
        put("title", item.title)
        put("summary", item.summary)
        put("on", item.on)
        put("enabled", item.enabled)
        if (item.children.isNotEmpty()) put("children", JSONArray().also { kids ->
            item.children.forEach { kids.put(encodeItem(it)) }
        })
    }

    /** 桥回调在 WebView 的 JavaBridge 线程上: 写状态与弹 Toast 都要回主线程 */
    private fun onMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block()
        else Handler(Looper.getMainLooper()).post(block)
    }
}
