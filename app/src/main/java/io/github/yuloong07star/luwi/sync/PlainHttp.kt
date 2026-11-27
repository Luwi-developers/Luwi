package io.github.yuloong07star.luwi.sync

import java.net.URI

/**
 * 明文 HTTP 只许发往本机与局域网
 *
 * 用户填的接口地址、对端地址都可能带 key 和对话内容; 写成 http:// 再填一个公网域名, 这些东西
 * 就一路明文走出去了。所以 http:// 只留给 127.x / localhost / 私有网段这几处, 其余一律要
 * https:// —— 这里只做「地址填得对不对」的判断, 拦在设置那一步, 请求发不出去。
 */
object PlainHttp {

    /** 空 = 这个地址可以明文发, 非空说明为什么不行 */
    fun problem(url: String): String? {
        if (!url.startsWith("http://")) return null // https 或不带 scheme 的, 不归这条管
        val host = hostOf(url) ?: return "网址里看不出主机名"
        return if (isLocalOrPrivate(host)) {
            null
        } else {
            "公网地址必须用 https:// (http:// 只留给本机与局域网)"
        }
    }

    private fun hostOf(url: String): String? = try {
        URI(url).host?.removePrefix("[")?.removeSuffix("]")?.lowercase()
    } catch (problem: Exception) {
        null
    }

    private fun isLocalOrPrivate(host: String): Boolean {
        if (host == "localhost" || host == "::1" || host == "0.0.0.0") return true
        if (host.startsWith("127.")) return true
        if (host.startsWith("10.")) return true
        if (host.startsWith("192.168.")) return true
        if (host.startsWith("169.254.")) return true
        // Tailscale / ZeroTier 这类 mesh VPN 的对端落在 CGNAT 100.64.0.0/10 里, 它们是"对端自己"
        // 而不是公网出口, 与 192.168 / 10 同等对待 (SyncSettingTest「对端地址只收 http」钉的就是这条)
        if (host.startsWith("100.")) {
            val second = host.split('.').getOrNull(1)?.toIntOrNull() ?: return false
            return second in 64..127
        }
        if (host.startsWith("172.")) {
            val second = host.split('.').getOrNull(1)?.toIntOrNull() ?: return false
            return second in 16..31
        }
        return false
    }
}
