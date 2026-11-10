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

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync, statSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  'readFileSync', 'statSync', 'appendFile',
  `${section}\nreturn { proactiveStartLine, proactiveGate, proactiveScreenGate, proactiveActingRefusal,`
    + ' proactiveScreenRefusal, proactiveSessionOf, proactiveActing, proactiveActingFrom,'
    + ' proactiveActingLabel, proactiveActingCache, proactiveRun, PROACTIVE_PRESET,'
    + ' PROACTIVE_SCREEN_DENIED, PROACTIVE_ACT_TABLE, PROACTIVE_COMMAND_DENIED,'
    + ' PROACTIVE_ACTING_REMIND, PROACTIVE_ACTING_ACT, PROACTIVE_ACTING_FULL,'
    + ' PROACTIVE_ACTING_TIERS, PROACTIVE_ACTING_CACHE_MS, PROACTIVE_AUDIT_FILE,'
    + ' PROACTIVE_STATE_FILE, PROACTIVE_WORKSPACE_NAME }',
)(
  () => '', async () => [], join, () => '', async () => {}, async () => {}, async () => {}, async () => {},
  readFileSync, statSync, appendFile,
)

/* 一个临时的 DSH_HOME: 档位读的是 `$DSH_HOME/lw/sim.json`, 判据让它读真文件 (与上线同一条路)
 *
 * 2026-11-10: 不再用 `mkdtemp(tmpdir())` —— 某些沙箱里 Node 在 `%TEMP%` 下建随机名字会 EPERM,
 * 而工作区的 `.lwtmp` 一定写得动. 名字带 pid, 多次跑不撞 */
