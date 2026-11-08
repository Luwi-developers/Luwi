/**
 * 「更多设置」那一页的判据表 (2026-11-07 晚)
 *
 * 这一页的每一行都**只是数字**: 写歪一个也不会报错, 只会让"她多久敲一次钟 / 一次说几条 /
 * 什么时候该闭嘴"悄悄换了一套。所以四件事分开钉:
 *
 *   1. **缺省值与 QQ 桥接的二代仿真同一套** (`config.json → socialV2`, 值写死在这里比对) ——
 *      主人那一句是"功能与 qq 桥接里的二代仿真一致", 数不一样就等于没对上
 *   2. **读盘逐键兜底**: 缺键取缺省、越界夹进范围、类型不对取缺省 —— 一份写坏的 `sim.json`
 *      不该让敲钟停下来
 *   3. **写盘是原子的, 而且只写自己那一份** (`sim.json` 单写者; `router.json` 读-改-写)
 *   4. **检测项的所有权在探索**: 宿主 `finishExplore` 收 `checks` → `router.json`, 应用只开关与忘掉;
 *      判断层那一侧 (分数、今天提过、关掉不判) 由 `check-router.mjs` 跑
 *
 * 跑法: node tools/check-sim.mjs   (不需要设备, 也不需要 host)
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const sim = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/SimSetting.kt')
const checks = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/RouterChecks.kt')
const tick = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/RouterTick.kt')
const outbox = await read('app/src/main/java/io/github/yuloong07star/luwi/overlay/BallOutbox.kt')
const overlay = await read('app/src/main/java/io/github/yuloong07star/luwi/overlay/OverlayService.kt')
const screen = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt')
const page = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/SimSettingsScreen.kt')
const nav = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/AppNav.kt')
const host = await read('host-plugin/index.mjs')
const persona = await read('presets/explore/cordis.patch.yml')
const zh = await read('app/src/main/res/values-zh/strings.xml')
const en = await read('app/src/main/res/values/strings.xml')

let failures = 0
let count = 0
function check(name, got, want) {
  count += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  if (!same) failures += 1
  console.log(
    `${same ? 'ok  ' : 'FAIL'} ${name}`
      + (same ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`),
  )
}

/** Kotlin 里 `const val NAME = 1_500_000L` 那个数 (去掉下划线与后缀) */
function kotlinConst(source, name) {
  const match = new RegExp(`const val ${name} = (-?[\\d_.]+)`).exec(source)
  if (match === null) throw new Error(`在源码里找不到 ${name}`)
  return Number(match[1].replaceAll('_', ''))
}

/* ── 一、缺省值与 QQ 桥接的 socialV2 对齐 ───────────────────────────────── */

// 期望值一律手写在这里 (不读 D:\\Mobile-AI, 换机器也要能跑): 右边注释是 qq-bridge config.json 的原键
const expected = {
  WAKE_GAP_MIN_MS: 1_500_000, // RouterTick 原来那 25 分钟
  WAKE_GAP_MAX_MS: 3_300_000, // 55 分钟
  PRE_SLEEP_WAIT_MS: 300_000, // wake.preSleepWaitMs
  MAX_WAKE_PER_MINUTE: 1, // wake.maxWakePerMinute
  MAX_WAKE_PER_HOUR: 5, // wake.maxWakePerHour
  NO_ACTION_LIMIT: 3, // wake.noActionLimit
  SEND_BURST_MAX: 6, // send.burstMaxMessages
  SEND_GAP_MIN_MS: 1_000, // send.burstIntervalMinMs
  SEND_GAP_MAX_MS: 3_000, // send.burstIntervalMaxMs
  SEND_PER_CHAR_MS: 20, // send.gapPerCharMs
  LONG_GAP_PROBABILITY: 0.2, // send.longGapProbability
  LONG_GAP_MIN_MS: 5_000, // send.longGapMinMs
  LONG_GAP_MAX_MS: 10_000, // send.longGapMaxMs
  MAX_MESSAGE_CHARS: 600, // send.maxMessageChars
  MAX_SEND_PER_MINUTE: 7, // send.maxPerMinute
  MAX_SEND_PER_HOUR: 60, // send.maxPerHour
  WAIT_DEFAULT_MS: 30_000, // wait.defaultMs
  WAIT_QUIET_MS: 8_000, // wait.defaultQuietMs
  MIN_QUIET_AFTER_NEW_MS: 10_000, // wait.minQuietAfterNewMs
  GAME_MINUTES: 100, // ROUTER_DEFAULTS.gameMinutes
  WISH_DAYS: 60, // ROUTER_DEFAULTS.wishDays
  COOLDOWN_MS: 1_800_000, // ROUTER_DEFAULTS.cooldownMs
  CHAT_CHANCE: 0.35, // ROUTER_DEFAULTS.chatChance
  CHAT_AFTER_MS: 14_400_000, // ROUTER_DEFAULTS.chatAfterMs
  IGNORED_COOLDOWN_MS: 86_400_000, // ROUTER_DEFAULTS.ignoredCooldownMs
  WAKE_MESSAGE_LIMIT: 12, // context.wakeMessageLimit
  WAKE_MAX_CHARS: 6_000, // context.wakeMaxChars
}

