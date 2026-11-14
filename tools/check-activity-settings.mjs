/**
 * 门户「设置」那颗按钮与它弹的窗 (2026-11-13)
 *
 * 主人的原话: "判断和探索面板的设置按钮没有看到, 应该加在打开唤醒/刷新 的右侧". 判据量的就是
 * 那句原话里的三件事:
 *
 *   1. **一份实现**: 设置 → 活动 → 更多设置 与门户那两颗按钮弹的是**同一个** `SimSettingsDialog`,
 *      而「探索」「主动对话」两段仍是 `SettingsScreen.kt` 里那一份 `ExploreItems` / `ProactiveItems`
 *      —— 抄第二份参数页是最容易发生、也最难被发现的一种分叉
 *   2. **落在哪一组**: `focus` 词与那两张组表 (`SIM_GROUPS` / `ACTIVITY_GROUPS`) 对得上, 认不出来的
 *      词从顶上开始 (页面不用处理失败分支)
 *   3. **通路**: 页面只调 `portalActivitySettings` 一个桥方法, 状态只在 `PortalAsk` 一个对象里,
 *      关窗之后宿主推一句 `onSettingsClosed`, 面板才有最新的读数
 *
 * 用法: node tools/check-activity-settings.mjs
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
 * 一份正文里某个片段只出现一次 (两份实现就红)
 * @param name - 判据名字
 * @param haystack - 被查的正文
 * @param needle - 只许出现一次的片段
 */
function once(name, haystack, needle) {
  const count = haystack.split(needle).length - 1
  if (count === 1) notes.push(`ok   ${name}`)
  else failures.push(`${name}: ${JSON.stringify(needle)} 出现 ${String(count)} 次 (应为 1)`)
}

/**
 * 走一遍 app 的源码目录
 * @param directory - 绝对路径
 * @returns 全部 .kt 文件
 */
function walkKotlin(directory) {
  const found = []
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) found.push(...walkKotlin(full))
    else if (entry.endsWith('.kt')) found.push(full)
  }
  return found
}

const settings = read('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt')
const simScreen = read('app/src/main/java/io/github/yuloong07star/luwi/ui/SimSettingsScreen.kt')
const host = read('app/src/main/java/io/github/yuloong07star/luwi/ui/HostScreen.kt')
const bridge = read('app/src/main/java/io/github/yuloong07star/luwi/ui/PortalBridge.kt')
const ask = read('app/src/main/java/io/github/yuloong07star/luwi/ui/PortalAsk.kt')
const client = read('presets/luwi-portal/lib/client.js')

// ── 一、一份实现 ──────────────────────────────────────────────────────────────

once('SettingsScreen 里一份 ExploreItems', settings, 'fun ExploreItems()')
once('SettingsScreen 里一份 ProactiveItems', settings, 'fun ProactiveItems()')
once('SimSettingsScreen 里一份 SimSettingsDialog', simScreen, 'fun SimSettingsDialog(')

// 整个 ui/ 里不许有第二份 (改个名再抄一份也算)
const uiDir = fileURLToPath(new URL('app/src/main/java/io/github/yuloong07star/luwi/ui', `file://${root}/`))
const copies = []
for (const file of walkKotlin(uiDir)) {
  const text = readFileSync(file, 'utf8')
  for (const name of ['fun ExploreItems(', 'fun ProactiveItems(', 'fun SimSettingsDialog(']) {
    if (text.includes(name) && !['SettingsScreen.kt', 'SimSettingsScreen.kt'].includes(file.split('\\').pop())) {
      copies.push(`${file.split('\\').pop()}: ${name}`)
    }
  }
}
if (copies.length === 0) notes.push('ok   ui/ 里没有第二份参数页')
else failures.push(`ui/ 里出现了第二份参数页: ${copies.join(', ')}`)

// 壳仍是 OverlayDialog (与新手引导里选权限那副同一个)
expect('弹窗壳是 OverlayDialog', simScreen, 'OverlayDialog(')
expect('弹窗标题复用 settings_sim_title', simScreen, 'R.string.settings_sim_title')
expect('弹窗底部按钮复用 settings_sim_close', simScreen, 'R.string.settings_sim_close')

// ── 二、落在哪一组 ────────────────────────────────────────────────────────────

