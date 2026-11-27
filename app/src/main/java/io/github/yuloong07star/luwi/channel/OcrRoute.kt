package io.github.yuloong07star.luwi.channel

import kotlin.math.abs

/**
 * 一行 OCR 结果的去留: 按场景分档校准的多信号路由 (2.8.1 #3)
 *
 * 以前这一件事由一个数说了算: `score < MIN_TEXT_SCORE (0.35)` 就丢。那条线是**全局**的, 于是同一
 * 条线要同时服务三种屏: 设置页里 12sp 的小字 (分数普遍偏低, 抬线先误杀暗色正文)、聊天列表里的
 * 常规正文、游戏 HUD 里 40sp 的大字 (分数天生高, 那条线对它形同虚设)。结果是"抬线就丢字, 不抬就
 * 混进图标", 而这两件事只能挑一件
 *
 * 这里换成三步:
 *
 * 1. **认场景**: 看这一帧里**中位行高占屏长边的比例** —— 12sp 的密集小字远小于 40sp 的大字, 这个
 *    量比分数的分布稳 (分数会随主题、对比度、字体粗细整片移动, 字号不会)。三档: [Scene.DENSE] /
 *    [Scene.NORMAL] / [Scene.LARGE]
 * 2. **多信号**: 一行去留同时看五件事 —— 分数、字数、框的形状 (近方 / 宽扁)、框相对屏的尺寸、以及
 *    **同列邻居** (同一列上下还有几条同尺寸的行)。分数只是其中一个, 而且只在"它这一档的"尺子上比
 * 3. **分档校准**: 每档的四个门槛 ([Cutoffs] 的 tau / single / icon / rescue) 不是手调的, 是
 *    [calibrate] 在一组固定样本上拟合出来的 (拟合结果见 [TABLE], 读数见
 *    `docs/Luwi-OCR-分档路由-验收-2026-11-15.md`)
 *
 * 为什么要"同列邻居"这条信号: 暗色主题下正文与值的分数会整片掉到 0.3 上下 (代码里那条"抬分数线会
 * 先误杀夜里的灰字"就是这件事), 而它们的位置很整齐 —— 一列标签左对齐、右边一列值左对齐、行高一致。
 * 分数低但**站在一列里、字数够多、行高与同屏中位数一致**的行是正文; 分数低、字数一两个、形状近方
 * 或特别小的框是图标。只用分数分不开这两类, 加上位置与形状就分开了
 *
 * **旧阈值那条路完整保留** ([Mode.LEGACY]): 判据链与 2.8.0 逐行一致 (图标 -> 只有符号 ->
 * `score < minScore` -> 单字), 桥上一次请求带 `route=legacy` 或者带 `minScore` 就整条退回它, 不需要
 * 重装 APK。这是"分档路由出事就把那根旧线接回去"的那颗开关
 *
 * 全部是纯函数, 不碰模型也不碰设备, 所以能拿固定样本在 JVM 上真跑 (见 `OcrRouteTest`)
 */
object OcrRoute {

    /** 一档场景, 按这一帧里文字的中位行高 (除以屏长边) 分 */
    enum class Scene(val label: String) {
        /** 设置页 / 对话框: 12~14sp 的小字, 图标多, 暗色主题下分数整片偏低 */
        DENSE("dense"),

        /** 列表 / 聊天 / 常规正文: 16~20sp */
        NORMAL("normal"),

        /** 大标题 / 游戏 HUD / 大按钮: 24sp 以上, 分数天生高 */
        LARGE("large"),
    }

    /** 走哪条路: 分档路由, 还是 2.8.0 那根单阈值 */
    enum class Mode(val label: String) {
        CALIBRATED("calibrated"),
        LEGACY("legacy"),
    }

    /** 一行最后为什么留下 / 为什么丢掉 */
    enum class Reason {
        KEPT,
        /** 分数在本档 tau 之下, 但同列同字号的行都在, 且字数够多 */
        RESCUED,
        ICON,
        SYMBOL,
        BLANK,
        LOW_SCORE,
        SINGLE_CHAR,
    }

