/**
 * 提交前置闸: 没有真机 / 模拟器读数就不许提交 (2.8.0 #30)
 *
 * 口径是项目定的测试环境四档 (2026-11-03 管理员定):
 *   档 1 行为类    [测试环境] 真机 - <型号> / Android <版本>   或   [测试环境] 模拟器 - Android <版本>
 *   档 2 非行为类  [测试环境] 无需设备 - 逻辑簇   (还要写一行 改动: 只动 tools/ docs/ *.md, 判据 x/x 与单测通过数)
 *   档 3 缺能力    [测试环境] 真机 - <型号> / Android <版本>(缺 <能力>: <原因>)   算有效, 标「待真机复验」
 *   档 4 完全无设备   没有可用标注行 -> 退出 3
 *
 * 输入是一份 Markdown: 每个 `## <项名>` 是一簇, 项名就是缺项时点出来的那个名字
 * 每簇要有一行 [测试环境] 与至少一条实测结果 (截图 / logcat / 判据 x-x / 单测通过数);
 * 「只有标注行没有结果」也算缺, 档 2 另外要能看出判据与单测两个数
 *
 * 用法: node tools/check-device-evidence.mjs <证据文件.md> [--json]
 *       node tools/check-device-evidence.mjs        (不带文件 = 跑两份夹具自测)
 * 退出码: 0 = 每一项都有可用读数 (自测 = 两份夹具都对); 3 = 有缺项, 提交闸拦下; 2 = 用法 / 读文件失败
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF_DIR = fileURLToPath(new URL('.', import.meta.url))
const FIXTURE_DIR = join(SELF_DIR, 'fixtures', 'device-evidence')

/* ── 四档的标注行 ─────────────────────────────────────────────────────────── */

/** 档 2 唯一那一句 */
const TIER2 = /^无需设备\s*-\s*逻辑簇$/
/** 档 1 / 档 3 的真机: 型号不能省, 版本要带 Android */
const DEVICE = /^真机\s*-\s*(.+?)\s*\/\s*Android\s*([0-9.]+)\s*(.*)$/
/** 档 1 的模拟器: 名字可省, 版本要带 Android */
const EMULATOR = /^模拟器\s*-\s*(?:.+?\/\s*)?Android\s*([0-9.]+)\s*(.*)$/
/** 档 3 的尾巴: 缺什么 + 一句原因, 后面可带「待真机复验」 */
const CAPABILITY = /^[（(]\s*缺\s*(.+?)[：:]\s*(.+?)[）)]\s*(?:→\s*待真机复验)?$/

/** 档 2 只认这几个落点, 其余一律按行为类算 (fail-closed) */
const NON_BEHAVIOR = /^(?:tools[\\/]|docs[\\/]|\.github[\\/])/i

/** 一条实测结果的四种形状 (一行算一条, 命中多种也只算这一行) */
const READING_TOKENS = [
  { what: '截图', test: (line) => /(?:shots[\\/][^\s()（）]+|[^\s()（）]+\.png)\b/i.test(line) },
  { what: 'logcat', test: (line) => /logcat[^\n]*[:：]\s*\S|logs[\\/]device[\\/][^\s()（）]+/i.test(line) },
  { what: '判据 x/x', test: (line) => /\b\d{1,4}\s*\/\s*\d{1,4}\b/.test(line) },
  { what: '单测通过数', test: (line) => /\b\d+\s*(?:个\s*)?(?:测试|用例|通过|passed)/i.test(line) },
]

/* ── 解析一份证据文件 ─────────────────────────────────────────────────────── */

/** 每个 `## <项名>` 到下一个 `##` 之前, 算一簇 */
function parseItems(text) {
  const items = []
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(raw)
    if (heading) {
      current = { name: heading[1], lines: [] }
      items.push(current)
      continue
    }
    if (current) current.lines.push(raw)
  }
  return items
}

/** 档 2 之外的落点都按行为类算, 只放过 tools/ docs/ .github/ 与 *.md */
function isBehavior(path) {
  if (NON_BEHAVIOR.test(path)) return false
  return !/\.md$/i.test(path)
}

function evaluateItem(item) {
  const problems = []
  const annotations = []
  const changedPaths = []
  const readings = []

  for (const raw of item.lines) {
    const line = raw.trim()
    if (!line) continue
    const annotation = /^[-*·]?\s*\[测试环境\]\s*(.*)$/.exec(line)
    if (annotation) {
      annotations.push(annotation[1].trim())
      continue
    }
    const change = /^[-*·]?\s*改动\s*[:：]\s*(.*)$/.exec(line)
    if (change) {
      changedPaths.push(...change[1].split(/[,，\s]+/).filter(Boolean))
      continue
    }
    const tokens = READING_TOKENS.filter((token) => token.test(line)).map((token) => token.what)
    if (tokens.length > 0) readings.push({ line, tokens })
  }

  let tier = 0
  let pending = false
  let annotation = ''
  if (annotations.length === 0) {
    problems.push('缺 [测试环境] 标注行')
  } else if (annotations.length > 1) {
    problems.push(`一项只写一行 [测试环境], 读到 ${annotations.length} 行`)
  } else {
    annotation = annotations[0]
    const device = DEVICE.exec(annotation)
    const emulator = EMULATOR.exec(annotation)
    if (TIER2.test(annotation)) {
      tier = 2
      if (changedPaths.length === 0) {
        problems.push('档 2 要写一行 改动: <路径>, 证明只动了 tools/ docs/ 或 *.md')
      }
      const behavior = changedPaths.filter(isBehavior)
      if (behavior.length > 0) {
        problems.push(`档 2 只能用于非行为类, 改动面含 ${behavior[0]}`)
      }
    } else if (device || emulator) {
      const suffix = (device ? device[3] : emulator[2] || '').trim()
      if (suffix) {
        if (CAPABILITY.test(suffix)) {
          tier = 3
          pending = true
        } else {
          problems.push(`[测试环境] 标注行后面还有看不懂的字: ${suffix}`)
        }
      } else {
        tier = 1
      }
    } else {
      problems.push('[测试环境] 标注行不合四档: 只写「已测真机」没型号版本算缺')
    }
  }

  if (tier === 2) {
    if (!readings.some((one) => one.tokens.includes('判据 x/x'))) problems.push('档 2 缺判据 x/x')
    if (!readings.some((one) => one.tokens.includes('单测通过数'))) problems.push('档 2 缺单测通过数')
  } else if (tier === 1 || tier === 3) {
    if (readings.length === 0) {
      problems.push('缺实测结果: 截图 / logcat / 判据 x-x / 单测通过数 都看不到')
    }
  }

  const tierName = tier === 1
    ? '行为类'
    : tier === 2
      ? '非行为类'
      : tier === 3
        ? '缺能力'
        : '缺读数'

  return {
    name: item.name,
    tier,
    tierName,
    pending,
    annotation,
    changedPaths,
    readings,
    problems,
  }
}

