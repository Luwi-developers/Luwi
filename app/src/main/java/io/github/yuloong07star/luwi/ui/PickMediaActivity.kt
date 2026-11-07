package io.github.yuloong07star.luwi.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import io.github.yuloong07star.luwi.voice.InboxMedia
import io.github.yuloong07star.luwi.voice.VoiceInbox

/**
 * 挑一张图投进球的收件箱 (2026-11-07 主人: "球的文本框加个发图功能")
 *
 * 为什么必须是一个 Activity: 相册那道闸只有 Activity 收得到结果, 而球那块框是 Service 里的一个
 * View —— 它连 `startActivityForResult` 都没有。这一层只有一个动作: 起系统选择器, 拿到 uri, 落盘,
 * 投一行收件箱, finish
 *
 * **它不需要任何存储权限**: `ACTION_GET_CONTENT` 走的是系统选择器, 授权由选择器自己给 (这也是不用
 * `READ_MEDIA_IMAGES` 的全部理由 —— 少一条运行时权限, 少一条设置页里的权限行)
 *
 * 它没有界面 ([Theme.Luwi.Transparent]): 主人看到的只有选择器本身, 中间不会闪一下黑屏
 */
class PickMediaActivity : ComponentActivity() {

    /**
     * 选择器的结果就落在这里
     *
     * `registerForActivityResult` 必须在 Activity 进入 STARTED 之前登记, 所以它是属性而不是在
     * [onCreate] 里注册 —— 后者在重建之后会抛 "LifecycleOwner is attempting to register while
     * current state is RESUMED"
     */
    private val pick = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            val name = runCatching { InboxMedia.stage(this, uri) }.getOrNull()
            if (name != null) {
                // 只有图没有字: 收件箱那一行允许 `text` 为空 (判空看的是"字与图都空")
                VoiceInbox.append(this, "", source = VoiceInbox.SOURCE_KEYBOARD, image = name)
            }
        }
        finish()
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        // 重建那一趟不再拉起选择器 (否则转屏会弹两次), 直接收
        if (state == null) pick.launch("image/*") else finish()
    }
}
