/**
 * 「她记着你哪些事」两侧一致的判据 (2.8.0 球是门户)
 *
 * 这一份钉的是**两处实现必须说同一个形状**:
 *
 *   1. 宿主那一侧 (`host-plugin` 的 `lw_wish` / `readWishes` / `wishes.json`)
 *   2. 应用那一侧 (`tool/Wishes.kt` 读它、设置页「活动 → 她记着你哪些事」列它、点一下删它)
 *
 * 任何一边改了字段名 (what / due / id / said / snoozeUntil), 另一边就会静默读不到 —— 界面上只是
 * "还没记着什么事", 而她那边照旧在提醒。这类不一致只有对着源码才看得出来
 *
 * 跑法: `node tools/check-knows.mjs`   (不需要设备)
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

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

const host = await read('host-plugin/index.mjs')
const wishes = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/Wishes.kt')
const screen = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt')
const router = await read('tools/check-router.mjs')
const zh = await read('app/src/main/res/values-zh/strings.xml')
const en = await read('app/src/main/res/values/strings.xml')

/* ── 一、宿主那一侧 ─────────────────────────────────────────────────────── */

check('宿主有 lw_wish 工具', host.includes("name: 'lw_wish'"), true)
check('宿主有 lw_slang 工具', host.includes("name: 'lw_slang'"), true)
check('wishes 落在 lw/wishes.json', host.includes("join(home, 'lw', 'wishes.json')"), true)
check('写入上限是 64 条', host.includes('const WISH_MAX = 64'), true)

/* ── 二、应用那一侧读的是同一个文件、同一批字段 ─────────────────────────── */

check('应用读的是 lw/wishes.json', wishes.includes('"$DIRECTORY/$FILE_NAME"') && wishes.includes('FILE_NAME = "wishes.json"'), true)
for (const field of ['what', 'due', 'id', 'said', 'snoozeUntil']) {
  check(`应用读得到 ${field}`, wishes.includes(`"${field}"`), true)
}
check('宿主也写这五个字段', ['what', 'due', 'id', 'said', 'snoozeUntil'].every((one) => host.includes(one)), true)

/* ── 三、设置页那一节 ───────────────────────────────────────────────────── */

check('活动段里有「她记着你哪些事」', screen.includes('R.string.settings_activity_knows'), true)
check('有一个 KnowsItems', screen.includes('private fun KnowsItems()'), true)
check('点一下走 Wishes.remove', screen.includes('Wishes.remove(context, one.id)'), true)
check('两份 strings 都有空态那一句', [
  zh.includes('settings_activity_knows_empty'),
  en.includes('settings_activity_knows_empty'),
], [true, true])
check('两份 strings 都有条数那一句', [
  zh.includes('settings_activity_knows_count'),
  en.includes('settings_activity_knows_count'),
], [true, true])

/* ── 四、判断层读的是同一份 ─────────────────────────────────────────────── */

check('judgeRouter 的判据里覆盖了未了的事', router.includes("kind: 'wish'"), true)
check('宿主判断层读 wishes.json 的那条路还在', host.includes("readRouterJson(join(lw, 'wishes.json'))"), true)

/* ── 五、黑话那一份 ─────────────────────────────────────────────────────── */

check('slang 落在 lw/slang.json', host.includes("join(home, 'lw', 'slang.json')"), true)
check('slang.md 落在 lw/slang.md', host.includes("join(home, 'lw', 'slang.md')"), true)
check('只有 confirmed 进 markdown', host.includes("one?.status === 'confirmed'"), true)

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
