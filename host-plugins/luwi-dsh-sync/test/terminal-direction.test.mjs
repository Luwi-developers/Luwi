// test/terminal-direction.test.mjs — 终端口径的方向闸 (2026-11-21, 落实表 #48)
//
// 这一份钉的是"只由手机管电脑"那四条底线, 全是行为断言 (起真路由、发真请求, 不碰网络):
//   ① 回环判据: 只有本机发出来的请求算本机 (v4 / v6 / v4-mapped 三种写法都认)
//   ② 面板写面 (op) 与终端 (term) 对非回环请求回 403, 而且**根本不执行**那一下
//   ③ 对端入站 send: 控制器的 `acceptSend` 缺省关, 带对的令牌也回 403; 电脑那一侧照旧收
//   ④ 角色派生: 有 `pairing` 的那台 (手机) 缺省不听、不收指令; 没有的那台 (电脑) 缺省都开;
//      queue 模式两档一律关; 显式写 true 才放开
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LOOPBACK_ADDRESSES, isLocalRequest, isLoopbackAddress, isLoopbackRequest } from '../lib/loopback.mjs'
import { resolvePeerSpec, resolveRole } from '../lib/luwi-peer.mjs'
import { createPanel } from '../lib/panel-routes.mjs'
import { createPeerRuntime } from '../lib/luwi-peer-runtime.mjs'

const TOKEN = 't'.repeat(24)

