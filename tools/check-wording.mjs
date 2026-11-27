/**
 * 叫法的判据: 「唤醒」不再叫「敲钟」(2026-11-13 主人: 敲钟改成唤醒)
 *
 * 为什么单独立一条: 这个词散在三处**不同语言**的实现里 —— 门户页面 (JS) 的面板读数与按钮、
 * 设置页的两套 `strings.xml`、宿主插件的工具说明。改一次漏一处, 界面上就会同时挂着两个名字,
 * 而那是最难被发现的一类错: 没有异常, 只是读起来不像一个人说的话
 *
 * 量的三件事:
 *   1. **旧叫法一处不许留** —— 三处都扫 (注释也算, 下一个人是照注释抄的)
 *   2. **新叫法真在** —— `settings_sim_*` 那六条说明里带「唤醒」/ `wake`
 *   3. **语音那段没被误伤** —— `settings_wake_words` 仍是「唤醒词」, 那个「唤醒」是另一件事
 *
 * 用法: node tools/check-wording.mjs
 * 退出码: 0 = 三条都过; 1 = 有 FAIL
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const failures = []
const notes = []

/** 被撤下来的旧叫法 (拼出来写, 免得这一行自己被下一轮全文扫描当成命中) */
const RETIRED = '敲' + '钟'

/**
 * 读一份文件, 读不到就记一条失败
 * @param relative - repo 相对路径
 * @returns 文件正文, 读不到时为空串
 */
function read(relative) {
  try {
    return readFileSync(new URL(relative, `file://${root}/`), 'utf8')
  } catch (error) {
    failures.push(`${relative}: ${error.message}`)
    return ''
  }
}

/**
 * 一份正文里不许出现旧叫法
 * @param name - 判据名字
 * @param text - 被查的正文
 */
function noRetired(name, text) {
  const lines = text.split('\n')
  const hits = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(RETIRED)) hits.push(`${String(i + 1)}: ${lines[i].trim()}`)
  }
  if (hits.length === 0) notes.push(`ok   ${name}: 没有旧叫法`)
  else failures.push(`${name}: 还在说「${RETIRED}」\n      ${hits.join('\n      ')}`)
}

/**
 * 从一份 strings.xml 里取一个键的值
 * @param text - xml 正文
 * @param key - 字符串键
 * @returns 值文本, 没有这个键时返回 null
 */
function stringValue(text, key) {
  const pattern = new RegExp(`<string name="${key}">([\\s\\S]*?)</string>`)
  const found = text.match(pattern)
  return found === null ? null : found[1]
}

// ── 一、三处都不许留旧叫法 ────────────────────────────────────────────────────

const client = read('presets/luwi-portal/lib/client.js')
noRetired('client.js', client)

const zh = read('app/src/main/res/values-zh/strings.xml')
const en = read('app/src/main/res/values/strings.xml')
noRetired('values-zh/strings.xml', zh)
noRetired('values/strings.xml', en)

const plugin = read('host-plugin/index.mjs')
noRetired('host-plugin/index.mjs', plugin)

// ── 二、新叫法真在: 那六条说明里都得有 ────────────────────────────────────────

const ZERO = 'zero_word'
let keyOk = true
const KEYS = [
  ['settings_sim_note', '唤醒', 'wake'],
  ['settings_sim_mode_summary', '唤醒', 'wak'],
  ['settings_sim_gap_min', '唤醒', 'wake'],
  ['settings_sim_gap_max', '唤醒', 'wake'],
  ['settings_sim_pre_sleep_summary', '唤醒', 'wake'],
  ['settings_sim_quiet_summary', '唤醒', 'wak'],
]
for (const [key, zhWord, enWord] of KEYS) {
  const zhValue = stringValue(zh, key) ?? ZERO
  const enValue = stringValue(en, key) ?? ZERO
  if (zhValue === ZERO) {
    failures.push(`values-zh/strings.xml: 少了 ${key}`)
    keyOk = false
  } else if (!zhValue.includes(zhWord)) {
    failures.push(`values-zh/strings.xml 的 ${key} 里没有「${zhWord}」`)
    keyOk = false
  }
  if (enValue === ZERO) {
    failures.push(`values/strings.xml: 少了 ${key}`)
    keyOk = false
  } else if (!enValue.toLowerCase().includes(enWord)) {
    failures.push(`values/strings.xml 的 ${key} 里没有 ${enWord}`)
    keyOk = false
  }
}
if (keyOk) notes.push(`ok   ${String(KEYS.length)} 对 settings_sim_* 说明都是「唤醒」口径`)

// ── 三、语音唤醒词那段没被误伤 ────────────────────────────────────────────────

const wakeWord = stringValue(zh, 'settings_wake_words') ?? ZERO
if (wakeWord === '唤醒词') notes.push('ok   语音那段仍是「唤醒词」(这一轮只改主动场那一边)')
else failures.push(`settings_wake_words 变成了 ${JSON.stringify(wakeWord)} —— 语音唤醒词那一段不该被这一轮碰到`)

// ── 读数 ──────────────────────────────────────────────────────────────────────

for (const note of notes) console.log(note)
if (failures.length > 0) {
  console.error('')
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.error(`\ncheck-wording: ${String(failures.length)} 条不成立`)
  process.exit(1)
}
console.log(`\ncheck-wording: 全部通过 (${String(notes.length)} 条)`)
