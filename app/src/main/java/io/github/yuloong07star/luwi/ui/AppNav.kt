package io.github.yuloong07star.luwi.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch
import top.yukonga.miuix.kmp.basic.SnackbarDuration
import top.yukonga.miuix.kmp.nav.core.NavCornerClipMode
import top.yukonga.miuix.kmp.nav.core.NavDisplay
import top.yukonga.miuix.kmp.nav.core.NavDisplayEffects
import top.yukonga.miuix.kmp.nav.core.NavKey
import top.yukonga.miuix.kmp.nav.core.rememberNavBackStack
import top.yukonga.miuix.kmp.nav.core.rememberNavSystemCornerRadius
import top.yukonga.miuix.kmp.nav.transition.NavSwipeDirection
import top.yukonga.miuix.kmp.nav.transition.NavTransitions
import top.yukonga.miuix.kmp.squircle.LocalSquircleEnabled
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.host.BallReturn
import io.github.yuloong07star.luwi.theme.ApplySystemBarsAppearance
import io.github.yuloong07star.luwi.theme.ThemeStore
import io.github.yuloong07star.luwi.theme.controller
import io.github.yuloong07star.luwi.update.AutoUpdate
import io.github.yuloong07star.luwi.update.AutoUpdatePrompt
import kotlinx.serialization.Serializable

/** 应用里有哪几页, 可序列化是因为导航要把返回栈存下来 */
@Serializable
sealed interface Screen : NavKey {
    @Serializable
    data object Home : Screen

    @Serializable
    data object Settings : Screen

    /** 设置 → 技能 → 已装的那一页 (2.7.8 批次 5): 检测更新 / 一键升级 / 卸载 */
    @Serializable
    data object SkillsInstalled : Screen

    /** 设置 → 技能 → 可用的那一页: 索引里全部技能, 刷新与全部安装都在那儿 */
    @Serializable
    data object SkillsAvailable : Screen

    /** 设置 → 插件 → 某一只插件的那一页 (2.7.8 批次 6): 停用 / 它自己的设置 / 卸载与数据 */
    @Serializable
    data class PluginDetail(val id: String) : Screen

    /**
     * 会话界面右上角那个菜单 → 酒馆首页 (2026-10-24 主人)
     *
     * 从这里进的是首页 (进入酒馆 / 选择存档 / 选择主题 / 打开配置); 2026-10-24 晚主人又定了一条:
     * 设置页那一段的"打开酒馆"也改成进首页 (原来它直奔聊天页)
     */
    @Serializable
    data object TavernHome : Screen

    /** 设置 → 酒馆 → 聊天页 (P1): 一块独立的 WebView, 不挂 dsh 的任何桥 */
    @Serializable
    data object TavernChat : Screen

    /** 配置页: 资料 / 角色卡 / 故事书 (首页的「打开配置」与设置段那条「配置」都落这儿) */
    @Serializable
    data object TavernConfig : Screen

    /** 酒馆里那几页 (从首页或设置段进去): 资料 / 角色卡 / 故事书 / 存档(会话) / 主题 */
    @Serializable
    data object TavernProfile : Screen

    @Serializable
    data object TavernCards : Screen

    @Serializable
    data object TavernWorldbooks : Screen

    @Serializable
    data object TavernSessions : Screen

    /** 新建存档 (2026-10-25 主人: "新建存档新开页面"): 主角 / 角色 / 故事书 / 背景各一个二级界面 */
    @Serializable
    data object TavernNewSave : Screen

    @Serializable
    data object TavernThemes : Screen
}

/** 谁想换页就问它, 页面自己不持有返回栈 */
class RootNavigator(
    val push: (Screen) -> Unit,
    val pop: () -> Unit,
)

val LocalRootNavigator = staticCompositionLocalOf<RootNavigator> {
    error("No RootNavigator provided")
}

/**
 * 整个应用: 主题 + 两页之间的导航
 *
 * 外观设置在这里落到 Miuix 上, 所以设置页改完立刻生效, 不需要重启; 导航用的是 miuix-nav,
 * 页面切换的动效与侧滑返回也跟着设置走
 */
