/**
 * 设置页「哪些段缺省展开」那一份名单的判据 (2.7.8 批次 1, 第 1 条 / 决策闸 D1 + D2)
 *
 * 这一批改的是一条**很安静**的东西: `collapsed` 的初值从空集 (缺省全展开) 换成
 * "页面上所有段 - 白名单" (缺省只展开省电与「常用」那六段)。两个做错的样子都不响亮:
 *
 *   1. 白名单里多写一个 / 少写一个段名 —— 那一段的方向反了, 界面上只是"它开着"或"它收着"
 *   2. 页面上新加一段而忘了加进 `SettingsSectionKeys` —— 它会**恰好展开着** (与 D2 那条
 *      "新加的段就收着"相反), 而且 `SettingsSectionsTest` 也看不出来 (那份测的是纯函数,
 *      不知道页面上真有几段)
 *
 * 所以这份脚本把**页面上那 21 个 `settingsSection(key = …)` 的实况**与名单逐个对齐 (顺序也管),
 * 与 `check-automations.mjs` / `check-mode-model.mjs` 那种"两处名单必须一致"同一个道理
 *
 * 跑法: node tools/check-settings-sections.mjs   (不需要设备)
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const screen = await readFile(
  new URL('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt', root),
  'utf8',
)
// 2026-10-29: 酒馆那一段搬进 LuwiTavern.kt (C 方案第 1 步), 页面实况要两处拼起来看 ——
// 那份文件最终会落在私有目录, 所以读不到时按"这一段不在这一份构建里"算
const tavern = await readFile(
  new URL('app/src/main/java/io/github/yuloong07star/luwi/ui/LuwiTavern.kt', root),
  'utf8',
).catch(() => '')

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

/** 那一份 `listOf("a", "b", …)` 的字面量 (按声明里的顺序) */
function listOf(name) {
  const at = screen.indexOf(`val ${name}`)
  if (at < 0) return null
  const body = screen.slice(at, screen.indexOf('\n)', at))
  return [...body.matchAll(/"([a-z-]+)"/gu)].map((m) => m[1])
}

const open = listOf('SettingsSectionsAlwaysOpenKeys')
const ability = listOf('AbilitySectionKeys')
/** 页面实况: 每个 `settingsSection(` 后面那个 key, 按出现顺序 (酒馆那一段的定义在 LuwiTavern.kt,
 *  调用点在 SettingsScreen.kt 的同一位置, 所以这里把调用点当作一段 "tavern") */
