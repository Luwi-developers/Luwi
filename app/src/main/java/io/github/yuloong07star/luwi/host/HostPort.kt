package io.github.yuloong07star.luwi.host

import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket

/**
 * "那个回环口上现在有没有人在听"这一问
 *
 * 抽成单独一份是为了让一个普通的 JVM 测试能盯住它 —— 这道闸 2026-10-10 加进来, 2026-10-27 才发现
 * 它**一次都没挡住过**: 原来那版拿 `InetAddress.getLoopbackAddress()` 当探针地址, 而 Android 的 libcore
 * 把 loopback 解成 **::1** (这台 vivo 上量到 `ip6-localhost/::1`), host 绑的却是 `127.0.0.1` ——
 * 换了个地址去探, 结果永远是"空着", 于是每一次起 host 都照起第二个, 死在 EADDRINUSE
 *
 * 判据是 **connect**: 对端有 listen 就算成功 (回环上的 connect 只要那边有 listen 就完成, 不要求它
 * accept, 所以那个 host 忙不忙不影响这一问), 没人 listen 立刻 refused
 */
internal object HostPort {
    /** host 绑的那个地址, 字面量, 不走 DNS —— `loopback` 这个名字在这台机器上指的是 `::1` */
    private val HOST: InetAddress = InetAddress.getByName("127.0.0.1")

    /** 回环上该立刻回来, 一秒是给"listen 着却卡住"留的余地 */
    private const val TIMEOUT_MS = 1_000

    /**
     * 这个口上现在有没有人在听
     * @param port 要探的口.
     * @return 有人 listen 就 true.
     */
    fun answersOn(port: Int): Boolean = try {
        Socket().use { socket ->
            socket.connect(InetSocketAddress(HOST, port), TIMEOUT_MS)
            true
        }
    } catch (_: IOException) {
        false
    }
}
