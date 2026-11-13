/**
 * 判断层（"这一刻要不要开口"）的判据表 (2.8.0 球是门户)
 *
 * 主人这一批要的是"她自己挑时机": 打游戏久了提醒歇一会儿、记着的事到点提一句、太久没说话随口问
 * 一声。这一层是**纯函数**, 没有设备、没有网、没有文件也能跑 —— 于是"她什么时候会开口"这件事
 * 在合进 APK 之前就能一条一条看
 *
 * 跑法: `node tools/check-router.mjs`
 * 它**直接取 `host-plugin/index.mjs` 里那一段源码来跑** (不复制第二份), 所以测的是上线那一份
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const host = await readFile(new URL('host-plugin/index.mjs', root), 'utf8')

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

/* ── 抽那一段纯函数 ─────────────────────────────────────────────────────── */

const at = host.indexOf('const ROUTER_DEFAULTS')
const end = host.indexOf('function ballReplyPolicy', at)
if (at < 0 || end < 0) {
  console.error('FAIL the router block is not in host-plugin/index.mjs any more')
  process.exit(1)
}
const { judgeRouter, routerCheckHit, routerInsideQuiet, routerDayKey, ROUTER_DEFAULTS } = new Function(
  `${host.slice(at, end)}\nreturn { judgeRouter, routerCheckHit, routerInsideQuiet, routerDayKey, ROUTER_DEFAULTS }`,
)()

/* ── 两把"她自己定"的尺子 (2026-11-10) ─────────────────────────────────── */

const rulesAt = host.indexOf('const ROUTER_RULE_RANGES')
const rulesEnd = host.indexOf('async function writeRouterRules', rulesAt)
if (rulesAt < 0 || rulesEnd < 0) {
  console.error('FAIL the router rules block is not in host-plugin/index.mjs any more')
  process.exit(1)
}
const { normalizeRouterRules } = new Function(
  `${host.slice(rulesAt, rulesEnd)}\nreturn { normalizeRouterRules }`,
)()

check('两把尺子原样收下', normalizeRouterRules({ gameMinutes: 120, wishDays: 30 }), {
  gameMinutes: 120,
  wishDays: 30,
})
check('越界夹回范围 (游戏 5..1440 / 提前 1..365)', normalizeRouterRules({ gameMinutes: 0, wishDays: 9999 }), {
  gameMinutes: 5,
  wishDays: 365,
})
check('坏值丢掉, 不认识的不收', normalizeRouterRules({ gameMinutes: '很久', wishDays: null, cooldownMs: 1 }), {})
check('只给一个键时另一个不出现 (另一把尺子保持原样)', normalizeRouterRules({ gameMinutes: 80 }), {
  gameMinutes: 80,
})
check('不是对象时回空', normalizeRouterRules(null), {})
check('缺省仍是 100 分钟 / 60 天', [ROUTER_DEFAULTS.gameMinutes, ROUTER_DEFAULTS.wishDays], [100, 60])

/* ── 一个固定的"现在": 2026-11-07 21:40 ─────────────────────────────────── */

const NOW = new Date(2026, 10, 7, 21, 40, 0).getTime()
const HOUR = 60 * 60 * 1000
const GAME = 'com.tencent.tmgp.sgame'

/** 一个什么都不触发的底座 (`lastSpokenAt` 跟着 `now` 走: 换一个钟点时它仍该落在五小时前) */
function base(over = {}) {
  const now = Number(over?.now ?? NOW)
  return {
    now,
    quiet: { enabled: true, from: '23:00', to: '07:00' },
    lastSpokenAt: now - 5 * HOUR,
    usage: { today: [], foreground: null },
    wishes: [],
    signals: [],
    random: () => 0.99,
    ...over,
  }
}

/* ── 一、闸 ─────────────────────────────────────────────────────────────── */

