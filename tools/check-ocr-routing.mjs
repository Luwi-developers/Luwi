/**
 * 端侧 OCR 去留那一步的判据: 按场景分档校准的多信号路由 (2.8.1 #3, 2026-11-15)
 *
 * 这一批改的是"一行字留不留"这件事:
 *
 *   1. 2.8.0 那条**全局单阈值** (`score < MIN_TEXT_SCORE`) 撤掉了, 换成一帧一次的路由: 先按中位
 *      行高认场景 (dense / normal / large), 再用这一档的门槛看分数、字数、形状与同列邻居
 *   2. 分档表不是手调的: `OcrRoute.calibrate` 在三档固定样本上拟合, `OcrRouteTest` 每次重拟合
 *      并断言与 `OcrRoute.TABLE` 一致 —— 这里只核"表在、三档齐、rescue 严格低于 tau"
 *   3. **旧阈值那条路整条留着** (`Mode.LEGACY`), 桥上一次请求带 `route=legacy` 或 `minScore` 就退
 *      回去, 不需要重装 APK
 *   4. 固定样本三档各至少一帧、每帧都既有该留的也有该丢的 (只留或只丢的样本量不出误丢/误留)
 *
 * 真机读数与 P95 在 `docs/Luwi-OCR-routing-acceptance-2026-11-15.md`, 这里只判代码形状与样本形状
 *
 * 跑法: node tools/check-ocr-routing.mjs
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const ocr = await read('app/src/main/java/io/github/yuloong07star/luwi/channel/LwOcr.kt')
const route = await read('app/src/main/java/io/github/yuloong07star/luwi/channel/OcrRoute.kt')
const bridge = await read('app/src/main/java/io/github/yuloong07star/luwi/channel/PrivilegedBridge.kt')
const plugin = await read('host-plugin/index.mjs')
const test = await read('app/src/test/java/io/github/yuloong07star/luwi/channel/OcrRouteTest.kt')
const note = await read('docs/Luwi-OCR-routing-acceptance-2026-11-15.md')
const index = JSON.parse(await read('app/src/test/resources/ocr-route/index.json'))

let failures = 0
let checks = 0
function check(name, got, want) {
  checks += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  if (!same) failures += 1
  console.log(
    `${same ? 'ok  ' : 'FAIL'} ${name}`
      + (same ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`),
  )
}

/* ── 一、单阈值那条判据链从识别循环里撤掉了 ───────────────────────────── */

check('LwOcr 里不再有"分数低于分数线就 continue"', [
  /if \(score < minScore\) continue/u.test(ocr),
  /if \(text\.length == 1 && score < SINGLE_CHARACTER_SCORE\) continue/u.test(ocr),
], [false, false])

check('LwOcr 把整帧交给 OcrRoute 判一次 (不再逐行判)', [
  /val decision = OcrRoute\.route\(candidates, screenLong, route, minScore\)/u.test(ocr),
  /verdict\.reason == OcrRoute\.Reason\.ICON \|\| verdict\.reason == OcrRoute\.Reason\.SYMBOL/u.test(ocr),
], [true, true])

check('Outcome 带出这一帧的场景与走的路 (真机读数要用)', [
  /val scene: String = ""/u.test(ocr),
  /val route: String = ""/u.test(ocr),
  /scene = decision\.scene\.label/u.test(ocr),
  /route = decision\.mode\.label/u.test(ocr),
], [true, true, true, true])

/* ── 二、三档、四信号、分档表 ─────────────────────────────────────────── */

