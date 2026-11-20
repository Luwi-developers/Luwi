/**
 * 情感状态 / 共情策略 / 记忆召回 / 硬边界 的判据 (2026-11-20)
 *
 * 方案 `docs/Luwi-活动板块情感化-主动对话方案-2026-11-20.md` §11.1 那七节, 一条不少:
 *
 *   一  `affectStep` 六种事件各走一次, 三个维度都不越出范围
 *   二  半天不动往基线回一半, 一天不动回四分之三 (衰减是连续的, 不是跳变)
 *   三  `empathyPlanOf` 打出 §7.2 那张真值表五行
 *   四  五格越界夹取 (`baseline` 写 9 回 2, 写 -3 回 0, 缺键回 1)
 *   五  `affectMoodLines` 三句在五个档位上逐字对上 (§9.5 的数组, 27 组全表)
 *   六  召回预算: 最多几条 / ≤600 字; 一条都没有时整段不出现 (不许留空标题)
 *   七  `hard` 边界命中即拒发 (夹具跑纯函数 + 钉 `lw_say` 那道闸确实接上了)
 *
 * 另外钉住接线: `index.mjs` 真的 import 了这个模块, 五个落点 (人格 / 开场 / 记忆工具 / 硬闸 /
 * 每轮快照) 都在 —— 纯函数全绿而宿主没接上, 设备上一样是没做
 *
 * 跑法: `node tools/check-emotion.mjs` (不碰设备, 不碰 host)
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as emotion from '../host-plugin/emotion/state.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const host = readFileSync(join(root, 'host-plugin', 'index.mjs'), 'utf8')

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

const NOW = new Date(2026, 10, 20, 22, 13, 0).getTime()
const HOUR = 60 * 60 * 1000

/* ── 一、affectStep: 六种事件各一次, 三个维度都在范围里 ─────────────────── */

const BASE = { ...emotion.AFFECT_BASELINE, at: NOW }
const KINDS = ['talked_to_her', 'replied_her', 'ignored_her', 'snapped_at_her', 'late_night', 'long_game']
for (const kind of KINDS) {
  const next = emotion.affectStep(BASE, { kind, at: NOW, now: NOW })
  check(`事件 ${kind}: 落在范围内`, [
    next.valence >= -2 && next.valence <= 2,
    next.arousal >= 0 && next.arousal <= 3,
    next.engagement >= 0 && next.engagement <= 3,
    next.at,
  ], [true, true, true, NOW])
}
{
  // 增量方向: 被骂降 valence 升 arousal / 没接降 valence / 他先开口升两项
  const snapped = emotion.affectStep(BASE, { kind: 'snapped_at_her', at: NOW, now: NOW })
  check('被骂: valence 降 2, arousal 升 1', [snapped.valence, snapped.arousal], [-1, 2])
  const ignored = emotion.affectStep(BASE, { kind: 'ignored_her', at: NOW, now: NOW })
  check('没接: valence 降 1, 其余不动', [ignored.valence, ignored.arousal, ignored.engagement], [0, 1, 1])
  const talked = emotion.affectStep(BASE, { kind: 'talked_to_her', at: NOW, now: NOW })
  check('他先开口: valence 与 engagement 各升 1', [talked.valence, talked.engagement], [2, 2])
  // 认不出的 kind 一个数都不改 (§5.3: 只列有把握的几种)
  const unknown = emotion.affectStep(BASE, { kind: 'made-up', at: NOW, now: NOW })
  check('认不出的 kind 不改任何维度', unknown, BASE)
  // 夹取: 连撞三次也只到上界
  let hot = BASE
  for (let index = 0; index < 5; index += 1) hot = emotion.affectStep(hot, { kind: 'snapped_at_her', at: NOW, now: NOW })
  check('反复被骂也只到 l-2 下界', hot.valence, -2)
}

/* ── 二、衰减: 半天回一半, 一天回四分之三 ───────────────────────────────── */

