package io.github.yuloong07star.luwi.channel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 这一版手机直连动作的声明表
 *
 * `12-4` 要的就是这一份: 每个 action 的 via / permission / 失败原因都写出来, 一个都不许空. 表里现在
 * 有 10 条, 所以这里也把 10 钉住 —— 少一条会静默少一个能力, 多一条则报告里的数要跟着改
 */
internal class DeviceActionRegistryTest {

    @Test
    fun `首批 10 个 action 都在表里, 名字不重复`() {
        assertEquals(EXPECTED_ACTIONS, DeviceActionRegistry.actions.size)
        assertEquals(
            DeviceActionRegistry.actions.size,
            DeviceActionRegistry.actions.map { it.name }.toSet().size,
        )
        assertEquals(DeviceActionRegistry.actions.map { it.name }, DeviceActionRegistry.names)
        assertNotNull(DeviceActionRegistry.find("open_app"))
        assertNotNull(DeviceActionRegistry.find("ui_tap"))
        assertNull(DeviceActionRegistry.find("no_such_action"))
    }

    /**
     * 12-4 本体: 逐 action 看 via / permission / 失败原因三格
     *
     * 三格任何一格空着, 这一条就直接说清是哪条动作的哪一格
     */
    @Test
    fun `逐 action 断言 via permission 失败原因三字段非空`() {
        val actions = DeviceActionRegistry.actions
        val checked = mutableListOf<String>()
        actions.forEach { action ->
            assertTrue("${action.name}: via is blank", action.via.isNotBlank())
            assertTrue("${action.name}: permission is blank", action.permission.isNotBlank())
            assertTrue("${action.name}: failure reason is blank", action.failureReason.isNotBlank())
            checked += action.name
        }
        assertEquals(EXPECTED_ACTIONS, checked.size)
        assertEquals(actions.map { it.name }, checked)
    }

    @Test
    fun `每一条通道都出自词表, 首选在前, unsupported 只当终点`() {
        DeviceActionRegistry.actions.forEach { action ->
            assertTrue("${action.name}: via ${action.via}", DeviceRoute.isKnown(action.via))
            action.fallbacks.forEach { fallback ->
                assertTrue("${action.name}: fallback $fallback", DeviceRoute.isKnown(fallback))
            }
            assertEquals("${action.name}: via is not first", action.via, action.routes.first())
            assertEquals("${action.name}: routes have duplicates", action.routes.size, action.routes.toSet().size)
            val unsupportedAt = action.routes.indexOf(DeviceRoute.UNSUPPORTED)
            assertTrue(
                "${action.name}: unsupported has to be the last route",
                unsupportedAt == -1 || unsupportedAt == action.routes.lastIndex,
            )
        }
    }

    @Test
    fun `每一条动作都声明了 risk 与 permission`() {
        // B3-b ④: 声明不参与路由, 但少了它 "这条动作要什么权限 / 最多能造成多大影响" 就没有答案
        val expected = mapOf(
            "open_app" to DeviceRisk.LOW,
            "open_url" to DeviceRisk.LOW,
            "quick_app" to DeviceRisk.LOW,
            "calendar" to DeviceRisk.NONE,
            "notifications" to DeviceRisk.MEDIUM,
            "alarm" to DeviceRisk.LOW,
            "dial" to DeviceRisk.LOW,
            "app_settings" to DeviceRisk.LOW,
            "media" to DeviceRisk.MEDIUM,
            "ui_tap" to DeviceRisk.HIGH,
        )
        DeviceActionRegistry.actions.forEach { action ->
            assertEquals("${action.name}: risk", expected[action.name], action.risk)
            assertTrue("${action.name}: permission is blank", action.permission.isNotBlank())
        }
        assertEquals(expected.size, DeviceActionRegistry.actions.size)
    }

    @Test
    fun `只对某块屏有意义的动作都留了虚拟屏那一条`() {
        DeviceActionRegistry.actions.filter { it.screenScoped }.forEach { action ->
            assertTrue(
                "${action.name}: a screen-scoped action needs the virtual screen route",
                DeviceRoute.VIRTUAL_SCREEN in action.routes,
            )
        }
    }

    @Test
    fun `不要权限的动作写 none, 要权限的动作写出名字`() {
        val permissioned = DeviceActionRegistry.actions
            .filter { it.permission != DeviceAction.NO_PERMISSION }
            .map { it.name }
        // alarm 也在这一列里: 系统要的是 com.android.alarm.permission.SET_ALARM. 声明成 none 时真机上
        // 那句话被拒成 "Permission Denial ... requires com.android.alarm.permission.SET_ALARM"
        // (2026-11-03 真机 OJZD5D6TMNSKFYHM 读数), 所以它有权限, 只是这条权限安装时就自动给了
        assertEquals(listOf("calendar", "notifications", "alarm", "media", "ui_tap"), permissioned)
        assertEquals(DeviceAction.NO_PERMISSION, DeviceActionRegistry.require("open_app").permission)
        assertEquals(
            "android.permission.READ_CALENDAR",
            DeviceActionRegistry.require("calendar").permission,
        )
        assertEquals(
            "com.android.alarm.permission.SET_ALARM",
            DeviceActionRegistry.require("alarm").permission,
        )
    }

    private companion object {
        /** 12 文档首批能力的条数 */
        const val EXPECTED_ACTIONS = 10
    }
}
