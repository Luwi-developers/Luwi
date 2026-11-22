// test/luwi-live.test.mjs — Luwi 加 (G1-2 进行中的回答) 的投影算术。
//
// 钉住五件事:
//   1. **只要回答**: 只收 user/message (source.kind === 'user') 与 assistant/message 的 text 块,
//      reasoning 与 tool 的东西一个都不进
//   2. **落定不看 turn/end**: 主路载体 (sessionQuery.readSurface) 里一条 turn/end 都没有 ——
//      下一轮开了 + (最后那一轮) running 说了算, turn/end 只当退路载体的补充判据
//   3. 草稿不进 entries: 只有"还在跑的那一轮"的回答进 draft
//   4. 窗口: 条数与字数两条都截, 截了就如实标记 truncated (最新那条永远留)
//   5. 从对端读回来的 JSON 是不可信输入, 过 readLiveSnapshot 的闸
// @module luwi-dsh-sync/test/luwi-live.test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { condense, liveDirectory, liveFileName, liveSnapshot, PLAN_ANSWER_PREFIX, readLiveSnapshot } from '../lib/luwi-live.mjs'

/** 一场会话: 第一轮有思考与工具, 第二轮还在流 */
const EVENTS = [
  { seq: 1, time: 10, type: 'turn/start', data: { turn: 1 } },
  { seq: 2, time: 11, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '问题一' }] } },
  {
    seq: 3,
    time: 12,
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: {
        content: [
          { type: 'reasoning', text: '不该出现' },
          { type: 'text', text: '答案一' },
          { type: 'tool-call', name: 'lw_screenshot' },
        ],
      },
    },
  },
  { seq: 4, time: 13, type: 'tool/call', data: { turn: 1, step: 1, name: 'lw_screenshot' } },
  { seq: 5, time: 14, type: 'tool/result', data: { turn: 1, step: 1 } },
  {
    seq: 6,
    time: 15,
    type: 'assistant/message',
    data: { turn: 1, step: 2, message: { content: [{ type: 'text', text: '答案一的下半句' }] } },
  },
  { seq: 7, time: 16, type: 'turn/end', data: { turn: 1 } },
  { seq: 8, time: 17, type: 'turn/start', data: { turn: 2 } },
  { seq: 9, time: 18, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '问题二' }] } },
  { seq: 10, time: 19, type: 'assistant/message', data: { turn: 2, step: 1, message: { content: [{ type: 'text', text: '答案二还在流' }] } } },
]

test('only the human user message and the assistant text blocks become entries', () => {
  const { entries, draft } = condense(EVENTS, { running: true })
  assert.deepEqual(entries.map(entry => [entry.seq, entry.role, entry.text]), [
    [2, 'user', '问题一'],
    // 同一轮里后一条顶掉前一条 (工具调用前后各有一条 assistant/message)
    [6, 'assistant', '答案一的下半句'],
    // 第二轮还没结束, 但用户那句话已经落定, 所以它在 entries 里
    [9, 'user', '问题二'],
  ])
  assert.deepEqual(draft, { seq: 10, text: '答案二还在流' }, 'the still-streaming answer is a draft, not an entry')
  const joined = entries.map(entry => entry.text).join('|')
  assert.ok(!joined.includes('不该出现'), 'reasoning never reaches the projection')
  assert.ok(!joined.includes('lw_screenshot'), 'tool names never reach the projection')
})

