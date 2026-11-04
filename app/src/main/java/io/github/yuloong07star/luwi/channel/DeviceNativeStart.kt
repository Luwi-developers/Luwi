package io.github.yuloong07star.luwi.channel

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log

/**
 * 手机自己的屏上, 起一个 activity 由应用进程直接做
 *
 * 这是 B3-b 的原生那一半: PackageManager 问出 launcher activity, 再由 Context 起它. 它不借特权
 * 通道, 也不建屏 —— `am` 与本应用的 uid 无缘 (它自称 shell 的包名, 平台直接拒), 而"打开设置 / 打开
 * 链接"根本不需要走到那边去
 *
 * 只有虚拟屏才必须交给特权 `am`: 应用进程没有把 activity 放到别的 display 上的能力. 这条边界在
 * [DeviceActionBroker.launchRoute] / [DeviceActionBroker.intentRoute] 回答, 这里只管主屏这一段
 *
 * 失败一律变成 [Outcome.reason] 而不是抛出: 一次 launch 失败是一句要给模型看的话, 不是一个把整条桥
 * 请求打回去的异常
 */
internal object DeviceNativeStart {

    /**
     * 做没做到
     *
     * @property packageName 实际要对准的包, 组件那条从组件里取
     * @property component 实际起的组件, 按名字起的应用在这一步才定下是哪个 activity
     * @property reason 没做到时的原因; 做到了就是空
     */
    data class Outcome(
        val started: Boolean,
        val packageName: String,
        val component: String,
        val reason: String = "",
    )

    /**
     * 起一个应用的 launcher activity
     *
     * @param packageName 包名; 调用方已经把"设置"这样的名字换成了包名
     * @param component 给了就按这个组件起 (package/class), 否则问 PackageManager 要 launcher activity
     */
    fun launch(context: Context, packageName: String, component: String): Outcome {
        val target = if (component.isNotBlank()) {
            ComponentName.unflattenFromString(component)
                ?: return Outcome(
                    started = false,
                    packageName = packageName,
                    component = component,
                    reason = "\"$component\" is not a component; it has to read package/class",
                )
        } else {
            launcherOf(context, packageName)
                ?: return Outcome(
                    started = false,
                    packageName = packageName,
                    component = "",
                    reason = "no launcher activity for $packageName: the package is not installed," +
                        " or nothing on this device starts it from the home screen",
                )
        }
        // **显式组件**: 隐式 launcher intent 要 MATCH_DEFAULT_ONLY 才匹配得上, 而 Flutter / Unity
        // 一类模板声明了 MAIN + LAUNCHER 却没写 DEFAULT, `am` 会答 "unable to resolve Intent" ——
        // 问出组件再显式起它, 与桌面上按图标是同一件事
        val intent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
            this.component = target
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return start(context, intent, target.packageName, target.flattenToShortString())
    }

    /** 打开一个链接: 与 `ACTION_VIEW` 同一个 intent, 交给设备自己挑浏览器 */
    fun openUrl(context: Context, url: String): Outcome {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return start(context, intent, "", "")
    }

    /**
     * 发一个 intent: 动作 / 数据 / 组件三样至少要有一样
     *
     * 与 `am start -a ... -d ... -n ...` 是同一个 intent, 区别只在这一个由应用进程发出去, 落在手机
     * 自己的屏上, 不经过特权通道
     */
    fun send(context: Context, action: String, data: String, component: String): Outcome {
        val target = if (component.isNotBlank()) {
            ComponentName.unflattenFromString(component)
                ?: return Outcome(
                    started = false,
                    packageName = "",
                    component = component,
                    reason = "\"$component\" is not a component; it has to read package/class",
                )
        } else {
            null
        }
        val intent = Intent().apply {
            if (action.isNotBlank()) this.action = action
            if (data.isNotBlank()) this.data = Uri.parse(data)
            if (target != null) this.component = target
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return start(
            context = context,
            intent = intent,
            packageName = target?.packageName.orEmpty(),
            component = target?.flattenToShortString().orEmpty(),
        )
    }

    /**
     * 这个包能从桌面起哪个 activity
     *
     * 用 `queryIntentActivities` 而不是 `getLaunchIntentForPackage`, 因为后者带 MATCH_DEFAULT_ONLY,
     * 会把没写 DEFAULT 的 launcher activity 判成"没有"; 这里问的与桌面问的是同一句
     */
    private fun launcherOf(context: Context, packageName: String): ComponentName? {
        val manager = context.packageManager
        val launcher = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setPackage(packageName)
        val found = try {
            manager.queryIntentActivities(launcher, 0)
        } catch (problem: Throwable) {
            Log.w(TAG, "could not ask the package manager for $packageName's launcher activity", problem)
            return null
        }
        val activity = found.firstOrNull { it.activityInfo != null }?.activityInfo ?: return null
        return ComponentName(activity.packageName, activity.name)
    }

    /** 真的发出去: 平台拒绝时把它的原话留下来 */
    private fun start(
        context: Context,
        intent: Intent,
        packageName: String,
        component: String,
    ): Outcome = try {
        context.startActivity(intent)
        Outcome(started = true, packageName = packageName, component = component)
    } catch (problem: Throwable) {
        Log.w(TAG, "the package manager refused ${intent.action ?: "the intent"}", problem)
        Outcome(
            started = false,
            packageName = packageName,
            component = component,
            reason = "the package manager refused it: " +
                (problem.message ?: problem.javaClass.simpleName),
        )
    }

    private const val TAG = "LwNativeStart"
}
