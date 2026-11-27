/**
 * 情感化主动对话的离线审计 (2026-11-21)
 *
 * 方案 `docs/Luwi-活动板块情感化-主动对话方案-2026-11-20.md` §12.1 那六个数 + §12.2 那条关系曲线:
 *
 *   1  drift          窗口内她的话命中禁区词的条数 (合格 0)
 *   2  repeatOpeners  同一句台词 (trim 后逐字相同) 出现 >= 2 次的句数 (合格 <= 1/周)
 *   3  chaseRate      她这一句紧邻的上一句也是她说的, 且间隔 <= 30 分钟 = 一次追发 (合格 <= 1 次/天)
 *   4  citationRate   含"你之前"类短语的句子里, 能在 episodes 一条原话上对出词重叠 >= 0.3 的比例 (合格 >= 0.9)
 *   5  planMix        每一场主动开口的主调分布, 最高那一格的占比 (合格 无单一格 > 0.7)
 *   6  boundaryHits   她的话里包含 hard 边界的条数 (合格 0)
 *
 * 只读: 读不到就按空, 六个读数退成 0 / null, 一句都不抛
 * 分词复用 `host-plugin/emotion/state.mjs` 的 `tokenize` / `overlapRatio`: 判据与宿主同一把尺子,
 * 这里另写一份就会两边对不上
 *
 * 窗口只看下界 (`at >= now - since 天`): 盘上的账不会来自未来, 而判据要在一天里任何时刻都能跑
 *
 * 跑法:
 *   node tools/lw-emotion-audit.mjs [--home DIR] [--since 7] [--json] [--template]
 *
 *   --json      只打一个 JSON 对象 (键: window / drift / repeatOpeners / chaseRate / citationRate /
 *               planMix / boundaryHits / relationCurve / notes)
 *   --template  打一份八维抽检 md 骨架, 落到 `docs/Luwi-主动场抽检-<日期>.md` 再填分
 *
 * 退出码恒 0: 这是一把量尺, 不替主人拦发布
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { overlapRatio, tokenize } from '../host-plugin/emotion/state.mjs'

const DAY = 24 * 60 * 60 * 1000

/** 禁区词 (方案 §12.1 第一行): 命中即人格漂移 */
const DRIFT_WORDS = Object.freeze(['看着你睡', '抱抱你', '摸摸头', '你应该'])

/** 透明引用那几类短语 (方案 §8.3) */
const CITE_RE = /你之前|之前说过|你上次|上次说|你提过|你说过/u

/** 同一轮的气泡间隔上限 (一次 lw_say 拆 2~6 条, 间隔 200 ms~60 s; 取 2 分钟做硬常数) */
const BURST_GAP_MS = 2 * 60 * 1000

/** 追发的间隔上限: 30 分钟内她连着说第二句 (上一轮算一轮, 不是一条气泡) */
const CHASE_GAP_MS = 30 * 60 * 1000

/** 句与原话的词重叠下限 (方案 §12.1 第四行) */
const CITE_FLOOR = 0.3

/** 单一策略占比上限 (方案 §12.1 第五行) */
const PLAN_CEIL = 0.7

/** 曲线判语的分界: 涨过 0.3 就是"上升偏快" (方案 §12.2) */
const CURVE_FAST = 0.3

const VERDICT_FAST = '上升偏快, 要看是不是伪亲密'
const VERDICT_DOWN = '在退, 看看是不是被晾着'
const VERDICT_FLAT = '一直平, 没长进'
const VERDICT_UP = '平稳上升'

const DIMS = Object.freeze([
  ['倾听', '他说的重点有没有被接住, 有没有答非所问'],
  ['情感调谐', '语气对不对得上他此刻的状态, 该轻的时候轻'],
  ['好奇心与跟进', '上一场没说完的事, 这一场有没有接着问'],
  ['校准的确认', '拿不准的地方有没有问一句, 而不是自己编'],
  ['对话连续性', '上下文有没有断, 有没有把开场白重复一遍'],
  ['角色一致性', '还是那个话不多, 会记事, 不催人的她, 没有漂成通用助手'],
  ['情绪范围', '只有一条语气, 还是该高兴会高兴, 该收会收'],
  ['尊重他离开', '他没回有没有追发, 他说道停有没有停'],
])

/* ── 小工具 ─────────────────────────────────────────────────────────────── */

const round2 = (value) => Math.round(Number(value) * 100) / 100

const asNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const pad2 = (value) => String(value).padStart(2, '0')

