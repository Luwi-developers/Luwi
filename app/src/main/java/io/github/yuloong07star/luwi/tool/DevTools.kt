package io.github.yuloong07star.luwi.tool

/**
 * 「开发」那一段用到的两个外部地址 (2.8.1; 2026-11-17 收成一份数据包)
 *
 * 这里现在只剩**工具链**一件事: 开发台已经搬进主应用 (`ui/DevConsoleActivity`), 没有第二件 APK 要下.
 * 所以这一份也不再需要「下完交系统安装器」那一套
 *
 * 地址顺序是 2026-11-17 在真机上量出来的:
 *
 * 1. 三个 GitHub 加速代理 —— 直连 github.com 下一个 113 MB 的单件会 `unexpected end of stream`,
 *    jsDelivr 的 TLS 在这边又连不上
 * 2. 直连 Releases (海外网络好用)
 * 3. 官网 `/dl/` 兜底 (现在是 SPA 的 200 + HTML, 铺了真文件之后自动用上)
 */
internal object DevTools {

    /** 工具链数据包的主址 + 兜底 */
    /** 直连 GitHub Releases 那一份 (2026-11-17 面板里「直链」那一档) */
    const val DIRECT_BASE = "https://github.com/Yuloong07/luwi-devtools/releases/download/devtools-v1"

    /** 三个 GitHub 加速代理 (面板里「镜像」那一档) */
    val MIRRORS: List<String> = listOf(
        "https://ghproxy.net/https://github.com/Yuloong07/luwi-devtools/releases/download/devtools-v1",
        "https://gh-proxy.com/https://github.com/Yuloong07/luwi-devtools/releases/download/devtools-v1",
        "https://ghfast.top/https://github.com/Yuloong07/luwi-devtools/releases/download/devtools-v1",
    )

    /** 自动那一档: 镜像在前, 直连与官网兜底 */
    val HOSTS: List<String> = MIRRORS + listOf(DIRECT_BASE, "https://luwi.dpdns.org/dl")

    /** 面板里选「直链」时只用这一条 */
    fun directHosts(): List<String> = listOf(DIRECT_BASE)

    /** 面板里选「镜像」时用这三个代理 */
    fun mirrorHosts(): List<String> = MIRRORS

    /** 直链下不动时人还能自己去翻的那一页 */
    const val PAGE = "https://github.com/Yuloong07/luwi-devtools/releases"

    /** 工具链数据包的名字 (与发布侧那份逐字一致) */
    const val TOOLCHAIN_ASSET = "luwi-toolchain.zip"

    /** 整包 sha256 (与 `toolchain/` 打出来的 zip 逐字节一致; 少一个字节就当场回红) */
    const val TOOLCHAIN_SHA256 = "f6a56e34a730dc0179bead9b115d77c2ffb4118282c1b01326b9e149e3b067dd"

    /** 工具链包的全部下载地址 (顺序即尝试顺序) */
    fun toolchainUrls(): List<String> = HOSTS.map { base -> "$base/$TOOLCHAIN_ASSET" }
}