function evaluateText(text, file) {
  const items = parseItems(text).map(evaluateItem)
  const readings = items.reduce((sum, item) => sum + item.readings.length, 0)
  const problems = []
  if (items.length === 0) problems.push('证据文件里一项都没有 (每簇要写成 ## <项名>)')
  const missing = items.filter((item) => item.problems.length > 0).map((item) => item.name)
  return {
    ok: problems.length === 0 && items.length > 0 && missing.length === 0,
    file,
    items,
    readings,
    missing,
    problems,
  }
}

function evaluateFile(file) {
  if (!existsSync(file)) throw new Error(`找不到证据文件: ${file}`)
  return evaluateText(readFileSync(file, 'utf8'), file)
}

/* ── 输出 ─────────────────────────────────────────────────────────────────── */

function printResult(result) {
  for (const item of result.items) {
    if (item.problems.length === 0) {
      const pending = item.pending ? ', 待真机复验' : ''
      console.log(`ok    ${item.name}  ${item.tierName}${pending}  读数 ${item.readings.length} 条`)
    } else {
      for (const problem of item.problems) console.log(`FAIL  ${item.name}  - ${problem}`)
    }
  }
  for (const problem of result.problems) console.log(`FAIL  ${problem}`)
  if (result.ok) {
    console.log(`\nPASS  设备读数齐全: ${result.items.length} 项 / 读数 ${result.readings} 条`)
    return
  }
  console.log(`\n缺设备读数: ${result.missing.length} 项 (退出 3, 提交闸拦下)`)
  if (result.missing.length > 0) console.log(`缺项: ${result.missing.join(', ')}`)
}

function toJson(result) {
  return {
    ok: result.ok,
    file: result.file,
    items: result.items.map((item) => ({
      name: item.name,
      tier: item.tier,
      tierName: item.tierName,
      pending: item.pending,
      annotation: item.annotation,
      readings: item.readings.length,
      problems: item.problems,
    })),
    readings: result.readings,
    missing: result.missing,
    problems: result.problems,
  }
}

/* ── 自测: 两份夹具要分别给出 3 / 0 ──────────────────────────────────────── */

function selfTest() {
  let checks = 0
  let failures = 0
  function expect(name, got, want) {
    checks += 1
    const same = JSON.stringify(got) === JSON.stringify(want)
    if (!same) failures += 1
    console.log(
      `${same ? 'ok  ' : 'FAIL'} ${name}`
        + (same ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`),
    )
  }

  const missing = evaluateFile(join(FIXTURE_DIR, 'missing.md'))
  expect('missing.md 退出 3', missing.ok ? 0 : 3, 3)
  expect('missing.md 点名的缺项', missing.missing, ['#32 侧边栏终端', '#33 浮标语音开关', '#35 通知栏'])

  const complete = evaluateFile(join(FIXTURE_DIR, 'complete.md'))
  expect('complete.md 退出 0', complete.ok ? 0 : 3, 0)
  expect('complete.md 读数条数', complete.readings, 7)

  expect('空文件也要拦下 (退出 3)', evaluateText('', '(inline)').ok ? 0 : 3, 3)

  console.log(failures === 0 ? `\n自测全过: ${checks} 条` : `\n${failures} / ${checks} 条自测不过`)
  process.exit(failures === 0 ? 0 : 1)
}

/* ── 入口 ─────────────────────────────────────────────────────────────────── */

function usage(code) {
  console.log('用法: node tools/check-device-evidence.mjs <证据文件.md> [--json]')
  console.log('      node tools/check-device-evidence.mjs        (不带文件 = 跑两份夹具自测)')
  process.exit(code)
}

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) usage(0)

const asJson = args.includes('--json')
const fileArgs = args.filter((arg) => !arg.startsWith('--'))
if (fileArgs.length === 0) selfTest()
if (fileArgs.length > 1) {
  console.error(`只认一个证据文件, 读到 ${fileArgs.length} 个`)
  usage(2)
}
const file = resolve(fileArgs[0])

let result
try {
  result = evaluateFile(file)
} catch (error) {
  console.error(error.message)
  process.exit(2)
}

if (asJson) {
  process.stdout.write(`${JSON.stringify(toJson(result), null, 2)}\n`)
} else {
  printResult(result)
}
process.exit(result.ok ? 0 : 3)