check(
  '静默时段里不开口',
  judgeRouter(base({ now: new Date(2026, 10, 7, 23, 30, 0).getTime() })).say,
  false,
)

check(
  '跨零点的静默窗口: 23:00-07:00 里 02:00 算在里面',
  routerInsideQuiet(120, '23:00', '07:00'),
  true,
)

check('同一窗口 12:00 不在里面', routerInsideQuiet(720, '23:00', '07:00'), false)

check('认不出来的窗口不算静默', routerInsideQuiet(720, '坏', '07:00'), false)

check(
  '冷却里不开口 (12 分钟前刚说过)',
  judgeRouter(base({ lastSpokenAt: NOW - 12 * 60 * 1000 })).say,
  false,
)

check(
  '冷却那句话会说自己为什么不说',
  judgeRouter(base({ lastSpokenAt: NOW - 12 * 60 * 1000 })).why,
  'spoke 12 min ago',
)

check(
  '通话中不开口',
  judgeRouter(base({ signals: [{ at: NOW - 60 * 1000, kind: 'call', state: 'start' }] })).why,
  'a call is running',
)

check(
  '通话结束之后就能说了',
  judgeRouter(base({
    signals: [
      { at: NOW - 20 * 60 * 1000, kind: 'call', state: 'start' },
      { at: NOW - 60 * 1000, kind: 'call', state: 'end' },
    ],
    usage: { today: [{ pkg: GAME, label: '王者荣耀', ms: 118 * 60 * 1000 }] },
  })).kind,
  'rest',
)

/* ── 二、游戏时长 ───────────────────────────────────────────────────────── */

check(
  '游戏 118 分钟 -> 提醒歇一会儿',
  judgeRouter(base({ usage: { today: [{ pkg: GAME, label: '王者荣耀', ms: 118 * 60 * 1000 }] } })),
  {
    say: true,
    kind: 'rest',
    to: 'ball',
    brief: '王者荣耀 今天 118 分钟, 现在 21:40',
    why: '王者荣耀 今天 118 分钟, 现在 21:40',
  },
)

check(
  '游戏 90 分钟还没到线 -> 不说',
  judgeRouter(base({ usage: { today: [{ pkg: GAME, label: '王者荣耀', ms: 90 * 60 * 1000 }] } })).say,
  false,
)

check(
  '不是游戏的应用再久也不按"歇一会儿"说',
  judgeRouter(base({ usage: { today: [{ pkg: 'com.tencent.mm', label: '微信', ms: 300 * 60 * 1000 }] } })).say,
  false,
)

check(
  '规则里的线抬到 200 分钟后 118 分钟就不说了',
  judgeRouter(base({
    usage: { today: [{ pkg: GAME, label: '王者荣耀', ms: 118 * 60 * 1000 }] },
    rules: { gameMinutes: 200 },
  })).say,
  false,
)

check(
  '应用标了 game 的也认 (不靠包名表)',
  judgeRouter(base({ usage: { today: [{ pkg: 'com.example.whatever', label: '某游戏', game: true, ms: 150 * 60 * 1000 }] } })).kind,
  'rest',
)

/* ── 三、记着的事 ───────────────────────────────────────────────────────── */

const in37 = '2026-12-14'
check(
  '四级还有 37 天 -> 提一句',
  judgeRouter(base({ wishes: [{ id: 'cet4', what: '考四级', due: in37, said: [] }] })),
  {
    say: true,
    kind: 'wish',
    to: 'ball',
    id: 'cet4',
    brief: '考四级还有 37 天, 今天还没提过',
    why: '考四级还有 37 天, 今天还没提过',
  },
)

check(
  '今天已经提过就不再提',
  judgeRouter(base({ wishes: [{ id: 'cet4', what: '考四级', due: in37, said: ['2026-11-07'] }] })).say,
  false,
)

check(
  '过了期的不提',
  judgeRouter(base({ wishes: [{ id: 'cet4', what: '考四级', due: '2026-11-01', said: [] }] })).say,
  false,
)

