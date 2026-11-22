// test/luwi-ask.test.mjs — 终端问答中继的纯算术 (2026-11-22)
//
// 钉住五件事:
//   1. `ask` 段的缺省与边界 (四档模式 / 等待毫秒 / 终端提示)
//   2. 手机上那两行长什么样 (问题条目 / 回执条目), 以及 notify 档换的那一句回法
//   3. 手机回的那句话怎么折成上游认的答案批次 (序号 / 选项原文 / 自定义 / 多问)
//   4. `createAskRelay`: 答回来 / 超时按自定义回答 / 上游 abort / 卸载时不留定时器
//   5. `/sync ask` 的动作词 (中文正写, 英文别名)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ASK_MODES,
  AUTO_NOTICE,
  TERMINAL_BRIEF,
  askAnsweredText,
  askEntryText,
  autoAnswers,
  createAskRelay,
  parseAskReply,
  renderAskState,
  resolveAskSpec,
} from '../lib/luwi-ask.mjs'
import { ASK_ACTIONS, normalizeAskAction } from '../lib/command-words.mjs'

const QUESTIONS = [{
  id: 'scope',
  header: '范围',
  question: '这一版要不要一起改同步?',
  options: [
    { label: '只改门户 (Recommended)', description: '风险最小' },
    { label: '连同步一起改', description: '一次到位, 但要重跑全量' },
  ],
}]

const TWO = [
  { id: 'a', question: '第一问', options: [{ label: 'A1' }, { label: 'A2' }] },
  { id: 'b', question: '第二问', options: [{ label: 'B1' }, { label: 'B2' }] },
]

// ---------------------------------------------------------------------------
// 1 · ask 段
// ---------------------------------------------------------------------------

test('ask 段: 缺省是 relay / 120 s / 终端提示开', () => {
  assert.deepEqual(resolveAskSpec(undefined), { mode: 'relay', waitMs: 120000, brief: true })
  assert.deepEqual(resolveAskSpec({ mode: 'auto', waitMs: 5000, brief: false }), { mode: 'auto', waitMs: 5000, brief: false })
  // 只写一格时其余走缺省
  assert.deepEqual(resolveAskSpec({ mode: 'off' }), { mode: 'off', waitMs: 120000, brief: true })
  assert.deepEqual([...ASK_MODES], ['off', 'notify', 'relay', 'auto'])
})

test('ask 段: 形状不对 / 取值越界都响亮拒绝', () => {
  assert.throws(() => resolveAskSpec('relay'), /ask must be an object/u)
  assert.throws(() => resolveAskSpec({ mode: 'yes' }), /ask\.mode must be one of/u)
  assert.throws(() => resolveAskSpec({ waitMs: 100 }), /ask\.waitMs/u)
  assert.throws(() => resolveAskSpec({ waitMs: 1800001 }), /ask\.waitMs/u)
  assert.throws(() => resolveAskSpec({ waitMs: 1.5 }), /ask\.waitMs/u)
  assert.throws(() => resolveAskSpec({ brief: 'on' }), /ask\.brief/u)
})

// ---------------------------------------------------------------------------
// 2 · 手机上那两行
// ---------------------------------------------------------------------------

test('问题条目: 标题 / 序号 / 描述 / 回法都在, 剩余秒数是算出来的', () => {
  const at = 1_000_000
  const text = askEntryText({ questions: QUESTIONS, at, waitMs: 120000, mode: 'relay' }, at + 5000)
  assert.match(text, /电脑在等你回答/u)
  assert.match(text, /约 115 秒/u)
  assert.match(text, /【范围】/u)
  assert.match(text, /1\) 只改门户 \(Recommended\) — 风险最小/u)
  assert.match(text, /2\) 连同步一起改 — 一次到位/u)
  assert.match(text, /回法：直接回 1 \/ 2/u)
})

