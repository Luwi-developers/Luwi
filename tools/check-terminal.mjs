/**
 * 侧边栏交互终端 (2.8.0 #32) 的自动判据
 *
 * 这一份钉的是四条验收在**代码与协议**里的形状, 不碰真机:
 *
 *   ① 沙盒未装: 入口置灰, 点进去给「先装 Linux 沙盒」
 *   ② 沙盒已装: 一条命令拿到真输出 (`echo hi`); 真机 1 s 那个读数在设备回执里
 *   ③ `sleep 5` 执行中按 Ctrl-C: 提示符回来并显示中断 (宿主发 cancel, guest 壳里的看门狗收进程树)
 *   ④ 连敲三条命令, `pwd` 仍停在上一条 `cd` 的目录 (guest 壳在每次调用之间记 cwd)
 *
 * ③④ 除了源码形状之外, 还在本机找一个 POSIX sh 把那层 guest 壳**真跑一遍**:
 * 取消文件 -> `^C` -> 整棵退出, 以及 `cd` 之后下一次调用还在那个目录。没有 sh 时
 * 这两条标 skip (真机读数仍以设备回执为准)。
 *
 * 跑法: node tools/check-terminal.mjs   (不需要设备, 也不需要 host)
 */

import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const client = await read('host-plugins/luwi-dsh-sync/lib/client.js')
const channelSource = await read('host-plugins/luwi-dsh-sync/lib/term-channel.mjs')
const routes = await read('host-plugins/luwi-dsh-sync/lib/panel-routes.mjs')
const index = await read('host-plugins/luwi-dsh-sync/index.mjs')
const { createPanel, PANEL_PREFIX } = await import(
  new URL('host-plugins/luwi-dsh-sync/lib/panel-routes.mjs', root)
)
const { createTermChannel, termGuestScript } = await import(
  new URL('host-plugins/luwi-dsh-sync/lib/term-channel.mjs', root)
)

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

/**
 * 起一个只会收发一行 JSON 的假特权通道。
 * @param {(request: object) => object|Promise<object>} answer - 应答器。
 * @returns {Promise<{env: object, requests: object[], close: () => Promise<void>}>} 通道句柄。
 */
async function startBridge(answer) {
  const requests = []
  const server = createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end < 0) return
      const request = JSON.parse(buffer.slice(0, end))
      buffer = buffer.slice(end + 1)
      requests.push(request)
      Promise.resolve(answer(request)).then((payload) => {
        if (payload !== undefined) socket.end(`${JSON.stringify(payload)}\n`)
      })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    env: { LW_CHANNEL_ENDPOINT: `127.0.0.1:${port}`, LW_CHANNEL_TOKEN: 'check-terminal' },
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** 造一个只会吐一段体的假请求。 */
function fakeRequest(text, extra = {}) {
  return {
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      if (text !== null) yield Buffer.from(text, 'utf8')
    },
    ...extra,
  }
}

/** 造一个记录应答的假响应。 */
function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value },
    end(payload) { this.body = payload },
  }
}

/**
 * 造一个只给终端那一条路由用的面板 (其余依赖用不到, 给最小的一份)。
 * @param {object} deps - runTerm / termStatus / termInterrupt。
 * @returns {object} 面板句柄。
 */
function termPanel(deps) {
  return createPanel({
    mirrors: [],
    readMetaFor: () => async () => ({}),
    readPeers: async () => ({ cards: [], broken: 0 }),
    collectDoctor: async () => ({ status: 'PASS' }),
    info: { plugin: 'luwi-dsh-sync', version: '0.3.6', runner: 'bridge', mounted: true, config: {} },
    ...deps,
  })
}

/**
 * 找一个能跑 POSIX sh 的解释器 (本机是 Windows 时用 Git 自带那个)。
 * @returns {string|null} 可执行路径或 null。
 */
function findSh() {
  const candidates = [
    'sh',
    'C:\\Program Files\\Git\\bin\\sh.exe',
    'C:\\Program Files\\Git\\usr\\bin\\sh.exe',
  ]
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'printf ok'], { encoding: 'utf8', timeout: 5_000 })
    if (probe.error === undefined && probe.status === 0 && probe.stdout.trim() === 'ok') return candidate
  }
  return null
}

