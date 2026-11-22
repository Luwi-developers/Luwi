// test/render-p2p.test.mjs — `/sync p2p` 那一段读数的人话 (2026-11-22; 同日晚上改成中文)
//
// 面板上那张 P2P 卡撤掉之后, 这几行就是唯一的读数口, 所以它一句都不能少: 开关 / 走哪条路 /
// 对端 / 信任 / SAS / 计数 / 冷却 / 最近错误, 以及"哪一台在等确认换机"和下一步该打什么命令。
// 动作词的中英对照在 `lib/command-words.mjs` (那几条在下面一并钉住)。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderP2pState } from '../lib/render.mjs'
import { normalizeP2pAction, P2P_ACTIONS } from '../lib/command-words.mjs'

test('关着的时候只说开关与下一步 (不冒充"已连接")', () => {
  const text = renderP2pState({ enabled: false, path: 'disabled', trustState: 'unknown' })
  assert.match(text, /^p2p: 关/u)
  assert.match(text, /信任: 还没核过/u)
  assert.doesNotMatch(text, /计数/, '没开就不报计数')
  assert.match(text, /\/sync p2p 开\|关/u)
})

test('直连: 对端 / 信任 / SAS / 计数都在, SAS 数字成组好看', () => {
  const text = renderP2pState({
    enabled: true,
    path: 'ip',
    rttMs: 12,
    peerId: 'abcdef1234567890',
    peerName: 'PC',
    trustState: 'trusted',
    sas: '123456',
    sent: 3,
    received: 1,
    skipped: 0,
    failures: 0,
  })
  assert.match(text, /传输 直连 12 ms/u)
  assert.match(text, /对端: PC · abcdef12…/u)
  assert.match(text, /信任: 已信任 · SAS 123 456/u)
  assert.match(text, /计数: 发出 3 · 收到 1 · 跳过 0 · 失败 0/u)
})

test('中转与掉线各有一句人话', () => {
  assert.match(renderP2pState({ enabled: true, path: 'relay', rttMs: 80 }), /中转 80 ms（比直连慢）/u)
  assert.match(renderP2pState({ enabled: true, path: 'offline' }), /对端不在, 这一趟走 git/u)
})

test('信任四档都说中文', () => {
  assert.match(renderP2pState({ enabled: true, path: 'ip', trustState: 'new' }), /信任: 新对端/u)
  assert.match(renderP2pState({ enabled: true, path: 'ip', trustState: 'changed' }), /信任: 换机待确认/u)
  assert.match(renderP2pState({ enabled: true, path: 'ip', trustState: 'revoked' }), /信任: 已吊销/u)
})

test('哪一台在等确认换机要点名 (并给出确认用的 id)', () => {
  const text = renderP2pState({
    enabled: true,
    path: 'ip',
    blockedPeer: { id: 'dev-1', name: 'PC', nodeId: 'deadbeefcafe' },
  })
  assert.match(text, /等确认换机: PC（设备 dev-1, 节点 deadbeef…）/u)
})

test('冷却与最近错误照实说 (错误码是机器可读的, 不翻译)', () => {
  const text = renderP2pState({ enabled: true, path: 'offline', cooling: true, lastError: { code: 'P2P_TIMEOUT', message: 'no answer' } })
  assert.match(text, /冷却中: 上一次没成/u)
  assert.match(text, /最近错误: P2P_TIMEOUT no answer/u)
})

test('动作词: 中文是正写, 英文留作别名, 认不出的原样交回', () => {
  assert.deepEqual(
    ['', '状态', '读数', '开', '打开', '关', '关闭', '确认', '确认换机', '吊销', '撤销']
      .map(value => normalizeP2pAction(value)),
    ['state', 'state', 'state', 'on', 'on', 'off', 'off', 'confirm', 'confirm', 'revoke', 'revoke'],
  )
  assert.deepEqual(
    ['state', 'status', 'on', 'off', 'confirm', 'revoke'].map(value => normalizeP2pAction(value)),
    ['state', 'state', 'on', 'off', 'confirm', 'revoke'],
  )
  assert.equal(normalizeP2pAction('乱写'), '乱写')
  assert.equal(normalizeP2pAction(undefined), 'state')
  assert.deepEqual([...P2P_ACTIONS], ['state', 'on', 'off', 'confirm', 'revoke'])
})