check(
  '太多天以后的不提 (缺省 60 天)',
  judgeRouter(base({ wishes: [{ id: 'cet4', what: '考四级', due: '2027-06-01', said: [] }] })).say,
  false,
)

check(
  '推迟到以后的不提',
  judgeRouter(base({ wishes: [{ id: 'cet4', what: '考四级', due: in37, said: [], snoozeUntil: NOW + HOUR }] })).say,
  false,
)

check(
  '日期写坏了的那一条只是跳过, 不抛',
  judgeRouter(base({ wishes: [{ id: 'x', what: '那件事', due: '不是日期', said: [] }] })).say,
  false,
)

check(
  '游戏与未了的事同时成立时先说游戏',
  judgeRouter(base({
    usage: { today: [{ pkg: GAME, ms: 150 * 60 * 1000 }] },
    wishes: [{ id: 'cet4', what: '考四级', due: in37, said: [] }],
  })).kind,
  'rest',
)

/* ── 四、随口一句 ───────────────────────────────────────────────────────── */

check(
  '五小时没说话 + 抽中了 -> 随口问一句',
  judgeRouter(base({ lastSpokenAt: NOW - 5 * HOUR, random: () => 0.1 })).kind,
  'chat',
)

check(
  '抽不中就不说',
  judgeRouter(base({ lastSpokenAt: NOW - 5 * HOUR, random: () => 0.9 })).say,
  false,
)

check(
  '一小时前刚说过 -> 不进入抽签',
  judgeRouter(base({ lastSpokenAt: NOW - 1 * HOUR, random: () => 0.0 })).say,
  false,
)

check(
  '从没说过话也算"太久没说话"',
  judgeRouter(base({ lastSpokenAt: 0, random: () => 0.1 })).brief,
  '今天还没说过话, 随口问一句',
)

/* ── 五、退让: 连着两次没人接就收敛 ─────────────────────────────────────── */

check(
  '两次没人接之后, 12 小时前说过的那一次也要挡住 (24 小时冷却)',
  judgeRouter(base({
    lastSpokenAt: NOW - 12 * HOUR,
    ignored: 2,
    usage: { today: [{ pkg: GAME, ms: 150 * 60 * 1000 }] },
  })).why,
  'stepped back after 2 unanswered turns (720 min ago)',
)

check(
  '退让期过了照旧会说',
  judgeRouter(base({
    lastSpokenAt: NOW - 30 * HOUR,
    ignored: 2,
    usage: { today: [{ pkg: GAME, ms: 150 * 60 * 1000 }] },
  })).kind,
  'rest',
)

check(
  '退让期里不抽"随口问一句"',
  judgeRouter(base({ lastSpokenAt: NOW - 30 * HOUR, ignored: 2, random: () => 0.0 })).say,
  false,
)

check(
  '只有一次没人接时不退让 (冷却还是 30 分钟那一档)',
  judgeRouter(base({ lastSpokenAt: NOW - 12 * 60 * 1000, ignored: 1 })).why,
  'spoke 12 min ago',
)

check(
  '退让间隔可以由规则表改短 (改成 1 小时后, 2 小时前那一次就不再挡)',
  judgeRouter(base({
    lastSpokenAt: NOW - 2 * HOUR,
    ignored: 2,
    rules: { ignoredCooldownMs: 60 * 60 * 1000 },
    usage: { today: [{ pkg: GAME, ms: 150 * 60 * 1000 }] },
  })).say,
  true,
)

/* ── 七、探索交来的检测项与沉睡前观察 (2026-11-07 晚) ───────────────────── */

/*
 * 主人那一句是"检测的内容应由探索时加上" —— 于是判断层多一个候选来源 (`checks`), 而"什么时候唤醒"
 * 那一半仍在「更多设置」里。这一节钉住四件事: 命中/不命中、关掉的不判、今天提过的不提、分数顺序;
 * 外加沉睡前观察那一道 (他还在说话就先别插嘴)
 */

