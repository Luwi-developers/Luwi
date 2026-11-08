/**
 * 设置页的「视觉纪律」判据 (2026-11-08 重做那一版)
 *
 * 背景: 这一版把配色、字阶、段行的排法全换了一遍, 而这些东西**坏了都不响亮** ——
 * 少一条 token 只是深色下某个控件变棕, 写死一个 14.sp 只是字号慢慢走岔, 加一条阴影只是
 * "看起来像别的应用"。所以把「不许做什么」写成可执行的断言, 与 check-settings-sections.mjs
 * 并列 (那一份管段数与折叠, 这一份管长什么样)
 *
 * 跑法: node tools/check-settings-visual.mjs   (不需要设备, 不读构建产物)
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (p) => readFile(new URL(p, root), 'utf8').catch(() => '')

const screen = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt')
const sectionTitle = await read('app/src/main/java/io/github/yuloong07star/luwi/scaffolds/SectionTitle.kt')
const palette = await read('app/src/main/java/io/github/yuloong07star/luwi/theme/LuwiPalette.kt')
const type = await read('app/src/main/java/io/github/yuloong07star/luwi/theme/LuwiType.kt')
const theme = await read('app/src/main/java/io/github/yuloong07star/luwi/theme/ThemeSettings.kt')
const spacing = await read('app/src/main/java/io/github/yuloong07star/luwi/constants/UiSpacing.kt')
const zh = await read('app/src/main/res/values-zh/strings.xml')
const en = await read('app/src/main/res/values/strings.xml')
const build = await read('app/build.gradle.kts')

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
/** 条件成立的条数 (用来断言"至少 N 处") */
const count = (text, re) => [...text.matchAll(re)].length

/* ── 一、配色与字阶都从 token 来 ─────────────────────────────────────── */

check('LuwiPalette 浅色覆盖 >= 13 个 token', count(palette, /^\s+[a-zA-Z]+ = Color\(0x/gmu) >= 26, true)

check('LuwiPalette 深浅两套都在', [
  /val light: Colors by lazy/u.test(palette),
  /val dark: Colors by lazy by lazy/u.test(palette) === false && /val dark: Colors by lazy/u.test(palette),
], [true, true])

check('控制器带上浅深两套色与字阶', [
  /lightColors = LuwiPalette\.light/u.test(theme),
  /darkColors = LuwiPalette\.dark/u.test(theme),
  /textStyles = LuwiType\.textStyles/u.test(await read('app/src/main/java/io/github/yuloong07star/luwi/ui/AppNav.kt')),
], [true, true, true])

check('字号只从 textStyles 来 (SettingsScreen 里没有 .sp 字面量)', [
  /[0-9]+\.sp/u.test(screen),
], [false])

check('颜色只从 colorScheme 来 (SettingsScreen 里没有 Color(0x))', [
  /Color\(0x/u.test(screen),
], [false])

check('没有阴影 (卡片靠 1dp 描边分层)', [
  /\.shadow\(/u.test(screen) || /\.shadow\(/u.test(palette),
], [false])

/** 只看真正的色值 (Color(0x...)), 注释里点名的那几个"要避开的蓝"不算 */
const hexValues = [...palette.matchAll(/Color\(0x([0-9A-Fa-f]{8})\)/gu)].map((m) => m[1].toUpperCase())
check('没有紫 / 靛这一类 AI 指纹蓝', hexValues.filter((h) => /6366F1|8B5CF6|7C3AED|3B82F6/u.test(h)), [])

/* ── 二、段行的排法 ───────────────────────────────────────────────────── */

check('段标题是竖排 (SectionTitle 里 Column 而不是并肩的 Row)', [
  /Column\(/u.test(sectionTitle),
  /SettingsSectionHeader/u.test(sectionTitle),
], [true, true])

// 二十段里第一段 (酒馆) 的内容由 LuwiTavern 画, 所以这一份里只数得到 19 个面板
check('每一段都套了 SettingsPanel (本页 19 段, 酒馆那段在 LuwiTavern)', count(screen, /SettingsPanel \{/gu), 19)

check('每段底下一条细线', count(screen, /SettingsHairline\(\)/gu) >= 1, true)

check('页面骨架不再统一给段间距', /itemSpacing = 0\.dp/u.test(screen), true)

check('全局间距常量没被顺手改 (别的页面也在用)', /val PageHorizontal = 12\.dp/u.test(spacing), true)

check('列表左右缩进走本页自己的 16dp', /horizontalPadding = SettingsSpace\.Inset/u.test(screen), true)

/* ── 三、小字不许再变长 ───────────────────────────────────────────────── */

/** 取一份 strings.xml 里指定前缀的条目 */
function strings(xml) {
  const map = new Map()
  for (const m of xml.matchAll(/<string name="([a-z0-9_]+)">(.*?)<\/string>/gu)) {
    map.set(m[1], m[2])
  }
  return map
}
const zhMap = strings(zh)
const enMap = strings(en)

/** 行内小字: 挂在 preference 的 summary 上的那些
 *  (段摘要 / 顶部菜单项 / 对话框正文 / 给模型的 prompt 都不是"行内小字", 各有各的宽度) */
const inline = [...screen.matchAll(/summary\s*=\s*(?:when\s*\{[^}]*)?(?:stringResource\()?R\.string\.(settings_[a-z0-9_]+)/gu)]
  .map((m) => m[1])
  .filter((k) => !/prompt$|dialog|_note$|_notice$/u.test(k))
  .filter((k) => !/^settings_section_/u.test(k))
  .filter((k) => !/^settings_menu_/u.test(k))
const uniq = [...new Set(inline)]

/** 一行能放多少字: 开关行 16, 箭头行 23 (2026-11-08 在 1080x2460 上量的)
 *  带 \n 的条目是刻意两行 (读数 + 第二行说明), 不参与 */
const over = uniq.filter((k) => {
  const v = zhMap.get(k) ?? ''
  return !v.includes('\\n') && v.length > 23
})
check(`行内小字都在一行内 (${uniq.length} 条, 超长的 ${over.length} 条)`, over, [])

const enOver = uniq.filter((k) => {
  const v = enMap.get(k) ?? ''
  return !v.includes('\\n') && v.length > 60
})
check(`英文行内小字都在一行内 (超长的 ${enOver.length} 条)`, enOver, [])

/** 段摘要: 二十条, 每条一句 */
const sectionKeys = [...zh.matchAll(/<string name="(settings_section_[a-z]+_summary)">(.*?)<\/string>/gu)]
  .map((m) => [m[1], m[2]])
const longSection = sectionKeys.filter(([, v]) => v.length > 27)
check(`段摘要不超过 27 字 (${sectionKeys.length} 条)`, longSection.map(([k]) => k), [])

/* ── 四、依赖与键集合 ─────────────────────────────────────────────────── */

check('没有新增 UI 依赖 (material3 仍不是本项目的)', [
  /material3/u.test(build),
], [false])

check('strings 键数没变 (加文案要走 check-explore 那一套)', [
  zhMap.size > 800,
  enMap.size === zhMap.size,
], [true, true])

/* ── 收尾 ─────────────────────────────────────────────────────────────── */

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exitCode = failures === 0 ? 0 : 1
