package io.github.yuloong07star.luwi.ui

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.mutableStateOf

/**
 * 页面请原生开窗的唯一一条路 (2026-11-13)
 *
 * 值 = focus 词 (`explore` / `proactive` / `router` / `top`), `null` = 关着。门户那两颗「设置」
 * (判断面板与探索面板动作行的最右一颗) 只翻这一个开关, 参数本身仍归 app 这一侧读写 —— 页面
 * 一个字节不写盘, 与面板上那几行读数同一条边界
 *
 * **为什么写回主线程**: 桥回调在 WebView 的 JavaBridge 线程上, 而 Compose 只认主线程那一次快照
 * (裸 var 不会让界面重组, 从别的线程写 state 也不是它承诺的用法), 所以这里 post 一下
 *
 * 同一个开关也用在关闭之后: 关掉弹窗就回同一张面板, 面板上那几行读数由页面自己再拉一次
 * (见 `portalActivitySettings` 的回执与 `client.js` 的 `onSettingsClosed`)
 */
internal object PortalAsk {
    /** 弹窗的焦点词; 读它就会跟着重组, 关掉时置回 null */
    val activitySettings = mutableStateOf<String?>(null)

    /** 页面点了「设置」: 落一个焦点词并开窗 */
    fun ask(focus: String) {
        onMain { activitySettings.value = focus }
    }

    /** 弹窗关掉了 */
    fun close() {
        onMain { activitySettings.value = null }
    }

    private fun onMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block()
        else Handler(Looper.getMainLooper()).post(block)
    }
}