test('问题条目: 多问要点号并教它用分号; 没选项就说直接回一句', () => {
  const text = askEntryText({ questions: TWO, at: 0, waitMs: 0, mode: 'relay' }, 0)
  assert.match(text, /Q1\. 第一问/u)
  assert.match(text, /Q2\. 第二问/u)
  assert.match(text, /用分号隔开/u)

  const bare = askEntryText({ questions: [{ id: 'x', question: '叫什么名字?' }], at: 0, waitMs: 0, mode: 'relay' }, 0)
  assert.match(bare, /没有预设选项，直接回一句话/u)
})

test('问题条目: notify 档写明"只能在电脑上答"', () => {
  const text = askEntryText({ questions: QUESTIONS, at: 0, waitMs: 0, mode: 'notify' }, 0)
  assert.match(text, /只能在电脑上答/u)
  assert.match(text, /你在手机上回的任何字都当普通消息发过去/u)
})

test('问题条目: 可多选的题多一句提示', () => {
  const text = askEntryText({
    questions: [{ id: 'm', question: '要哪几件?', multiSelect: true, options: [{ label: 'a' }, { label: 'b' }] }],
    at: 0,
    waitMs: 0,
    mode: 'relay',
  }, 0)
  assert.match(text, /可多选/u)
})

test('回执条目: 选中的写出来, 多问带 Q 号, 空答案有一句兜底', () => {
  assert.equal(askAnsweredText({ questions: QUESTIONS }, { answers: [{ id: 'scope', selected: ['连同步一起改'] }] }), '（已按你在手机上的回答继续：连同步一起改）')
  assert.match(askAnsweredText({ questions: TWO }, { answers: [{ id: 'a', selected: ['A1'] }, { id: 'b', selected: [], custom: '我自己写的' }] }), /Q1 A1；Q2 我自己写的/u)
  assert.match(askAnsweredText({ questions: QUESTIONS }, { answers: [] }), /已按你在手机上的回答继续/u)
})

test('终端提示与自动回答的正文是定死的两句', () => {
  assert.match(TERMINAL_BRIEF, /手机终端发起的/u)
  assert.match(TERMINAL_BRIEF, /我替你定了/u)
  assert.match(AUTO_NOTICE, /按你的最佳判断继续/u)
  assert.match(AUTO_NOTICE, /我替你定了/u)
})

// ---------------------------------------------------------------------------
// 3 · 回答解析
// ---------------------------------------------------------------------------

test('回 1 / 2 就是选中那一项 (多选与越界各有说法)', () => {
  assert.deepEqual(parseAskReply(QUESTIONS, '2').answers, [{ id: 'scope', selected: ['连同步一起改'] }])
  assert.deepEqual(parseAskReply(QUESTIONS, ' 1 ').answers[0].selected, ['只改门户 (Recommended)'])
  // 单选的题回了两个号: 只取第一个, 原文留在 custom 里 (话不吞)
  assert.deepEqual(parseAskReply(QUESTIONS, '1,2').answers[0], { id: 'scope', selected: ['只改门户 (Recommended)'], custom: '1,2' })
  // 越界的号: 不是答案, 整句当自定义回答
  assert.deepEqual(parseAskReply(QUESTIONS, '9').answers[0], { id: 'scope', selected: [], custom: '9' })
})

test('多选的题回 1,2 就两个都选中', () => {
  const multi = [{ id: 'm', question: '要哪几件?', multiSelect: true, options: [{ label: '甲' }, { label: '乙' }, { label: '丙' }] }]
  assert.deepEqual(parseAskReply(multi, '1,3').answers[0], { id: 'm', selected: ['甲', '丙'] })
  assert.deepEqual(parseAskReply(multi, '1、2').answers[0].selected, ['甲', '乙'])
})

test('回选项原文 (忽略大小写与空白) 也算选中', () => {
  const questions = [{ id: 'e', question: '哪台?', options: [{ label: 'Phone' }, { label: 'PC' }] }]
  assert.deepEqual(parseAskReply(questions, ' pc ').answers[0].selected, ['PC'])
})