/** 一个能当 req 用的最小对象 (readJsonBody 要的可异步迭代体) */
function makeReq({ method = 'GET', url = '/', token, body, remoteAddress = '127.0.0.1', headers } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    url,
    socket: { remoteAddress },
    headers: headers ?? { host: '127.0.0.1:3080', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

/** 一个能当 res 用的最小对象 */
function makeRes() {
  const record = { status: 0, body: null }
  return {
    record,
    set statusCode(value) {
      record.status = value
    },
    get statusCode() {
      return record.status
    },
    setHeader() {},
    end(payload) {
      record.body = payload === undefined ? null : JSON.parse(payload)
    },
  }
}

/** 调一条路由 */
async function callRoute(routes, path, options = {}) {
  const route = routes.find(entry => entry.path === path)
  assert.ok(route !== undefined, `route ${path} is registered`)
  const res = makeRes()
  await route.handler(makeReq({ url: options.url ?? path, ...options }), res)
  return res.record
}

// ---------------------------------------------------------------------------
// ① 回环判据
// ---------------------------------------------------------------------------

test('loopback: the four spellings of this machine count, everything else does not', () => {
  for (const address of LOOPBACK_ADDRESSES) {
    assert.equal(isLoopbackAddress(address), true, `${address} is loopback`)
  }
  for (const address of ['127.0.0.2', '192.168.1.20', '10.0.0.5', '::2', '', 'unknown', null, undefined, 42]) {
    assert.equal(isLoopbackAddress(address), false, `${String(address)} is not loopback`)
  }
  assert.equal(isLoopbackRequest(makeReq({ remoteAddress: '::1' })), true)
  assert.equal(isLoopbackRequest(makeReq({ remoteAddress: '192.168.1.20' })), false)
  // 没有 socket 的那一档失败关闭 (老测试夹具就是这样, 不能错误放行)
  assert.equal(isLoopbackRequest({ method: 'POST' }), false)
  assert.equal(isLoopbackRequest(null), false)
  // 2026-11-21: 只看 socket 还不够 —— Host 头也要是回环 (挡 DNS rebinding 与同机反代)
  const withHost = (host) => ({ socket: { remoteAddress: '127.0.0.1' }, headers: { host } })
  assert.equal(isLocalRequest(withHost('127.0.0.1:3080')), true)
  assert.equal(isLocalRequest(withHost('localhost:3080')), true)
  assert.equal(isLocalRequest(withHost('[::1]:3080')), true)
  assert.equal(isLocalRequest(withHost('evil.example:3080')), false)
  assert.equal(isLocalRequest(withHost('')), false)
  assert.equal(isLocalRequest({ socket: { remoteAddress: '192.168.1.20' }, headers: { host: '127.0.0.1:3080' } }), false)
})

// ---------------------------------------------------------------------------
// ② 面板写面 / 终端: 非回环一律 403, 而且不执行
// ---------------------------------------------------------------------------

function makePanelDeps(calls) {
  return {
    mirrors: [],
    logger: { warn() {}, info() {} },
    now: () => 1,
    collectDoctor: async () => ({ ok: true }),
    readPeers: async () => ({ cards: [], broken: 0 }),
    runOp: async (body) => {
      calls.push(`op:${body?.op ?? ''}`)
      return { status: 200, body: { ok: true, action: body?.op ?? '' } }
    },
    runTerm: async () => {
      calls.push('term')
      return {
        ok: true,
        installed: true,
        stdout: 'hi',
        exitCode: 0,
      }
    },
  }
}

test('panel: the write surface and the terminal are loopback-only, and a refused call never runs', async () => {
  const calls = []
  const panel = createPanel(makePanelDeps(calls))
  const routes = panel.routes()

  // Host 头不是回环的 (DNS rebinding / 同机反代) 也要拒: socket 是回环但 Host 是 evil.example
  const rebound = await callRoute(routes, '/luwi-sync/term', {
    method: 'POST',
    headers: { host: 'evil.example:3080' },
    body: { command: 'id' },
  })
  assert.equal(rebound.status, 403)

  const opFromPeer = await callRoute(routes, '/luwi-sync/op', {
    method: 'POST',
    remoteAddress: '192.168.1.20',
    body: { op: 'push', target: 'sessions', confirm: true },
  })
  assert.equal(opFromPeer.status, 403)
  assert.match(opFromPeer.body.error, /loopback-only/u)

  const termFromPeer = await callRoute(routes, '/luwi-sync/term', {
    method: 'POST',
    remoteAddress: '192.168.1.20',
    body: { command: 'id' },
  })
  assert.equal(termFromPeer.status, 403)
  assert.match(termFromPeer.body.error, /loopback-only/u)
  assert.deepEqual(calls, [], 'a refused request must not reach runOp / runTerm')

  // 本机 (回环) 照旧: 写面进 runOp (这棵树上没有镜像, 于是它到不了 runOp 就先 409 —— 重点是没有 403),
  // 终端进 runTerm
  const opLocal = await callRoute(routes, '/luwi-sync/op', {
    method: 'POST',
    body: { op: 'push', target: 'sessions', confirm: true },
  })
  assert.notEqual(opLocal.status, 403)
  const termLocal = await callRoute(routes, '/luwi-sync/term', { method: 'POST', body: { command: 'id' } })
  assert.equal(termLocal.status, 200)
  assert.match(String(termLocal.body.stdout), /hi/u)
  assert.ok(calls.includes('term'), 'the loopback terminal call reaches runTerm')

  // 方法那一条先判: 非回环的 GET 仍是 405, 与老读数逐字一致
  const wrongMethod = await callRoute(routes, '/luwi-sync/op', { method: 'GET', remoteAddress: '192.168.1.20' })
  assert.equal(wrongMethod.status, 405)
})

// ---------------------------------------------------------------------------
// ③ 对端入站指令: 控制器拒, 电脑收
// ---------------------------------------------------------------------------

function makeRuntimeSpec(overrides = {}) {
  return {
    enabled: true,
    controller: false,
    mode: 'http',
    listen: true,
    acceptSend: true,
    proxy: true,
    token: TOKEN,
    url: '',
    sendTimeoutMs: 1000,
    pollSeconds: 3,
    maxShadows: 4,
    maxProxies: 8,
    ...overrides,
  }
}

function makeDeps(root, specOverrides = {}, calls = { delivered: [] }) {
  return {
    spec: makeRuntimeSpec(specOverrides),
    live: { enabled: true, maxEntries: 40, maxChars: 16000, keepMinutes: 30 },
    repoDir: root,
    ownDeviceId: () => 'dev-me',
    ownDeviceName: () => 'Luwi 手机',
    readPeerCards: async () => [],
    listWorkspaces: async () => [],
    listSessions: async () => [],
    projectSession: async () => null,
    deliver: async (sessionId, message) => {
      calls.delivered.push({ sessionId, text: message.text })
      return { running: true }
    },
    resolveTarget: async target => (target.kind === 'session' ? target.id : 's1'),
    makeUserMessage: async text => ({ text }),
    readState: async () => ({ delivered: [] }),
    writeState: async () => {},
    pushRepo: async () => ({ ok: true }),
    logger: { warn() {}, info() {} },
    warn: () => {},
    now: () => 1000,
  }
}

test('peer send: a controller refuses cross-device commands even with the right token', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lw-term-dir-'))
  try {
    const calls = { delivered: [] }
    const controller = createPeerRuntime(makeDeps(root, { controller: true, listen: true, acceptSend: false }, calls))
    const refused = await callRoute(controller.routes(), '/luwi-sync/peer/send', {
      method: 'POST',
      token: TOKEN,
      body: { text: '在手机上跑一下', target: { kind: 'session', id: 's1' } },
    })
    assert.equal(refused.status, 403)
    assert.match(refused.body.error, /does not accept cross-device commands/u)
    assert.deepEqual(calls.delivered, [])

    // 电脑那一侧 (acceptSend 缺省开) 照旧: 带对令牌就真的投进 agent
    const peer = createPeerRuntime(makeDeps(root, {}, calls))
    const delivered = await callRoute(peer.routes(), '/luwi-sync/peer/send', {
      method: 'POST',
      token: TOKEN,
      body: { text: '跑一下测试', target: { kind: 'session', id: 's1' } },
    })
    assert.equal(delivered.status, 200)
    assert.equal(delivered.body.ok, true)
    assert.deepEqual(calls.delivered, [{ sessionId: 's1', text: '跑一下测试' }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('local send: the phone may send, a request from the LAN may not', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lw-term-send-'))
  try {
    const runtime = createPeerRuntime(makeDeps(root, {}))
    const refused = await callRoute(runtime.routes(), '/luwi-sync/send', {
      method: 'POST',
      remoteAddress: '192.168.1.20',
      body: { text: 'hi', target: { kind: 'new', id: '', name: 'DSH' } },
    })
    assert.equal(refused.status, 403)
    assert.match(refused.body.error, /loopback-only/u)

    const local = await callRoute(runtime.routes(), '/luwi-sync/send', {
      method: 'POST',
      body: { text: 'hi', target: { kind: 'new', id: '', name: 'DSH' } },
    })
    // 这里没有真对端: 打不通就走队列, 回执仍是 ok (via=queue) —— 要的是"没被闸挡下"
    assert.notEqual(local.status, 403)

    const live = await callRoute(runtime.routes(), '/luwi-sync/peer-live', {
      remoteAddress: '192.168.1.20',
    })
    assert.equal(live.status, 403)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// ④ 角色派生
// ---------------------------------------------------------------------------

test('peer spec: the controller listens to nobody by default, the computer keeps taking instructions', () => {
  const controller = resolvePeerSpec({ token: TOKEN }, { controller: true })
  assert.equal(controller.controller, true)
  assert.equal(controller.listen, false)
  assert.equal(controller.acceptSend, false)
  assert.equal(controller.proxy, true)

  const peer = resolvePeerSpec({ token: TOKEN }, { controller: false })
  assert.equal(peer.controller, false)
  assert.equal(peer.listen, true)
  assert.equal(peer.acceptSend, true)

  // 老配置 (没有角色参数) 仍是电脑那一档 —— 不因为升级把电脑的入站悄悄关掉
  const legacy = resolvePeerSpec({ token: TOKEN })
  assert.equal(legacy.controller, false)
  assert.equal(legacy.listen, true)
  assert.equal(legacy.acceptSend, true)

  // 显式写才放开 / 关掉
  assert.equal(resolvePeerSpec({ token: TOKEN, acceptSend: true }, { controller: true }).acceptSend, true)
  assert.equal(resolvePeerSpec({ token: TOKEN, listen: true }, { controller: true }).listen, true)
  assert.equal(resolvePeerSpec({ token: TOKEN, acceptSend: false }, { controller: false }).acceptSend, false)

  // queue 模式两档一律关 (与老口径一致)
  const queue = resolvePeerSpec({ token: TOKEN, mode: 'queue' }, { controller: false })
  assert.equal(queue.listen, false)
  assert.equal(queue.acceptSend, false)

  // 通道关掉时仍是 null (失败关闭)
  assert.equal(resolvePeerSpec(undefined, { controller: true }), null)
  assert.equal(resolvePeerSpec({ token: '' }, { controller: true }), null)
})

test('role: explicit role wins, the legacy fallback only guesses "phone" when the phone remembers the computer', () => {
  assert.equal(resolveRole({ role: 'phone' }), 'phone')
  assert.equal(resolveRole({ role: 'PC' }), 'pc')
  assert.equal(resolveRole({ role: 'nonsense', paired: true, peerUrl: 'http://pc.test:3080' }), 'phone')
  assert.equal(resolveRole({ paired: true, peerUrl: 'http://pc.test:3080' }), 'phone')
  assert.equal(resolveRole({ paired: true, peerUrl: '' }), 'pc')
  assert.equal(resolveRole({ paired: false, peerUrl: 'http://pc.test:3080' }), 'pc')
  assert.equal(resolveRole({}), 'pc')
  // 显式 role 压过回退 (电脑那一侧也写 pairing, 只看 pairing 会把它误判成手机)
  assert.equal(resolveRole({ role: 'pc', paired: true, peerUrl: 'http://x:1' }), 'pc')
})