// 2026-10-14 主人报的那一条: "同步功能只显示了用户的话, 没有显示 agent 的回答"。
// 根因是落定只认 turn/end, 而主路载体 sessionQuery.readSurface 只回 surface 事件,
// turn/end 是 log-only, 永远不在那一串里 —— 于是每一条回答都判成"还在流", 全卡在 draft。
// 这一份事件流就是 readSurface 的真实形状: 一条 turn/end 都没有。
test('回答的落定不靠 turn/end (主路载体里一条都没有)', () => {
  const surface = [
    { seq: 1, time: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '问题一' }] } },
    { seq: 2, time: 2, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '答案一' }] } } },
    { seq: 3, time: 3, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '问题二' }] } },
    { seq: 4, time: 4, type: 'assistant/message', data: { turn: 2, step: 1, message: { content: [{ type: 'text', text: '答案二' }] } } },
  ]
  const settled = condense(surface, { running: false })
  assert.deepEqual(settled.entries.map(entry => [entry.seq, entry.role, entry.text]), [
    [1, 'user', '问题一'],
    [2, 'assistant', '答案一'],
    [3, 'user', '问题二'],
    [4, 'assistant', '答案二'],
  ], '没在跑: 后面那条回答也算落定, 四句都该进 entries')
  assert.equal(settled.draft, null)

  const live = condense(surface, { running: true })
  assert.deepEqual(live.entries.map(entry => [entry.seq, entry.role]), [[1, 'user'], [2, 'assistant'], [3, 'user']], '在跑: 只有最后那一轮的回答还是草稿')
  assert.deepEqual(live.draft, { seq: 4, text: '答案二' })
})

test('最后一轮: 没在跑就落定, 在跑才是草稿', () => {
  const one = [
    { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, time: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '在吗' }] } },
    { seq: 3, time: 3, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '在' }] } } },
  ]
  const done = condense(one, { running: false })
  assert.deepEqual(done.entries.map(entry => entry.seq), [2, 3])
  assert.equal(done.draft, null)
  const running = condense(one, { running: true })
  assert.deepEqual(running.entries.map(entry => entry.seq), [2])
  assert.deepEqual(running.draft, { seq: 3, text: '在' })
})

// 一条只有工具调用的 assistant/message 不是回答: 它既不进 entries, 也不顶掉同一轮里前面那句
// 真说过的话 (宿主的 session-turn-outline 也是"text-bearing 的那条顶前一条")
test('一条只有工具调用的回答不算回答', () => {
  const withToolOnly = [
    { seq: 1, time: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] } },
    { seq: 2, time: 2, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '我去看一下' }] } } },
    { seq: 3, time: 3, type: 'assistant/message', data: { turn: 1, step: 2, message: { content: [{ type: 'tool-call', name: 'lw_screenshot' }] } } },
  ]
  const { entries, draft } = condense(withToolOnly)
  assert.deepEqual(entries.map(entry => [entry.seq, entry.role, entry.text]), [[1, 'user', '继续'], [2, 'assistant', '我去看一下']])
  assert.equal(draft, null)

  const toolOnly = condense([
    { seq: 1, time: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] } },
    { seq: 2, time: 2, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'tool-call', name: 'lw_screenshot' }] } } },
  ], { running: true })
  assert.deepEqual(toolOnly.entries.map(entry => entry.role), ['user'], '占位不是回答')
  assert.equal(toolOnly.draft, null, '只有工具调用的那一轮没有草稿可看')
})

// ---------------------------------------------------------------------------
// 2026-11-21: 一轮没有文本回答时也要有条目 (主人报的"当前会话没有收到回复")
//   · 计划那一档: exit_plan_mode 的 plan 正文当回答 (手机上才看得到计划卡)
//   · 其余工具轮: 一行「这一轮在电脑上跑了 N 次工具，没有文字回复」
//   · 工具名 / 参数一个字都不进 (与上面那条同一条纪律)
// ---------------------------------------------------------------------------

