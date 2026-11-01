/**
 * 端侧 OCR 的 NPU 判定与耗时口径的判据 (2026-10-29)
 *
 * 这一批改的是几件"界面上看不出来"的事:
 *
 *   1. `disable_cpu_ep_fallback` 以前挂在 `if (!jit)` 下面, 而两条路都是 `jit = true` 建的 ——
 *      那个"一个算子都不许落 CPU"的保险丝从来没合上过, 于是 `backend = NPU` 只说明 QNN EP 被
 *      收下, 天玑机上实际全在 CPU。现在的形状必须是"strict 那一轮无条件打开, 被拒再退混跑"
 *   2. 有没有 Hexagon 用 `/dev/adsprpc-smd` 判, 不用 `Build.SOC_MODEL` 那串给人看的字
 *   3. 性能票是 burst -> high_performance -> default 的阶梯, strict 是 true -> false 的两轮
 *   4. `recMs` 是识别总时间, 插件里不能再写 "per line" (33 行的 330ms 会被说成 10ms)
 *
 * 这些都不需要设备: 代码形状错了就是错了, 真机只负责量数字
 *
 * 跑法: node tools/check-ocr-npu.mjs
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const ocr = await readFile(
  new URL('app/src/main/java/io/github/yuloong07star/luwi/channel/LwOcr.kt', root),
  'utf8',
)
const settings = await readFile(
  new URL('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt', root),
  'utf8',
)
const plugin = await readFile(new URL('host-plugin/index.mjs', root), 'utf8')

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

/** 从 `val X = listOf(...)` 里把字面量按声明顺序取出来 */
function listOf(source, name) {
  const at = source.indexOf(`val ${name}`)
  if (at < 0) return null
  const body = source.slice(at, source.indexOf('\n', at))
  return [...body.matchAll(/"([a-z_]+)"/gu)].map((m) => m[1])
}

/* ── 一、strict 保险丝真的合上 ─────────────────────────────────────────── */

check('strict 开关的判据是 `!jit || strict` (不再只看 jit)', [
  /if \(!jit \|\| strict\) \{/u.test(ocr),
  /options\.addConfigEntry\("session\.disable_cpu_ep_fallback", "1"\)/u.test(ocr),
], [true, true])

check('保险丝在 strict 分支里, 不在 `if (!jit)` 里', [
  /if \(!jit\) \{\s*\n\s*options\.addConfigEntry\("session\.disable_cpu_ep_fallback"/u.test(ocr),
], [false])

/* ── 二、Hexagon 用设备节点判 ─────────────────────────────────────────── */

check('FASTRPC 是 /dev/adsprpc-smd, 并有一次真实的存在性检查', [
  /private const val FASTRPC = "\/dev\/adsprpc-smd"/u.test(ocr),
  /File\(FASTRPC\)\.exists\(\)/u.test(ocr),
  /if \(mode != "cpu" && hexagon\)/u.test(ocr),
], [true, true, true])

/* ── 三、两条阶梯的顺序 ───────────────────────────────────────────────── */

check('性能票阶梯 burst -> high_performance -> default', [
  listOf(ocr, 'PERF_LADDER'),
], [['burst', 'high_performance', 'default']])

check('strict 两轮是 true -> false (先严格后混跑)', [
  /val STRICT_TRIES = listOf\(true, false\)/u.test(ocr),
], [true])

/* ── 四、贴着界面的两样 ───────────────────────────────────────────────── */

check('isStrictNpu 是公开方法, 设置页拿它决定标不标混跑', [
  /fun isStrictNpu\(\): Boolean = npuStrict/u.test(ocr),
  /LwOcr\.isStrictNpu\(\)/u.test(settings),
  /R\.string\.settings_ocr_mixed/u.test(settings),
], [true, true, true])

check('probe 把 strict 与 fastrpc 一起报出来', [
  /put\("strict", npuStrict\)/u.test(ocr),
  /put\("fastrpc", hasFastRpc\(\)\)/u.test(ocr),
], [true, true])

/* ── 五、recMs 是总时间, 文案不再说 per line ──────────────────────────── */

check('recMs 不再按调用次数摊平', [
  /recTotalMs \/ calls/u.test(ocr),
], [false])

check('插件按总时间 + 调用次数说', [
  /per line/u.test(plugin.slice(plugin.indexOf('function formatOcr'), plugin.indexOf('function formatOcr') + 1200)),
  /result\.recCalls/u.test(plugin),
], [false, true])

/* ── 收尾 ─────────────────────────────────────────────────────────────── */

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exitCode = failures === 0 ? 0 : 1
