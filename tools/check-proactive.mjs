/**
 * 主动对话那一档的判据表 (2.8.0 B4-a)
 *
 * 这一批的四件东西**分开就会静默出问题**, 而它们都在仓库里, 不需要设备:
 *
 *   1. **排期骨架**: requestCode 43 与 41 / 42 不撞 / `proactive-schedule.json` 的四个键 /
 *      到点先拉宿主再投一行 (`source:"proactive"`) / 宿主服务起来就排上 —— "排期能起"
 *   2. **来源记号**: 应用 `VoiceInbox.SOURCE_PROACTIVE` 与宿主 `line.source === 'proactive'`
 *      是同一个字面量, 而且那一支排在命令表之前
 *   3. **主动场固定新开**: `startProactive` 只 `controller.create`, 不查浮标那本账, 不接别的会话
 *   4. **主动场不建虚拟屏** (13-4): 应用那一侧一条建屏的路都不走; 宿主 `startProactive` 也不建屏,
 *      而且主动场的屏幕类工具由 `proactiveScreenGate` 硬拒 —— 这里直接抽那两段纯函数真跑
 *   5. **预设**: `presets/proactive` 的 row id / config.id / order / persona 四步启动顺序 / 权限 /
 *      插件表 (不装 shell 与写文件那几个)
 *   6. **落位**: `pack-host` 那两份声明 / `CustomPresets.PRESET_ROWS` / 清单里的广播接收器
 *
 * 跑法: `node tools/check-proactive.mjs`
 * 它**直接取 `host-plugin/index.mjs` 里那一段源码来跑** (不复制第二份), 所以测的是上线那一份
 */

import { readFile, stat } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')
const exists = (path) => stat(new URL(path, root)).then(() => true, () => false)

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
const preset = await read('presets/proactive/cordis.patch.yml')
const schedule = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/ProactiveSchedule.kt')
const gateKotlin = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/ProactiveGate.kt')
const engine = await read('app/src/main/java/io/github/yuloong07star/luwi/automation/AutomationEngine.kt')
const exploreSchedule = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/ExploreSchedule.kt')
const inbox = await read('app/src/main/java/io/github/yuloong07star/luwi/voice/VoiceInbox.kt')
const service = await read('app/src/main/java/io/github/yuloong07star/luwi/host/DshHostService.kt')
const manifest = await read('app/src/main/AndroidManifest.xml')
const custom = await read('app/src/main/java/io/github/yuloong07star/luwi/host/CustomPresets.kt')
const customTest = await read('app/src/test/java/io/github/yuloong07star/luwi/host/CustomPresetsTest.kt')
const pack = await read('tools/pack-host.mjs')
const toolsReadme = await read('tools/README.md')

/* ── 抽主动对话那一段纯函数 ─────────────────────────────────────────────── */

const start = host.indexOf('/* ── 主动对话 (2.8.0 B4-a')
const end = host.indexOf('/* ── 探索 (2.7.8 批次 7')
if (start < 0 || end < 0 || end < start) throw new Error('the proactive section is not in host-plugin/index.mjs')
const section = host.slice(start, end)

const api = new Function(
  'readFile', 'readdir', 'join', 'dirname', 'mkdir', 'writeFile', 'rename', 'rm',
  `${section}\nreturn { proactiveStartLine, proactiveScreenGate, proactiveScreenRefusal,`
    + ' proactiveSessionOf, proactiveRun, PROACTIVE_PRESET, PROACTIVE_SCREEN_DENIED,'
    + ' PROACTIVE_STATE_FILE, PROACTIVE_WORKSPACE_NAME }',
)(
  () => '', async () => [], () => '', () => '', async () => {}, async () => {}, async () => {}, async () => {},
)

/* ── 一、排期骨架 (排期能起) ───────────────────────────────────────────── */