/** 一轮纯工具 (settled) 的事件 */
function toolOnlyTurn(tools = 3, extra = []) {
  const events = [
    { seq: 1, time: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '看一下' }] } },
  ]
  for (let index = 0; index < tools; index += 1) {
    events.push({ seq: 2 + index * 2, time: 2 + index, type: 'tool/call', data: { turn: 1, step: 1, name: 'pwsh', arguments: '{"command":"Get-ChildItem"}' } })
    events.push({ seq: 3 + index * 2, time: 2 + index, type: 'tool/result', data: { turn: 1, step: 1 } })
  }
  events.push({ seq: 90, time: 90, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  events.push(...extra)
  return events
}

test('一张只有工具、没有文本的轮落下"跑了 N 次工具"那一行 (不带工具名)', () => {
  const { entries } = condense(toolOnlyTurn(3))
  const answer = entries.filter(entry => entry.role === 'assistant')
  assert.equal(answer.length, 1, '结算过的一轮必须留下一行回答')
  assert.equal(answer[0].text, '（这一轮在电脑上跑了 3 次工具，没有文字回复）')
  assert.equal(answer[0].seq, 6, '合成的回答用这一轮最后一个工具调用的 seq')
  const joined = entries.map(entry => entry.text).join('|')
  assert.ok(!joined.includes('pwsh'), '工具名不进投影')
  assert.ok(!joined.includes('Get-ChildItem'), '工具参数不进投影')
})

test('exit_plan_mode 的计划正文当这一轮的回答', () => {
  const plan = '# 修一下\n\n1. 先看账本\n2. 再落盘'
  const events = toolOnlyTurn(1, [
    {
      seq: 7,
      time: 7,
      type: 'tool/call',
      data: { turn: 1, step: 1, name: 'exit_plan_mode', arguments: JSON.stringify({ plan }) },
    },
    { seq: 8, time: 8, type: 'turn/end', data: { turn: 1 } },
  ])
  const { entries } = condense(events)
  const answer = entries.filter(entry => entry.role === 'assistant')
  assert.deepEqual(answer.map(entry => entry.seq), [7], '计划那一轮用 exit_plan_mode 自己的 seq')
  assert.ok(answer[0].text.startsWith(PLAN_ANSWER_PREFIX), '计划正文带上一句前缀')
  assert.ok(answer[0].text.includes('先看账本'), '计划正文逐字折进来')
  assert.ok(!answer[0].text.includes('exit_plan_mode'), '工具名不进正文')
})

test('计划参数坏了 / 空计划 → 退回工具占位 (不假装有计划)', () => {
  const broken = toolOnlyTurn(2, [
    { seq: 7, time: 7, type: 'tool/call', data: { name: 'exit_plan_mode', arguments: '{not json' } },
  ])
  const { entries } = condense(broken)
  const answer = entries.find(entry => entry.role === 'assistant')
  assert.equal(answer.text, '（这一轮在电脑上跑了 3 次工具，没有文字回复）')

  const empty = toolOnlyTurn(1, [
    { seq: 7, time: 7, type: 'tool/call', data: { name: 'exit_plan_mode', arguments: JSON.stringify({ plan: '   ' }) } },
  ])
  const second = condense(empty).entries.find(entry => entry.role === 'assistant')
  assert.equal(second.text, '（这一轮在电脑上跑了 2 次工具，没有文字回复）')
})

test('有文本时文本优先: 计划与工具占位都不出', () => {
  const events = toolOnlyTurn(2, [
    { seq: 7, time: 7, type: 'tool/call', data: { name: 'exit_plan_mode', arguments: JSON.stringify({ plan: '计划正文' }) } },
    { seq: 8, time: 8, type: 'assistant/message', data: { turn: 1, step: 2, message: { content: [{ type: 'text', text: '真回答' }] } } },
  ])
  const { entries } = condense(events)
  const answers = entries.filter(entry => entry.role === 'assistant')
  assert.deepEqual(answers.map(entry => [entry.seq, entry.text]), [[8, '真回答']])
})

test('还在跑的工具轮不出占位 (只留下一轮的用户消息)', () => {
  const events = toolOnlyTurn(2).filter(event => event.type !== 'turn/end')
  const { entries, draft } = condense(events, { running: true })
  assert.deepEqual(entries.map(entry => entry.role), ['user'])
  assert.equal(draft, null, '工具占位要等落定, 不能随分片改')
})


test('a turn/end still settles its turn when the fallback carrier supplies one', () => {
  const withEnd = [
    { seq: 1, time: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '问题' }] } },
    { seq: 2, time: 2, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '回答' }] } } },
    { seq: 3, time: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const { entries, draft } = condense(withEnd)
  assert.deepEqual(entries.map(entry => [entry.seq, entry.role]), [[1, 'user'], [2, 'assistant']])
  assert.equal(draft, null)
})

