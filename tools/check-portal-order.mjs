/**
 * 门户那套「按轮排」的判据 (2026-11-10)
 *
 * `nodesOf` 把两路流 (dsh 的 user 节点 / 她的话那份 jsonl) 收成 `users` / `rows` / `extras` 三份,
 * 再交给 `orderTimeline` 排。这个函数是纯的, 但从源码里**原样截出来真跑** (与
 * `check-portal-sections.mjs` 同一个做法): 抄一份就成了第二份实现, 源码改了测试还绿, 那比没有测试更糟
 *
 * 钉的是这四件 (2026-11-10 主人: "当前的排序乱了, 查一下根因, 彻底修复"):
 *
 * 1. 轮内: user -> 她的行 (按 seq) -> turn-error -> 兜底
 * 2. 轮边界: 她的行按 `at` 归轮, 同一毫秒算上一轮 (宿主的 turn end 补句贴在轮尾)
 * 3. 缺时间: user 缺时间沉到最后 (不能排到她上一句回复上面), 她的行缺时间排最后
 * 4. 确定: 同毫秒 / 同 seq 也有确定顺序, 不再靠插入顺序
 *
 * usage: node tools/check-portal-order.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = readFileSync(new URL('presets/luwi-portal/lib/client.js', `file://${root}/`), 'utf8')

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

const orderSource = sliceFunction('orderTimeline')
// eslint-disable-next-line no-new-func -- 这一份就是"跑源码里那个函数", 不是模板
const orderTimeline = new Function(`${orderSource}\nreturn orderTimeline`)()

/**
 * 造一条流里的一项 (只带这个函数会读的字段)
 * @param label - 断言里用的短名
 * @param who - user / assistant / error
 * @param time - 那一项的时间 (0 表示读不到)
 * @param seq - 顺序号 (她的行是 jsonl 的 seq, user 是 dsh 的 seq)
 * @param extra - 另外几笔 (fallback / pinnedTo)
 * @returns 那一项
 */
function item(label, who, time, seq, extra) {
  return { label, who, time, seq, ...(extra ?? {}) }
}

/**
 * 跑一条用例并比对顺序
 * @param name - 用例名
 * @param users - user 节点 (按节点顺序)
 * @param rows - 她的行 (按 seq)
 * @param extras - 兜底 / turn-error
 * @param expected - 期望的 label 序列
 */
function check(name, users, rows, extras, expected) {
  const got = orderTimeline(users, rows, extras).map(one => one.label)
  if (got.join(',') === expected.join(',')) {
    notes.push(`ok   ${name}: ${got.join(' -> ')}`)
  } else {
    failures.push(`${name}: expected ${expected.join(' -> ')}, got ${got.join(' -> ')}`)
  }
}

// ── 一、轮内与轮边界 ─────────────────────────────────────────────────────────

check(
  '基本: user 之后是她的行, 按 seq',
  [item('u1', 'user', 1000, 8)],
  [item('r1', 'assistant', 1001, 1), item('r2', 'assistant', 1002, 2)],
  [],
  ['u1', 'r1', 'r2'],
)

check(
  '跨轮: 第二轮的行排在自己的 user 之后',
  [item('u1', 'user', 1000, 8), item('u2', 'user', 2000, 20)],
  [item('r1', 'assistant', 1500, 1), item('r2', 'assistant', 2100, 2)],
  [],
  ['u1', 'r1', 'u2', 'r2'],
)

check(
  '轮尾补句 (at 落在两轮之间) 留在上一轮',
  [item('u1', 'user', 1000, 8), item('u2', 'user', 3000, 20)],
  [item('r1', 'assistant', 1001, 1), item('r2', 'assistant', 2999, 2)],
  [],
  ['u1', 'r1', 'r2', 'u2'],
)

check(
  '她的行按 seq, 不看 at (同一轮里 at 回卷也不翻)',
  [item('u1', 'user', 1000, 8)],
  [item('r1', 'assistant', 2001, 1), item('r2', 'assistant', 2000, 2)],
  [],
  ['u1', 'r1', 'r2'],
)

