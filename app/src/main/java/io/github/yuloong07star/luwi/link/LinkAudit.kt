package io.github.yuloong07star.luwi.link

import android.content.Context
import java.io.File

/**
 * 谁在什么时候问了什么, 成没成
 *
 * 只记**这次调用本身**的元数据: 时间 / uid / 包名 / scope / 方法 / 放行还是拒 / 用了多久。
 * 参数正文、返回里的读数、token 一律不进来 —— 审计是给"谁调过我"留证据的, 不是给内容留副本
 *
 * 写不出就算了: 审计失败不能把一次正常调用变成失败
 */
internal object LinkAudit {

    private const val DIRECTORY = "lw"

    private const val FILE = "link-audit.log"

    /** 超过这个大小就换一个 `.1`, 只留一份旧的 */
    private const val MAX_BYTES = 256L * 1024L

    /**
     * 一行的形状
     *
     * 纯函数, 单测钉住格式与"不含正文"
     */
    fun line(
        at: String,
        caller: LinkGrants.LinkCaller,
        scope: String?,
        method: String,
        decision: LinkDecision,
        ms: Long,
    ): String {
        val verdict = when (decision) {
            LinkDecision.Allow -> "ok=true code=- because=-"
            is LinkDecision.Deny -> "ok=false code=${decision.code} because=${oneLine(decision.because)}"
        }
        return "$at uid=${caller.uid} pkg=${oneLine(caller.packageName)} " +
            "scope=${scope ?: "-"} method=${oneLine(method)} $verdict ms=$ms"
    }

    /** 换行会把一条记录拆成两条, 所以先压平 */
    private fun oneLine(text: String): String = text.replace('\n', ' ').replace('\r', ' ').trim()

    /** 追加一行, 顺手按大小轮换 */
    fun record(context: Context, text: String) {
        runCatching {
            val root = File(context.filesDir, "dsh-home")
            val dir = File(root, DIRECTORY)
            if (!dir.exists() && !dir.mkdirs()) return
            val file = File(dir, FILE)
            if (file.exists() && file.length() > MAX_BYTES) {
                val old = File(dir, "$FILE.1")
                old.delete()
                file.renameTo(old)
            }
            file.appendText(text + "\n")
        }
    }
}
