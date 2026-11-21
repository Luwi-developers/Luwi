/**
 * 情感化审计脚本的判据 (2026-11-21)
 *
 * 方案 `docs/Luwi-活动板块情感化-主动对话方案-2026-11-20.md` §12.1 / §12.2 那张表要能自动算,
 * 所以这里在 `.lwtmp/audit-fixture-<pid>` 造两份夹具 (`--home` 指过去), 用 `spawnSync` 真跑
 * `tools/lw-emotion-audit.mjs --json`, 六个读数一个一个对到数:
 *
 *   一  六句她说的话: 一句含 `抱抱你` / 两句逐字相同 / 两句紧挨着没有他的话 (追发 2 次) /
 *       一句含 `你之前说过`, 而 episodes 有一条 `想换一把键盘` (引用率 1.0)
 *   二  边界: `别劝我早睡` hard 命中 1, 另一条 soft 命中了但不算
 *   三  策略: 5 个 companion + 1 个 space (最高 0.83, 判 over)
 *   四  曲线: 0.2 / 0.3 / 0.6 -> delta 0.4, 判"上升偏快"
 *   五  空夹具与"目录整个不存在": 六个读数 0 / null, 退出码 0, 一句不抛
 *   六  `--template` 的八维逐字与 8 条打分行
 *   七  引用率的分母与 0.3 那道线 (一份只有两句候选的小夹具)
 *   八  审计真的复用 `host-plugin/emotion/state.mjs` 的分词, 没有另写一份
 *
 * 跑法: `node tools/check-emotion-audit.mjs` (不碰设备, 不碰 host, 跑完把夹具删干净)
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const auditPath = join(root, 'tools', 'lw-emotion-audit.mjs')
const fixtureHome = join(root, '.lwtmp', `audit-fixture-${process.pid}`)
const emptyHome = join(root, '.lwtmp', `audit-empty-${process.pid}`)
const goneHome = join(root, '.lwtmp', `audit-gone-${process.pid}`)
const citeHome = join(root, '.lwtmp', `audit-cite-${process.pid}`)
const noEpisodesHome = join(root, '.lwtmp', `audit-noep-${process.pid}`)
const curveHome = join(root, '.lwtmp', `audit-curve-${process.pid}`)

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

/* ── 夹具的小工具 ───────────────────────────────────────────────────────── */

const pad2 = (value) => String(value).padStart(2, '0')
const today = new Date()

/** 本地某一天的某一刻 (按年月日偏移算, 跨月与夏令时都不怕) */
function at(offsetDays, hour, minute) {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays, hour, minute, 0, 0).getTime()
}