    /** 一行认出来的东西, 坐标是那块屏自己的像素 (与 `LwOcr.Line` 同形, 这里留一份是为了不碰 Android) */
    data class Row(
        val text: String,
        val score: Float,
        val left: Int,
        val top: Int,
        val right: Int,
        val bottom: Int,
    ) {
        val width: Int get() = right - left
        val height: Int get() = bottom - top

        /** 字数按**码点**算: "微信" 是 2, 而一个表情也是 1, 用 `length` 会把它算成 2 */
        val characters: Int get() = text.codePointCount(0, text.length)
    }

    /**
     * 一档场景的四个门槛
     *
     * @param tau 多字行的分数线
     * @param single 单字行的分数线 (图标被认成单个字时分数在 0.5~0.8, 真有意义的单字在 0.9 上下)
     * @param icon 近方小框算图标的分数上限 (形状与尺寸由 `OcrBoxes.isIconLike` 判)
     * @param rescue 分数低于 [tau] 时还能靠"同列邻居 + 字数 + 同字号"救回来的下限
     */
    data class Cutoffs(val tau: Float, val single: Float, val icon: Float, val rescue: Float)

    /**
     * 拟合出来的分档表
     *
     * 这张表由 [calibrate] 在 `app/src/test/resources/ocr-route/` 的三档固定样本上跑出来,
     * `OcrRouteTest` 每次都会重拟合一遍并断言与这里逐档一致 (差 0.005 以内) —— 手改这张表会让
     * 那一条判据当场红, 想改就先重拟合
     */
    val TABLE: Map<Scene, Cutoffs> = mapOf(
        Scene.DENSE to Cutoffs(tau = 0.66f, single = 0.90f, icon = 0.85f, rescue = 0.26f),
        Scene.NORMAL to Cutoffs(tau = 0.68f, single = 0.90f, icon = 0.85f, rescue = 0.30f),
        Scene.LARGE to Cutoffs(tau = 0.66f, single = 0.90f, icon = 0.85f, rescue = 0.62f),
    )

    /** 中位行高比低于它算密集小字 */
    const val DENSE_UP_TO = 0.017f

    /** 中位行高比到了它算大字 */
    const val LARGE_FROM = 0.030f

    /** 2.8.0 那根线: 与 `LwOcr.MIN_TEXT_SCORE` 同一个数, 这里是它的出处 */
    const val LEGACY_MIN_SCORE = 0.35f

    /** 2.8.0 那条单字线 */
    const val LEGACY_SINGLE = 0.75f

    /** 同列判据: 左边缘差不超过屏长边的这个比例 (1080x2400 上约 48px) */
    private const val COLUMN_LEFT = 0.02f

    /** 同列判据: 两行高度比在 [1/COLUMN_HEIGHT, COLUMN_HEIGHT] 之内 */
    private const val COLUMN_HEIGHT = 1.4f

    /** 救回来的那一行, 行高要落在同屏中位数的这个范围内 */
    private const val RESCUE_HEIGHT_LOW = 0.7f
    private const val RESCUE_HEIGHT_HIGH = 1.6f

    /** 校准网格: tau / single / icon / rescue 的步长与范围 (icon 上限 0.90: 再高就把真符号也当图标) */
    private val TAU_STEPS = steps(0.20f, 0.98f, 0.02f)
    private val SINGLE_STEPS = steps(0.60f, 0.95f, 0.05f)
    private val ICON_STEPS = steps(0.70f, 0.90f, 0.05f)
    private val RESCUE_STEPS = steps(0.18f, 0.98f, 0.04f)

    private fun steps(from: Float, to: Float, by: Float): FloatArray {
        val count = ((to - from) / by).toInt() + 1
        return FloatArray(count) { from + it * by }
    }

