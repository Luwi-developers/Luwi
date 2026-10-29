package io.github.yuloong07star.luwi.voice

import android.content.Context
import io.github.yuloong07star.luwi.tool.LwWakeWord
import io.github.yuloong07star.luwi.wake.WakeWordDownload

/**
 * "这次打开应用时两个模型都在不在"这一件事 (2026-10-28 主人)
 *
 * 唤醒词模型 (KWS, 约 5.3 MB) 与语音模型 (SenseVoice + VAD, 约 241 MB) **都不随包发**: 前者决定
 * 喊得醒不醒, 后者决定说的话能不能出字。**每次冷启动**都检测一次: 缺任一个就提醒一次, 最多提醒
 * 3 次 (计数落 `luwi` 偏好的 `model-prompt-count`); 到 3 次之后**连检测都不再做**, 不再弹窗。
 * 之后要补只能走设置页「唤醒」那一段 (两个下载行始终在)
 *
 * 同一个进程里只提醒一次: `model-prompt-count` 只管跨启动的 3 次, `promptedThisRun` 管"这一次打开
 * 应用只弹一次" (Activity 重建 / 转屏不会又弹)。进程死了它自然归零, 下一次打开又是一次
 *
 * 旧版的 `model-prompt-seen` 是个布尔 (已弹过/没弹过): 迁移时 true 记成 1 次, 于是已经看过一次的人
 * 还有两次提醒, 不会因为升级多出第四次
 */
internal object ModelSetup {

    private const val STORE = "luwi"

    /** 已经提醒过几次 (0..3) */
    private const val COUNT = "model-prompt-count"

    /** 旧版的布尔记号, 只用于 migration */
    private const val LEGACY_SEEN = "model-prompt-seen"

    /** 最多提醒几次; 到数之后不再检测 */
    const val MAX_PROMPTS = 3

    /** 这一次应用运行里已经弹过没有 (进程级, 不落盘) */
    @Volatile
    private var promptedThisRun = false

    enum class Need { WAKE, SPEECH }

    /** 一次提醒: 缺哪几个 + 这是第几次 (1..3) */
    data class Prompt(val needs: List<Need>, val count: Int)

    /** 已经提醒过几次; 旧布尔记号迁移成 1 次 */
    fun count(context: Context): Int {
        val prefs = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        if (!prefs.contains(COUNT)) {
            val legacy = prefs.getBoolean(LEGACY_SEEN, false)
            if (legacy) {
                prefs.edit().putInt(COUNT, 1).remove(LEGACY_SEEN).apply()
                return 1
            }
            return 0
        }
        return prefs.getInt(COUNT, 0).coerceIn(0, MAX_PROMPTS)
    }

    /** 现在缺哪几个 (按"先唤醒词, 后语音"的固定顺序) */
    fun missing(context: Context): List<Need> = buildList {
        if (!WakeWordDownload.present(context)) add(Need.WAKE)
        if (!SpeechModelDownload.present(context)) add(Need.SPEECH)
    }

    /**
     * 这一次打开应用要不要提醒
     *
     * 顺序是硬的: **先看次数** (到 3 就不再碰磁盘检测), 再看这一次运行弹没弹过, 最后才检测模型。
     * 返回 null 表示这一次不弹; 非 null 时**已经**把次数加一了 (弹出来那一刻就算一次, 进程被杀
     * 也不会白弹)
     */
    fun beginPrompt(context: Context): Prompt? {
        if (promptedThisRun) return null
        val times = count(context)
        if (times >= MAX_PROMPTS) return null
        val needs = missing(context)
        if (needs.isEmpty()) return null
        val next = (times + 1).coerceAtMost(MAX_PROMPTS)
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit()
            .putInt(COUNT, next)
            .remove(LEGACY_SEEN)
            .apply()
        promptedThisRun = true
        return Prompt(needs, next)
    }

    /** 缺的那个要下多少字节 (界面用它写"约 xx MB"; 都齐了就回 0) */
    fun bytesOf(need: Need): Long = when (need) {
        Need.WAKE -> WakeWordDownload.files.sumOf { it.bytes }
        Need.SPEECH -> SpeechModelDownload.files.sumOf { it.bytes } + SpeechModelDownload.vad.bytes
    }

    /**
     * 把缺的都下完, 返回给人看的一串句子
     *
     * **同步阻塞**: 调用方放在 IO 上。某一步失败就当场抛, 已经下完的那几个留着 —— 下次按一下
     * 只补缺的, 不会从头再来
     */
    fun downloadMissing(context: Context, onProgress: (String) -> Unit = {}): String {
        val said = mutableListOf<String>()
        if (!WakeWordDownload.present(context)) {
            onProgress("正在下唤醒词模型")
            said += WakeWordDownload.download(context)
            said += LwWakeWord.afterModelDownload(context)
        }
        if (!SpeechModelDownload.present(context)) {
            onProgress("正在下语音模型")
            said += SpeechModelDownload.download(context)
        }
        // 模型在、但词表还没写过 (老版本留下的半套) 时也补一次: 缺了 keywords.txt 唤醒永远不触发
        if (WakeWordDownload.present(context) && LwWakeWord.names(context).isEmpty()) {
            said += LwWakeWord.afterModelDownload(context)
        }
        if (said.isEmpty()) return "两个模型本来就在, 一个字节没下"
        return said.joinToString("。")
    }
}