test('其它任何文字都是自定义回答; 没有选项的题一律自定义', () => {
  assert.deepEqual(parseAskReply(QUESTIONS, '先别发版').answers[0], { id: 'scope', selected: [], custom: '先别发版' })
  assert.deepEqual(parseAskReply([{ id: 'x', question: '叫它什么?' }], '小鲸鱼').answers[0], { id: 'x', selected: [], custom: '小鲸鱼' })
})

test('多问: 分号 / 换行分开逐条套; 条数对不上就整串当每一问的自定义回答', () => {
  assert.deepEqual(parseAskReply(TWO, '1;2').answers, [
    { id: 'a', selected: ['A1'] },
    { id: 'b', selected: ['B2'] },
  ])
  assert.deepEqual(parseAskReply(TWO, '1\n1').answers.map(item => item.selected), [['A1'], ['B1']])
  const mismatch = parseAskReply(TWO, '一起做吧')
  assert.deepEqual(mismatch.answers.map(item => item.custom), ['一起做吧', '一起做吧'])
})

test('空回复不是答案 (那一句按普通消息走, 不消耗问题)', () => {
  assert.equal(parseAskReply(QUESTIONS, '   ').ok, false)
  assert.equal(parseAskReply(QUESTIONS, '').reason, 'the reply was empty')
  assert.equal(parseAskReply([], '1').ok, false)
})

test('autoAnswers 每个问题一项, 正文是那一句定死的自定义回答', () => {
  const batch = autoAnswers(TWO)
  assert.equal(batch.answers.length, 2)
  assert.deepEqual(batch.answers.map(item => item.custom), [AUTO_NOTICE, AUTO_NOTICE])
  assert.deepEqual(batch.answers.map(item => item.selected), [[], []])
  assert.match(autoAnswers(TWO, '别问了').answers[0].custom, /别问了/u)
})

// ---------------------------------------------------------------------------
// 4 · 中继那一摊状态
// ---------------------------------------------------------------------------

test('createAskRelay: 手机答回来就 resolve, 板上留两行 (问题 + 回执)', async () => {
  const relay = createAskRelay({ mode: 'relay', waitMs: 120000, brief: true }, { now: () => 1000, log: () => {} })
  const ask = relay.publish('s1', QUESTIONS, { callId: 'call_1', seq: 42 })
  const pending = relay.wait(ask, undefined)
  assert.equal(relay.askedAt('s1'), 1000)
  assert.equal(relay.openCount(), 1)

  const outcome = relay.answer('s1', '2')
  assert.deepEqual(outcome, { answered: 'call_1' })
  const answer = await pending
  assert.deepEqual(answer.answers, [{ id: 'scope', selected: ['连同步一起改'] }])
  assert.equal(relay.counters.answered, 1)
  assert.equal(relay.openCount(), 0)

  const entries = relay.extraEntries('s1', 1000)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].seq, 42)
  assert.equal(entries[1].seq, 42.5)
  assert.match(entries[0].text, /电脑在等你回答/u)
  assert.match(entries[1].text, /连同步一起改/u)
  relay.dispose()
})

test('createAskRelay: 没人在手机上答, 到点按自定义回答继续', async () => {
  const relay = createAskRelay({ mode: 'relay', waitMs: 5, brief: true }, { now: () => 1000, log: () => {} })
  const ask = relay.publish('s2', QUESTIONS, { callId: 'call_2', seq: 7 })
  const answer = await relay.wait(ask, undefined)
  assert.equal(answer.answers[0].custom, AUTO_NOTICE)
  assert.deepEqual(answer.answers[0].selected, [])
  assert.equal(relay.counters.expired, 1)
  relay.dispose()
})

test('createAskRelay: 上游取消按 ASK_ABORTED 收, 那一行也从板上摘掉', async () => {
  const relay = createAskRelay({ mode: 'relay', waitMs: 120000, brief: true }, { now: () => 1000, log: () => {} })
  const ask = relay.publish('s3', QUESTIONS, { callId: 'call_3', seq: 9 })
  const controller = new AbortController()
  const pending = relay.wait(ask, controller.signal)
  controller.abort()
  await assert.rejects(pending, (error) => error.code === 'ASK_ABORTED')
  assert.equal(relay.counters.cancelled, 1)
  assert.deepEqual(relay.extraEntries('s3', 1000), [])
  relay.dispose()
})