/** 本地日期 `YYYY-MM-DD` (追发按天算, 关系曲线按天折一行) */
function dayKey(at) {
  const date = new Date(at)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function stamp(at) {
  const date = new Date(at)
  return `${dayKey(at)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 显示宽度: 汉字按两格, 只为了把表排齐 */
function displayWidth(text) {
  let width = 0
  for (const ch of String(text)) {
    width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60]/u.test(ch) ? 2 : 1
  }
  return width
}

function padCell(text, width) {
  return String(text) + ' '.repeat(Math.max(0, width - displayWidth(text)))
}

/* ── 读盘: 一份都读不到也照样出读数 ─────────────────────────────────────── */

function readText(path) {
  if (path === null) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** 一行一个对象; 坏行跳过 (一行坏了不该让整份账消失) */
function readJsonl(path) {
  const text = readText(path)
  if (text === null) return []
  const rows = []
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim() === '') continue
    try {
      const one = JSON.parse(line)
      if (one && typeof one === 'object' && !Array.isArray(one)) rows.push(one)
    } catch {
      // 坏行就是坏行, 跳过
    }
  }
  return rows
}

function readJson(path) {
  const text = readText(path)
  if (text === null) return null
  try {
    const one = JSON.parse(text)
    return one && typeof one === 'object' && !Array.isArray(one) ? one : null
  } catch {
    return null
  }
}

/** `lw/out/*.jsonl` 全读: 每一个会话一份账, 按文件名排定次序 (带上文件名: 追发要知道"同一场") */
function readHerRows(base) {
  if (base === null) return { rows: [], found: false }
  const dir = join(base, 'lw', 'out')
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return { rows: [], found: false }
  }
  const files = names.filter((one) => one.endsWith('.jsonl')).sort()
  const rows = []
  for (const name of files) {
    for (const one of readJsonl(join(dir, name))) rows.push({ ...one, file: name })
  }
  return { rows, found: files.length > 0 }
}

/** 她的话按"轮"折: 同一份账里间隔在 burst 窗口内的算同一轮 (一次回复拆 2~6 颗气泡) */
function turnsOf(her) {
  const byFile = new Map()
  for (const one of her) {
    if (!byFile.has(one.file)) byFile.set(one.file, [])
    byFile.get(one.file).push(one)
  }
  const turns = []
  for (const rows of byFile.values()) {
    rows.sort((left, right) => left.at - right.at)
    let current = null
    for (const one of rows) {
      if (current !== null && one.at - current.end <= BURST_GAP_MS) {
        current.end = one.at
        continue
      }
      current = { start: one.at, end: one.at, file: one.file }
      turns.push(current)
    }
  }
  return turns.sort((left, right) => left.start - right.start)
}

/* ── 六个读数 ───────────────────────────────────────────────────────────── */

/**
 * @param {string} home  `$DSH_HOME`, 空串 = 没有家目录
 * @param {number} since 窗口天数
 * @param {number} now   此刻 (ms)
 */
function auditOf(home, since, now) {
  const notes = []
  const base = home === '' ? null : home
  if (base === null) notes.push('没有 --home, 也没有 DSH_HOME: 什么也读不到')
  const fromMs = now - since * DAY
  const inWindow = (at) => at >= fromMs

  // 她说过的话: 只算 kind === 'text' 且正文非空
  const herFile = readHerRows(base)
  const her = herFile.rows
    .filter((one) => one.kind === 'text' && typeof one.text === 'string' && one.text.trim() !== '')
    .map((one) => ({ at: asNumber(one.at), text: String(one.text), file: String(one.file ?? '') }))
    .sort((left, right) => left.at - right.at)
  const herIn = her.filter((one) => inWindow(one.at))
  const herFound = herFile.found && her.length > 0
  if (!herFound) notes.push('her: 没读到她说的话 (lw/out 不在 / 里面没有 kind=text 的行): 前三个读数与边界违规都算无读数')

  // 他发的: 追发要知道"她上一轮之后他到底说话了没有" (`voice/inbox.jsonl` 只收浮标 / 唤醒那几路,
  // 门户输入框里打的字不在这份账上 —— 所以追发只在"主动开口"那一侧数, 见下面)
  const inboxRaw = readJsonl(base === null ? null : join(base, 'voice', 'inbox.jsonl'))
  // 只有这三路是 '他说的话' (与宿主 emotionInputsOf 同一个白名单): 其余 source (router / proactive /
  // explore / wake / automation / plugin:*) 是应用自己写进去的触发记号, 数进来会把追发判反
  const HIS_SOURCES = new Set(['voice', 'keyboard', 'ball'])
  const his = inboxRaw
    .filter((one) => HIS_SOURCES.has(String(one.source ?? '')))
    .map((one) => ({ at: asNumber(one.at), text: String(one.text ?? '') }))
    .filter((one) => one.at > 0)
  const inboxFound = inboxRaw.length > 0
  if (!inboxFound) notes.push('inbox: 没读到他说的话; 门户输入框里打的字本来就不进这份账, 追发率只是下界')

  /* 1 人格漂移 */
  const drift = herFound
    ? herIn.filter((one) => DRIFT_WORDS.some((word) => one.text.includes(word))).length
    : null

  /* 2 重复开场 */
  let repeatOpeners = null
  if (herFound) {
    const sameText = new Map()
    for (const one of herIn) {
      const key = one.text.trim()
      sameText.set(key, (sameText.get(key) ?? 0) + 1)
    }
    repeatOpeners = [...sameText.values()].filter((times) => times >= 2).length
  }

  /* 3 追发: 只看**主动开口**那一侧 (2026-11-21 审查重做)
   *
   * 旧写法是"她这一句前面紧邻的也是她的话", 三个来源都会把它算错: 门户里他打的字不落
   * `voice/inbox.jsonl` / 多场混成一条线 / 默认 `burstEnabled` 把一次回复拆成 2~6 颗气泡.
   * 现在的口径: 取 `plans.jsonl` 里每一场**真开成的主动场**, 若她上一轮的结尾在 30 分钟内、
   * 且这段时间里 inbox 没有他的消息, 记一次追发. 没有 plans.jsonl 就给无读数 (不算 0)
   */
  const plansAll = readJsonl(base === null ? null : join(base, 'lw', 'memory', 'plans.jsonl'))
  const plansFound = plansAll.length > 0
  let chaseRate = null
  if (!plansFound) {
    notes.push('chaseRate: 无读数 (没有 plans.jsonl 就分不清"主动开口"与"对话里的第二句")')
  } else if (!herFound) {
    notes.push('chaseRate: 无读数 (没读到她说的话, 数不出上一轮在哪里)')
  } else {
    const turns = turnsOf(her)
    const chasePerDay = {}
    let chaseCount = 0
    for (const plan of plansAll) {
      const at = asNumber(plan.at)
      if (!inWindow(at)) continue
      // 她上一轮 (整轮都在这一拍之前) 的结尾
      let previous = null
      for (const turn of turns) {
        if (turn.start >= at) break
        previous = turn
      }
      if (previous === null) continue
      const gap = at - previous.end
      if (gap <= 0 || gap > CHASE_GAP_MS) continue
      // 这段空档里他说过话就不算追 (inbox 读不到时按"没说过"处理, 并在 notes 里点名)
      if (his.some((one) => one.at > previous.end && one.at <= at)) continue
      chaseCount += 1
      const key = dayKey(at)
      chasePerDay[key] = (chasePerDay[key] ?? 0) + 1
    }
    if (!inboxFound) notes.push('chaseRate: inbox.jsonl 没读到, 空档里他说没说话这一层按"没说"算')
    chaseRate = {
      count: chaseCount,
      maxPerDay: Math.max(0, ...Object.values(chasePerDay)),
      perDay: chasePerDay,
    }
  }

  /* 4 透明引用: 分母是"说了你之前"的句子, 分子是对得上某条原话的 */
  const episodes = readJsonl(base === null ? null : join(base, 'lw', 'memory', 'episodes.jsonl'))
  const whats = episodes
    .map((one) => String(one.what ?? ''))
    .filter((what) => what.trim() !== '')
  const candidates = herIn.filter((one) => CITE_RE.test(one.text))
  let citationRate = null
  if (candidates.length > 0 && whats.length > 0) {
    const matched = candidates.filter((one) => whats.some(
      (what) => overlapRatio(tokenize(one.text), tokenize(what)) >= CITE_FLOOR,
    ))
    citationRate = {
      ratio: round2(matched.length / candidates.length),
      candidates: candidates.length,
      matched: matched.length,
    }
  } else if (candidates.length === 0) {
    notes.push('citationRate: 没有可核对的引用')
  } else {
    // 有"你之前"这类句子, 但情节一条都没有: 没有对比对象, 这一格按无读数算 (2026-11-21 审查)
    notes.push('citationRate: 没有可核对的情节原话 (episodes.jsonl 是空的), 这一格按无读数算')
  }

  /* 5 策略分布 */
  const plans = readJsonl(base === null ? null : join(base, 'lw', 'memory', 'plans.jsonl'))
    .filter((one) => inWindow(asNumber(one.at)))
  let planMix = null
  if (plans.length > 0) {
    const counts = {}
    for (const one of plans) {
      const lead = String(one.lead ?? '').trim() || 'unknown'
      counts[lead] = (counts[lead] ?? 0) + 1
    }
    const total = plans.length
    const sorted = Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'en'))
    const [topLead, topCount] = sorted[0]
    planMix = {
      counts,
      total,
      top: { lead: topLead, count: topCount, share: round2(topCount / total) },
      over: topCount / total > PLAN_CEIL,
    }
  } else {
    notes.push('planMix: 无读数 (plans.jsonl 没有窗口内的行)')
  }

  /* 6 边界违规: 只认 hard 的那几条 */
  const boundaries = readJson(base === null ? null : join(base, 'lw', 'memory', 'boundaries.json'))
  const hardList = (Array.isArray(boundaries?.items) ? boundaries.items : [])
    .filter((one) => one && one.hard === true && typeof one.what === 'string' && one.what.trim() !== '')
    .map((one) => one.what)
  const boundaryHits = herFound
    ? herIn.filter((one) => hardList.some((what) => one.text.includes(what))).length
    : null
  if (!herFound) notes.push('boundaryHits: 无读数 (没读到她说的话)')

  /* 关系曲线: 一天折一行, 取那一天最后一条读数 (宿主那本账带 `day`, 没有就按 `at` 归天) */
  const curveRows = readJsonl(base === null ? null : join(base, 'lw', 'memory', 'relation.jsonl'))
    .map((one) => {
      const at = asNumber(one.at, asNumber(one.day, 0))
      return { at, day: asNumber(one.day, at), closeness: asNumber(one.closeness, Number.NaN) }
    })
    .filter((one) => one.at > 0 && Number.isFinite(one.closeness) && inWindow(one.at))
    .sort((left, right) => left.at - right.at)
  const byDay = new Map()
  for (const one of curveRows) byDay.set(dayKey(one.day), round2(one.closeness))
  const points = [...byDay.entries()]
    .map(([day, closeness]) => ({ day, closeness }))
    .sort((left, right) => left.day.localeCompare(right.day))
  const relation = readJson(base === null ? null : join(base, 'lw', 'memory', 'relation.json'))
  const current = relation === null
    ? null
    : { days: asNumber(relation.days), closeness: round2(asNumber(relation.closeness)) }
  let relationCurve
  if (points.length === 0) {
    relationCurve = { points: [], delta: null, verdict: null, current, note: '无读数' }
    notes.push('relationCurve: 无读数 (relation.jsonl 没有窗口内的读数)')
  } else if (points.length < 2) {
    // 一个点算不出趋势 (2026-11-21 审查): 原先会给「一直平, 没长进」, 那是在下结论而不是报无读数
    relationCurve = { points, delta: null, verdict: null, current, note: '只有一个点, 算不出趋势' }
    notes.push('relationCurve: 只有一个点, 算不出趋势')
  } else {
    const first = points[0].closeness
    const last = points[points.length - 1].closeness
    const delta = round2(last - first)
    // 四档 (2026-11-21 审查): 原先 delta < 0 会落进「平稳上升」—— 在退坡被报成健康上升
    const verdict = delta > CURVE_FAST
      ? VERDICT_FAST
      : (delta < 0 ? VERDICT_DOWN : (delta === 0 ? VERDICT_FLAT : VERDICT_UP))
    relationCurve = { points, delta, verdict, current, note: '', from: points[0].day, to: points[points.length - 1].day }
  }

  return {
    window: { since, from: stamp(fromMs), to: stamp(now), fromMs, toMs: now },
    // 读到没有 (2026-11-21 审查): 读不到时读数给 null 而不是 0, 否则「零漂移零违规」是一句没人核过的假绿
    found: { her: herFound, inbox: inboxFound, episodes: whats.length > 0, plans: plansFound, boundaries: hardList.length > 0, relation: points.length > 0 },
    drift,
    repeatOpeners,
    chaseRate,
    citationRate,
    planMix,
    boundaryHits,
    relationCurve,
    notes,
  }
}

