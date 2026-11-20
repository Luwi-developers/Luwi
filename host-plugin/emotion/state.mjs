/**
 * 情感状态内核 (2026-11-20)
 *
 * 方案: `docs/Luwi-活动板块情感化-主动对话方案-2026-11-20.md` §5 (状态向量) / §6.3 (召回打分) /
 * §7 (共情策略) / §8.1 (硬边界) / §9.5 (五格换句子)
 *
 * 为什么在这里而不是提示词: 状态与策略都是**纯函数** —— 输入是此刻几份文件的读数, 输出是四个数
 * 与一个策略名。模型每轮"回忆自己什么心情"必然漂移, 而且贵; 折成一个确定向量之后, 模型只负责说。
 *
 * 三条纪律 (方案 §14 的"已知边界"就落在前两条上):
 * - **无 fs 无时钟**: 调用方把 `now` 放进参数, 于是判据可以钉死某一刻
 * - **空输入不抛**: 读不到就是基线 —— 她不该因为一份文件坏了而说不出话
 * - **只列有把握的事件**: `AFFECT_DELTAS` 里没有的 kind 什么都不改, 不猜
 */

/** 基线: 她自己的情绪不是 0, 而是一点点偏暖 (主人 2026-11-19 的语气条) */
export const AFFECT_BASELINE = Object.freeze({ valence: 1, arousal: 1, engagement: 1 })

/** 三个维度的范围 (`phase` 是第四个维度, 由本地时钟给, 不在这里夹) */
export const AFFECT_RANGE = Object.freeze({
  valence: Object.freeze([-2, 2]),
  arousal: Object.freeze([0, 3]),
  engagement: Object.freeze([0, 3]),
})

export const AFFECT_KEYS = Object.freeze(['valence', 'arousal', 'engagement'])

/** 半衰期: 一天不互动, 状态往基线回一半 —— 这就是"睡一觉起来气消了" */
export const AFFECT_HALF_LIFE_MS = 12 * 60 * 60 * 1000

/** 情节的半衰期: 30 天之前的旧事还认得出, 但不再抢着提 */
export const EPISODE_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000

/** 召回预算 (方案 §6.3): 最多 5 条 / 每行 ≤120 字 / 整段 ≤600 字 */
export const EPISODE_BUDGET = Object.freeze({ rows: 5, chars: 600, rowChars: 120 })

/** 〔此刻〕那一段最多多少字 (方案 §5.5): 再长就挤掉真正要说的话 */
export const AFFECT_LINE_MAX = 140

/** 一天四段 */
export const AFFECT_PHASES = Object.freeze(['morning', 'day', 'evening', 'late'])

/** 事件 → 情绪增量 (只列有把握的几种, 其余不动) */
export const AFFECT_DELTAS = Object.freeze({
  talked_to_her: Object.freeze({ valence: 1, engagement: 1 }), // 他主动说话
  replied_her: Object.freeze({ valence: 1, engagement: 1 }), // 她开口之后他接了
  ignored_her: Object.freeze({ valence: -1 }), // 她开口之后他没接
  snapped_at_her: Object.freeze({ valence: -2, arousal: 1 }), // signals 里的负面词命中
  late_night: Object.freeze({ arousal: 1 }), // 01:00-04:00 还在用
  long_game: Object.freeze({ arousal: 1, engagement: -1 }), // 前台游戏且今天这个应用满线
})

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

const asNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

/** 夹在 [low, high] 之间 */
export const clamp = (value, low, high) => Math.min(high, Math.max(low, asNumber(value, low)))

/** 整数档位: 坏值 / 缺键退 `fallback`, 越界夹回范围 (五格与偏置都用它) */
export function clampInt(value, fallback, low, high) {
  if (value === undefined || value === null || value === '') return fallback
  const number = Math.round(Number(value))
  if (!Number.isFinite(number)) return fallback
  return Math.min(high, Math.max(low, number))
}

/**
 * 往基线回 (指数衰减, 不是跳变)
 *
 * @param {object} state 上一次的状态 (缺键按基线)
 * @param {number} at 上一次那一笔的时间
 * @param {number} now 现在
 * @returns {{valence: number, arousal: number, engagement: number, at: number}}
 */
