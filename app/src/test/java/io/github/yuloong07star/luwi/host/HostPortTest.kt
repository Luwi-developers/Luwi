package io.github.yuloong07star.luwi.host

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket

/**
 * 探口那一问的判据 ([HostPort])
 *
 * 为什么值得单测: 2026-10-27 之前那一版拿 `InetAddress.getLoopbackAddress()` 当地址 —— 在设备上它
 * 指的是 `::1`, 而 host 绑 `127.0.0.1`, 于是那一问永远答"空着"。JVM 上那个名字多数时候就是
 * `127.0.0.1`, 所以这两条**守不住那一版本身**, 守的是"探的是 127.0.0.1 这个地址、判据是 connect"
 * 这两件事, 别让人再改回按名字取地址
 */
class HostPortTest {

    @Test
    fun `a listener on the loopback port is seen`() {
        ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { listening ->
            assertTrue(HostPort.answersOn(listening.localPort))
        }
    }

    @Test
    fun `a port nobody listens on reads free`() {
        val free = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }
        assertFalse(HostPort.answersOn(free))
    }
}