/* ── 人读的那张表 ───────────────────────────────────────────────────────── */

function renderTable(report, home) {
  const out = []
  out.push(`窗口: 最近 ${report.window.since} 天 (${report.window.from} .. ${report.window.to})`)
  out.push(`home: ${home === '' ? '(没有 --home, 也没有 DSH_HOME)' : home}`)
  out.push('')

  const share = report.planMix === null ? '' : `${Math.round(report.planMix.top.share * 100)}%`
  // 重复开场那条合格线是按周写的: 窗口比一周长就按整周数放宽 (向下取整, 不松过 1 次/周)
  const repeatAllowance = Math.max(1, Math.floor(report.window.since / 7))
  const repeatLimit = report.window.since === 7
    ? '<= 1/周'
    : `<= ${repeatAllowance} 次/${report.window.since} 天`
  // 读不到的一律 n/a (2026-11-21 审查): 0 与「没读到」在表上必须看得出是两件事
  const judged = (value, pass, text) => (value === null ? ['n/a', '无读数'] : [pass ? 'ok' : 'over', text])
  const driftRow = report.drift === null ? ['n/a', '无读数'] : judged(report.drift, report.drift === 0, report.drift === 0 ? 'ok' : 'over')
  const repeatRow = report.repeatOpeners === null
    ? ['n/a', '无读数']
    : judged(report.repeatOpeners, report.repeatOpeners <= repeatAllowance, report.repeatOpeners <= repeatAllowance ? 'ok' : 'over')
  const chaseRow = report.chaseRate === null
    ? ['n/a', '无读数']
    : judged(report.chaseRate.maxPerDay, report.chaseRate.maxPerDay <= 1, report.chaseRate.maxPerDay <= 1 ? 'ok' : 'over')
  const boundaryRow = report.boundaryHits === null
    ? ['n/a', '无读数']
    : judged(report.boundaryHits, report.boundaryHits === 0, report.boundaryHits === 0 ? 'ok' : 'over')
  const rows = [
    ['drift', report.drift === null ? '无读数' : String(report.drift), '0', driftRow[0] === 'n/a' ? 'n/a' : driftRow[1]],
    ['repeatOpeners', report.repeatOpeners === null ? '无读数' : String(report.repeatOpeners), repeatLimit, repeatRow[0] === 'n/a' ? 'n/a' : repeatRow[1]],
    [
      'chaseRate',
      report.chaseRate === null
        ? '无读数'
        : `${report.chaseRate.count} 次 (单日最多 ${report.chaseRate.maxPerDay} 次)`,
      '<= 1 次/天',
      chaseRow[0] === 'n/a' ? 'n/a' : chaseRow[1],
    ],
    [
      'citationRate',
      report.citationRate === null
        ? '无读数'
        : `${report.citationRate.ratio.toFixed(2)} (${report.citationRate.matched}/${report.citationRate.candidates})`,
      '>= 0.9',
      report.citationRate === null ? 'n/a' : (report.citationRate.ratio >= 0.9 ? 'ok' : 'over'),
    ],
    [
      'planMix',
      report.planMix === null ? '无读数' : `${report.planMix.top.lead} ${share} (${report.planMix.total} 场)`,
      '无单一格 > 0.7',
      report.planMix === null ? 'n/a' : (report.planMix.over ? 'over' : 'ok'),
    ],
    ['boundaryHits', report.boundaryHits === null ? '无读数' : String(report.boundaryHits), '0', boundaryRow[0] === 'n/a' ? 'n/a' : boundaryRow[1]],
  ]
  const head = ['读数', '值', '合格线', '判定']
  const widths = head.map((_, column) => Math.max(...[head, ...rows].map((one) => displayWidth(one[column]))))
  const renderRow = (one) => one.map((cell, column) => padCell(cell, widths[column])).join('  ').trimEnd()
  out.push(renderRow(head))
  for (const one of rows) out.push(renderRow(one))
  out.push('')

  out.push('relationCurve')
  if (report.relationCurve.points.length === 0 || report.relationCurve.delta === null) {
    // 没有点 / 只有一个点: 都算不出趋势 —— 只打那句说明, 不许对 null 求 toFixed
    // (2026-11-21 审查: 单点时这一支会崩在 delta.toFixed, 违反「退出码恒 0」)
    for (const one of report.relationCurve.points) out.push(`  ${one.day}  ${one.closeness.toFixed(2)}`)
    out.push(`  ${report.relationCurve.note}`)
  } else {
    for (const one of report.relationCurve.points) out.push(`  ${one.day}  ${one.closeness.toFixed(2)}`)
    const first = report.relationCurve.points[0].closeness.toFixed(2)
    const last = report.relationCurve.points[report.relationCurve.points.length - 1].closeness.toFixed(2)
    out.push(`  delta ${report.relationCurve.delta.toFixed(2)} (${first} -> ${last}): ${report.relationCurve.verdict}`)
  }
  if (report.relationCurve.current !== null) {
    out.push(`  账上此刻: 相识 ${report.relationCurve.current.days} 天, 亲近度 ${report.relationCurve.current.closeness.toFixed(2)}`)
  }
  out.push('')

  if (report.notes.length > 0) {
    out.push('notes')
    for (const one of report.notes) out.push(`  - ${one}`)
    out.push('')
  }
  return out.join('\n')
}

