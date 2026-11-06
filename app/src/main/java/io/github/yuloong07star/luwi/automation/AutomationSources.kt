package io.github.yuloong07star.luwi.automation

import android.Manifest
import android.content.Context
import android.provider.CalendarContract
import io.github.yuloong07star.luwi.channel.LwNotificationListener
import io.github.yuloong07star.luwi.util.Capability
import io.github.yuloong07star.luwi.util.PermissionGate

/**
 * `calendarSoon` 的数据源: CalendarContract
 *
 * 读的是 **`Instances`** 而不是 `Events`: 重复日程在 `Events` 里只有第一场的 `DTSTART`, 拿它算
 * "20 分钟后有一场" 会永远算不到第 2 场以后; `Instances` 是系统按 RRULE 展开后的实例, 正是这一条
 * 要的那个数
 *
 * 缺权限时**不抛**, 回一句为什么 —— 定时判定那条链上抛出去只会变成一行没人看得见的日志, 而主人问
 * "它怎么没响"时, 那句原因要留在监视器那一行里 (见 `AutomationMonitors.describe`)
 */
internal object AutomationCalendar {

    /** 一段日程实例 (只带判定与证据要用的几样) */
    data class Occurrence(
        val eventId: Long,
        val calendarId: Long,
        val title: String,
        val begin: Long,
        val end: Long,
        val allDay: Boolean,
    )

    /** 一次查询的结果: 要么是一串实例, 要么是一句读不到的原因 */
    data class Reading(val occurrences: List<Occurrence>? = null, val refusal: String? = null)

    private val capability = Capability(
        name = "日历",
        why = "自动指令的「日程临近」",
        permissions = listOf(Manifest.permission.READ_CALENDAR),
    )

    /**
     * `[from, to)` 之间开始的日程实例
     *
     * @param calendarIds 空表示所有日历; 非空只查这几本
     */
    fun read(context: Context, from: Long, to: Long, calendarIds: List<Long>): Reading {
        val refusal = PermissionGate.refusal(context, capability)
        if (refusal != null) return Reading(refusal = "日程读不到: $refusal")
        if (to <= from) return Reading(occurrences = emptyList())
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon()
            .appendPath(from.toString())
            .appendPath(to.toString())
            .build()
        val projection = arrayOf(
            CalendarContract.Instances.EVENT_ID,
            CalendarContract.Instances.CALENDAR_ID,
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY,
        )
        val selection = if (calendarIds.isEmpty()) {
            null
        } else {
            "${CalendarContract.Instances.CALENDAR_ID} IN (${calendarIds.joinToString(",")})"
        }
        return try {
            val found = mutableListOf<Occurrence>()
            context.contentResolver.query(
                uri,
                projection,
                selection,
                null,
                "${CalendarContract.Instances.BEGIN} ASC",
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    found += Occurrence(
                        eventId = cursor.getLong(0),
                        calendarId = cursor.getLong(1),
                        title = cursor.getString(2)?.takeIf { it.isNotBlank() } ?: "(no title)",
                        begin = cursor.getLong(3),
                        end = if (cursor.isNull(4)) 0L else cursor.getLong(4),
                        allDay = cursor.getInt(5) != 0,
                    )
                }
            }
            Reading(occurrences = found)
        } catch (problem: SecurityException) {
            Reading(refusal = "日程读不到: ${problem.message ?: "系统拒了日历权限"}")
        } catch (problem: Throwable) {
            Reading(refusal = "日程查询失败: ${problem.message ?: problem.javaClass.simpleName}")
        }
    }
}

/**
 * 电量阈值那一道判断 (`battery`)
 *
 * "在不在阈值内"与"这一下要不要报"是两件事: 前者是读数, 后者是**跨过**。把这两半拆成纯函数,
 * 引擎只负责按规则记账, 而"电量阈值只触发一次"这条验收由单测直接钉住
 */
internal object AutomationBattery {

