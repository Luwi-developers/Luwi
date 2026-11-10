package io.github.yuloong07star.luwi.ui

import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.overlay.BallPicks
import io.github.yuloong07star.luwi.tool.LwIn
import io.github.yuloong07star.luwi.voice.InboxMedia
import io.github.yuloong07star.luwi.voice.VoiceInbox
import io.github.yuloong07star.luwi.workspace.Workspace

/**
 * 挑图 / 挑文件, 交给球 (2026-11-07 起; 2026-11-09 改成"与门户那个 `+` 同功能")
 *
 * 为什么必须是一个 Activity: 相册与文件那道闸只有 Activity 收得到结果, 而球那块输入框是 Service 里的
 * 一个 View —— 它连 `startActivityForResult` 都没有。这一层只做三件事: 起系统选择器 / 把选中的落盘 /
 * 把结果交回 [BallPicks] (或老路那条收件箱), 然后 finish
 *
 * **两种模式** (靠 [EXTRA_MODE] 分):
 *
 * - [MODE_BALL]: 与门户 `+` 同一套 —— 可选图片与各种文件、一次多个, 走 [LwIn.put] 落到
 *   `<工作区>/lw-in/` (名字 / 白名单 / 顺延 / 12 MB / 写完读回, 与门户逐字相同的那几条规矩)
 * - 没有这个 extra: 老路 —— 只挑图, 落 `voice/inbox-media` 并投一行收件箱 (给旧脚本与旧读数留的)
 *
 * **它不需要任何存储权限**: `ACTION_GET_CONTENT` / `OpenMultipleDocuments` 走系统选择器, 授权由选择器
 * 自己给 (这也是不用 `READ_MEDIA_IMAGES` 的全部理由 —— 少一条运行时权限)
 *
 * 它没有界面 ([Theme.Luwi.Transparent]): 主人看到的只有选择器本身, 中间不会闪一下黑屏
 */
class PickMediaActivity : ComponentActivity() {

    /**
     * 老路: 只挑一张图 (2026-11-07 主人: "球的文本框加个发图功能")
     *
     * `registerForActivityResult` 必须在 Activity 进入 STARTED 之前登记, 所以它是属性而不是在
     * [onCreate] 里注册 —— 后者在重建之后会抛 "LifecycleOwner is attempting to register while
     * current state is RESUMED"
     */
    private val pickOneImage = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            val name = runCatching { InboxMedia.stage(this, uri) }.getOrNull()
            if (name != null) {
                // 只有图没有字: 收件箱那一行允许 `text` 为空 (判空看的是"字与图都空")
                VoiceInbox.append(this, "", source = VoiceInbox.SOURCE_KEYBOARD, image = name)
            }
        }
        finish()
    }

    /**
     * 球上那条新路: 图片与文件一起挑, 一次多个
     *
     * mime 给的是**全通配**那一条 (任何类型都列出来): 各类文件管理器对
     * `application/vnd.openxmlformats-…` 那种通配的匹配很不一致, 而"收不收"本来就该由 [LwIn.EXTS]
     * 那张白名单说了算 (与门户 `<input accept>` 同一份) —— 选择器少列一种扩展名不该让主人挑不到它
     */
    private val pickMany = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNullOrEmpty()) {
            finish()
            return@registerForActivityResult
        }
        val root = Workspace.resolve(this).directory
        val picks = mutableListOf<LwIn.Pick>()
        val rejected = mutableListOf<String>()
        for (uri in uris) {
            val name = displayName(uri)
            val bytes = runCatching {
                contentResolver.openInputStream(uri)?.use { stream -> stream.readBytes() }
            }.getOrNull()
            if (bytes == null) {
                rejected.add(name)
                continue
            }
            val result = LwIn.put(root, name, bytes)
            val pick = result.pick
            if (pick != null) picks.add(pick) else rejected.add("$name: ${result.error}")
        }
        if (rejected.isNotEmpty()) {
            Toast.makeText(this, getString(R.string.ball_attach_rejected, rejected.joinToString("; ")), Toast.LENGTH_LONG)
                .show()
        }
        BallPicks.offer(picks)
        finish()
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        // 重建那一趟不再拉起选择器 (否则转屏会弹两次), 直接收
        if (state != null) {
            finish()
            return
        }
        if (intent?.getStringExtra(EXTRA_MODE) == MODE_BALL) {
            pickMany.launch(arrayOf("*/*"))
        } else {
            pickOneImage.launch("image/*")
        }
    }

    /** 选择器给的名字 (`DISPLAY_NAME`); 拿不到就拿 uri 最后那一段, 再不行给一个兜底 */
    private fun displayName(uri: Uri): String {
        runCatching {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        }.getOrNull()?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) {
                    val name = cursor.getString(index)
                    if (!name.isNullOrBlank()) return name
                }
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/').orEmpty().ifEmpty { "file" }
    }

    companion object {

        /** 走球那一套 (图片 + 文件, 多个) */
        const val MODE_BALL = "ball"

        /** 选哪一套: 缺省 = 老路 (只挑一张图) */
        const val EXTRA_MODE = "mode"
    }
}
