/*
 * 自检: 把「这台机器现在到底哪一层不对」摊成一张表。
 *
 * 原则 (主人 2026-11-08 定的):
 * - **只读本机**: 每一项都是读现状, 不发一个字节; 报告先落在剪贴板里, 由人决定去不去。
 * - **不碰隐私**: 只念机型/系统/版本/各层状态; 不读 API key, 不读屏幕内容, 不读会话与记忆。
 * - **能自己解释**: 每一项都给出「看到了什么」, 而不是只给一个红叉 —— 用户把它贴给别人时,
 *   对方要能不追问地看懂。
 *
 * 这张表分两层:
 * - [Doctor.collect] 走 Context 取现状 (真机才跑得动);
 * - [DoctorReport.toText] 是纯函数, 只把已有的检查项排成文字, 于是能在 JVM 单测里钉住格式。
 */
package io.github.yuloong07star.luwi.doctor

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.StatFs
import io.github.yuloong07star.luwi.channel.AccessibilitySetting
import io.github.yuloong07star.luwi.channel.ChannelSetting
import io.github.yuloong07star.luwi.channel.VirtualScreen
import io.github.yuloong07star.luwi.update.UpdateCheck
import java.io.File

/** 一项检查的结论: 越往下越严重 */
internal enum class DoctorStatus {
    OK,
    WARN,
    FAIL,
    ;

    /** 排序用 (FAIL 最重) */
    val rank: Int get() = ordinal
}

/** 一项检查: 一行的名字 + 结论 + 一句人话 */
internal data class DoctorCheck(
    val id: String,
    val status: DoctorStatus,
    val detail: String,
)

/** 整张表 */
internal data class DoctorReport(val checks: List<DoctorCheck>) {

    val worst: DoctorStatus
        get() = checks.maxByOrNull { it.status.rank }?.status ?: DoctorStatus.OK

    /** 有没有需要上报的事 (有 WARN 也算: 用户可能就卡在那一层) */
    val needsAttention: Boolean get() = worst != DoctorStatus.OK

    /**
     * 排成人能读的文字 —— 纯函数, 不碰 Context
     *
     * 头两行是「谁在什么设备上」, 下面一行一项; 行首的方括号是给眼睛快速扫用的, 不是给机器解析用的。
     */
    fun toText(app: String, device: String): String = buildString {
        appendLine(HEADER)
        appendLine("应用: $app")
        appendLine("设备: $device")
        checks.forEach { check ->
            appendLine("[${check.status.name}] ${check.id}: ${check.detail}")
        }
    }.trimEnd()

    companion object {
        const val HEADER: String = "Luwi 自检报告（本机生成，未上传）"
    }
}

/** 取现状, 每一项都兜住异常 —— 自检自己不能把 App 弄崩 */
internal object Doctor {

    /** 主机的入口文件: HostInstaller 就是靠它在判定「树解开了没有」 */
    private const val HOST_ENTRY = "node_modules/@deepseek-ai/dsh/lib/bin.js"
    private const val HOST_STAMP = "host-version.txt"

    fun collect(context: Context): DoctorReport = DoctorReport(
        listOf(
            app(context),
            device(),
            host(context),
            node(context),
            channel(),
            accessibility(),
            screen(),
            storage(context),
        ),
    )

    // ---- 各项 ----

    private fun app(context: Context): DoctorCheck = runCatching {
        val version = UpdateCheck.localVersionOf(context)
        val code = UpdateCheck.localCodeOf(context)
        val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (debuggable) {
            DoctorCheck(
                id = "应用",
                status = DoctorStatus.WARN,
                detail = "$version ($code) · 调试构建: 同一台电脑上的 adb 能读本机私有数据",
            )
        } else {
            DoctorCheck(id = "应用", status = DoctorStatus.OK, detail = "$version ($code)")
        }
    }.getOrElse { DoctorCheck("应用", DoctorStatus.WARN, "读不到版本: ${it.short()}") }

    private fun device(): DoctorCheck = runCatching {
        val abi = Build.SUPPORTED_ABIS.firstOrNull().orEmpty()
        DoctorCheck(
            id = "设备",
            status = DoctorStatus.OK,
            detail = "${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE}) · " +
                "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT}) · $abi",
        )
    }.getOrElse { DoctorCheck("设备", DoctorStatus.WARN, "读不到机型: ${it.short()}") }

