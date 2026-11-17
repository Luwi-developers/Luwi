package io.github.yuloong07star.luwi.tool

import android.content.Context

/**
 * 开发工具链那一行的两个动作 (2026-11-17 改口径)
 *
 * 这一份只是个门面: 真正的三跳 (下 / 摊 / 装) 在 [ToolchainPack] 里, 状态读的是特权侧的
 * `forge.status` —— **工具链不再是一件伴侣 APK**, 所以这里没有绑定、没有同签名权限、没有安装器
 */
internal object DevToolchain {

    /** 现在的状态, 一句话 (设置页那一行与 `op=status` 都读它) */
    fun status(context: Context): String = ToolchainPack.status(context)

    /** 下一次装一次: 下载 → 摊开 → 交给特权进程搬进 `/data/local/tmp/lwforge/toolchain` */
    fun install(context: Context): String = ToolchainPack.install(context)
}