check('主动对话排期是一个独立的文件 (与探索拆开)', await exists(
  'app/src/main/java/io/github/yuloong07star/luwi/tool/ProactiveSchedule.kt',
), true)
check('requestCode 是 43', /private const val REQUEST = 43/u.test(schedule), true)
check('三个闹钟各用各的 requestCode (41 / 42 / 43)', [
  /ALARM_REQUEST = 41/u.test(await read('app/src/main/java/io/github/yuloong07star/luwi/automation/AutomationMonitors.kt')),
  /private const val REQUEST = 42/u.test(exploreSchedule),
  /private const val REQUEST = 43/u.test(schedule),
], [true, true, true])
check('配置文件名与卡片名是约定那两份', [
  /const val FILE = "proactive-schedule\.json"/u.test(schedule),
  /const val CARD = "proactive-card\.md"/u.test(schedule),
  /const val DEFAULT_AT = "09:30"/u.test(schedule),
], [true, true, true])
check('配置就那四个键 (enabled / times / unlock / last)',
  ['put("enabled"', 'put("times"', 'put("unlock"', 'put("last"'].every((key) => schedule.includes(key)),
  true)
check('`times` 空表 / 全坏都退回 09:30', /ifEmpty \{ listOf\(DEFAULT_AT\) \}/u.test(schedule), true)
check('到点先拉宿主, 等它起来才投', [
  // 2026-11-07: 传 onStarted —— 服务真的开始启动之后广播才 finish, 返回的也不再是裸 boolean
  /ExploreSchedule\.wakeHost\(context, onStarted = release\)/u.test(schedule),
  /DshHost\.status !is HostStatus\.Running/u.test(schedule),
], [true, true])
check('投的是 `source:"proactive"` 那一行', [
  /VoiceInbox\.append\(context, text, source = VoiceInbox\.SOURCE_PROACTIVE\)/u.test(schedule),
], [true])
check('精确档拿不到时退 setAndAllowWhileIdle (与另外两个闹钟同一条退路)', [
  /setExactAndAllowWhileIdle/u.test(schedule),
  /setAndAllowWhileIdle/u.test(schedule),
], [true, true])
check('宿主服务起来就排上 (关着就撤)', /ProactiveSchedule\.ensure\(this\)/u.test(service), true)
check('清单里那个接收器 exported=false', new RegExp(
  '<receiver\\s+android:name="\\.tool\\.ProactiveAlarmReceiver"\\s+android:exported="false"\\s*/>',
).test(manifest), true)
check('应用这一侧一条建屏的路都不走', [
  /lw_screen_create/u.test(schedule),
  /VirtualScreen/u.test(schedule),
  /screen_create/u.test(schedule),
], [false, false, false])

/* ── 一·五、B4-b: 30 分钟闸与静默时段 ─────────────────────────────────── */

check('30 分钟闸是一笔单独的账 (proactive-gate.json)', [
  /const val GAP_MINUTES = 30/u.test(gateKotlin),
  /const val GAP_MS = GAP_MINUTES \* 60_000L/u.test(gateKotlin),
  /const val FILE = "proactive-gate\.json"/u.test(gateKotlin),
  /fun open\(lastAt: Long, now: Long\): Boolean/u.test(gateKotlin),
], [true, true, true, true])

check('闸跨两个来源: 自动指令与主动排期走同一个投递口', [
  /ProactiveGate\.deliver\(context, now, VoiceInbox\.SOURCE_AUTOMATION\)/u.test(engine),
  /ProactiveGate\.deliver\(context, System\.currentTimeMillis\(\), VoiceInbox\.SOURCE_PROACTIVE\)/u.test(schedule),
], [true, true])

check('只有真的投进收件箱才记账 (写不进去不算开口)', [
  gateKotlin.indexOf('val seq = append()') > 0,
  gateKotlin.indexOf('Outcome.Failed') > gateKotlin.indexOf('val seq = append()'),
  gateKotlin.indexOf('write(context, now, source)') > gateKotlin.indexOf('Outcome.Failed'),
], [true, true, true])