{
  const cold = { valence: -2, arousal: 3, engagement: 0, at: NOW }
  const half = emotion.decayTowards(cold, NOW, NOW + 12 * HOUR)
  // 基线 1: 12 h 后 = 1 + (-2 - 1) * 0.5 = -0.5
  check('半天: valence 回一半 (-2 -> -0.5)', Math.round(half.valence * 100) / 100, -0.5)
  const day = emotion.decayTowards(cold, NOW, NOW + 24 * HOUR)
  check('一天: valence 回四分之三 (-2 -> 0.25)', Math.round(day.valence * 100) / 100, 0.25)
  check('衰减是连续的: 中间那一格夹在两头之间', (() => {
    const six = emotion.decayTowards(cold, NOW, NOW + 6 * HOUR).valence
    return [six > -2 && six < -0.5, Math.round(six * 100) / 100]
  })(), [true, -1.12])
  check('arousal 与 engagement 也往基线回', [
    emotion.decayTowards(cold, NOW, NOW + 24 * HOUR).arousal,
    emotion.decayTowards(cold, NOW, NOW + 24 * HOUR).engagement,
  ], [1.5, 0.75])
  check('没有时间戳 / 时间没往前走: 原样 (不再衰减)', [
    emotion.decayTowards(cold, 0, 0).valence,
    emotion.decayTowards(cold, NOW, NOW).valence,
  ], [-2, -2])
  check('坏输入不抛: null / 字符串都按基线走', [
    emotion.decayTowards(null, NOW, NOW + 12 * HOUR).valence,
    emotion.decayTowards('nope', NOW, NOW + 12 * HOUR).arousal,
  ], [1, 1])
}

/* ── 三、empathyPlanOf: §7.2 那张真值表五行 ─────────────────────────────── */

{
  const plan = (affect, relation, moment) => {
    const one = emotion.empathyPlanOf(affect, relation, moment)
    return [one.lead, one.avoid]
  }
  check('深夜 + 情绪低 -> companion / advise', plan({ valence: -1 }, { ignored: 0, closeness: 0.2 }, { phase: 'late' }), ['companion', 'advise'])
  check('白天 + 情绪低 -> validate / distract', plan({ valence: -1 }, { ignored: 0, closeness: 0.2 }, { phase: 'day' }), ['validate', 'distract'])
  check('连着两次没接 -> space / advise', plan({ valence: 1 }, { ignored: 2, closeness: 0.8 }, { phase: 'day' }), ['space', 'advise'])
  check('正在打游戏 -> distract / validate', plan({ valence: 1 }, { ignored: 0, closeness: 0.2 }, { phase: 'day', busy: true }), ['distract', 'validate'])
  check('平常 -> companion / advise', plan({ valence: 1 }, { ignored: 0, closeness: 0.2 }, { phase: 'day' }), ['companion', 'advise'])
  check('预算: 留白 1 条 / 平常 2 条', [
    emotion.empathyPlanOf({ valence: 1 }, { ignored: 3 }, {}).budget,
    emotion.empathyPlanOf({ valence: 1 }, { ignored: 0 }, {}).budget,
  ], [1, 2])
}
{
  // 「先陪还是先给办法」那一格 (方案 §9.2): 只改缺省那一档
  const base = emotion.empathyPlanOf({ valence: 1 }, { ignored: 0, closeness: 0.2 }, {})
  check('empathy=0: 缺省仍是先陪', emotion.applyEmpathySetting(base, 0).lead, 'companion')
  check('empathy=2: 缺省那一档改成先给办法', [
    emotion.applyEmpathySetting(base, 2).lead,
    emotion.applyEmpathySetting(base, 2).avoid,
  ], ['advise', 'distract'])
  const low = emotion.empathyPlanOf({ valence: -1 }, { ignored: 0 }, { phase: 'day' })
  check('empathy=2 不盖掉"他今天低落"那一条', emotion.applyEmpathySetting(low, 2).lead, 'validate')
  check('empathy 是坏值时按 1 (看情况)', emotion.applyEmpathySetting(base, 'x').lead, 'companion')
}

/* ── 四、五格越界夹取 ───────────────────────────────────────────────────── */