const usageGame = { today: [{ pkg: GAME, label: '王者荣耀', ms: 150 * 60 * 1000 }] }
const checkUsage = { id: 'c1', what: '打游戏太久', when: { kind: 'usage', minutes: 120 }, enabled: true }
const checkTime = { id: 'c2', what: '出门前问一句', when: { kind: 'time' }, at: '07:40', enabled: true }

check('没有 checks 时一切照旧', judgeRouter(base({ usage: usageGame })).kind, 'rest')

check(
  'usage 类到线就命中 (那条线由探索写)',
  judgeRouter(base({
    usage: usageGame,
    lastSpokenAt: NOW - 5 * HOUR,
    checks: [checkUsage],
    rules: { gameMinutes: 1000 },
  })).kind,
  'check',
)

check(
  'usage 类没到线不判',
  judgeRouter(base({
    usage: { today: [{ pkg: GAME, ms: 60 * 60 * 1000 }] },
    lastSpokenAt: NOW - 5 * HOUR,
    checks: [checkUsage],
  })).say,
  false,
)

check(
  'time 类到点之后命中',
  judgeRouter(base({ lastSpokenAt: NOW - 5 * HOUR, checks: [checkTime] })).kind,
  'check',
)

check(
  'time 类还没到点就不判 (at 是"几点之后")',
  judgeRouter(base({
    lastSpokenAt: NOW - 5 * HOUR,
    checks: [{ ...checkTime, at: '23:30' }],
  })).say,
  false,
)

check(
  '主人关掉的那一条不判',
  judgeRouter(base({
    lastSpokenAt: NOW - 5 * HOUR,
    checks: [{ ...checkTime, enabled: false }],
  })).say,
  false,
)

check(
  '今天已经提过的那一条不再提 (checksSaid 那笔账)',
  judgeRouter(base({
    lastSpokenAt: NOW - 5 * HOUR,
    checks: [checkTime],
    checksSaid: { c2: '2026-11-07' },
  })).say,
  false,
)

check(
  '未了的事与检测项同时成立时先说未了的事',
  judgeRouter(base({
    lastSpokenAt: NOW - 5 * HOUR,
    wishes: [{ id: 'cet4', what: '考四级', due: in37, said: [] }],
    checks: [checkTime],
  })).kind,
  'wish',
)

check(
  '他还在说话时先不开口 (沉睡前观察)',
  judgeRouter(base({ lastSpokenAt: NOW - 5 * HOUR, lastUserAt: NOW - 60 * 1000 })).why,
  'he is still talking',
)

check(
  '说完过了五分钟就照旧判 (预设置 5 分钟)',
  judgeRouter(base({
    lastSpokenAt: NOW - 5 * HOUR,
    lastUserAt: NOW - 6 * 60 * 1000,
    usage: usageGame,
  })).kind,
  'rest',
)

/* ── 八、第三种判法: 日历事件 (2026-11-10, 方案 D) ──────────────────────── */

/*
 * `event` 说的是"日历里的事件开始前 N 分钟", 于是它比前两种多一个输入 (日历) 与一条新语义:
 * **每一次发生一个键**. 这一节钉九件事: 命中 / 太远 / 已开始 / 全天 / 标题不匹配 / 读不到日历 /
 * 点名的日历 / `at` 下界 / 同一场不重复与次日能再说
 */

const AT_10 = new Date(2026, 10, 7, 10, 0, 0).getTime()
const MINUTE = 60 * 1000
const calendarOf = (events) => ({ available: true, why: '', at: AT_10, events })
const checkEvent = {
  id: 'c3',
  what: '出门前问一句带没带伞',
  when: { kind: 'event', beforeMinutes: 30, titleContains: '上班' },
  enabled: true,
}
const meeting = (minutesAhead, over = {}) => ({
  id: 'e1', calendarId: '7', title: '上班', startMs: AT_10 + minutesAhead * MINUTE, allDay: false, ...over,
})

