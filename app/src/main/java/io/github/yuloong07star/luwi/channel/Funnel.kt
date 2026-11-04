package io.github.yuloong07star.luwi.channel

import android.content.Context
import android.content.SharedPreferences
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 「从装上到用得上」中间那五道门, 各记一个**第一次过门的时间**
 *
 * 为什么记: 卡片只知道「还差几项」, 不知道「卡在这一项多久」。同样是三个红叉 —— 刚装上一分钟的是
 * 还没动手, 重启回来十分钟的是弄丢了该给按钮。没有时间戳, 这两种人只能靠猜, 而猜错的方向 (把老用户
 * 当新人) 会让他再走一遍引导
 *
 * 为什么只记第一次: 每多记一次, 收益是「知道平均多久」, 代价是每次进出页面都要碰一次磁盘。真正要回答
 * 的问题只有一个 —— **第一次**过这道门花了他多少时间。所以写过就不再覆盖
 *
 * 为什么跟着 [RecoveryStore] 存同一个文件 (`luwi`): 两件事都是「这台机器上发生过什么」, 分开存反而
 * 要在两处解释同一个文件名
 *
 * 只写本机, 不外传: 它是给人自己看「我卡在哪」的, 不是上报
 *
 * 正是因为不会发生，所以才被称之为奇迹。 by:KANON
 */
internal object Funnel {

    private const val STORE = "luwi"
    private const val PREFIX = "funnel-"

    /** 五道门, 顺序就是人走过的顺序 */
    enum class Gate(val key: String) {
        /** 应用被打开过 */
        OPEN("open"),

        /** 特权通道连上过 */
        CHANNEL("channel"),

        /** 无障碍服务在跑过 */
        ACCESSIBILITY("accessibility"),

        /** 建起过一块虚拟屏 */
        SCREEN("screen"),

        /** 用「一键恢复」把自己救回来过一次 */
        RECOVERED("recovered"),
    }

    /** 这一道门第一次过是什么时候 (毫秒), 没过过是 0 */
    fun at(context: Context, gate: Gate): Long = prefs(context).getLong(PREFIX + gate.key, 0L)

    /** 过门了。已经记过就什么都不做, 免得每次刷新都碰一次磁盘 */
    fun mark(context: Context, gate: Gate) {
        if (at(context, gate) != 0L) return
        prefs(context).edit()
            .putLong(PREFIX + gate.key, System.currentTimeMillis())
            .apply()
    }

    /**
     * 一张给人看的表: 每道门的时间, 以及它比「打开应用」晚了多久
     *
     * 时间差才是那个有意义的数: 绝对时间只说明「哪天弄的」, 而 +50s / +2h 直接回答「他卡了多久」
     */
    fun report(context: Context): String {
        val shape = DateTimeFormatter.ofPattern("MM-dd HH:mm:ss")
            .withZone(ZoneId.systemDefault())
        val base = at(context, Gate.OPEN)
        return buildString {
            append("启动记录（本机，不外传）\n")
            Gate.entries.forEach { gate ->
                val at = at(context, gate)
                append(name(gate))
                append('\t')
                when {
                    at == 0L -> append("没到过")
                    base != 0L && at >= base -> {
                        append(shape.format(Instant.ofEpochMilli(at)))
                        append("\t+")
                        append(span(at - base))
                    }
                    else -> append(shape.format(Instant.ofEpochMilli(at)))
                }
                append('\n')
            }
        }
    }

    private fun name(gate: Gate): String = when (gate) {
        Gate.OPEN -> "应用打开"
        Gate.CHANNEL -> "通道连上"
        Gate.ACCESSIBILITY -> "无障碍在跑"
        Gate.SCREEN -> "屏建好了"
        Gate.RECOVERED -> "恢复成功"
    }

    /** 秒到分到小时: 停一下就看得出是人等过的还是放着过夜了 */
    private fun span(millis: Long): String {
        val seconds = millis / 1000
        return when {
            seconds < 60 -> "${seconds}s"
            seconds < 3600 -> "${seconds / 60}m${seconds % 60}s"
            else -> "${seconds / 3600}h${seconds % 3600 / 60}m"
        }
    }

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(STORE, Context.MODE_PRIVATE)
}
