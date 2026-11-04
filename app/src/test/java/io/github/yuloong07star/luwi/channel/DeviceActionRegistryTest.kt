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
        assertEquals(listOf("calendar", "notifications", "media", "ui_tap"), permissioned)
        assertEquals(DeviceAction.NO_PERMISSION, DeviceActionRegistry.require("open_app").permission)
        assertEquals(
            "android.permission.READ_CALENDAR",
            DeviceActionRegistry.require("calendar").permission,
        )
    }

    private companion object {
        /** 12 文档首批能力的条数 */
        const val EXPECTED_ACTIONS = 10
    }
}
