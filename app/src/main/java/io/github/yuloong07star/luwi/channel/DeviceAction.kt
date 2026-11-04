package io.github.yuloong07star.luwi.channel

/**
 * 手机直连的一条动作, 连同它准备怎么走
 *
 * 2.8.0 的直连顺序只有一条: 原生 API -> Intent / deep link -> 无障碍树 -> 虚拟屏 -> unsupported.
 * 这张声明把"一条动作是什么, 先走哪条路, 要什么权限, 试完都不行时说什么"放在一个地方, 于是执行那一侧
 * ([DeviceActionBroker]) 与"这一版有哪些动作" ([DeviceActionRegistry]) 不必各自记一份
 *
 * @property name 机器名, `lw_capabilities` 与宿主上报的都认它
 * @property title 给人看的一句
 * @property via 首选通道, 取 [DeviceRoute] 里的值
 * @property permission 这条动作要的权限, 不需要权限时写 [NO_PERMISSION]; **不许留空** —— 空着等于
 *   这条动作在"要不要权限"这一格上没有答案
 * @property risk 这条动作最多能造成多大影响
 * @property failureReason 所有通道都走不通时交给模型的那句话, **不许留空** —— 说不出为什么失败, 就
 *   只剩"假装成功"那一条路
 * @property fallbacks 首选通道不行时按顺序再试的通道; [DeviceRoute.UNSUPPORTED] 表示到此为止, 不是
 *   一条真要去试的路
 * @property screenScoped 这条动作是不是只对某一块屏有意义. 是的话, 点名虚拟屏时只能走特权 `am`,
 *   而手机自己的屏上不许为它再建一块虚拟屏 (12-1)
 */
internal data class DeviceAction(
    val name: String,
    val title: String,
    val via: String,
    val permission: String,
    val risk: DeviceRisk,
    val failureReason: String,
    val fallbacks: List<String> = emptyList(),
    val screenScoped: Boolean = false,
) {

    /** 首选在前, 去重之后的所有通道; 终点的 [DeviceRoute.UNSUPPORTED] 也在里面 */
    val routes: List<String> get() = (listOf(via) + fallbacks).distinct()

    init {
        require(name.isNotBlank()) { "a device action needs a name" }
        require(title.isNotBlank()) { "$name: a device action needs a title" }
        require(DeviceRoute.isKnown(via)) { "$name: unknown route \"$via\"" }
        require(via != DeviceRoute.UNSUPPORTED) { "$name: unsupported is an answer, not a route to try" }
        require(permission.isNotBlank()) { "$name: a device action has to say what permission it needs" }
        require(failureReason.isNotBlank()) { "$name: a device action has to say why it can fail" }
        require(fallbacks.all { DeviceRoute.isKnown(it) }) {
            "$name: unknown fallback in ${fallbacks.joinToString(", ")}"
        }
        require(fallbacks.none { it == via }) { "$name: the same route is listed twice" }
    }

    companion object {
        /** 不需要任何权限时 [permission] 写这一个词, 而不是留空 */
        const val NO_PERMISSION = "none"
    }
}

/**
 * 一条动作的通道
 *
 * 与 `12-2.8.0-手机直连能力` 里的路由顺序同一份词表: 前四条都在应用进程里完成, 第 5 条才需要特权
 * `am` 与一块虚拟屏, 最后一条是"这台设备做不到"的答案而不是一条要去试的路
 */
internal object DeviceRoute {

    /** 直接调 Android API: PackageManager / ContentResolver / NotificationListenerService 之类 */
    const val NATIVE = "native"

    /** 发一个 Intent 交给自己或别的应用去做: ACTION_VIEW / ACTION_DIAL / ACTION_SET_ALARM */
    const val INTENT = "intent"

    /** 交给已注册的快应用 runtime 的 URI: 不属于本应用的 activity, 也不建屏 */
    const val DEEP_LINK = "deep_link"

    /** 读无障碍树并按名字点: 界面上没有可由应用直接调用的 API 时走这条 */
    const val ACCESSIBILITY = "accessibility"

    /** 特权 `am` 把 activity 放到一块虚拟屏上: 只有调用方点名要虚拟屏时才走 */
    const val VIRTUAL_SCREEN = "virtual_screen"

    /** 所有通道都不行: 答案是一句 unsupported, 不建屏, 也不假装做过 */
    const val UNSUPPORTED = "unsupported"

    /** 从近到远; 需要屏的五条里只有最后一条要新建一块屏 */
    val order: List<String> = listOf(NATIVE, INTENT, DEEP_LINK, ACCESSIBILITY, VIRTUAL_SCREEN, UNSUPPORTED)

    /** 这条通道是不是词表里的那几条之一 */
    fun isKnown(route: String): Boolean = route in order
}

/** 一条动作最多能造成多大影响, 给以后按 risk 分档的闸用 */
internal enum class DeviceRisk {

    /** 只读, 不改设备状态 */
    NONE,

    /** 打开一个页面, 或者改一条无害的设置 */
    LOW,

    /** 读私密内容, 或者改设备状态 */
    MEDIUM,

    /** 能在别人的界面上随便按: 唯一一条真正需要用户想一下的 */
    HIGH,
}
