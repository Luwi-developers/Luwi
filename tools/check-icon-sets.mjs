/**
 * 图标套的判据 (2026-11-22): 「切换 Luwi 图标」这一步最容易漏的不是代码, 而是**某一条路还在画旧图**
 *
 * 两类做错的样子都不响亮:
 *
 *   1. 某个 alias 少了 `android:icon` / `roundIcon`, 或者 `MainActivity` 还留着 LAUNCHER ——
 *      桌面上于是两个入口, 而"切图标"看着像没生效
 *   2. 某一处还在写死 `R.drawable.ic_launcher_foreground` —— 切到女仆那套之后, 球 / 开屏 / 组件 /
 *      通知里偏偏有一处还是鲸尾, 只有盯着那一处看才发现
 *
 * 跑法: node tools/check-icon-sets.mjs   (不需要设备)
 */

import { readFile, stat } from 'node:fs/promises'

const root = new URL('../', import.meta.url)

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

function expect(name, text, needed) {
  check(name, typeof text === 'string' && text.includes(needed), true)
}

function expectNot(name, text, banned) {
  check(name, typeof text === 'string' && text.includes(banned), false)
}

async function read(relative) {
  return readFile(new URL(relative, root), 'utf8')
}

async function exists(relative) {
  return stat(new URL(relative, root)).then(() => true).catch(() => false)
}

/* ── 一、清单: 两个 alias 承载桌面入口, MainActivity 不再带 LAUNCHER ───────── */

const manifest = await read('app/src/main/AndroidManifest.xml')
const aliases = [...manifest.matchAll(/<activity-alias[\s\S]*?<\/activity-alias>/gu)].map((m) => m[0])
check('清单里恰好两个 activity-alias', aliases.length, 2)

const byName = new Map()
for (const block of aliases) {
  const name = /android:name="([^"]+)"/u.exec(block)?.[1] ?? ''
  byName.set(name, block)
}

check('两个 alias 的名字', [...byName.keys()].sort(), ['.IconBuiltin', '.IconMaid'])