check('baseline 写 9 回 2', emotion.affectSettingsOf({ baseline: 9 }).baseline, 2)
check('baseline 写 -3 回 0', emotion.affectSettingsOf({ baseline: -3 }).baseline, 0)
check('缺键回缺省 (1 / 0 / 1 / 2 / 1)', emotion.affectSettingsOf({}), {
  baseline: 1, empathy: 0, boundary: 1, recall: 2, honesty: 1,
})
check('坏值当缺键, 小数四舍五入, 字符串数字认', [
  emotion.affectSettingsOf({ baseline: '很久' }).baseline,
  emotion.affectSettingsOf({ recall: 2.6 }).recall,
  emotion.affectSettingsOf({ honesty: '2' }).honesty,
], [1, 3, 2])
check('不算对象时五个都是缺省', emotion.affectSettingsOf(null), {
  baseline: 1, empathy: 0, boundary: 1, recall: 2, honesty: 1,
})
check('召回预算 0 / 2 / 4 / 6 条', [
  emotion.recallRowsOf(0), emotion.recallRowsOf(1), emotion.recallRowsOf(2), emotion.recallRowsOf(3),
], [0, 2, 4, 6])

/* ── 五、五格 → 三句: 27 组全表逐字对上 (§9.5 的数组) ────────────────────── */

{
  const BASES = [
    '你平时的温度是冷静: 不说多余的话',
    '你平时的温度是温和: 不冷, 也不过分热络',
    '你平时的温度是偏暖: 说话会带一点软',
  ]
  const LEADS = [
    '缺省先陪着他, 少给办法',
    '看情况: 他问才给办法',
    '缺省先给办法, 再补一句人话',
  ]
  const EDGES = [
    ['他没有回应也不追', '他说不想聊就收住'],
    ['他没有回应就不发第二条', '他说不想聊就收住', '不替他做决定'],
    ['他没有回应就不发第二条', '他说不想聊就收住', '不替他做决定', '不猜他的心思'],
  ]
  let mismatched = []
  for (let baseline = 0; baseline <= 2; baseline += 1) {
    for (let empathy = 0; empathy <= 2; empathy += 1) {
      for (let boundary = 0; boundary <= 2; boundary += 1) {
        const lines = emotion.affectMoodLines({ baseline, empathy, boundary })
        const want = { base: BASES[baseline], lead: LEADS[empathy], edge: EDGES[boundary] }
        if (JSON.stringify(lines) !== JSON.stringify(want)) mismatched.push({ baseline, empathy, boundary, lines })
      }
    }
  }
  check('27 组 (基调 3 x 先陪 3 x 边界 3) 逐字对上', mismatched, [])
  check('边界严格度: 松 2 条 / 正常 3 条 / 严 4 条', [0, 1, 2].map((one) => emotion.affectMoodLines({ boundary: one }).edge.length), [2, 3, 4])
  check('越界档位夹回两头', [
    emotion.affectMoodLines({ baseline: 9 }).base,
    emotion.affectMoodLines({ baseline: -9 }).base,
    emotion.affectMoodLines({ empathy: 9 }).lead,
  ], [BASES[2], BASES[0], LEADS[2]])
}

/* ── 六、召回预算: 条数 / 字数 / 空段不出现 ──────────────────────────────── */

