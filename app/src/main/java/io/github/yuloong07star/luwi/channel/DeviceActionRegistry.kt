package io.github.yuloong07star.luwi.channel

/**
 * 这一版认得的手机直连动作
 *
 * 表只有这一份: 执行 ([DeviceActionBroker]) 与以后的 `lw_capabilities` 都从它读, 不各自维护一份
 * "有哪些动作". 每一条的 [DeviceAction.via] / [DeviceAction.permission] /
 * [DeviceAction.failureReason] 都必须写出来 —— 直连最常见的一种坏结果是"其实没做到, 却回了一句成功",
 * 所以宁可把"走哪条路, 要什么权限, 不行时说什么"写在声明里
 *
 * 首批十项与 `12-2.8.0-手机直连能力` 的表格一一对应; 顺序也照那张表, 免得两处对不上
 */
internal object DeviceActionRegistry {

    /** 首批能力, 顺序与 12 文档的表格一致 */
    val actions: List<DeviceAction> = listOf(
        DeviceAction(
            name = "open_app",
            title = "open an app",
            via = DeviceRoute.NATIVE,
            permission = DeviceAction.NO_PERMISSION,
            risk = DeviceRisk.LOW,
            failureReason = "no app on this device matches that name, or it has no launcher activity",
            fallbacks = listOf(DeviceRoute.VIRTUAL_SCREEN),
            screenScoped = true,
        ),
        DeviceAction(
            name = "open_url",
            title = "open a link",
            via = DeviceRoute.INTENT,
            permission = DeviceAction.NO_PERMISSION,
            risk = DeviceRisk.LOW,
            failureReason = "no app on this device can open that link",
            fallbacks = listOf(DeviceRoute.VIRTUAL_SCREEN),
            screenScoped = true,
        ),
        DeviceAction(
            name = "quick_app",
            title = "open a quick app",
            via = DeviceRoute.DEEP_LINK,
            permission = DeviceAction.NO_PERMISSION,
            risk = DeviceRisk.LOW,
            failureReason = "no quick app runtime is registered, and no deep link on this device answers to it",
            fallbacks = listOf(DeviceRoute.UNSUPPORTED),
        ),
        DeviceAction(
            name = "calendar",
            title = "read the calendar",
            via = DeviceRoute.NATIVE,
            permission = "android.permission.READ_CALENDAR",
            risk = DeviceRisk.NONE,
            failureReason = "calendar access has not been granted, or no event matches that window",
            fallbacks = listOf(DeviceRoute.UNSUPPORTED),
        ),
        DeviceAction(
            name = "notifications",
            title = "summarize notifications",
            via = DeviceRoute.NATIVE,
            permission = "notification access",
            risk = DeviceRisk.MEDIUM,
            failureReason = "notification access has not been granted on this device",
            fallbacks = listOf(DeviceRoute.UNSUPPORTED),
        ),
        DeviceAction(
            name = "alarm",
            title = "set an alarm",
            via = DeviceRoute.INTENT,
            // 系统那条 SET_ALARM 是要权限的: 声明成 none 时真机上被拒成 "Permission Denial ...
            // requires com.android.alarm.permission.SET_ALARM" (2026-11-03 真机读数). 它是安装时
            // 自动给的那一档, 所以写出来只是把"要不要问用户"这件事说清, 不需要运行时弹窗
            permission = "com.android.alarm.permission.SET_ALARM",
            risk = DeviceRisk.LOW,
            failureReason = "no clock app on this device answers to ACTION_SET_ALARM",
            fallbacks = listOf(DeviceRoute.UNSUPPORTED),
        ),
        DeviceAction(
            name = "dial",
            title = "open the dialer",
            via = DeviceRoute.INTENT,
            permission = DeviceAction.NO_PERMISSION,
            risk = DeviceRisk.LOW,
            failureReason = "no dialer app on this device answers to ACTION_DIAL",
            fallbacks = listOf(DeviceRoute.UNSUPPORTED),
        ),
        DeviceAction(
            name = "app_settings",
            title = "open the app's settings page",
            via = DeviceRoute.INTENT,
            permission = DeviceAction.NO_PERMISSION,
            risk = DeviceRisk.LOW,
            failureReason = "the application details page could not be opened for that package",
            fallbacks = listOf(DeviceRoute.UNSUPPORTED),
        ),
        DeviceAction(
            name = "media",
            title = "control media",
            via = DeviceRoute.NATIVE,
            permission = "notification access",
            risk = DeviceRisk.MEDIUM,
            failureReason = "no active media session is playing on this device",
            fallbacks = listOf(DeviceRoute.UNSUPPORTED),
        ),
        DeviceAction(
            name = "ui_tap",
            title = "tap a control on a screen",
            via = DeviceRoute.ACCESSIBILITY,
            permission = "accessibility service",
            risk = DeviceRisk.HIGH,
            failureReason = "the accessibility tree does not contain that control",
            fallbacks = listOf(DeviceRoute.VIRTUAL_SCREEN),
            screenScoped = true,
        ),
    )

    /** 名字到动作, 名字按机器名精确匹配 */
    private val byName: Map<String, DeviceAction> = actions.associateBy { it.name }

    init {
        require(byName.size == actions.size) { "two device actions share a name" }
    }

    /** 这一版认不认得这条动作, null 表示不认得 */
    fun find(name: String): DeviceAction? = byName[name.trim()]

    /** 与 [find] 相同, 但认不出来时直接报错: 表里的动作都由它取 */
    fun require(name: String): DeviceAction =
        find(name) ?: error("this build does not know the device action \"$name\"")

    /** 这一版认得的动作名, 顺序与 [actions] 一致 */
    val names: List<String> get() = actions.map { it.name }
}
