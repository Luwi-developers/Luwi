/**
 * 填写窗那一条的判据 (2026-11-14 主人: "设置里所有这类自定义数字或内容设置, 填写窗放屏幕中间,
 * 防止弹出键盘时挡住填写内容")
 *
 * 量三件事:
 *
 * 1. **一个壳**: 所有"要打字"的弹窗都过 `scaffolds/InputDialog.kt` —— 谁再往 `OverlayDialog` 里
 *    塞一个 `SuperTextField`, 那个窗又会回到贴底 + 被键盘压住
 * 2. **壳里那两下**: 居中靠 `largeScreen = true`, 盖得住别的弹窗靠 `renderInRootScaffold = false`,
 *    让出键盘靠窗口改成 edge-to-edge + `imePadding()` —— 少一样就退回上一版那个毛病
 * 3. **只读弹窗没被顺手改掉**: 关于 / 更新 / 检测 / 反馈这几张不带输入框, 仍是 `OverlayDialog`
 *
 * 用法: node tools/check-input-dialogs.mjs
 * 退出码: 0 = 都成立; 1 = 有 FAIL
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const failures = []
const notes = []

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
 * 断言一份正文里有某个片段
 * @param name - 判据名字
 * @param haystack - 被查的正文
 * @param needle - 必须出现的片段
 */
function expect(name, haystack, needle) {
  if (haystack.includes(needle)) notes.push(`ok   ${name}`)
  else failures.push(`${name}: missing ${JSON.stringify(needle)}`)
}

/**
 * 把一份 Kotlin 正文切成"每个顶层 fun 一块"
 * @param text - 源文件正文
 * @returns `[{ name, body }]`, 顺序按文件里的先后
 */
function functionBlocks(text) {
  const heads = [...text.matchAll(/^(?:private |internal )?fun\s+([A-Za-z0-9_]+)\s*\(/gm)]
  return heads.map((head, index) => ({
    name: head[1],
    body: text.slice(head.index, index + 1 < heads.length ? heads[index + 1].index : text.length),
  }))
}

/** 走一遍 ui/ 与 scaffolds/ */
function kotlinFiles() {
  const dirs = ['app/src/main/java/io/github/yuloong07star/luwi/ui', 'app/src/main/java/io/github/yuloong07star/luwi/scaffolds']
  const found = []
  for (const dir of dirs) {
    const full = fileURLToPath(new URL(`${dir}/`, `file://${root}/`))
    for (const entry of readdirSync(full)) {
      if (statSync(join(full, entry)).isFile() && entry.endsWith('.kt')) found.push(`${dir}/${entry}`)
    }
  }
  return found
}

// ── 一、壳本身那两下 ──────────────────────────────────────────────────────────

const shell = read('app/src/main/java/io/github/yuloong07star/luwi/scaffolds/InputDialog.kt')
expect('壳: 居中的那个 Box', shell, 'contentAlignment = Alignment.Center')
expect('壳: 让出键盘', shell, 'imePadding()')
expect('壳: 键盘后按可用高度收卡片', shell, 'if (maxHeight < byFraction) maxHeight else byFraction')
expect('壳: 关掉窗口内缩 (ime insets 才通)', shell, 'decorFitsSystemWindows = false')
expect('壳: 关掉平台默认宽度', shell, 'usePlatformDefaultWidth = false')
expect('壳: 内容可滚 (长文本窗)', shell, 'verticalScroll(rememberScrollState())')
expect('壳: 卡片与文字仍是 Miuix 那套', shell, 'Card(modifier = Modifier.fillMaxWidth())')

// ── 二、谁在打字就必须走这个壳 ────────────────────────────────────────────────

const needInput = {
  'app/src/main/java/io/github/yuloong07star/luwi/scaffolds/ArrowSlider.kt': ['SliderInputDialog'],
  'app/src/main/java/io/github/yuloong07star/luwi/ui/SimSettingsScreen.kt': ['TimeTextDialog'],
  'app/src/main/java/io/github/yuloong07star/luwi/ui/AboutDialogs.kt': ['SourceDialog'],
  'app/src/main/java/io/github/yuloong07star/luwi/ui/FeedbackDialog.kt': ['FeedbackDialog'],
  'app/src/main/java/io/github/yuloong07star/luwi/ui/SkillsScreens.kt': ['SkillBrowseDialog'],
  'app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt': [
    'PortalNameDialog', 'LockPasswordDialog', 'LockScriptDialog', 'LockRecordDialog',
    'PluginLinkDialog', 'PluginIndexDialog', 'QuickCreateDialog', 'ExploreTimeDialog',
    'ExploreCardDialog', 'ProactiveTimesDialog', 'AutomationCreateDialog', 'AutomationEditDialog',
    'AutomationCooldownDialog', 'AutomationQuietDialog', 'ModeEndpointDialog', 'ModeModelDialog',
    'WakeWordDialog', 'PowerWindowDialog', 'SpeakTextFieldDialog',
  ],
}

let migrated = 0
for (const [file, names] of Object.entries(needInput)) {
  const text = read(file)
  const blocks = functionBlocks(text)
  for (const name of names) {
    const block = blocks.find((one) => one.name === name)
    if (block === undefined) {
      failures.push(`${file}: 找不到 ${name}`)
      continue
    }
    if (!block.body.includes('InputDialog(')) failures.push(`${name}: 没走 InputDialog (还在用别的壳)`)
    else if (block.body.includes('OverlayDialog(')) failures.push(`${name}: 同时还有 OverlayDialog (两个壳并存)`)
    else migrated += 1
  }
}
notes.push(`ok   ${String(migrated)} 个填写窗都走 InputDialog`)

// 反向闸: 任何函数块里 `OverlayDialog(` 与 `SuperTextField(` 同时出现 = 漏迁
for (const file of kotlinFiles()) {
  for (const block of functionBlocks(read(file))) {
    if (block.body.includes('OverlayDialog(') && block.body.includes('SuperTextField(')) {
      failures.push(`${file.split('/').pop()} 的 ${block.name}: 输入框还塞在 OverlayDialog 里`)
    }
  }
}

// ── 三、只读弹窗仍是原来那个壳 ────────────────────────────────────────────────

const about = read('app/src/main/java/io/github/yuloong07star/luwi/ui/AboutDialogs.kt')
for (const [label, text, name] of [
  ['AboutDialog', about, 'AboutDialog'],
  ['UpdateDialog', about, 'UpdateDialog'],
]) {
  const block = functionBlocks(text).find((one) => one.name === name)
  if (block === undefined) failures.push(`找不到 ${label}`)
  else if (!block.body.includes('OverlayDialog(')) failures.push(`${label}: 不该被换成输入窗壳 (它不用键盘)`)
  else notes.push(`ok   ${label} 仍是只读弹窗的壳`)
}

// ── 读数 ──────────────────────────────────────────────────────────────────────

for (const note of notes) console.log(note)
if (failures.length > 0) {
  console.error('')
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.error(`\ncheck-input-dialogs: ${String(failures.length)} 条不成立`)
  process.exit(1)
}
console.log(`\ncheck-input-dialogs: 全部通过 (${String(notes.length)} 条)`)
