package io.github.yuloong07star.luwi.tool

import android.Manifest
import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import io.github.yuloong07star.luwi.MainActivity
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.overlay.OverlayService
import io.github.yuloong07star.luwi.util.Capability
import io.github.yuloong07star.luwi.util.PermissionGate
import kotlinx.serialization.json.JsonObject
import java.io.File

/**
 * 通知、震动、剪贴板、分享与下载
 *
 * 通知是**两件事**: [notify] 是模型点名要发的那一条 (`lw_notify`), [say] 是她自己开口时应用替她弹的
 * 那一条 (判据与水位在 [OutNotify]) —— 两条渠道、两个 id 空间, 谁也不顶掉谁
 *
 * 全是 app 进程里用 Context 就能做的事。共同点是**不需要特权**, 所以没有一行走 binder: 这里的
 * 东西直接执行, 结果由桥按同一套协议回给 host
 *
 * 每个函数回的是 `{"text": ...}` (见 [text]), 所以桥那一层只要 `-> LwNotify.xxx(...)` 一行
 */
internal object LwNotify {

    /**
     * 给模型看的通知走这条通道, 与 host 那条常驻的通道分开: host 那条是低重要度的背景音
     *
     * **1.0.3 把 id 换了**: 渠道的**重要度在创建之后应用就改不动了** (那是用户在管的设置), 所以
     * "让它能弹成横幅"只能靠新建一个 `IMPORTANCE_HIGH` 的渠道, 而旧的 `lw-tools` 顺手删掉 ——
     * 留着就是一个永远不高的重要度, 而模型会以为它发的通知能弹出来
     */
    private const val CHANNEL_ID = "lw-tools-high"

    /** 1.0.2 那条渠道, 只为了删掉它 */
    private const val LEGACY_CHANNEL_ID = "lw-tools"

    /** 一条工具通知的固定 id: 重复调用是更新同一条, 不是堆一屏 */
    private const val NOTIFICATION_ID = 2

    /** 她的话那条渠道: 与工具那条分开, 于是"她说了没有"和"工具通知"两个开关互不牵连 */
    private const val SPEECH_CHANNEL_ID = "lw-say"

    /** 同一场的话归一组: 系统把它们收成一摞, 不铺满一屏 */
    private const val SPEECH_GROUP = "lw-say"

    private const val TAG = "LwNotify"

    /** 震动上限: 再长就没有意义, 而且会让人以为卡住了 */
    private const val MAX_VIBRATE_MS = 3_000

    private val vibrate = Capability(
        name = "震动",
        why = "lw_vibrate 与通知自带的震动",
        permissions = listOf(Manifest.permission.VIBRATE),
    )