    /** 宿主那一份树: 有没有解包、解的是哪一版 */
    private fun host(context: Context): DoctorCheck = runCatching {
        val root = File(context.filesDir, "host")
        val stamp = File(root, HOST_STAMP)
        if (!stamp.isFile) {
            return DoctorCheck(
                id = "宿主程序",
                status = DoctorStatus.FAIL,
                detail = "没有 $HOST_STAMP: 宿主的文件还没解开",
            )
        }
        val lines = runCatching { stamp.readLines() }.getOrDefault(emptyList())
        // 解开之后落的那一份只有版本号一行 (HostInstaller.kt:76 写的是 `expected.version + "\n"`);
        // APK 里那份是 `version=` / `entries=` 两行。两种都认, 免得换个写法就显示成空
        val version = lines.firstOrNull { it.isNotBlank() }
            ?.removePrefix("version=")
            ?.trim()
            .orEmpty()
        val entry = File(root, HOST_ENTRY)
        when {
            version.isBlank() -> DoctorCheck(
                id = "宿主程序",
                status = DoctorStatus.WARN,
                detail = "$HOST_STAMP 是空的: 解包那一步没有写完",
            )
            !entry.isFile -> DoctorCheck(
                id = "宿主程序",
                status = DoctorStatus.FAIL,
                detail = "解开了但缺入口 $HOST_ENTRY (version=$version)",
            )
            else -> DoctorCheck(
                id = "宿主程序",
                status = DoctorStatus.OK,
                detail = "version=$version 入口在",
            )
        }
    }.getOrElse { DoctorCheck("宿主程序", DoctorStatus.FAIL, "读不到宿主目录: ${it.short()}") }

    /** Node 的解释器: 它不在包里就得重新拼包 */
    private fun node(context: Context): DoctorCheck = runCatching {
        val so = File(context.applicationInfo.nativeLibraryDir, "libnode.so")
        if (so.isFile) {
            DoctorCheck("Node", DoctorStatus.OK, "libnode.so ${so.length() / 1024 / 1024} MB")
        } else {
            DoctorCheck("Node", DoctorStatus.FAIL, "缺 libnode.so: 这个包跑不起宿主")
        }
    }.getOrElse { DoctorCheck("Node", DoctorStatus.FAIL, "读不到 lib 目录: ${it.short()}") }

    private fun channel(): DoctorCheck = runCatching {
        val state = ChannelSetting.state
            ?: return DoctorCheck("特权通道", DoctorStatus.WARN, "状态还没读到（打开设置页或重建一次会自动读）")
        if (state.connected) {
            DoctorCheck(
                id = "特权通道",
                status = DoctorStatus.OK,
                detail = "已连 ${state.backend} · uid=${state.uid} · ${state.version}",
            )
        } else {
            DoctorCheck(
                id = "特权通道",
                status = DoctorStatus.FAIL,
                detail = "没连上" + state.error?.takeIf { it.isNotBlank() }?.let { "：$it" }.orEmpty(),
            )
        }
    }.getOrElse { DoctorCheck("特权通道", DoctorStatus.WARN, "读不到通道状态: ${it.short()}") }

    private fun accessibility(): DoctorCheck = runCatching {
        val state = AccessibilitySetting.state
            ?: return DoctorCheck("无障碍", DoctorStatus.WARN, "状态还没读到（打开设置页会自动读）")
        when {
            state.healthy -> DoctorCheck("无障碍", DoctorStatus.OK, "服务在跑，按名字点、读控件树都可用")
            !state.componentListed && !state.running -> DoctorCheck(
                id = "无障碍",
                status = DoctorStatus.FAIL,
                detail = "服务没挂上：系统的无障碍列表里没有 Luwi",
            )
            else -> DoctorCheck(
                id = "无障碍",
                status = DoctorStatus.FAIL,
                detail = "已登记但没在跑（componentListed=${state.componentListed} running=${state.running}）",
            )
        }
    }.getOrElse { DoctorCheck("无障碍", DoctorStatus.WARN, "读不到无障碍状态: ${it.short()}") }

    private fun screen(): DoctorCheck = runCatching {
        val screens = VirtualScreen.screens
        if (screens.isEmpty()) {
            DoctorCheck("虚拟屏", DoctorStatus.WARN, "还没建（建一块之后后台才看得见画面）")
        } else {
            val first = screens.first()
            DoctorCheck(
                id = "虚拟屏",
                status = DoctorStatus.OK,
                detail = "${screens.size} 块 · 第一块 displayId=${first.displayId} ${first.width}x${first.height}@${first.dpi}",
            )
        }
    }.getOrElse { DoctorCheck("虚拟屏", DoctorStatus.WARN, "读不到虚拟屏: ${it.short()}") }

    private fun storage(context: Context): DoctorCheck = runCatching {
        val stat = StatFs(context.filesDir.path)
        val freeMb = stat.availableBytes / 1024 / 1024
        val status = when {
            freeMb < 200 -> DoctorStatus.FAIL
            freeMb < 1024 -> DoctorStatus.WARN
            else -> DoctorStatus.OK
        }
        DoctorCheck("存储", status, "本应用目录还剩 ${freeMb} MB（解包与日志都要写这里）")
    }.getOrElse { DoctorCheck("存储", DoctorStatus.WARN, "读不到剩余空间: ${it.short()}") }

    /** 报错只说一句, 不把整条栈塞进对话框 */
    private fun Throwable.short(): String =
        (message ?: javaClass.simpleName).take(120)
}