test('createAskRelay: 同一场又来一件时旧的按取消收掉; notify 那一件可以单独摘', async () => {
  const relay = createAskRelay({ mode: 'relay', waitMs: 120000, brief: true }, { now: () => 1000, log: () => {} })
  const first = relay.publish('s4', QUESTIONS, { callId: 'c1', seq: 1 })
  const pending = relay.wait(first, undefined)
  const second = relay.publish('s4', QUESTIONS, { callId: 'c2', seq: 2 })
  await assert.rejects(pending, (error) => error.code === 'ASK_ABORTED')
  assert.equal(relay.pendingFor('s4'), second)

  relay.drop('s4')
  assert.equal(relay.pendingFor('s4'), null)
  assert.deepEqual(relay.extraEntries('s4', 1000), [])
  relay.dispose()
})

test('createAskRelay: 卸载时挂在板上的那件按取消收掉 (不留下永不结算的等待)', async () => {
  const relay = createAskRelay({ mode: 'relay', waitMs: 120000, brief: true }, { now: () => 1000, log: () => {} })
  const ask = relay.publish('s5', QUESTIONS, { callId: 'c5', seq: 5 })
  const pending = relay.wait(ask, undefined)
  relay.dispose()
  await assert.rejects(pending, (error) => error.code === 'ASK_ABORTED')
  assert.equal(relay.answer('s5', '1'), null)
})

test('createAskRelay: 答不出来的那一句不吃掉问题 (回 null 或 ok:false)', () => {
  const relay = createAskRelay({ mode: 'relay', waitMs: 120000, brief: true }, { now: () => 1000, log: () => {} })
  assert.equal(relay.answer('nothing', '1'), null)
  const ask = relay.publish('s6', QUESTIONS, { callId: 'c6', seq: 6 })
  const pending = relay.wait(ask, undefined)
  const rejected = relay.answer('s6', '   ')
  assert.equal(rejected.ok, false)
  assert.match(rejected.note, /was not an answer/u)
  assert.equal(relay.pendingFor('s6'), ask, '空回复不当答案, 问题还在等')
  relay.answer('s6', '1')
  return pending
})

// ---------------------------------------------------------------------------
// 5 · /sync ask 的读数与动作词
// ---------------------------------------------------------------------------

test('读数行: 模式 / 等多久 / 提示 / 计数 / 此刻在等谁', () => {
  const text = renderAskState({ mode: 'relay', waitMs: 120000, brief: true }, { pending: 1, answered: 3, expired: 1, lastSessionId: 'abcdefgh12345678' })
  assert.match(text, /问答: relay · 等 120s · 终端提示 开/u)
  assert.match(text, /计数: 答回 3 · 超时 1 · 此刻在等 1/u)
  assert.match(text, /在等: 12345678/u)
  assert.match(renderAskState({ mode: 'off', waitMs: 5000, brief: false }, { pending: 0, answered: 0, expired: 0 }), /在等: 没有/u)
  assert.match(renderAskState(null, {}), /问答: off/u)
})

test('动作词: 中文是正写, 英文留作别名, 认不出的原样交回', () => {
  assert.deepEqual(
    ['', '状态', '读数', '关', '关闭', '提示', '通知', '中继', '转发', '自动', '自定义']
      .map(value => normalizeAskAction(value)),
    ['state', 'state', 'state', 'off', 'off', 'notify', 'notify', 'relay', 'relay', 'auto', 'auto'],
  )
  assert.deepEqual(
    ['state', 'off', 'notify', 'relay', 'auto'].map(value => normalizeAskAction(value)),
    ['state', 'off', 'notify', 'relay', 'auto'],
  )
  assert.equal(normalizeAskAction('乱写'), '乱写')
  assert.equal(normalizeAskAction(undefined), 'state')
  assert.deepEqual([...ASK_ACTIONS], ['state', 'off', 'notify', 'relay', 'auto'])
})