check('手动「立刻跑一次」不查也不占这笔账 (B4-b ⑦)', [
  /fun fireNow\(context: Context, name: String\): String/u.test(engine),
  !/ProactiveGate/u.test(
    engine.slice(
      engine.indexOf('fun fireNow(context: Context, name: String): String'),
      engine.indexOf('\n    }', engine.indexOf('fun fireNow(context: Context, name: String): String')),
    ),
  ),
], [true, true])

check('静默时段保留在排期那一侧, 到点先看它再看宿主 (B4-b ⑨)', [
  /val quiet = quietWhy\(context, now\)/u.test(schedule),
  /save\(context, current\.copy\(last = Last\(now, "skipped", quiet\)/u.test(schedule),
  schedule.indexOf('val quiet = quietWhy') < schedule.indexOf('ExploreSchedule.wakeHost(context, onStarted = release)'),
], [true, true, true])

check('静默窗口读的是自动指令那一份设置 (缺省 23:00-07:00, 同一个解析器)', [
  /AutomationStore\.settings\(context\)/u.test(schedule),
  /PowerWindow\.parse\(it\)/u.test(schedule),
  /PowerWindow\.inside\(PowerWindow\.minutesOfDay\(now, zone\), parsed\)/u.test(schedule),
], [true, true, true])

check('30 分钟闸挡住时也记 skipped 与那一句读数', [
  /ProactiveGate\.blockedReason\(lastSpoken, now\)/u.test(schedule),
  /is ProactiveGate\.Outcome\.Blocked ->/u.test(schedule),
  /上一条主动投递才/.test(gateKotlin),
], [true, true, true])

/* ── 二、来源记号与分支 ───────────────────────────────────────────────── */

check('应用与宿主同一个来源字面量 (`proactive`)', [
  /const val SOURCE_PROACTIVE = "proactive"/u.test(inbox),
  /line\.source === 'proactive'/u.test(host),
], [true, true])
check('收件箱那条 `source:proactive` 支排在命令表之前', [
  host.indexOf("line.source === 'proactive'") > 0,
  host.indexOf("line.source === 'proactive'") < host.indexOf('const automated = line.source'),
], [true, true])
check('那一条支走 startProactive, 不碰命令表', /if \(line\.source === 'proactive'\) \{\s*return startProactive\(ctx, \{ text: line\.text, via: 'inbox' \}\)/u.test(host), true)

/* ── 三、主动场固定新开 ───────────────────────────────────────────────── */

const startBody = host.slice(
  host.indexOf('async function startProactive(ctx, options = {})'),
  host.indexOf('/* ── 探索 (2.7.8 批次 7'),
)
check('启动函数在', startBody.length > 0, true)
check('每一次都 controller.create (固定新开)', [
  /created = await controller\.create\(request\)/u.test(startBody),
  /voiceTargetCandidates/u.test(startBody) === false,
  /controller\.list/u.test(startBody) === false,
  /openBallConversation/u.test(startBody) === false,
], [true, true, true, true])
check('开场用 proactive 预设, 解析不了退 standard 并说明原因', [
  /PROACTIVE_PRESET = 'proactive'/u.test(section),
  /presets\.resolve\(PROACTIVE_PRESET\)/u.test(section),
  /fell back to standard/u.test(section),
  /agentPreset: preset\.id/u.test(startBody) || /agentPreset: presetId/u.test(startBody),
], [true, true, true, true])
check('会话记在 proactive.json 那份账上', [
  /const PROACTIVE_STATE_FILE = 'proactive\.json'/u.test(section),
  /await proactiveStateWrite\(\)/u.test(startBody),
], [true, true])
check('重启之后把上一场的记号接回来 (旧会话里那道闸继续生效)', [
  /async function proactiveStateRestore\(\)/u.test(section),
  /void proactiveStateRestore\(\)/u.test(host),
], [true, true])
check('先记这一场再投第一句 (guard 开场就认得出)', startBody.indexOf('proactiveRun.session = sessionId')
  < startBody.indexOf('await deliverToBall('), true)
check('开场正文带四步启动顺序与"可以沉默"', (() => {
  const line = api.proactiveStartLine('看看今天', '/x/lw/explore/20261105-0300.md')
  return [
    line.includes('最新探索摘要'),
    line.includes('记忆'),
    line.includes('今天的日历'),
    line.includes('通知摘要'),
    line.includes('决定要不要开口'),
    line.includes('保持沉默'),
    line.includes('/x/lw/explore/20261105-0300.md'),
    line.includes('不建虚拟屏'),
  ]
})(), [true, true, true, true, true, true, true, true])
check('卡是空的时候也有一段缺省正文', (() => {
  const line = api.proactiveStartLine('', '')
  return [line.includes('最新探索摘要'), line.includes('还没有')]
})(), [true, true])

/* ── 四、主动场不建虚拟屏 (13-4) ──────────────────────────────────────── */

check('startProactive 里没有一条建屏 / 选屏的路', [
  /lw_screen_create/u.test(startBody),
  /call\('screen'/u.test(startBody),
  /defaultDisplayId/u.test(startBody),
  /lw_screenshot/u.test(startBody),
], [false, false, false, false])
check('那道闸挂上了', /ctx\.tools\.guard\(proactiveScreenGate\)/u.test(host), true)

/** 一个主动场的模型调用 */
const proactiveCall = (name) => ({
  name,
  arguments: {},
  agent: { id: 'proactive-1', session: { meta: { agentPreset: 'proactive' } } },
})
check('主动场里建虚拟屏被拒 (13-4 的正面)', [
  typeof api.proactiveScreenGate(proactiveCall('lw_screen_create')),
  api.proactiveScreenGate(proactiveCall('lw_screen_create')).includes('never creates a virtual screen'),
], ['string', true])
check('主动场里别的屏幕类工具也拒 (读屏 / 点屏 / 管理屏)', [
  'lw_screenshot', 'lw_ui', 'lw_tap', 'lw_swipe', 'lw_screen_resize', 'lw_wait_text',
].map((name) => typeof api.proactiveScreenGate(proactiveCall(name))), [
  'string', 'string', 'string', 'string', 'string', 'string',
])
check('主动场里读摘要的工具不受这道闸影响', [
  api.proactiveScreenGate(proactiveCall('lw_files')),
  api.proactiveScreenGate(proactiveCall('lw_calendar')),
  api.proactiveScreenGate(proactiveCall('lw_notifications')),
  api.proactiveScreenGate(proactiveCall('lw_remember')),
], [undefined, undefined, undefined, undefined])
check('别的会话里屏幕类工具照旧 (这道闸只认主动场)', [
  api.proactiveScreenGate({
    name: 'lw_screen_create',
    agent: { id: 'ball-1', session: { meta: { agentPreset: 'custom' } } },
  }),
  api.proactiveScreenGate({ name: 'lw_screen_create', agent: { id: 'ball-2', session: {} } }),
], [undefined, undefined])
check('只凭会话 id 也认得出刚 create 出来的那一场', (() => {
  api.proactiveRun.session = 'proactive-9'
  const viaId = api.proactiveScreenGate({
    name: 'lw_screen_create',
    agent: { id: 'proactive-9', session: {} },
  })
  api.proactiveRun.session = null
  return typeof viaId
})(), 'string')
check('拒的那句话说得清这一档只提醒', api.proactiveScreenRefusal('lw_tap').includes('only reads summaries and speaks'), true)

/* ── 五、预设那一段 ───────────────────────────────────────────────────── */

/** 一份 patch 里开头那段 `- insert:` (到下一个顶层 `- ` 之前) */
function insertBlock(source) {
  const lines = source.split('\n')
  const at = lines.findIndex((line) => line.startsWith('- insert:'))
  if (at < 0) return ''
  let stop = lines.length
  for (let i = at + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('- ')) {
      stop = i
      break
    }
  }
  return lines.slice(at, stop).join('\n')
}

/** 一份 insert 段里 plugins 那些 10 空格的行 */
function pluginRows(block) {
  const lines = block.split('\n')
  const at = lines.findIndex((line) => line.trimStart() === '- id: persona')
  if (at < 0) return []
  const rows = lines.slice(at)
  while (rows.length > 0 && rows[rows.length - 1].trim() === '') rows.pop()
  return rows
    .map((line) => /^ {10}- id: (.+)$/u.exec(line)?.[1])
    .filter((name) => name !== undefined)
}

const proactiveBlock = insertBlock(preset)
check('预设文件有那段 insert', proactiveBlock.startsWith('- insert:'), true)
check('行 id 是 preset-proactive', proactiveBlock.includes('- id: preset-proactive'), true)
check('config.id 是 proactive', /\n {8}id: proactive\n/u.test(proactiveBlock), true)
check('显示名就是主动对话', proactiveBlock.includes('name: 主动对话'), true)
check('order 是 8', /\n {8}order: 8\n/u.test(proactiveBlock), true)

const persona = proactiveBlock.slice(proactiveBlock.indexOf('prefix: |-'), proactiveBlock.indexOf('suffix: |-'))
const needed = (phrase) => check(`persona 里有「${phrase}」`, persona.includes(phrase), true)
needed('启动顺序')
needed('最新探索摘要')
needed('记忆')
needed('今天的日历')
needed('通知摘要')
needed('决定要不要开口')
needed('保持沉默')
needed('不可 shell')
needed('不可写文件')
needed('不可屏幕控制')
needed('不可 App 控制')
needed('固定新开')
needed('不建虚拟屏')

const rows = pluginRows(proactiveBlock)
check('预设里装了 persona / agent-instructions / 只读检索 / compaction', [
  rows.includes('persona'),
  rows.includes('agent-instructions'),
  rows.includes('tool-fs-search'),
  rows.includes('compaction'),
], [true, true, true, true])
check('预设里不装 shell / 写文件 / 子代理 / web 那几行 (默认只提醒)', [
  ['tool-bash', 'tool-pwsh', 'tool-fs', 'tool-jobs', 'tool-web', 'delegation', 'planning']
    .filter((name) => rows.includes(name)),
], [[]])
check('package.json 指向同一份 patch', JSON.parse(await read('presets/proactive/package.json'))
  .dsh.bundle.patch, './cordis.patch.yml')
check('README 写了四步启动顺序与"不建虚拟屏"', [
  (await read('presets/proactive/README.md')).includes('最新探索摘要'),
  (await read('presets/proactive/README.md')).includes('不建虚拟屏'),
], [true, true])

/* ── 六、落位 ─────────────────────────────────────────────────────────── */

check('pack-host 摆两份声明 (explore + proactive)', /const presets = \['explore', 'proactive'\]/u.test(pack), true)
check('Kotlin 那张 PRESET_ROWS 有主动对话那一对', [
  /ROW_PROACTIVE = "preset-proactive"/u.test(custom),
  /ROW_PROACTIVE to "proactive"/u.test(custom),
], [true, true])
check('单测钉着这张表里的主动对话那一行', /"preset-proactive" to "proactive"/u.test(customTest), true)
check('tools/README 列了这个判据', /check-proactive\.mjs/u.test(toolsReadme), true)

/* ── 收尾 ─────────────────────────────────────────────────────────────── */

console.log('')
console.log(`${checks - failures} / ${checks} 条通过${failures === 0 ? '' : ` (${failures} 条红)`}`)
process.exit(failures === 0 ? 0 : 1)
