package io.github.yuloong07star.luwi.ui

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.yuloong07star.luwi.host.DshHost
import io.github.yuloong07star.luwi.host.HostStatus
import io.github.yuloong07star.luwi.sync.SyncSetting
import org.json.JSONObject
import java.io.File

/**
 * 门户那一页的「终端」(2026-11-21, 落实表 #48)
 *
 * 口径 (主人四条):
 *   · 终端 = **手机管电脑**: 只由手机把话发到电脑上执行; 电脑那边只把最近的对话同步过来,
 *     不再能控制这一台手机 (插件侧由 `peer.listen` / `peer.acceptSend` 两档闸兜住)
 *   · 点「终端」门户**整页变黑**; 还没连上电脑时只有「扫码配对 / 返回」两颗钮
 *   · 终端里那头像与名字是强制的 (`luwi` / `luwi终端`), 历史只列电脑那几场, 新建只建与电脑连的场
 *   · 后台浮标点「终端」也跳这一页 (`ui/PortalMenu.kt` 与 `HostScreen` 的球菜单都调 [open])
 *
 * 三条分寸:
 *
 * 1. **这一份只管"开没开"与"给页面的一份读数"**: 页面自己画终端, 自己算黑底与那两扇历史;
 *    原生只做页面做不到的三件 —— 铺黑底 (WebView 之外那一圈)、收起虚拟屏小窗、开扫码窗
 * 2. **`open` 由页面回报为准** ([report]): 页面重载 / 返回键 / 配对重启 host 之后, 两边各按页面说的
 *    那一个走; 原生只在人点入口时先翻一下 ([open]) 好让第一帧就是黑的
 * 3. **不接受真令牌出门**: [status] 里只有"配没配对 / 有没有地址", 口令一个字节都不进页面
 */
internal object PortalTerminal {

    /** 终端开着没有 (页面每次进出都 [report] 一次) —— HostScreen 读它决定黑底与虚拟屏小窗 */
    var open by mutableStateOf(false)

    /**
     * 影子根: 电脑那几场会话的 cwd 都在这底下
     *
     * **`DshHost.settingsDirectory` 已经是 `<DSH_HOME>/lw`** (见它自己那一行), 所以这里只再拼
     * `peer-workspaces` —— 多拼一层 `lw/` 就成了 `<DSH_HOME>/lw/lw/peer-workspaces`, 与插件的
     * `shadowRoot` (`join(dirname(sessionRoot), 'lw', 'peer-workspaces')`) 永远对不上
     */
    fun shadowRoot(context: Context): File = File(DshHost.settingsDirectory(context), "peer-workspaces")

    /**
     * 人点了「终端」(球菜单 / 门户头栏 / 抽屉): 先翻开关, 再让页面进终端
     *
     * `show()` 是幂等的 (页面里 `mount()` 自己判), 于是后台那一路也能一次到位 —— 先回到前台,
     * 再进终端; 页面这时还没挂上时 `terminal(true)` 会记住并等挂载那一帧自己补
     */
    fun open(context: Context) {
        open = true
        PortalState.run?.invoke(OPEN_SCRIPT)
    }

    /** 页面回报它现在在不在终端里 (只镜像, 不反向驱动页面 —— 免得来回打圈) */
    fun report(visible: Boolean) {
        // 桥回调在 WebView 的 JavaBridge 线程上: Compose 的状态只认主线程那一次快照
        if (Looper.myLooper() == Looper.getMainLooper()) {
            open = visible
        } else {
            Handler(Looper.getMainLooper()).post { open = visible }
        }
    }

    /**
     * 给页面的那份读数 (页面照着决定画终端还是弹「扫码配对 / 返回」)
     *
     * @return 一段 JSON; 键缺一个页面就少一样判断, 所以这里一次给全
     */
    fun status(context: Context): String {
        val sync = SyncSetting.snapshot(context)
        return JSONObject().apply {
            put("paired", sync.paired)
            put("pairedId", sync.pairedId)
            put("pcName", sync.pairedFrom)
            put("syncOn", sync.syncOn)
            // **地址不进页面** (2026-11-21 审查): 对端地址里可能有 userinfo / `?token=`, 而页面根本
            // 不读它 —— 插件自己那条纪律 (sanitizeRemote) 也要求这类值不出宿主
            put("terminalReady", sync.terminalReady)
            put("shadowRoot", shadowRoot(context).absolutePath)
            put(
                "host",
                if (DshHost.status is HostStatus.Running) "running" else "starting",
            )
        }.toString()
    }

    /**
     * 页面那一句: `show(); terminal(true)`
     *
     * 两句都要带存在性判断 —— 页面还没挂上 (首帧 / 重载中) 时, 直接点方法就是 TypeError
     */
    private const val OPEN_SCRIPT =
        "window.__LUWI_PORTAL__ && window.__LUWI_PORTAL__.show();" +
            "window.__LUWI_PORTAL__ && window.__LUWI_PORTAL__.terminal(true)"
}
