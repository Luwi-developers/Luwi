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
const { judgeRouter, routerInsideQuiet, routerDayKey, ROUTER_DEFAULTS } = new Function(
  `${host.slice(at, end)}\nreturn { judgeRouter, routerInsideQuiet, routerDayKey, ROUTER_DEFAULTS }`,
)()

/* ── 一个固定的"现在": 2026-11-07 21:40 ─────────────────────────────────── */

const NOW = new Date(2026, 10, 7, 21, 40, 0).getTime()
const HOUR = 60 * 60 * 1000
const GAME = 'com.tencent.tmgp.sgame'

/** 一个什么都不触发的底座 */
function base(over = {}) {
  return {
    now: NOW,
    quiet: { enabled: true, from: '23:00', to: '07:00' },
    lastSpokenAt: NOW - 5 * HOUR,
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

/* ── 六、缺省与形状 ─────────────────────────────────────────────────────── */

check('缺省值表是冻结的', Object.isFrozen(ROUTER_DEFAULTS), true)
check('规则全空也能跑, 不抛', typeof judgeRouter({ now: NOW }).say, 'boolean')
check('日期账按本地时区算', routerDayKey(NOW), '2026-11-07')

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
