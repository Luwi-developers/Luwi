package io.github.yuloong07star.luwi.link

import android.content.Context
import android.content.pm.PackageManager
import android.os.StatFs
import io.github.yuloong07star.luwi.channel.ChannelSetting
import io.github.yuloong07star.luwi.channel.LwAccessibility
import io.github.yuloong07star.luwi.channel.VirtualScreen
import java.io.File

/**
 * `state.read` 的答案
 *
 * 只报**读一眼就有**的东西: 版本、宿主 stamp、node 库在不在、通道 / 无障碍 / 虚拟屏的现成状态、
 * 还剩多少存储。不现起子进程、不截图、不打开任何东西 —— 一条 IPC 该有的代价
 *
 * 每个字段都允许是 null, 而且 null 是有意义的: 它表示"这一版读不到", 不表示"没有"。调用方
 * 不该把 null 当 false
 */
internal data class LinkSnapshot(
    val appVersion: String,
    val appCode: Long,
    val hostStamp: String?,
    val nodeMb: Long?,
    val channelConnected: Boolean?,
    val channelBackend: String?,
    val accessibilityRunning: Boolean,
    val screenCount: Int,
    val screenDisplayId: Int?,
    val screenWidth: Int?,
    val screenHeight: Int?,
    val screenDpi: Int?,
    val storageFreeMb: Long,
) {

    /** 手写 JSON: 这一层没有别的序列化依赖, 字段又全是标量 */
    fun toJson(): String = buildString {
        append('{')
        append("\"app\":\"").append(appVersion).append("\",")
        append("\"code\":").append(appCode).append(',')
        append("\"host\":").append(hostStamp.quoted()).append(',')
        append("\"nodeMb\":").append(nodeMb ?: "null").append(',')
        append("\"channel\":{\"connected\":").append(channelConnected ?: "null")
        append(",\"backend\":").append(channelBackend.quoted()).append("},")
        append("\"accessibility\":").append(accessibilityRunning).append(',')
        append("\"screens\":{\"count\":").append(screenCount)
        append(",\"displayId\":").append(screenDisplayId ?: "null")
        append(",\"width\":").append(screenWidth ?: "null")
        append(",\"height\":").append(screenHeight ?: "null")
        append(",\"dpi\":").append(screenDpi ?: "null").append("},")
        append("\"storageFreeMb\":").append(storageFreeMb)
        append('}')
    }

    private fun String?.quoted(): String = if (this == null) "null" else "\"$this\""

    companion object {

        /**
         * 读一眼
         *
         * 每一步都 runCatching: 一项读不到就留 null, 不能让一条 IPC 因为某个系统调用抽风整条失败
         */
        fun read(context: Context): LinkSnapshot {
            val info = runCatching {
                context.packageManager.getPackageInfo(context.packageName, 0)
            }.getOrNull()
            val version = info?.versionName ?: "?"
            val code = info?.let {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                    it.longVersionCode
                } else {
                    @Suppress("DEPRECATION")
                    it.versionCode.toLong()
                }
            } ?: 0L

            val hostStamp = runCatching {
                val file = File(File(context.filesDir, "dsh-home"), "host/host-version.txt")
                if (!file.exists()) return@runCatching null
                file.readLines().firstOrNull { it.isNotBlank() }?.trim()
            }.getOrNull()

            val nodeMb = runCatching {
                val file = File(context.applicationInfo.nativeLibraryDir, "libnode.so")
                if (!file.exists()) return@runCatching null
                file.length() / (1024L * 1024L)
            }.getOrNull()

            val channel = runCatching { ChannelSetting.state }.getOrNull()

            val screens = runCatching { VirtualScreen.screens }.getOrNull()
            val first = screens?.firstOrNull()

            val freeMb = runCatching {
                val stat = StatFs(context.filesDir.absolutePath)
                stat.availableBytes / (1024L * 1024L)
            }.getOrDefault(0L)

            return LinkSnapshot(
                appVersion = version,
                appCode = code,
                hostStamp = hostStamp,
                nodeMb = nodeMb,
                channelConnected = channel?.connected,
                channelBackend = channel?.backend,
                accessibilityRunning = runCatching { LwAccessibility.running }.getOrDefault(false),
                screenCount = screens?.size ?: 0,
                screenDisplayId = first?.displayId,
                screenWidth = first?.width,
                screenHeight = first?.height,
                screenDpi = first?.dpi,
                storageFreeMb = freeMb,
            )
        }
    }
}

/** 同签名判定, 走系统那条唯一权威的接口 */
internal object LinkSignature {

    /**
     * @param callerUid 系统给的调用 uid, 不从参数里读
     * @return 与自家签名一致
     */
    fun sameAsSelf(context: Context, callerUid: Int): Boolean = runCatching {
        context.packageManager.checkSignatures(callerUid, android.os.Process.myUid()) ==
            PackageManager.SIGNATURE_MATCH
    }.getOrDefault(false)
}
