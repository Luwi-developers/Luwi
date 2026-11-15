package io.github.yuloong07star.luwi.voice

import android.content.Context
import io.github.yuloong07star.luwi.host.DshHost
import java.io.File
import org.json.JSONObject

/**
 * 语音输入用哪一条: 本地那 240 MB 的 SenseVoice, 还是已登录的 DeepSeek 账号 (2026-11-15, 2.8.1 #4)
 *
 * 主人那一句: "用户可选下载本地语音输入模型, 或直接用已登录 DeepSeek 账号的语音输入" —— 于是这一件
 * 从"必须先下模型"变成**两档可选**, 缺省仍是本地那一档 (老机器升级上来行为不变)
 *
 * **落一份文件而不是偏好**: 宿主那侧也要知道这个选择 (页面那颗麦克风走的是宿主注册的 provider,
 * 缺模型时它要说清"这台机器选了账号那条", 而不是永远念一句 `run lw_speech op=prepare`)。文件住在
 * `$DSH_HOME/lw/voice-source.json`, 应用是唯一写者, 宿主只读
 *
 * 读法逐键兜底: 缺文件 / 写坏 / 认不出来的值一律回 [LOCAL] —— 一份写坏的设置不该让语音整条哑掉
 */
internal object VoiceSource {

    /** 与 [io.github.yuloong07star.luwi.tool.PortalFace] / [io.github.yuloong07star.luwi.tool.SimSetting] 同一个父目录 */
    const val DIRECTORY = "lw"

    /** 那份设置的正文 */
    const val FILE = "voice-source.json"

    /** 正文里那个键 (宿主读同一份, 名字不许单边改) */
    const val KEY = "source"

    /** 本地模型那一档 (缺省) */
    const val LOCAL = "local"

    /** 已登录 DeepSeek 账号那一档 */
    const val DEEPSEEK = "deepseek"

    /** 那份设置在哪 */
    fun file(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), "$DIRECTORY/$FILE")

    /** 现在选的是哪一档 (读不到就是 [LOCAL]) */
    fun read(context: Context): String = normalise(rawOf(context))

    /** 选的是不是账号那条 */
    fun usesAccount(context: Context): Boolean = read(context) == DEEPSEEK

    /**
     * 收下一个选择
     *
     * 返回**真正落下去的那一档** (已经归一过): 调用方拿它改界面状态, 不自己再猜一遍
     * @param value 想选的那一档, 认不出来按 [LOCAL] 收
     */
    fun choose(context: Context, value: String): String {
        val source = normalise(value)
        val target = file(context)
        runCatching {
            target.parentFile?.mkdirs()
            val body = JSONObject()
                .put("v", 1)
                .put(KEY, source)
                .put("at", System.currentTimeMillis())
                .toString(2)
            // 先写临时文件再改名 (与 `SimSetting.save` 同一个办法): 宿主可能正读到一半
            val temporary = File(target.parentFile, "${target.name}.tmp")
            temporary.writeText(body)
            if (!temporary.renameTo(target)) {
                target.writeText(body)
                temporary.delete()
            }
        }
        return source
    }

    /**
     * 语音输入这一件办没办 (纯判据, 单测钉它)
     *
     * 本地模型在位就算办过; 选了账号那条也算 —— **它不需要那 240 MB**
     * @param choice 文件里那一段 ([read] 的结果)
     * @param modelPresent 本地模型在不在位 ([SpeechModelDownload.present])
     */
    fun satisfied(choice: String, modelPresent: Boolean): Boolean =
        modelPresent || normalise(choice) == DEEPSEEK

    /** 把文件里那个串收成两档之一 (纯函数) */
    fun normalise(raw: String?): String = if (raw?.trim() == DEEPSEEK) DEEPSEEK else LOCAL

    /** 盘上那个串, 读不到就是 null */
    private fun rawOf(context: Context): String? = runCatching {
        file(context).takeIf { it.isFile }?.readText()
            ?.let { JSONObject(it).optString(KEY).ifEmpty { null } }
    }.getOrNull()
}