export function decayTowards(state, at, now) {
  const prev = { ...AFFECT_BASELINE, ...(state !== null && typeof state === 'object' ? state : {}) }
  const from = asNumber(at)
  const to = asNumber(now, from)
  const valueOf = (key) => {
    const base = AFFECT_BASELINE[key]
    const start = asNumber(prev[key], base)
    return start
  }
  // 没有时间戳 / 时间没往前走: 原样交给调用方 (只夹一次, 不再衰减)
  const keep = from > 0 && to > from ? Math.pow(0.5, (to - from) / AFFECT_HALF_LIFE_MS) : 1
  const towards = (key) => clamp(AFFECT_BASELINE[key] + (valueOf(key) - AFFECT_BASELINE[key]) * keep,
    AFFECT_RANGE[key][0], AFFECT_RANGE[key][1])
  return { valence: towards('valence'), arousal: towards('arousal'), engagement: towards('engagement'), at: to }
}

/**
 * (状态, 事件) → 新状态 (纯函数)
 *
 * `event.at` 是旧状态那一刻, `event.now` 是这一次事件发生的时刻 —— 两个都给才能既衰减又累加;
 * 只给一个时另一头跟着它走 (与方案 §5.3 的签名一致)
 */
export function affectStep(state, event) {
  const at = asNumber(event?.at)
  const now = asNumber(event?.now, at)
  const cold = decayTowards(state, at, now)
  const kind = String(event?.kind ?? '')
  const delta = AFFECT_DELTAS[kind] ?? {}
  const step = (key) => clamp(cold[key] + asNumber(delta[key]), AFFECT_RANGE[key][0], AFFECT_RANGE[key][1])
  return { valence: step('valence'), arousal: step('arousal'), engagement: step('engagement'), at: now }
}

/**
 * 这一次快照对应哪一件"有把握的事" (纯函数, 方案 §5.3 的 event)
 *
 * 宿主每轮 / 每一拍算一次状态, 靠这几条读数认出"上一笔之后发生了什么": 他接了 / 他先开口 /
 * 她说完没人接 / 他这会儿话里带刺. **认不出就回 null** —— 没有事件时只剩衰减, 那才是"什么都没发生"
 *
 * @param {object|null} previous 上一次落盘的那一笔 (`lastUserAt` / `lastSpokenAt` / `ignored` ...)
 * @param {object} inputs 这一次的读数
 * @returns {string|null} `AFFECT_DELTAS` 的键, 或 null
 */
export function affectEventOf(previous, inputs) {
  if (!previous || typeof previous !== 'object') return null
  const lastUser = asNumber(inputs?.lastUserAt)
  const lastSpoken = asNumber(inputs?.lastSpokenAt)
  const prevUser = asNumber(previous?.lastUserAt)
  const prevSpoken = asNumber(previous?.lastSpokenAt)
  const ignored = asNumber(inputs?.ignored)
  const prevIgnored = asNumber(previous?.ignored)
  // 他这会儿话里带刺: **排在最前面** (2026-11-20 审查). 负面词只从他新说的话里数得出来, 所以
  // "带刺"与"他先开口"必然同一拍发生 —— 顺序反了的话 snapped_at_her 永远走不到, 骂一句反而 +1
  if (asNumber(inputs?.negativeHits) > asNumber(previous?.negativeSeen)) return 'snapped_at_her'
  // 打游戏打久了: 过线只记一次 (水位落在 `longGame`, 下一拍还在打就不再记)
  if (inputs?.longGame === true && previous?.longGame !== true) return 'long_game'
  // 她说过一句, 他接上了 —— 比"他先开口"更值得记一笔
  if (prevSpoken > 0 && lastSpoken > prevSpoken && lastUser > prevSpoken) return 'replied_her'
  if (lastUser > prevUser) return 'talked_to_her'
  if (ignored > prevIgnored) return 'ignored_her'
  if (inputs?.foregroundGame === true && inputs?.phase === 'late' && previous?.phase !== 'late') return 'late_night'
  return null
}

/** 现在是一天里的哪一段 (本地时钟; 认不出时间就当白天) */
export function phaseOf(when) {
  const date = when instanceof Date ? when : new Date(asNumber(when))
  if (Number.isNaN(date.getTime())) return 'day'
  const hour = date.getHours()
  if (hour >= 23 || hour < 5) return 'late'
  if (hour < 10) return 'morning'
  if (hour < 17) return 'day'
  return 'evening'
}

export const PHASE_WORDS = Object.freeze({
  morning: '早上',
  day: '白天',
  evening: '晚上',
  late: '深夜',
})

