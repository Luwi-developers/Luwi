package io.github.yuloong07star.luwi.channel

/**
 * 手机直连动作的路由
 *
 * 它现在只回答"该试哪些通道": 手机自己的屏上绝不为一条直连动作再建虚拟屏 (12-1), 虚拟屏上只有特权
 * `am` 落得下去 (12-2 的落点), 与屏无关的动作 (日历 / 通知 / 闹钟之类) 不管 displayId 是多少都照旧
 * 走应用进程里的那条路. 真正的 Android 调用在 B3-b 接上, 但"先走哪条, 什么时候算 unsupported"只在
 * 这一个地方回答 —— 宿主与 `lw_*` 工具各写一套的话, 两处迟早会给出不同的答案
 *
 * 通道的顺序来自 [DeviceAction], 这里只按目标屏过滤; 空结果表示没有可走的通道, 调用方应当把
 * [failure] 交给模型并明确说 unsupported, 不建屏, 也不重试
 *
 * B3-b 起它也是"哪半边执行"的唯一判据: [launchRoute] 与 [intentRoute] 在手机自己的屏上给出
 * [DeviceRoute.NATIVE] / [DeviceRoute.INTENT] (应用进程自己就能做), 只有虚拟屏才给
 * [DeviceRoute.VIRTUAL_SCREEN] (那一档只有特权 `am` 落得下去, 见 12-3)
 */
internal class DeviceActionBroker(
    actions: List<DeviceAction> = DeviceActionRegistry.actions,
) {

    private val byName: Map<String, DeviceAction> = actions.associateBy { it.name }

    /** 这一版认不认得这条动作, null 表示不认得 */
    fun find(name: String): DeviceAction? = byName[name.trim()]

    /**
     * 这条动作在这块屏上该试的通道, 首选在前
     *
     * @param displayId 0 是手机自己的屏, 非 0 是虚拟屏
     * @returns 可走的通道; 空表示没有一条能走, 应当按 unsupported 回答
     */
    fun routes(name: String, displayId: Int = MAIN_DISPLAY): List<String> {
        val action = find(name) ?: return emptyList()
        return routes(action, displayId)
    }

    /** 同 [routes], 直接拿一条已知的声明算 */
    fun routes(action: DeviceAction, displayId: Int = MAIN_DISPLAY): List<String> {
        // unsupported 是一句回答, 不是一条要去试的路
        val usable = action.routes.filter { it != DeviceRoute.UNSUPPORTED }
        if (displayId != MAIN_DISPLAY) {
            // 虚拟屏上只有特权 am 能把 activity 放上去; 与屏无关的动作不受这块屏影响
            return if (action.screenScoped) {
                usable.filter { it == DeviceRoute.VIRTUAL_SCREEN }
            } else {
                usable.filter { it != DeviceRoute.VIRTUAL_SCREEN }
            }
        }
        // 手机自己的屏上不为一条直连动作新建虚拟屏 (12-1): 虚拟屏那一档只在调用方点名时走
        return usable.filter { it != DeviceRoute.VIRTUAL_SCREEN }
    }

    /** 所有通道都走不通时交给模型的那句话 */
    fun failure(name: String): String = find(name)?.failureReason
        ?: "this build does not know the device action \"$name\""

    /**
     * `lw_launch` 在这块屏上该走哪半边
     *
     * 手机自己的屏上先问 PackageManager: launcher activity 是应用进程自己查得到、也起得动的, 不必
     * 借特权通道, 更不必为它建一块屏 (12-1). 虚拟屏上应用进程放不上去, 只有特权 `am` 那一条
     */
    fun launchRoute(displayId: Int = MAIN_DISPLAY): String =
        if (displayId == MAIN_DISPLAY) DeviceRoute.NATIVE else DeviceRoute.VIRTUAL_SCREEN

    /**
     * `lw_intent` 在这块屏上该走哪半边
     *
     * 手机自己的屏上直接由 Context 发 Intent, 所以链接 / 闹钟 / 拨号 / 应用设置这些常见动作既不依赖
     * 特权通道, 也不建屏; 只有虚拟屏才交给特权 `am start`
     */
    fun intentRoute(displayId: Int = MAIN_DISPLAY): String =
        if (displayId == MAIN_DISPLAY) DeviceRoute.INTENT else DeviceRoute.VIRTUAL_SCREEN

    private companion object {
        /** 手机自己那块屏, 与 `LwServiceProtocol.MAIN_DISPLAY` 是同一个 0 */
        const val MAIN_DISPLAY = 0
    }
}