    /**
     * 这一帧属于哪一档
     *
     * 中位数而不是平均数: 一屏里往往一两行大标题混着十几行小字, 平均数会被那两行拽走, 中位数不会
     */
    fun sceneOf(rows: List<Row>, screenLong: Int): Scene {
        if (rows.isEmpty() || screenLong <= 0) return Scene.NORMAL
        val ratios = FloatArray(rows.size) { rows[it].height.toFloat() / screenLong }
        ratios.sort()
        val median = ratios[ratios.size / 2]
        return when {
            median < DENSE_UP_TO -> Scene.DENSE
            median >= LARGE_FROM -> Scene.LARGE
            else -> Scene.NORMAL
        }
    }

    /** 这一档的门槛 */
    fun cutoffsOf(scene: Scene): Cutoffs = TABLE[scene] ?: TABLE.getValue(Scene.NORMAL)

    /** 一行的判决 */
    data class Verdict(val keep: Boolean, val reason: Reason)

    /** 一帧的判决结果 */
    data class Decision(val scene: Scene, val mode: Mode, val verdicts: List<Verdict>)

    /**
     * 这一帧里哪些行留、哪些丢
     *
     * @param mode [Mode.LEGACY] 时整条走 2.8.0 的老路 (只看 [minScore] 与单字线), 不看场景也不看邻居
     * @param minScore 老路用的那条线; 桥上一次请求带 `minScore` 就退到老路并改用它
     */
    fun route(
        rows: List<Row>,
        screenLong: Int,
        mode: Mode = Mode.CALIBRATED,
        minScore: Float = LEGACY_MIN_SCORE,
    ): Decision {
        val scene = sceneOf(rows, screenLong)
        if (mode == Mode.LEGACY) {
            return Decision(scene, Mode.LEGACY, rows.map { legacy(it, screenLong, minScore) })
        }
        if (rows.isEmpty()) return Decision(scene, Mode.CALIBRATED, emptyList())
        return Decision(scene, Mode.CALIBRATED, decide(rows, screenLong, cutoffsOf(scene)))
    }

    /** 按给定的一档门槛判一整帧 (校准与测试拿它复现某一组门槛的结果) */
    fun decide(rows: List<Row>, screenLong: Int, cutoffs: Cutoffs): List<Verdict> {
        if (rows.isEmpty()) return emptyList()
        val median = medianHeight(rows)
        val aligned = alignedCounts(rows, screenLong)
        return rows.mapIndexed { index, row ->
            calibrated(row, cutoffs, screenLong, median, aligned[index])
        }
    }

    /** 2.8.0 的判据链, 一行不改: 图标 / 只有符号 -> 分数线 -> 单字 */
    private fun legacy(row: Row, screenLong: Int, minScore: Float): Verdict = when {
        row.text.isBlank() -> Verdict(false, Reason.BLANK)
        OcrBoxes.isIconLike(row.width, row.height, row.score, screenLong) -> Verdict(false, Reason.ICON)
        OcrBoxes.isSymbolOnly(row.text) -> Verdict(false, Reason.SYMBOL)
        row.score < minScore -> Verdict(false, Reason.LOW_SCORE)
        row.characters == 1 && row.score < LEGACY_SINGLE -> Verdict(false, Reason.SINGLE_CHAR)
        else -> Verdict(true, Reason.KEPT)
    }

