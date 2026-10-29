package io.github.yuloong07star.luwi.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.util.Log

/**
 * 忽略电池优化那一份名单 (`dumpsys deviceidle whitelist`)
 *
 * **为什么值得单独一份** (2026-10-26 主人: "加强 dsh 后台持久化"): host 是一个自起的前台服务, 但它
 * 不是"音乐播放"那一类会被系统高看一眼的东西 —— 不在名单里时, 息屏之后网络会被挂起 (Doze), 后台也
 * 会被冻住, 表现就是"切回来又要重新加载"与"夜里那一场探索投不出去"。装机脚本
 * (`lw-install.ps1`) 会给这一条, 但从官网自己装的人拿不到, 所以应用里要有一个点一下就能允许的入口
 *
 * [request] 先要那个系统确认框 (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`), 拿不到接收者 (个别
 * ROM 上没有这一页) 才退到名单那一页 —— 那一页要多点两下, 但总能到, 所以两条都失败才算失败
 */
internal object BatteryWhitelist {

    private const val TAG = "LwBattery"

    /** 现在在不在名单里 (在 = 系统不会优化我们 = 设置页说的"已允许") */
    fun ignored(context: Context): Boolean {
        val manager = context.getSystemService(PowerManager::class.java) ?: return false
        return runCatching { manager.isIgnoringBatteryOptimizations(context.packageName) }
            .getOrDefault(false)
    }

    /**
     * 请主人允许一次
     *
     * @return 打开了哪一种 (`request` = 系统确认框, `settings` = 名单那一页); 两条都没有接收者时 null
     */
    fun request(context: Context): String? {
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (start(context, direct)) return "request"
        val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (start(context, list)) return "settings"
        Log.w(TAG, "no system page accepted the battery optimisation request")
        return null
    }

    private fun start(context: Context, intent: Intent): Boolean = runCatching {
        context.startActivity(intent)
        true
    }.getOrElse {
        Log.i(TAG, "no activity for ${intent.action}: ${it.message}")
        false
    }
}
