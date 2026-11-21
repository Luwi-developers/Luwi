/**
 * 探索那一档的判据表 (2.7.8 批次 7)
 *
 * 这一批的四件东西**分开就会静默出问题**, 而它们都在仓库里, 不需要设备:
 *
 *   1. **预设那一段** (`presets/explore/cordis.patch.yml`): 行 id / id / order 与 plugins 那 19 行 ——
 *      plugins 少一行就是"探索里有一类工具用不了", 而 persona 换掉就是"三条红线不在那一档里"
 *   2. **persona 与摘要口径**: 三条红线、软红线、五节摘要、记忆那几条 (2026-10-18 起候选卡下线,
 *      值得留下的由它自己用记忆插件写) —— 它们是**这一档唯一的闸**
 *      (D9 拍板闸在提示词层), 漂开一个字都没有第二道闸兜住
 *   3. **预算**: 30 / 60 / 3 / 两个范围 / 8000 字 / 留 30 份, 以及 [exploreBudget] 那张真值表
 *      (59 / 60 / 61 步, 到点前一拍与当拍, over 之后不再判)
 *   4. **落位与收尾**: 工作区注册路 / 省电只当读数 (2026-10-26 起不再有一道闸) / 数步只数不拒 /
 *      `lw_explore` 的工具面 / 摘要的文件形状
 *   5. **预算透传** (2.7.9 第 8 条 T4): 排期文件的两个键 → 收件箱那一行 → 宿主 `startExplore`,
 *      三处的键名 / 缺省 / 范围必须一致, 老文件 (没有那两个键) 仍落 30 / 60
 *   6. **工作区与读数** (2.7.9 T5): 宿主起来就注册 `Luwi` 工作区、status 四项写进 `explore.json`、
 *      设置页读得到、排期没开成时有一条通知、最近一份摘要能在应用里打开
 *   7. **屏所有权与持久化** (2.8.0 B2-a): 探索场建屏登记 displayId、`explore.json` 的 `screens` 账、
 *      四条释放路 (步数 / deadline / finish+stub / 重启) 只碰这一场的屏
 *
 * 跑法: `node tools/check-explore.mjs`
 * 它**直接取 `host-plugin/index.mjs` 里那一段源码来跑** (不复制第二份), 所以测的是上线那一份
 */

import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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
const preset = await read('presets/explore/cordis.patch.yml')

/**
 * 探索那一档的 plugins 行**该是哪 19 条** (persona 之后那些)
 *
 * 2026-10-18 手机/视频那两份预设下线之后, 这份名单就没有仓库里的对照物了 —— 于是把它写成字面量:
 * 少一条的现象是"探索里有一类工具用不了", 而这一条正是 D9 说的"一个工具都不删"
 */
const EXPECTED_PLUGINS = [
  'agent-instructions', 'tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-jobs',
  'skill-filesystem', 'tool-skill', 'command-goal', 'tool-goal', 'planning', 'compaction',
  'delegation', 'tool-ask-user', 'tool-todo', 'tool-web', 'present', 'tool-plugin-manager',
]

/* ── 抽那一段纯函数 (预算 / 摘要名 / 开场正文) ─────────────────────────── */

const start = host.indexOf('/* ── 探索 (2.7.8 批次 7')
const end = host.indexOf('/* ── 余额 (2026-10-16')
if (start < 0 || end < 0 || end < start) throw new Error('the explore section is not in host-plugin/index.mjs')
const section = host.slice(start, end)

/**
 * 抽出来的那一段读不到模块级的 `ROUTER_EVENT_BEFORE_DEFAULT` (它在判断层那一段里), 于是手递一个值
 *
 * 两处必须一致 —— 漂开的样子是"探索交了一条 event, 宿主按另一个缺省判"; 下面有一条判据钉着它
 */
const EVENT_BEFORE_DEFAULT = 15

/**
 * 判断层那张桌面表 (`ROUTER_HOME_PACKAGES`) 直接从宿主那一份源码里取
 *
 * 第二轮 B 要探索与判断层**共用一张表**: 那两张表只差一步就会漂 (一边加了新 ROM 的桌面, 另一边
 * 还当成"探索走到了这个应用"), 所以判据吃的是宿主真跑的那一份, 不是抄一份名单在这里
 */
