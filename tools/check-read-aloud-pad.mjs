// 「开口前先垫一句」的判据: 分档纯函数跑真值表, 外加"它真的被接在自动朗读那条路上"
// 抽取的是 host-plugin/index.mjs 里的源码本体, 不复制一份出来 (复制出来测的就不是上线的那份了)
// 用法: node tools/check-read-aloud-pad.mjs
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../host-plugin/index.mjs', import.meta.url), 'utf8')

// ── 一、纯函数: 该垫哪一段 ────────────────────────────────────────────────
const start = source.indexOf('const PAD_MIN_CHARS')
if (start < 0) throw new Error('PAD_MIN_CHARS is not in host-plugin/index.mjs')
const fnStart = source.indexOf('function padClipFor(')
if (fnStart < 0) throw new Error('padClipFor is not in host-plugin/index.mjs')
const fnEnd = source.indexOf('\n}\n', fnStart)
if (fnEnd < 0) throw new Error('padClipFor has no end')
const padClipFor = new Function(`${source.slice(start, fnEnd + 2)}; return padClipFor`)()

const long = (n) => '好'.repeat(n)
const cases = [
  // 短句不垫: 合成本来就快, 多一声反而平白多出一段声音
  ['', null],
  ['   ', null],
  ['好了', null],
  ['好 了', null],
  [long(19), null],
  // 到了门槛才垫, 两档用 ok / thinking 这两个"接在回答前面不像拟声词"的
  [long(20), 'ok'],
  [long(30), 'ok'],
  [long(79), 'ok'],
  [long(80), 'thinking'],
  [long(200), 'thinking'],
  // 空白不计入字数: 带换行与空格的长回答按"去掉空白之后"算
  [`${long(10)}\n\n${long(10)}`, 'ok'],
  [`${long(10)}\n\n${long(9)}`, null],
  // 非中文字符也按码点算, 代理对不拆成两个
  ['a'.repeat(19), null],
  ['a'.repeat(20), 'ok'],
  ['😀'.repeat(20), 'ok'],
]

let bad = 0
for (const [input, want] of cases) {
  const got = padClipFor(input)
  const ok = got === want
  if (!ok) bad += 1
  const label = input.length > 24 ? `${JSON.stringify(input.slice(0, 12))}…(${input.length})` : JSON.stringify(input)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} -> ${JSON.stringify(got)}`)
  if (!ok) console.log(`     wanted ${JSON.stringify(want)}`)
}

// ── 二、接线: 自动朗读那条路真的在调它 ────────────────────────────────────
// 只留函数不接线, 就是 2026-10-24 量到的那个形态: "能垫, 但没人垫"
const hookStart = source.indexOf('function startReadAloud(')
if (hookStart < 0) throw new Error('startReadAloud is not in host-plugin/index.mjs')
const hookEnd = source.indexOf('\n}\n', hookStart)
if (hookEnd < 0) throw new Error('startReadAloud has no end')
const hook = source.slice(hookStart, hookEnd + 2)

const wiring = [
  ['自动朗读在挑垫音', hook.includes('padClipFor(speakable)')],
  ['自动朗读真的发了 op=clip', hook.includes("op: 'clip'")],
  // 先垫后念: clip 那一段必须排在念之前, 否则那一句已经开口了才垫, 填不上空白
  // (2026-11-10 起"念"走朗读流 `lwSpeakLine` → `op=read`, 不再直接发 `op=speak`)
  ['垫音排在念之前', hook.indexOf("op: 'clip'") > 0 && hook.indexOf("op: 'clip'") < hook.indexOf('lwSpeakLine(')],
  ['垫音失败不挡着念', hook.includes('catch(')],
]

for (const [label, ok] of wiring) {
  if (!ok) bad += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
}

// ── 三、朗读稿的真值表 (2026-11-10, 方案 docs/Luwi-朗读与显示分离-方案-2026-11-09.md §4.3) ──
// 抽的是上线那份源码: readAloudText (Markdown 那套) + readAloudScript (再洗三步) + readAloudSegments
const readStart = source.indexOf('function readAloudText(')
const segStart = source.indexOf('function readAloudSegments(')
const segEnd = segStart < 0 ? -1 : source.indexOf('\n}\n', segStart)
if (readStart < 0 || segEnd < 0) throw new Error('the read-aloud script helpers are not in host-plugin/index.mjs')
const readApi = new Function(`${source.slice(readStart, segEnd + 2)}; return { readAloudScript, readAloudSegments }`)()
const { readAloudScript, readAloudSegments } = readApi

const scriptCases = [
  // ① 原样: 已经是纯口语, 一个字节都不动
  ['好了 我知道了', null, '好了 我知道了'],
  ['', null, ''],
  ['   ', null, ''],
  // ② 第 2 步: 括号补充整段丢 (中文括号与英文括号都丢)
  ['你好（点开设置）呀', null, '你好呀'],
  ['成 (took 2s)', null, '成'],
  // ② 第 3 步: 文件不念文件名, 念成"一份文档" / "一张图"
  ['报告.docx 已经放好了', null, '一份文档 已经放好了'],
  ['截图.png 在这儿', null, '一张图 在这儿'],
  // ① Markdown 那套照旧 (readAloudText 的既有口径, 不另写一份)
  ['**重点**是 `code`', null, '重点是 code'],
  // ③ voice: 给了就用它当稿子 (说法可以不同, 洗法同一套)
  ['屏上是这句', '念的是那句', '念的是那句'],
  ['屏上是这句（注）', '念的是那句', '念的是那句'],
]
for (const [shown, voice, want] of scriptCases) {
  const got = readAloudScript(shown, voice)
  const ok = got === want
  if (!ok) bad += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} 稿子 ${JSON.stringify(shown)}${voice === null ? '' : ` + voice ${JSON.stringify(voice)}`} -> ${JSON.stringify(got)}`)
  if (!ok) console.log(`     wanted ${JSON.stringify(want)}`)
}

// ③ 的字数上限: 念长了没人听 (方案 §9 第 3 条)
const longVoice = '念'.repeat(400)
const capped = readAloudScript('短句', longVoice)
const capOk = capped.length === 200
if (!capOk) bad += 1
console.log(`${capOk ? 'ok  ' : 'FAIL'} voice 最长 200 字 (给了 400 -> ${capped.length})`)

// 断句: 一段最多 6 句, 13 句切成 6 / 6 / 1
const thirteen = Array.from({ length: 13 }, (_, index) => `第${index + 1}句。`).join('')
const segments = readAloudSegments(thirteen)
const shape = segments.map((one) => (one.match(/。/g) ?? []).length)
const segOk = JSON.stringify(shape) === JSON.stringify([6, 6, 1]) && segments.every((one) => one.trim() !== '')
if (!segOk) bad += 1
console.log(`${segOk ? 'ok  ' : 'FAIL'} 一段最多 6 句: 13 句 -> ${JSON.stringify(shape)}`)
const emptySegments = readAloudSegments('   ')
const emptyOk = Array.isArray(emptySegments) && emptySegments.length === 0
if (!emptyOk) bad += 1
console.log(`${emptyOk ? 'ok  ' : 'FAIL'} 空稿不念 (切出来 0 段)`)

const total = cases.length + wiring.length + scriptCases.length + 3
console.log(bad === 0 ? `all ${total} checks pass` : `${bad} of ${total} checks differ`)
process.exit(bad === 0 ? 0 : 1)