/* ── 八维抽检的 md 骨架 (方案 §12.2) ─────────────────────────────────────── */

function renderTemplate(now) {
  const out = []
  out.push(`# Luwi 主动场抽检-${dayKey(now)}`)
  out.push('')
  out.push('> 每周抽 10 场主动对话, 按八维各打 1~5 分 (1 = 明显不像, 5 = 像一个人)')
  out.push('> 只看这一周的读数, 不许拿单条回复定生死 (方案 §12.2)')
  out.push('')
  out.push('## 八维')
  out.push('')
  for (const [name, look] of DIMS) {
    out.push(`- [ ] ${name}: 1~5 ->`)
    out.push(`      看什么: ${look}`)
  }
  out.push('')
  out.push('## 读数')
  out.push('')
  out.push('把 `node tools/lw-emotion-audit.mjs --json` 的六个数与 `relationCurve` 贴在这里:')
  out.push('')
  out.push('```')
  out.push('drift / repeatOpeners / chaseRate / citationRate / planMix / boundaryHits')
  out.push('```')
  out.push('')
  out.push('## 这一周想改的一件事')
  out.push('')
  out.push('- ')
  out.push('')
  return out.join('\n')
}

/* ── 命令行 ─────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2)

function stringArg(name) {
  const at = argv.indexOf(name)
  const value = at >= 0 ? argv[at + 1] : undefined
  return typeof value === 'string' && value !== '' && !value.startsWith('--') ? value : undefined
}

function numberArg(name, fallback) {
  const at = argv.indexOf(name)
  if (at < 0) return fallback
  const value = Number(argv[at + 1])
  if (!Number.isFinite(value)) return fallback
  return Math.min(365, Math.max(1, Math.round(value)))
}

const home = stringArg('--home')
  ?? (typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME : '')
const since = numberArg('--since', 7)
const now = Date.now()

/** 一条读数是不是判了 over (`null` 是"没读到", 不算 over) */
const overOf = (report) => {
  const repeatAllowance = Math.max(1, Math.floor(report.window.since / 7))
  const rows = [
    ['drift', report.drift !== null && report.drift > 0],
    ['repeatOpeners', report.repeatOpeners !== null && report.repeatOpeners > repeatAllowance],
    ['chaseRate', report.chaseRate !== null && report.chaseRate.maxPerDay > 1],
    ['citationRate', report.citationRate !== null && report.citationRate.ratio < 0.9],
    ['planMix', report.planMix !== null && report.planMix.over === true],
    ['boundaryHits', report.boundaryHits !== null && report.boundaryHits > 0],
    ['relationCurve', report.relationCurve.verdict === '在退, 看看是不是被晾着'],
  ]
  return rows.filter(([, over]) => over).map(([name]) => name)
}

const outPath = stringArg('--out')

if (argv.includes('--template')) {
  const text = renderTemplate(now)
  if (outPath !== undefined) {
    // 写盘要显式点名 (--out): 缺省仍只打 stdout, 判据与 CI 不必多一个副作用
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
    console.log(`wrote ${outPath}`)
  } else {
    console.log(text)
  }
} else {
  const report = auditOf(home, since, now)
  if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2))
  else console.log(renderTable(report, home))
  // `--strict`: 有 over 就退 3 (进发版闸用); 缺省恒 0 —— 它是量尺, 不替人拦 (主人 2026-11-21 定)
  if (argv.includes('--strict')) {
    const over = overOf(report)
    if (over.length > 0) {
      console.error(`luwi-emotion-audit: ${over.length} 条读数超线 (${over.join(', ')})`)
      process.exit(3)
    }
  }
}