check(
  '第一轮那一刻的行归第一轮 (不沉到前奏)',
  [item('u1', 'user', 1000, 8), item('u2', 'user', 3000, 20)],
  [item('r1', 'assistant', 1000, 1)],
  [],
  ['u1', 'r1', 'u2'],
)

check(
  '正好落在下一轮那一刻的行算上一轮 (轮尾补句贴边)',
  [item('u1', 'user', 1000, 8), item('u2', 'user', 2000, 20)],
  [item('r1', 'assistant', 2000, 1)],
  [],
  ['u1', 'r1', 'u2'],
)

// ── 二、缺时间 (2026-11-09 那条没修干净的) ────────────────────────────────────

check(
  'user 缺时间: 沉到最后, 不能排到她上一句回复上面',
  [item('u1', 'user', 1000, 8), item('u2', 'user', 0, 20)],
  [item('r1', 'assistant', 1001, 1)],
  [],
  ['u1', 'r1', 'u2'],
)

check(
  '她的行缺时间: 归最后一轮, 排到已知行后面 (按 seq)',
  [item('u1', 'user', 1000, 8)],
  [item('r1', 'assistant', 0, 3), item('r2', 'assistant', 0, 2)],
  [],
  ['u1', 'r2', 'r1'],
)

// ── 三、时钟回卷 / 没有 user ─────────────────────────────────────────────────

check(
  '时钟回卷: user 相对顺序不翻, 早于第一轮的行走前奏桶',
  [item('u1', 'user', 2000, 8), item('u2', 'user', 1000, 20)],
  [item('r1', 'assistant', 1500, 1)],
  [],
  ['r1', 'u1', 'u2'],
)

check(
  '主动场 (没有 user): 她的行按 seq',
  [],
  [item('r1', 'assistant', 1001, 1), item('r2', 'assistant', 1002, 2)],
  [],
  ['r1', 'r2'],
)

// ── 四、兜底行钉在自己那一轮 (2026-11-10 不再改嫁) ───────────────────────────

check(
  '兜底行钉在它自己那一轮, 新消息进来不跟着走',
  [item('u1', 'user', 1000, 8), item('u2', 'user', 2000, 20)],
  [],
  [item('f1', 'assistant', 1000, 0, { fallback: true, pinnedTo: 0 })],
  ['u1', 'f1', 'u2'],
)

check(
  'turn-error 排在它的行后面',
  [item('u1', 'user', 1000, 8)],
  [item('r1', 'assistant', 1001, 1)],
  [item('e1', 'error', 1002, 15)],
  ['u1', 'r1', 'e1'],
)

// ── 五、源码结构 (这几条是"根因已经拆掉"的事实) ─────────────────────────────

if (!source.includes('sortAt') && !source.includes('sortFloor')) {
  notes.push('ok   client.js: 旧的 sortAt / running max 已经拆掉')
} else {
  failures.push('client.js: sortAt / sortFloor 还在 —— 缺时间的键仍可能排到已知时间前面')
}

if (source.includes('return orderTimeline(users, rows, extras)')) {
  notes.push('ok   nodesOf: 交给 orderTimeline 按轮排')
} else {
  failures.push('client.js: nodesOf 没有走 orderTimeline')
}

if (source.includes('var allowFallback = !luwiFlow() || outLines.length === 0')) {
  notes.push('ok   兜底正文: luwi 档不再兜 (宿主补句同源), 非 luwi 才兜')
} else {
  failures.push('client.js: 兜底正文没有按档收紧')
}

if (source.includes('pinnedTo: assistantOwner')) {
  notes.push('ok   兜底行钉在 assistantOwner (不再挂到最后一条 user 上)')
} else {
  failures.push('client.js: 兜底行仍会改嫁到新消息')
}

for (const note of notes) console.log(note)
if (failures.length > 0) {
  console.error('')
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.error(`\ncheck-portal-order: ${String(failures.length)} 条不成立`)
  process.exit(1)
}
console.log(`\ncheck-portal-order: 全部通过 (${String(notes.length)} 条)`)
