// test/lw-reverse.test.mjs — `adb reverse` 那条管子的读数与"最多试三次" (2026-11-22)
//
// 真机事故: 手机存的是回环口 63560, 电脑每次重启换端口 (62666 → 58717 …), reverse 还指着旧的,
// 手机端就是「电脑没连上 … (fetch failed)」。这份测的是判据与重试循环; 真正跑 adb/pwsh 的接线在
// index.mjs, 这里全部注入假实现。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseReverseList, repairReverse, reverseIsStale, REVERSE_MAX_ATTEMPTS } from '../lib/lw-reverse.mjs'

test('parseReverseList reads the two tcp ports and the serial column', () => {
  const rows = parseReverseList('UsbFfs tcp:63560 tcp:58717\nhost-12 tcp:63560 tcp:62666\n\nnot a reverse line\n')
  assert.deepEqual(rows, [
    { serial: 'UsbFfs', devicePort: 63560, pcPort: 58717 },
    { serial: 'host-12', devicePort: 63560, pcPort: 62666 },
  ])
})

test('reverseIsStale: missing entry or a wrong pc port both count as stale', () => {
  assert.equal(reverseIsStale([], 63560, 58717), true, '一条都没有 = 断了')
  assert.equal(reverseIsStale([{ devicePort: 63560, pcPort: 62666 }], 63560, 58717), true, '指着上一个端口')
  assert.equal(reverseIsStale([{ devicePort: 63560, pcPort: 58717 }], 63560, 58717), false, '正好指着这一趟')
  assert.equal(reverseIsStale([{ devicePort: 63560, pcPort: 58717 }], 63560, 0), false, '还拿不到电脑端口时不判')
  assert.equal(reverseIsStale([{ devicePort: 6000, pcPort: 1 }], 63560, 58717), true, '别的口不算')
})

test('repairReverse: repairs once when the entry was stale', async () => {
  let calls = 0
  const result = await repairReverse({
    devicePort: 63560,
    pcPort: 58717,
    readEntries: async () => (calls === 0 ? [] : [{ devicePort: 63560, pcPort: 58717 }]),
    repair: async () => { calls += 1; return { ok: true } },
    sleep: async () => {},
  })
  assert.deepEqual(result, { ok: true, attempts: 1 })
  assert.equal(calls, 1)
})

test('repairReverse: a fresh entry runs nothing at all', async () => {
  let repairs = 0
  const result = await repairReverse({
    devicePort: 63560,
    pcPort: 58717,
    readEntries: async () => [{ devicePort: 63560, pcPort: 58717 }],
    repair: async () => { repairs += 1; return { ok: true } },
    sleep: async () => {},
  })
  assert.deepEqual(result, { ok: true, attempts: 0 })
  assert.equal(repairs, 0)
})

test('repairReverse: gives up after three attempts and says why', async () => {
  let repairs = 0
  const result = await repairReverse({
    devicePort: 63560,
    pcPort: 58717,
    readEntries: async () => [],
    repair: async () => { repairs += 1; return { ok: false, error: 'no device' } },
    sleep: async () => {},
  })
  assert.equal(REVERSE_MAX_ATTEMPTS, 3)
  assert.equal(repairs, 3, '先尝试三次')
  assert.equal(result.ok, false)
  assert.equal(result.attempts, 3)
  assert.match(result.error, /no device|still stale/u)
})

test('repairReverse: a throwing reader is treated as stale, not as a crash', async () => {
  const result = await repairReverse({
    devicePort: 63560,
    pcPort: 58717,
    readEntries: async () => { throw new Error('adb: no devices') },
    repair: async () => ({ ok: true }),
    sleep: async () => {},
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /adb/u)
})