check('三档场景齐全且各有自己的标签', [
  /enum class Scene\(val label: String\)/u.test(route),
  [...route.matchAll(/Scene\.(DENSE|NORMAL|LARGE) to Cutoffs\(/gu)].map((m) => m[1]),
], [true, ['DENSE', 'NORMAL', 'LARGE']])

check('档位按中位行高比切 (不按分数, 分数会随主题整片挪)', [
  /const val DENSE_UP_TO = 0\.017f/u.test(route),
  /const val LARGE_FROM = 0\.030f/u.test(route),
  /ratios\[ratios\.size \/ 2\]/u.test(route),
], [true, true, true])

const table = [
  ...route.matchAll(
    /Scene\.(DENSE|NORMAL|LARGE) to Cutoffs\(tau = ([\d.]+)f, single = ([\d.]+)f, icon = ([\d.]+)f, rescue = ([\d.]+)f\)/gu,
  ),
].map((m) => ({ scene: m[1], tau: Number(m[2]), single: Number(m[3]), icon: Number(m[4]), rescue: Number(m[5]) }))

check('分档表里的每一档都给了四个数', table.map((row) => row.scene), ['DENSE', 'NORMAL', 'LARGE'])
check('每一档的 rescue 都严格低于 tau (相等等于没有救人的口子)', [
  table.every((row) => row.rescue < row.tau),
  table.every((row) => row.tau > 0.35),
], [true, true])

check('多信号齐: 分数 / 字数 / 形状 / 同列邻居', [
  /row\.score >= cutoffs\.tau/u.test(route),
  /row\.characters >= 3/u.test(route),
  /OcrBoxes\.isIconLike\(row\.width, row\.height, row\.score, screenLong, cutoffs\.icon\)/u.test(route),
  /aligned >= 2/u.test(route),
  /Math\.abs|abs\(a\.left - b\.left\)/u.test(route),
], [true, true, true, true, true])

check('校准是在固定样本上拟合的, 不是手填的', [
  /fun calibrate\(frames: List<Frame>\): List<Fit>/u.test(route),
  /TAU_STEPS/u.test(route) && /SINGLE_STEPS/u.test(route) && /ICON_STEPS/u.test(route) && /RESCUE_STEPS/u.test(route),
  /sum\.objective >= bestScore\.objective/u.test(route),
], [true, true, true])

/* ── 三、旧阈值开关留着 ───────────────────────────────────────────────── */

check('2.8.0 那条判据链原样留在 LEGACY 里', [
  /enum class Mode\(val label: String\) \{[\s\S]*LEGACY\("legacy"\)/u.test(route),
  /private fun legacy\(row: Row, screenLong: Int, minScore: Float\): Verdict = when \{/u.test(route),
  /row\.score < minScore -> Verdict\(false, Reason\.LOW_SCORE\)/u.test(route),
  /const val LEGACY_MIN_SCORE = 0\.35f/u.test(route),
  /const val LEGACY_SINGLE = 0\.75f/u.test(route),
], [true, true, true, true, true])

check('桥上一次请求就能退回旧阈值 (带 route=legacy 或 minScore)', [
  /request\["route"\]\?\.jsonPrimitive\?\.contentOrNull\?\.equals\("legacy", true\) == true/u.test(bridge),
  /legacy \|\| !minScore\.isNaN\(\) -> LwOcr\.recognize\(/u.test(bridge),
  /OcrRoute\.Mode\.LEGACY,/u.test(bridge),
], [true, true, true])

check('插件把回退开关写进参数表 (模型自己也能退)', [
  /enum: \['calibrated', 'legacy'\]/u.test(plugin),
], [true])

/* ── 四、固定样本: 三档齐全, 每帧两边都有 ─────────────────────────────── */

const frames = []
for (const name of index.frames) {
  const frame = JSON.parse(await read(`app/src/test/resources/ocr-route/${name}`))
  frames.push({ name, ...frame })
}

check('样本至少三帧且 index 与文件一一对应', [
  frames.length >= 3,
  frames.length === index.frames.length,
], [true, true])

const tiers = { dense: 0, normal: 0, large: 0 }
for (const frame of frames) {
  const tier = frame.name.startsWith('dense') ? 'dense' : frame.name.startsWith('normal') ? 'normal' : 'large'
  tiers[tier] += 1
}
check('三档各至少一帧', tiers, { dense: 2, normal: 2, large: 1 })

check('每帧都既有该留的也有该丢的 (只留或只丢量不出误丢/误留)', [
  frames.every((frame) => frame.rows.filter((row) => row.keep === true).length >= 3),
  frames.every((frame) => frame.rows.filter((row) => row.keep === false).length >= 1),
], [true, true])

check('每一行的分数、框、字数都成立', [
  frames.every((frame) => frame.rows.every((row) => row.score > 0 && row.score <= 1)),
  frames.every((frame) => frame.rows.every((row) => {
    const [left, top, right, bottom] = row.box
    return right > left && bottom > top && left >= 0 && top >= 0
  })),
  frames.every((frame) => frame.rows.every((row) => typeof row.text === 'string' && row.text.length > 0)),
  frames.reduce((sum, frame) => sum + frame.rows.length, 0) >= 60,
], [true, true, true, true])

check('测试真的在跑三件事: 命中率 / 重拟合 / P95', [
  /calibrated\.accuracy >= legacy\.accuracy|now\.accuracy >= before\.accuracy/u.test(test),
  /OcrRoute\.calibrate\(loadFrames\(\)/u.test(test),
  /\[ocr-route\] p95/u.test(test),
], [true, true, true])

/* ── 五、验收 note 的读数是真的落下去了 ───────────────────────────────── */

check('验收 note 记了逐档命中率与旧基线', [
  /tier=dense rows=37 calibrated=1\.000 legacy=0\.784/u.test(note),
  /tier=normal rows=35 calibrated=1\.000 legacy=0\.886/u.test(note),
  /tier=large rows=14 calibrated=1\.000 legacy=0\.929/u.test(note),
  /overall rows=86 calibrated=1\.000 legacy=0\.849/u.test(note),
], [true, true, true, true])

check('验收 note 记了 P95 延迟对比', [
  /p95/u.test(note),
  /legacy=1[0-9]{3}ns/u.test(note),
  /calibrated=4[0-9]{3}ns/u.test(note),
], [true, true, true])

check('验收 note 写了回退开关与真机待读数', [
  /route=legacy/u.test(note),
  /待编排侧读数/u.test(note),
], [true, true])

/* ── 收尾 ─────────────────────────────────────────────────────────────── */

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exitCode = failures === 0 ? 0 : 1
