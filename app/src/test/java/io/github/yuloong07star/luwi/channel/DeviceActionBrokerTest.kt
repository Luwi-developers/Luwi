package io.github.yuloong07star.luwi.channel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 直连路由 [DeviceActionBroker]
 *
 * 这一份钉的是两条以后最容易走歪的边界: 手机自己的屏上**不为直连动作新建虚拟屏** (12-1), 虚拟屏上
 * 只有特权 `am` 落得下去; 与屏无关的动作 (日历 / 闹钟 / 快应用) 不管 displayId 是多少都不改道
 */
internal class DeviceActionBrokerTest {

    private val broker = DeviceActionBroker()

    @Test
    fun `手机自己的屏上没有一条动作会落到虚拟屏`() {
        DeviceActionRegistry.actions.forEach { action ->
            assertTrue(
                "${action.name}: display 0 must not create a virtual screen",
                DeviceRoute.VIRTUAL_SCREEN !in broker.routes(action.name, 0),
            )
        }
    }

    @Test
    fun `主屏上打开 App 与 URL 只走应用进程里的那条路`() {
        assertEquals(listOf(DeviceRoute.NATIVE), broker.routes("open_app", 0))
        assertEquals(listOf(DeviceRoute.INTENT), broker.routes("open_url", 0))
        assertEquals(listOf(DeviceRoute.ACCESSIBILITY), broker.routes("ui_tap", 0))
    }

    @Test
    fun `虚拟屏上只留特权 am 那一条`() {
        assertEquals(listOf(DeviceRoute.VIRTUAL_SCREEN), broker.routes("open_app", 7))
        assertEquals(listOf(DeviceRoute.VIRTUAL_SCREEN), broker.routes("open_url", 7))
        assertEquals(listOf(DeviceRoute.VIRTUAL_SCREEN), broker.routes("ui_tap", 7))
    }

    @Test
    fun `与屏无关的动作不因 displayId 改道`() {
        assertEquals(listOf(DeviceRoute.NATIVE), broker.routes("calendar", 0))
        assertEquals(listOf(DeviceRoute.NATIVE), broker.routes("calendar", 7))
        assertEquals(listOf(DeviceRoute.NATIVE), broker.routes("notifications", 7))
        assertEquals(listOf(DeviceRoute.NATIVE), broker.routes("media", 7))
        assertEquals(listOf(DeviceRoute.INTENT), broker.routes("alarm", 0))
        assertEquals(listOf(DeviceRoute.INTENT), broker.routes("alarm", 7))
        assertEquals(listOf(DeviceRoute.INTENT), broker.routes("dial", 7))
        assertEquals(listOf(DeviceRoute.INTENT), broker.routes("app_settings", 7))
    }

    @Test
    fun `快应用只走 deep link, 失败也不建屏`() {
        assertEquals(listOf(DeviceRoute.DEEP_LINK), broker.routes("quick_app", 0))
        assertEquals(listOf(DeviceRoute.DEEP_LINK), broker.routes("quick_app", 7))
        assertTrue(broker.failure("quick_app").isNotBlank())
        assertTrue(DeviceRoute.VIRTUAL_SCREEN !in broker.routes("quick_app", 0))
        assertTrue(DeviceRoute.VIRTUAL_SCREEN !in broker.routes("quick_app", 7))
    }

    @Test
    fun `unsupported 是回答不是通道`() {
        DeviceActionRegistry.actions.forEach { action ->
            assertTrue(
                "${action.name}: unsupported must never be returned as a route",
                DeviceRoute.UNSUPPORTED !in broker.routes(action.name, 0),
            )
            assertTrue(
                "${action.name}: unsupported must never be returned as a route",
                DeviceRoute.UNSUPPORTED !in broker.routes(action.name, 7),
            )
        }
    }

    @Test
    fun `不认识的动作给空通道与一句失败原因`() {
        assertNull(broker.find("no_such_action"))
        assertTrue(broker.routes("no_such_action", 0).isEmpty())
        assertTrue(broker.routes("no_such_action", 7).isEmpty())
        assertTrue(broker.failure("no_such_action").isNotBlank())
    }
}
