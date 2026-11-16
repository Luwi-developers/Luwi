package io.github.yuloong07star.luwi.tool

import android.content.Context
import android.os.SystemClock
import io.github.yuloong07star.luwi.automation.AutomationEngine
import io.github.yuloong07star.luwi.automation.AutomationJson
import io.github.yuloong07star.luwi.automation.AutomationRule
import io.github.yuloong07star.luwi.automation.AutomationStore
import io.github.yuloong07star.luwi.channel.LwAccessibility
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 自动指令: `$DSH_HOME/automations/` 那几条规则的脸
 *
 * 与快捷指令同一个形状 (app 进程里做 → 桥 → 插件一条工具), 差别在两处:
 *
 * - 这里的正文是**一份 JSON**, 所以 `write` 先校验再落盘 —— 写坏了的规则在界面上就是"它从来没响过",
 *   而那种错没人查得出来
 * - 多两条只读的: `status` (十二个监测器此刻的可用性 + 为什么现在不可能响) 与 `history` (最近几次判定
 *   与原因)。主人问"它怎么没响"时, 答案在这两条里
 * - `record` 是"录一遍"那条路 (2.8.1 #15): 它把无障碍那条**窗口事件队列**里的一段轨迹归约成规则,
 *   于是"我操作一遍, 你记成规则"不必先学会写那份 JSON
 *
 * 七条 op 里 `delete` **只在桥上有** (设置页那个删除按钮用它), 给模型的是 [MODEL_OPERATIONS] 那六条
 */
internal object LwAutomation {

    /** 目录名: 与设置页、创建提示词、工具说明里说的都是它 */
    const val DIRECTORY = AutomationStore.DIRECTORY

    /**
     * op 名单, **插件那边念给模型的与这一份不许漂开**
     *
     * `tools/check-automations.mjs` 拿这两行去比插件那一份说明
     */
    val OPERATIONS = listOf("list", "read", "write", "record", "delete", "status", "history")

    /** 模型那一侧只给这六条: 删掉一条规则由人在设置页点 */
    val MODEL_OPERATIONS = listOf("list", "read", "write", "record", "status", "history")

    /** 一次读回多少字节: 一条规则是一个小 JSON, 这么大已经是"写得太多"那一档 */
    private const val MAX_READ_BYTES = 64 * 1024

    /**
     * 录下来的那一串放哪: `automations/recorded/`
     *
     * **不能放规则目录**: 那里每个 `*.json` 都会被当成一条规则去解析 (`AutomationStore.isRuleFile`),
     * 一份录制轨迹落进去, 设置页上就多一条 `BROKEN`
     */
    const val RECORDED_DIRECTORY = "recorded"

    /** 正在录的那一场 (开始时刻 + 队列游标) */
    const val RECORDED_SESSION = "current.json"

    /** 没有 start 就直接 stop 时往回看多久 (毫秒) */
    const val RECORDED_LOOK_BACK_MS = 180_000L

    /** 一步"点了一下"折成"刚动过手机"看多近 (分钟) */
    const val RECORDED_ACTIVITY_MINUTES = 1

    /** 录制只收窗口事件: 内容 / 焦点 / 滚动那三类一屏能来几十条, 而"哪一段窗口起来了"才是步骤 */
    private val WINDOW_KINDS = setOf("window")

    /** 系统界面不算一步 (下拉通知栏 / 最近任务不是主人要记的那件事) */
    private const val SYSTEM_UI = "com.android.systemui"

    fun dispatch(context: Context, request: JsonObject): JsonObject = when (val op = request.string("op")) {
        "list" -> list(context)
        "read" -> read(context, request)
        "write" -> write(context, request)
        "record" -> record(context, request)
        "delete" -> delete(context, request)
        "status" -> status(context)
        "history" -> history(context, request)
        else -> throw IllegalArgumentException(
            "op has to be ${OPERATIONS.joinToString(", ")}, not \"$op\"",
        )
    }

    /** 那一份家在哪 (settings / history / places 都在这) */
    fun directory(context: Context) = AutomationStore.directory(context)

    /** 新写的规则在哪 (2.8.0 起一律是 `automations/rules/`) */
    fun rulesDirectory(context: Context) = AutomationStore.rulesDirectory(context)

    /** 录下来的那几串在哪 (`automations/recorded/`, 不是规则) */
    fun recordedDirectory(context: Context): File = File(directory(context), RECORDED_DIRECTORY)

    /** `rejected/` 里攒了几条坏规则 */
    fun rejectedCount(context: Context): Int = AutomationStore.rejectedCount(context)

    /** 现在有哪些规则, 读不出来的也在里面 (界面要说得出"这一条坏了") */
    fun entries(context: Context): List<AutomationStore.Entry> = AutomationStore.entries(context)

    /** 设置页那个开关 */
    fun setEnabled(context: Context, name: String, enabled: Boolean): Boolean {
        val ok = AutomationStore.setEnabled(context, name, enabled)
        if (ok) AutomationEngine.invalidate()
        return ok
    }

    /**
     * 设置页那条**直接改冷却** (2026-10-09 主人加的: 由用户决定冷却闸多少时间)
     *
     * 与 [setEnabled] 同一个形状, 而它改的是 `cooldownMinutes` —— 改完引擎要重读, 否则正在跑的那一份
     * 规则还是旧数 (冷却那笔账就在 [AutomationEngine.act] 里读它)
     */
    fun setCooldown(context: Context, name: String, minutes: Int): Boolean {
        val ok = AutomationStore.setCooldown(context, name, minutes)
        if (ok) AutomationEngine.invalidate()
        return ok
    }

    /** 设置页那个删除按钮 */
    fun delete(context: Context, name: String): Boolean {
        val ok = AutomationStore.delete(context, name)
        if (ok) AutomationEngine.invalidate()
        return ok
    }

    /** 设置页读的那一份设置 */
    fun settings(context: Context): AutomationStore.Settings = AutomationStore.settings(context)

    fun saveSettings(context: Context, settings: AutomationStore.Settings) =
        AutomationEngine.saveSettings(context, settings)

    /** 最近几次判定 (设置页那 10 条与 `op=history` 同一份) */
    fun history(context: Context, limit: Int = 10, rule: String? = null): List<AutomationStore.Fired> =
        AutomationStore.history(context, limit, rule)

    /** 一行总账 (设置页最上面那一行) */
    fun overview(context: Context): String = AutomationEngine.overview(context)

    /** 设置页那个「立刻跑一次」 */
    fun fireNow(context: Context, name: String): String = AutomationEngine.fireNow(context, name)

    /** 十二个监测器此刻的状态 (设置页逐行显示) */
    fun monitorStates(context: Context): List<Pair<String, String>> =
        AutomationEngine.monitorStates(context)

    /* ── 七条 op ────────────────────────────────────────────────────────── */

    private fun list(context: Context): JsonObject {
        val entries = entries(context)
        if (entries.isEmpty()) {
            return text(
                "there are no automatic commands yet (${rulesDirectory(context)}). Write one with" +
                    " op=write: a name and a JSON object shaped like" +
                    " {\"name\",\"enabled\",\"when\":{\"kind\",...},\"then\":{\"kind\":\"remind\"|\"task\"," +
                    "\"text\"},\"cooldownMinutes\",\"dailyLimit\",\"quietHours\"}; the kinds are" +
                    " ${AutomationRule.WHEN_KINDS.joinToString(", ")} (all/any take 2..5 conds and do not" +
                    " nest), or record one with op=record when the user would rather show you than describe it",
            )
        }
        val rows = entries.joinToString("\n") { entry ->
            val state = when {
                entry.problem != null -> "BROKEN (${entry.problem})"
                entry.rule?.enabled == true -> "on"
                else -> "off"
            }
            val what = entry.rule?.summary() ?: "this file could not be read"
            val last = AutomationEngine.lastFiredAt(entry.name)?.let {
                ", last fired " + SimpleDateFormat("MM-dd HH:mm", Locale.US).format(Date(it))
            }.orEmpty()
            "  ${entry.name}  [$state]  $what$last"
        }
        return text("${entries.size} automatic command(s) in ${rulesDirectory(context)}:\n$rows")
    }

    private fun read(context: Context, request: JsonObject): JsonObject {
        val name = normalizeName(request.string("name"))
        val file = AutomationStore.existingFile(context, name)
        if (file == null) {
            return text(
                "there is no automatic command called \"$name\". What is there: " +
                    (AutomationStore.names(context).joinToString(", ").ifEmpty { "nothing yet" }),
            )
        }
        val raw = file.readText()
        val head = if (raw.length > MAX_READ_BYTES) raw.take(MAX_READ_BYTES) else raw
        val summary = runCatching { AutomationRule.parse(name, raw).summary() }
            .getOrElse { "this file cannot be read: ${it.message}" }
        val suffix = if (raw.length > MAX_READ_BYTES) "\n\n(the file is longer than $MAX_READ_BYTES bytes, so this is the head of it)" else ""
        return text("automatic command \"$name\" (${file.absolutePath}): $summary\n\n$head$suffix")
    }

    private fun write(context: Context, request: JsonObject): JsonObject {
        val name = normalizeName(request.string("name"))
        val json = request.string("json")
        val existed = AutomationStore.existingFile(context, name) != null
        val (file, warnings) = try {
            AutomationStore.write(context, name, json)
        } catch (problem: Throwable) {
            throw IllegalArgumentException("this rule was not accepted: ${problem.message}")
        }
        AutomationEngine.invalidate()
        val said = buildString {
            append(if (existed) "updated" else "created")
            append(" automatic command \"$name\" (${bytes(file.length())}, ${file.absolutePath})")
            append("; it shows up in the app's Settings -> 自动指令 right away")
            if (warnings.isNotEmpty()) {
                append("\nnote: ")
                append(warnings.joinToString("; "))
            }
        }
        return text(said)
    }

    private fun delete(context: Context, request: JsonObject): JsonObject {
        val name = normalizeName(request.string("name"))
        val file = AutomationStore.existingFile(context, name)
        if (file == null) return text("there is no automatic command called \"$name\", so nothing was deleted")
        val removed = AutomationStore.delete(context, name)
        if (removed) AutomationEngine.invalidate()
        return text(
            if (removed) "deleted automatic command \"$name\"" else "could not delete \"$name\" (${file.absolutePath})",
        )
    }

    /* ── 录制: 一次真人操作折成一条规则 (2.8.1 #15) ─────────────────────────── */

    /** 正在录的那一场: 开始那一刻与队列游标 (游标之前的事件不算这一步的) */
    data class Session(val startedAt: Long, val cursor: Long)

    /**
     * 录制里的一步: 哪一段窗口起来了, 屏幕上那行字是什么
     *
     * [screen] 是 `AccessibilityEvent.className` (哪个 Activity), [title] 是事件带的那行文字 —— 两样
     * 都要: 设置的主页与 WLAN 页是**同一个包名的两个 Activity**, 只看包名会把它们合成一步
     */
    data class RecordedStep(
        val packageName: String,
        val title: String,
        val screen: String,
        val at: Long,
    )

    /**
     * 连着来的同一段窗口只留一条
     *
     * 开两个 Activity 是两步 (同一个包里换了屏), 而同一个窗口刷两次不是 —— 后者只是系统又送了一条
     * `TYPE_WINDOW_STATE_CHANGED`, 把它也当成一步, 规则里就会多一条一模一样的子条件
     */
    fun mergeRecordedSteps(steps: List<RecordedStep>): List<RecordedStep> {
        val kept = mutableListOf<RecordedStep>()
        for (step in steps) {
            val last = kept.lastOrNull()
            val same = last != null &&
                last.packageName == step.packageName &&
                last.screen == step.screen &&
                last.title == step.title
            if (!same) kept += step
        }
        return kept
    }

    /**
     * 一串录制步 -> 每一步那一片叶子 (`recordedRule` 与回执**共用这一份**, 免得两边说不一样的话)
     *
     * 一次 GUI 录制给得出的只有两片叶子 (别的几片要硬件或日历):
     *
     * - 一个包的第一段窗口 -> `foreground {package}`: 切到这个应用
     * - 同一个包后面那几段 -> `activity {withinMinutes}`: 手机刚被碰过 (点进下一屏了)
     *
     * **一步换一片, 顺序不动**: 这条一一对应就是"录的那一遍还能被读回来"的意思, 所以宁可让两步折成
     * 同一片叶子, 也不合并它们
     */
    fun recordedLeaves(steps: List<RecordedStep>): List<JsonObject> =
        steps.mapIndexed { index, step ->
            val leaf = if (index > 0 && steps[index - 1].packageName == step.packageName) {
                "activity"
            } else {
                "foreground"
            }
            buildJsonObject {
                put("kind", leaf)
                if (leaf == "foreground") {
                    put("package", step.packageName)
                } else {
                    put("withinMinutes", RECORDED_ACTIVITY_MINUTES)
                }
            }
        }

    /** 一步在回执里怎么叫: 窗口标题, 没有就用 Activity 名 */
    fun stepTitle(step: RecordedStep): String =
        step.title.ifBlank { step.screen.substringAfterLast('.').ifBlank { step.packageName } }

    /** 那一串步骤给人看的一行 —— 它会跟在 `then.text` 后面, 规则响的时候模型读到的就是它 */
    fun recordedStepsLine(steps: List<RecordedStep>): String =
        "录的那一串: " + steps.joinToString(" -> ") { step -> stepTitle(step) + " (" + step.packageName + ")" }

    /**
     * 一串录制步 -> 一条规则 (纯函数, `LwAutomationRecordTest` 钉着)
     *
     * 写出去的那一份与 `op=write` 收的是同一个形状, 所以它要过同一道校验 (`AutomationStore.write`):
     * 折出来的东西如果连自己那关都过不了, 宁可当场拒, 也不要落一条"从来没响过"的规则
     *
     * 屏幕上的标题**不进触发器** (触发器没有"哪一屏"这一档), 它进 `then.text` 尾巴那行
     * [recordedStepsLine] —— 于是规则响的时候, 那一串还在
     */
    fun recordedRule(
        name: String,
        thenKind: String,
        thenLine: String,
        steps: List<RecordedStep>,
    ): JsonObject {
        require(steps.isNotEmpty()) { "there is nothing to fold: no window changed while recording" }
        val kept = steps.take(AutomationRule.COMBO_MAX_CONDS)
        val conds = recordedLeaves(kept)
        val when_ = if (conds.size == 1) {
            conds.single()
        } else {
            buildJsonObject {
                put("kind", "all")
                put("conds", buildJsonArray { conds.forEach { add(it) } })
            }
        }
        return buildJsonObject {
            put("name", name)
            put("enabled", true)
            put("when", when_)
            put("then", buildJsonObject {
                put("kind", thenKind)
                put("text", thenLine.trim() + "\n" + recordedStepsLine(kept))
            })
            put("cooldownMinutes", AutomationRule.DEFAULT_COOLDOWN_MINUTES)
            put("dailyLimit", AutomationRule.DEFAULT_DAILY_LIMIT)
            put("quietHours", true)
        }
    }

    /**
     * 录一遍 (`op=record`): start 记下游标 -> 主人在手机上做一遍 -> stop 把它折成规则
     *
     * 轨迹来自无障碍那条**有界队列** (`LwAccessibility.heard`), 没有第二个录制器: 那 200 条窗口事件
     * 本来就记着"哪一段窗口起来了, 上面写着什么", 一次真人操作要的正是这两样
     */
    private fun record(context: Context, request: JsonObject): JsonObject {
        val action = request.string("action", "stop").trim().lowercase(Locale.US)
        return when (action) {
            "start" -> startRecording(context)
            "cancel" -> cancelRecording(context)
            "stop", "save", "finish" -> finishRecording(context, request)
            else -> throw IllegalArgumentException(
                "action has to be start, stop (fold what was recorded into one rule) or cancel, not \"$action\"",
            )
        }
    }

    private fun startRecording(context: Context): JsonObject {
        if (!LwAccessibility.running) {
            return text(
                "nothing can be recorded yet: the recorder reads window changes through accessibility, and" +
                    " that service is off right now (设置 -> 无障碍 -> Luwi). Turn it on, then call" +
                    " op=record action=start again",
            )
        }
        val file = recordingFile(context)
        file.parentFile?.mkdirs()
        file.writeText(
            AutomationJson.writer.encodeToString(
                JsonObject.serializer(),
                buildJsonObject {
                    put("startedAt", System.currentTimeMillis())
                    put("cursor", LwAccessibility.latest)
                },
            ) + "\n",
        )
        return text(
            "recording from now on: do the whole thing on the phone (for example 打开设置 -> 点 WLAN), then" +
                " call op=record action=stop with name and then. What is kept is which window came to the" +
                " front each time, so every step becomes one condition of the rule",
        )
    }

    private fun cancelRecording(context: Context): JsonObject {
        val file = recordingFile(context)
        val existed = file.isFile
        runCatching { file.delete() }
        return text(
            if (existed) {
                "the recording was dropped; nothing was written"
            } else {
                "there was no recording to drop"
            },
        )
    }

    private fun finishRecording(context: Context, request: JsonObject): JsonObject {
        val name = request.stringOrNull("name")
            ?: throw IllegalArgumentException(
                "op=record action=stop needs name and then: the rule has to be called something, and then" +
                    " has to say what to do when the recorded flow comes round again",
            )
        val thenLine = request.stringOrNull("then")
            ?: throw IllegalArgumentException(
                "op=record action=stop needs then: one line saying what to do when the recorded flow" +
                    " comes round again",
            )
        val thenKind = request.string("thenKind", "task")
        if (thenKind !in AutomationRule.THEN_KINDS) {
            throw IllegalArgumentException(
                "thenKind has to be one of ${AutomationRule.THEN_KINDS.joinToString(", ")}",
            )
        }
        if (!LwAccessibility.running) {
            return text(
                "the recorder reads window changes through accessibility, and that service is off right now," +
                    " so there is nothing to read back",
            )
        }
        val rule = normalizeName(name)
        val session = recording(context)
        val events = if (session != null) {
            LwAccessibility.heard(session.cursor, kinds = WINDOW_KINDS)
        } else {
            val now = SystemClock.uptimeMillis()
            LwAccessibility.heard(0L, kinds = WINDOW_KINDS).filter { it.at >= now - RECORDED_LOOK_BACK_MS }
        }
        val own = context.packageName
        val steps = mergeRecordedSteps(
            events.mapNotNull { event ->
                val packageName = event.packageName.trim()
                when {
                    packageName.isEmpty() -> null
                    packageName == own -> null
                    packageName == SYSTEM_UI -> null
                    else -> RecordedStep(packageName, event.text.trim(), event.className.trim(), event.at)
                }
            },
        )
        if (steps.isEmpty()) {
            return text(
                "nothing was recorded: no window came to the front since the recording started, so there is" +
                    " nothing to fold. Do the thing on the phone after op=record action=start, then call" +
                    " op=record action=stop again - the session stays open",
            )
        }
        val existed = AutomationStore.existingFile(context, rule) != null
        val json = AutomationJson.writer.encodeToString(
            JsonObject.serializer(),
            recordedRule(rule, thenKind, thenLine, steps),
        )
        val (file, warnings) = try {
            AutomationStore.write(context, rule, json)
        } catch (problem: Throwable) {
            throw IllegalArgumentException("this recording was not accepted: ${problem.message}")
        }
        AutomationEngine.invalidate()
        saveRecordedSteps(context, rule, steps)
        runCatching { recordingFile(context).delete() }
        val kept = steps.take(AutomationRule.COMBO_MAX_CONDS)
        val leaves = recordedLeaves(kept)
        val trace = File(recordedDirectory(context), "${rule}.steps.json")
        val said = buildString {
            append(if (existed) "updated" else "created")
            append(" automatic command \"$rule\" from what was recorded")
            append(" (${bytes(file.length())}, ${file.absolutePath})")
            append("; it shows up in the app's Settings -> 自动指令 right away")
            append("\n${steps.size} step(s) recorded, ${kept.size} became the conditions, one for one:")
            append("\n")
            append(
                kept.zip(leaves).mapIndexed { index, (step, leaf) ->
                    "  ${index + 1}. ${stepTitle(step)} (${step.packageName})  ->  " + leafLine(leaf)
                }.joinToString("\n"),
            )
            if (steps.size > kept.size) {
                append(
                    "\n(the recording was longer than ${AutomationRule.COMBO_MAX_CONDS} steps, so the rest was" +
                        " left out: a combination holds 2..${AutomationRule.COMBO_MAX_CONDS})",
                )
            }
            append("\nthe whole trace is in ${trace.absolutePath}")
            if (warnings.isNotEmpty()) {
                append("\nnote: ")
                append(warnings.joinToString("; "))
            }
        }
        return text(said)
    }

    /** 一片叶子念成回执里那半行 */
    private fun leafLine(leaf: JsonObject): String = when (leaf["kind"]?.jsonPrimitive?.contentOrNull) {
        "foreground" -> "foreground " + leaf["package"]?.jsonPrimitive?.contentOrNull.orEmpty()
        else -> "activity within " + leaf["withinMinutes"]?.jsonPrimitive?.contentOrNull.orEmpty() + " min"
    }

    private fun recordingFile(context: Context): File = File(recordedDirectory(context), RECORDED_SESSION)

    /** 正在录的那一场, 没有就是 null (文件读不出来也算没有) */
    private fun recording(context: Context): Session? {
        val file = recordingFile(context)
        if (!file.isFile) return null
        return runCatching {
            val root = AutomationJson.parse(file.readText())
            Session(
                startedAt = root["startedAt"]?.jsonPrimitive?.longOrNull ?: 0L,
                cursor = root["cursor"]?.jsonPrimitive?.longOrNull ?: 0L,
            )
        }.getOrNull()
    }

    /**
     * 这一串录制留一份底 (`recorded/<名字>.steps.json`)
     *
     * 规则里只有折好的触发器, 而"录的那一遍到底是什么"是另一个问题 —— 主人问"它怎么跟我想的不一样"
     * 时, 答案在这份轨迹里; 它也不进规则目录, 所以设置页不会多出一条
     */
    private fun saveRecordedSteps(context: Context, name: String, steps: List<RecordedStep>) {
        val file = File(recordedDirectory(context), "$name.steps.json")
        file.parentFile?.mkdirs()
        val root = buildJsonObject {
            put("name", name)
            put("at", System.currentTimeMillis())
            put("steps", buildJsonArray {
                steps.forEachIndexed { index, step ->
                    add(buildJsonObject {
                        put("index", index + 1)
                        put("package", step.packageName)
                        put("title", step.title)
                        put("screen", step.screen)
                    })
                }
            })
        }
        runCatching { file.writeText(AutomationJson.writer.encodeToString(JsonObject.serializer(), root) + "\n") }
    }

    /** 十二个监测器此刻能不能用, 以及此刻为什么可能不响 */
    private fun status(context: Context): JsonObject {
        val rules = AutomationEngine.rules()
        val settings = AutomationEngine.settings()
        val rows = mutableListOf<Pair<String, String>>()
        rows += "rules" to "${rules.size} (${rules.count { it.enabled }} on)"
        rows += "directory" to directory(context).absolutePath
        rows += "rules directory" to rulesDirectory(context).absolutePath
        rows += "rejected" to "${rejectedCount(context)} unreadable rule(s) kept aside"
        rows += "recording" to (recording(context)?.let { session ->
            "in progress since " + stamp(session.startedAt) + ", " +
                LwAccessibility.heard(session.cursor, kinds = WINDOW_KINDS).size + " window step(s) so far"
        } ?: "nothing being recorded (op=record action=start begins one)")
        rows += "quiet hours" to when {
            settings == null -> "unknown"
            !settings.quietEnabled -> "off"
            else -> settings.quietWindow + (if (AutomationEngine.quietNow(context)) " (quiet now)" else "")
        }
        rows += "acting" to when {
            settings == null -> "unknown"
            else -> "allowed: a task rule acts on its own (the old global switch was removed on 2026-11-07)"
        }
        rows += "proactive gap" to (ProactiveGate.lastAt(context).takeIf { it > 0 }?.let { last ->
            "last spoke " + stamp(last) + " (" + (ProactiveGate.source(context) ?: "unknown") + "), " +
                "next allowed " + stamp(last + ProactiveGate.GAP_MS)
        } ?: "nothing spoken yet; proactive conversations and automatic rules share one " +
            "${ProactiveGate.GAP_MINUTES}-minute gate (a manual run does not count)")
        rows += "power save" to if (AutomationEngine.pausedNow()) {
            "on: the weather and place watches are not registered"
        } else {
            "off"
        }
        rows += "weather now" to (AutomationEngine.lastWeather().entries.joinToString("; ") { "${it.key}: ${it.value}" }
            .ifEmpty { "not asked yet" })
        val (firstUnlock, lastUnlock, lastInteraction) = AutomationEngine.interactionReadings()
        rows += "unlock" to ("today's first " + stamp(firstUnlock) + ", last " + stamp(lastUnlock))
        rows += "activity" to ("last " + stamp(lastInteraction))
        val (ticks, lastTick) = AutomationEngine.tickReadings()
        rows += "combo tick" to "$ticks run(s), last " + stamp(lastTick)
        val monitors = AutomationEngine.monitorStates(context)
        val text = buildString {
            append(table(rows))
            append("\nthe ${AutomationRule.WATCH_KINDS.size} watches:\n")
            append(monitors.joinToString("\n") { "  ${it.first}: ${it.second}" })
            if (rules.isNotEmpty()) {
                append("\nthe rules:\n")
                append(
                    rules.joinToString("\n") { rule ->
                        val last = AutomationEngine.lastFiredAt(rule.name)
                        val fired = AutomationEngine.firedTodayCount(rule.name)
                        "  ${rule.name}  ${if (rule.enabled) "on" else "off"}  ${rule.summary()}" +
                            "  (today $fired/${rule.dailyLimit}" +
                            (last?.let { ", last " + SimpleDateFormat("MM-dd HH:mm", Locale.US).format(Date(it)) } ?: "") +
                            ")"
                    },
                )
                // 组合规则缺这一行, "为什么没响"只剩一句"没成立", 看不出是哪个子条件一直没新鲜过
                val combos = rules.filter { it.whenKind in AutomationRule.COMBO_KINDS }
                if (combos.isNotEmpty()) {
                    append("\nthe sub-conditions of the combinations (last time each held):\n")
                    append(
                        combos.joinToString("\n") { rule ->
                            val subs = AutomationEngine.subFreshness(rule.name)
                            val said = subs.joinToString("; ") { one ->
                                "#${one.index + 1} ${one.kind} " + stamp(one.at)
                            }
                            "  ${rule.name}: $said"
                        },
                    )
                }
            }
        }
        return text(text)
    }

    /** 一个时刻读数: 0 就是"还没有" */
    private fun stamp(at: Long): String =
        if (at <= 0L) {
            "never"
        } else {
            SimpleDateFormat("MM-dd HH:mm", Locale.US).format(Date(at))
        }

    private fun history(context: Context, request: JsonObject): JsonObject {
        val limit = request.int("limit", 20)
        val rule = request.stringOrNull("rule")
        val fired = history(context, limit, rule)
        if (fired.isEmpty()) {
            return text(
                "nothing has been decided yet (no line in ${AutomationStore.HISTORY_FILE})." +
                    " If a rule should have fired by now, read op=status: it says which watch is missing" +
                    " or what is holding the rule back",
            )
        }
        return text(fired.joinToString("\n") { "  " + AutomationStore.line(it) })
    }

    /** 名字规范化: 与快捷指令**同一份判据** */
    private fun normalizeName(name: String): String =
        normalizeArtifactName(name, "an automatic command", ".json")
}
