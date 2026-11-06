// test/term-channel.test.mjs — 终端面板宿主半 (2.8.0 #32) 的单测
//
// 不起 App, 也不碰真沙盒: 在本地开一个只会收发一行 JSON 的假特权通道, 把
// createTermChannel() 那几档 (状态 / 跑一条 / 中断 / 排队) 逐条走一遍。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import {
  TERM_MAX_COMMAND_CHARS,
  createTermChannel,
  termGuestScript,
} from '../lib/term-channel.mjs'

/**
 * 起一个假通道。`answer(request, socket)` 返回要回的那一份 JSON; 返回 promise 就等它。
 * @param {(request: object, socket: object) => object|Promise<object>} answer - 应答器。
 * @returns {Promise<{env: object, requests: object[], close: () => Promise<void>}>} 通道句柄。
 */
async function startBridge(answer) {
  const requests = []
  const server = createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      let end = buffer.indexOf('\n')
      while (end >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        let request
        try {
          request = JSON.parse(line)
        } catch {
          socket.end('{}\n')
          end = buffer.indexOf('\n')
          continue
        }
        requests.push(request)
        Promise.resolve(answer(request, socket)).then((payload) => {
          if (payload !== undefined) socket.end(`${JSON.stringify(payload)}\n`)
          end = buffer.indexOf('\n')
        })
        return
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    env: { LW_CHANNEL_ENDPOINT: `127.0.0.1:${port}`, LW_CHANNEL_TOKEN: 'token-for-test' },
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** 让排队的那几条 promise 链落定。 */
async function flush() {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

test('没有那两个环境变量: available false, status / run / interrupt 都如实说没有', async () => {
  const channel = createTermChannel({})
  assert.equal(channel.available(), false)
  const status = await channel.status()
  assert.equal(status.ok, false)
  assert.equal(status.installed, false)
  assert.match(status.error, /not started by Luwi/)
  const run = await channel.run('echo hi')
  assert.equal(run.ok, false)
  assert.match(run.error, /no sandbox/)
  const interrupt = await channel.interrupt()
  assert.equal(interrupt.ok, false)
})

test('status: 从 App 那句人话里读出装没装与版本', async () => {
  const plus = await startBridge(() => ({
    result: { text: 'the Linux sandbox is installed (alpine-3.24.0); 0 command(s) running right now' },
  }))
  const minus = await startBridge(() => ({
    result: { text: 'the Linux sandbox is not installed; 0 command(s) running right now' },
  }))
  try {
    const installed = await createTermChannel(plus.env).status()
    assert.deepEqual(
      { ok: installed.ok, installed: installed.installed, version: installed.version },
      { ok: true, installed: true, version: 'alpine-3.24.0' },
    )
    assert.deepEqual(plus.requests[0], { method: 'linux', token: 'token-for-test', op: 'status' })

    const absent = await createTermChannel(minus.env).status()
    assert.deepEqual(
      { ok: absent.ok, installed: absent.installed, version: absent.version },
      { ok: true, installed: false, version: '' },
    )
  } finally {
    await plus.close()
    await minus.close()
  }
})

test('run: 套上会话壳 (恢复 cd / 记新 cd / 看门狗 / 取消文件), 输出原样回来', async () => {
  const bridge = await startBridge((request) => {
    if (request.op === 'run') return { result: { text: 'hi\n' } }
    return { result: { text: '' } }
  })
  try {
    const channel = createTermChannel(bridge.env)
    const result = await channel.run('echo hi', 500)
    assert.deepEqual(result, { ok: true, text: 'hi\n' })
    const request = bridge.requests[0]
    assert.equal(request.method, 'linux')
    assert.equal(request.op, 'run')
    assert.equal(request.timeoutMs, 1_000, '超时被收进 [1000, 600000]')
    for (const anchor of [
      'cd "$(cat "$__lw_dir/cwd")"',
      'eval \'echo hi\'',
      'pwd | cat > "$__lw_dir/cwd"',
      'cancel',
      'sleep 0.1',
      "printf '^C\\n'",
      'kill -9 $$',
    ]) {
      assert.equal(request.command.includes(anchor), true, `命令壳里少了 ${anchor}`)
    }
  } finally {
    await bridge.close()
  }
})

test('interrupt: 另发一条 linux 调用去写 cancel 文件, run 回 interrupted', async () => {
  let release = null
  const bridge = await startBridge((request) => {
    if (request.op !== 'run') return { result: { text: '' } }
    // 中断那一条只写 cancel 文件; 用户命令外面那层壳里也有 "cancel" 三个字, 不能看这个
    if (request.command.includes(": > '/root/.lw-term/default/cancel'")) {
      release?.({ result: { text: '^C\n' } })
      return { result: { text: 'cancel written' } }
    }
    return new Promise((resolve) => { release = resolve })
  })
  try {
    const channel = createTermChannel(bridge.env)
    const running = channel.run('sleep 5')
    await flush()
    assert.equal(bridge.requests.some((request) => request.command.includes('sleep 5')), true)
    const interrupt = await channel.interrupt()
    assert.deepEqual(interrupt, { ok: true, interrupted: true })
    const result = await running
    assert.deepEqual(result, { ok: false, interrupted: true, text: '^C\n' })
    const cancel = bridge.requests.find((request) => request.command.includes(": > '/root/.lw-term/default/cancel'"))
    assert.ok(cancel)
  } finally {
    await bridge.close()
  }
})

test('同一个会话排队: 上一条没应答之前, 下一条不开始', async () => {
  const releases = []
  const bridge = await startBridge(() => new Promise((resolve) => { releases.push(resolve) }))
  try {
    const channel = createTermChannel(bridge.env)
    const first = channel.run('echo one')
    await flush()
    const second = channel.run('echo two')
    await flush()
    assert.equal(bridge.requests.length, 1, '第二条还在排队')
    releases[0]({ result: { text: 'one\n' } })
    assert.deepEqual(await first, { ok: true, text: 'one\n' })
    await flush()
    assert.equal(bridge.requests.length, 2)
    releases[1]({ result: { text: 'two\n' } })
    assert.deepEqual(await second, { ok: true, text: 'two\n' })
  } finally {
    await bridge.close()
  }
})

test('命令形状: 空命令 / 过长命令在宿主这一层就拒掉', async () => {
  const bridge = await startBridge(() => ({ result: { text: '' } }))
  try {
    const channel = createTermChannel(bridge.env)
    assert.equal((await channel.run('   ')).ok, false)
    assert.equal((await channel.run('x'.repeat(TERM_MAX_COMMAND_CHARS + 1))).ok, false)
    assert.equal(bridge.requests.length, 0)
  } finally {
    await bridge.close()
  }
})

test('termGuestScript: 单引号被转义, 用户命令不会被拆成两段', () => {
  const script = termGuestScript("echo 'a b'")
  assert.equal(script.includes("eval 'echo '\\''a b'\\'''"), true)
})