const clockText = (when) => {
  const date = new Date(asNumber(when))
  if (Number.isNaN(date.getTime())) return '--:--'
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

/** "3 小时前" / "20 分钟前" / "刚刚" */
export function agoText(now, then) {
  const gap = asNumber(now) - asNumber(then)
  if (asNumber(then) <= 0) return ''
  if (!Number.isFinite(gap) || gap < 0) return '刚刚'
  if (gap < MINUTE) return '刚刚'
  if (gap < HOUR) return `${Math.max(1, Math.round(gap / MINUTE))} 分钟前`
  if (gap < 24 * HOUR) return `${Math.max(1, Math.round(gap / HOUR))} 小时前`
  return `${Math.max(1, Math.round(gap / (24 * HOUR)))} 天前`
}

/**
 * 从现成的读数折成四个维度 (方案 §5.4)
 *
 * 输入全是**已经算好的事实**, 不是文件: 谁读文件 (`readRouterInputs`) 谁负责把这几样摘出来 ——
 * 这个函数因此可以离线真跑, 也因此在判据里能钉死某个具体场景
 *
 * @param {object} inputs
 * @param {number} inputs.now 现在
 * @param {number} [inputs.lastUserAt] 他最后一次主动说话
 * @param {number} [inputs.lastSpokenAt] 她最后一次开口
 * @param {number} [inputs.ignored] 她开口之后连着几次没人接
 * @param {number} [inputs.userTurns] 24 h 里他说了几句
 * @param {number} [inputs.negativeHits] signals 里负面词命中几次
 * @param {number} [inputs.phoneMinutes] 今天用手机多少分钟
 * @param {boolean} [inputs.foregroundGame] 前台是不是游戏
 * @param {boolean} [inputs.callRecent] 半小时内有过通话
 * @returns {{valence: number, arousal: number, engagement: number, phase: string, at: number}}
 */
export function affectEstimateOf(inputs = {}) {
  const now = asNumber(inputs?.now)
  const phase = AFFECT_PHASES.includes(String(inputs?.phase)) ? String(inputs.phase) : phaseOf(now)
  const lastUserAt = asNumber(inputs?.lastUserAt)
  const lastSpokenAt = asNumber(inputs?.lastSpokenAt)
  const ignored = clamp(inputs?.ignored, 0, 5)
  const userTurns = Math.max(0, asNumber(inputs?.userTurns))
  const negativeHits = Math.max(0, asNumber(inputs?.negativeHits))
  const phoneMinutes = Math.max(0, asNumber(inputs?.phoneMinutes))

  // valence: 他今天说话的密度 (+) / 被骂过 (-) / 她开口之后有没有人接 (-)
  let valence = AFFECT_BASELINE.valence
  if (userTurns >= 3) valence += 1
  if (userTurns >= 10) valence += 0.5
  valence -= 2 * Math.min(2, negativeHits)
  valence -= 0.5 * Math.min(3, ignored)
  // 她刚说完他就接了: 这一笔是"被接住"的正面证据
  if (lastSpokenAt > 0 && lastUserAt > lastSpokenAt) valence += 1

  // arousal: 时段 (+) / 前台游戏 (+) / 刚挂电话 (+) / 深夜还在用 (+)
  let arousal = AFFECT_BASELINE.arousal
  if (phase === 'late') arousal += 1
  if (inputs?.foregroundGame === true) arousal += 1
  if (inputs?.callRecent === true) arousal -= 1
  if (phoneMinutes >= 180) arousal += 0.5

  // engagement: 24 h 的互动轮数 (+) / 上次对话距今 (-) / 上次开口没被接 (-)
  let engagement = AFFECT_BASELINE.engagement
  if (userTurns >= 2) engagement += 1
  if (userTurns >= 8) engagement += 1
  if (lastUserAt > 0 && now - lastUserAt > 24 * HOUR) engagement -= 1
  else if (lastUserAt === 0) engagement -= 1
  engagement -= 0.5 * Math.min(2, ignored)

  return {
    valence: clamp(valence, AFFECT_RANGE.valence[0], AFFECT_RANGE.valence[1]),
    arousal: clamp(arousal, AFFECT_RANGE.arousal[0], AFFECT_RANGE.arousal[1]),
    engagement: clamp(engagement, AFFECT_RANGE.engagement[0], AFFECT_RANGE.engagement[1]),
    phase,
    at: now,
  }
}

const valenceWord = (value) => {
  const one = asNumber(value, 1)
  if (one <= -1) return '有点低落'
  if (one <= 0) return '平平'
  if (one >= 2) return '很好'
  return '偏暖'
}

const arousalWord = (value) => {
  const one = asNumber(value, 1)
  if (one >= 3) return '高唤醒'
  if (one >= 2) return '中等'
  return '低唤醒'
}

/**
 * 〔此刻〕那一行 (≤[AFFECT_LINE_MAX] 字, 方案 §5.5)
 *
 * 四个短句全是**可核实的事实**, 不是形容词堆砌 —— 这是"她知道自己现在什么状态", 而不是"她被要求
 * 表现得温暖"。读不到的那几格整句不出现 (不留"上次说话是 --")
 */
export function affectLine(affect, facts = {}) {
  const now = asNumber(facts?.now, asNumber(affect?.at))
  const phase = AFFECT_PHASES.includes(String(affect?.phase)) ? String(affect.phase) : phaseOf(now)
  const parts = [`${clockText(now)} ${PHASE_WORDS[phase]}`]
  const firstUserAt = asNumber(facts?.firstUserAt)
  if (firstUserAt > 0) {
    const first = new Date(firstUserAt)
    const hh = String(first.getHours()).padStart(2, '0')
    const mm = String(first.getMinutes()).padStart(2, '0')
    parts.push(`今天他先开口 ${hh}:${mm}`)
  } else if (facts?.userTurnsToday === 0) {
    parts.push('他今天还没开口')
  }
  const lastSpokenAt = asNumber(facts?.lastSpokenAt)
  const lastUserAt = asNumber(facts?.lastUserAt)
  if (lastSpokenAt > 0) {
    const ago = agoText(now, lastSpokenAt)
    const answered = lastUserAt > lastSpokenAt ? '他接上了' : '他没接'
    parts.push(`上一次说话是 ${ago} (${answered})`)
  }
  const phoneMinutes = asNumber(facts?.phoneMinutes)
  if (phoneMinutes >= 30) parts.push(`用手机 ${Math.round(phoneMinutes / 60)} 小时`)
  else if (facts?.phoneMinutes !== undefined) parts.push('没怎么碰手机')
  if (facts?.foregroundGame === true) parts.push('在打游戏')
  else if (facts?.foregroundGame === false) parts.push('没在打游戏')
  const head = `〔此刻〕${parts.join(' · ')}`
  return head.length <= AFFECT_LINE_MAX ? head : `${head.slice(0, AFFECT_LINE_MAX - 1)}…`
}

/** 关系那一行: 相识 N 天、亲近 0.62 (没有关系账就整句不出现) */
export function relationLine(relation) {
  const days = Math.max(0, Math.round(asNumber(relation?.days)))
  const closeness = asNumber(relation?.closeness, Number.NaN)
  if (days <= 0 && !Number.isFinite(closeness)) return ''
  const parts = []
  if (days > 0) parts.push(`相识 ${days} 天`)
  if (Number.isFinite(closeness)) parts.push(`亲近 ${closeness.toFixed(2)}`)
  return parts.length === 0 ? '' : `关系: ${parts.join('、')}`
}

/**
 * 「先陪还是先给办法」那一格 (方案 §9.2 / §9.5)
 *
 * 只改写**缺省**那一档: 0 = 缺省先陪 (把 `default` 那一支压成 companion), 2 = 缺省先给办法,
 * 1 = 看情况 (原样). 具体场景 (他低落 / 他忙 / 连着没接) 照 §7.2 走, 不被这一格盖掉 —— 那一格
 * 是"平时的倾向", 不是"任何情况都这么说"
 */
export function applyEmpathySetting(plan, setting) {
  const base = plan && typeof plan === 'object' ? plan : { lead: 'companion', avoid: 'advise', budget: 2, why: 'default' }
  const tier = clampInt(setting, AFFECT_SETTING_DEFAULTS.empathy, 0, 2)
  if (tier === 0) {
    return base.why === 'default' ? { ...base, lead: 'companion', avoid: 'advise' } : base
  }
  if (tier === 2) {
    return base.why === 'default'
      ? { ...base, lead: 'advise', avoid: 'distract', budget: Math.max(2, asNumber(base.budget, 2)) }
      : base
  }
  return base
}

/** 策略 → 一句人话 ("这一场该怎么陪") */
export const PLAN_WORDS = Object.freeze({
  companion: '先陪着, 不急着给办法',
  validate: '先接住他的情绪, 别急着讲道理',
  advise: '给办法, 但先说一句人话',
  distract: '换个轻的话题, 别往深里挖',
  space: '留白, 只说一句, 不问第二句',
})

export const PLAN_LEADS = Object.freeze(['companion', 'validate', 'advise', 'distract', 'space'])

/**
 * "这一场别做什么"那一句 (2026-11-20 真机读数修)
 *
 * 以前拿 [PLAN_WORDS] 拼成"不要{给办法, 但先说一句人话}" —— 自相矛盾. 避开的那一档要自己的说法
 */
export const AVOID_WORDS = Object.freeze({
  companion: '别只陪着不说话',
  validate: '别急着讲道理',
  advise: '别急着给办法',
  distract: '别硬换个话题',
  space: '别再追问',
})

/**
 * (状态, 关系, 此刻) → 这一场怎么陪 (纯函数, 方案 §7.2 逐行)
 *
 * @returns {{lead: string, avoid: string, budget: number, why: string}}
 */
export function empathyPlanOf(affect, relation, moment) {
  const late = moment?.phase === 'late'
  const cold = Number(relation?.ignored ?? 0) >= 2 // 连着两次没接
  const low = Number(affect?.valence ?? 0) <= -1
  const busy = moment?.busy === true // 游戏 / 视频 / 通话
  if (cold) return { lead: 'space', avoid: 'advise', budget: 1, why: 'two in a row unanswered' }
  if (late && low) return { lead: 'companion', avoid: 'advise', budget: 1, why: 'late and low' }
  if (low) return { lead: 'validate', avoid: 'distract', budget: 2, why: 'down today' }
  if (busy) return { lead: 'distract', avoid: 'validate', budget: 1, why: 'he is busy' }
  if (Number(relation?.closeness ?? 0) >= 0.6) {
    return { lead: 'companion', avoid: 'advise', budget: 2, why: 'used to each other' }
  }
  return { lead: 'companion', avoid: 'advise', budget: 2, why: 'default' }
}

/** 策略那一段 (方案 §7.3): 一行, 打在开场正文里 "可以沉默" 之后, 语气之前 */
export function planLine(plan, affect) {
  const lead = PLAN_LEADS.includes(String(plan?.lead)) ? String(plan.lead) : 'companion'
  const avoid = PLAN_LEADS.includes(String(plan?.avoid)) ? String(plan.avoid) : ''
  const budget = Math.max(1, Math.min(6, Math.round(asNumber(plan?.budget, 1))))
  const why = String(plan?.why ?? '')
  const reason = {
    'two in a row unanswered': '他刚连着两次没接我, 所以只说一句, 不问第二句',
    'late and low': '这个点他状态不太好, 陪着就行, 别问东问西',
    'down today': '他今天不太顺, 先把情绪接住',
    'he is busy': '他手上正忙, 说一句就够, 别拽着他聊',
    'used to each other': '两个人已经熟了, 可以放松一点',
    default: '',
  }[why] ?? ''
  const head = `这一场主调: ${PLAN_WORDS[lead]}`
  // 主调与避开那一档说的是同一句时只留一次 (2026-11-21 真机读数: "先陪着, 不急着给办法. 别急着给办法.")
  const avoidText = lead === 'companion' && avoid === 'advise' ? '' : AVOID_WORDS[avoid]
  const tail = [avoidText, budget === 1 ? '只说一条' : '', reason]
    .filter((one) => one !== '')
  const low = Number(affect?.valence ?? 0) <= -1 ? '他今天情绪偏低, 先照顾人再说事' : ''
  const all = [head, ...tail, low].filter((one) => one !== '')
  return `${all.join('. ')}.`
}

const AFFECT_SETTING_RANGES = Object.freeze({
  baseline: Object.freeze([0, 2]),
  empathy: Object.freeze([0, 2]),
  boundary: Object.freeze([0, 2]),
  recall: Object.freeze([0, 3]),
  honesty: Object.freeze([0, 2]),
})

export const AFFECT_SETTING_DEFAULTS = Object.freeze({
  baseline: 1,
  empathy: 0,
  boundary: 1,
  recall: 2,
  honesty: 1,
})

/**
 * `sim.json` 的 `affect` 段 (方案 §9.2): 五格越界夹回范围, 缺键回缺省, 坏值当缺键
 *
 * 与 `simRouterRules` 同一条纪律 —— 缺键 / 坏值不往结果里塞 undefined, 否则 spread 一下就把缺省
 * 盖成"没有"
 */
export function affectSettingsOf(source) {
  const out = {}
  for (const [key, range] of Object.entries(AFFECT_SETTING_RANGES)) {
    out[key] = clampInt(source?.[key], AFFECT_SETTING_DEFAULTS[key], range[0], range[1])
  }
  return out
}

/** 召回预算 0 / 2 / 4 / 6 条由 `recall` 那一格给 */
export function recallRowsOf(recall) {
  return [0, 2, 4, 6][clampInt(recall, AFFECT_SETTING_DEFAULTS.recall, 0, 3)]
}

/**
 * 五格 → 三句提示词 (方案 §9.5 逐字)
 *
 * @returns {{base: string, lead: string, edge: string[]}}
 */
export function affectMoodLines(affect) {
  const base = [
    '你平时的温度是冷静: 不说多余的话',
    '你平时的温度是温和: 不冷, 也不过分热络',
    '你平时的温度是偏暖: 说话会带一点软',
  ][clampInt(affect?.baseline, 1, 0, 2)]
  const lead = [
    '缺省先陪着他, 少给办法',
    '看情况: 他问才给办法',
    '缺省先给办法, 再补一句人话',
  ][clampInt(affect?.empathy, 0, 0, 2)]
  const edge = [
    ['他没有回应也不追', '他说不想聊就收住'],
    ['他没有回应就不发第二条', '他说不想聊就收住', '不替他做决定'],
    ['他没有回应就不发第二条', '他说不想聊就收住', '不替他做决定', '不猜他的心思'],
  ][clampInt(affect?.boundary, 1, 0, 2)]
  return { base, lead, edge: [...edge] }
}

/** 把一句中文切成可比的词: 拉丁词按词, 汉字按二元组 (方案 §6.3 的 tokenize) */
export function tokenize(text) {
  const raw = String(text ?? '').toLowerCase()
  if (raw.trim() === '') return []
  const words = raw.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const out = []
  for (const word of words) {
    if (/^[\p{Script=Han}]+$/u.test(word)) {
      if (word.length === 1) out.push(word)
      for (let index = 0; index + 1 < word.length; index += 1) out.push(word.slice(index, index + 2))
      continue
    }
    out.push(word)
  }
  return out
}

/** 两个词袋的重叠比例 (0..1): 交集 / 较小的那一袋 */
export function overlapRatio(left, right) {
  const a = new Set(Array.isArray(left) ? left : [])
  const b = new Set(Array.isArray(right) ? right : [])
  if (a.size === 0 || b.size === 0) return 0
  let hit = 0
  for (const one of a) if (b.has(one)) hit += 1
  return hit / Math.min(a.size, b.size)
}

/**
 * 一条情节有多值得想起来 (方案 §6.3 逐行): 词重叠 0.5 / 时间衰减 0.35 / 未了的事 0.3 / 一起开心过 0.1
 */
export function episodeScore(one, cue, now) {
  const overlap = overlapRatio(tokenize(one?.what), tokenize(cue))
  const age = Math.max(0, asNumber(now) - asNumber(one?.at))
  const recent = Math.pow(0.5, age / EPISODE_HALF_LIFE_MS)
  const open = one?.open === true ? 0.3 : 0
  const warm = Number(one?.valence) >= 1 ? 0.1 : 0
  return overlap * 0.5 + recent * 0.35 + open + warm
}

/**
 * 按 cue 召回最该提的几条 (方案 §6.3)
 *
 * 只给"有出处的原话", 不给她"印象": 每条都是 `episodes.jsonl` 里的一行
 *
 * @returns {{rows: object[], chars: number, scored: {row: object, score: number}[]}}
 */
export function relatedEpisodesFor(episodes, cue, now, budget = EPISODE_BUDGET) {
  const rows = (Array.isArray(episodes) ? episodes : []).filter((one) => one && typeof one === 'object')
  const limitRows = Math.max(0, Math.round(asNumber(budget?.rows, EPISODE_BUDGET.rows)))
  const limitChars = Math.max(0, Math.round(asNumber(budget?.chars, EPISODE_BUDGET.chars)))
  const rowChars = Math.max(20, Math.round(asNumber(budget?.rowChars, EPISODE_BUDGET.rowChars)))
  const hasCue = String(cue ?? '').trim() !== ''
  const scored = rows
    .map((row) => ({ row, score: episodeScore(row, cue, now) }))
    .filter((one) => (hasCue ? one.score > 0 : true))
    .sort((left, right) => right.score - left.score || asNumber(right.row?.at) - asNumber(left.row?.at))
  const picked = []
  let chars = 0
  for (const one of scored) {
    if (picked.length >= limitRows) break
    const text = String(one.row?.what ?? '').trim().slice(0, rowChars)
    if (text === '') continue
    if (chars + text.length > limitChars) continue
    chars += text.length
    picked.push(one.row)
  }
  return { rows: picked, chars, scored }
}

const dayText = (at) => {
  const date = new Date(asNumber(at))
  if (Number.isNaN(date.getTime()) || asNumber(at) <= 0) return ''
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * 〔记着的几件事〕那一段 (方案 §6.4)
 *
 * 一条都没有时回空串 —— **不许留一个空标题**; 最后那句透明性约束是 G6 的落点: 引用必须是原话,
 * 不许加工成"你上次特别难过的时候"
 */
export function episodeBlock(rows) {
  const lines = (Array.isArray(rows) ? rows : [])
    .map((one) => {
      const what = String(one?.what ?? '').trim()
      if (what === '') return ''
      const day = dayText(one?.at)
      const marks = [
        day === '' ? '' : day,
        `「${what.slice(0, 60)}」`,
        one?.open === true ? '还没回我 (未了)' : '说过了',
      ].filter((item) => item !== '')
      return `- ${marks.join(' ')}`
    })
    .filter((one) => one !== '')
  if (lines.length === 0) return ''
  return [
    '〔记着的几件事〕',
    ...lines,
    '这几件都可以提, 但一次只说一件; 说的时候用他的原话, 别添颜色.',
  ].join('\n')
}

/**
 * 他划过的那几条线里, 这一句踩到了哪条 (方案 §8.1)
 *
 * 只认 `hard: true` 的条目; `hard: false` 只进提示词当"注意", 不作硬拦 —— 界限画在这里是因为
 * "他说过别问"与"她猜他可能不喜欢"不是一回事
 *
 * @returns {object|null} 命中的那一条
 */
export function hardBoundaryHit(text, items) {
  const said = String(text ?? '').trim()
  if (said === '') return null
  const rows = Array.isArray(items) ? items : []
  for (const one of rows) {
    if (!one || one.hard !== true) continue
    const what = String(one.what ?? '').trim()
    if (what === '') continue
    if (said.includes(what)) return one
  }
  return null
}

/** 软边界那一段 (`hard: false`): 只当"注意", 不作硬拦 */
export function softBoundaryBlock(items) {
  const rows = (Array.isArray(items) ? items : [])
    .filter((one) => one && one.hard !== true)
    .map((one) => String(one?.what ?? '').trim())
    .filter(Boolean)
  if (rows.length === 0) return ''
  return ['〔他划过的线〕', ...rows.map((one) => `- ${one}`), '这些别提, 也别绕着问.'].join('\n')
}

/**
 * 一次主动场/一步对话要注入的那一整段 (状态 + 关系 + 策略 + 记着的事)
 *
 * 任何一格读不到就整句不出现; 一条都没有时回空串 —— 于是"什么都没有"与"有东西"在提示词里
 * 长得完全不一样, 判据也能直接钉 (方案 §11.1 第六节)
 */
export function affectBlockOf({ affect, facts, relation, plan, episodes, settings } = {}) {
  const parts = []
  if (affect) {
    const line = affectLine(affect, facts ?? {})
    if (line !== '') parts.push(line)
    const relationText = relationLine(relation)
    const mood = `心情: ${valenceWord(affect.valence)}、${arousalWord(affect.arousal)}`
    parts.push(relationText === '' ? mood : `${mood} · ${relationText}`)
  }
  if (plan) parts.push(planLine(plan, affect))
  if (settings) {
    const mood = affectMoodLines(settings)
    parts.push(`今天的分寸: ${mood.base}; ${mood.lead}; ${mood.edge.join(' / ')}`)
  }
  const episodesText = episodeBlock(episodes)
  if (episodesText !== '') parts.push(episodesText)
  return parts.join('\n')
}