function hostSet(name) {
  const at = host.indexOf(`const ${name} = new Set([`)
  if (at < 0) throw new Error(`${name} is not in host-plugin/index.mjs`)
  const body = host.slice(at, host.indexOf('])', at))
  return new Set([...body.matchAll(/'([^']+)'/gu)].map((one) => one[1]))
}

const ROUTER_HOME_PACKAGES = hostSet('ROUTER_HOME_PACKAGES')

/**
 * 点按效果那几样也在那一段外面 (落实表 #32 / #37: 账与"连着几条算停"写在点按那一层), 同样手递
 *
 * `TAP_EFFECT_STREAK` 两处必须同一个数 —— 漂开的样子是"status 说该停, 而 lw_tap 还在发".
 * #37 起它数的是连着几条 `recover=giveup` (不再是 unchanged), 刹车那一档仍数 unchanged
 */
const TAP_EFFECT_STREAK = 2

const api = new Function(
  'readFile', 'readdir', 'join', 'dirname', 'mkdir', 'writeFile', 'rename', 'rm',
  'ROUTER_EVENT_BEFORE_DEFAULT', 'ROUTER_HOME_PACKAGES', 'TAP_EFFECT_STREAK', 'tapEffectLog',
  `${section}\nreturn { exploreBudget, exploreClamp, exploreSummaryName, exploreStartLine,`
    + ' exploreCheckRow, exploreStepsFrom, exploreTaskText, EXPLORE_CARD_TAIL,'
    + ' exploreMemoryLimit, exploreMemoryText, exploreMemoryIntent, exploreMemoryOpen,'
    + ' exploreMemoryStep, exploreMemoryFor, exploreMemoryHint, exploreMemoryCounts,'
    + ' exploreMemoryStatus, exploreMemoryEffect, exploreMemoryTapText,'
    + ' exploreMemoryHash, exploreMemorySeal, exploreMemoryMask, exploreMemoryBare,'
    + ' exploreMemorySensitive, exploreMemoryShell, exploreMemorySeen, exploreMemoryOnDisplayPkg,'
    + ' exploreMemoryDropDisplay, exploreMemoryForgetDisplays, exploreMemoryBlankEntry,'
    + ' exploreMemoryDelivered, exploreReset,'
    + ' EXPLORE_MEMORY_MAX_DEFAULT, EXPLORE_MEMORY_MAX_RANGE, EXPLORE_MEMORY_CONFIRMED,'
    + ' EXPLORE_MEMORY_TEXT_CHARS, EXPLORE_MEMORY_INTENT_CHARS, EXPLORE_MEMORY_HASH_CHARS,'
    + ' EXPLORE_MEMORY_ROW_CHARS, EXPLORE_MEMORY_PRESSED, EXPLORE_MEMORY_SECRET,'
    + ' EXPLORE_MEMORY_SENSITIVE_PARTS, EXPLORE_MEMORY_SENSITIVE_PACKAGES,'
    + ' EXPLORE_MINUTES_DEFAULT, EXPLORE_MINUTES_RANGE,'
    + ' EXPLORE_STEPS_DEFAULT, EXPLORE_STEPS_RANGE, EXPLORE_SUMMARY_CHARS,'
    + ' EXPLORE_SUMMARIES_KEPT, EXPLORE_TICK_MS, EXPLORE_WORKSPACE_NAME,'
    + ' EXPLORE_PRESET, EXPLORE_TASK_FILE, EXPLORE_TASK_CHARS, EXPLORE_STATE_FILE,'
    + ' EXPLORE_EFFECTS_KEPT, exploreEffectsFor, exploreEffectReason }',
)(
  () => '', async () => [], () => '', () => '', async () => {}, async () => {}, async () => {},
  async () => {}, EVENT_BEFORE_DEFAULT, ROUTER_HOME_PACKAGES, TAP_EFFECT_STREAK, [],
)

check('event 缺省 15 分钟, 这一侧与宿主那一个数一致', [
  new RegExp(`const ROUTER_EVENT_BEFORE_DEFAULT = ${EVENT_BEFORE_DEFAULT}\\b`, 'u').test(host),
], [true])

/* ── 一、预设那一段 ────────────────────────────────────────────────────── */

/** 一份 patch 里开头那段 `- insert:` (到下一个顶层 `- ` 之前, 与 Kotlin 那个 `insertBlock` 同一个认法) */
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

/** 一份 insert 段里 plugins 那些行 (从 `<10 空格>- id: agent-instructions` 开始, 到段尾) */
function pluginRows(block) {
  const lines = block.split('\n')
  const at = lines.findIndex((line) => line.trimStart() === '- id: agent-instructions')
  if (at < 0) return []
  // 段尾可能留着文件末尾那一两个空行: 它们不是 plugins 的哪一行
  const rows = lines.slice(at)
  while (rows.length > 0 && rows[rows.length - 1].trim() === '') rows.pop()
  return rows
}

const exploreBlock = insertBlock(preset)
check('预设文件有那段 insert', exploreBlock.startsWith('- insert:'), true)
check('行 id 是 preset-explore', exploreBlock.includes('- id: preset-explore'), true)
check('config.id 是 explore', /\n {8}id: explore\n/u.test(exploreBlock), true)
check('显示名就是探索模式', exploreBlock.includes('name: 探索模式'), true)
check('order 是 7', /\n {8}order: 7\n/u.test(exploreBlock), true)
check('persona 那一行在 (prefix 与 suffix 都在)', [
  exploreBlock.includes('- id: persona'),
  exploreBlock.includes('prefix: |-'),
  exploreBlock.includes('suffix: |-'),
], [true, true, true])
check(
  'plugins 的 19 行一条不少、顺序也不变 (一个工具都不删, D9)',
  pluginRows(exploreBlock)
    // 只认 `plugins:` 那一层的 10 个空格: 组里的子行 (plan-mode / compaction-basic …) 更深
    .map((line) => /^ {10}- id: (.+)$/.exec(line)?.[1])
    .filter((name) => name !== undefined),
  EXPECTED_PLUGINS,
)

/* ── 二、persona 与摘要口径 ─────────────────────────────────────────────── */

const persona = exploreBlock.slice(exploreBlock.indexOf('prefix: |-'), exploreBlock.indexOf('suffix: |-'))
const needed = (phrase) => check(`persona 里有「${phrase}」`, persona.includes(phrase), true)
needed('这一趟的目标 (不是"完成任务")')
needed('不对任何应用做不可逆操作')
needed('不改任何已有文件')
needed('不发任何信息')
needed('不输入、不点正向确认')
needed('lw_ui (无障碍树')
needed('收尾只走 lw_explore')
needed('已确认事实')
needed('仍不确定的点')
needed('下一场建议优先探索')
needed('风险与拦截记录')
needed('证据引用')
needed('不要用别的工具写这份摘要')
needed('memory_save')
needed('sensitivity: high')
needed('临时界面状态')
// 2.7.8 批次 8: 收尾写下一场任务卡 + 那条主动对话走自动指令 (不走 schedule_create)
needed('nextTask')
needed('lw_automation')
needed('schedule_create')
// 2026-11-07 晚: 收尾第三样 —— "接下来该盯什么"由探索交给判断层 (主人: 检测的内容应由探索时加上)
// 2026-11-10 (方案 C): 从"允许交"收紧成"默认要交", 判法三种; 实在没有就在摘要里写明为什么
needed('checks:')
needed('至少交一条你最有把握的')
needed('为什么没有')
needed('{"kind":"event"')
needed('画像里"看到的"与"推断的"分开写')

const toolFace = host.slice(host.indexOf("name: 'lw_explore'"), host.indexOf("name: 'lw_events_subscribe'"))
check('lw_explore 的说明里也念到了那五节 (两处都要)', [
  toolFace.includes('已确认事实'),
  toolFace.includes('仍不确定的点'),
  toolFace.includes('下一场建议优先探索'),
  toolFace.includes('风险与拦截记录'),
  toolFace.includes('证据引用'),
], [true, true, true, true, true])
check('工具说明里写清"三条红线工具面不拦"', [
  toolFace.includes('live in this preset') || toolFace.includes('prompt text'),
  toolFace.includes('does not check them') || toolFace.includes('cannot enforce'),
], [true, true])
check('工具说明里写清摘要不许用别的工具写', toolFace.includes('do not write that report'), true)

/* ── 三、预算常数与那张真值表 ─────────────────────────────────────────── */

check('缺省 30 分钟 / 60 步', [
  api.EXPLORE_MINUTES_DEFAULT,
  api.EXPLORE_STEPS_DEFAULT,
], [30, 60])
check('两个范围就是 1..180 与 1..1000', [api.EXPLORE_MINUTES_RANGE, api.EXPLORE_STEPS_RANGE], [[1, 180], [1, 1000]])
check('摘要 8000 字 / 留 30 份', [
  api.EXPLORE_SUMMARY_CHARS,
  api.EXPLORE_SUMMARIES_KEPT,
], [8000, 30])
check('到点那一拍是 5 秒', api.EXPLORE_TICK_MS, 5000)
check('工作区名是 Luwi (D10 改口径), 预设 id 是 explore', [
  api.EXPLORE_WORKSPACE_NAME,
  api.EXPLORE_PRESET,
], ['Luwi', 'explore'])

const now = 1_760_000_000_000
const run = (over, steps, stepLimit, deadline) => ({ session: 's1', over, steps, stepLimit, deadline })
const table = [
  [api.exploreBudget(run(false, 59, 60, now + 1000), now).due, null],
  [api.exploreBudget(run(false, 59, 60, now + 1000), now).stepsLeft, 1],
  [api.exploreBudget(run(false, 60, 60, now + 1000), now).due, 'steps'],
  [api.exploreBudget(run(false, 61, 60, now + 1000), now).due, 'steps'],
  [api.exploreBudget(run(false, 61, 60, now + 1000), now).stepsLeft, 0],
  [api.exploreBudget(run(false, 0, 60, now + 1), now).due, null],
  [api.exploreBudget(run(false, 0, 60, now), now).due, 'time'],
  [api.exploreBudget(run(false, 0, 60, now - 5000), now).remainingMs, 0],
  [api.exploreBudget(run(true, 60, 60, now), now).due, null],
  [api.exploreBudget(run(true, 0, 60, now + 1000), now).active, false],
  [api.exploreBudget({ session: null }, now), { active: false, due: null, remainingMs: 0, stepsLeft: 0 }],
]
for (const [got, want] of table) check(`exploreBudget: ${JSON.stringify(got)}`, got, want)

check('时长与步数的夹取 (认不出来的给缺省, 认出来的夹进范围)', [
  api.exploreClamp(undefined, api.EXPLORE_MINUTES_RANGE, 30),
  api.exploreClamp(0, api.EXPLORE_MINUTES_RANGE, 30),
  api.exploreClamp(500, api.EXPLORE_MINUTES_RANGE, 30),
  api.exploreClamp('45', api.EXPLORE_MINUTES_RANGE, 30),
  api.exploreClamp('abc', api.EXPLORE_MINUTES_RANGE, 30),
  api.exploreClamp(0, api.EXPLORE_STEPS_RANGE, 60),
  api.exploreClamp(1001, api.EXPLORE_STEPS_RANGE, 60),
], [30, 1, 180, 45, 30, 1, 1000])

/* ── 四、工作区与预设 ─────────────────────────────────────────────────── */

check('工作区那一路泛化之后探索也走得通', [
  /async function ensureChannelWorkspace\(ctx, name, state\)/u.test(host),
  /async function ensureExploreWorkspace\(ctx\) \{\n {2}return ensureChannelWorkspace\(ctx, EXPLORE_WORKSPACE_NAME, exploreWorkspaceState\)/u.test(host),
  /entity = await registry\.create\(directory\)/u.test(host),
  /const workspace = await ensureExploreWorkspace\(ctx\)/u.test(host),
], [true, true, true, true])
check('建会话时把工作区 id 交出去 (否则落未分组)', [
  /\.\.\.ballCreatePlace\(workspace\),\n {4}\.\.\.\(preset\.id === undefined/u.test(host),
], [true])
check('预设解析不了就退 standard, 并把原因记进读数', [
  /presets\.resolve\(EXPLORE_PRESET\)/u.test(host),
  /fell back to standard/u.test(host),
  /exploreState\.presetWhy = preset\.why/u.test(host),
], [true, true, true])
check('不叠权限档也不 deny 工具 (D9)', [
  /agentPreset: preset\.id/u.test(host),
  !/readOnly: true/u.test(section),
  !/toolFilter/u.test(section),
], [true, true, true])

/* ── 五、省电只当读数 (2026-10-26 主人: "探索功能当前被省电模式阻止启动，看能不能忽略省电") ── */

check('省电探针还在 (给 status 与设置页读数) 但它不再拒', [
  /call\('wakeword', \{ op: 'status' \}\)/u.test(section),
  /status\?\.powerSave === true/u.test(section),
  !/refused: 'powerSave'/u.test(section),
  !/the phone is in power save mode right now/u.test(section),
], [true, true, true, true])
check('探针抛错只记 powerSaveUnknown, 仍照开', [
  /powerSave: null, why: String\(error\?\.message \?\? error\)/u.test(section),
  /if \(!power\.known\) exploreState\.powerSaveUnknown = true/u.test(section),
], [true, true])
check('status 里带着 powerSave 那一行读数', /powerSave: power\.powerSave,/u.test(section), true)

/* ── 六、数步 (只数不拒) ──────────────────────────────────────────────── */

const guard = section.slice(section.indexOf('function exploreStepGuard(exec)'), section.indexOf('async function exploreTick'))
check('guard 只认这一场 (会话 id 不同就什么都不做)', [
  /if \(exploreRun\.session === null\) return undefined/u.test(guard),
  /if \(sessionIdOf\(exec\) !== exploreRun\.session\) return undefined/u.test(guard),
  /if \(exploreRun\.over === true\) return undefined/u.test(guard),
], [true, true, true])
check('数一步, 每五步落一次盘', [
  /exploreRun\.steps \+= 1/u.test(guard),
  /exploreRun\.steps % 5 === 0/u.test(guard),
], [true, true])
check('提醒只发一次 (置 reminded 再发)', [
  /exploreRun\.steps === exploreRun\.stepLimit && !exploreRun\.reminded/u.test(guard),
  /exploreRun\.reminded = true/u.test(guard),
], [true, true])
check('guard 一个字符串都不返回 (不做硬闸, D9)', /\n {2}return `/u.test(guard), false)
check('那道闸与到点那一拍都在 apply 里挂上', [
  /ctx\.tools\.guard\(exploreStepGuard\)/u.test(host),
  /startExploreClock\(ctx\)/u.test(host),
], [true, true])
check('到点那一下先取消再 followup (与双击打断同一条语义)', [
  /if \(options\.cancel === true\) \{\n {6}agent\.cancel\(\{ kind: 'user' \}, \{ keepInbox: true \}\)/u.test(section),
  /agent\.followup\(message\)/u.test(section),
], [true, true])
check('步数用尽的正文先关虚拟屏, 再点名 op=finish 并说"不要再开新的事"', [
  /该收尾了/u.test(section),
  /lw_screen_release/u.test(section),
  /关闭虚拟屏/u.test(section),
  /不要再开新的事/u.test(section),
], [true, true, true, true])

/* ── 七、工具面 ───────────────────────────────────────────────────────── */

check("宿主里注册了 'lw_explore'", host.includes("name: 'lw_explore'"), true)
check('op 就是 status / finish 两个 (2.7.8 批次 8 撤掉了手动 start)', /enum: \['status', 'finish'\]/u.test(toolFace), true)
check('候选卡那一套从工具面撤了 (参数留着只为旧 prompt 不报错)', [
  toolFace.includes('ignored: the candidate-card list was removed'),
  !toolFace.includes('candidate cards below'),
  toolFace.includes('memory_save'),
], [true, true, true])
check('nextTask 的参数表与说明都在 (下一场任务卡)', [
  /nextTask:/u.test(toolFace),
  toolFace.includes('NEXT exploration'),
], [true, true])
check('finish 还收两把尺子 (2026-11-10: 应用线 / 提前天数由探索自己定; 2.8.1 #10 起叫 appMinutes)', [
  /rules: \{/u.test(toolFace),
  toolFace.includes('appMinutes'),
  /async function exploreRulesWrite\(rules\)/u.test(section),
  /exploreRulesWrite\(args\?\.rules\)/u.test(section),
  !/settings_sim_router_game/u.test(host),
], [true, true, true, true, true])
check('工具说明里写清"宿主自己按排期开, 这条工具不开"', [
  toolFace.includes('never starts one') || toolFace.includes('never starts'),
  toolFace.includes('daily start time'),
], [true, true])
check('工具数的下限抬到 67 (2.8.1 #45 加了 lw_memory)', Number(/(?:const FLOOR = )(\d+)/.exec(await read('tools/check-host-plugin.mjs'))[1]), 67)

/* ── 八、文件与键名 ───────────────────────────────────────────────────── */

check('那份任务卡的名字与上限 (宿主与应用同一个约定)', [
  api.EXPLORE_TASK_FILE,
  api.EXPLORE_TASK_CHARS,
  /join\(home, 'lw', EXPLORE_TASK_FILE\)/u.test(section),
], ['explore-card.md', 8000, true])
check('宿主收尾写卡: 原子写 + nextTask 只收非空', [
  /async function exploreTaskWrite\(text\)/u.test(section),
  /const temporary = temporaryName\(path\)/u.test(section),
  /nextTask: args\?\.nextTask/u.test(host),
  /exploreTaskWrite\(askedNext\)/u.test(section),
], [true, true, true, true])
check('收尾回执念到下一场那张卡', [
  section.includes("next task: no nextTask was given") || section.includes('next task:'),
], [true])
check('摘要目录就在 lw 底下 (候选目录 2026-10-18 已删)', [
  /const EXPLORE_SUMMARY_DIR = 'explore'/u.test(section),
  !/explore\/candidates/u.test(section),
], [true, true])
check('探索状态是合并式原子写 (未知键留着, .tmp + rename)', [
  /\.\.\.base,/u.test(section),
  /const temporary = temporaryName\(path\)/u.test(section),
  /await rename\(temporary, path\)/u.test(section),
], [true, true, true])
check('宿主起来时若 run 还在就重挂预算', [
  /async function exploreStateRestore\(\)/u.test(section),
  /if \(run\.over === true\) return false/u.test(section),
  /exploreRun\.deadline = Number\(run\.deadline\) \|\| 0/u.test(section),
], [true, true, true])
check(
  '状态文件那条写链串起来 (两次并发写同一个 .tmp 会 ENOENT, 2026-10-17 真机上量到的)',
  [
    /let exploreStateQueue = Promise\.resolve\(\)/u.test(section),
    /exploreStateQueue = exploreStateQueue\.then\(/u.test(section),
  ],
  [true, true],
)

/* ── 九、落位 (三处常量不许漂开) ──────────────────────────────────────── */

const pack = await read('tools/pack-host.mjs')
const custom = await read('app/src/main/java/io/github/yuloong07star/luwi/host/CustomPresets.kt')
const inbox = await read('app/src/main/java/io/github/yuloong07star/luwi/voice/VoiceInbox.kt')
// 2026-11-10: pack-host 那份表多了 `luwi` (默认档也要随树走), 所以不再逐字比一句话 ——
// 认的是"探索与主动对话都在这一份表里" (手机/视频那两条 2026-10-18 下线)
check('pack-host 摆的表里有探索与主动对话', [
  /const presets = \[[^\]]*'explore'/u.test(pack),
  /const presets = \[[^\]]*'proactive'/u.test(pack),
], [true, true])
check('Kotlin 那张 PRESET_ROWS 里有探索那一对', /ROW_EXPLORE to "explore",/u.test(custom), true)
const exploreBranch = host.slice(
  host.indexOf("if (line.source === 'explore')"),
  host.indexOf('const automated = line.source'),
)
check('应用与宿主同一个来源字面量 (`explore`)', [
  /const val SOURCE_EXPLORE = "explore"/u.test(inbox),
  exploreBranch.includes("via: 'inbox'"),
], [true, true])
check('收件箱那条 `source:explore` 支在 voiceDeliver 里, 排在命令表之前', [
  host.indexOf("line.source === 'explore'") < host.indexOf('const automated = line.source'),
], [true])

/* ── 十、结构化摘要 ───────────────────────────────────────────────────── */

check('摘要按这一场开始那一刻起名 (yyyyMMdd-HHmm)', api.exploreSummaryName(Date.UTC(2026, 9, 18, 21, 30)) !== '', true)
check('摘要名是 13 个字符且中间那条横线在', [
  /^\d{8}-\d{4}$/u.test(api.exploreSummaryName(Date.now())),
], [true])
check('开场正文带预算那两行与上一份摘要的路径', (() => {
  const line = api.exploreStartLine('看看新装了什么', run(false, 0, 60, now), '/x/lw/explore/20261018-2130.md')
  return [line.startsWith('看看新装了什么'), line.includes('30 分钟'), line.includes('60 步'), line.includes('/x/lw/explore/20261018-2130.md')]
})(), [true, true, true, true])
check('没有正文与没有上一份摘要时如实说', (() => {
  const line = api.exploreStartLine('', run(false, 0, 60, now), '')
  return [line.startsWith('自由探索这台手机'), line.includes('还没有 (这是第一场)')]
})(), [true, true])
check('摘要写文件时截 8000 字并记 truncated', [
  /const truncated = text\.length > EXPLORE_SUMMARY_CHARS/u.test(section),
  /'truncated: true'/u.test(section),
], [true, true])
check('目录只留最近 30 份 (prune 到 EXPLORE_SUMMARIES_KEPT)', /explorePrune\(directory, '\.md', EXPLORE_SUMMARIES_KEPT\)/u.test(section), true)
check('兜底那一份桩摘要记 stub 且不带候选卡', [
  /async function exploreStub\(\)/u.test(section),
  /ended: 'deadline',\n {4}stub: true,/u.test(section),
  !/candidates:/u.test(section),
], [true, true, true])
check(
  '同一场再交一次 finish 时如实说"已经落过了" (真机 2026-10-17: 到点取消之后还会再交一次)',
  [
    /already: true,/u.test(section),
    /const EXPLORE_ALREADY_SAVED_MS = 5 \* 60 \* 1000/u.test(section),
    /saved\.stub !== true/u.test(section),
    host.includes('}, sessionIdOf(exec))'),
  ],
  [true, true, true, true],
)

/* ── 十一、候选卡已下线 (2026-10-18 主人拍板) ────────────────────────────── */

check('宿主里没有候选卡那一套了 (没有读取方, 也没人再写)', [
  !/EXPLORE_CANDIDATES/u.test(host),
  !/exploreCandidateBody/u.test(host),
  !/exploreCandidatesDir/u.test(host),
  !/candidates\//u.test(host),
], [true, true, true, true])
check('摘要 frontmatter 不再记 candidates 那一行', !/candidates: \$\{/u.test(section), true)

/* ── 十二、探索卡与排期 (2.7.8 批次 8) ─────────────────────────────────── */

const task = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/ExploreTask.kt')
const schedule = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/ExploreSchedule.kt')
const manifest = await read('app/src/main/AndroidManifest.xml')
const service = await read('app/src/main/java/io/github/yuloong07star/luwi/host/DshHostService.kt')
const screen = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt')
const portalBridge = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/PortalBridge.kt')
const initialCard = await read('explore-card.md')

check('初始卡就是那一场画像探索 (主人 2026-10-17 点名)', [
  initialCard.includes('手机环境'),
  initialCard.includes('装了哪些应用'),
  initialCard.includes('用户画像'),
  initialCard.includes('lw_apps'),
  initialCard.includes('已确认事实'),
  initialCard.includes('仍不确定的点'),
  initialCard.includes('sensitivity: high'),
  initialCard.includes('nextTask'),
], [true, true, true, true, true, true, true, true])

check('卡文件与种子记号 (应用与初始卡对得上)', [
  /const val DIRECTORY = "lw"/.test(task),
  /const val FILE = "explore-card.md"/.test(task),
  /const val STAMP = ".lw-seed-explore"/.test(task),
  /const val MAX_CHARS = 8000/.test(task),
  task.includes('assets.open(FILE)'),
], [true, true, true, true, true])

check('卡是原子写 (tmp + rename, 单写者)', [
  /val tmp = File\(target\.parentFile, "\$\{target\.name\}\.tmp"\)/.test(task),
  /tmp\.renameTo\(target\)/.test(task),
], [true, true])

// 2026-11-21 二改: 探索只由判断层触发, 应用这一侧的排期整套 (时刻 / 42 号闹钟 / 自愈 / 补跑 / 清单登记)
// 全部删掉 —— 留着任何一个都是"还有第二条路能把探索开起来"
check('探索没有排期了 (无时刻 / 无 42 号闹钟 / 无自愈与补跑)', [
  !/DEFAULT_AT/u.test(schedule),
  !/REQUEST = 42/u.test(schedule),
  !/fun nextAt\(/u.test(schedule),
  !/fun dueOf\(/u.test(schedule),
  !/fun arm\(/u.test(schedule),
  !/fun ensure\(/u.test(schedule),
  !/ensureIfStale|ensureCatchUp/u.test(schedule),
  !/catchUpLateMs/u.test(schedule),
  !/ExploreAlarmReceiver/u.test(schedule),
], [true, true, true, true, true, true, true, true, true])

check('叫醒宿主那一段还在 (判断层那一拍与门户「唤醒一下」共用它)', [
  // 2026-11-07: 签名多了 onStarted —— 服务**真的开始启动**之后调用方才松手
  /fun wakeHost\(\s*context: Context,\s*timeoutMs: Long = HOST_WAIT_MS,\s*onStarted: \(\(\) -> Unit\)\? = null,\s*\): HostWake \{/u.test(schedule),
  /DshHostService\.start\(context\)/.test(schedule),
  /const val HOST_WAIT_MS = 180_000L/.test(schedule),
  !/Due\.WAKE_HOST/u.test(schedule),
], [true, true, true, true])

check('广播松手排在 startForegroundService 之后 (2026-11-07: 后台起 FGS 的豁免挂在广播上)', (() => {
  const start = schedule.indexOf('DshHostService.start(context)')
  const lastHandOff = schedule.lastIndexOf('onStarted?.invoke()')
  return start >= 0 && lastHandOff > start
})(), true)

// 2026-11-21 二改: 省电那一道闸与"到点那一趟"整段都不在应用这一侧了 —— 只剩宿主那条路按读数处理
check('省电不拦探索 (2026-10-26 口径, 现在只有宿主那一侧还有读数)', [
  !/powerSave/u.test(schedule),
  /async function explorePowerSave\(\)/u.test(host),
  section.includes('省电只当读数'),
], [true, true, true])

check('排期文件只剩两格 (步数 / 解锁), 老键一个都不再写', [
  /const val FILE = "explore-schedule.json"/.test(schedule),
  schedule.includes('put("steps", clamp(plan.steps, STEPS_RANGE))'),
  schedule.includes('put("unlock", plan.unlock)'),
  !schedule.includes('put("enabled"'),
  !schedule.includes('put("minutes"'),
  !schedule.includes('put("last"'),
], [true, true, true, true, true, true])

/*
 * 保活那三件 (2026-11-07): 到点叫醒了却跑不完 / 漏一次就永久停 / 看不出卡在哪一层
 *
 * 三件都不在设备上跑, 所以只能钉源码里那几个落点:
 */
const keepAlive = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwSessionLock.kt')
const engine = await read('app/src/main/java/io/github/yuloong07star/luwi/automation/AutomationEngine.kt')

check('会话锁本身还在, 探索那一侧不再按它 (排期那趟才是按锁的地方)', [
  /fun hold\(context: Context, tag: String, timeoutMs: Long\): Long/.test(keepAlive),
  // 一定带超时: 忘掉的锁不该变成电量黑洞
  /acquire\(budget\)/.test(keepAlive),
  /const val SLACK_MS = 10 \* 60_000L/.test(keepAlive),
  !/LwSessionLock\.hold\(/u.test(schedule),
], [true, true, true, true])

// 2026-11-21: 探索不再按时间自愈/补跑闹钟 (改由判断层挑时机), 心跳只留会话锁收尾
check('心跳只收尾会话锁, 不再自愈/补排探索闹钟', [
  /ExploreSchedule\.ensureIfStale\(context, now\)/.test(engine),
  /ExploreSchedule\.ensureCatchUp\(context, now\)/.test(engine),
  /LwSessionLock\.reconcile\(/.test(engine),
], [false, false, true])

// 2026-11-21 二改: 那套补跑纯函数与闹钟一起删了, 不再"留着当死代码"
check('错过那一场不再补跑 (探索改由判断层触发, 那套纯函数已删)', [
  !/ensureCatchUp|catchUpLateMs/u.test(schedule),
  /ExploreSchedule\.ensure\(this\)/.test(engine),
], [true, false])

check('宿主停掉时把会话锁放掉 (onTaskRemoved 顺手校一遍两个闹钟)', [
  /LwSessionLock\.releaseAll\(\)/.test(service),
  /override fun onTaskRemoved\(rootIntent: Intent\?\) \{/.test(service),
], [true, true])

check('探索那个闹钟广播已从清单摘掉 (42 号不再有人 arm)', [
  !/<receiver\s+android:name="\.tool\.ExploreAlarmReceiver"/u.test(manifest),
  !/ExploreAlarmReceiver/u.test(schedule),
], [true, true])

// 2026-11-21: 探索不再按时间排闹钟 —— 宿主起来只 ensure 任务卡, 不再 ensure 探索闹钟
check('宿主起来只 ensure 探索任务卡, 不再排探索/主动对话闹钟', [
  /ExploreTask\.ensure\(this\)/.test(service),
  /ExploreSchedule\.ensure\(this\)/.test(service),
  /ProactiveSchedule\.ensure\(this\)/.test(service),
], [true, false, false])

check('设置页那段: 解锁 / 步数 / 卡 / 读数, 没有开关 / 时刻 / 分钟 / 手动开始', [
  /settingsSection\(\s*key = "activity"/u.test(screen),
  !screen.includes('R.string.settings_explore_toggle'),
  screen.includes('R.string.settings_explore_by_router'),
  screen.includes('R.string.settings_explore_card'),
  screen.includes('ExploreSchedule.save('),
  screen.includes('ExploreTask.write('),
  !screen.includes('R.string.settings_explore_at'),
  !screen.includes('R.string.settings_explore_minutes'),
  !screen.includes('settings_explore_start'),
  !screen.includes('saidLimit'),
], [true, true, true, true, true, true, true, true, true, true])

check('构建把初始卡拷进 assets', (await read('app/build.gradle.kts')).includes('projectDirectory.file("explore-card.md")'), true)

check('status 那两行读数换了账本 (每日总上限 2.8.0 起取消, 不再有那一行)', [
  section.includes('next task card:'),
  !section.includes('said today:'),
  !section.includes('saidLimit'),
  !section.includes('the daily limit lands in the next batch'),
], [true, true, true, true])

/* ── 十三、预算透传 (2.7.9 第 8 条 T4) ─────────────────────────────────── */

check('排期文件只写步数与解锁 (分钟那一路 2026-11-21 撤了)', [
  !schedule.includes('put("minutes",'),
  schedule.includes('put("steps",'),
  schedule.includes('put("unlock", plan.unlock)'),
], [true, true, true])
check('读回来也只认这两格 (认不出来落缺省)', [
  schedule.includes('root["steps"]'),
  schedule.includes('root["unlock"]'),
  /const val STEPS_DEFAULT = 60/.test(schedule),
  !/MINUTES_DEFAULT/u.test(schedule),
], [true, true, true, true])
check('应用与宿主的步数缺省 / 范围是同一对 (差一个数就是"设置页写的不是宿主认的")', [
  Number(/const val STEPS_DEFAULT = (\d+)/.exec(schedule)[1]),
  Number(/val STEPS_RANGE = 1\.\.(\d+)/.exec(schedule)[1]),
], [
  api.EXPLORE_STEPS_DEFAULT,
  api.EXPLORE_STEPS_RANGE[1],
])
check('判断层开那场把卡与步数交给 startExplore (2026-11-21 二改)', [
  /const card = await readExploreTask\(\)/u.test(host),
  /const \{ steps \} = await readExploreSchedule\(\)/u.test(host),
  /await startExplore\(ctx, \{ via: 'router', speakOnFinish: line \|\| opening, text: card, steps \}\)/u.test(host),
], [true, true, true])
check('步数那一格的真值: 缺键 / 越界 / 坏值都落 60 与范围, 老键不再影响它', [
  api.exploreStepsFrom({}),
  api.exploreStepsFrom({ steps: 3000 }),
  api.exploreStepsFrom({ steps: 'abc' }),
  api.exploreStepsFrom({ enabled: false, at: '03:00', minutes: 30, steps: 10 }),
], [api.EXPLORE_STEPS_DEFAULT, api.EXPLORE_STEPS_RANGE[1], api.EXPLORE_STEPS_DEFAULT, 10])
check('卡正文的真值: 去首尾空行 / 8000 字封顶 / 读不出来是空', [
  api.exploreTaskText('  \n看相册最近三张\n'),
  api.exploreTaskText('x'.repeat(9000)).length,
  api.exploreTaskText(undefined),
], ['看相册最近三张', api.EXPLORE_TASK_CHARS, ''])
check('收件箱只给探索那一个来源写这两个键', [
  /fun append\([\s\S]*?minutes: Int\? = null,[\s\S]*?steps: Int\? = null,/u.test(inbox),
  /val exploring = source == SOURCE_EXPLORE/u.test(inbox),
  /if \(exploring\) \{\s*minutes\?\.let \{ put\("minutes", it\) \}\s*steps\?\.let \{ put\("steps", it\) \}/u.test(inbox),
], [true, true, true])
check('宿主那一支把收件箱里的步数透传给 startExplore', [
  exploreBranch.includes('steps: line.steps'),
  !exploreBranch.includes('minutes: line.minutes'),
  /const stepLimit = exploreClamp\(options\?\.steps, EXPLORE_STEPS_RANGE, EXPLORE_STEPS_DEFAULT\)/u.test(section),
  /async function readExploreSchedule\(\)/u.test(section),
], [true, true, true, true])
check('门户那颗「开始这一趟」也带步数 (两条路同一个预算)', [
  portalBridge.includes('steps = ExploreSchedule.plan(context).steps'),
], [true])
// 2026-10-19 量到的: 收件箱那一行写着 5 / 10, 宿主开出来的是 30 / 60 —— 读那一行时对象是逐键构造的,
// `voiceReadNew` 不加这两个键, 后面整条链再对也没用
const voiceReadNew = host.slice(
  host.indexOf('async function voiceReadNew(inbox)'),
  host.indexOf('function startVoiceInbox(ctx, deliver)'),
)
check('读收件箱那一关把 minutes / steps 也带过去 (T4 在这里漏过一次)', [
  /minutes: record\.minutes,/u.test(voiceReadNew),
  /steps: record\.steps,/u.test(voiceReadNew),
], [true, true])
check('老行没有这两个键时仍落 30 / 60 (宿主内部那对缺省没动)', [
  api.exploreClamp(undefined, api.EXPLORE_MINUTES_RANGE, api.EXPLORE_MINUTES_DEFAULT),
  api.exploreClamp(undefined, api.EXPLORE_STEPS_RANGE, api.EXPLORE_STEPS_DEFAULT),
], [30, 60])

const exploreItems = screen.slice(
  screen.indexOf('fun ExploreItems()'),
  screen.indexOf('private fun ExploreCardDialog'),
)
// 2026-11-21: 预算只留步数 (时间那一路撤了), 没有时刻 / 分钟 / 手动开始
check('设置页只剩步数那一条 (分钟/时刻已撤), 仍然没有手动开始', [
  !exploreItems.includes('R.string.settings_explore_minutes'),
  exploreItems.includes('R.string.settings_explore_steps'),
  exploreItems.includes('ArrowSlider('),
  exploreItems.includes('ExploreSchedule.clamp('),
  exploreItems.includes('plan.copy(steps ='),
  !exploreItems.includes('plan.copy(minutes ='),
  !exploreItems.includes('settings_explore_start'),
], [true, true, true, true, true, true, true])
check('段首那句读数改成判断层触发, 不再带分/步预算那句', [
  screen.includes('R.string.settings_explore_by_router'),
  !screen.includes('R.string.settings_explore_budget'),
], [true, true])

/* ── 十四、工作区与读数 (2.7.9 T5) ─────────────────────────────────────── */

check('宿主起来就把探索那条工作区**建好并注册** (2026-11-13 改口径: 不再"只认已有")', [
  // 启动那一下走"建目录 + 注册": 门户里没有「选工作区」那一档, 首启要的是目录真的在
  /void ensureExploreWorkspace\(ctx\)\n\s*\.then\(\(workspace\) => \{[\s\S]*?return exploreStateWrite\(\)/u.test(host),
  // "只认已有"那两条路已删 (判据不许它们回来; 注释里留的名字不算)
  !/function adoptExploreWorkspace\b/u.test(host),
  !/function adoptExistingChannelWorkspace\b/u.test(host),
  // 投递那一下仍是同一条 (一场探索真的要在那里落脚)
  (host.match(/await ensureExploreWorkspace\(ctx\)/gu) ?? []).length >= 1,
  // 宿主一起来还有一次更早的那条 (客户端开屏之前), 这一条是"首启直接落在 Luwi"的落点
  /ctx\.inject\(\['workspaceRegistry'\][\s\S]*?ensureExploreWorkspace\(workspaceCtx\)/u.test(host),
], [true, true, true, true, true])
check('注册与那一次写排在 restore 之后 (抢在前面会把上一场抹掉)', [
  host.indexOf('void ensureExploreWorkspace(ctx)')
    > host.indexOf('the explore state could not be read'),
], [true])

const stateWrite = host.slice(
  host.indexOf('async function exploreStateWriteNow()'),
  host.indexOf('async function exploreStateRestore()'),
)
check('status 那四项写进读数文件 (设置页才有得看, F20)', [
  /status: \{/.test(stateWrite),
  /preset: exploreState\.preset/.test(stateWrite),
  /presetWhy: exploreState\.presetWhy/.test(stateWrite),
  /lastError: exploreState\.lastError/.test(stateWrite),
  /powerSaveUnknown: exploreState\.powerSaveUnknown/.test(stateWrite),
], [true, true, true, true, true])

const exploreStatus = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/ExploreStatus.kt')
check('应用这一侧有一个只读那四项的读数 (纯解析 + 最近一份摘要)', [
  /internal object ExploreStatus/.test(exploreStatus),
  /class Snapshot\(/.test(exploreStatus),
  /fun snapshotOf\(root: JsonObject\)/.test(exploreStatus),
  /root\["status"\] as\? JsonObject/.test(exploreStatus),
  /fun latestSummary\(context: Context\)/.test(exploreStatus),
], [true, true, true, true, true])
check('设置页显示那四项 + 最近一份摘要那一行', [
  /ExploreStatus\.read\(context\)/.test(exploreItems),
  /settings_explore_preset/.test(exploreItems),
  /settings_explore_power_unknown/.test(exploreItems),
  /settings_explore_reading_error/.test(exploreItems),
  /settings_explore_summary_open/.test(exploreItems),
  /ExploreSummaryDialog\(/.test(exploreItems),
], [true, true, true, true, true, true])
check('摘要窗真的把文件读出来 (读不出来也如实说)', [
  /runCatching \{ file\.readText\(\) \}/.test(screen),
  /settings_explore_summary_failed/.test(screen),
], [true, true])

// 2026-11-21 二改: "到点没开成"那条通知跟着排期一起撤了 —— 现在开不开由判断层定, 没有"叫不醒"这一档
check('没有"到点没开成"那一条通知 (排期那一路已撤)', [
  !/LwNotify/u.test(schedule),
  !/settings_explore_not_started/u.test(schedule),
], [true, true])

/* ── 十五、探索时允许锁屏解锁 (2.7.10) ─────────────────────────────────── */

const lockTool = await read('app/src/main/java/io/github/yuloong07star/luwi/lock/LwLock.kt')
const lockSettings = await read('app/src/main/java/io/github/yuloong07star/luwi/lock/LockSetting.kt')
const resZh = await read('app/src/main/res/values-zh/strings.xml')
const resEn = await read('app/src/main/res/values/strings.xml')

check('排期文件多一个 unlock 键 (老文件就是关着)', [
  schedule.includes('put("unlock", plan.unlock)'),
  /val unlock = root\["unlock"\]\?\.jsonPrimitive\?\.booleanOrNull \?: false/.test(schedule),
  /val unlock: Boolean = false/.test(schedule),
], [true, true, true])
check('那把锁只在探索里那一次 (没有"到点先解屏"了)', [
  !/unlockForExplore/u.test(schedule),
  /fun unlockAtSchedule\(context: Context, tag: String\): String\?/.test(schedule),
  !/VoiceInbox\.append/u.test(schedule),
], [true, true, true])
check('解屏走「锁屏」那一段: 点亮 / 没录过不放 / 失败太多次不放', [
  /fun unlockAtSchedule\(context: Context, tag: String\): String\?/.test(schedule),
  /LockReplay\.wakeScreen\(context, allowConnecting = true\)/.test(schedule),
  /LockReplay\.replayNow\(context, tag\)/.test(schedule),
  /if \(!LockSetting\.unlockable\(context\)\)/.test(schedule),
  /if \(LockTries\.exhausted\(LockSetting\.tries\(context\)\)\)/.test(schedule),
], [true, true, true, true, true])
check('"有没有可放的东西"只有一处 (两条开关问同一句)', [
  /fun unlockable\(context: Context\): Boolean/.test(lockSettings),
  /if \(on && !unlockable\(context\)\)/.test(lockSettings),
], [true, true])
check('探索里 lw_lock 解屏要过那道开关 (关着就如实拒, 不悄悄解开)', [
  /ExploreTask\.running\(app\) != null && !ExploreSchedule\.plan\(app\)\.unlock/.test(lockTool),
  lockTool.includes('"explore-unlock-off"'),
  lockTool.includes('允许锁屏解锁'),
], [true, true, true])
check('设置页那一行: 标题 / 说明 / 落盘 / 没录过时说一句', [
  exploreItems.includes('R.string.settings_explore_unlock'),
  exploreItems.includes('R.string.settings_explore_unlock_summary'),
  exploreItems.includes('R.string.settings_explore_unlock_missing'),
  exploreItems.includes('plan.copy(unlock ='),
  exploreItems.includes('LockSetting.unlockable(context)'),
], [true, true, true, true, true])
check('没有「上一次」那一行 (那个读数只有到点那趟会写)', [
  !screen.includes('settings_explore_last_started_note'),
  !/describeLast/u.test(schedule),
], [true, true])
check('三条字符串两边都在, 先后顺序也一致', [
  ['settings_explore_unlock', 'settings_explore_unlock_summary', 'settings_explore_unlock_missing']
    .every((key) => resZh.includes(`name="${key}"`) && resEn.includes(`name="${key}"`)),
  // 两边的相对顺序相同 (一处加、另一处忘了加就会在这里红)
  (() => {
    const inOrder = (text) => {
      const at = ['settings_explore_unlock', 'settings_explore_unlock_missing', 'settings_explore_steps']
        .map((key) => text.indexOf(`name="${key}"`))
      return at.every((one, index) => one > 0 && (index === 0 || one > at[index - 1]))
    }
    return inOrder(resZh) && inOrder(resEn)
  })(),
], [true, true])
check('persona 写清锁屏那一条 (解不开就记进摘要, 不绕)', [
  persona.includes('lw_lock op=unlock'),
  persona.includes('不绕'),
], [true, true])

/* ── 十六、屏所有权与持久化 (2.8.0 B2-a) ─────────────────────────────── */

/**
 * 这四条是**释放路**的判据 (2.8.0 #14 ①)。四条路共用 [exploreReleaseOwnedScreens], 这里各钉一件事:
 * **只碰这一场的屏** (11-5 不误关非探索屏)、**幂等 + 用户先关掉只记 missing**、**失败不抛**、
 * **重启后账从 explore.json 回来** (11-5)。重启那一条已经接在 apply 的恢复段上 (没有能接回来的 run
 * 时才归还), 步数 / deadline / finish+stub 三条触发点留给 #15 (B2-b)。判据不碰真设备: 桥那一步
 * 用 mock 的 `call` 替掉
 */

const screenHome = await mkdtemp(join(tmpdir(), 'lw-explore-screens-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = screenHome

const releaseCalls = []
let releaseAnswer = (displayId) => ({ released: true, displayId })
const screensApi = new Function(
  'readFile', 'readdir', 'join', 'dirname', 'mkdir', 'writeFile', 'rename', 'rm', 'call', 'shortSession',
  'temporaryName', 'ROUTER_HOME_PACKAGES',
  `${section}\nreturn { getScreens: () => exploreScreens,`
    + ' setScreens: (next) => { exploreScreens = next; exploreScreensLoaded = true },'
    + ' resetScreens: () => { exploreScreens = []; exploreScreensLoaded = true },'
    + ' exploreRun, exploreNoteCreatedScreen, exploreReleaseOwnedScreens, exploreStateRestore,'
    + ' exploreScreenRecord, exploreScreensOfSession, exploreScreenSurvives }',
)(
  readFile, readdir, join, dirname, mkdir, writeFile, rename, rm,
  async (method, params = {}) => {
    releaseCalls.push({ method, displayId: params.displayId })
    return releaseAnswer(params.displayId)
  },
  (id) => String(id).slice(0, 8),
  // 主线的写盘已经改成唯一临时名 (2efab39), 而这一段源码是抽出来跑的 —— 临时名这一步给个
  // 同形状的替身就行, 这个文件里判的是账怎么走, 不是 `.tmp` 叫什么
  (path) => `${path}.check.tmp`,
  ROUTER_HOME_PACKAGES,
)

const owned = (displayId, sessionId) => ({ displayId, sessionId, createdAt: 1, released: false })

screensApi.resetScreens()
screensApi.exploreRun.session = 'explore-a'
const noted = await screensApi.exploreNoteCreatedScreen({ created: true, displayId: 12, replaced: -1 }, 'explore-a')
const foreign = await screensApi.exploreNoteCreatedScreen({ created: true, displayId: 13, replaced: -1 }, 'other-session')
const failedCreate = await screensApi.exploreNoteCreatedScreen({ created: false, displayId: -1, replaced: -1 }, 'explore-a')
const replacedCreate = await screensApi.exploreNoteCreatedScreen({ created: true, displayId: 15, replaced: 12 }, 'explore-a')
const persisted = JSON.parse(await readFile(join(screenHome, 'lw', 'explore.json'), 'utf8'))
check('屏账 ②: 探索场建屏后 displayId 进账并落进 explore.json (别的场 / 建失败不记, 替换记 replaced)', [
  noted, foreign, failedCreate, replacedCreate,
  screensApi.getScreens().map((one) => [one.displayId, one.released, one.reason ?? '']),
  persisted.screens.map((one) => one.displayId),
], [true, false, false, true, [[12, true, 'replaced'], [15, false, '']], [12, 15]])

screensApi.setScreens([owned(12, 'explore-a'), owned(13, 'someone-else'), owned(14, 'explore-a')])
releaseCalls.length = 0
releaseAnswer = (displayId) => ({ released: true, displayId })
const steps = await screensApi.exploreReleaseOwnedScreens('steps', 'explore-a')
check('释放路 ① 步数上限: 只归还这一场自己的屏, 别的会话那块一个字节不碰 (11-1, 11-5)', [
  steps.released,
  releaseCalls.map((one) => one.displayId),
  screensApi.getScreens().map((one) => [one.displayId, one.released]),
], [[12, 14], [12, 14], [[12, true], [13, false], [14, true]]])

screensApi.setScreens([owned(20, 'explore-b')])
releaseCalls.length = 0
releaseAnswer = (displayId) => ({ released: false, displayId, error: 'the user closed the virtual screen' })
const deadline = await screensApi.exploreReleaseOwnedScreens('deadline', 'explore-b')
const deadlineAgain = await screensApi.exploreReleaseOwnedScreens('deadline', 'explore-b')
const gone = screensApi.getScreens()[0]
check('释放路 ② deadline: 用户先关屏只记 missing, 再放一次什么都不做 (幂等)', [
  deadline.missing.length, deadline.released.length,
  deadlineAgain.missing.length, deadlineAgain.released.length,
  releaseCalls.length, gone.released, gone.missing,
], [1, 0, 0, 0, 1, true, true])

screensApi.setScreens([owned(30, 'explore-c')])
releaseCalls.length = 0
releaseAnswer = () => { throw new Error('the privileged channel is down') }
let finish = null
let releaseThrew = false
try {
  finish = await screensApi.exploreReleaseOwnedScreens('finish', 'explore-c')
} catch {
  releaseThrew = true
}
const kept = screensApi.getScreens()[0]
releaseAnswer = (displayId) => ({ released: true, displayId })
const stub = await screensApi.exploreReleaseOwnedScreens('stub', 'explore-c')
check('释放路 ③ finish 与 stub: 释放失败不抛, 账上留 lastError, 下一次还能补上', [
  releaseThrew, finish?.failed.length, kept.released, kept.lastError !== '',
  stub.released, screensApi.getScreens()[0].released,
], [false, 1, false, true, [30], true])

screensApi.resetScreens()
await mkdir(join(screenHome, 'lw'), { recursive: true })
await writeFile(join(screenHome, 'lw', 'explore.json'), JSON.stringify({
  v: 1,
  run: { session: 'explore-d', deadline: Date.now() + 60_000, steps: 1, stepLimit: 60 },
  screens: [
    { displayId: 41, sessionId: 'explore-d', createdAt: 1, released: false },
    { displayId: 42, sessionId: 'explore-d', createdAt: 1, released: true, releasedAt: 2, reason: 'finish' },
    { displayId: 43, sessionId: 'someone-else', createdAt: 1, released: false },
    { displayId: 0, sessionId: 'explore-d', createdAt: 1, released: false },
    { displayId: 44, sessionId: '', createdAt: 1, released: false },
    'not-a-row',
  ],
}))
const restored = await screensApi.exploreStateRestore()
releaseCalls.length = 0
releaseAnswer = (displayId) => ({ released: true, displayId })
const afterRestart = await screensApi.exploreReleaseOwnedScreens('restore')
const rewritten = JSON.parse(await readFile(join(screenHome, 'lw', 'explore.json'), 'utf8'))
check('释放路 ④ 宿主重启: 账从 explore.json 回来, 恢复后只归还本场未释放的那块 (11-5)', [
  restored,
  screensApi.getScreens().map((one) => one.displayId),
  releaseCalls.map((one) => one.displayId),
  afterRestart.released,
  rewritten.screens.map((one) => [one.displayId, one.released]),
], [true, [41, 42, 43], [41], [41], [[41, true], [42, true], [43, false]]])

await rm(screenHome, { recursive: true, force: true })
if (previousHome === undefined) delete process.env.DSH_HOME
else process.env.DSH_HOME = previousHome

check('屏账 ②: lw_screen_create 建完之后把 displayId 交给登记 (别的场不记)', [
  /async execute\(args, exec\)[\s\S]{0,400}exploreNoteCreatedScreen\(created, sessionIdOf\(exec\)\)/u
    .test(host.slice(host.indexOf("name: 'lw_screen_create'"), host.indexOf("name: 'lw_screen_resize'"))),
], [true])

check('屏账 ③: 写盘带 screens, 重启时从文件把账读回来', [
  /\n {4}screens: exploreScreensLoaded/u.test(stateWrite),
  /exploreScreens = exploreScreensFromRecord\(record\)/u.test(host),
], [true, true])

check('屏幕账 ③: 开机记号不同就当屏已经没了 (跨重启的旧账不去关撞号的新屏)', [
  screensApi.exploreScreenSurvives({ boot: 'boot-a' }, 'boot-a'),
  screensApi.exploreScreenSurvives({ boot: 'boot-a' }, 'boot-b'),
  screensApi.exploreScreenSurvives({ boot: '' }, 'boot-b'),
  screensApi.exploreScreenSurvives({ boot: 'boot-a' }, ''),
], [true, false, true, true])

check('释放路 ④: 重启恢复段没有能接回来的 run 时归还遗留屏 (活着的 run 不动它)', [
  /if \(!restored\) \{[\s\S]{0,500}exploreReleaseOwnedScreens\('restore', sessionId\)/u.test(host),
  /orphaned explore screen\(s\) were given back/u.test(host),
], [true, true])

/* ── 十七、一次性错误 Dialog (2.8.0 B2-c) ─────────────────────────────── */

/**
 * ⑧⑨⑩ 这一簇管的是**主页怎么把失败说给用户**: 以前 `selected == null` 时常驻一行「虚拟屏: …」,
 * 那句话要等下一次成功才消失 —— 人分不清它是刚刚发生的还是昨天留下的。改成弹一次就走, 同一个
 * reason 30 s 内只弹一次 (连点几下会连着失败三四回, 每回一个窗等于什么都没说)
 *
 * ⑧ 删的是**常驻显示**, 不是 `VirtualScreen.lastError` 这个字段: 桥还是拿它当失败理由, 删了字段
 * 工具那边就只剩一句空话。所以两边一起钉 —— 页面上没有那一行, 桥里还有那一句
 */
const homeScreen = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/HostScreen.kt')
const privilegedBridge = await read('app/src/main/java/io/github/yuloong07star/luwi/channel/PrivilegedBridge.kt')
const virtualScreen = await read('app/src/main/java/io/github/yuloong07star/luwi/channel/VirtualScreen.kt')

check('⑧ 主页不再常驻一行「虚拟屏: …」', [
  /text = "虚拟屏: \$reason"/u.test(homeScreen),
  /VirtualScreen\.lastError\?\.let \{ reason ->\n\s*Text\(/u.test(homeScreen),
], [false, false])

check('⑧ 删的是常驻显示, 不是字段: 桥仍然拿它当失败理由', [
  /put\("lastError", VirtualScreen\.lastError/u.test(privilegedBridge),
  /put\("error", VirtualScreen\.lastError/u.test(privilegedBridge),
  /var lastError: String\? by mutableStateOf\(null\)\n\s*private set/u.test(virtualScreen),
], [true, true, true])

check('⑨ 改成一次性 Dialog: lastError 变了才弹, 关掉就没了', [
  /LaunchedEffect\(VirtualScreen\.lastError\)/u.test(homeScreen),
  /OverlayDialog\(\n\s*show = true,/u.test(homeScreen),
  /onDismissRequest = \{ screenError = null \}/u.test(homeScreen),
], [true, true, true])

check('⑩ 同一句 reason 30 s 内只弹一次, 去重状态挂在文件级 (进出主页不重置)', [
  /internal const val SCREEN_ERROR_WINDOW_MS = 30_000L/u.test(homeScreen),
  /private val screenErrorOnce = ScreenErrorOnce\(\)/u.test(homeScreen),
  /if \(screenErrorOnce\.take\(reason, SystemClock\.uptimeMillis\(\)\)\) screenError = reason/u.test(homeScreen),
], [true, true, true])

check('⑩ 30 s 窗口与三种情形各有单测 (第一次弹 / 窗口内丢 / 窗口过再弹 / 空理由不弹)', [
  /class ScreenErrorOnceTest/u.test(
    await read('app/src/test/java/io/github/yuloong07star/luwi/ui/ScreenErrorOnceTest.kt'),
  ),
  /fun `same reason inside the window is dropped`/u.test(
    await read('app/src/test/java/io/github/yuloong07star/luwi/ui/ScreenErrorOnceTest.kt'),
  ),
], [true, true])

/* ── 十八、三种判法与空手留痕 (2026-11-10, 方案 B / D) ─────────────────── */

/*
 * 主人这一条要的是"探索交检测项"从**允许**变成**会发生**, 而两半都能在 PC 上钉住:
 *
 * 1. `exploreCheckRow` 是那一层的纯函数 —— 三种判法各收什么, 坏参数为什么整条丢
 * 2. 空手也留痕: `lastFinish` / `checksStreak` 真的写进 `explore.json`, 同一场重交不连 +2
 */

check('三种判法各收一条 (usage / time / event)', [
  api.exploreCheckRow({ what: '打游戏太久', when: { kind: 'usage', minutes: 120 }, at: '21:00' }),
  api.exploreCheckRow({ what: '出门前问一句', when: { kind: 'time' }, at: '07:40' }),
  api.exploreCheckRow({
    what: '上班前提醒带门卡',
    when: { kind: 'event', beforeMinutes: 30, titleContains: '上班' },
  }),
], [
  { what: '打游戏太久', when: { kind: 'usage', minutes: 120 }, at: '21:00' },
  { what: '出门前问一句', when: { kind: 'time' }, at: '07:40' },
  { what: '上班前提醒带门卡', when: { kind: 'event', beforeMinutes: 30, titleContains: '上班' } },
])

check('event 缺 beforeMinutes 时按 15 记, 没给的字段不写空键', api.exploreCheckRow({
  what: '开会前提醒',
  when: { kind: 'event' },
}), { what: '开会前提醒', when: { kind: 'event', beforeMinutes: 15 } })

check('event 的坏参数整条丢 (0 / 1441 / 21 字标题 / 6 本日历 / afterMinutes / 歪日历 id)', [
  api.exploreCheckRow({ what: 'a', when: { kind: 'event', beforeMinutes: 0 } }),
  api.exploreCheckRow({ what: 'a', when: { kind: 'event', beforeMinutes: 1441 } }),
  api.exploreCheckRow({
    what: 'a',
    when: { kind: 'event', titleContains: '一二三四五六七八九十一二三四五六七八九十一' },
  }),
  api.exploreCheckRow({ what: 'a', when: { kind: 'event', calendarIds: ['1', '2', '3', '4', '5', '6'] } }),
  api.exploreCheckRow({ what: 'a', when: { kind: 'event', afterMinutes: 10 } }),
  api.exploreCheckRow({ what: 'a', when: { kind: 'event', calendarIds: ['1', 'x'] } }),
], [null, null, null, null, null, null])

check('20 字的标题收 (边界在 20 这一头), 5 本日历收', api.exploreCheckRow({
  what: 'a',
  when: {
    kind: 'event',
    beforeMinutes: 5,
    titleContains: '一二三四五六七八九十一二三四五六七八九十',
    calendarIds: ['1', '2', '3', '4', '5'],
  },
}), {
  what: 'a',
  when: {
    kind: 'event',
    beforeMinutes: 5,
    titleContains: '一二三四五六七八九十一二三四五六七八九十',
    calendarIds: ['1', '2', '3', '4', '5'],
  },
})

check('不认识的 kind / 空的 what / time 没有 at 一律丢', [
  api.exploreCheckRow({ what: 'a', when: { kind: 'weekday' } }),
  api.exploreCheckRow({ what: '   ', when: { kind: 'time' }, at: '07:40' }),
  api.exploreCheckRow({ what: 'a', when: { kind: 'time' } }),
], [null, null, null])

check('任务卡尾注那三行在, 而且正文预算扣掉了它', [
  api.EXPLORE_CARD_TAIL.includes('收尾三样'),
  api.EXPLORE_CARD_TAIL.includes('至多 3 条'),
  api.EXPLORE_CARD_TAIL.includes('为什么没有'),
  /const budget = Math\.max\(0, EXPLORE_TASK_CHARS - EXPLORE_CARD_TAIL\.length - 1\)/.test(section),
  /\$\{String\(text \?\? ''\)\.trim\(\)\.slice\(0, budget\)\}\$\{EXPLORE_CARD_TAIL\}/.test(section),
], [true, true, true, true, true])

check('开场正文里也有那一句 (那一句永远不会被覆盖)', api.exploreStartLine(
  '看看新装了什么',
  run(false, 0, 60, now),
  '/x/lw/explore/20261018-2130.md',
).includes('收尾: nextTask + 至多 3 条 checks (没有就写明为什么)'), true)

const checksHome = await mkdtemp(join(tmpdir(), 'lw-explore-checks-'))
const previousChecksHome = process.env.DSH_HOME
process.env.DSH_HOME = checksHome

/** 一份能真写盘的那一段 (只多给一个临时名) */
function checksBook() {
  return new Function(
    'readFile', 'readdir', 'join', 'dirname', 'mkdir', 'writeFile', 'rename', 'rm', 'temporaryName',
    'ROUTER_EVENT_BEFORE_DEFAULT', 'ROUTER_HOME_PACKAGES', 'TAP_EFFECT_STREAK', 'tapEffectLog',
    `${section}\nreturn { exploreRecordChecks, exploreFinishFromRecord, exploreStateRestore,`
      + ' streakOf: () => exploreChecksStreak, lastFinishOf: () => exploreLastFinish }',
  )(
    readFile, readdir, join, dirname, mkdir, writeFile, rename, rm,
    (path) => `${path}.check.tmp`, EVENT_BEFORE_DEFAULT, ROUTER_HOME_PACKAGES, TAP_EFFECT_STREAK, [],
  )
}

const book = checksBook()
const stateFile = join(checksHome, 'lw', 'explore.json')
const readBook = async () => JSON.parse(await readFile(stateFile, 'utf8'))

await book.exploreRecordChecks('s1', 'finish', { written: 2, total: 3 })
const afterFirst = await readBook()
await book.exploreRecordChecks('s2', 'finish', { written: 0, total: 3 })
await book.exploreRecordChecks('s2', 'already', { written: 0, total: 3 })
const afterSame = await readBook()
await book.exploreRecordChecks('s3', 'finish', { written: 0, total: 3 })
const afterThird = await readBook()

check('交了就归零, 没交就 +1, 同一场重交不再 +1', [
  afterFirst.checksStreak, afterFirst.lastFinish.written, afterFirst.lastFinish.session,
  afterSame.checksStreak, afterThird.checksStreak, afterThird.lastFinish.written,
], [0, 2, 's1', 1, 2, 0])

check('那两笔账写在同一份 explore.json 里, 版本号与它自己的键都在', [
  afterThird.v, typeof afterThird.lastFinish.at, afterThird.lastFinish.ended,
], [1, 'number', 'finish'])

// 宿主重启: 换一个实例从文件把账读回来 (它是"连着的场数"跨进程的唯一来源)
const restarted = checksBook()
const restoredChecks = await restarted.exploreStateRestore()
check('重启之后 streak 与上一场读数都回来了', [
  restoredChecks, restarted.streakOf(), restarted.lastFinishOf()?.written, restarted.lastFinishOf()?.session,
], [false, 2, 0, 's3'])

await restarted.exploreRecordChecks('s4', 'finish', { written: 1, total: 4 })
check('交了一条之后重新归零', [restarted.streakOf(), restarted.lastFinishOf()?.written], [0, 1])

check('那一笔读数形状不对就当没有 (设置页少一行, 不显示编出来的数)', [
  book.exploreFinishFromRecord({ lastFinish: null }),
  book.exploreFinishFromRecord({ lastFinish: 'not-a-row' }),
  book.exploreFinishFromRecord({ lastFinish: { at: 'x', written: -3, total: 2 } }),
], [null, null, { at: 0, ended: '', written: 0, total: 2, session: '' }])

await rm(checksHome, { recursive: true, force: true })
if (previousChecksHome === undefined) delete process.env.DSH_HOME
else process.env.DSH_HOME = previousChecksHome

/* ── 十九、跨应用记忆 (2026-11-20, 2.8.1 #36) ───────────────────────────── */

/**
 * 主人这一条要的是"切走再回来还知道自己要找什么": 账按应用记, 切走时标 interrupted, 切回来
 * `resumed` +1, 下一步提示的第一行是这一趟的原 intent。三个假应用跑九步 (中间切走两次再回到第一个),
 * 读数与提示逐条对; `EXPLORE_MEMORY_MAX=0` 同一个场景一笔都不记
 */

const MEMORY_APPS = ['com.example.notes', 'com.example.mail', 'com.example.calendar']
const MEMORY_INTENT = '找设置里的省电开关'
const MEMORY_SCENE = [
  [0, 'changed', '打开设置'],
  [0, 'unchanged', '点电池'],
  [1, 'changed', '打开邮件'],
  [1, 'changed', '点收件箱'],
  [2, 'changed', '打开日历'],
  [2, 'failed', '点新增'],
  [0, 'changed', '点省电'],
  [0, 'changed', '点开关'],
  [0, 'changed', '看阈值'],
]

/** 那九步真跑一遍: 每一步都走宿主同一个纯函数 */
function memoryScene(limit) {
  let memory = {}
  MEMORY_SCENE.forEach(([app, effect, text], index) => {
    memory = api.exploreMemoryStep(memory, {
      pkg: MEMORY_APPS[app], intent: MEMORY_INTENT, effect, text, at: 1_000 + index,
    }, limit)
  })
  return memory
}

delete process.env.EXPLORE_MEMORY_MAX
const remembered = memoryScene(api.EXPLORE_MEMORY_MAX_DEFAULT)
const counts = api.exploreMemoryCounts(remembered)
const back = api.exploreMemoryFor(remembered, MEMORY_APPS[0])
const hint = api.exploreMemoryHint(back)

check('跨应用记忆 ①: 三个假应用九步、中途切走再回来 → packages=3 / interrupted=2 / resumed=1', [
  counts.packages, counts.interrupted, counts.resumed,
], [3, 2, 1])
/**
 * ② 断言的是**生账** (第二轮 H): 账上那一行必须是 `6 位 hash + 掩码后 1~24 字`
 *
 * 把 `said = exploreMemorySeal(...)` 换回 `exploreMemoryText(step?.text, 40)` 时这一条会红 —— 40 字
 * 明文既不匹配这个形状, 条数与内容也对不上
 */
const backRows = remembered[MEMORY_APPS[0]].confirmed
check('跨应用记忆 ②: 回到的那一个把 intent 取回来, 账上每行都是「6 位 hash + 掩码后前 24 字」', [
  back.intent, back.resumed,
  backRows.every((row) => /^[0-9a-f]{6} \S{1,24}$/u.test(row)),
  backRows.map((row) => api.exploreMemoryBare(row)),
], [MEMORY_INTENT, 1, true, ['点省电', '点开关', '看阈值']])
check('跨应用记忆 ③: 下一步提示第一行含原 intent, 后面 3 条 confirmed', [
  hint.length,
  (hint[0] ?? '').includes(MEMORY_INTENT),
  hint.slice(1),
], [4, true, ['已确认: 点省电', '已确认: 点开关', '已确认: 看阈值']])
check('跨应用记忆 ④: 失败那一条只计数, 不进提示', [
  api.exploreMemoryFor(remembered, MEMORY_APPS[2]).failed,
  hint.some((line) => line.includes('点新增')),
], [1, false])
check('跨应用记忆 ④-b: intent 取第一行 (记号剥掉), 超长截到 60 字', [
  api.exploreMemoryIntent('\n## 下一场先看什么\n- 聊天记录里的称呼'),
  api.exploreMemoryIntent('   \n\n'),
  api.exploreMemoryIntent(`看${'很'.repeat(80)}`).length,
], ['下一场先看什么', '', 60])

let repeated = {}
for (const at of [1, 2]) {
  repeated = api.exploreMemoryStep(repeated, {
    pkg: 'com.example.notes', intent: MEMORY_INTENT, effect: 'changed', text: '点省电', at,
  }, 8)
}
check('跨应用记忆 ④-c: 连点同一个控件只占一行 confirmed (同一行封出来的 hash 也一样)', [
  api.exploreMemoryFor(repeated, 'com.example.notes').confirmed
    .map((row) => row.replace(/^[0-9a-f]{6} /u, '')),
  api.exploreMemoryFor(repeated, 'com.example.notes').confirmed.length,
], [['点省电'], 1])

process.env.EXPLORE_MEMORY_MAX = '0'
const offLimit = api.exploreMemoryLimit()
const off = memoryScene(offLimit)
const offStatus = api.exploreMemoryStatus({ memory: off, pkg: MEMORY_APPS[0] }, offLimit)
const offHint = api.exploreMemoryHint(api.exploreMemoryFor(off, MEMORY_APPS[0]))
delete process.env.EXPLORE_MEMORY_MAX
check('跨应用记忆 ⑤: EXPLORE_MEMORY_MAX=0 同一场景 → resumed=0 且提示里没有 intent', [
  offLimit, api.exploreMemoryCounts(off), Object.keys(off).length, offHint, offStatus.enabled,
], [0, { packages: 0, interrupted: 0, resumed: 0, pressedCount: 0 }, 0, [], false])

const status = api.exploreMemoryStatus({ memory: remembered, pkg: MEMORY_APPS[0] })
check('跨应用记忆 ⑥: status 里四个数 + 手里这一个 + 取回的下一步提示', [
  status.packages, status.interrupted, status.resumed, status.pressedCount,
  status.current, status.enabled,
  (status.hint[0] ?? '').includes(MEMORY_INTENT),
], [3, 2, 1, 0, MEMORY_APPS[0], true, true])

/**
 * 上限那一档 (审查 M3 / 第二轮 G): cap=3 走过 4 个应用 → **硬界是 cap**, 最早那一条被淘汰
 *
 * 第一级 (不是手里这个、也没被打断) 和第三级 (按 at 升序, 手里这个最后) 都走一遍: 三个应用全被打断
 * 之后只能走第三级, 走掉的是 `at` 最小的那一个, 最近被打断的那条还在账上
 */
const FOUR_APPS = ['com.example.one', 'com.example.two', 'com.example.three', 'com.example.four']
let capped = {}
FOUR_APPS.forEach((pkg, index) => {
  capped = api.exploreMemoryStep(capped, {
    pkg, intent: MEMORY_INTENT, effect: 'changed', text: `点第${index + 1}个`, at: 100 + index,
  }, 3)
})
const cappedBack = api.exploreMemoryFor(capped, FOUR_APPS[2])
check('跨应用记忆 ⑦: cap=3 走过四个应用 → 条数 = cap, 最近被打断那条还在、最早那条被淘汰', [
  api.exploreMemoryCounts(capped).packages,
  Object.keys(capped),
  cappedBack.found,
  cappedBack.interrupted,
  api.exploreMemoryFor(capped, FOUR_APPS[0]).found,
  (api.exploreMemoryHint(cappedBack)[0] ?? '').includes(MEMORY_INTENT),
], [3, [FOUR_APPS[1], FOUR_APPS[2], FOUR_APPS[3]], true, true, false, true])

let twice = {}
for (const [index, pkg] of ['a', 'b', 'a', 'b', 'a'].entries()) {
  twice = api.exploreMemoryStep(twice, { pkg, intent: 'x', effect: 'read', at: index + 1 }, 8)
}
check('跨应用记忆 ⑧: 第一次进不算回来, 第二次进同一个应用才 +1', [
  api.exploreMemoryCounts(twice), api.exploreMemoryFor(twice, 'a').resumed,
], [{ packages: 2, interrupted: 1, resumed: 3, pressedCount: 0 }, 2])

/**
 * ⑨ 这一档喂**真生产者发得出的回执**, 不再喂 `{effect:'unchanged'}` (那个字段基线里没有人生成)
 *
 * 基线这一档的桥只会回 `tapped` / `swiped` / `clicked` (没有 #32 的 effect 回读), 所以"发出去
 * 了"一律 `unknown` (审查 M1); 等 #32 进基线, 回执里带上 `effect` 才会走到那三档
 */
check('跨应用记忆 ⑨: 桥只报动作送到了 → unknown; 熄屏与没发出去仍按失败算', [
  api.exploreMemoryEffect({ tapped: true }),
  api.exploreMemoryEffect({ swiped: true, displayId: 3 }),
  api.exploreMemoryEffect({ clicked: true, outcome: 'clicked' }),
  api.exploreMemoryEffect({ tapped: true, screen: 'off' }),
  api.exploreMemoryEffect({ clicked: false, outcome: 'unclicked' }),
  api.exploreMemoryEffect({ error: 'no accessibility' }),
], ['unknown', 'unknown', 'unknown', 'failed', 'failed', 'failed'])

check('跨应用记忆 ⑩: run 上三格 / 开场定 intent 清账 / 收尾与重启都认它', [
  /\n {2}intent: '',\n {2}pkg: '',\n {2}memory: \{\},/u.test(host),
  /exploreRun\.intent = exploreMemoryIntent\(options\?\.text\) \|\| '自由探索这台手机'/u.test(host),
  /const keptMemory = exploreMemoryLimit\(\) === 0 \? \{\} : exploreMemoryOpen\(run\.memory\)/u.test(host),
  /exploreRun\.intent = exploreMemoryIntent\(run\.intent\)/u.test(host),
], [true, true, true, true])

check('跨应用记忆 ⑪: status 里那四个数与那一行回执都在', [
  /memory: exploreMemoryStatus\(exploreRun\)/u.test(host),
  /`memory: \$\{readings\.memory\.packages\} app\(s\), \$\{readings\.memory\.interrupted\} interrupted,/u.test(host),
  /\$\{readings\.memory\.resumed\} resumed, \$\{readings\.memory\.pressedCount\} pressed/u.test(host),
], [true, true, true])

check('跨应用记忆 ⑫: 看一眼 / 按一下 / 划一下 / 起一个应用都往账上记 (只认这一场)', [
  /exploreMemoryNote\(exec, exploreMemorySeen\(args\?\.displayId, result\?\.package\), 'read', ''\)/u.test(host),
  /exploreMemoryNote\(context, exploreMemoryOnDisplayPkg\(args\.displayId\), effect \?\? exploreMemoryEffect\(result\),/u
    .test(host),
  /exploreMemoryTapText\(args\), delivered === true\)/u.test(host),
  /exploreMemoryNote\(exec, exploreMemoryOnDisplayPkg\(args\.displayId\), 'read', ''\)/u.test(host),
  /exploreMemoryNote\(exec, exploreMemorySeen\(args\?\.displayId, launched\?\.package, true\), 'read', ''\)/u
    .test(host),
  /if \(exploreRun\.session === null \|\| exploreRun\.over === true\) return false\n {2}if \(sessionIdOf\(exec\) !== exploreRun\.session\) return false/u
    .test(host),
], [true, true, true, true, true, true])

/**
 * 真跑一遍那本账: 纯函数对了不等于接上了 —— 这一步走宿主真正用的入口 (`exploreMemoryNote`), 看它认
 * 不认这一场、那一句话到底塞给了哪一场、落不落进 `explore.json`、`EXPLORE_MEMORY_MAX=0` 关不关得掉
 *
 * `hostCtx` 不再是 null (审查 m7 的 ⑭): 桩一个会话控制器, 把 `steer` / `followup` 记下来 ——
 * "steer 塞进的是不是这一场 / over 之后还发不发"于是真跑出来, 不是从源码正则上看出来的
 */
const sayLog = []
const sayHost = {
  get: (name) => (name === 'sessionController'
    ? {
      resolveAgent: async (id) => ({
        agent: {
          id,
          status: 'running',
          session: { id },
          steer: (message) => sayLog.push({ how: 'steer', to: String(id), text: String(message?.text ?? '') }),
          followup: (message) => sayLog.push({ how: 'followup', to: String(id), text: String(message?.text ?? '') }),
          cancel: () => sayLog.push({ how: 'cancel', to: String(id) }),
        },
      }),
    }
    : null),
  agents: { withoutInitiator: (run) => run() },
  sessions: { flush: async () => true },
}

/** 一条消息就是那段正文 (exploreSay 只把它交给 agent) */
const sayMessage = async (text) => ({ text: String(text ?? '') })

/** `void exploreMemorySay(...)` 是从同步的执行里发出去的: 放两拍就够整条链走完 */
async function settle() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

const memoryHome = await mkdtemp(join(tmpdir(), 'lw-explore-memory-'))
const previousMemoryHome = process.env.DSH_HOME
process.env.DSH_HOME = memoryHome

/**
 * 记下每一次写 `explore.json` 的载荷 (第三轮 C): 判"恢复时自己重写了一次"要的是那一次**写**,
 * 不是再去读一遍文件 —— Windows 上 rename 撞上正在读的句柄会 EPERM, 读文件那一路会抖
 */
const stateWrites = []
const writeFileRecording = (path, data, ...rest) => {
  if (String(path).includes('explore.json')) stateWrites.push(String(data))
  return writeFile(path, data, ...rest)
}

/** 等到某一笔写盘载荷满足条件 (最多 ~1 s) */
async function waitForWrite(predicate, tries = 200) {
  for (let round = 0; round < tries; round += 1) {
    if (stateWrites.some(predicate)) return true
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return false
}

const memoryApi = new Function(
  'readFile', 'readdir', 'join', 'dirname', 'mkdir', 'writeFile', 'rename', 'rm', 'call',
  'shortSession', 'temporaryName', 'sessionIdOf', 'hostCtx', 'createVoiceMessage',
  'ROUTER_EVENT_BEFORE_DEFAULT', 'ROUTER_HOME_PACKAGES',
  `${section}\nreturn { exploreRun, exploreMemoryNote, exploreMemoryStatus, exploreMemoryFor,`
    + ' exploreMemoryHint, exploreMemorySeen, exploreMemoryOnDisplayPkg, exploreStateWrite,'
    + ' exploreStateRestore, exploreMemoryDropDisplay, exploreMemoryForgetDisplays,'
    + ' displays: () => ({ ...exploreMemoryOnDisplay }),'
    + ' resetRun: () => { exploreRun.memory = {}; exploreRun.pkg = ""; exploreRun.intent = "" } }',
)(
  readFile, readdir, join, dirname, mkdir, writeFileRecording, rename, rm, async () => ({}),
  (id) => String(id).slice(0, 8), (path) => `${path}.check.tmp`,
  // 与宿主那一份逐字同义 (它在这个文件里没有第二份)
  (exec) => (exec?.agent?.id === undefined || exec?.agent?.id === null ? null : String(exec.agent.id)),
  sayHost, sayMessage, EVENT_BEFORE_DEFAULT, ROUTER_HOME_PACKAGES,
)

const memoryExec = { agent: { id: 'explore-m' } }
const foreignExec = { agent: { id: 'someone-else' } }
memoryApi.exploreRun.session = 'explore-m'
memoryApi.exploreRun.over = false
memoryApi.exploreRun.intent = MEMORY_INTENT
const notedSteps = MEMORY_SCENE.map(([app, effect, text]) =>
  memoryApi.exploreMemoryNote(memoryExec, MEMORY_APPS[app], effect, text))
await settle()
const foreignNote = memoryApi.exploreMemoryNote(foreignExec, MEMORY_APPS[1], 'changed', '别人的')
const liveStatus = memoryApi.exploreMemoryStatus(memoryApi.exploreRun)

check('跨应用记忆 ⑬: 切回来那一句走 steer, 塞给的就是这一场, 第一行是取回的 intent', [
  sayLog.length,
  sayLog[0]?.how,
  sayLog[0]?.to,
  sayLog[0]?.text.split('\n'),
], [1, 'steer', 'explore-m', [
  `回到 ${MEMORY_APPS[0]}, 接着找: ${MEMORY_INTENT}`,
  '已确认: 打开设置',
  '已确认: 点省电',
]])

const saidBeforeOver = sayLog.length
memoryApi.exploreRun.over = true
const overNoted = memoryApi.exploreMemoryNote(memoryExec, MEMORY_APPS[0], 'changed', 'over 之后')
await settle()
memoryApi.exploreRun.over = false
check('跨应用记忆 ⑬-b: over 之后一步都不记, 也不再发 steer', [
  overNoted, sayLog.length - saidBeforeOver,
], [false, 0])

await memoryApi.exploreStateWrite()
const memoryBook = JSON.parse(await readFile(join(memoryHome, 'lw', 'explore.json'), 'utf8'))
const liveBack = memoryApi.exploreMemoryFor(memoryApi.exploreRun.memory, MEMORY_APPS[0])

check('跨应用记忆 ⑭: 真入口九步 → 三个数进 run / 别的会话记不进来', [
  notedSteps.every((one) => one === true),
  foreignNote,
  liveStatus.packages, liveStatus.interrupted, liveStatus.resumed, liveStatus.current,
], [true, false, 3, 2, 1, MEMORY_APPS[0]])
check('跨应用记忆 ⑮: 那本账真的落进 explore.json, 回来那一条的 intent 是原话', [
  Object.keys(memoryBook.run.memory),
  memoryBook.run.memory[MEMORY_APPS[0]].resumed,
  memoryBook.run.pkg,
  memoryApi.exploreMemoryHint(liveBack)[0].includes(MEMORY_INTENT),
], [MEMORY_APPS, 1, MEMORY_APPS[0], true])

process.env.EXPLORE_MEMORY_MAX = '0'
const offNoted = memoryApi.exploreMemoryNote(memoryExec, MEMORY_APPS[1], 'changed', '不该记')
const offLive = memoryApi.exploreMemoryStatus(memoryApi.exploreRun)
delete process.env.EXPLORE_MEMORY_MAX
/**
 * ⑯ 拆成两条 (第二轮 I): 「0 只挡新写」这一条是**已知的半关**, 不能写成"关掉就是回到今天"
 *
 * 一条判新账 (0 时一笔都不记), 一条判旧账 (盘上那本账照样报出来) —— 两条一起才说得出回退的边界
 */
check('跨应用记忆 ⑯: EXPLORE_MEMORY_MAX=0 → 新的一步一笔都不记 (memory 不长)', [
  offNoted, offLive.enabled, offLive.packages, offLive.interrupted,
], [false, false, 3, 2])
check('跨应用记忆 ⑯-b: 半关的边界 —— 0 只挡新写, 盘上旧账照样报 (已知, 不是"逐字回到今天")', [
  offLive.packages === 3, offLive.resumed, offLive.hint.length > 0,
], [true, 1, true])

/* ── 十九之二、审查返工 (2026-11-21, 36.rework.md 的 M1–M5 / m6–m8) ─────────── */

/**
 * 判据 6 (M1): 回执里没有 effect 时记 unknown —— confirmed 与 failed 两边都不进
 *
 * `unknown` 由 [exploreMemoryEffect] 自己给, 这里把它的答案喂给真值表那一份 `exploreMemoryStep`,
 * 看两边都没多出一行
 */
const unknownEffect = api.exploreMemoryStep({}, {
  pkg: 'com.example.notes',
  intent: MEMORY_INTENT,
  effect: api.exploreMemoryEffect({ tapped: true }),
  text: '点省电',
  at: 1,
}, 8)
check('跨应用记忆 ⑰: effect 拿不到 (unknown) → confirmed 与 failed 都不进', [
  api.exploreMemoryFor(unknownEffect, 'com.example.notes').confirmed,
  api.exploreMemoryFor(unknownEffect, 'com.example.notes').failed,
], [[], 0])

/**
 * 判据 4 (M2): `tapByReading` 的四种"什么都没按"必须自己说 pressed=false
 *
 * 抽宿主那一份源码来真跑 (`call` 是桩), 于是"读屏失败 / 熄屏 / 没这一行 / 同名两行"这四种情形
 * 各走一遍真分支 —— 不靠"候选是不是空"反推, 也不靠源码正则
 */
const tapStart = host.indexOf('async function tapByReading(')
const tapStop = host.indexOf('const MAX_TAP_CANDIDATES', tapStart)
if (tapStart < 0 || tapStop < 0) throw new Error('tapByReading is not in host-plugin/index.mjs')
const tapSource = host.slice(tapStart, tapStop)

/** 那一档的个数从宿主源码里取 (`const MAX_TAP_CANDIDATES = n`), 抽出来的那段自己看不见它 */
const MAX_TAP_CANDIDATES = Number((host.match(/const MAX_TAP_CANDIDATES = (\d+)/u) ?? [])[1])
/** 同名两行分得开的分差 (#37) —— 抽出来的那段也看不见它, 同样从源码里取 */
const TAP_SCORE_GAP = Number((host.match(/const TAP_SCORE_GAP = ([\d.]+)/u) ?? [])[1])

/** 一份只替桥的读屏: 第一次 `ocr` 回这里给的, 之后 `tap` 回队列里下一个 */
function readingWith(replies) {
  const queue = [...replies]
  return new Function('call', 'closestReadLines', 'scatterInside', 'formatMs', 'MAX_TAP_CANDIDATES',
    'tapPrecheckGeometry', 'TAP_SCORE_GAP',
    `${tapSource}\nreturn tapByReading`)(
    async (op) => (op === 'tap'
      ? (queue.shift() ?? { tapped: true, displayId: 7 })
      : (queue.shift() ?? {})),
    (lines) => lines.slice(0, 3).map((line) => ({ text: String(line.text ?? ''), score: 1, bbox: line.box })),
    (box) => ({ x: Number(box?.[0] ?? 0) + 1, y: Number(box?.[1] ?? 0) + 1 }),
    (value) => `${value}ms`,
    MAX_TAP_CANDIDATES,
    () => null,
    TAP_SCORE_GAP,
  )
}

const readFailed = await readingWith([{ error: 'accessibility is off' }])(4, '设置')
const readAsleep = await readingWith([{ screen: 'dozing', lines: [] }])(4, '设置')
const readMissing = await readingWith([{ screen: 'on', lines: [{ text: '蓝牙', box: [1, 2, 30, 40] }] }])(4, '设置')
const readAmbiguous = await readingWith([
  { screen: 'on', lines: [{ text: '设置', box: [1, 2, 30, 40] }, { text: '设置', box: [1, 50, 30, 90] }] },
])(4, '设置')
const readPressed = await readingWith([
  { screen: 'on', lines: [{ text: '设置', score: 0.9, box: [1, 2, 30, 40] }] },
  { tapped: true, displayId: 4 },
])(4, '设置')
const readUndelivered = await readingWith([
  { screen: 'on', lines: [{ text: '设置', score: 0.9, box: [1, 2, 30, 40] }] },
  { tapped: false, displayId: 4 },
])(4, '设置')

check('跨应用记忆 ⑱: 五种"没按"各自说得出原因, 真按到了才 pressed=true', [
  readFailed.pressed, readAsleep.pressed, readMissing.pressed, readAmbiguous.pressed,
  readMissing.candidates.length, readAmbiguous.candidates.length,
  readPressed.pressed, readUndelivered.pressed,
  readPressed.report.startsWith('pressed'),
  [readFailed.reason, readAsleep.reason, readMissing.reason, readAmbiguous.reason,
    readPressed.reason, readUndelivered.reason],
  // 同名两行交回去的是两条带 bbox 的候选 (第三轮 F): 只写报告不给候选 = 那句"按坐标选"没有坐标
  readAmbiguous.candidates.map((one) => [one.text, Array.isArray(one.bbox) ? one.bbox.length : 0]),
], [false, false, false, false, 1, 2, true, false, true,
  ['unreadable', 'asleep', 'no-match', 'ambiguous', 'pressed', 'undelivered'],
  [['设置', 4], ['设置', 4]]])

/**
 * 第二轮 F: 五种"没按"到模型那里要分成三路
 *
 * 熄屏 / 读不到 / 找到了没送达三种原样念原因 (下一步各不相同: 先唤醒 / 先开无障碍 / 换个点再按),
 * 只有"没这一行"与"同名两行"才换成候选列表 —— 上一版把它二分吃了, 三种原因全变成空候选
 */
const answerStart = host.indexOf('function tapReadingAnswer(')
const answerStop = host.indexOf('const MAX_TAP_CANDIDATES', answerStart)
if (answerStart < 0 || answerStop < 0) throw new Error('tapReadingAnswer is not in host-plugin/index.mjs')
const tapAnswer = new Function('tapCandidatesAnswer', 'tapPrecheckCandidatesAnswer', 'tapSkipAnswer',
  `${host.slice(answerStart, answerStop)}\nreturn tapReadingAnswer`)(
  (_d, _w, candidates) => `CANDIDATES:${(candidates ?? []).length}`,
  (_d, _w, candidates) => `CANDIDATES:${(candidates ?? []).length}`,
  (_d, _w, skip) => `SKIP:${String(skip?.skip ?? '')}`,
)
const answerOf = (reading, prefix = '') => tapAnswer(4, '设置', reading, undefined, prefix)

check('跨应用记忆 ⑱-b: 熄屏 / 读不到 / 没送达三种照念原因, 没这一行给最像的、同名两行给这两条', [
  answerOf(readAsleep).startsWith('the screen is dozing'),
  answerOf(readFailed).startsWith('the screen could not be read'),
  answerOf(readUndelivered).startsWith('found but the press was NOT reported'),
  answerOf(readMissing), answerOf(readAmbiguous),
  answerOf(readPressed, 'TREE'),
], [true, true, true, 'CANDIDATES:1', 'CANDIDATES:2', 'TREE\n' + readPressed.report])

/** 同名两条的开头不能再是「no line says it」(第三轮 F): 屏幕上有这一行, 只是不止一条 */
check('跨应用记忆 ⑱-c: 同名两条那段话换成「按坐标选一条」, 并且把两条候选原样交给模型', [
  /so pick the one you meant/u.test(host.slice(host.indexOf('function tapReadingAnswer('),
    host.indexOf('const MAX_TAP_CANDIDATES', host.indexOf('function tapReadingAnswer(')))),
  readAmbiguous.candidates.every((one) => one.bbox.length === 4 && typeof one.score === 'number'),
], [true, true])

/**
 * 第三轮 F: 那句开头与候选 JSON 真的出现在回执里 (抽 `tapCandidatesAnswer` 真跑, 只桩 `withJson`)
 */
const candidateStart = host.indexOf('function tapCandidatesAnswer(')
const candidateStop = host.indexOf('function scatterInside(', candidateStart)
if (candidateStart < 0 || candidateStop < 0) throw new Error('tapCandidatesAnswer is not in host-plugin/index.mjs')
const candidatesAnswer = new Function('withJson', 'candidateLines', 'centreInBox',
  `${host.slice(candidateStart, candidateStop)}\nreturn tapCandidatesAnswer`)(
  (lines, json) => ({ lines, json }),
  (candidates) => candidates.map((one) => `- ${JSON.stringify(one.text)}`),
  (box) => ({ x: Math.round((Number(box?.[0] ?? 0) + Number(box?.[2] ?? 0)) / 2),
    y: Math.round((Number(box?.[1] ?? 0) + Number(box?.[3] ?? 0)) / 2) }),
)
const ambiguousAnswer = candidatesAnswer(4, '设置', readAmbiguous.candidates, undefined,
  '2 lines on displayId 4 say "设置", so pick the one you meant')
const noMatchAnswer = candidatesAnswer(4, '设置', readMissing.candidates, undefined)
check('跨应用记忆 ⑱-d: 同名两条的开头按坐标为先, 候选 JSON 带 bbox; 没这一行仍说「没有这一行」', [
  ambiguousAnswer.lines[0],
  ambiguousAnswer.json.candidates.length,
  ambiguousAnswer.json.candidates.every((one) => one.bbox.length === 4),
  /^no line on displayId 4 says/u.test(noMatchAnswer.lines[0]),
], ['2 lines on displayId 4 say "设置", so pick the one you meant: nothing was pressed. These are'
  + ' the ones to pick from:', 2, true, true])

/**
 * 判据 5 (m6): 滑动只算"还在这个应用里", 三个"已确认"格留给 lw_tap 的控件名
 *
 * 行为那一半真跑三下 (效果就是 lw_swipe 现在交的那个 `read` + 空文本), 接线那一半看 lw_swipe
 * 那一段自己 (工具体要桥, 跑不起来; 只切这一段, 不是整份源码正则)
 */
const swipeAt = host.indexOf("name: 'lw_swipe'")
const swipeStop = host.indexOf("name: 'lw_type'", swipeAt)
const swipeBody = host.slice(swipeAt, swipeStop)
const swipeSteps = [1, 2, 3].reduce((memory, index) => api.exploreMemoryStep(memory, {
  pkg: 'com.example.notes', intent: MEMORY_INTENT, effect: 'read', text: '', at: 500 + index,
}, 8), {})
check('跨应用记忆 ⑲: 滑动三次 → confirmed 不增, 也不进 failed', [
  swipeBody.length > 0,
  /exploreMemoryNote\(exec, exploreMemoryOnDisplayPkg\(args\.displayId\), 'read', ''\)/u.test(swipeBody),
  /exploreMemoryEffect\(swiped\)|exploreMemorySwipeText/u.test(swipeBody),
  api.exploreMemoryFor(swipeSteps, 'com.example.notes').confirmed,
  api.exploreMemoryFor(swipeSteps, 'com.example.notes').failed,
], [true, true, false, [], 0])

/**
 * 判据 3 (M4) 与第二轮 B: 敏感包跑一趟 → 一条都不记, 盘上也没有那句明文
 *
 * 正样本是第二轮实测漏掉的那批 (微信 / QQ / 各邮箱 / 密码管理器 / 健康 / 银行券商 / spay /
 * smsextra / 输入法); 反样本是探索真会走的普通应用, 一个都不许误伤
 */
const tapAt = host.indexOf("name: 'lw_tap'")
const tapEnd = host.indexOf("name: 'lw_key'", tapAt)
const tapBody = host.slice(tapAt, tapEnd)
const sensitivePkgs = [
  'com.android.messaging', 'com.google.android.contacts', 'com.android.dialer',
  'com.icbc', 'com.eg.android.AlipayGphone', 'com.tencent.mm.wallet',
  'com.tencent.mm', 'com.tencent.mobileqq', 'com.google.android.gm', 'com.netease.mail',
  'com.x8bit.bitwarden', 'com.onepassword.android', 'com.google.android.apps.fitness',
  'com.xiaomi.hm.health', 'com.huawei.health', 'com.chinamworld.bocmbci', 'com.chinamworld.main',
  'com.pingan.paces.ccms', 'com.eastmoney.android.berlin', 'com.htsc.mdc',
  'com.samsung.android.spay', 'com.miui.smsextra', 'com.iflytek.inputmethod',
]
check('跨应用记忆 ⑳: 短信 / 通讯录 / 电话 / 微信 / QQ / 邮箱 / 密码管理器 / 健康 / 银行券商 / 支付 / 输入法都认', [
  sensitivePkgs.filter((pkg) => api.exploreMemorySensitive(pkg) !== true),
  ['com.example.notes', 'com.android.settings', 'com.example.mail', 'com.example.calendar'].map(
    (pkg) => api.exploreMemorySensitive(pkg),
  ),
  api.exploreMemorySensitive(''),
], [[], [false, false, false, false], false])

memoryApi.resetRun()
const smsNote = memoryApi.exploreMemoryNote(memoryExec, 'com.android.messaging', 'changed', '验证码 8891')
const bankNote = memoryApi.exploreMemoryNote(memoryExec, 'com.icbc', 'changed', '余额 120000.00')
const notesNote = memoryApi.exploreMemoryNote(memoryExec, MEMORY_APPS[0], 'changed', '打开设置')
await memoryApi.exploreStateWrite()
const bookText = await readFile(join(memoryHome, 'lw', 'explore.json'), 'utf8')
check('跨应用记忆 ⑳-b: 敏感包整条跳过 —— 账上没有它, explore.json 里没有那句明文', [
  smsNote, bankNote, notesNote,
  Object.keys(memoryApi.exploreRun.memory),
  /验证码|120000/u.test(bookText),
  /com\.android\.messaging|com\.icbc/u.test(bookText),
], [false, false, true, [MEMORY_APPS[0]], false, false])

/**
 * 第二轮 C: **读侧也要滤** —— 升级机器上盘里还留着上一版 40 字明文写的敏感行
 *
 * 只挡写这一侧等于老明文留着照念: `run.pkg` 是短信、`memory` 里有 `com.android.messaging` 那一行
 * (confirmed 里就是「验证码 8891」)。重启读回来之后: 包名置空、那一行不在、三条读路都不念它
 */
const legacyRun = {
  session: 'explore-legacy',
  workspace: '', startedAt: 1, deadline: 2, minutes: 30, steps: 3, stepLimit: 60,
  reminded: false, over: false, intent: MEMORY_INTENT,
  pkg: 'com.android.messaging',
  memory: {
    'com.android.messaging': {
      intent: MEMORY_INTENT, confirmed: ['验证码 8891'], failed: [], interrupted: false,
      resumed: 0, active: true, at: 3,
    },
    [MEMORY_APPS[0]]: {
      intent: MEMORY_INTENT, confirmed: ['打开设置'], failed: [], interrupted: true,
      resumed: 0, active: false, at: 4,
    },
  },
}
await writeFile(join(memoryHome, 'lw', 'explore.json'),
  JSON.stringify({ v: 1, updatedAt: 1, run: legacyRun }), 'utf8')
const restoredLegacy = await memoryApi.exploreStateRestore()
const legacyStatus = memoryApi.exploreMemoryStatus(memoryApi.exploreRun)
const legacyView = memoryApi.exploreMemoryFor(memoryApi.exploreRun.memory, 'com.android.messaging')
const legacyHint = api.exploreMemoryHint(legacyView)

check('跨应用记忆 ⑳-c: 盘上预置一行敏感包 → 读回来就丢, 盘上那份当场重写干净 (没人再写一次)', [
  restoredLegacy,
  memoryApi.exploreRun.pkg,
  Object.keys(memoryApi.exploreRun.memory),
  legacyStatus.packages,
  legacyView.found,
  legacyHint,
  legacyStatus.hint.some((line) => line.includes('验证码')),
  await waitForWrite((one) => !/8891|com\.android\.messaging/u.test(one)),
], [true, '', [MEMORY_APPS[0]], 1, false, [], false, true])

/** 第三轮 C 的同一条纪律对 `run.pkg` 也成立: 盘上那一格是平台壳的, 读回来置空并重写 */
const shellBookRun = {
  session: 'explore-shell',
  workspace: '', startedAt: 1, deadline: 2, minutes: 30, steps: 1, stepLimit: 60,
  reminded: false, over: false, intent: MEMORY_INTENT,
  pkg: 'com.android.systemui',
  memory: {
    [MEMORY_APPS[0]]: {
      intent: MEMORY_INTENT, confirmed: ['打开设置'], failed: [], interrupted: true,
      resumed: 0, active: false, at: 4,
    },
  },
}
// 先把还挂着的写链走完再种这一份 (免得自己种的内容被上一次写盖掉)
await memoryApi.exploreStateWrite()
stateWrites.length = 0
await writeFile(join(memoryHome, 'lw', 'explore.json'),
  JSON.stringify({ v: 1, updatedAt: 1, run: shellBookRun }), 'utf8')
const restoredShell = await memoryApi.exploreStateRestore()
check('跨应用记忆 ㉚: 盘上 run.pkg 是平台壳 → 置空, 恢复时就把盘上那份写干净', [
  restoredShell,
  memoryApi.exploreRun.pkg,
  Object.keys(memoryApi.exploreRun.memory),
  await waitForWrite((one) => /"pkg":""/u.test(one) && !/com\.android\.systemui/u.test(one)),
], [true, '', [MEMORY_APPS[0]], true])

const seenProbe = {
  sameAgain: [api.exploreMemorySeen(0, 'com.example.notes'), api.exploreMemorySeen(0, 'com.example.notes')],
  changed: api.exploreMemorySeen(0, 'com.example.calendar'),
  trusted: api.exploreMemorySeen(0, 'com.example.notes', true),
  shade: api.exploreMemorySeen(4, 'com.android.systemui'),
  permission: api.exploreMemorySeen(4, 'com.android.permissioncontroller'),
  homes: ['com.miui.home', 'com.bbk.launcher2', 'com.huawei.android.launcher',
    // 这张只有共用表才认得 (包名里没有 launcher 这个段): 删掉 shell 里那行 `ROUTER_HOME_PACKAGES`
    // 就只剩它会被当成"探索走到了这个应用" (第三轮 ㉑ 补硬)
    'com.google.android.apps.nexuslauncher',
  ].map((pkg) => api.exploreMemorySeen(5, pkg)),
  ime: api.exploreMemorySeen(4, 'com.iflytek.inputmethod'),
  virtualScreen: api.exploreMemorySeen(4, 'com.example.mail'),
  displayFour: api.exploreMemoryOnDisplayPkg(4),
  displayZero: api.exploreMemoryOnDisplayPkg(0),
  displayUnknown: api.exploreMemoryOnDisplayPkg(9),
}
check('跨应用记忆 ㉑: 归属 = 起应用 (一定认) 或主屏/虚拟屏上包名真的变了; 平台那几张脸不认', [
  seenProbe.sameAgain,
  seenProbe.changed,
  seenProbe.trusted,
  [seenProbe.shade, seenProbe.permission, seenProbe.ime, ...seenProbe.homes],
  [seenProbe.displayFour, seenProbe.displayZero, seenProbe.displayUnknown],
  tapBody.length > 0,
  /exploreMemoryOnDisplayPkg\(args\.displayId\)/u.test(tapBody),
], [
  // 主屏第一次认下来, 同一个包再看一次不算"换应用" (第二轮 A)
  ['com.example.notes', ''],
  'com.example.calendar',
  'com.example.notes',
  ['', '', '', '', '', '', ''],
  ['com.example.mail', 'com.example.notes', ''],
  true,
  true,
])

/**
 * 第二轮 A / 第三轮 ㉑-b 补硬: 那张表跟场次一起走 —— 还掉一块屏就删一格, 换一场就整张清空
 *
 * 只断言"源码里有这行"是软判据 (删掉调用点仍然全绿): 这里真调一次 `exploreReset`, 看表空不空
 */
api.exploreMemorySeen(7, 'com.example.notes')
const afterDrop = (() => {
  api.exploreMemoryDropDisplay(7)
  return api.exploreMemoryOnDisplayPkg(7)
})()
api.exploreMemorySeen(8, 'com.example.mail')
api.exploreMemorySeen(9, 'com.example.calendar')
const beforeReset = [api.exploreMemoryOnDisplayPkg(8), api.exploreMemoryOnDisplayPkg(9)]
api.exploreReset()
check('跨应用记忆 ㉑-b: 还屏删那一格、换场清整张表 (真跑一次 exploreReset, 删掉调用点就红)', [
  afterDrop,
  beforeReset,
  [api.exploreMemoryOnDisplayPkg(8), api.exploreMemoryOnDisplayPkg(9)],
  /exploreMemoryForgetDisplays\(\)/u.test(host),
  (host.match(/exploreMemoryDropDisplay\(entry\.displayId\)/gu) ?? []).length,
], ['', ['com.example.mail', 'com.example.calendar'], ['', ''], true, 2])

/**
 * M3: 切走不改别人的 `at` (那把尺子被改写, 淘汰就只能按包名字典序挑), 淘汰按 `at` 再按包名稳定排
 */
let clockOn = {}
clockOn = api.exploreMemoryStep(clockOn, { pkg: 'com.example.a', intent: MEMORY_INTENT, effect: 'read', at: 1_000 }, 8)
clockOn = api.exploreMemoryStep(clockOn, { pkg: 'com.example.b', intent: MEMORY_INTENT, effect: 'read', at: 2_000 }, 8)
const handLedger = {
  'com.example.b': { intent: 'x', confirmed: [], failed: [], interrupted: false, resumed: 0, active: false, at: 5 },
  'com.example.a': { intent: 'x', confirmed: [], failed: [], interrupted: false, resumed: 0, active: false, at: 5 },
  'com.example.c': { intent: 'x', confirmed: [], failed: [], interrupted: false, resumed: 0, active: false, at: 9 },
}
const evictedLedger = api.exploreMemoryStep(handLedger, {
  pkg: 'com.example.d', intent: 'x', effect: 'read', at: 20,
}, 3)
check('跨应用记忆 ㉒: 切走不改别人的 at; 淘汰按 at 再按包名 (同 at 时字典序小的先走)', [
  clockOn['com.example.a'].at,
  clockOn['com.example.b'].at,
  Object.keys(evictedLedger),
], [1_000, 2_000, ['com.example.b', 'com.example.c', 'com.example.d']])

/**
 * 第二轮 D: 盘上那条 = 短 hash + **掩码后**前 24 字
 *
 * 三件一起判: ① 长文本第 25 字之后不留; ② 数字串与金额被抹掉; ③ 幂等按"切 7 字重算 hash"认,
 * 所以 `100000 元` 这种真控件文本不会被当成已封而吃掉头 6 个字符
 */
const longText = `省电模式 ${'很'.repeat(60)}`
const sealedLong = api.exploreMemorySeal(longText)
const sealedMoney = api.exploreMemorySeal('余额 120000.00 元')
const sealedOrder = api.exploreMemorySeal('订单 12345678 已发货')
check('跨应用记忆 ㉓: 落盘那条 = hash + 掩码后前 24 字, 幂等, 数字与金额先抹掉', [
  api.EXPLORE_MEMORY_TEXT_CHARS,
  api.exploreMemoryBare(sealedLong),
  sealedLong.length <= api.EXPLORE_MEMORY_ROW_CHARS,
  api.exploreMemorySeal(sealedLong) === sealedLong,
  api.exploreMemorySeal(''),
  /\d{4,}/u.test(api.exploreMemoryBare(sealedOrder)),
  api.exploreMemoryBare(sealedOrder),
  // 「余额」那一类整条不进 (数字掩掉了也还是那句话)
  sealedMoney,
  api.exploreMemorySeal('验证码 8891'),
], [24, longText.slice(0, 24), true, true, '', false, '订单 **** 已发货', '', ''])

/** 第二轮 D: 幂等判据不再只看形状 —— 以 6 位十六进制开头的真控件文本一个字都不许被吃掉 */
check('跨应用记忆 ㉓-b: 「100000 元」这种以 6 位 hex 开头的真文本不被当成已封', [
  api.exploreMemoryBare('100000 元'),
  api.exploreMemoryBare('abcdef 已完成'),
  /^[0-9a-f]{6} \*{4} 元$/u.test(api.exploreMemorySeal('100000 元')),
  api.exploreMemoryBare(api.exploreMemorySeal('100000 元')),
], ['100000 元', 'abcdef 已完成', true, '**** 元'])

/** 提示念的是控件名, 不念盘上那个 hash (hash 只给磁盘对账用) */
check('跨应用记忆 ㉔: 下一步提示念控件名, 不念 hash', [
  api.exploreMemoryHint({
    pkg: 'com.example.notes',
    intent: MEMORY_INTENT,
    confirmed: [api.exploreMemorySeal('点省电')],
  }),
], [[`回到 com.example.notes, 接着找: ${MEMORY_INTENT}`, '已确认: 点省电']])

/**
 * 第二轮 E: `pressed` 档 —— 基线没有 effect 回读, `changed` 在生产里没有生产者
 *
 * 真入口: "按到了但界面变没变没人读"记进第三档 (confirmed 仍是空的), 提示第二段念「上次按过: X」,
 * status 的 pressedCount 跟着长 —— 真机上"3 条已确认"不可能出现, 但提示不会空着
 */
memoryApi.resetRun()
// ⑳-c 那条 restore 把场次换成了盘上那一场 (`explore-legacy`): 这里换回桩的场次再往下走
memoryApi.exploreRun.session = 'explore-m'
memoryApi.exploreRun.over = false
memoryApi.exploreRun.intent = MEMORY_INTENT
const pressedNote = memoryApi.exploreMemoryNote(memoryExec, MEMORY_APPS[0], 'unknown', '省电开关', true)
const notDelivered = memoryApi.exploreMemoryNote(memoryExec, MEMORY_APPS[0], 'unknown', '不该进', false)
const pressedView = memoryApi.exploreMemoryFor(memoryApi.exploreRun.memory, MEMORY_APPS[0])
const pressedStatus = memoryApi.exploreMemoryStatus(memoryApi.exploreRun)
check('跨应用记忆 ㉕: 按到了 (unknown + delivered) → 进「上次按过」, confirmed 仍空', [
  pressedNote, notDelivered,
  pressedView.confirmed,
  api.exploreMemoryBare(pressedView.pressed[0] ?? ''),
  pressedStatus.pressedCount,
  api.exploreMemoryHint(pressedView),
], [true, true, [], '省电开关', 1, [
  `回到 ${MEMORY_APPS[0]}, 接着找: ${MEMORY_INTENT}`,
  '上次按过: 省电开关',
]])

/**
 * 第二轮 G: 三级淘汰的硬界 —— 10 个应用走过, 条数仍是 cap, 最近被打断那条还在
 *
 * 一级 (非手里/非 interrupted) 恒空、二级 (回去过却什么都没捞到) 也空, 于是走到三级: 按 `at` 升序
 * 淘汰, 手里这个最后 —— 留下的是最近那 8 个, 最早两个走掉
 */
const TEN_APPS = Array.from({ length: 10 }, (_, index) => `com.example.app${index + 1}`)
let tenLedger = {}
TEN_APPS.forEach((pkg, index) => {
  tenLedger = api.exploreMemoryStep(tenLedger, {
    pkg, intent: MEMORY_INTENT, effect: 'read', at: 1_000 + index,
  }, api.EXPLORE_MEMORY_MAX_DEFAULT)
})
const tenKeys = Object.keys(tenLedger)
check('跨应用记忆 ㉖: 十个应用走过 → 条数 = cap(8), 最近被打断那条还在、最早两条被淘汰', [
  tenKeys.length,
  tenKeys.includes(TEN_APPS[8]),
  tenKeys.includes(TEN_APPS[9]),
  tenKeys.includes(TEN_APPS[0]),
  tenKeys.includes(TEN_APPS[1]),
  api.exploreMemoryCounts(tenLedger).interrupted,
], [8, true, true, false, false, 7])

/**
 * 第二轮 H (最要紧): 判据要能把实现改回去**证伪**
 *
 * 这一段钉的是 lw_tap 的工具体: 两处读屏兜底一律 `null, 'unknown'` (不是 changed/failed), 两处
 * 判断按没按都用 `reading.pressed === true` (不是"候选是不是空") —— 拿回上一版的写法这里就红
 */
check('跨应用记忆 ㉗: lw_tap 两处都是 unknown + pressed 布尔 (改回 changed/候选反推就红)', [
  (tapBody.match(/null, 'unknown'/gu) ?? []).length,
  (tapBody.match(/reading\.pressed === true/gu) ?? []).length,
  /reading\.candidates\.length === 0/u.test(tapBody),
  /null, 'changed'|null, 'failed'/u.test(tapBody),
  /tapReadingAnswer\(/gu.test(tapBody),
], [2, 2, false, false, true])

/**
 * 第二轮 H: ⑨ 的邻居 —— #32 的 effect 回读进基线之后的那份契约
 *
 * 回执里带 `effect` 就照它走 (changed / unchanged / failed / unknown 四档原样透传); 把
 * `exploreMemoryEffect` 里那三行透传删掉, 这一条立刻红
 */
check('跨应用记忆 ㉘: #32 回读进基线之后的透传契约 (effect 四档原样透传, 熄灭仍算 failed)', [
  api.exploreMemoryEffect({ effect: 'changed' }),
  api.exploreMemoryEffect({ effect: 'unchanged', tapped: true }),
  api.exploreMemoryEffect({ effect: 'failed', tapped: true }),
  api.exploreMemoryEffect({ effect: 'unknown', tapped: true }),
  api.exploreMemoryEffect({ effect: 'changed', screen: 'off' }),
], ['changed', 'unchanged', 'failed', 'unknown', 'failed'])

/**
 * 第三轮 E: 生产里最常见的那条 (a11y 按名成功) 也要落到 `pressed` 档
 *
 * 桩桥回 `{clicked:true}` → `exploreMemoryDelivered` 为真 → 真入口记一行 `pressed`; 少传这一个布尔,
 * 真机上 `confirmed` 空、`pressed` 也空, 提示只剩 intent 一行 —— 这一条就是那个口子的钉子
 */
memoryApi.resetRun()
memoryApi.exploreRun.session = 'explore-m'
memoryApi.exploreRun.over = false
memoryApi.exploreRun.intent = MEMORY_INTENT
const a11yTree = { clicked: true, outcome: 'clicked', displayId: 3, matches: [{ text: '省电开关' }] }
const a11yAmbiguous = { clicked: false, outcome: 'ambiguous' }
const a11yNote = memoryApi.exploreMemoryNote(memoryExec, MEMORY_APPS[0], 'unknown', '省电开关',
  api.exploreMemoryDelivered(a11yTree))
const a11yView = memoryApi.exploreMemoryFor(memoryApi.exploreRun.memory, MEMORY_APPS[0])
check('跨应用记忆 ㉙: a11y 按名成功 (clicked) → 真的进「上次按过」, 同名两条不算按到', [
  a11yNote,
  api.exploreMemoryDelivered(a11yTree),
  api.exploreMemoryDelivered(a11yAmbiguous),
  api.exploreMemoryDelivered({ tapped: true }),
  api.exploreMemoryStatus(memoryApi.exploreRun).pressedCount,
  api.exploreMemoryHint(a11yView)[1],
  /const deliveredNamed = exploreMemoryDelivered\(tree\)/u.test(tapBody),
  /exploreMemoryDelivered\(delivered\)/u.test(tapBody),
], [true, true, false, true, 1, '上次按过: 省电开关', true, true])

/** 第三轮 E 的边: `pressed` 那一档也只留 3 条 (与「已确认」同一把尺子), 跨应用合起来数得对 */
memoryApi.resetRun()
memoryApi.exploreRun.session = 'explore-m'
memoryApi.exploreRun.over = false
memoryApi.exploreRun.intent = MEMORY_INTENT
for (const text of ['开关一', '开关二', '开关三', '开关四', '开关五']) {
  memoryApi.exploreMemoryNote(memoryExec, MEMORY_APPS[0], 'unknown', text, true)
}
memoryApi.exploreMemoryNote(memoryExec, MEMORY_APPS[1], 'unknown', '邮件设置', true)
const cappedPressed = memoryApi.exploreMemoryFor(memoryApi.exploreRun.memory, MEMORY_APPS[0]).pressed
const pressedAll = api.exploreMemoryCounts(memoryApi.exploreRun.memory)
check('跨应用记忆 ㉛: 「上次按过」每个应用只留最近 3 条, pressedCount 跨应用合起来数', [
  cappedPressed.length,
  cappedPressed.map((row) => api.exploreMemoryBare(row)),
  pressedAll.pressedCount,
], [3, ['开关三', '开关四', '开关五'], 4])

// 把还挂着的写盘链走完再删目录 (不然那几行 ENOENT 是判据自己的噪声)
await memoryApi.exploreStateWrite()
await rm(memoryHome, { recursive: true, force: true })
if (previousMemoryHome === undefined) delete process.env.DSH_HOME
else process.env.DSH_HOME = previousMemoryHome
/* ── 八、按完先验一次: 连着两下没变就停 (2.8.1 落实表 #32) ───────────────── */

/**
 * 点按效果那一小段在探索那一段外面 (`lw_tap` 那一侧): 抽出来真跑, 不复制第二份
 *
 * 只递它真正用到的那几个名字 —— `call` / `withTimeout` 在这里一次都不会被调到 (它们只服务真按下去
 * 的那条路), `closestReadLines` 给一个同形状的替身 (真正的打分由 `check-phone-actions` 端到端量)
 */
const effectStart = host.indexOf('/* ── 按完这一下先验一次')
const effectEnd = host.indexOf('/** A report a model can read, with the structured answer kept underneath it */')
if (effectStart < 0 || effectEnd < 0 || effectEnd < effectStart) {
  throw new Error('the tap effect section is not in host-plugin/index.mjs')
}
/** 这一节假设备的树 (`call('ui')` 答的那一份): 换 `tapUiAnswer` 就是换一屏 */
let tapUiAnswer = null

const tapApi = new Function(
  'call', 'withTimeout', 'closestReadLines', 'MAX_TAP_CANDIDATES', 'sameRect', 'squashText',
  `${host.slice(effectStart, effectEnd)}\nreturn { TAP_EFFECT_STREAK, TAP_EFFECT_KEPT,`
    + ' TAP_EFFECT_WAIT_MS, TAP_MIN_SIDE, TAP_SCORE_GAP, tapEffectSnapshot, tapEffectFingerprint,'
    + ' tapEffectOf, tapEffectTail, tapEffectStreak, tapEffectBrake, formatTapEffect,'
    + ' tapNameMatches, tapPrecheckGeometry, tapPrecheck, tapAnchorMismatch, tapEffectRecover }',
)(
  async () => tapUiAnswer,
  (promise) => promise,
  (lines, _wanted, limit) => lines.slice(0, limit).map((line) => ({
    text: line.text, score: 1, bbox: line.box,
  })),
  3,
  (left, right) => JSON.stringify(left) === JSON.stringify(right),
  (value) => String(value ?? '').toLowerCase().replace(/\s+/gu, ''),
)

check('两处那个"连着几条算停"是同一个数 (2)', [
  tapApi.TAP_EFFECT_STREAK,
  new RegExp(`const TAP_EFFECT_STREAK = ${TAP_EFFECT_STREAK}\\b`, 'u').test(host),
], [TAP_EFFECT_STREAK, true])

/** 一块屏的快照 (与 `tapEffectSnapshot` 同一个形状), 只给得出字的那几格 */
const screenOf = (labels) => ({
  displayId: 0,
  label: 'Settings',
  nodes: labels.map((label, index) => ({
    label,
    bounds: [40, 300 + index * 100, 900, 380 + index * 100],
  })),
  texts: [...labels],
})

/**
 * 与 `lw_tap` 同一个次序走三步: 先读一次树 → 看刹车 → 决定发不发 → 记一条
 *
 * 屏幕一动不动, 于是三下都是 unchanged: 前两下发出去, 第三下被拦在原地
 */
const runPresses = (howMany) => {
  const log = []
  const screen = screenOf(['设置', '蓝牙', '位置信息', '设备连接'])
  const sent = []
  let blocked = null
  for (let step = 1; step <= howMany; step += 1) {
    const brake = tapApi.tapEffectBrake(log, 'explore-1', screen, '设置')
    if (brake !== null) {
      sent.push(false)
      blocked = brake
      continue
    }
    sent.push(true)
    log.push({
      step,
      effect: 'unchanged',
      displayId: 0,
      at: 0,
      fingerprint: tapApi.tapEffectFingerprint(screen),
      session: 'explore-1',
    })
  }
  return { sent, blocked, log }
}

const pressed = runPresses(3)
check('连着两下 unchanged 之后第三次 tap 一次都不发 (发出去的是前两下)', pressed.sent, [true, true, false])
check('第三次被拦下来时报 reason=effect-missing', pressed.blocked?.reason, 'effect-missing')
check('拦下来那一下给三个候选 (text / score / bbox)', [
  pressed.blocked?.candidates.length,
  pressed.blocked?.candidates.every((one) => typeof one.text === 'string'
    && typeof one.score === 'number'
    && Array.isArray(one.bbox) && one.bbox.length === 4),
], [3, true])
check('候选里没有刚按过的那一格', pressed.blocked?.candidates.map((one) => one.text).includes('设置'), false)

check('中间有一条 changed 就重新算 (不让刹车越界到下一屏)', (() => {
  const log = [
    { effect: 'unchanged', displayId: 0, fingerprint: 'f', session: 'explore-1' },
    { effect: 'changed', displayId: 0, fingerprint: '', session: 'explore-1' },
  ]
  return tapApi.tapEffectBrake(log, 'explore-1', screenOf(['设置', '蓝牙']), '设置')
})(), null)
check('别的会话 (或别的屏) 的账不算到这一场上', (() => {
  const screen = screenOf(['设置', '蓝牙'])
  const log = [
    { effect: 'unchanged', displayId: 0, fingerprint: tapApi.tapEffectFingerprint(screen), session: 'someone-else' },
    { effect: 'unchanged', displayId: 0, fingerprint: tapApi.tapEffectFingerprint(screen), session: 'someone-else' },
  ]
  return tapApi.tapEffectBrake(log, 'explore-1', screen, '设置')
})(), null)
check('屏真的变了就放行 (指纹对不上就不拦)', (() => {
  const before = screenOf(['设置', '蓝牙'])
  const now = screenOf(['设置', '蓝牙', '位置信息'])
  const log = [
    { effect: 'unchanged', displayId: 0, fingerprint: tapApi.tapEffectFingerprint(before), session: 'explore-1' },
    { effect: 'unchanged', displayId: 0, fingerprint: tapApi.tapEffectFingerprint(before), session: 'explore-1' },
  ]
  return tapApi.tapEffectBrake(log, 'explore-1', now, '设置')
})(), null)

check('两棵树一样时判 unchanged, 差一行时判 changed 并只列那一行', [
  tapApi.tapEffectOf(screenOf(['设置', '蓝牙']), screenOf(['设置', '蓝牙']), '设置'),
  tapApi.tapEffectOf(screenOf(['设置', '蓝牙']), screenOf(['设置', '蓝牙', '已连接']), '设置'),
  tapApi.formatTapEffect('changed', screenOf(['设置']), screenOf(['设置', '已连接'])).split('\n'),
], [
  'unchanged',
  'changed',
  ['effect=changed: the screen answered the press', '  + "已连接"'],
])
check('有一份读不到时判 unknown (不把"核不了"说成"没变")', [
  tapApi.tapEffectOf(null, screenOf(['设置']), '设置'),
  tapApi.tapEffectOf(screenOf(['设置']), null, '设置'),
  /effect=unknown/u.test(tapApi.formatTapEffect('unknown', null, null, [])),
], ['unknown', 'unknown', true])

/* ── 九、按下去之前先证明按的是对的那个 (2.8.1 落实表 #37) ───────────────── */

/**
 * 三道前置校验与三档恢复都是纯函数 (恢复只多读一次树), 所以在这一侧也能量, 不必起设备
 *
 * 端到端那一份 (触摸次数 = 0 / 1) 在 `check-phone-actions` 第八节
 */
const SETTINGS_TREE = [
  { text: '设置', bounds: [40, 300, 900, 380] },
  { text: '蓝牙', bounds: [40, 400, 900, 480] },
]
const uiTree = (rows) => ({
  enabled: true,
  displayId: 0,
  label: 'Settings',
  width: 1080,
  height: 2400,
  nodes: rows.map((row, depth) => ({ text: row.text, bounds: row.bounds, clickable: true, depth })),
})

tapUiAnswer = uiTree(SETTINGS_TREE)
const tapScreen = await tapApi.tapEffectSnapshot(0)

check('前置校验: 名字对得上的子节点被外面那格包住时只算一处', (() => {
  const nested = {
    ...tapScreen,
    nodes: [
      { label: '设置', bounds: [40, 300, 900, 380] },
      { label: '设置', bounds: [60, 310, 300, 370] },
    ],
  }
  return tapApi.tapNameMatches(nested, '设置').length
})(), 1)

check('前置校验: 短边 < TAP_MIN_SIDE → small, 整格出屏 → occluded, 正常格放行', [
  tapApi.tapPrecheckGeometry(tapScreen, [40, 300, 900, 338])?.skip,
  tapApi.tapPrecheckGeometry(tapScreen, [40, 3000, 900, 3080])?.skip,
  tapApi.tapPrecheckGeometry(tapScreen, [40, 300, 900, 380]),
  tapApi.TAP_MIN_SIDE,
], ['small', 'occluded', null, 48])

check('前置校验: 要按的那一点被另一个能按的控件盖住 → occluded, 并说清是谁', (() => {
  const covered = {
    ...tapScreen,
    nodes: [
      { label: '设置', bounds: [40, 300, 900, 380], target: [40, 300, 900, 380], clickable: true },
      { label: '广告弹窗', bounds: [200, 320, 600, 360], target: [200, 320, 600, 360], clickable: true },
    ],
  }
  const skip = tapApi.tapPrecheck(covered, covered.nodes[0])
  return [skip?.skip, /广告弹窗/u.test(skip?.why ?? '')]
})(), ['occluded', true])
check('前置校验: 同一格里换了个名字 (子节点按下去仍落在那一行) 不算盖住', (() => {
  const same = {
    ...tapScreen,
    nodes: [
      { label: '设置', bounds: [40, 300, 900, 380], target: [40, 300, 900, 380], clickable: true },
      { label: '存储', bounds: [200, 320, 600, 360], target: [40, 300, 900, 380], clickable: true },
    ],
  }
  return tapApi.tapPrecheck(same, same.nodes[0])
})(), null)

check('前置校验: expect 对不上时报出点上实测的那个标签, 对得上时放行', [
  tapApi.tapAnchorMismatch(tapScreen, '蓝牙', 500, 340)?.found,
  tapApi.tapAnchorMismatch(tapScreen, '设置', 500, 340),
], ['设置', null])

/** 恢复那一档会读一次树: 把它的 stdout 收起来, 免得三行读数混进判据表里 */
const quiet = async (run) => {
  const keep = console.log
  try {
    console.log = () => {}
    return await run()
  } finally {
    console.log = keep
  }
}
const recoverOn = async (answer, effect, { wanted = '设置', after = tapScreen } = {}) => {
  tapUiAnswer = answer
  return quiet(() => tapApi.tapEffectRecover({
    before: tapScreen, after, effect, wanted, displayId: 0,
  }))
}

const late = await recoverOn(uiTree([...SETTINGS_TREE, { text: '已连接', bounds: [40, 700, 900, 780] }]), 'unchanged')
check('恢复 ①: 重读那一屏变了 → reread (没有重放那一下)', late.recover, 'reread')

const anchor = await recoverOn(uiTree(SETTINGS_TREE), 'unchanged')
check('恢复 ②: 屏没变而目标还在 → reanchor, 交回它现在的中心', [
  anchor.recover,
  /centre 470,340/u.test(anchor.text),
], ['reanchor', true])

const blind = await recoverOn(null, 'unknown', { after: null })
check('恢复 ②b: 重读读不回来 → reanchor 用按之前那一份, 并说清这次没读到', [
  blind.recover,
  /could not be read back/u.test(blind.text),
], ['reanchor', true])

const nowhere = await recoverOn(uiTree(SETTINGS_TREE), 'unchanged', { wanted: '' })
check('恢复 ③: 屏上哪儿都不是目标 (按在空白处) → giveup', nowhere.recover, 'giveup')

check('lw_tap 的账里带 recover 那一格, 而且三档各有一行 stdout 读数', [
  /const recovery = await tapEffectRecover\(/u.test(host),
  /recover: recovery\.recover,/u.test(host),
  /LwTap: recover=reread/u.test(host) && /LwTap: recover=reanchor/u.test(host)
    && /LwTap: recover=giveup/u.test(host),
], [true, true, true])

check('exploreEffectReason: 连着两条 recover=giveup 才停 (2.8.1 落实表 #37)', [
  api.exploreEffectReason([{ recover: 'giveup' }, { recover: 'giveup' }]),
  api.exploreEffectReason([{ recover: 'giveup' }, { recover: 'reanchor' }]),
  api.exploreEffectReason([{ recover: 'reread' }, { recover: 'giveup' }]),
  api.exploreEffectReason([]),
], ['giveup', '', '', ''])
check('exploreEffectReason: 连着两条 unchanged 不再算停 (effect 判定不回归, 停判只认 giveup)', [
  api.exploreEffectReason([{ effect: 'unchanged', recover: 'reanchor' },
    { effect: 'unchanged', recover: 'reanchor' }]),
  api.exploreEffectReason([{ effect: 'unchanged' }, { effect: 'unchanged' }]),
], ['', ''])
check('exploreEffectsFor 只挑这一场, 别的会话点的不算', [
  api.exploreEffectsFor([
    { session: 'a', effect: 'unchanged' },
    { session: 'b', effect: 'unchanged' },
    { session: 'a', effect: 'changed' },
  ], 'a'),
  api.exploreEffectsFor([{ session: 'a' }], ''),
], [[{ session: 'a', effect: 'unchanged' }, { session: 'a', effect: 'changed' }], []])
check('status 的 `effects` 只留最近 20 条', [
  api.EXPLORE_EFFECTS_KEPT,
  api.exploreEffectsFor(Array.from({ length: 25 }, (_, index) => ({ session: 'a', step: index })), 'a').length,
], [20, 20])

check('lw_explore op=status 里带 effects 与 reason (读数与文本两处都在)', [
  /effects,\n {4}effectReason: exploreEffectReason\(effects\)/u.test(host),
  /press effects: \$\{readings\.effects\.length\} recorded this run/u.test(host),
  /reason=\$\{readings\.effectReason\}/u.test(host),
], [true, true, true])

/* ── 收尾 ─────────────────────────────────────────────────────────────── */

console.log(`\n${checks - failures} / ${checks} 条通过`)
if (failures > 0) process.exit(1)