    /**
     * 分档 + 多信号
     *
     * 顺序是有讲究的: 形状与"只有符号"先判 (它们与分数无关, 分数再高也是图标), 然后单字与多字分成
     * 两条线, 多字那条才允许"同列邻居"把它捞回来
     */
    private fun calibrated(
        row: Row,
        cutoffs: Cutoffs,
        screenLong: Int,
        median: Float,
        aligned: Int,
    ): Verdict {
        if (row.text.isBlank()) return Verdict(false, Reason.BLANK)
        if (OcrBoxes.isSymbolOnly(row.text)) return Verdict(false, Reason.SYMBOL)
        // 图标永远只有一两个字; 四五个字的框再方也不当图标 (那是"确定"这类按钮)
        val icon = OcrBoxes.isIconLike(row.width, row.height, row.score, screenLong, cutoffs.icon)
        if (icon && row.characters <= 2) return Verdict(false, Reason.ICON)
        if (row.characters == 1) {
            return if (row.score >= cutoffs.single) Verdict(true, Reason.KEPT) else Verdict(false, Reason.SINGLE_CHAR)
        }
        if (row.score >= cutoffs.tau) return Verdict(true, Reason.KEPT)
        val sameScale = median <= 0f ||
            (row.height >= median * RESCUE_HEIGHT_LOW && row.height <= median * RESCUE_HEIGHT_HIGH)
        if (row.score >= cutoffs.rescue && row.characters >= 3 && aligned >= 2 && sameScale) {
            return Verdict(true, Reason.RESCUED)
        }
        return Verdict(false, Reason.LOW_SCORE)
    }

    /** 同屏行高的中位数 (像素) */
    private fun medianHeight(rows: List<Row>): Float {
        if (rows.isEmpty()) return 0f
        val heights = FloatArray(rows.size) { rows[it].height.toFloat() }
        heights.sort()
        return heights[heights.size / 2]
    }

    /**
     * 每一行"同列里还有几条"
     *
     * 同列 = **左边缘对齐** + 行高相近。左边缘是这一版才改成主判据的: 原来按"水平重叠占一半",
     * 而宽的气泡 / 提示行会与左边那一列短行整片重叠, 于是随便一句居中的话都算"站成一列" —— 救回来
     * 的门槛就形同虚设 (2026-11-15 判据里红过一次)
     */
    private fun alignedCounts(rows: List<Row>, screenLong: Int): IntArray {
        val counts = IntArray(rows.size)
        if (rows.size < 2) return counts
        val tolerance = maxOf(4f, screenLong * COLUMN_LEFT)
        for (i in rows.indices) {
            val a = rows[i]
            if (a.height <= 0) continue
            for (j in rows.indices) {
                if (i == j) continue
                val b = rows[j]
                if (b.height <= 0) continue
                if (abs(a.left - b.left) > tolerance) continue
                val ratio = b.height.toFloat() / a.height
                if (ratio < 1f / COLUMN_HEIGHT || ratio > COLUMN_HEIGHT) continue
                counts[i] += 1
            }
        }
        return counts
    }

    /* ── 固定样本上的命中率与校准 ─────────────────────────────────────────── */

    /** 一帧标好的样本: 屏长边 + 行 + 每一行"应该留还是丢" */
    data class Frame(val screenLong: Int, val rows: List<Row>, val truth: List<Boolean>)

    /** 命中 / 误留 / 误丢的账 */
    data class Score(
        val rows: Int = 0,
        val trueKeep: Int = 0,
        val falseKeep: Int = 0,
        val falseDrop: Int = 0,
        val trueDrop: Int = 0,
    ) {
        val correct: Int get() = trueKeep + trueDrop
        val accuracy: Float get() = if (rows <= 0) 1f else correct.toFloat() / rows

        /**
         * 拟合用的分数: **误丢记两分**
         *
         * 命中率把"漏一行真字"与"多留一个图标"当同一件事, 而它们不是: 漏掉的那行是模型读不到那颗
         * 按钮, 多留的那行只是噪音。所以拟合按这份账挑门槛, 命中率只用来对外报数
         */
        val objective: Int get() = trueKeep * 2 + trueDrop - falseKeep

        operator fun plus(other: Score) = Score(
            rows + other.rows,
            trueKeep + other.trueKeep,
            falseKeep + other.falseKeep,
            falseDrop + other.falseDrop,
            trueDrop + other.trueDrop,
        )
    }

    /** 一帧一次路由要用的、与门槛无关的那些量: 场景 / 中位行高 / 同列条数 */
    private class Prepared(
        val screenLong: Int,
        val rows: List<Row>,
        val truth: List<Boolean>,
        val scene: Scene,
        val median: Float,
        val aligned: IntArray,
    )

