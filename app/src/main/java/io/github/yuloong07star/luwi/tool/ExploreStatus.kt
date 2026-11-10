package io.github.yuloong07star.luwi.tool

import android.content.Context
import io.github.yuloong07star.luwi.host.DshHost
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * 探索那一档的读数 (2.7.9 T5): 宿主写进 `$DSH_HOME/lw/explore.json` 的那一段 `status`
 *
 * **为什么要有这一份**: `preset` / `presetWhy` / `lastError` / `powerSaveUnknown` 原来只在宿主
 * 内存里, 也就是只有模型调 `lw_explore op=status` 时看得见 (施工单 F20); 设置页那一段只显示"下一次"
 * 与"上一次", 主人看不出这一场为什么没开成 / 用了哪个预设。宿主现在每次落盘都把这四项写进同一个
 * 文件, 应用这一侧只读它 —— 与 `explore-schedule.json` 一样, 不需要经过模型
 *
 * 另外把"最近一份摘要"也放在这里: 摘要在 `lw/explore/<yyyyMMdd-HHmm>.md`, 文件名天然可排序, 所以
 * 不额外落一份索引 (轻量档, 见施工单 §2.6 T4)
 */
internal object ExploreStatus {

    const val FILE = "explore.json"
    const val SUMMARY_DIR = "explore"

    /** 宿主那一段读数的四项; 读不到整段就是 null */
    data class Snapshot(
        val preset: String?,
        val presetWhy: String?,
        val lastError: String?,
        val powerSaveUnknown: Boolean,
        /** 上一场交了几条检测项 (2026-11-10, 方案 B); null = 还没有一场收尾 */
        val checksWritten: Int? = null,
        /** 连着几场一条都没交: 回答"是偶尔没交, 还是她根本没在想" */
        val checksStreak: Int = 0,
        /** 上一场收尾那一刻 (0 = 还没有) */
        val lastFinishAt: Long = 0,
    )

    private val json = Json { ignoreUnknownKeys = true }

    fun file(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), "lw/$FILE")

    fun summaryDirectory(context: Context): File =
        File(File(context.filesDir, DshHost.HOME_DIR), "lw/$SUMMARY_DIR")

    /** 现在那一份读数; 文件不在 / 还没有 `status` 段就是 null */
    fun read(context: Context): Snapshot? {
        val raw = runCatching { file(context).takeIf { it.isFile }?.readText() }.getOrNull() ?: return null
        val root = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return null
        return snapshotOf(root)
    }

    /**
     * 一份 `explore.json` -> 那四项 + 收尾账 (纯函数, 单测钉)
     *
     * 空串按"没有"算: 宿主那侧 `presetWhy` 在一切正常时是空串的可能很小, 但它把"没有原因要说"写成
     * 空串时, 设置页不该多出一行"为什么是它: "
     *
     * 2026-11-10 (方案 B): `lastFinish` / `checksStreak` 是同一份文件里的两笔新账 —— 一段 `status`
     * 都不在但这两笔在时也要给一份 (老版本宿主写的文件没有 `lastFinish`, 于是 `checksWritten` 是 null)
     */
    fun snapshotOf(root: JsonObject): Snapshot? {
        val status = root["status"] as? JsonObject
        val finish = root["lastFinish"] as? JsonObject
        if (status == null && finish == null && root["checksStreak"] == null) return null
        return Snapshot(
            preset = status?.get("preset")?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() },
            presetWhy = status?.get("presetWhy")?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() },
            lastError = status?.get("lastError")?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() },
            powerSaveUnknown = status?.get("powerSaveUnknown")?.jsonPrimitive?.booleanOrNull ?: false,
            checksWritten = finish?.get("written")?.jsonPrimitive?.intOrNull?.coerceAtLeast(0),
            checksStreak = (root["checksStreak"]?.jsonPrimitive?.intOrNull ?: 0).coerceAtLeast(0),
            lastFinishAt = finish?.get("at")?.jsonPrimitive?.longOrNull ?: 0L,
        )
    }

    /**
     * 最近一份摘要 (文件名是 `yyyyMMdd-HHmm.md`, 直接按名字取最大那个)
     *
     * 读不到目录就给 null: 那正是"第一场还没收尾", 设置页那一行如实这么说
     */
    fun latestSummary(context: Context): File? = runCatching {
        summaryDirectory(context).listFiles()
            ?.filter { it.isFile && it.extension == "md" }
            ?.maxByOrNull { it.name }
    }.getOrNull()
}
