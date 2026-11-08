#!/usr/bin/env node
// luwi 预设 (默认档) 的判据
//
// 查四件事:
//   ① 声明还在, 而且挂得上 (id / name / order / bundle patch 指向自己那份 yml)
//   ② persona 里那几条"二代仿真"的规矩真在 (少一条就等于没写)
//   ③ persona 里**没有** QQ 那套残留 (qq_send_message / readThroughSeq / mark_read …) ——
//      这些词一旦漏进来, 模型会去调根本不存在的工具, 一轮就废
//   ④ 工具表与 explore 逐行一致 (它是"能干活"的那一档的参照), 默认档 = luwi 写在 Kotlin 里、
//      pack-host 的拷表里也有一份
//
// 用法: node D:\apk\Luwi\tools\check-presets.mjs

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const notes = []

function read(rel) {
  const path = join(root, rel)
  if (!existsSync(path)) {
    failures.push(`缺少文件: ${rel}`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

function expect(ok, message) {
  if (!ok) failures.push(message)
}

const preset = read('presets/luwi/cordis.patch.yml')
const pkg = read('presets/luwi/package.json')
const explore = read('presets/explore/cordis.patch.yml')
const kotlin = read('app/src/main/java/io/github/yuloong07star/luwi/host/CustomPresets.kt')
const pack = read('tools/pack-host.mjs')

// ① 声明形状
expect(preset.startsWith('#'), 'cordis.patch.yml 应该以文件头注释开头')
expect(preset.includes('- insert:'), 'cordis.patch.yml 缺少顶层 `- insert:`')
expect(/- id: preset-luwi/.test(preset), 'cordis.patch.yml 缺少 `- id: preset-luwi`')
expect(/^\s+id: luwi$/m.test(preset), 'preset 的 `config.id` 应该是 luwi')
expect(/^\s+name: Luwi$/m.test(preset), 'preset 的展示名应该是 Luwi')
expect(/^\s+order: \d+$/m.test(preset), 'preset 缺少 order')
expect(/^\s+description: .+/m.test(preset), 'preset 缺少 description')
expect(/^\s+prefix: \|-/m.test(preset), 'persona 缺少 prefix 块')
expect(preset.includes('{{cwd}}'), 'persona suffix 应该写工作目录 (Luwi 侧 host 重注册了 cwd 变量)')

if (pkg !== '') {
  let manifest = null
  try {
    manifest = JSON.parse(pkg)
  } catch (error) {
    failures.push(`package.json 不是合法 JSON: ${error.message}`)
  }
  if (manifest !== null) {
    expect(manifest.name === '@local/dsh-preset-luwi', 'package.json 的 name 应该是 @local/dsh-preset-luwi')
    expect(manifest?.dsh?.bundle?.patch === './cordis.patch.yml', 'package.json 的 dsh.bundle.patch 应该指向 ./cordis.patch.yml')
  }
}

// ② 二代仿真那几条规矩: 一条都不能少
const mustHave = [
  ['一条意群', '分条的基本单位'],
  ['不超过 30 字', '单条长度'],
  ['不客服腔', '语气'],
  ['不确定就直说', '不编'],
  ['停止也是一种正常', '不追问'],
  ['工具调用不算说话', '手机操作那一条的核心'],
  ['lw_say', '发言通道 (方案 A: 正文不发言)'],
  ['发图', '图片与文字同一条流'],
  ['image 参数', '发图的入口'],
  ['正文不发言', '方案 A 的根'],
  ['lw_sticker', '表情'],
  ['lw_speak', '出声'],
  ['lw_overlay', '浮球通道'],
  ['验证码', '红线'],
]
for (const [needle, why] of mustHave) {
  expect(preset.includes(needle), `persona 缺少「${needle}」(${why})`)
}

// ③ QQ 那套不许漏进来
const qqOnly = [
  'qq_send_message',
  'qq_send_burst',
  'qq_send_file',
  'qq_wait_for_messages',
  'qq_mark_read',
  'qq_set_wake_config',
  'readThroughSeq',
  'mark_read',
  'set_wake_config',
  '会话令牌',
  'ownerQQ',
  'Silent',
]
for (const needle of qqOnly) {
  // 文件头注释里允许提到它们 (说明"没有搬"), 只看 persona 区段
  const personaStart = preset.indexOf('prefix: |-')
  const personaEnd = preset.indexOf('suffix: |-')
  const body = personaStart >= 0 && personaEnd > personaStart
    ? preset.slice(personaStart, personaEnd)
    : ''
  expect(!body.includes(needle), `persona 正文里不该出现 QQ 的东西: ${needle}`)
}

// ④ 工具表与 explore 逐行一致
const marker = '          - id: agent-instructions'
const cut = (text) => {
  const at = text.indexOf(marker)
  return at < 0 ? '' : text.slice(at).trimEnd()
}
const luwiTools = cut(preset)
expect(luwiTools !== '', 'persona 之后找不到工具表 (`- id: agent-instructions`)')
expect(luwiTools === cut(explore), '工具表与 explore 不一致 —— 默认档要能干活, 表必须同一份')

// 默认档: Kotlin 常量 + pack-host 的拷表
expect(/const val DEFAULT_PRESET = "luwi"/.test(kotlin), 'CustomPresets.DEFAULT_PRESET 应该是 luwi')
expect(/ROW_LUWI to "luwi"/.test(kotlin), 'CustomPresets.PRESET_ROWS 里缺少 preset-luwi')
expect(/const presets = \['luwi'/.test(pack), "pack-host.mjs 的 presets 数组应该以 'luwi' 开头")

notes.push(`persona 正文 ${((preset.slice(preset.indexOf('prefix: |-'), preset.indexOf('suffix: |-'))).split('\n').length - 1)} 行`)
notes.push(`工具表 ${luwiTools.split('\n').length} 行 (与 explore 逐行相同)`)

if (failures.length > 0) {
  console.error(`check-presets: FAIL (${failures.length})`)
  for (const one of failures) console.error(`  - ${one}`)
  process.exit(1)
}
console.log('check-presets: PASS')
for (const one of notes) console.log(`  · ${one}`)