const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`

function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

/** 行可以是对象, 也可以是故意写坏的字符串 (审计要跳过它们) */
function writeJsonl(path, rows) {
  writeText(path, rows.map((one) => (typeof one === 'string' ? one : JSON.stringify(one))).join('\n') + '\n')
}

function writeJson(path, one) {
  writeText(path, JSON.stringify(one, null, 2))
}

function run(args) {
  const result = spawnSync(process.execPath, [auditPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
  })
  return {
    code: result.status,
    out: String(result.stdout ?? ''),
    err: String(result.stderr ?? ''),
  }
}

function runJson(args) {
  const one = run([...args, '--json'])
  let json = null
  try {
    json = JSON.parse(one.out)
  } catch {
    json = null
  }
  return { ...one, json }
}

/* ── 夹具一: 六个读数各有一个真数 ───────────────────────────────────────── */

function buildFixture() {
  rmSync(fixtureHome, { recursive: true, force: true })

  // 她说的话: 十二行里只有八行算数 (1 行窗口外 / 1 行空正文 / 1 行不是 text / 1 行坏行 / 1 行坏 at)
  // 轮次 (一次 lw_say 拆几条气泡算一轮): 08:00 一轮 / 09:00-09:02 一轮 (3 条) / 10:30 / 11:01 / -4 20:00 / -9 09:00
  writeJsonl(join(fixtureHome, 'lw', 'out', 's1.jsonl'), [
    { seq: 1, at: at(-9, 9, 0), kind: 'text', text: '摸摸头, 早点睡吧' },
    { seq: 2, at: at(0, 8, 0), kind: 'text', text: '今天降温了, 你要不要换件外套呀' },
    { seq: 3, at: at(0, 9, 0), kind: 'text', text: '抱抱你' },
    { seq: 4, at: at(0, 9, 1), kind: 'text', text: '我把那条鱼画好了' },
    { seq: 5, at: at(0, 9, 2), kind: 'text', text: '我把那条鱼画好了' },
    { seq: 6, at: at(0, 10, 30), kind: 'text', text: '你之前说过「换键盘」, 那把键盘还想要吗' },
    { seq: 7, at: at(0, 11, 1), kind: 'text', text: '别劝我早睡, 我记得的' },
    { seq: 8, at: at(-4, 20, 0), kind: 'text', text: '别提加班了, 我知道' },
    { seq: 9, at: at(0, 11, 6), kind: 'text', text: '   ' },
    { seq: 10, at: at(0, 11, 7), kind: 'bubble', text: '抱抱你' },
    '{这一行是坏的',
    { seq: 11, at: 'x', kind: 'text', text: '抱抱你' },
  ])

  // 他发的: 08:30 那句在 08:10 那一场之后, 与 09:10 那一场无关; source 只有 voice / keyboard / ball
  // 三种算"他说的"; 09:05 那条 router 是应用自己写的触发记号, 数进来会把 09:10 那一场判成"没追"
  writeJsonl(join(fixtureHome, 'voice', 'inbox.jsonl'), [
    { at: at(0, 8, 30), text: '嗯 穿了', source: 'voice' },
    { at: at(0, 9, 5), text: 'TICK', source: 'router' },
    { at: at(0, 11, 30), text: '嗯', source: 'ball' },
  ])

  writeJsonl(join(fixtureHome, 'lw', 'memory', 'episodes.jsonl'), [
    { id: 'e1', at: at(-2, 12, 0), what: '想换一把键盘', valence: 1, refs: [], open: true },
    { id: 'e2', at: at(-1, 12, 0), what: '今天降温了', valence: 0, refs: [], open: false },
    '{坏行',
  ])

  writeJson(join(fixtureHome, 'lw', 'memory', 'boundaries.json'), {
    v: 1,
    at: at(-3, 12, 0),
    items: [
      { id: 'b1', what: '别劝我早睡', hard: true, learnedAt: at(-3, 12, 0) },
      { id: 'b2', what: '别提加班', hard: false, learnedAt: at(-3, 13, 0) },
    ],
  })

  // 每一行都是"真开成的一场主动对话": 08:10 与 09:10 两场落在她上一轮 30 分钟之内 (两场都算追发),
  // 其余几场离她上一轮很远 (不算). -20 天那一场在窗口外
  writeJsonl(join(fixtureHome, 'lw', 'memory', 'plans.jsonl'), [
    { at: at(-5, 21, 0), via: 'clock', lead: 'companion', avoid: 'advise', budget: 2, why: 'default', ref: 'p1' },
    { at: at(-4, 21, 0), via: 'clock', lead: 'companion', avoid: 'advise', budget: 2, why: 'default', ref: 'p2' },
    { at: at(-3, 21, 0), via: 'router', lead: 'companion', avoid: 'advise', budget: 2, why: 'default', ref: 'p3' },
    { at: at(-2, 21, 0), via: 'clock', lead: 'companion', avoid: 'advise', budget: 2, why: 'default', ref: 'p4' },
    { at: at(0, 8, 10), via: 'clock', lead: 'companion', avoid: 'advise', budget: 2, why: 'default', ref: 'p5' },
    { at: at(0, 9, 10), via: 'wake', lead: 'space', avoid: 'advise', budget: 1, why: 'two in a row unanswered', ref: 'p6' },
    { at: at(-20, 21, 0), via: 'clock', lead: 'validate', avoid: 'distract', budget: 2, why: 'down today', ref: 'p7' },
  ])

  writeJsonl(join(fixtureHome, 'lw', 'memory', 'relation.jsonl'), [
    { at: at(-2, 12, 0), days: 8, closeness: 0.2 },
    { at: at(-1, 12, 0), days: 9, closeness: 0.3 },
    { at: at(0, 12, 0), days: 10, closeness: 0.6 },
  ])

  writeJson(join(fixtureHome, 'lw', 'memory', 'relation.json'), {
    v: 1,
    at: at(0, 12, 0),
    firstSeenAt: at(-10, 12, 0),
    days: 10,
    closeness: 0.6,
    ignored: 0,
  })
}

/* ── 夹具五: 有一句引用候选但没有任何情节 (引用率该是 null 不是 0) ───────── */

function buildNoEpisodes() {
  rmSync(noEpisodesHome, { recursive: true, force: true })
  writeJsonl(join(noEpisodesHome, 'lw', 'out', 's.jsonl'), [
    { seq: 1, at: at(0, 9, 0), kind: 'text', text: '你之前说过「换键盘」, 那把键盘还想要吗' },
  ])
  writeJsonl(join(noEpisodesHome, 'lw', 'memory', 'plans.jsonl'), [
    { at: at(0, 9, 30), via: 'clock', lead: 'companion', avoid: 'advise', budget: 2, why: 'default', ref: 'p1' },
  ])
}

/* ── 夹具六 / 七: 曲线在退 / 曲线只有一个点 ─────────────────────────────── */

function buildCurve(rows) {
  rmSync(curveHome, { recursive: true, force: true })
  writeJsonl(join(curveHome, 'lw', 'memory', 'relation.jsonl'), rows)
}

/* ── 夹具二: 目录都在, 一份账都没有 ─────────────────────────────────────── */

function buildEmpty() {
  rmSync(emptyHome, { recursive: true, force: true })
  mkdirSync(join(emptyHome, 'lw', 'out'), { recursive: true })
  mkdirSync(join(emptyHome, 'lw', 'memory'), { recursive: true })
  mkdirSync(join(emptyHome, 'voice'), { recursive: true })
}

/* ── 夹具三: 只有两句引用候选, 一句过 0.3 那道线, 一句不过 ───────────────── */

function buildCite() {
  rmSync(citeHome, { recursive: true, force: true })
  writeJsonl(join(citeHome, 'lw', 'out', 's.jsonl'), [
    // 与 `想换一把键盘` 对上 2 个二元组 -> 2/5 = 0.4, 过线
    { seq: 1, at: at(0, 9, 0), kind: 'text', text: '你之前说过「换键盘」, 那把键盘还想要吗' },
    // 只对上 `键盘` 一个 -> 1/5 = 0.2, 不过线
    { seq: 2, at: at(0, 9, 30), kind: 'text', text: '你之前说过「换键盘」, 我记着呢' },
  ])
  writeJsonl(join(citeHome, 'lw', 'memory', 'episodes.jsonl'), [
    { id: 'e1', at: at(-2, 12, 0), what: '想换一把键盘', valence: 1, refs: [], open: true },
  ])
}

/* ── 跑 ─────────────────────────────────────────────────────────────────── */

try {
  buildFixture()
  buildEmpty()
  buildCite()
  buildNoEpisodes()
  rmSync(goneHome, { recursive: true, force: true })

  /* 一、主夹具 (缺省窗口 7 天) */
  const main = runJson(['--home', fixtureHome])
  check('主夹具: 退出码 0', main.code, 0)
  check('主夹具: --json 打的是一个对象 (能 parse)', main.json !== null && typeof main.json === 'object', true)
  check('主夹具: 键就是方案 §12.1 那六个 + 窗口 / 读到的几样 / 曲线 / 备注', Object.keys(main.json ?? {}).sort(), [
    'boundaryHits', 'chaseRate', 'citationRate', 'drift', 'found', 'notes', 'planMix', 'relationCurve',
    'repeatOpeners', 'window',
  ])
  check('主夹具: 六样都读得到', main.json?.found, {
    her: true, inbox: true, episodes: true, plans: true, boundaries: true, relation: true,
  })
  check('chaseRate: 只认主动开口那一侧 (09:05 那条 router 不算他说话)', [
    main.json?.chaseRate?.count,
    Object.keys(main.json?.chaseRate?.perDay ?? {}).length,
  ], [2, 1])
  check('主夹具: 缺省窗口 7 天', main.json?.window?.since, 7)
  check('主夹具: 窗口起点是 7 天前 (毫秒数)', typeof main.json?.window?.fromMs === 'number', true)

  check('drift: 只算窗口内 kind=text 的话 (9 天前那句不算), 坏行与非 text 行跳过', main.json?.drift, 1)
  check('repeatOpeners: 逐字相同的两句算 1 句重复', main.json?.repeatOpeners, 1)
  check('chaseRate: 两次追发', main.json?.chaseRate?.count, 2)
  check('chaseRate: 单日最多 2 次', main.json?.chaseRate?.maxPerDay, 2)
  check('chaseRate: 按天只剩一格', Object.values(main.json?.chaseRate?.perDay ?? {}), [2])
  check('citationRate: 候选一句, 对上了 -> 1.0', main.json?.citationRate?.ratio, 1)
  check('citationRate: 分母是候选句数', main.json?.citationRate?.candidates, 1)
  check('citationRate: 分子是对得上的句数', main.json?.citationRate?.matched, 1)
  check('planMix: companion 5 场', main.json?.planMix?.counts?.companion, 5)
  check('planMix: space 1 场', main.json?.planMix?.counts?.space, 1)
  check('planMix: 窗口内 6 场 (20 天前那场不算)', main.json?.planMix?.total, 6)
  check('planMix: 最高那一格是 companion', [
    main.json?.planMix?.top?.lead,
    main.json?.planMix?.top?.count,
    main.json?.planMix?.top?.share,
  ], ['companion', 5, 0.83])
  check('planMix: 0.83 > 0.7, 判 over', main.json?.planMix?.over, true)
  check('boundaryHits: hard 那条命中 1, soft 那条不算', main.json?.boundaryHits, 1)
  check('relationCurve: 一天一行, 三行', (main.json?.relationCurve?.points ?? []).map((one) => one.closeness), [0.2, 0.3, 0.6])
  check('relationCurve: day 是本地日期', (main.json?.relationCurve?.points ?? []).every((one) => /^\d{4}-\d{2}-\d{2}$/u.test(one.day)), true)
  check('relationCurve: delta 末减首 = 0.4', main.json?.relationCurve?.delta, 0.4)
  check('relationCurve: 0.4 > 0.3, 判"上升偏快"', main.json?.relationCurve?.verdict, '上升偏快, 要看是不是伪亲密')
  check('relationCurve: 账上此刻借 relation.json', [
    main.json?.relationCurve?.current?.days,
    main.json?.relationCurve?.current?.closeness,
  ], [10, 0.6])
  check('主夹具: 六个读数都读得到, 没有备注', main.json?.notes, [])

  /* 二、窗口是活的: 放宽到 30 天, 9 天前那句与 20 天前那场都进来 */
  const wide = runJson(['--home', fixtureHome, '--since', '30'])
  check('--since 30: 窗口天数跟着走', wide.json?.window?.since, 30)
  check('--since 30: 9 天前那句禁区词进来了 (drift 2)', wide.json?.drift, 2)
  check('--since 30: 策略账 7 场, validate 记 1 场', [
    wide.json?.planMix?.total,
    wide.json?.planMix?.counts?.validate,
  ], [7, 1])
  check('--since 30: 追发没有因为放宽窗口变多', wide.json?.chaseRate?.count, 2)
  const wideTable = run(['--home', fixtureHome, '--since', '30'])
  check('--since 30: 重复开场那条合格线按整周数放宽 (不再拿一周的线量一个月)', /^repeatOpeners\s+1\s+<= 4 次\/30 天\s+ok$/mu.test(wideTable.out), true)

  /* 三、空夹具: 一份账都没有也不许抛 */
  const empty = runJson(['--home', emptyHome])
  check('空夹具: 退出码 0, stderr 干净', [empty.code, empty.err.trim()], [0, ''])
  check('空夹具: 读不到时三格都是 null (不是 0 那种假绿)', [
    empty.json?.drift,
    empty.json?.repeatOpeners,
    empty.json?.boundaryHits,
  ], [null, null, null])
  check('空夹具: 追发无读数 (没有 plans.jsonl 就分不清主动开口)', [
    empty.json?.chaseRate,
    empty.json?.found?.her,
    empty.json?.found?.plans,
  ], [null, false, false])
  check('空夹具: 引用率是 null', empty.json?.citationRate, null)
  check('空夹具: 策略账无读数', empty.json?.planMix, null)
  check('空夹具: 曲线无读数', [
    empty.json?.relationCurve?.points,
    empty.json?.relationCurve?.delta,
    empty.json?.relationCurve?.verdict,
    empty.json?.relationCurve?.note,
  ], [[], null, null, '无读数'])
  check('空夹具: 备注写清没读到哪几样', [
    (empty.json?.notes ?? []).some((one) => one.includes('没有可核对的引用')),
    (empty.json?.notes ?? []).some((one) => one.includes('无读数')),
  ], [true, true])
  check('空夹具: 缺省 --since 仍是 7', empty.json?.window?.since, 7)

  /* 四、目录整个不存在: 一样当空 */
  const gone = runJson(['--home', goneHome])
  check('目录不存在: 退出码 0 且 drift 是 null', [gone.code, gone.json?.drift], [0, null])
  check('目录不存在: 曲线仍是"无读数"', gone.json?.relationCurve?.note, '无读数')

  /* 五、引用率那道 0.3 的线与分母 */
  const cite = runJson(['--home', citeHome])
  check('引用率: 两句候选, 只算过线那一句 (1/2)', [
    cite.json?.citationRate?.ratio,
    cite.json?.citationRate?.candidates,
    cite.json?.citationRate?.matched,
  ], [0.5, 2, 1])

  /* 六、--template: 八维抽检骨架 */
  const template = run(['--home', fixtureHome, '--template'])
  const templateLines = template.out.split('\n')
  check('--template: 退出码 0', template.code, 0)
  check('--template: 标题逐字 (含本地日期)', templateLines[0], `# Luwi 主动场抽检-${todayKey}`)
  const DIMS = ['倾听', '情感调谐', '好奇心与跟进', '校准的确认', '对话连续性', '角色一致性', '情绪范围', '尊重他离开']
  check('--template: 八维逐字各一行', DIMS.map((one) => template.out.includes(`- [ ] ${one}: 1~5 ->`)), [
    true, true, true, true, true, true, true, true,
  ])
  const dimAt = DIMS.map((one) => template.out.indexOf(`- [ ] ${one}:`))
  check('--template: 八维按方案那个次序排 (位置递增)', dimAt.every((value, index) => value >= 0 && (index === 0 || value > dimAt[index - 1])), true)

  /* 六之三、--strict 与 --out (主人 2026-11-21 定: 加 --strict 进闸; 写盘要显式 --out) */
  const strictOver = run(['--home', fixtureHome, '--strict'])
  check('--strict: 有超线的读数就退 3, 且点名是哪几格', [
    strictOver.code,
    /luwi-emotion-audit: \d+ 条读数超线/u.test(strictOver.err),
    strictOver.err.includes('drift'),
    strictOver.err.includes('boundaryHits'),
  ], [3, true, true, true])
  const strictClean = run(['--home', curveHome, '--strict'])
  check('--strict: 没有超线就是 0 (无读数不算超线)', strictClean.code, 0)
  const plain = run(['--home', fixtureHome])
  check('不带 --strict: 超线也退 0 (它是量尺)', plain.code, 0)
  const outFile = join(root, '.lwtmp', `audit-out-${process.pid}.md`)
  rmSync(outFile, { force: true })
  const wrote = run(['--template', '--out', outFile])
  check('--template --out: 写盘并回一句, 文件里有八维', [
    wrote.code,
    readFileSync(outFile, 'utf8').includes('- [ ] 倾听: 1~5 ->'),
    readFileSync(outFile, 'utf8').startsWith('# Luwi 主动场抽检-'),
  ], [0, true, true])
  rmSync(outFile, { force: true })

  /* 七、有候选但没有情节: 引用率是 null (不许亮红成 0) */
  const noEp = runJson(['--home', noEpisodesHome])
  check('没有情节时: 引用率 null + 备注说清, 不判 over', [
    noEp.json?.citationRate,
    (noEp.json?.notes ?? []).some((one) => one.includes('没有可核对的情节原话')),
    /citationRate\s+无读数\s+>= 0\.9\s+n\/a/mu.test(run(['--home', noEpisodesHome]).out),
  ], [null, true, true])

  /* 八、曲线在退 / 只有一个点 */
  buildCurve([
    { at: at(-2, 12, 0), day: at(-2, 0, 0), days: 8, closeness: 0.6 },
    { at: at(-1, 12, 0), day: at(-1, 0, 0), days: 9, closeness: 0.5 },
    { at: at(0, 12, 0), day: at(0, 0, 0), days: 10, closeness: 0.4 },
  ])
  const down = runJson(['--home', curveHome])
  check('曲线在退: delta 是负的, 判语不能是「平稳上升」', [
    down.json?.relationCurve?.delta,
    down.json?.relationCurve?.verdict,
  ], [-0.2, '在退, 看看是不是被晾着'])
  buildCurve([{ at: at(0, 12, 0), day: at(0, 0, 0), days: 10, closeness: 0.5 }])
  // 单点: 默认那张表也要 exit 0 (2026-11-21 审查: 原先在 delta.toFixed 上崩, 退出码 1)
  const singleTable = run(['--home', curveHome])
  check('单点曲线: 默认表 exit 0 且只打那句说明', [
    singleTable.code,
    singleTable.out.includes('只有一个点, 算不出趋势'),
    singleTable.err.trim(),
  ], [0, true, ''])
  const single = runJson(['--home', curveHome])
  check('曲线只有一个点: 算不出趋势, 不给判语', [
    single.json?.relationCurve?.delta,
    single.json?.relationCurve?.verdict,
    single.json?.relationCurve?.note,
  ], [null, null, '只有一个点, 算不出趋势'])
  check('--template: 正好 8 条打分行', templateLines.filter((one) => one.startsWith('- [ ]')).length, 8)
  check('--template: 每一维都有一句"看什么"', templateLines.filter((one) => one.includes('看什么:')).length, 8)

  /* 七、人读的那张表 */
  const table = run(['--home', fixtureHome])
  check('缺省: 六个读数各占一行 (行首就是名字)', ['drift', 'repeatOpeners', 'chaseRate', 'citationRate', 'planMix', 'boundaryHits']
    .map((name) => new RegExp(`^${name}\\s`, 'mu').test(table.out)), [true, true, true, true, true, true])
  check('缺省: 表里有合格线与 ok / over', [
    table.out.includes('合格线'),
    table.out.includes('over'),
    table.out.includes('ok'),
  ], [true, true, true])
  check('缺省: 末尾一段 relationCurve 带 delta 与判语', [
    table.out.includes('relationCurve'),
    table.out.includes('delta 0.40'),
    table.out.includes('上升偏快'),
  ], [true, true, true])

  /* 八、审计是复用宿主那把尺子, 不是另写一份分词 */
  const source = readFileSync(auditPath, 'utf8')
  check('审计 import 了 state.mjs 的 tokenize / overlapRatio', /import \{ overlapRatio, tokenize \} from '\.\.\/host-plugin\/emotion\/state\.mjs'/u.test(source), true)
  check('审计没有自己的 tokenize / overlapRatio', [
    /function tokenize/u.test(source),
    /function overlapRatio/u.test(source),
    /const tokenize\s*=/u.test(source),
    /const overlapRatio\s*=/u.test(source),
  ], [false, false, false, false])
} finally {
  for (const dir of [fixtureHome, emptyHome, goneHome, citeHome]) {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (failures > 0) {
  console.error(`check-emotion-audit: FAIL (${failures}/${checks})`)
  process.exit(1)
}
console.log(`check-emotion-audit: PASS (${checks})`)