    /** 发一条通知, 可以顺手震一下, 也可以让它弹成横幅; 点它把已经在跑的那个界面拿到最前面, 不另开一个 */
    fun notify(context: Context, request: JsonObject): JsonObject {
        val title = request.string("title")
        val body = request.string("text")
        val vibrateMs = request.int("vibrateMs", 0).coerceIn(0, MAX_VIBRATE_MS)
        val banner = request.bool("banner", false)
        if (vibrateMs > 0) {
            PermissionGate.refusal(context, vibrate)?.let { throw IllegalStateException(it) }
        }
        val manager = context.getSystemService(NotificationManager::class.java)
            ?: unavailable("notifications", "this device has no notification manager")
        ensureChannel(context, manager, vibrateMs > 0)

        // 点通知要的是「把已经在跑的那一页拿到前面来」, 不是再开一页: MainActivity 是 standard
        // 启动模式, 一个不带 flag 的 Intent 会在同一个 task 里再压一个实例, 新的 Compose 树带着新的
        // WebView 重新 loadUrl, 屏幕上正看着的那场会话就没了。CLEAR_TOP 让系统去找栈里那一个,
        // SINGLE_TOP 让这次启动走 onNewIntent 而不是重建一次
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK
                        or Intent.FLAG_ACTIVITY_CLEAR_TOP
                        or Intent.FLAG_ACTIVITY_SINGLE_TOP,
                )
            },
            PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(IconTheme.notificationIcon(context))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setVibrate(if (vibrateMs > 0) longArrayOf(0, vibrateMs.toLong()) else null)
        if (banner) builder.setFullScreenIntent(open, true)
        try {
            manager.notify(NOTIFICATION_ID, builder.build())
        } catch (error: SecurityException) {
            // POST_NOTIFICATIONS 没给时就是这一句, 明说而不是静默
            throw IllegalStateException(
                "the notification was refused (${error.message}): grant 通知 in the app's own" +
                    " Settings -> Permissions, or run tools/lw-install.ps1 -Perms",
            )
        }
        return text(
            "posted a notification titled ${quote(title)}" +
                (if (vibrateMs > 0) " with a ${vibrateMs}ms vibration" else "") +
                "; the same id is reused by the next call, so this one is replaced rather than" +
                " stacked. " + channelLine(manager) + bannerLine(manager, banner),
        )
    }

    /**
     * 她刚说的一句, 在手机上弹一条通知 (2.8.1 落实表 #7)
     *
     * 与 [notify] 是两条通道、两个 id 空间: 工具那条是模型点名要发、换的是同一条; 这一条是她每次开口
     * 各一条 (id 由会话与 `seq` 合成, 见 [sayId]), 于是"她刚才说了两句"在通知栏里是两条
     *
     * 点它**落到那一场**: `EXTRA_OPEN_SESSION` 交给 [MainActivity], 由 `BallReturn` 送进会话界面
     * (与浮球那条通知同一个去向)。**不带 `EXTRA_OPEN_LIVE`** —— 那个记号的意思是"以点下去那一刻正在
     * 跑的那一场为准", 而这里要的恰恰是写下这一句的那一场
     *
     * @param session 那一场的 id (就是 jsonl 文件名的本体)
     * @param seq 那一行的 `seq`
     * @param at 那一行的时间 (通知上显示的就是它)
     * @param title 通知标题 (门户那张脸上那个名字)
     * @param body 通知正文 (她那句话)
     * @return 真的弹出去了没有: 没有通知许可 / 系统拒收都回 false, 调用方只记一行日志
     */
    fun say(context: Context, session: String, seq: Int, at: Long, title: String, body: String): Boolean {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        if (!manager.areNotificationsEnabled()) {
            // 主人自己把 Luwi 的通知关掉是**有意的选择**, 所以这里不抛也不补别的东西, 只留一行读数
            Log.i(TAG, "notifications are turned off, so what she said stays in the portal: $session")
            return false
        }
        ensureSpeechChannel(context, manager)
        val id = sayId(session, seq)
        val open = PendingIntent.getActivity(
            context,
            id,
            Intent(context, MainActivity::class.java).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK
                        or Intent.FLAG_ACTIVITY_CLEAR_TOP
                        or Intent.FLAG_ACTIVITY_SINGLE_TOP,
                )
                putExtra(OverlayService.EXTRA_OPEN_SESSION, session)
            },
            PendingIntent.FLAG_IMMUTABLE,
        )
        val note = NotificationCompat.Builder(context, SPEECH_CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(IconTheme.notificationIcon(context))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setWhen(at)
            // at 为 0 (老文件里没写时间的那种行) 时不显示那一刻, 否则通知上会挂一个 1970
            .setShowWhen(at > 0)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setGroup(SPEECH_GROUP)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .build()
        return try {
            manager.notify(id, note)
            true
        } catch (refused: SecurityException) {
            // POST_NOTIFICATIONS 没给时就是这一句: 这条通知发不出去, 写一行而不是静默
            Log.w(TAG, "the notification for her words was refused: ${refused.message}")
            false
        }
    }

    /**
     * 一条话的通知 id: 会话与 `seq` 合成, 落在 `0x4C57` (`LW`) 那一段
     *
     * 和宿主那条常驻 (1) 与工具通知 (2) 差得远, 于是谁都不会把别人的通知顶掉。撞了也只是更新同一条,
     * 不会说错一句
     */
    fun sayId(session: String, seq: Int): Int =
        0x4C570000 or ((session.hashCode() * 31 + seq) and 0x000FFFFF)

    /**
     * 「她的话」那条渠道
     *
     * 重要度只在创建时定得下来 (之后归用户管): 这里是 HIGH —— 她说了一句与工具通知一样该弹出来, 而
     * "别弹"的开关在系统设置里 (`设置 -> 应用 -> Luwi -> 通知 -> 她的话`)
     */
    private fun ensureSpeechChannel(context: Context, manager: NotificationManager) {
        val channel = NotificationChannel(
            SPEECH_CHANNEL_ID,
            context.getString(R.string.notification_channel_speech),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply { description = context.getString(R.string.notification_channel_speech_description) }
        manager.createNotificationChannel(channel)
    }

    /**
     * 这条渠道现在是什么重要度
     *
     * **读回来的才算数**: 渠道的重要性创建之后应用改不动, 而用户随时能在系统设置里调低它 —— 说"发了
     * 一条高重要度的通知"而实际上它被调成静默, 就是这一层最容易犯的假成功
     */
    private fun channelLine(manager: NotificationManager): String {
        val channel = manager.getNotificationChannel(CHANNEL_ID)
            ?: return "The channel this goes on no longer exists, so nothing will show: the system" +
                " kept a channel of that id that this app cannot see"
        val name = when (channel.importance) {
            NotificationManager.IMPORTANCE_HIGH, NotificationManager.IMPORTANCE_MAX -> "high"
            NotificationManager.IMPORTANCE_DEFAULT -> "default"
            NotificationManager.IMPORTANCE_LOW -> "low (silent, no banner)"
            NotificationManager.IMPORTANCE_MIN -> "min (silent)"
            NotificationManager.IMPORTANCE_NONE -> "none (blocked by the user)"
            else -> "unknown"
        }
        return "Its channel ($CHANNEL_ID) is set to $name importance" +
            (if (channel.importance < NotificationManager.IMPORTANCE_HIGH) {
                ", and only the user can raise that: 设置 -> 应用 -> Luwi -> 通知 -> 工具通知"
            } else {
                ""
            }) + "."
    }

    /**
     * 横幅那件事到底成不成
     *
     * Android 14 起 `USE_FULL_SCREEN_INTENT` 对非闹钟/通话类的应用**默认不给**, 而声明了也不一定给 ——
     * 系统自己有一个开关 (`canUseFullScreenIntent`), 那才是判据
     */
    private fun bannerLine(manager: NotificationManager, asked: Boolean): String {
        val allowed = try {
            manager.canUseFullScreenIntent()
        } catch (error: Throwable) {
            null
        }
        return when {
            !asked -> " It was posted as an ordinary notification: pass banner to have it come up" +
                " over the lock screen."
            allowed == true -> " It was also given a full-screen intent, so it comes up as a" +
                " banner over whatever is on the screen."
            allowed == false -> " The banner was asked for but this app may not use full-screen" +
                " intents: since Android 14 that is a switch of its own (设置 -> 应用 -> Luwi ->" +
                " 特殊应用权限 -> 全屏通知), so what was posted is an ordinary high-importance" +
                " notification until someone turns it on."
            else -> " Whether this device lets the app use a full-screen intent cannot be asked" +
                " here, so the banner may or may not appear."
        }
    }

    /** 通知通道只在要震动时开震动, 别的不动 (用户的通道设置不该被反复洗掉) */
    private fun ensureChannel(context: Context, manager: NotificationManager, wantsVibration: Boolean) {
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_tools),
            // 高重要度: 这是"能弹成横幅"的前提, 而它**只在创建时定得下来** —— 渠道的重要性从此归用户管
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = context.getString(R.string.notification_channel_tools_description)
            if (wantsVibration) enableVibration(true)
        }
        manager.createNotificationChannel(channel)
        // 旧的 `lw-tools` 删掉: 留着它只会有第二个永远不高的重要度, 而模型发的通知会落在新的这条上
        manager.deleteNotificationChannel(LEGACY_CHANNEL_ID)
    }

    /** 震一下 */
    fun vibrate(context: Context, request: JsonObject): JsonObject {
        PermissionGate.refusal(context, vibrate)?.let { throw IllegalStateException(it) }
        val ms = request.int("ms", 200).coerceIn(1, MAX_VIBRATE_MS)
        val device = context.getSystemService(VibratorManager::class.java)?.defaultVibrator
            ?: context.getSystemService(Vibrator::class.java)
            ?: unavailable("vibration", "this device has no vibrator service")
        if (!device.hasVibrator()) unavailable("vibration", "this device has no vibrator")
        device.vibrate(VibrationEffect.createOneShot(ms.toLong(), 128))
        return text("vibrated for ${ms}ms")
    }

    /** 剪贴板: 写随时都行, 读要应用在前台 (Android 10 起只有获得焦点的应用能读) */
    fun clipboard(context: Context, request: JsonObject): JsonObject {
        val manager = context.getSystemService(ClipboardManager::class.java)
            ?: unavailable("the clipboard", "this device has no clipboard service")
        return when (val op = request.string("op")) {
            "get" -> {
                val clip = manager.primaryClip
                val value = if (clip == null || clip.itemCount == 0) {
                    ""
                } else {
                    clip.getItemAt(0).coerceToText(context).toString()
                }
                if (value.isEmpty()) {
                    throw IllegalStateException(
                        "the clipboard is empty, or this app is not the foreground app: since" +
                            " Android 10 only the focused app may read it. Bring Luwi to the" +
                            " front and call this again, or hand text out with lw_share instead",
                    )
                }
                text(value)
            }

            "set" -> {
                val value = request.string("text")
                manager.setPrimaryClip(ClipData.newPlainText("Luwi", value))
                text("wrote ${value.length} characters to the clipboard")
            }

            else -> throw IllegalArgumentException("op has to be get or set, not \"$op\"")
        }
    }

    /**
     * 把文本或文件交给别的应用
     *
     * 文件走 FileProvider: Android 10 起 `file://` 一律被拒, 而对方要的是读一份内容, 不是一条路径
     */
    fun share(context: Context, request: JsonObject): JsonObject {
        val body = request.stringOrNull("text")
        val path = request.stringOrNull("path")
        if (body == null && path == null) {
            throw IllegalArgumentException("this call has to name text or path, or both")
        }
        val send = if (path != null) {
            val (uri, guessed) = fileUri(context, path)
            Intent(Intent.ACTION_SEND).apply {
                type = request.stringOrNull("mime") ?: guessed
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                body?.let { putExtra(Intent.EXTRA_TEXT, it) }
            }
        } else {
            Intent(Intent.ACTION_SEND).apply {
                type = request.stringOrNull("mime") ?: "text/plain"
                putExtra(Intent.EXTRA_TEXT, body)
            }
        }
        val chooser = Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(chooser)
        } catch (error: Throwable) {
            unavailable("sharing", "no app on this device takes ${send.type}: ${error.message}")
        }
        return text(
            "handed ${if (path != null) quote(path) else "${body?.length ?: 0} characters"} to the" +
                " system chooser as ${send.type}; which app takes it is the user's pick, so this" +
                " only says the chooser opened",
        )
    }

    /** 用别的应用打开一个文件 */
    fun openFile(context: Context, request: JsonObject): JsonObject {
        val (uri, guessed) = fileUri(context, request.string("path"))
        val type = request.stringOrNull("mime") ?: guessed
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, type)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
        } catch (error: Throwable) {
            unavailable("opening that file", "no app on this device takes $type: ${error.message}")
        }
        return text("opened $uri as $type; which app took it is the device's own default")
    }

    /** 下载一个 URL 到公共的下载目录 (工作是工作区的事, 下载是把东西交到手机上) */
    fun download(context: Context, request: JsonObject): JsonObject {
        val url = request.string("url")
        val manager = context.getSystemService(DownloadManager::class.java)
            ?: unavailable("downloads", "this device has no download manager")
        val name = request.stringOrNull("to")
            ?: url.substringAfterLast('/').substringBefore('?').takeIf { it.isNotBlank() }
            ?: "download"
        val id = try {
            manager.enqueue(
                DownloadManager.Request(Uri.parse(url))
                    .setTitle(name)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                    .setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED,
                    ),
            )
        } catch (error: Throwable) {
            throw IllegalStateException("the download was refused: ${error.message}")
        }
        return text(
            "queued download $id: $url -> Downloads/$name in shared storage. The system downloads" +
                " it on its own schedule, so this says it was queued rather than that it finished",
        )
    }

    /** 一个路径变成对方能读的 uri, 顺带猜一个 mime (与网页里那颗按钮同一份实现) */
    private fun fileUri(context: Context, path: String): Pair<Uri, String> {
        val file = File(path)
        if (!file.isFile) throw IllegalArgumentException("there is no file at $path")
        return OpenFile.uriAndType(context, file)
    }
}

/** 一段文字加个引号, 只说用到的地方 */
internal fun quote(value: String): String = "\"" + value.replace("\n", "\\n") + "\""