test('injected context lines are not user messages', () => {
  const { entries } = condense([
    { seq: 1, time: 1, type: 'user/message', data: { source: { kind: 'dsh-session-sync' }, content: [{ type: 'text', text: '冲突通知' }] } },
    { seq: 2, time: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '主人说的' }] } },
  ])
  assert.deepEqual(entries.map(entry => entry.text), ['主人说的'])
})

test('the window cuts by count and by characters, and says so', () => {
  const byCount = condense(EVENTS, { maxEntries: 2, running: true })
  assert.deepEqual(byCount.entries.map(entry => entry.seq), [6, 9])
  assert.equal(byCount.truncated, true)

  // 字数那一档: 配置层的下界是 200 字符 (见 LIVE_LIMITS), 所以拿两段长文本去量
  const long = condense([
    { seq: 1, time: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'x'.repeat(150) }] } },
    { seq: 2, time: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'y'.repeat(150) }] } },
  ], { maxChars: 200 })
  assert.deepEqual(long.entries.map(entry => entry.seq), [2], 'the newest entry survives; the older one falls out of the budget')
  assert.equal(long.truncated, true)

  const roomy = condense(EVENTS, { maxEntries: 40, maxChars: 16000, running: true })
  assert.equal(roomy.truncated, false)
})

test('condense survives empty and malformed input', () => {
  assert.deepEqual(condense([]), { entries: [], draft: null, truncated: false, all: [] })
  assert.deepEqual(condense(undefined), { entries: [], draft: null, truncated: false, all: [] })
  assert.deepEqual(condense(['nonsense', null, { type: 'user/message', data: null }]).entries, [])
})

test('a snapshot carries the device, the session and the two lists', () => {
  const snapshot = liveSnapshot({
    deviceId: 'dev-1',
    deviceName: 'PC',
    sessionId: 'session-abc',
    title: '标题',
    cwd: 'D:/apk',
    running: true,
    entries: [{ seq: 1, role: 'user', text: 'hi', at: 1 }],
    draft: null,
    truncated: false,
    updatedAt: 123,
  })
  assert.equal(snapshot.v, 3, 'v3 起每一条多一格 media (图片与文件); 读的一侧据此决定要不要重做投影')
  assert.equal(snapshot.sessionId, 'session-abc')
  assert.equal(snapshot.running, true)
  assert.equal(snapshot.deviceName, 'PC')
  // 读回来的时候 entries 那一条会被补上 `media: []` (老快照没有这一格 = 空清单), 别的逐字不变
  const back = readLiveSnapshot(snapshot)
  assert.deepEqual(back.entries, [{ seq: 1, role: 'user', text: 'hi', at: 1, media: [] }])
  assert.deepEqual({ ...back, entries: [] }, { ...snapshot, entries: [] })
})

test('a snapshot read from the peer is validated, not trusted', () => {
  assert.equal(readLiveSnapshot(null), null)
  assert.equal(readLiveSnapshot([]), null)
  assert.equal(readLiveSnapshot({}), null, 'no session id means nothing to project')
  const cleaned = readLiveSnapshot({
    sessionId: 'session-x',
    deviceId: 7,
    entries: [
      { seq: 'nope', role: 'user', text: 'ok' },
      { role: 'assistant', text: 'ok2' },
      { role: 'system', text: '不认的 role' },
      null,
      { role: 'user', text: 42 },
    ],
    draft: { text: 'd', seq: 'x' },
    running: 'yes',
  })
  assert.deepEqual(cleaned.entries.map(entry => [entry.role, entry.text, entry.seq]), [['user', 'ok', 0], ['assistant', 'ok2', 0]])
  assert.deepEqual(cleaned.draft, { seq: 0, text: 'd' })
  assert.equal(cleaned.running, false, 'a non-boolean running reads as false')
  assert.equal(cleaned.deviceId, '', 'a non-string device id reads as empty')
})