    /** 现在的读数满不满足这条规则写的条件 */
    fun inside(
        level: Int,
        charging: Boolean,
        below: Double?,
        above: Double?,
        chargingWanted: Boolean?,
    ): Boolean =
        (below == null || level < below) &&
            (above == null || level > above) &&
            (chargingWanted == null || chargingWanted == charging)

    /**
     * 这一下算不算命中
     *
     * 叶子规则只有"从外面跨进来"那一次算 (`was` 为假); 组合里的子条件要一直算成立 —— 它靠新鲜窗口
     * 决定组合成不成立, 不能因为"已经报过"就不再新鲜
     */
    fun shouldHit(inside: Boolean, was: Boolean, asSub: Boolean): Boolean = inside && (asSub || !was)
}

/**
 * `noticeDigest` 的数据源: 通知摘要缓存
 *
 * 通知监听那条链本来就一条一条送进来 (见 [LwNotificationListener]), 这一层只做三件事:
 * **按 key 去重** (同一通知被更新时换掉旧的那一条, 不涨数)、**按内容去重** (同一应用连发同样的
 * 一句话只算一条)、**有上限** (最多 [MAX_ENTRIES] 条, 更早的按窗口清掉)
 *
 * 缓存只在进程里, 不落盘: 它要回答的是"最近 N 分钟内来了几条", 重启之后重新收就是, 没有值得留的账
 */
internal object AutomationDigest {

    /** 缓存里的一条 */
    data class Entry(
        val key: String,
        val packageName: String,
        val title: String,
        val text: String,
        val at: Long,
    )

    /** 上限: 一屏刷屏的应用也能把缓存撑到这么多, 再多对"最近几条"没有意义 */
    const val MAX_ENTRIES = 200

    /** 每条正文最多留多长 (与通知监听那一层同一个数) */
    private const val MAX_TEXT = 300

    fun entryOf(posted: LwNotificationListener.Posted): Entry = Entry(
        key = posted.key,
        packageName = posted.packageName,
        title = posted.title.take(MAX_TEXT),
        text = posted.text.take(MAX_TEXT),
        at = posted.postedAt,
    )

    /**
     * 收一条进缓存
     *
     * 同一个 [Entry.key] 是"同一条通知被更新了": 换掉旧的, 不涨数; 换了一把 key 但内容一样 (同一
     * 应用连发同一句) 也只算一条 —— 否则一个刷新很快的应用能把"摘要"变成"刷屏计数"
     */
    fun remember(cache: MutableMap<String, Entry>, entry: Entry) {
        if (cache.containsKey(entry.key)) {
            cache[entry.key] = entry
            return
        }
        if (cache.values.any { it.sameContent(entry) }) return
        cache[entry.key] = entry
        while (cache.size > MAX_ENTRIES) {
            val eldest = cache.keys.firstOrNull() ?: break
            cache.remove(eldest)
        }
    }

    /** 清掉窗口外的旧条目 (心跳每拍叫一次, 缓存不会无限长) */
    fun prune(cache: MutableMap<String, Entry>, now: Long) {
        val horizon = now - AutomationRule.MAX_DIGEST_MINUTES * 60_000L
        cache.entries.removeAll { it.value.at < horizon }
    }

    /** 最近 `withinMinutes` 分钟内、指定几个应用 (空表示全部) 的通知, 最新的在前 */
    fun recent(
        cache: Map<String, Entry>,
        now: Long,
        withinMinutes: Int,
        packages: List<String> = emptyList(),
    ): List<Entry> {
        val window = withinMinutes.coerceIn(1, AutomationRule.MAX_DIGEST_MINUTES)
        val since = now - window * 60_000L
        return cache.values
            .filter { it.at in since..now }
            .filter { packages.isEmpty() || it.packageName in packages }
            .sortedByDescending { it.at }
    }

    private fun Entry.sameContent(other: Entry): Boolean =
        packageName == other.packageName && title == other.title && text == other.text
}