const eventHit = judgeRouter(base({
  now: AT_10,
  calendar: calendarOf([meeting(12)]),
  checks: [checkEvent],
}))

check('事件 12 分钟后 + beforeMinutes 30 -> 命中', [eventHit.say, eventHit.kind], [true, 'check'])
check('那一句事实里带标题与还剩几分钟', eventHit.brief,
  '出门前问一句带没带伞 · 「上班」10:12 开始, 还有 12 分钟')
check('去重键是"当天@开始那一刻"', eventHit.key, `2026-11-07@${AT_10 + 12 * MINUTE}`)

check('事件 45 分钟后不判 (还没进窗口)', judgeRouter(base({
  now: AT_10, calendar: calendarOf([meeting(45)]), checks: [checkEvent],
})).say, false)

check('已经开始的事件不判', judgeRouter(base({
  now: AT_10, calendar: calendarOf([meeting(-2)]), checks: [checkEvent],
})).say, false)

check('全天事件不判 (那是 time 判法的事)', judgeRouter(base({
  now: AT_10, calendar: calendarOf([meeting(12, { allDay: true })]), checks: [checkEvent],
})).say, false)

check('标题不匹配不判', judgeRouter(base({
  now: AT_10, calendar: calendarOf([meeting(12, { title: '买菜' })]), checks: [checkEvent],
})).say, false)

check('读不到日历就不猜, 也不抛', judgeRouter(base({
  now: AT_10,
  calendar: { available: false, why: 'calendar access has not been granted', at: AT_10, events: [meeting(12)] },
  checks: [checkEvent],
})).say, false)

check('点名的日历不在名单里就不判', judgeRouter(base({
  now: AT_10,
  calendar: calendarOf([meeting(12, { calendarId: '9' })]),
  checks: [{ ...checkEvent, when: { ...checkEvent.when, calendarIds: ['7'] } }],
})).say, false)

check('`at` 那个下界对 event 也生效 (10:00 时 at=10:30 不判)', judgeRouter(base({
  now: AT_10, calendar: calendarOf([meeting(12)]), checks: [{ ...checkEvent, at: '10:30' }],
})).say, false)

check('同一场会第二次不重复说 (checksSaid 命中了那个键)', judgeRouter(base({
  now: AT_10,
  calendar: calendarOf([meeting(12)]),
  checks: [checkEvent],
  checksSaid: { c3: eventHit.key },
})).say, false)

check('同一场会下一天 (开始时刻变了) 的键也变了, 于是能再说', (() => {
  const tomorrow = AT_10 + 24 * HOUR
  const hit = judgeRouter(base({
    now: tomorrow,
    calendar: { available: true, why: '', at: tomorrow, events: [meeting(12, { startMs: tomorrow + 12 * MINUTE })] },
    checks: [checkEvent],
    checksSaid: { c3: eventHit.key },
  }))
  return [hit.say, hit.key]
})(), [true, `2026-11-08@${AT_10 + 24 * HOUR + 12 * MINUTE}`])

check('前两种判法的键还是"当天", 没有日历的那一条直接回 null', [
  routerCheckHit(checkUsage, base({ usage: usageGame }), NOW)?.key,
  routerCheckHit(checkTime, base({}), NOW)?.key,
  routerCheckHit(checkEvent, base({ now: AT_10 }), AT_10),
], ['2026-11-07', '2026-11-07', null])

/* ── 六、缺省与形状 ─────────────────────────────────────────────────────── */

check('缺省值表是冻结的', Object.isFrozen(ROUTER_DEFAULTS), true)
check('规则全空也能跑, 不抛', typeof judgeRouter({ now: NOW }).say, 'boolean')
check('日期账按本地时区算', routerDayKey(NOW), '2026-11-07')

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