const page = [...screen.matchAll(/settingsSection\(\s*key = "([a-z-]+)"|LuwiTavern\.tavernSection\(/gu)]
  .map((m) => m[1] ?? 'tavern')

/* ── 一、名单本身 ─────────────────────────────────────────────────────── */

check('白名单就是 D1 那六段 (省电 + 常用五段; 导航那一段 2026-10-17 撤了)', open, [
  'power', 'appearance', 'channel', 'ball', 'wake', 'speak',
])

check('能力那一组 14 段 (接口 2026-10-25 加在最末, 活动 2026-11-07 由探索与定时对话合成)', ability, [
  'notifications', 'screenshot', 'look', 'lock',
  'activity', 'automation', 'quick', 'plugin', 'skills', 'linux', 'sync', 'tavern', 'permissions', 'api',
])

check('页面上真是 20 段', page.length, 20)

check('两份名单拼起来与页面逐个对齐 (顺序也管)', [...(open ?? []), ...(ability ?? [])], page)

check('白名单里没有重复的段名', new Set(open ?? []).size, (open ?? []).length)

check('两份名单不相交', (ability ?? []).filter((key) => (open ?? []).includes(key)), [])

/* ── 二、算缺省那一份的写法 ───────────────────────────────────────────── */

check('缺省那一份按"全部 - 白名单"算', /\(all - expanded\)\.toSet\(\)/u.test(screen), true)

check('缺省的默认参数就是白名单', /expanded: Set<String> = SettingsSectionsAlwaysOpen,/u.test(screen), true)

check('`collapsed` 的初值走那个函数, 不是空集', [
  /mutableStateOf\(initialCollapsed\(sessionCollapsed\)\)/u.test(screen),
  /mutableStateOf\(emptySet<String>\(\)\)/u.test(screen),
], [true, false])

check('退出再进那一份记在进程里 (点一下顺手写回去)', [
  /private var sessionCollapsed: Set<String>\? = null/u.test(screen),
  /sessionCollapsed = collapsed/u.test(screen),
  /session: Set<String>\?,\s*\n\s*all: List<String> = SettingsSectionKeys,\s*\n\): Set<String> = session \?: defaultCollapsed\(all\)/u.test(screen),
], [true, true, true])

check('白名单的集合形态由那份名单算出来 (不是又抄一遍)', [
  /internal val SettingsSectionsAlwaysOpen: Set<String> = SettingsSectionsAlwaysOpenKeys\.toSet\(\)/u.test(screen),
], [true])

/* ── 三、顶部段名索引条 (2026-11-14) ──────────────────────────────────── */

const bar = await readFile(
  new URL('app/src/main/java/io/github/yuloong07star/luwi/scaffolds/settings/SettingsSectionBar.kt', root),
  'utf8',
).catch(() => '')

/** 索引条那本"段名 → 段名资源"的表 (只在那一段声明里取, 别把页面别处的 `x to R.string.y` 算进来) */
const titleAt = screen.indexOf('internal val SettingsSectionTitleRes')
const titles = [...screen.slice(titleAt, screen.indexOf('\n)', titleAt)).matchAll(/"([a-z-]+)" to R\.string\./gu)]
  .map((m) => m[1])

/** 页面实况: 段与组标题按出现顺序排成一条流 */
const flow = [...screen.matchAll(/settingsSection\(\s*key = "([a-z-]+)"|item \{ GroupTitle\(|LuwiTavern\.tavernSection\(/gu)]
  .map((m) => m[1] ?? (m[0].startsWith('item') ? '__group__' : 'tavern'))

/** 每一处组标题后面紧跟的那一段 */
const groupFollows = flow.flatMap((key, index) => (key === '__group__' ? [flow[index + 1]] : []))

/** Kotlin 那一份字面量 */
const beforeLiteral = [
  ...(screen.match(/internal val SettingsGroupTitleBefore: Set<String> = setOf\(([^)]*)\)/u)?.[1] ?? '')
    .matchAll(/"([a-z-]+)"/gu),
].map((m) => m[1])

check('索引条的段名表与段名表逐个对齐 (键与顺序都管)', titles, [...(open ?? []), ...(ability ?? [])])

check('段名表的项数与段数一样', titles.length, page.length)

check('页面上只有两处组标题, 分别在常用与能力那两组之前', groupFollows, ['appearance', 'notifications'])

check('Kotlin 里那份组标题名单与页面实况一致', beforeLiteral, groupFollows)

check('顶上那条提示占的下标数只写一处', /internal const val SettingsListLeadingItems = 1/u.test(screen), true)

check('索引条与列表共用同一个滚动位置', [
  /val listState = rememberLazyListState\(\)/u.test(screen),
  /state = listState,/u.test(screen),
  /animateScrollToItem\(row\)/u.test(screen),
  /settingsSectionAtRow\(SettingsSectionKeys, listState\.firstVisibleItemIndex\)/u.test(screen),
  /SettingsSectionBar\(/u.test(screen),
], [true, true, true, true, true])

check('索引条不另抄一份段名表 (只吃调用方给的那一份)', [
  /settings_section_/u.test(bar),
  /linkedMapOf|mapOf\(/u.test(bar),
  /entries\.indexOfFirst/u.test(bar),
  /onPick\(entry\.key\)/u.test(bar),
], [false, false, true, true])

/* ── 收尾 ─────────────────────────────────────────────────────────────── */

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exitCode = failures === 0 ? 0 : 1
