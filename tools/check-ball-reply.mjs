/**
 * 「推给球的那一句」的判据表 (2.8.0 球是门户)
 *
 * 主人 2026-11-07 报的那条: "ball 不再是只要有回复就发送, 否则会把思考内容给发出去"。
 * 这一份钉住两件事, 都不需要设备:
 *
 *   1. **挑句**: `stripThinking` 把过程叙述 / 工具流水 / 标题 / 代码块去掉, 只留最后那句结论,
 *      超长按句末截断 —— 真值表逐条跑
 *   2. **接线**: `startReadAloud` 里真的调了 `ballReplyPolicy`, 并且推给球与念出来用的都是
 *      `policy.text` —— 只留函数不接线, 就是"能挑但没人挑"那个形态
 *
 * 跑法: `node tools/check-ball-reply.mjs`
 * 它**直接取 `host-plugin/index.mjs` 里那一段源码来跑** (不复制第二份), 所以测的是上线那一份
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

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

/* ── 抽那一段纯函数 ─────────────────────────────────────────────────────── */

const at = host.indexOf('const BALL_REPLY_MAX')
if (at < 0) {
  console.error('FAIL the reply policy is not in host-plugin/index.mjs any more')
  process.exit(1)
}
const end = host.indexOf('function padClipFor', at)
if (end < 0) {
  console.error('FAIL could not find the end of the reply policy block')
  process.exit(1)
}
const block = host.slice(at, end)
const { stripThinking, ballReplyPolicy, BALL_REPLY_MAX } = new Function(
  `${block}\nreturn { stripThinking, ballReplyPolicy, BALL_REPLY_MAX }`,
)()

/* ── 一、挑句 ───────────────────────────────────────────────────────────── */

check('一句正常的中文原样留下', stripThinking('今天的日历上只有一件事。'), '今天的日历上只有一件事。')

check(
  '带「思考」那一段的只留结论',
  stripThinking(['思考：先看看通知列表，再决定要不要说。', '你有一条快递到了，晚上八点前来取。'].join('\n\n')),
  '你有一条快递到了，晚上八点前来取。',
)

check(
  '过程叙述的句子被丢掉',
  stripThinking('我先看一下通知列表再确认。你昨天说的那件事，今天可以做了。'),
  '你昨天说的那件事，今天可以做了。',
)

check(
  '短的过程句仍然是人话, 留下',
  stripThinking('我先记一下。明天九点有个会。'),
  '我先记一下。明天九点有个会。',
)

check('全是代码块 -> 空', stripThinking('```\nls -la\n```'), '')

check(
  '标题与表格都不算话',
  stripThinking(['## 结论', '| 项目 | 值 |', '| --- | --- |'].join('\n\n')),
  '',
)

check('空串 -> 空', stripThinking(''), '')
check('纯空白 -> 空', stripThinking('   \n\n  \t'), '')

const long = '这是一句很长的话。'.repeat(60)
const cut = stripThinking(long)
check('超长的截到上限以内', cut.length <= BALL_REPLY_MAX, true)
check('截断落在句末标点上', /[。！？.]$/u.test(cut), true)

const tail = stripThinking(['前面说了一堆背景。', '结论是今晚早点睡。'].join('\n\n'))
check('结论在最后一段时取最后一段', tail, '结论是今晚早点睡。')

/* ── 二、来源那一道 ─────────────────────────────────────────────────────── */

check(
  '探索场不推球',
  ballReplyPolicy({ id: 's1', meta: { agentPreset: 'explore' } }, '今天看到的东西很多。').speak,
  false,
)

check(
  '普通一场照旧推',
  ballReplyPolicy({ id: 's2', meta: {} }, '明天九点有个会。'),
  { speak: true, text: '明天九点有个会。', why: 'ok' },
)

check(
  '主动场照旧推 (那一场就是要说给主人听)',
  ballReplyPolicy({ id: 's3', meta: { agentPreset: 'proactive' } }, '歇一会儿吧。').speak,
  true,
)

check(
  '挑空了就整轮不推',
  ballReplyPolicy({ id: 's4', meta: {} }, '```\ncode\n```').speak,
  false,
)

/* ── 三、接线 ───────────────────────────────────────────────────────────── */

check('startReadAloud 里调了 ballReplyPolicy', host.includes('ballReplyPolicy(session, spoken)'), true)
check('推给球用的是 policy.text', host.includes('reportReply(replyChannelText(speakable), session.id)'), true)
check('念出来用的也是 policy.text', host.includes("call('speak', { op: 'speak', text: speakable })"), true)
check('挑空了就不念', host.includes('if (policy.speak !== true) {'), true)
check(
  '老的「无条件推」那一条已经不在了',
  host.includes('reportReply(replyChannelText(spoken), session.id)'),
  false,
)

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
