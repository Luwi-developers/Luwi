// test/panel-guard.test.mjs — 面板写操作的门槛 (审计 P0 第 1 条)
//
// 钉的四件事: 回环地址放行 / 别的地址没令牌就拒 / 带对端共享令牌放行 / 取不到地址时 fail-closed
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bearerOf, guardLocalWrite, isLoopbackAddress, remoteAddressOf } from '../lib/panel-guard.mjs'

/** 造一个只有对端地址与头的请求。 */
function reqOf(remoteAddress, headers = {}) {
  return { socket: { remoteAddress }, headers }
}

test('isLoopbackAddress: v4 / v6 / v6 映射都算本机, 局域网不算', () => {
  for (const address of ['127.0.0.1', '127.0.0.53', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1']) {
    assert.equal(isLoopbackAddress(address), true, address)
  }
  for (const address of ['192.168.31.145', '10.0.0.2', '::ffff:192.168.31.145', 'fe80::1', '', null, undefined]) {
    assert.equal(isLoopbackAddress(address), false, String(address))
  }
})

test('remoteAddressOf / bearerOf: 取不到都是空串, 不抛', () => {
  assert.equal(remoteAddressOf(reqOf('127.0.0.1')), '127.0.0.1')
  assert.equal(remoteAddressOf({}), '')
  assert.equal(bearerOf(reqOf('127.0.0.1', { authorization: 'Bearer abc' })), 'abc')
  assert.equal(bearerOf(reqOf('127.0.0.1', { authorization: 'Basic abc' })), '')
  assert.equal(bearerOf({}), '')
})

test('guardLocalWrite: 本机放行', () => {
  assert.equal(guardLocalWrite(reqOf('127.0.0.1')), null)
  assert.equal(guardLocalWrite(reqOf('::1')), null)
  // 本机即使带了不相干的令牌也放行 —— 电脑面板不带令牌
  assert.equal(guardLocalWrite(reqOf('127.0.0.1', { authorization: 'Bearer nope' }), { spec: { token: 'real', listen: true } }), null)
})

test('guardLocalWrite: 别的设备没令牌 → 403, 并且说清为什么', () => {
  const gate = guardLocalWrite(reqOf('192.168.31.145'), { what: '面板动作 configure' })
  assert.notEqual(gate, null)
  assert.equal(gate.status, 403)
  assert.match(String(gate.body.error), /本机/u)
  assert.match(String(gate.body.error), /configure/u)
})

test('guardLocalWrite: 别的设备带对端共享令牌 → 放行', () => {
  const spec = { token: 'shared-secret', listen: true }
  assert.equal(guardLocalWrite(reqOf('192.168.31.145', { authorization: 'Bearer shared-secret' }), { spec }), null)
  // 令牌不对还是拒
  assert.equal(guardLocalWrite(reqOf('192.168.31.145', { authorization: 'Bearer wrong' }), { spec })?.status, 403)
  // 通道没开 (listen: false) 时令牌不算数
  assert.equal(guardLocalWrite(reqOf('192.168.31.145', { authorization: 'Bearer shared-secret' }), { spec: { ...spec, listen: false } })?.status, 403)
})

test('guardLocalWrite: 取不到对端地址时 fail-closed', () => {
  assert.equal(guardLocalWrite({ headers: {} })?.status, 403)
})