expect('focus 参数有缺省值', simScreen, 'focus: String = "top"')
expect('门户侧那两组由 withActivity 打开', simScreen, 'withActivity: Boolean = false')
expect('组表 SIM_GROUPS', simScreen, 'private val SIM_GROUPS = listOf("wake", "send", "router", "sticker")')
expect(
  '组表 ACTIVITY_GROUPS 把两组摆在最前',
  simScreen,
  'private val ACTIVITY_GROUPS = listOf("explore", "proactive") + SIM_GROUPS',
)
// 2026-11-14 主人: "活动板块除探索和判断里已有的, 剩下缺少的都加到判断的设置里, 包括表情包数量"
// —— 可见组由 focus 定: 探索面板只摆 explore, 判断面板吃下活动里剩下的全部
expect('可见组那张表', simScreen, 'private fun visibleGroups(focus: String, withActivity: Boolean): List<String>')
expect('探索面板只看一组', simScreen, 'focus.trim() == "explore" -> listOf("explore")')
expect('判断面板吃下活动里剩下的全部', simScreen, 'else -> ACTIVITY_GROUPS.filter { it != "explore" }')
expect('设置页仍是四组', simScreen, '!withActivity -> SIM_GROUPS')
for (const group of ['explore', 'proactive', 'wake', 'send', 'router', 'sticker']) {
  expect(`组 ${group} 有可见性守卫`, simScreen, `if (visible.contains("${group}")) {`)
}
expect('门户侧高度另一档', simScreen, 'visible.size <= 2 -> 0.52f')
// 判断面板现在有五组, 一进来滚到最后那组会让人以为只剩一组 —— 所以不再按 focus 滚
if (simScreen.includes('scrollToItem') || simScreen.includes('fun groupIndex')) {
  failures.push('SimSettingsScreen: 还在按 focus 滚到某一组 (判断面板五组时会藏掉前四组)')
} else {
  notes.push('ok   不再按 focus 滚到某一组 (从头看)')
}

// ── 三、通路: 页面 → 原生 → 回执 ──────────────────────────────────────────────

expect('PortalAsk 只有一个对象', ask, 'internal object PortalAsk')
expect('PortalAsk 的状态', ask, 'val activitySettings = mutableStateOf<String?>(null)')
expect('PortalAsk 回主线程', ask, 'Handler(Looper.getMainLooper()).post(block)')
expect('桥方法', bridge, 'fun portalActivitySettings(focus: String): String')
for (const word of ['"explore"', '"proactive"', '"router"', '"top"']) {
  expect(`桥认 ${word}`, bridge, word)
}
expect('HostScreen 挂窗', host, 'PortalAsk.activitySettings.value?.let { focus ->')
expect('HostScreen 给门户两组', host, 'withActivity = true')
expect('HostScreen 关窗推回执', host, 'window.__LUWI_PORTAL__.onSettingsClosed')
expect('页面那颗按钮', client, 'function settingsButton(focus)')
expect('页面调桥 (判断)', client, "settingsButton('router')")
expect('页面调桥 (探索)', client, "settingsButton('explore')")
expect('页面收回执', client, 'onSettingsClosed: function () { portal.refresh() }')

// 设置页那个入口一个参数都没加 (零改动那一条)
expect('设置页仍是裸调用', settings, 'SimSettingsDialog(onDismiss = { simOpen = false })')
if (settings.includes('withActivity = true')) {
  failures.push('设置页那个入口也开了 withActivity —— 那两组在设置页里本来就单独摆着, 会重复')
} else {
  notes.push('ok   设置页那个入口没开 withActivity (两组不会重复)')
}

// ── 四、写的路仍只有那四条 ────────────────────────────────────────────────────

once('SimSetting.save 只在弹窗里被调', simScreen, 'SimSetting.save(context')
// 设置页那一侧本来就有一处写 sim.json (主动场「能做什么」那三档, 2026-11-10), 除此之外不许再多
once('设置页只有主动场那一处写 sim.json', settings, 'SimSetting.save(')
if (settings.includes('SimSetting.save(context, current.copy(proactive')) {
  notes.push('ok   设置页那一处仍是主动场 acting, 不是第二份参数页')
} else {
  failures.push('设置页那一处 SimSetting.save 不再是主动场 acting —— 看看是不是有人加了第二条写的路')
}

// ── 读数 ──────────────────────────────────────────────────────────────────────

for (const note of notes) console.log(note)
if (failures.length > 0) {
  console.error('')
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.error(`\ncheck-activity-settings: ${String(failures.length)} 条不成立`)
  process.exit(1)
}
console.log(`\ncheck-activity-settings: 全部通过 (${String(notes.length)} 条)`)