{
  const rows = Array.from({ length: 9 }, (_, index) => ({
    id: `e${index}`,
    at: NOW - index * 24 * HOUR,
    what: `第 ${index + 1} 件小事说给他听过`,
    open: index % 3 === 0,
    valence: index % 2 === 0 ? 1 : 0,
  }))
  const five = emotion.relatedEpisodesFor(rows, '', NOW)
  check('默认最多 5 条', five.rows.length, 5)
  check('整段不超过 600 字', five.chars <= 600, true)
  check('按打分从高到低 (未了的 + 一起开心过的先想起来)', five.rows[0].id, 'e0')
  const two = emotion.relatedEpisodesFor(rows, '', NOW, { ...emotion.EPISODE_BUDGET, rows: 2 })
  check('预算给 2 条就只有 2 条', two.rows.length, 2)
  const zero = emotion.relatedEpisodesFor(rows, '', NOW, { ...emotion.EPISODE_BUDGET, rows: 0 })
  check('预算 0 条时一条都不给', [zero.rows.length, emotion.episodeBlock(zero.rows)], [0, ''])
  check('一条都没有时整段不出现 (不许留空标题)', [
    emotion.episodeBlock([]),
    emotion.episodeBlock(null),
    emotion.episodeBlock([{ what: '   ' }]),
  ], ['', '', ''])
  const block = emotion.episodeBlock(rows.slice(0, 2))
  check('有内容时: 头一行是那段固定话 + 每行带日期与原话', [
    block.split('\n')[0],
    block.includes('「第 1 件小事说给他听过」'),
    block.includes('说过了') || block.includes('未了'),
    block.includes('说的时候用他的原话'),
  ], ['〔记着的几件事〕', true, true, true])
  // 词重叠: 同一件事用他的话提才搜得到 (旧事只要对得上词, 也能压过今天那件不相干的)
  const A = { id: 'a', at: NOW, what: '量子力学', open: false, valence: 0 }
  const B = { id: 'b', at: NOW - 60 * 24 * HOUR, what: '他说想换一把键盘', open: false, valence: 0 }
  check('给线索时按词重叠排 (对上词的那件排第一)', emotion.relatedEpisodesFor([A, B], '键盘', NOW).rows[0].id, 'b')
  check('线索对不上时按时间/未了排 (召回不是过滤)', (() => {
    const fresh = emotion.relatedEpisodesFor([A, B], '量子力学', NOW)
    return [fresh.rows[0].id, fresh.rows.length]
  })(), ['a', 2])
  check('一条都不给时整段仍是空串', emotion.affectBlockOf({ episodes: [] }), '')
  // 单行按 rowChars 记字数: 超长原话不会把整段预算一次吃光
  const long = emotion.relatedEpisodesFor([{ id: 'x', at: NOW, what: 'x'.repeat(400) }], '', NOW, { rows: 1, chars: 600, rowChars: 120 })
  check('单行按 rowChars 记字数', long.chars <= 120, true)
}

/* ── 七、hard 边界: 命中即拒 ────────────────────────────────────────────── */

{
  const items = [
    { id: 'b1', what: '别提我前女友', hard: true },
    { id: 'b2', what: '别劝我早睡', hard: false },
  ]
  check('hard 条目命中', emotion.hardBoundaryHit('对了, 你前女友别提我前女友这事…', items)?.id, 'b1')
  check('soft 条目不硬拦', emotion.hardBoundaryHit('早点睡吧, 别劝我早睡', items), null)
  check('空文本 / 空表都不命中', [emotion.hardBoundaryHit('', items), emotion.hardBoundaryHit('随便说', [])], [null, null])
  check('软边界那一段只收 soft', emotion.softBoundaryBlock(items), [
    '〔他划过的线〕',
    '- 别劝我早睡',
    '这些别提, 也别绕着问.',
  ].join('\n'))
}

/* ── 八、接线: 纯函数绿了, 宿主也得真接上 ─────────────────────────────── */