async function tempDir(prefix) {
  const base = join(fileURLToPath(root), '.lwtmp')
  await mkdir(base, { recursive: true })
  for (let i = 0; i < 100; i += 1) {
    const candidate = join(base, `${prefix}${process.pid}-${i}`)
    try {
      await mkdir(candidate)
      return candidate
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
  }
  throw new Error('no temporary directory under .lwtmp')
}
const home = await tempDir('lw-proactive-')
process.env.DSH_HOME = home
await mkdir(join(home, 'lw'), { recursive: true })

/** 把 `sim.json` 写成某一档, 再把 3 s 缓存打掉 (判据不睡 3 秒) */
async function useTier(payload) {
  await writeFile(join(home, 'lw', 'sim.json'), JSON.stringify(payload))
  api.proactiveActingCache.at = 0
  api.proactiveActingCache.mtimeMs = -1
}

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
    line.includes('记着的事'),
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

/* ── 四、三张表 × 三档的硬闸 (2026-11-10) ────────────────────────────── */

check('startProactive 里没有一条建屏 / 选屏的路', [
  /lw_screen_create/u.test(startBody),
  /call\('screen'/u.test(startBody),
  /defaultDisplayId/u.test(startBody),
  /lw_screenshot/u.test(startBody),
], [false, false, false, false])
check('那道闸挂的是三表那一条', /ctx\.tools\.guard\(proactiveGate\)/u.test(host), true)
check('旧名字 (proactiveScreenGate) 还留着, 不引新代码去挂它', [
  /function proactiveScreenGate\(exec\)/u.test(section),
  /ctx\.tools\.guard\(proactiveScreenGate\)/u.test(host),
], [true, false])
check('三张表都在 (A 屏 / B 写动 / C 命令)', [
  api.PROACTIVE_SCREEN_DENIED.size,
  api.PROACTIVE_ACT_TABLE.size, // 23 + lw_persona (2026-11-10) = 24
  api.PROACTIVE_COMMAND_DENIED.has('lw_linux'),
  api.PROACTIVE_COMMAND_DENIED.has('bash'),
  api.PROACTIVE_COMMAND_DENIED.has('pwsh'),
], [21, 24, true, true, true])
check('三档字面量与设置页 / SimSetting 同一套', [
  api.PROACTIVE_ACTING_REMIND, api.PROACTIVE_ACTING_ACT, api.PROACTIVE_ACTING_FULL,
  api.PROACTIVE_ACTING_CACHE_MS,
], ['remind', 'act', 'full', 3000])

/** 一个主动场的模型调用 */
const proactiveCall = (name, args) => ({
  name,
  arguments: args ?? {},
  agent: { id: 'proactive-1', session: { meta: { agentPreset: 'proactive' } } },
})
/** 另一个会话里的同一个调用 */
const otherCall = (name, args) => ({
  name,
  arguments: args ?? {},
  agent: { id: 'ball-1', session: { meta: { agentPreset: 'custom' } } },
})
/** 一道闸的答案压成一个字: 放 / 拒 */
const verdict = (reason) => (reason === undefined ? 'allow' : 'deny')

/** 三档逐档跑一遍同样的那一批调用 */
async function acrossTiers(calls) {
  const rows = []
  for (const tier of ['remind', 'act', 'full']) {
    await useTier({ proactive: { acting: tier } })
    rows.push(calls.map(([name, args]) => verdict(api.proactiveGate(proactiveCall(name, args)))))
  }
  return rows
}

check('A 表 (屏): remind 拒 / act 拒 / full 放 (9 格)', await acrossTiers([
  ['lw_screen_create'], ['lw_screenshot'], ['lw_tap'],
]), [['deny', 'deny', 'deny'], ['deny', 'deny', 'deny'], ['allow', 'allow', 'allow']])

check('B 表 (写动): remind 拒 / act 放 / full 放', await acrossTiers([
  ['lw_files', { op: 'write', path: 'a.txt', text: 'x' }], ['lw_launch', { package: 'x' }],
  ['lw_notify', { text: 'x' }], ['lw_app_control', { op: 'forceStop', package: 'x' }],
]), [['deny', 'deny', 'deny', 'deny'], ['allow', 'allow', 'allow', 'allow'], ['allow', 'allow', 'allow', 'allow']])

check('B 表的只读那一面三档都放 (lw_files read / lw_system get / lw_clipboard get)', await acrossTiers([
  ['lw_files', { op: 'read', path: 'a.txt' }], ['lw_system', { op: 'get' }], ['lw_clipboard', { op: 'get' }],
]), [['allow', 'allow', 'allow'], ['allow', 'allow', 'allow'], ['allow', 'allow', 'allow']])

// 2026-11-10 (方案 F): `lw_sticker` 原来不在表里 (= 三档都放), 而它的 `op=fetch` 会外发请求并落盘 ——
// 列素材与贴一张都不动设备, 那一面算写动
check('B 表里 lw_sticker: list / say 三档都放, fetch 只在 act / full', await acrossTiers([
  ['lw_sticker', { op: 'list' }],
  ['lw_sticker', { op: 'say', id: '开心.png' }],
  ['lw_sticker', { op: 'fetch', url: 'https://example.com/a.png' }],
]), [
  ['allow', 'allow', 'deny'],
  ['allow', 'allow', 'allow'],
  ['allow', 'allow', 'allow'],
])

// 2026-11-10 (人格卡运行时读): 读三档都放; 写是改她自己的设定, 归写动 (remind 拒)
check('B 表里 lw_persona: read 三档都放, write / reset 只在 act / full', await acrossTiers([
  ['lw_persona', { op: 'read' }],
  ['lw_persona', { op: 'write', text: 'x' }],
  ['lw_persona', { op: 'reset' }],
]), [
  ['allow', 'deny', 'deny'],
  ['allow', 'allow', 'allow'],
  ['allow', 'allow', 'allow'],
])

check('op 取不到按写动处理 (fail-closed): remind 拒, act 放', await acrossTiers([
  ['lw_files', {}], ['lw_system', {}], ['lw_clipboard', { op: 'set', text: 'x' }],
]), [['deny', 'deny', 'deny'], ['allow', 'allow', 'allow'], ['allow', 'allow', 'allow']])

check('C 表 (命令): remind 拒 / act 放 / full 放', await acrossTiers([
  ['lw_linux', { op: 'run', command: 'id' }], ['bash', { command: 'id' }], ['pwsh', { command: 'id' }],
  ['present', {}],
]), [['deny', 'deny', 'deny', 'deny'], ['allow', 'allow', 'allow', 'allow'],
  ['allow', 'allow', 'allow', 'allow']])

check('三张表都不认识的工具一次都不碰会话身份 (读摘要 / 说话 / 看通知)', await (async () => {
  await useTier({ proactive: { acting: 'remind' } })
  return ['lw_calendar', 'lw_notifications', 'lw_wish', 'lw_say', 'lw_router', 'lw_take_photo']
    .map((name) => verdict(api.proactiveGate(proactiveCall(name))))
})(), ['allow', 'allow', 'allow', 'allow', 'allow', 'allow'])

check('别的会话里同名工具照旧 (这道闸只认主动场)', await (async () => {
  await useTier({ proactive: { acting: 'remind' } })
  return ['lw_screenshot', 'lw_files', 'lw_linux']
    .map((name) => verdict(api.proactiveGate(otherCall(name, { op: 'write' }))))
})(), ['allow', 'allow', 'allow'])

check('只凭会话 id 也认得出刚 create 出来的那一场', await (async () => {
  await useTier({ proactive: { acting: 'remind' } })
  api.proactiveRun.session = 'proactive-9'
  const viaId = api.proactiveGate({ name: 'lw_screen_create', arguments: {}, agent: { id: 'proactive-9', session: {} } })
  api.proactiveRun.session = null
  return verdict(viaId)
})(), 'deny')

check('未知档位串 / 缺键一律按 remind (最保守)', await (async () => {
  const got = []
  for (const payload of [{ proactive: { acting: 'FULL' } }, { proactive: { acting: 'god' } }, {}, { proactive: {} }]) {
    await useTier(payload)
    got.push(verdict(api.proactiveGate(proactiveCall('lw_screenshot'))))
  }
  return got
})(), ['deny', 'deny', 'deny', 'deny'])

check('旧布尔值只读迁移: allowActing true → act, false → remind', [
  api.proactiveActingFrom({ proactive: { allowActing: true } }),
  api.proactiveActingFrom({ proactive: { allowActing: false } }),
  api.proactiveActingFrom({ proactive: { acting: 'full', allowActing: false } }),
], ['act', 'remind', 'full'])

check('拒的回执分档: remind 说只提醒, act 撞屏说屏永远不碰', [
  api.proactiveActingRefusal('lw_say', 'remind', 'act').includes('remind-only tier'),
  api.proactiveActingRefusal('lw_tap', 'act', 'screen').includes('act tier'),
  api.proactiveActingRefusal('lw_tap', 'act', 'screen').includes('screen'),
  api.proactiveActingRefusal('lw_tap', 'remind', 'screen').includes('remind-only tier'),
], [true, true, true, true])

check('放行写一行审计 (A 表那次也记)', await (async () => {
  await useTier({ proactive: { acting: 'full' } })
  api.proactiveRun.session = 'proactive-audit'
  api.proactiveGate(proactiveCall('lw_screenshot', { displayId: 0 }))
  api.proactiveRun.session = null
  await new Promise((done) => setTimeout(done, 60))
  const path = join(home, 'lw', api.PROACTIVE_AUDIT_FILE)
  const text = await readFile(path, 'utf8').catch(() => '')
  return [text.includes('"tier":"full"'), text.includes('lw_screenshot'), text.includes('proactive-audit')]
})(), [true, true, true])

/* ── 四·五、开场正文按档位 (方案 §3.5) ────────────────────────────────── */

check('三档的开场正文各含对应那句', (() => {
  const remind = api.proactiveStartLine('看看今天', '/x.md', 'remind')
  const act = api.proactiveStartLine('看看今天', '/x.md', 'act')
  const full = api.proactiveStartLine('看看今天', '/x.md', 'full')
  return [
    remind.includes('只提醒'), remind.includes('不建虚拟屏'), remind.includes('不可屏幕控制'),
    act.includes('允许动手'), act.includes('屏不碰'),
    full.includes('全放开'), full.includes('建虚拟屏'),
  ]
})(), [true, true, true, true, true, true, true])
check('档位串不认识时开场按只提醒讲', api.proactiveStartLine('', '', 'god').includes('只提醒'), true)
check('档位的中文名与设置页那三行同一套字', [
  api.proactiveActingLabel('remind'), api.proactiveActingLabel('act'), api.proactiveActingLabel('full'),
], ['只提醒', '允许动手', '全放开'])

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
needed('记着的事')
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
needed('允许动手')
needed('全放开')
needed('lw_say')

// 2026-11-10 主人点出来的那一条: 主动场那份 persona 是 2026-11-05 写的, 比 lw_say 立起来早 ——
// 它当时教的是 lw_overlay op=burst 与 lw_sticker op=say. 那两条现在都是底层通道 (luwi 档第 16 条),
// 发言只走 lw_say, 所以这一段不许再教它们
check('persona 不再教底层通道 (lw_overlay op=burst / lw_sticker op=say)', [
  persona.includes('lw_overlay op=burst'),
  /lw_sticker op=say/u.test(persona),
  /op=burst/u.test(persona),
], [false, false, false])
// 2026-11-10 主人这一轮把口径说死了: 贴表情一律走 lw_say 的 sticker, lw_sticker 只留着 op=list
// 找素材, 它的 op=say 是宿主底层 —— 这三件事必须同时出现在 persona 里, 少一条就会退回去
check('persona 写死「表情只走 lw_say 的 sticker, lw_sticker 只 op=list」', [
  persona.includes('lw_say({ sticker'),
  persona.includes('op=list'),
  persona.includes('op=say'),
  persona.includes('底层'),
], [true, true, true, true])
check('persona 把 lw_speak / lw_overlay 标成底层通道', [
  persona.includes('lw_speak'),
  persona.includes('lw_overlay'),
  persona.includes('你不直接调'),
], [true, true, true])
check('persona 一次说几句走 lw_say 的 lines 数组 (同一个意群只调一次)', [
  persona.includes('lines 数组'),
  persona.includes('只调一次'),
  persona.includes('sticker'),
  persona.includes('speak: true'),
], [true, true, true, true])

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

check('pack-host 摆的 preset 表里有主动对话 (与 luwi / explore 同一批)', [
  /const presets = \[[^\]]*'proactive'/u.test(pack),
  /const presets = \[[^\]]*'explore'/u.test(pack),
], [true, true])
check('Kotlin 那张 PRESET_ROWS 有主动对话那一对', [
  /ROW_PROACTIVE = "preset-proactive"/u.test(custom),
  /ROW_PROACTIVE to "proactive"/u.test(custom),
], [true, true])
check('单测钉着这张表里的主动对话那一行', /"preset-proactive" to "proactive"/u.test(customTest), true)
check('tools/README 列了这个判据', /check-proactive\.mjs/u.test(toolsReadme), true)

/* ── 收尾 ─────────────────────────────────────────────────────────────── */

// 自取自清: 临时 home 在 `.lwtmp` 下, 跑完删掉
await rm(home, { recursive: true, force: true })
console.log('')
console.log(`${checks - failures} / ${checks} 条通过${failures === 0 ? '' : ` (${failures} 条红)`}`)
process.exit(failures === 0 ? 0 : 1)