check('缺省值逐个与 QQ 桥接 socialV2 对齐', Object.fromEntries(
  Object.keys(expected).map((name) => [name, kotlinConst(sim, name)]),
), expected)

check('潜水/活跃两个档名就是 diving 与 active, 缺省是潜水', [
  sim.includes('const val MODE_DIVING = "diving"'),
  sim.includes('const val MODE_ACTIVE = "active"'),
  sim.includes('const val WAKE_MODE = MODE_DIVING'),
], [true, true, true])

check('宿主的 ROUTER_DEFAULTS 与这一页同一套数', [
  /gameMinutes: 100,/.test(host),
  /wishDays: 60,/.test(host),
  /cooldownMs: 30 \* 60 \* 1000,/.test(host),
  /chatChance: 0\.35,/.test(host),
  /chatAfterMs: 4 \* 60 \* 60 \* 1000,/.test(host),
  /ignoredCooldownMs: 24 \* 60 \* 60 \* 1000,/.test(host),
  /preSleepWaitMs: 5 \* 60 \* 1000,/.test(host),
], [true, true, true, true, true, true, true])

/* ── 二、读盘逐键兜底 ───────────────────────────────────────────────────── */

check('读法逐键兜底: 缺键 / 越界 / 坏类型都落到缺省或范围里', [
  /fun planFrom\(root: JsonObject\?\): Plan/.test(sim),
  /private fun JsonObject\?\.bool\(key: String, fallback: Boolean\)/.test(sim),
  /private fun JsonObject\?\.int\(key: String, fallback: Int, range: IntRange\)/.test(sim),
  /\.coerceIn\(range\.first, range\.last\)/.test(sim),
  /private fun JsonObject\?\.long\(key: String, fallback: Long, range: LongRange\)/.test(sim),
  /private fun JsonObject\?\.float\(/.test(sim),
], [true, true, true, true, true, true])

check('两个 gap 反过来写也能用 (小的一律当最短)', [
  /gapMinMs = minOf\(gapMin, gapMax\)/.test(sim),
  /gapMaxMs = maxOf\(gapMin, gapMax\)/.test(sim),
], [true, true])

/* ── 三、写盘 ───────────────────────────────────────────────────────────── */

check('sim.json 是原子写 (temporary + rename, 失败退直接写)', [
  /val temporary = File\(target\.parentFile, "\$\{target\.name\}\.tmp"\)/.test(sim),
  /temporary\.renameTo\(target\)/.test(sim),
], [true, true])

check('router.json 那一侧是读-改-写, 只替换 checks 这一项', [
  /root\.forEach \{ \(key, value\) -> if \(key != "checks"\) put\(key, value\) \}/.test(checks),
  /val temporary = File\(target\.parentFile, "\$\{target\.name\}\.tmp"\)/.test(checks),
  /fun setEnabled\(context: Context, id: String, on: Boolean\): Boolean/.test(checks),
  /fun drop\(context: Context, id: String\): Boolean/.test(checks),
], [true, true, true, true])

/* ── 四、接线: 时机与节奏 ───────────────────────────────────────────────── */

check('敲钟的间隔读 sim.json (不传就用原来那 25~55 分钟)', [
  /fun gapFor\(roll: Float, minMs: Long = MIN_GAP_MS, maxMs: Long = MAX_GAP_MS\): Long/.test(tick),
  /plan\?\.gapMinMs \?: MIN_GAP_MS/.test(tick),
  /plan\?\.gapMaxMs \?: MAX_GAP_MS/.test(tick),
], [true, true, true])

check('活跃那一档也算开 (mode = active)', /SimSetting\.plan\(context\)\.wake\.active/.test(tick), true)

check('分条的停顿与条数读 sim.json', [
  /fun limitOf\(send: SimSetting\.Send\): Int/.test(outbox),
  /fun gapFor\(\s*text: String,\s*send: SimSetting\.Send = SimSetting\.Send\(\),\s*roll: Float = 0f,\s*\): Long/.test(outbox),
  /longGapProbability/.test(outbox),
  /BallOutbox\.limitOf\(simSend\(\)\)/.test(overlay),
  /BallOutbox\.gapFor\(line, simSend\(\), kotlin\.random\.Random\.nextFloat\(\)\)/.test(overlay),
], [true, true, true, true, true])

/* ── 五、检测项的所有权在探索 ───────────────────────────────────────────── */

check('宿主收 checks 并写进 router.json (finishExplore 那一条路)', [
  /const askedChecks = Array\.isArray\(args\?\.checks\) \? args\.checks : \[\]/.test(host),
  /async function exploreChecksWrite\(list\)/.test(host),
  /const ROUTER_CHECKS_MAX = 12/.test(host),
  /await writeRouterJson\(path, \{ \.\.\.state, v: 1, checks: kept \}\)/.test(host),
  (host.match(/exploreChecksWrite\(askedChecks\)/gu) ?? []).length >= 2,
], [true, true, true, true, true])

check('主人关掉的那一条不会被下一次探索重新打开', /enabled: merged\[at\]\?\.enabled !== false/.test(host), true)

check('判断层读了 checks 与那份"今天提过"的账', [
  /checks: Array\.isArray\(state\?\.checks\) \? state\.checks : \[\]/.test(host),
  /checksSaid: state\?\.checksSaid && typeof state\.checksSaid === 'object'/.test(host),
  /const fact = routerCheckHit\(one, input, now\)/.test(host),
  /kind: 'check',/.test(host),
  /score: 3,/.test(host),
], [true, true, true, true, true])

check('三个分数顺序: 游戏 5 > 未了的事 4 > 探索的检测项 3 > 随口一句 2', [
  /score: 5,/.test(host),
  /score: 4,/.test(host),
  /score: 3,/.test(host),
  /score: 2,/.test(host),
], [true, true, true, true])

check('探索的 persona 交第三样 (checks), 并写明没看出新的就不交', [
  persona.includes('收尾时写三样'),
  persona.includes('checks:'),
  persona.includes('这一趟没看出新的就不交'),
  persona.includes('{"kind":"usage"'),
  persona.includes('{"kind":"time"}'),
], [true, true, true, true, true])

check('工具面的参数表也有 checks', [
  /checks: \{/.test(host),
  /finish only: at most 3 things the judgement layer should watch/.test(host),
  /checks: args\?\.checks,/.test(host),
], [true, true, true])

/* ── 六、页面与入口 ─────────────────────────────────────────────────────── */

check('活动段末尾有一行「更多设置」, 点它弹窗 (不是一个二级页)', [
  /R\.string\.settings_activity_more/.test(screen),
  /SimSettingsDialog\(onDismiss = \{ simOpen = false \}\)/.test(screen),
  /var simOpen by remember \{ mutableStateOf\(false\) \}/.test(screen),
  // 说明是静态那句: 读文件的句子在"从那一层回来"时会停在旧值 (2026-11-07 真机上量到过)
  /summary = stringResource\(R\.string\.settings_activity_more_summary\)/.test(screen),
  // 二级页那条路由已经撤了
  !/data object SimSettings : Screen/.test(nav),
  !/entry<Screen\.SimSettings>/.test(nav),
  !/push\(Screen\.SimSettings\)/.test(screen),
], [true, true, true, true, true, true, true])

check('路由里没有它 (弹窗不吃路由那一层)', [
  !/data object SimSettings : Screen/.test(nav),
  !/entry<Screen\.SimSettings>/.test(nav),
], [true, true])

check('五组都在, 检测项只读 + 开关 + 忘掉', [
  page.includes('settings_sim_wake_group'),
  page.includes('settings_sim_send_group'),
  page.includes('settings_sim_wait_group'),
  page.includes('settings_sim_router_group'),
  page.includes('settings_sim_context_group'),
  /RouterChecks\.setEnabled\(context, one\.id, on\)/.test(page),
  /RouterChecks\.drop\(context, one\.id\)/.test(page),
], [true, true, true, true, true, true, true])

check('那条弹窗的形状与插件能力那张一样 (OverlayDialog + 可滚动的一坨 + 底部按钮)', [
  /fun SimSettingsDialog\(onDismiss: \(\) -> Unit\)/.test(page),
  /OverlayDialog\(/.test(page),
  /show = true,/.test(page),
  /height\(\(screenHeight \* 0\.58f\)\.dp\)/.test(page),
  /R\.string\.settings_sim_close/.test(page),
  /verticalScroll|LazyColumn\(/.test(page),
], [true, true, true, true, true, true])

check('那一页没有"手写一条检测项"的入口 (检测项只由探索加)', [
  !/RouterChecks\.add\(/.test(page),
  !/settings_sim_checks_add/.test(page),
], [true, true])

/* ── 七、两份 strings.xml ───────────────────────────────────────────────── */

const keys = [
  'settings_activity_more',
  'settings_activity_more_summary',
  'settings_sim_title',
  'settings_sim_note',
  'settings_sim_checks_note',
  'settings_sim_checks_empty',
  'settings_sim_checks_how',
  'settings_sim_checks_drop',
  'settings_sim_unit_minutes',
]

check('九个关键文案两份都在, 而且顺序一致', [
  keys.every((key) => zh.includes(`name="${key}"`) && en.includes(`name="${key}"`)),
  keys.every((key, index) => index === 0
    || (zh.indexOf(`name="${key}"`) > zh.indexOf(`name="${keys[index - 1]}"`)
      && en.indexOf(`name="${key}"`) > en.indexOf(`name="${keys[index - 1]}"`))),
], [true, true])

// 只查这一批新增的那些键: 整份文件里既有的文案不在这一页的责任范围内
const simLines = (text) => text
  .split('\n')
  .filter((line) => line.includes('name="settings_sim_') || line.includes('name="settings_activity_more'))
  .join('\n')

/** 先把 `%%` 整体摘掉, 再看还剩几个"后面既不是 1$s/1$d 也不是数字"的 % */
const barePercent = (text) => (text.replaceAll('%%', '').match(/%(?![1-9]\$[sd]|\d)/gu) ?? []).length

check('新增的那些文案里没有裸 % (Android 会抛 UnknownFormatConversionException)', [
  barePercent(simLines(zh)),
  barePercent(simLines(en)),
], [0, 0])

check('设置页段数没变 (活动段还是那一段, 新的是一页而不是一段)', (await read(
  'app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt',
)).includes('key = "activity"'), true)

console.log(`\n${count - failures} / ${count} checks passed`)
if (failures > 0) process.exit(1)
