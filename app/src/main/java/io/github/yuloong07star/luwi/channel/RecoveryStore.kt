package io.github.yuloong07star.luwi.channel

import android.content.Context
import android.content.SharedPreferences

/**
 * 「体检表」留在本机的两格记号: **这台机器曾经全绿过**, 以及**最后一块屏是什么尺寸**
 *
 * 为什么要记第一格: 卡片上那个按钮在两种人眼里该是两个不同的东西 —— 第一次装的人需要"告诉我还差
 * 什么", 用过一阵的人需要"把我掉的那几样弄回来"。这两件事在状态上长得一模一样 (都缺东西), 区别只
 * 有一个过去的记号能分开。没有它就只能猜, 而猜错的那个方向 (把老用户当新人) 会让一个用过一周的人
 * 再走一遍新人引导
 *
 * 为什么要记第二格: 屏是活在特权进程里的东西, 应用被杀、手机重启都会让它消失, 而 [VirtualScreen.screens]
 * 那时候是空的。不带参数重建会退回系统屏幕的尺寸 —— 用户改过尺寸的那块屏就再也回不来了。这四个数
 * 本来就是 [VirtualScreen.create] 的参数, 记下来只是把它们传回去
 *
 * 与 [AccessibilitySetting] 那两档记号放在同一个文件 (`luwi`): 都是"这台机器上发生过什么", 分开存
 * 反而要在两处解释同一个文件名
 */
internal object RecoveryStore {

    private const val STORE = "luwi"

    /** 三项都到位过一次。写下去就不再清: 它说的是"这个人曾经过关", 不是"现在好着" */
    private const val KEY_READY = "ready-ever"

    private const val KEY_WIDTH = "ready-screen-width"
    private const val KEY_HEIGHT = "ready-screen-height"
    private const val KEY_DPI = "ready-screen-dpi"

    /** 这台机器全绿过没有。它决定卡片是「开始使用」还是「需要恢复一下」 */
    fun ready(context: Context): Boolean = prefs(context).getBoolean(KEY_READY, false)

    /**
     * 记住"已经全绿过"
     *
     * 幂等且不覆盖: 一次 `apply()` 已经写过就什么都不做, 免得每次进页面都碰一次磁盘
     */
    fun markReady(context: Context) {
        if (ready(context)) return
        prefs(context).edit().putBoolean(KEY_READY, true).apply()
    }

    /** 最后一块屏的形状, 或者从来没建过 */
    fun screen(context: Context): ScreenShape? {
        val store = prefs(context)
        val width = store.getInt(KEY_WIDTH, 0)
        val height = store.getInt(KEY_HEIGHT, 0)
        // 0 是 [VirtualScreen.create] 嘴里"用这台设备的"的意思, 所以它不能当"记过一个 0 宽的屏"
        if (width <= 0 || height <= 0) return null
        return ScreenShape(width, height, store.getInt(KEY_DPI, 0))
    }

    /** 这一块建成了, 记下它的形状 */
    fun remember(context: Context, screen: ScreenState) {
        prefs(context).edit()
            .putInt(KEY_WIDTH, screen.width)
            .putInt(KEY_HEIGHT, screen.height)
            .putInt(KEY_DPI, screen.dpi)
            .apply()
    }

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(STORE, Context.MODE_PRIVATE)
}

/**
 * 一块屏的形状, 够 [VirtualScreen.create] 建回同一块
 *
 * 只记尺寸与密度, 不记名字与 displayId: displayId 由系统重新分配, 而名字是给人看的装饰, 它跟着屏
 * 一起消失也不影响"这是原来那块"这件事
 */
internal data class ScreenShape(val width: Int, val height: Int, val dpi: Int)
