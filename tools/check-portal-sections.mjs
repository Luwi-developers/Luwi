/**
 * 门户那套"30 分钟分段"的判据 (2026-11-08)
 *
 * `sectionsOf` / `stamp` / `dayKey` 是纯函数, 但它们在 `lib/client.js` 的 factory 里 —— 页面之外的
 * 地方拿不到。这里**从源码里把它们原样截出来** (不是抄一份) 再跑用例: 抄一份就成了第二份实现,
 * 源码改了测试还绿, 那比没有测试更糟
 *
 * 四条: 段内 5 分钟不切 / 隔 40 分钟切 / 跨午夜切 / 时间缺失不切
 *
 * usage: node tools/check-portal-sections.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const clientPath = new URL('presets/luwi-portal/lib/client.js', `file://${root}/`)
const source = readFileSync(clientPath, 'utf8')

const failures = []
const notes = []

/**
 * 从源码里截一个具名函数的整段文本 (按大括号配对)
 * @param name - 函数名
 * @returns 从 `function name(` 到配对的 `}` 那一整段
 */
function sliceFunction(name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`client.js: missing function ${name}`)
  let depth = 0
  let index = source.indexOf('{', start)
  for (; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`client.js: unbalanced braces after ${name}`)
}

const gap = /var SECTION_GAP_MS = (\d+) \* (\d+) \* (\d+)/.exec(source)
if (gap === null) {
  failures.push('client.js: 找不到 SECTION_GAP_MS = <n> * <n> * <n>')
}
const gapMs = gap === null ? 0 : Number(gap[1]) * Number(gap[2]) * Number(gap[3])
if (gap !== null) {
  if (gapMs === 30 * 60 * 1000) notes.push(`ok   分段间隔 ${String(gapMs)} ms = 30 分钟`)
  else failures.push(`client.js: 分段间隔是 ${String(gapMs)} ms, 不是 30 分钟`)
}

const body = [
  `var SECTION_GAP_MS = ${String(gapMs)}`,
  sliceFunction('clock'),
  sliceFunction('dayKey'),
  sliceFunction('stamp'),
  sliceFunction('sectionsOf'),
  'return { clock: clock, dayKey: dayKey, stamp: stamp, sectionsOf: sectionsOf }',
].join('\n')

let api
try {
  // eslint-disable-next-line no-new-func -- 这一份就是"跑源码里那两个函数", 不是模板
  api = new Function(body)()
} catch (error) {
  failures.push(`client.js: 截出来的函数体跑不起来 (${String(error && error.message)})`)
}

if (api !== undefined) {
  const now = Date.now()
  const minute = 60 * 1000

  const near = [{ time: now - 5 * minute }, { time: now }]
  if (api.sectionsOf(near).length === 1) notes.push('ok   段内隔 5 分钟不切')
  else failures.push('sectionsOf: 5 分钟的间隔被切成了两段')

  const far = [{ time: now - 40 * minute }, { time: now }]
  if (api.sectionsOf(far).length === 2) notes.push('ok   隔 40 分钟另起一段')
  else failures.push('sectionsOf: 40 分钟的间隔没有分段')

  // 跨午夜: 用今天零点前后各几分钟, 保证落在两个本地日期上
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const across = [{ time: midnight.getTime() - 2 * minute }, { time: midnight.getTime() + 3 * minute }]
  if (api.sectionsOf(across).length === 2) notes.push('ok   跨午夜另起一段')
  else failures.push('sectionsOf: 跨午夜没有分段')

  const unknown = [{ time: 0 }, { time: 0 }, { time: now }]
  if (api.sectionsOf(unknown).length === 1) notes.push('ok   时间缺失不参与切段')
  else failures.push('sectionsOf: 时间缺失把段落切乱了')

  const today = api.stamp(now)
  if (/^今天 \d\d:\d\d$/.test(today)) notes.push(`ok   stamp 今天 (${today})`)
  else failures.push(`stamp: 今天那一档不对 (${today})`)

  const yesterday = api.stamp(now - 24 * 60 * minute)
  if (/^昨天 \d\d:\d\d$/.test(yesterday)) notes.push(`ok   stamp 昨天 (${yesterday})`)
  else failures.push(`stamp: 昨天那一档不对 (${yesterday})`)

  const older = api.stamp(now - 40 * 24 * 60 * minute)
  if (/^\d{1,2}月\d{1,2}日 \d\d:\d\d$/.test(older)) notes.push(`ok   stamp 月日 (${older})`)
  else failures.push(`stamp: 今年内的日期没有落成"月日 时:分" (${older})`)

  if (api.stamp(0) === '') notes.push('ok   stamp 没有时间时回空串')
  else failures.push('stamp: 时间缺失时应当回空串')
}

for (const note of notes) console.log(note)
if (failures.length > 0) {
  console.error('')
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.error(`\ncheck-portal-sections: ${String(failures.length)} 条不成立`)
  process.exit(1)
}
console.log(`\ncheck-portal-sections: 全部通过 (${String(notes.length)} 条)`)
