package io.github.yuloong07star.luwi.channel

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 按场景分档校准的多信号路由 ([OcrRoute], 2.8.1 #3)
 *
 * 三档场景各有一组固定样本 (`app/src/test/resources/ocr-route/`), 这里真跑三件事:
 *
 * 1. **场景认得出来**: 文件名前缀就是那一帧该落的档
 * 2. **命中率不低于旧单阈值**: 逐档比 [OcrRoute.Mode.LEGACY] 与 [OcrRoute.Mode.CALIBRATED]
 * 3. **TABLE 是拟合出来的**: 每次重拟合, 与表里的四个数逐项对齐 (差 0.005 以内)
 *
 * 另外顺手量一次 P95 延迟 (这一层是纯函数, 量的是"多信号判一帧"的代价, 不是模型推理的代价) ——
 * 读数在 `docs/Luwi-OCR-分档路由-验收-2026-11-15.md`
 */
class OcrRouteTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun text(name: String): String {
        val stream = javaClass.classLoader.getResourceAsStream("ocr-route/$name")
            ?: error("样本不在 classpath 上: ocr-route/$name")
        return stream.use { it.readBytes().decodeToString() }
    }

    private fun loadFrames(): List<Pair<String, OcrRoute.Frame>> {
        val index = json.parseToJsonElement(text("index.json")).jsonObject["frames"]!!.jsonArray
        return index.map { element ->
            val name = element.jsonPrimitive.content
            val file = json.parseToJsonElement(text(name)).jsonObject
            val screenLong = file["screenLong"]!!.jsonPrimitive.int
            val rows = file["rows"]!!.jsonArray.map { entry ->
                val row = entry.jsonObject
                val box = row["box"]!!.jsonArray.map { it.jsonPrimitive.int }
                OcrRoute.Row(
                    row["text"]!!.jsonPrimitive.content,
                    row["score"]!!.jsonPrimitive.content.toFloat(),
                    box[0], box[1], box[2], box[3],
                )
            }
            val keep = file["rows"]!!.jsonArray.map { it.jsonObject["keep"]!!.jsonPrimitive.content.toBoolean() }
            name to OcrRoute.Frame(screenLong, rows, keep)
        }
    }

    private fun row(text: String, score: Float, w: Int, h: Int, left: Int = 100, top: Int = 100) =
        OcrRoute.Row(text, score, left, top, left + w, top + h)

    @Test
    fun `三档场景各就各位`() {
        for ((name, frame) in loadFrames()) {
            val want = when {
                name.startsWith("dense") -> OcrRoute.Scene.DENSE
                name.startsWith("normal") -> OcrRoute.Scene.NORMAL
                else -> OcrRoute.Scene.LARGE
            }
            val got = OcrRoute.sceneOf(frame.rows, frame.screenLong)
            println("[ocr-route] frame=$name scene=${got.label} rows=${frame.rows.size}")
            assertEquals(name, want, got)
        }
    }

    @Test
    fun `分档路由的命中率不低于旧单阈值`() {
        val frames = loadFrames().map { it.second }
        val calibrated = OcrRoute.measure(frames, OcrRoute.Mode.CALIBRATED)
        val legacy = OcrRoute.measure(frames, OcrRoute.Mode.LEGACY)
        var calibratedSum = OcrRoute.Score()
        var legacySum = OcrRoute.Score()
        for (scene in OcrRoute.Scene.entries) {
            val now = calibrated[scene] ?: OcrRoute.Score()
            val before = legacy[scene] ?: OcrRoute.Score()
            calibratedSum += now
            legacySum += before
            println(
                "[ocr-route] tier=${scene.label} rows=${now.rows} calibrated=%.3f legacy=%.3f"
                    .format(now.accuracy, before.accuracy) +
                    " falseDrop=${now.falseDrop} legacyFalseDrop=${before.falseDrop}" +
                    " falseKeep=${now.falseKeep} legacyFalseKeep=${before.falseKeep}",
            )
            assertTrue(
                "${scene.label}: 分档 ${now.accuracy} 低于旧单阈值 ${before.accuracy}",
                now.accuracy >= before.accuracy,
            )
        }
        println(
            "[ocr-route] overall rows=${calibratedSum.rows} calibrated=%.3f legacy=%.3f"
                .format(calibratedSum.accuracy, legacySum.accuracy),
        )
        assertTrue("总分档命中率不应低于旧单阈值", calibratedSum.accuracy >= legacySum.accuracy)
    }

    @Test
    fun `TABLE 就是拟合出来的那张表`() {
        val fits = OcrRoute.calibrate(loadFrames().map { it.second })
        assertEquals(OcrRoute.Scene.entries.size, fits.size)
        for (fit in fits) {
            println(
                "[ocr-route] fit ${fit.scene.label} tau=%.2f single=%.2f icon=%.2f rescue=%.2f"
                    .format(fit.cutoffs.tau, fit.cutoffs.single, fit.cutoffs.icon, fit.cutoffs.rescue) +
                    " correct=${fit.score.correct}/${fit.score.rows}",
            )
        }
        for (fit in fits) {
            val want = OcrRoute.TABLE.getValue(fit.scene)
            assertEquals("${fit.scene.label} tau", want.tau, fit.cutoffs.tau, 0.005f)
            assertEquals("${fit.scene.label} single", want.single, fit.cutoffs.single, 0.005f)
            assertEquals("${fit.scene.label} icon", want.icon, fit.cutoffs.icon, 0.005f)
            assertEquals("${fit.scene.label} rescue", want.rescue, fit.cutoffs.rescue, 0.005f)
        }
    }

    @Test
    fun `旧阈值那条路与 2_8_0 逐行一致`() {
        val screen = 2400
        val rows = listOf(
            // 0.36 的长行旧路留着; 0.34 的旧路丢 (这就是"抬线先误杀灰字"的那一刀)
            row("已开启深色模式", 0.36f, 460, 38),
            row("对方正在输入…", 0.34f, 380, 44),
            // 单字: 0.9 留, 0.7 丢
            row("我", 0.90f, 40, 44),
            row("C", 0.70f, 80, 40),
            // 图标 (近方小低分) 与只有符号的框都丢
            row("8", 0.60f, 44, 44),
            row(">", 0.97f, 30, 44),
        )
        val verdicts = OcrRoute.route(rows, screen, OcrRoute.Mode.LEGACY).verdicts
        assertEquals(listOf(true, false, true, false, false, false), verdicts.map { it.keep })
        assertEquals(OcrRoute.Reason.LOW_SCORE, verdicts[1].reason)
        assertEquals(OcrRoute.Reason.SINGLE_CHAR, verdicts[3].reason)
        assertEquals(OcrRoute.Reason.ICON, verdicts[4].reason)
        assertEquals(OcrRoute.Reason.SYMBOL, verdicts[5].reason)
    }

    @Test
    fun `分数低但站在一列里的长行被救回来`() {
        val screen = 2400
        // 一列 12sp 的标签, 暗色下整列掉到 0.28~0.31
        val rows = listOf(
            row("深色模式", 0.90f, 240, 38, left = 60, top = 300),
            row("自动调整亮度", 0.27f, 300, 38, left = 60, top = 400),
            row("锁定屏幕", 0.91f, 180, 38, left = 60, top = 500),
            row("关于本机", 0.93f, 180, 38, left = 60, top = 600),
        )
        val decision = OcrRoute.route(rows, screen, OcrRoute.Mode.CALIBRATED)
        assertEquals(OcrRoute.Scene.DENSE, decision.scene)
        assertTrue("同列的长行应当留下", decision.verdicts[1].keep)
        assertEquals(OcrRoute.Reason.RESCUED, decision.verdicts[1].reason)
        // 旧路对同一帧是丢的: 0.27 < 0.35
        assertFalse(OcrRoute.route(rows, screen, OcrRoute.Mode.LEGACY).verdicts[1].keep)
    }

    @Test
    fun `孤零零的低分两字招牌不被救`() {
        val screen = 2400
        val rows = listOf(
            row("开始游戏", 0.97f, 680, 110, left = 200, top = 900),
            row("排行榜", 0.92f, 560, 110, left = 200, top = 2100),
            // 两字、分数低、右侧一块、同列没有邻居
            row("LV", 0.58f, 160, 100, left = 60, top = 400),
        )
        val decision = OcrRoute.route(rows, screen, OcrRoute.Mode.CALIBRATED)
        assertFalse(decision.verdicts[2].keep)
        assertEquals(OcrRoute.Reason.LOW_SCORE, decision.verdicts[2].reason)
    }

    @Test
    fun `多信号判一帧的 P95 延迟`() {
        val frames = loadFrames().map { it.second }
        fun p95(mode: OcrRoute.Mode, rounds: Int): Long {
            repeat(200) { for (frame in frames) OcrRoute.route(frame.rows, frame.screenLong, mode) }
            val samples = LongArray(rounds * frames.size)
            var at = 0
            repeat(rounds) {
                for (frame in frames) {
                    val started = System.nanoTime()
                    OcrRoute.route(frame.rows, frame.screenLong, mode)
                    samples[at++] = System.nanoTime() - started
                }
            }
            samples.sort()
            return samples[(samples.size * 0.95).toInt().coerceAtMost(samples.size - 1)]
        }
        val legacy = p95(OcrRoute.Mode.LEGACY, 2000)
        val calibrated = p95(OcrRoute.Mode.CALIBRATED, 2000)
        println("[ocr-route] p95 legacy=${legacy}ns calibrated=${calibrated}ns per frame")
        // 这一层比模型推理便宜三个数量级; 只兜一个"别慢到离谱"的下限 (5ms 一帧)
        assertTrue("分档路由一帧不该超过 5ms, 实测 ${calibrated}ns", calibrated < 5_000_000)
    }
}