@Composable
fun LuwiApp() {
    val settings = ThemeStore.current
    val backStack = rememberNavBackStack<Screen>(Screen.Home)
    val navigator = remember(backStack) {
        RootNavigator(
            push = { backStack.add(it) },
            pop = { if (backStack.size > 1) backStack.removeAt(backStack.lastIndex) },
        )
    }
    // 「回应用」那一跳 (双击回复框 / 菜单「返回应用」) 落到设置页那一层时: **先回主页** —— 会话界面在
    // 主页上, 不回去的话会话切了也看不见。请求本身由主页那块 WebView 落地 (见 HostScreen), 这里只管
    // 把挡在前面的页收掉
    val ballRequest = BallReturn.request
    LaunchedEffect(ballRequest?.seq) {
        if (ballRequest == null) return@LaunchedEffect
        while (backStack.size > 1) backStack.removeAt(backStack.lastIndex)
    }
    val controller = remember(
        settings.mode,
        settings.monet,
        settings.seed,
        settings.palette,
        settings.spec,
    ) {
        settings.controller()
    }
    // 2026-10-27 主人: "取消左右跳转, 直接跳转" —— 那天把全局转场换成 NavTransitions.None;
    // 2026-10-27 晚主人补一句: "除酒馆页面, 跳转继续用左右翻转进入" —— 所以全局转场恢复
    // MiuixDefault (左右滑动进场), 只有酒馆那几页在 entry 上单独钉 None (进出酒馆都不扫光,
    // 避开两页亮度差被整片扫过的闪)。
    // 注意: 横滑返回的登记仍在每个 entry 上 (swipeDismiss), 只是 None 这一档没有跟手位移
    val swipe = NavSwipeDirection.LeftToRight
    val transition = NavTransitions.MiuixDefault

    // 主页上按返回不等于离开应用: 这一句提示是"再按一次"的第一次, 第二次才把任务放到后台去。
    // 不管任务是去是留, host 与虚拟屏都照跑, 所以这里既不 finish 也不停服务
    val activity = LocalActivity.current
    val scope = rememberCoroutineScope()

    /**
     * 返回键这一下归这里管
     *
     * 第一下弹提示, 第二下把任务放到后台 —— **不是退出**: 服务与虚拟屏照跑, 从最近任务回来还是原样。
     * 提示条挂在主页那层 `SnackbarHost` 上, 所以这里只负责决定"弹"还是"走"
     */
    val onBack = {
        if (ExitHint.press()) {
            activity?.moveTaskToBack(true)
        } else if (ExitHint.showHint()) {
            val message = activity?.getString(R.string.exit_hint_again)
            if (message != null) {
                scope.launch {
                    ExitHint.host.showSnackbar(
                        message,
                        duration = SnackbarDuration.Custom(ExitHint.VISIBLE_MS),
                    )
                }
            }
        }
    }

    MiuixTheme(controller = controller) {
        // 系统栏图标要跟着实际渲染出来的配色, 手动钉成深色时也得跟着变
        ApplySystemBarsAppearance(LocalActivity.current?.window)
        val cornerRadius = rememberNavSystemCornerRadius()
        val backdrop = colorScheme.surface
        val effects = remember(cornerRadius, backdrop) {
            NavDisplayEffects(
                enableCornerClip = true,
                cornerClipRadius = cornerRadius,
                cornerClipMode = NavCornerClipMode.Leading,
                // 2026-10-25 主人: 进场那一瞬上一页被压暗 (录屏亮度 45.6→35.1→54, 约 100 ms)
                // 看着就是"还会闪"; 转场本身仍是 MiuixDefault, 只把这一层 dim 收掉
                dimAmount = 0f,
                blockInputDuringTransition = true,
                backdropColor = backdrop,
            )
        }
        CompositionLocalProvider(
            LocalRootNavigator provides navigator,
            LocalSquircleEnabled provides settings.squircle,
        ) {
            NavDisplay(
                backStack = backStack,
                // 还有上一页就是普通的返回; 只剩主页时那一下交给 onBack 决定
                onBack = { if (backStack.size > 1) navigator.pop() else onBack() },
                transition = transition,
                effects = effects,
            ) {
                entry<Screen.Home>(swipeDismiss = swipe) { HostScreen() }
                entry<Screen.Settings>(swipeDismiss = swipe) { SettingsScreen() }
                entry<Screen.SkillsInstalled>(swipeDismiss = swipe) { SkillsInstalledScreen() }
                entry<Screen.SkillsAvailable>(swipeDismiss = swipe) { SkillsAvailableScreen() }
                entry<Screen.PluginDetail>(swipeDismiss = swipe) { key -> PluginDetailScreen(key.id) }
                // 酒馆那几页的 entry 全在 LuwiTavern 里 (公开构建换成 stub 就一条都不登记)
                LuwiTavern.tavernEntries(this)
            }
            // 酒馆聊天页那一秒盖板 (2026-10-27 主人: 进出聊天页时铺一秒全屏主题背景, 把 WebView 那
            // 几百毫秒的闪挡掉)。**必须画在 NavDisplay 上层**: 盖板要是放在聊天页里, 退出那一刻它跟着
            // 页面一起没了, 正好漏掉要挡的那一下。只有聊天页会调 `TavernWipe.show`, 别的页面不受影响
            LuwiTavern.overlays()
            // 冷启动查到的那个新版本 (2.7.9 第 3 条): 只在新版本真的到了才有内容 —— 状态是自动那条
            // 自己的一份 (AutoUpdatePrompt), 与设置页手动「检测更新」那一趟的账互不覆盖
            val context = LocalContext.current
            val newerRelease = AutoUpdatePrompt.release
            if (newerRelease != null) {
                AutoUpdateDialog(
                    release = newerRelease,
                    localVersion = AutoUpdatePrompt.localVersion,
                    // 关窗 = 今天别再问 (那天已经查过了), 明天冷启动还会再问一次
                    onDismiss = { AutoUpdatePrompt.dismiss() },
                    // 不再提示 = 记住这一版, 直到远端又出一个更新的版本
                    onSkip = {
                        AutoUpdate.skipVersion(context, newerRelease.version)
                        AutoUpdatePrompt.dismiss()
                    },
                )
            }
            // 首启的模型说明 (2026-10-28 主人): 缺唤醒词 / 语音模型时弹一次, 只弹一次;
            // 检测与"弹过了"都记在 ModelSetup 里, 这里只负责把它挂到每一页之上
            ModelSetupPrompt()
            // 首启那张「开始使用」体检表 (2026-11-04 主人 #1①): 第一次进应用时若还有没办的就弹一次,
            // 一个居中对话框, 弹过记在 `ready-dialog-seen` 里, 之后走设置页那一行「检查所需依赖」。
            // 挂在最外层 (与上面那条同一个位置), 于是它在**开屏那一屏**上就盖得住
            ReadyPrompt()
            // 首启那张「别自己更新随包插件」的告示 (2026-10-30 主人): 一辈子只弹一次, 摆在
            // **所有弹窗之上** —— 所以它排在模型说明后面 (窗口按创建次序叠, 后建的在上面)
            BundledPluginNoticePrompt()
            // **返回键的最后一道**: 没被接住的那一下是平台的默认行为 —— 把这个 activity 关掉, 于是
            // host 与虚拟屏一起没了。所以这里兜底: 要么弹提示, 要么把任务放到后台, 两者都不结束任何
            // 东西
            //
            // **它必须自己先让返回栈弹一层** (2026-10-08 修): `BackHandler` 是**后登记的先赢** (LIFO),
            // 而这一行排在 `NavDisplay` 后面, 于是库里那个"还有上一页就 pop"的 handler 永远轮不到 ——
            // 现象就是**系统返回键在设置页与捐赠页上什么都不做** (只能点左上角那个 ←, 或者开着"横滑
            // 返回"时右滑)。原来那句注释以为这里登记得比库早, 那是错的
            //
            // **主页那一层还要先问网页一句** (2026-10-18): 点一条网页链接会开在右栏那个浏览器格里,
            // 而手机上那一格是全屏的, 会话被整个盖住 —— 那时按返回只会弹「再按一次退出」。网页里
            // 收得掉这一层就把这一下交给它 (见 [PageBack]), 收不掉才走下面那条
            BackHandler {
                // 酒馆新建存档的二级界面先回上一层 (它不是独立路由, 见 LuwiTavern.handleBack)
                if (LuwiTavern.handleBack()) return@BackHandler
                if (backStack.size > 1) {
                    navigator.pop()
                    return@BackHandler
                }
                val page = PageBack.handle
                if (page == null) onBack() else page { onBack() }
            }
        }
    }
}