for (const name of ['.IconBuiltin', '.IconMaid']) {
  const block = byName.get(name) ?? ''
  check(`${name} 指向 MainActivity`, /android:targetActivity="\.MainActivity"/u.test(block), true)
  check(`${name} 带 MAIN`, block.includes('android.intent.action.MAIN'), true)
  check(`${name} 带 LAUNCHER`, block.includes('android.intent.category.LAUNCHER'), true)
  check(`${name} 有 icon`, /android:icon="@mipmap\//u.test(block), true)
  check(`${name} 有 roundIcon`, /android:roundIcon="@mipmap\//u.test(block), true)
  check(`${name} 是导出组件`, /android:exported="true"/u.test(block), true)
}

check(
  '女仆那套是放出来的缺省',
  /android:name="\.IconMaid"[\s\S]*?android:enabled="true"/u.test(byName.get('.IconMaid') ?? ''),
  true,
)
check(
  '内置那套初始是关的',
  /android:name="\.IconBuiltin"[\s\S]*?android:enabled="false"/u.test(byName.get('.IconBuiltin') ?? ''),
  true,
)

// MainActivity 本体那一块: 从 `<activity` 到 `/>` 或 `</activity>` 的第一段
const mainBlock = /<activity[\s\S]*?android:name="\.MainActivity"[\s\S]*?(?:\/>|<\/activity>)/u.exec(manifest)?.[0] ?? ''
check('MainActivity 本体不带 LAUNCHER', mainBlock.includes('android.intent.category.LAUNCHER'), false)
check('MainActivity 仍是导出的', mainBlock.includes('android:exported="true"'), true)
check('MainActivity 仍然 singleTop', mainBlock.includes('android:launchMode="singleTop"'), true)

/* ── 二、资源: 每套图标要的那几份都在 ──────────────────────────────────────── */

const resources = [
  'app/src/main/res/drawable-nodpi/ic_mark_maid.png',
  'app/src/main/res/drawable-nodpi/ic_launcher_maid_mono.png',
  'app/src/main/res/drawable-nodpi/ic_notification_maid.png',
  'app/src/main/res/mipmap-anydpi/ic_launcher_maid.xml',
  'app/src/main/res/drawable/ic_launcher_foreground.xml',
  'app/src/main/res/drawable/ic_notification.png',
]
for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  resources.push(`app/src/main/res/mipmap-${density}/ic_launcher_maid.webp`)
  resources.push(`app/src/main/res/mipmap-${density}/ic_launcher_maid_round.webp`)
  resources.push(`app/src/main/res/mipmap-${density}/ic_launcher_maid_foreground.webp`)
}
const missing = []
for (const relative of resources) {
  if (!(await exists(relative))) missing.push(relative)
}
check('图标套的资源齐全', missing, [])

const anydpi = await read('app/src/main/res/mipmap-anydpi/ic_launcher_maid.xml')
check('自适应图标引用了自己的前景', anydpi.includes('@mipmap/ic_launcher_maid_foreground'), true)
check('自适应图标引用了自己的单色层', anydpi.includes('@drawable/ic_launcher_maid_mono'), true)
check('自适应图标复用内置那条背景渐变', anydpi.includes('@drawable/ic_launcher_background'), true)

/* ── 三、运行时: 缺省与 alias 的字符串 ─────────────────────────────────────── */

const setting = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/IconSetting.kt')
const theme = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/IconTheme.kt')

check('缺省那一套是女仆', /val DEFAULT = MAID/u.test(setting), true)
check('设置文件名是 icon.json', /const val FILE = "icon.json"/u.test(setting), true)
check('内置那套的 alias', setting.includes('alias = ".IconBuiltin"'), true)
check('女仆那套的 alias', setting.includes('alias = ".IconMaid"'), true)
check('内置那套的墨迹比是 0.46', /markInkRatio = 0\.46f/u.test(setting), true)
check('内置那套染白', /markTintWhite = true/u.test(setting), true)
check('女仆那套不染', /markTintWhite = false/u.test(setting), true)
check('切换先启用目标', /return listOf\(to to true\) \+ keep/u.test(setting), true)
check('切换失败会回滚', /enforce\(context, previous\)/u.test(theme), true)
check('冷启动会对一次账', /fun sync\(context: Context\)/u.test(theme), true)

/* ── 四、五类位置都接了同一套 ─────────────────────────────────────────────── */

const ball = await read('app/src/main/java/io/github/yuloong07star/luwi/overlay/Ball.kt')
const overlay = await read('app/src/main/java/io/github/yuloong07star/luwi/overlay/OverlayService.kt')
const host = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/HostScreen.kt')
const widget = await read('app/src/main/java/io/github/yuloong07star/luwi/plugin/widget/WidgetChat.kt')
const bridge = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/PortalBridge.kt')
const client = await read('presets/luwi-portal/lib/client.js')

expect('球按套换算尺寸', ball, 'IconTheme.boxDpForInk')
expect('球在心跳里读 stamp', ball, 'IconTheme.stamp(context)')
// 光在 BallView.show 里判不算: OverlayService.refresh 才是"要不要叫它一趟"的地方 (2026-11-22 真机踩到)
expect('球的心跳把图标套算进重画档', overlay, 'IconTheme.stamp(this)')
expect('球的心跳真的用上那一档', overlay, '|| restyled')
expect('球贴的是当前套的位图', ball, 'IconTheme.markBitmap(context, set)')
expect('开屏画当前套的位图', host, 'IconTheme.markBitmap(context, iconSet)')
expect('开屏的盒子按墨迹算', host, 'IconTheme.splashBoxDp(iconSet)')
expect('组件取当前套的 mark', widget, 'IconTheme.markRes(context)')
expect('门户交 mark', bridge, 'put("mark", mark)')
expect('门户交 markVer', bridge, 'put("markVer", iconSet.id)')
expect('页面先用 mark 再兜底 MARK_PNG', client, 'if (mark === \'\') mark = MARK_PNG')
expect('页面缓存 mark', client, 'MARK_CACHE')
expect('页面按 markVer 记缓存', client, 'cachedMark.ver === markVer')
expect('页面把 mark 也算进搬图闸', client, 'var markReady = cachedMark && cachedMark.ver === markVer')

const notifyFiles = [
  'app/src/main/java/io/github/yuloong07star/luwi/host/DshHostService.kt',
  'app/src/main/java/io/github/yuloong07star/luwi/wake/WakeWordService.kt',
  'app/src/main/java/io/github/yuloong07star/luwi/lock/LockReplay.kt',
  'app/src/main/java/io/github/yuloong07star/luwi/overlay/OverlayService.kt',
  'app/src/main/java/io/github/yuloong07star/luwi/tool/LwNotify.kt',
]
for (const relative of notifyFiles) {
  const text = await read(relative)
  check(`${relative} 的通知小图标跟套走`, text.includes('IconTheme.notificationIcon('), true)
  expectNot(`${relative} 没有写死的通知图标`, text, '.setSmallIcon(R.drawable.ic_notification)')
}

/* ── 五、生成脚本还在, 且产物名与上面那几份对得上 ────────────────────────── */

const generator = await read('tools/make-icon-sets.py')
expect('生成脚本写 mark', generator, 'ic_mark_')
expect('生成脚本写 launcher', generator, 'ic_launcher_')
expect('生成脚本写通知', generator, 'ic_notification_')
expect('生成脚本写自适应 xml', generator, 'ic_launcher_{set_id}.xml')

const summary = `${checks - failures}/${checks}`
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} ${summary}`)
if (failures > 0) process.exit(1)