check('index.mjs import 了 emotion/state.mjs', /import \* as emotion from '\.\/emotion\/state\.mjs'/u.test(host), true)
check('人格卡认主动档 (方案 §4.1)', [
  /const PERSONA_PRESETS = new Set\(\['luwi', 'proactive'\]\)/u.test(host),
  /PERSONA_PRESETS\.has\(preset\)/u.test(host),
  /function personaForPreset\(preset, full, core\)/u.test(host),
  /function personaCoreOf\(card\)/u.test(host),
], [true, true, true, true])
check('开场正文接第 5 个可选参 (方案 §7.3)', [
  /function proactiveStartLine\(text, summaryPath, acting, snapshot, memory\)/u.test(host),
  /\.\.\.\(mood === '' \? \[\] : \[mood\]\)/u.test(host),
  /proactiveStartLine\(options\?\.text, summaryPath, acting, snapshot, mood\?\.block \?\? ''\)/u.test(host),
], [true, true, true])
check('第 5 参为空时开场正文逐字不变 (2 / 3 / 4 参回归)', (() => {
  const source = host.slice(
    host.indexOf('function proactiveStartLine('),
    host.indexOf('/** 那份状态文件在哪: `$DSH_HOME/lw/proactive.json`'),
  )
  const run = new Function(
    'PROACTIVE_ASK_DEFAULT', 'PROACTIVE_ACTING_TIERS', 'PROACTIVE_ACTING_DEFAULT', 'PROACTIVE_ACTING_FULL',
    'PROACTIVE_ACTING_ACT', 'PROACTIVE_START_MARK', 'PROACTIVE_START_VOICE',
    `${source}\nreturn proactiveStartLine`,
  )(
    '缺省那句', new Set(['remind', 'act', 'full']), 'remind', 'full', 'act',
    '主动开场', '语气那一段',
  )
  const two = run('看看今天', '/x/a.md')
  const three = run('看看今天', '/x/a.md', 'act')
  const four = run('看看今天', '/x/a.md', 'act', '〔快照〕')
  const fiveEmpty = run('看看今天', '/x/a.md', 'act', '〔快照〕', '')
  const fiveBlank = run('看看今天', '/x/a.md', 'act', '〔快照〕', '   ')
  const fiveFilled = run('看看今天', '/x/a.md', 'act', '〔快照〕', '〔此刻〕他在忙')
  return [
    two.includes('〔快照〕'),
    three.includes('〔快照〕'),
    four.includes('〔快照〕'),
    fiveEmpty === four && fiveBlank === four,
    fiveFilled.includes('〔此刻〕他在忙'),
    fiveFilled.indexOf('〔此刻〕他在忙') > fiveFilled.indexOf('保持沉默')
      && fiveFilled.indexOf('〔此刻〕他在忙') < fiveFilled.indexOf('语气那一段'),
  ]
})(), [false, false, true, true, true, true])
check('每轮开始算一次状态 (方案 §5.5)', [
  /function startAffectSnapshot\(ctx\)/u.test(host),
  /startAffectSnapshot\(ctx\)/u.test(host),
  /void affectSnapshotNow\(\{ now \}\)/u.test(host),
], [true, true, true])
check('对话场那份〔此刻〕由 personaFor 拼在卡后面', [
  /function readAffectBlock\(\)/u.test(host),
  /return state === '' \? full : `\$\{full\}\\n\\n\$\{state\}`/u.test(host),
], [true, true])
check('记忆工具 lw_memory 在工具表里 (add / list / profile / forget / boundary / mute / status)', [
  /name: 'lw_memory'/u.test(host),
  ['add', 'list', 'profile', 'forget', 'boundary', 'mute', 'status'].every((op) => host.includes(`op has to be add, list, profile, forget, boundary, mute or status`)),
  /PROFILE_KEYS = Object\.freeze\(\['call', 'sleep', 'work', 'taboo', 'comfort', 'like', 'dislike', 'note'\]\)/u.test(host),
], [true, true, true])
check('lw_memory 补进了主动场 B 表 (读放行, 写归写动)', /'lw_memory', new Set\(\['list', 'status'\]\)/u.test(host), true)
check('lw_say 接上了硬边界闸', [
  /const drawn = await readBoundaries\(\)/u.test(host),
  /emotion\.hardBoundaryHit\(one, drawn\)/u.test(host),
  /not said: 他划过这条线/u.test(host),
], [true, true, true])
check('宿主把状态读数打进日志 (方案 §14.2)', /luwi-channel: affect: v=/u.test(host), true)
check('透明引用: 唤醒那一行带 memoryRef, 门户透成 data-ref', [
  /memoryRef: mood\.memoryRef/u.test(host),
  readFileSync(join(root, 'presets', 'luwi-portal', 'lib', 'client.js'), 'utf8').includes("row.setAttribute('data-ref', item.meta.memoryRef)"),
], [true, true])
check('人格卡里有「二之二」那一节 (方案 §4.2)', (() => {
  const card = readFileSync(join(root, 'presets', 'luwi', 'persona', 'xiaojingyu.md'), 'utf8')
  return [
    card.includes('## 二之二'),
    card.includes('慢热但稳'),
    card.includes('不猜隐私'),
    card.includes('不替他做决定'),
    card.includes('一个住在手机里、话不多、会记事、不催人的伴'),
  ]
})(), [true, true, true, true, true])
check('主动场预设引用了同一张人格卡 (方案 §10 #15)', (() => {
  const preset = readFileSync(join(root, 'presets', 'proactive', 'cordis.patch.yml'), 'utf8')
  return [preset.includes('{{lw_persona}}'), preset.includes('与对话场同一张人格卡')]
})(), [true, true])

if (failures > 0) {
  console.error(`check-emotion: FAIL (${failures}/${checks})`)
  process.exit(1)
}
console.log(`check-emotion: PASS (${checks})`)
