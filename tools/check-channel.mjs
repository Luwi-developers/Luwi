/**
 * root 通道那一条的判据 (2.8.1 #30)
 *
 * 这一条只证一件事: 「这条路由在不在」与「现在能不能要授权」不再是同一个答案. 从前 `isAvailable()`
 * 就是 `rootState() == true`, 于是没试过的机器上 root 那条路**根本不在** —— 首启不弹 su 保住了, 但主人
 * 在设置里点过「用 root 连接」也没有第二条路可走
 *
 * 三层, 由源码驱动:
 *
 *   1. **决策表真跑**: `accessStep()` 从 `RemoteAccessPermissionBackend.kt` 里抽出来. 它每行的条件
 *      (`granted` / `!available && !canPrompt`) 与三个布尔是同一种写法, 所以直接当 JS 跑, 穷举 8 种组合
 *      —— 改 Kotlin 不必改脚本, 脚本也不必抄第二份
 *   2. **四行真值**: 首启 / 点开被拒 / 已经授权 / 源码断言, 前三条按决策表跑一遍并数 `requestPermission`
 *      的次数 (那一步的位置由 `connect()` 里 `AccessStep.ASK -> if (!permission.requestPermission())`
 *      这句话钉着)
 *   3. **接线**: root 的 `isAvailable()` 真的看 `optedIn`、开关真的落盘并触发一次连接、被拒那句里带
 *      「被拒」且带真机 logcat 要的那半句
 *
 * 跑法: `node tools/check-channel.mjs`
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const backends = await read('app/src/main/java/io/github/yuloong07star/luwi/channel/RemoteAccessPermissionBackend.kt')
const channel = await read('app/src/main/java/io/github/yuloong07star/luwi/channel/PrivilegedChannel.kt')
const setting = await read('app/src/main/java/io/github/yuloong07star/luwi/channel/ChannelSetting.kt')
const screen = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt')

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

/* ── 一、决策表: 从源码抽出来真跑 ─────────────────────────────────────────── */

const stepStart = backends.indexOf('internal fun accessStep(')
if (stepStart < 0) throw new Error('accessStep is not in RemoteAccessPermissionBackend.kt')
const whenStart = backends.indexOf('when {', stepStart)
const whenEnd = backends.indexOf('\n}', whenStart)
if (whenStart < 0 || whenEnd < 0) throw new Error('accessStep has no when block')
const table = backends.slice(whenStart + 'when {'.length, whenEnd)

const branches = [...table.matchAll(/([^\n]+?)\s*->\s*AccessStep\.([A-Z]+)/g)]
  .map((one) => ({ when: one[1].trim(), step: one[2] }))

check(
  '决策表抽得出四条 (USE / SKIP / SKIP / ASK, 顺序也是判的顺序)',
  branches.map((one) => one.step),
  ['USE', 'SKIP', 'SKIP', 'ASK'],
)

// 条件原样当 JS 跑: Kotlin 的 `!` / `&&` 与这里同一种写法
const decide = new Function(
  'available',
  'canPrompt',
  'granted',
  [
    ...branches.map((one) => (one.when === 'else'
      ? `return ${JSON.stringify(one.step)}`
      : `if (${one.when}) return ${JSON.stringify(one.step)}`)),
    'return "NO_BRANCH"',
  ].join('\n'),
)

/** 这张表该给出的答案, 按卡片上那三条写的 (与上面的源码是两份实现, 故意对一遍) */
const wanted = (available, canPrompt, granted) => {
  if (granted) return 'USE'
  if (!available) return 'SKIP'
  if (!canPrompt) return 'SKIP'
  return 'ASK'
}

const combos = []
for (const available of [false, true]) {
  for (const canPrompt of [false, true]) {
    for (const granted of [false, true]) {
      combos.push([available, canPrompt, granted])
    }
  }
}
const tableRows = combos.map(([available, canPrompt, granted]) => {
  const step = decide(available, canPrompt, granted)
  return `${available ? 1 : 0}${canPrompt ? 1 : 0}${granted ? 1 : 0}:${step}`
})
const wantedRows = combos.map(([available, canPrompt, granted]) => {
  return `${available ? 1 : 0}${canPrompt ? 1 : 0}${granted ? 1 : 0}:${wanted(available, canPrompt, granted)}`
})
check('8 种组合逐条对上 (available/canPrompt/granted -> 那一步)', tableRows, wantedRows)

/* ── 二、四行真值: 那一句错误理由也从源码里取 ─────────────────────────────── */

/** Kotlin 里那条字面量, `$label` 按 root 那一格填 */
const literalOf = (pattern, label) => {
  const found = new RegExp(`"${pattern}[^\\n]*"`).exec(channel)
  if (!found) throw new Error(`找不到 ${pattern} 那条字面量 (PrivilegedChannel.kt)`)
  return found[0].slice(1, -1).split('\\"').join('"').split('$label').join(label)
}