/** 让排队的那几条 promise 链落定。 */
async function flush() {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

// ── ① 沙盒未装: 入口置灰 + 点击给提示 ────────────────────────────────────────

console.log('\n① 沙盒未装: 入口置灰, 点进去说「先装 Linux 沙盒」')

check('入口图标带 data-off (样式表里压暗)', [
  /data-off/.test(client),
  /\[data-off="1"\]\s*\{\s*opacity/u.test(client),
], [true, true])

check('面板给的是「先装 Linux 沙盒」那块 (不是把输入框画出来)', [
  client.includes("'先装 Linux 沙盒'"),
  /const missing = status\.tried && status\.known && !status\.installed/u.test(client),
  /missing\s*\n?\s*\?\s*h\('div'/u.test(client),
], [true, true, true])

check('客户端问的是 /term op=status, 宿主那侧有 termStatus', [
  /op: 'status'/u.test(client),
  /deps\.termStatus/u.test(routes),
  /termStatus: \(\) => termChannel\.status\(\)/u.test(index),
], [true, true, true])

const absentPanel = termPanel({
  termStatus: async () => ({ ok: true, installed: false, version: '' }),
  runTerm: async () => ({ ok: true, text: '' }),
})
const absentTerm = absentPanel.routes().find((route) => route.path === `${PANEL_PREFIX}/term`)
const absentAnswer = fakeResponse()
await absentTerm.handler(fakeRequest('{"op":"status"}'), absentAnswer)
check('未装时 /term status 回 installed:false', JSON.parse(absentAnswer.body).installed, false)
absentPanel.dispose()

// ── ② 沙盒已装: echo hi 真回显 ──────────────────────────────────────────────

console.log('\n② 沙盒已装: 一条命令拿到沙盒输出 (echo hi)')

const echoBridge = await startBridge((request) => {
  if (request.op === 'status') {
    return { result: { text: 'the Linux sandbox is installed (alpine-3.24.0)' } }
  }
  return { result: { text: 'hi\n' } }
})
try {
  const terminal = createTermChannel(echoBridge.env)
  const status = await terminal.status()
  check('已装时 status 读到 installed:true 与版本', [
    status.ok,
    status.installed,
    status.version,
  ], [true, true, 'alpine-3.24.0'])
  const echoed = await terminal.run('echo hi')
  const runRequest = echoBridge.requests.find((request) => request.op === 'run')
  check('run 发出的是 linux/op=run, 命令套着会话壳并原样 eval', [
    runRequest.method,
    runRequest.op,
    runRequest.command.includes("eval 'echo hi'"),
  ], ['linux', 'run', true])
  check('输出原样回到面板 (hi 那一行)', echoed, { ok: true, text: 'hi\n' })
  check('面板把 ok 应答的 text 接到输出区', [
    /if \(body\.ok === true\)/u.test(client),
    /append\(\[\{ kind: 'out'/u.test(client),
  ], [true, true])
} finally {
  await echoBridge.close()
}

// ── ③ sleep 5 执行中按 Ctrl-C: 提示符回来 + 显示中断 ──────────────────────────

console.log('\n③ sleep 5 执行中按 Ctrl-C: 中断送出去, 提示符回来')

check('面板有 Ctrl-C (外接键盘的 keydown + 手机上的按钮) 与中断 POST', [
  /event\.ctrlKey && \(event\.key === 'c'/u.test(client),
  /op: 'interrupt'/u.test(client),
  client.includes("t('Ctrl-C 中断')"),
  client.includes("'^C 已中断'"),
], [true, true, true, true])

check('中断先把提示符还回来 (setBusy(false)), 旧那条回答按 seq 丢掉', [
  /seqRef\.current \+= 1/u.test(client),
  /setBusy\(false\)/u.test(client),
  /controller\.abort\(\)/u.test(client),
], [true, true, true])

check('宿主 /term 有 interrupt 档, index 接的是 termChannel.interrupt', [
  /if \(op === 'interrupt'\)/u.test(routes),
  /deps\.termInterrupt/u.test(routes),
  /termInterrupt: \(\) => termChannel\.interrupt\(\)/u.test(index),
], [true, true, true])

check('中断走第二条 linux 调用写 cancel 文件 (不另造协议)', [
  /function cancelScript\(\)/u.test(channelSource),
  /TERM_STATE_ROOT\}\/\$\{TERM_SESSION\}\/cancel/u.test(channelSource),
  /state\.cancelRequested = true/u.test(channelSource),
], [true, true, true])

let releaseInterrupted = null
const interruptBridge = await startBridge((request) => {
  if (request.op !== 'run') return { result: { text: '' } }
  // 只认中断那一条; 用户命令外面的壳里也带着 cancel 三个字, 不能看这个
  if (request.command.includes(": > '/root/.lw-term/default/cancel'")) {
    releaseInterrupted?.({ result: { text: '^C\n' } })
    return { result: { text: 'cancel written' } }
  }
  return new Promise((resolve) => { releaseInterrupted = resolve })
})
try {
  const terminal = createTermChannel(interruptBridge.env)
  const running = terminal.run('sleep 5')
  await flush()
  const sent = await terminal.interrupt()
  const answer = await running
  check('interrupt 把中断送了出去', sent, { ok: true, interrupted: true })
  check('正在跑的那一条回 interrupted (带 ^C 那条输出)', [
    answer.ok,
    answer.interrupted,
    typeof answer.text === 'string' && answer.text.includes('^C'),
  ], [false, true, true])
} finally {
  await interruptBridge.close()
}

// ── ④ 会话状态: cd 之后连敲三条, pwd 仍停在上一条 cd 的目录 ──────────────────

console.log('\n④ 连敲三条命令, pwd 仍停在上一条 cd 的目录')

check('guest 壳在每次调用之间读 / 写 cwd', [
  /cd "\$\(cat "\$__lw_dir\/cwd"\)"/u.test(channelSource),
  /pwd \| cat > "\$__lw_dir\/cwd"/u.test(channelSource),
  /eval \$\{quoted\}/u.test(channelSource),
], [true, true, true])

const sh = findSh()
if (sh === null) {
  console.log('skip  本机没有 POSIX sh, ③④ 的壳级读数跳过 (真机回执另有记录)')
} else {
  const cwdRoot = `/tmp/lw-term-check-${process.pid}-cwd`
  const env = { ...process.env, LW_TERM_STATE_ROOT: cwdRoot }
  const outputs = []
  for (const command of ['cd /usr', 'echo hi', 'pwd']) {
    const result = spawnSync(sh, ['-c', termGuestScript(command)], { env, encoding: 'utf8', timeout: 15_000 })
    outputs.push({ command, code: result.status, out: result.stdout })
  }
  spawnSync(sh, ['-c', `rm -rf '${cwdRoot}'`], { encoding: 'utf8', timeout: 5_000 })
  check('cd /usr → echo hi → pwd, 第三条打印的还是 /usr', [
    outputs[0].code,
    outputs[1].out.trim(),
    outputs[2].out.trim(),
  ], [0, 'hi', '/usr'])

  const killRoot = `/tmp/lw-term-check-${process.pid}-kill`
  const outer = [
    `rm -rf '${killRoot}'`,
    `mkdir -p '${killRoot}/default'`,
    `export LW_TERM_STATE_ROOT='${killRoot}'`,
    '( sleep 0.3; : > "$LW_TERM_STATE_ROOT/default/cancel" ) &',
    'start=$(date +%s%N)',
    'sh -c "$LW_CHECK_WRAPPER"',
    'code=$?',
    'end=$(date +%s%N)',
    'echo "__CODE__$code"',
    'echo "__MS__$(( (end - start) / 1000000 ))"',
  ].join('\n')
  const interrupted = spawnSync(sh, ['-c', outer], {
    env: { ...process.env, LW_CHECK_WRAPPER: termGuestScript('sleep 5') },
    encoding: 'utf8',
    timeout: 15_000,
  })
  spawnSync(sh, ['-c', `rm -rf '${killRoot}'`], { encoding: 'utf8', timeout: 5_000 })
  const stdout = interrupted.stdout ?? ''
  const ms = Number(/__MS__(\d+)/u.exec(stdout)?.[1] ?? 'NaN')
  check('sleep 5 中途写 cancel: 输出里有 ^C, 进程被杀, 5 s 内退出', [
    stdout.includes('^C'),
    stdout.includes('__CODE__137'),
    Number.isFinite(ms) && ms < 5_000,
  ], [true, true, true])
}

/* ── 结果 ─────────────────────────────────────────────────────────────── */

console.log(`\n${checks - failures}/${checks} passed`)
if (failures > 0) process.exitCode = 1