    private fun prepare(frames: List<Frame>): List<Prepared> = frames.map { frame ->
        Prepared(
            frame.screenLong,
            frame.rows,
            frame.truth,
            sceneOf(frame.rows, frame.screenLong),
            medianHeight(frame.rows),
            alignedCounts(frame.rows, frame.screenLong),
        )
    }

    /** 一组固定样本上的命中率, 按场景分开报 */
    fun measure(
        frames: List<Frame>,
        mode: Mode,
        table: Map<Scene, Cutoffs> = TABLE,
        minScore: Float = LEGACY_MIN_SCORE,
    ): Map<Scene, Score> {
        val out = LinkedHashMap<Scene, Score>()
        for (prepared in prepare(frames)) {
            val cutoffs = table[prepared.scene] ?: cutoffsOf(prepared.scene)
            out[prepared.scene] = (out[prepared.scene] ?: Score()) + score(prepared, mode, cutoffs, minScore)
        }
        return out
    }

    private fun score(
        prepared: Prepared,
        mode: Mode,
        cutoffs: Cutoffs,
        minScore: Float,
    ): Score {
        var trueKeep = 0
        var falseKeep = 0
        var falseDrop = 0
        var trueDrop = 0
        for (index in prepared.rows.indices) {
            val row = prepared.rows[index]
            val verdict = if (mode == Mode.LEGACY) {
                legacy(row, prepared.screenLong, minScore)
            } else {
                calibrated(
                    row,
                    cutoffs,
                    prepared.screenLong,
                    prepared.median,
                    prepared.aligned[index],
                )
            }
            val truth = prepared.truth[index]
            if (verdict.keep && truth) trueKeep++ else if (verdict.keep) falseKeep++
            else if (truth) falseDrop++ else trueDrop++
        }
        return Score(prepared.rows.size, trueKeep, falseKeep, falseDrop, trueDrop)
    }

    /** 拟合过程报出来的一档: 选中的门槛与它在这档样本上的账 */
    data class Fit(val scene: Scene, val cutoffs: Cutoffs, val score: Score)

    /**
     * 在固定样本上拟合每一档的门槛
     *
     * 扫的是四维网格 (tau / single / icon / rescue), 取**这档 [Score.objective] 最高**的那一组
     * (误丢记两分); 并列时取更严格的那一组 (更大的 tau / single / icon) —— 样本上是平手, 到了真机上
     * 严格的更不容易放进垃圾
     *
     * 场景是按 [sceneOf] 认出来的, 不是样本自己声明的: 认错档就是认错档, 这一步也一起量了
     */
    fun calibrate(frames: List<Frame>): List<Fit> {
        val prepared = prepare(frames)
        val out = ArrayList<Fit>(Scene.entries.size)
        for (scene in Scene.entries) {
            val subset = prepared.filter { it.scene == scene }
            if (subset.isEmpty()) continue
            var best: Cutoffs? = null
            var bestScore: Score? = null
            for (tau in TAU_STEPS) {
                for (single in SINGLE_STEPS) {
                    for (icon in ICON_STEPS) {
                        for (rescue in RESCUE_STEPS) {
                            // rescue 必须严格低于 tau: 相等的那一档等于"没有救人的口子"
                            if (rescue >= tau) continue
                            val cutoffs = Cutoffs(tau, single, icon, rescue)
                            var sum = Score()
                            for (frame in subset) sum += score(frame, Mode.CALIBRATED, cutoffs, LEGACY_MIN_SCORE)
                            // 并列时后面的 (更严格的) 胜出: 网格是升序扫的, 用 >= 就够了
                            if (bestScore == null || sum.objective >= bestScore.objective) {
                                best = cutoffs
                                bestScore = sum
                            }
                        }
                    }
                }
            }
            if (best != null && bestScore != null) out.add(Fit(scene, best, bestScore))
        }
        return out
    }
}