const notTried = literalOf('root was not tried yet', 'root')
const refused = literalOf('\\$label was not granted \\(asked once, refused\\)', 'root')

/** 照 `connect()` 走一遍: 决策表决定问不问, 问就恰好一次 */
function runRoute(route) {
  const step = decide(route.available, route.canPrompt, route.granted)
  let asked = 0
  if (step === 'SKIP') return { step, asked, connected: false, error: notTried }
  if (step === 'ASK') {
    asked += 1
    if (!route.answer) return { step, asked, connected: false, error: refused }
  }
  return { step, asked, connected: true, error: null }
}

// ① 首启: 主人没点过开关, 这台机器也还没授权 —— 一次都不许问
const cold = runRoute({ available: false, canPrompt: false, granted: false, answer: false })
check(
  '首启: accessStep=SKIP, requestPermission 0 次, 理由说的是"还没问过"',
  [cold.step, cold.asked, cold.error === notTried && /not tried yet/.test(cold.error)],
  ['SKIP', 0, true],
)

// ② 点开开关之后: 两条路都判"在"(optedIn), 于是真去问一次, 被拒
const optedIn = runRoute({ available: true, canPrompt: true, granted: false, answer: false })
check(
  'opt-in 后被拒: accessStep=ASK, requestPermission 1 次, 理由含「被拒」',
  [
    optedIn.step,
    optedIn.asked,
    optedIn.error.includes('被拒'),
    optedIn.error.includes('root was not granted (asked once, refused)'),
  ],
  ['ASK', 1, true, true],
)

// ③ 已经授权: 直接用, 不再问
const granted = runRoute({ available: true, canPrompt: true, granted: true, answer: false })
check(
  '已授权: accessStep=USE, requestPermission 0 次, 连上',
  [granted.step, granted.asked, granted.connected],
  ['USE', 0, true],
)

// ④ 源码断言: 那个"在不在"里必须出现 optedIn (有人改回只看 rootState() 就红)
const availability = /override fun isAvailable\(\): Boolean = ([^\n]+)/.exec(backends)?.[1] ?? ''
check(
  '源码断言: root 的 isAvailable() 里命中 optedIn',
  [availability.includes('optedIn'), availability.trim()],
  [true, 'rootState() == true || optedIn'],
)

/* ── 三、接线: 两个判断真的分开, 开关真的接上 ─────────────────────────────── */

check(
  '两个判断各一格: 接口缺省 false, Shizuku 在那儿才谈得上问, root 只看开关',
  [
    backends.includes('fun canPrompt(): Boolean = false'),
    backends.includes('override fun canPrompt(): Boolean = isAvailable()'),
    backends.includes('override fun canPrompt(): Boolean = optedIn'),
  ],
  [true, true, true],
)

// Shizuku 没跑时"不在"先赢: 不该走到问那一步 (问也只会回 false, 却会换来一句"被拒")
const shizukuDead = runRoute({ available: false, canPrompt: false, granted: false, answer: false })
check(
  'Shizuku 没跑: accessStep=SKIP, requestPermission 0 次',
  [shizukuDead.step, shizukuDead.asked],
  ['SKIP', 0],
)

check(
  'connect() 照决策表走, 问那一步在 ASK 分支里, 且被拒那句写进 lastError / logcat',
  [
    channel.includes('accessStep(permission.isAvailable(), permission.canPrompt(), permission.isGranted())'),
    channel.includes('AccessStep.ASK -> if (!permission.requestPermission())'),
    channel.includes('lastError = reason') && channel.includes('Log.w(TAG, reason)'),
  ],
  [true, true, true],
)

check(
  '两条路"走不了"的理由不再共用一句 (root 只是还没问过)',
  [channel.includes('root was not tried yet'), channel.includes('"$label is not installed, or it is not running"')],
  [true, true],
)

check(
  '开关: 偏好文件里一个键, 读回填, 写落盘, 点开顺带连一次',
  [
    setting.includes('private const val ROOT_OPT_IN = "channel-root-opt-in"'),
    setting.includes('RootAccessBackend.optedIn = readRootOptedIn(app)'),
    setting.includes('preferences(context).edit().putBoolean(ROOT_OPT_IN, optedIn).apply()'),
    setting.includes('if (optedIn) connect(done) else refresh()'),
  ],
  [true, true, true, true],
)

check(
  '设置页: 那一行开关调 setRootOptedIn, 三种副标题各有自己的键',
  [
    screen.includes('ChannelSetting.setRootOptedIn(context, value)'),
    screen.includes('R.string.settings_channel_root_opt_in'),
    screen.includes('R.string.settings_channel_root_opt_in_on'),
    screen.includes('R.string.settings_channel_root_opt_in_off'),
    screen.includes('R.string.settings_channel_root_opt_in_refused'),
  ],
  [true, true, true, true, true],
)

console.log('')
console.log(`${checks - failures}/${checks} 条过`)
process.exit(failures === 0 ? 0 : 1)