test('live file names and directories stay inside the repo', () => {
  assert.equal(liveFileName('session-1234-abc'), 'session-1234-abc')
  assert.equal(liveFileName('../../etc/passwd'), 'etc-passwd')
  assert.equal(liveFileName(''), 'session')
  assert.equal(liveFileName('x'.repeat(200)).length, 128)
  assert.ok(liveDirectory('/repo', 'dev-1').includes('live/dev-1'))
  assert.throws(() => liveDirectory('/repo', '***'), /device id/u)
})

/* ── 2026-11-22 (2.8.1 #50): 条目带 media ─────────────────────────────── */

test('每一条带的图与文件都进 media (附件块一路 + 附件段一路)', () => {
  const events = [
    {
      seq: 2,
      time: 11,
      type: 'user/message',
      data: {
        source: { kind: 'user' },
        content: [
          { type: 'text', text: '看图\n\n[附件 2 个, 图片用 read_image 打开]\n1. C:\\x\\lw-in\\a.png\n2. C:\\x\\lw-in\\b.pdf' },
          { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', name: 'shot.png', bytes: 12 } },
        ],
      },
    },
    { seq: 4, time: 13, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '收到' }] } } },
  ]
  const [user, assistant] = condense(events, { running: false }).entries
  assert.equal(user.role, 'user')
  assert.deepEqual(user.media.map(one => [one.kind, one.name, one.image]), [
    ['attachment', 'shot.png', true],
    ['path', 'a.png', true],
    ['path', 'b.pdf', false],
  ])
  assert.equal(user.media[0].attachmentId, 'att-1')
  assert.equal(user.media[1].path, 'C:\\x\\lw-in\\a.png')
  assert.deepEqual(assistant.media, [], '没有图的那一条是空清单')
})

test('只有一张图、一句话都没有的用户消息也算一条 (以前整条丢掉)', () => {
  const events = [
    {
      seq: 2,
      time: 11,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'image', attachment: { attachmentId: 'att-9', mediaType: 'image/png', name: 'p.png' } }] },
    },
  ]
  const entries = condense(events, { running: false }).entries
  assert.equal(entries.length, 1)
  assert.equal(entries[0].text, '[图片]', '纯图片那一句的正文是 `textOfContent` 给的占位')
  assert.equal(entries[0].media.length, 1)
  assert.equal(entries[0].media[0].attachmentId, 'att-9')
})

test('readLiveSnapshot: media 是不可信输入, 认不出的整项丢掉', () => {
  const cleaned = readLiveSnapshot({
    sessionId: 'session-x',
    entries: [{
      role: 'user',
      text: 'x',
      media: [
        { kind: 'attachment', attachmentId: 'att-1', name: '../../a.png', image: true },
        { kind: 'attachment', attachmentId: '', name: 'b.png' },
        { kind: 'path', path: '', name: 'c.png' },
        { kind: 'path', path: 'C:\\x\\lw-in\\d.pdf', name: 'd.pdf', image: false },
        { kind: 'weird', name: 'e.png' },
        null,
      ],
    }],
  })
  const media = cleaned.entries[0].media
  assert.deepEqual(media.map(one => [one.kind, one.name]), [['attachment', 'a.png'], ['path', 'd.pdf']], '危险名字只留最后一段, 空 id 与空路径丢掉')
  // 老快照没有这一格: 空清单
  assert.deepEqual(readLiveSnapshot({ sessionId: 's', entries: [{ role: 'user', text: 'x' }] }).entries[0].media, [])
})

