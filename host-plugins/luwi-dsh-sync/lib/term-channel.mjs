// lib/term-channel.mjs — 终端面板的宿主半: 把一条命令送进手机的沙盒, 把输出带回来。
//
// 为什么不直接调 lw_linux 那个工具: 插件之间没有互调的口子 —— 宿主给插件的是
// `ctx.tools.register()` (只能登记自己的), 没有 call/invoke 一类的东西。同一个宿主的
// 另一个插件 (host-plugin/index.mjs) 手里那个 `lw_linux` 我们够不着。
//
// 但还有一条更底层的路, 而且是现成的: App 启动宿主时把"特权通道"的地址与令牌以
// 环境变量交给**整个宿主进程** (`LW_CHANNEL_ENDPOINT` / `LW_CHANNEL_TOKEN`)。两个插件
// 跑在同一个进程里 ⇒ 这一份环境变量我们也读得到, 照它发一行 JSON 过去就行。协议就是
// host-plugin/index.mjs 里 request() 的那一套: TCP 连 host:port, 写一行 JSON + \n,
// 读回一行 JSON。
//
// 纪律:
//   · 本模块不向外抛 —— 任何失败都降级成 {ok:false, error}, 面板永远解析得动
//   · 命令原样送进去, 不在这一层拼接 shell (沙盒那边是 `sh -lc <command>`)
//   · 只回文本, 不回令牌与端点
//
// 2026-11-06 (2.8.0 #32 ③④): 一次调用一棵进程树这个形状没变, 变的只是命令外面那层壳
//   · 会话状态: 壳里先 `cd` 回上次记下的目录, 跑完把 `pwd` 写回去 —— `sh -lc` 每次都是新
//     进程, 这是在不扩 binder 协议的前提下唯一诚实的做法 (只保目录, 不保环境变量)
//   · Ctrl-C: 另发一条 linux 调用去写 cancel 文件, 壳里的看门狗看到就把整棵树收掉;
//     proot 的 --kill-on-exit 负责把 guest 里剩下的进程一起带走
//   · 同一个会话的 run 排队: 中断之后下一条命令不会插进上一条还没退干净的缝里
//
// 为什么状态落在 guest 的 /root 而不是 /work: 那是沙盒自己的文件系统, 重装 / reset
// 时跟着一起清掉, 也不会往用户的工作区里扔隐藏目录

import { connect } from 'node:net'

/** App 交给宿主的两个环境变量 (与 host-plugin/index.mjs 里同名同义)。 */
export const TERM_ENDPOINT_VARIABLE = 'LW_CHANNEL_ENDPOINT'
export const TERM_TOKEN_VARIABLE = 'LW_CHANNEL_TOKEN'

/** 一条命令的长度上限: 面板那条通道的 body 上限是 4 KiB, 留出 JSON 外壳的余量。 */
export const TERM_MAX_COMMAND_CHARS = 4000

/** 与 lw_linux 的默认/上限对齐 (它那边 120000 默认, 600000 封顶)。 */
export const TERM_DEFAULT_TIMEOUT_MS = 120_000
export const TERM_MAX_TIMEOUT_MS = 600_000

/** 会话状态落在 guest 里的哪一棵树下 (重装沙盒时跟着 rootfs 一起清掉)。 */
export const TERM_STATE_ROOT = '/root/.lw-term'

/** 面板只有一个终端, 会话号写死; 以后要多标签再把这个常量换成参数。 */
export const TERM_SESSION = 'default'

/** 一次 status 调用的上限 (它会顺带算一次 rootfs 体积, 比 run 的壳慢一点)。 */
const STATUS_TIMEOUT_MS = 30_000

/** 写 cancel 文件那一条的上限: 它只做 mkdir + touch, 给足启动 proot 的余量。 */
const INTERRUPT_TIMEOUT_MS = 30_000

/** 等回话的富余: 沙盒那边跑满 timeoutMs 之后还要把输出收拢回来。 */
const SLACK_MS = 30_000

/** 中断早到 (run 那条请求还在路上) 时最多等它变成 active 这么久。 */
const INTERRUPT_ARM_MS = 1_500

/** 一条 sleep, 给轮询用。 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** status 那句人话里出现的东西 (LwLinux.statusSentence 的固定开头)。 */
const INSTALLED_SENTENCE = 'the Linux sandbox is installed'
const ABSENT_SENTENCE = 'the Linux sandbox is not installed'

/**
 * 把 timeoutMs 收进合法区间。
 * @param {unknown} value - 客户端给的值。
 * @returns {number} 合法毫秒数。
 */
function clampTimeout(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return TERM_DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(Math.round(ms), 1_000), TERM_MAX_TIMEOUT_MS)
}

/**
 * 发一行 JSON, 读回一行 JSON (TCP, 行分隔)。
 * @param {string} endpoint - `host:port`, 由 App 给出。
 * @param {string} line - 一行 JSON (不带换行)。
 * @param {number} timeoutMs - 等回话的上限。
 * @returns {Promise<string>} 回去的那一行。
 */
function sendLine(endpoint, line, timeoutMs) {
  const split = endpoint.lastIndexOf(':')
  if (split <= 0) return Promise.reject(new Error(`${TERM_ENDPOINT_VARIABLE} is not host:port`))
  const host = endpoint.slice(0, split)
  const port = Number(endpoint.slice(split + 1))
  if (!Number.isFinite(port) || port <= 0) {
    return Promise.reject(new Error(`${TERM_ENDPOINT_VARIABLE} has no usable port`))
  }
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port })
    let buffer = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(new Error(`the app did not answer within ${timeoutMs}ms`))
    }, timeoutMs)
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${line}\n`))
    socket.on('data', (chunk) => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end < 0) return
      settled = true
      clearTimeout(timer)
      socket.end()
      resolve(buffer.slice(0, end))
    })
    socket.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`could not reach the privileged channel: ${error.message}`))
    })
    socket.on('close', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('the app closed the channel without answering'))
    })
  })
}

/**
 * guest 侧那层壳: 恢复上次的目录 -> 跑命令 -> 记下新目录, 中途看 cancel 文件。
 *
 * `$$` 在子 shell 里是父 shell 的 pid, 所以看门狗杀掉的是**这层 sh 自己**; 它一死,
 * proot 的 --kill-on-exit 会把 guest 里剩下的进程一起带走。
 *
 * `LW_TERM_STATE_ROOT` 只有判据脚本会设: 真机里 proot 用 `env -i`, 这个变量根本进不了
 * guest, 走的是缺省路径。
 *
 * @param {string} command - 用户输入的原样命令 (单引号转义后交给 eval)。
 * @returns {string} 交给沙盒 `/bin/sh -lc` 的整段脚本。
 */
export function termGuestScript(command) {
  const quoted = `'${command.replace(/'/g, `'\\''`)}'`
  return [
    `__lw_dir=\${LW_TERM_STATE_ROOT:-${TERM_STATE_ROOT}}/${TERM_SESSION}`,
    'mkdir -p "$__lw_dir" 2>/dev/null',
    'if [ -s "$__lw_dir/cwd" ]; then cd "$(cat "$__lw_dir/cwd")" 2>/dev/null || :; fi',
    'rm -f "$__lw_dir/cancel"',
    '(',
    '  while [ ! -f "$__lw_dir/cancel" ]; do sleep 0.1; done',
    "  printf '^C\\n'",
    '  kill -9 $$',
    ') 2>/dev/null &',
    '__lw_watch=$!',
    `eval ${quoted}`,
    '__lw_code=$?',
    'kill "$__lw_watch" 2>/dev/null',
    // 用管道交给 cat 落盘: 直接 `pwd > 文件` 时 sh 会在那个文件描述符上问一次窗口大小,
    // 真机上被 SELinux 记成一条 ioctl 拒绝 (命令照跑, 但 logcat 里白多一行)
    'pwd | cat > "$__lw_dir/cwd" 2>/dev/null',
    'exit "$__lw_code"',
  ].join('\n')
}

/**
 * 写 cancel 文件的那一段 (与壳里的路径必须逐字一致)。
 * @returns {string} 交给沙盒 `/bin/sh -lc` 的一段命令。
 */
function cancelScript() {
  return `mkdir -p '${TERM_STATE_ROOT}/${TERM_SESSION}' 2>/dev/null; : > '${TERM_STATE_ROOT}/${TERM_SESSION}/cancel'`
}

/**
 * 终端通道。
 *
 * @param {object} [env] - 环境变量来源 (测试可注入)。
 * @returns {{
 *   available: () => boolean,
 *   status: () => Promise<{ok: boolean, installed: boolean, version?: string, error?: string, text?: string}>,
 *   run: (command: string, timeoutMs?: number) => Promise<{ok: boolean, text?: string, interrupted?: boolean, error?: string}>,
 *   interrupt: () => Promise<{ok: boolean, interrupted?: boolean, error?: string}>,
 * }} 通道句柄。
 */
export function createTermChannel(env = process.env) {
  const endpointOf = () => (typeof env[TERM_ENDPOINT_VARIABLE] === 'string' ? env[TERM_ENDPOINT_VARIABLE].trim() : '')
  const tokenOf = () => (typeof env[TERM_TOKEN_VARIABLE] === 'string' ? env[TERM_TOKEN_VARIABLE] : '')
  const available = () => endpointOf() !== '' && tokenOf() !== ''

  /** 每个会话一条排队链: 上一条 run 的应答回来之前, 下一条不开始。 */
  const sessions = new Map()

  /**
   * 取一个会话的状态盒子。
   * @returns {{chain: Promise<void>, active: boolean, cancelRequested: boolean}} 会话状态。
   */
  function sessionOf() {
    let state = sessions.get(TERM_SESSION)
    if (state === undefined) {
      state = { chain: Promise.resolve(), active: false, cancelRequested: false }
      sessions.set(TERM_SESSION, state)
    }
    return state
  }

  /**
   * 发一条 linux 调用并解析回包。
   * @param {object} payload - 除 method / token 外的字段。
   * @param {number} timeoutMs - 等回话的上限。
   * @returns {Promise<{ok: boolean, parsed?: object, answer?: object, text?: string, error?: string}>} 解析后的应答。
   */
  async function send(payload, timeoutMs) {
    const endpoint = endpointOf()
    const token = tokenOf()
    if (endpoint === '' || token === '') {
      return { ok: false, error: 'this host was not started by Luwi, so there is no sandbox to run in' }
    }
    let raw
    try {
      raw = await sendLine(endpoint, JSON.stringify({ method: 'linux', token, ...payload }), timeoutMs)
    } catch (thrown) {
      return { ok: false, error: thrown instanceof Error ? thrown.message : String(thrown) }
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ok: false, error: 'the app answered with something that is not JSON' }
    }
    if (parsed === null || typeof parsed !== 'object') {
      return { ok: false, error: 'the app answered with an empty payload' }
    }
    // 应答有时把内容包在 result 里 (宿主那边 answerOf 就是这么取的), 先剥一层。
    const answer = parsed.result !== null && typeof parsed.result === 'object' ? parsed.result : parsed
    return { ok: true, parsed, answer, text: typeof answer.text === 'string' ? answer.text : undefined }
  }

  /**
   * 把一条 run 真正送进沙盒 (外面已经排过队了)。
   * @param {{active: boolean, cancelRequested: boolean}} state - 会话状态。
   * @param {string} command - 用户命令 (未转义)。
   * @param {number} budget - 毫秒预算。
   * @returns {Promise<{ok: boolean, text?: string, interrupted?: boolean, error?: string}>} 结果。
   */
  async function execute(state, command, budget) {
    state.active = true
    state.cancelRequested = false
    try {
      const sent = await send(
        { op: 'run', command: termGuestScript(command), timeoutMs: budget },
        budget + SLACK_MS,
      )
      if (!sent.ok) return { ok: false, error: sent.error }
      if (state.cancelRequested) {
        return { ok: false, interrupted: true, text: sent.text ?? '' }
      }
      if (typeof sent.text === 'string') return { ok: true, text: sent.text }
      if (sent.parsed.ok === false) {
        return {
          ok: false,
          error: typeof sent.parsed.error === 'string' ? sent.parsed.error : 'the sandbox refused that command',
        }
      }
      return { ok: true, text: JSON.stringify(sent.answer) }
    } finally {
      state.active = false
      state.cancelRequested = false
    }
  }

  return {
    /** 宿主是不是 Luwi 起的 (没有这两个变量就没有沙盒可跑)。 */
    available,

    /**
     * 沙盒装没装 (入口置灰与「先装 Linux 沙盒」那句都靠它)。
     * @returns {Promise<{ok: boolean, installed: boolean, version?: string, text?: string, error?: string}>} 状态。
     */
    async status() {
      if (!available()) {
        return {
          ok: false,
          installed: false,
          error: 'this host was not started by Luwi, so there is no sandbox to ask about',
        }
      }
      const sent = await send({ op: 'status' }, STATUS_TIMEOUT_MS)
      if (!sent.ok) return { ok: false, installed: false, error: sent.error }
      const text = sent.text ?? ''
      const installed = text.includes(INSTALLED_SENTENCE)
      if (!installed && !text.includes(ABSENT_SENTENCE)) {
        return {
          ok: false,
          installed: false,
          error: text === '' ? 'the app answered without a sandbox status' : text,
        }
      }
      const version = installed ? (/\(([^)]+)\)/u.exec(text)?.[1] ?? '') : ''
      return { ok: true, installed, version, text }
    },

    /**
     * 在手机的沙盒里跑一条命令 (同一个会话排队)。
     * @param {string} command - 原样交给 `sh -lc`。
     * @param {number} [timeoutMs] - 这一条的上限, 默认 120000, 封顶 600000。
     * @returns {Promise<{ok: boolean, text?: string, interrupted?: boolean, error?: string}>} 输出文本或失败原因。
     */
    async run(command, timeoutMs) {
      if (typeof command !== 'string' || command.trim() === '') {
        return { ok: false, error: 'command is empty' }
      }
      if (command.length > TERM_MAX_COMMAND_CHARS) {
        return { ok: false, error: `command is longer than ${TERM_MAX_COMMAND_CHARS} characters` }
      }
      const budget = clampTimeout(timeoutMs)
      const state = sessionOf()
      const task = state.chain.then(() => execute(state, command, budget))
      // 排队链只关心"上一条结束了"; 它自己的失败由调用方看到
      state.chain = task.then(() => undefined, () => undefined)
      return task
    },

    /**
     * 中断正在跑的那一条: 写一个 cancel 文件, 壳里的看门狗负责收进程树。
     * @returns {Promise<{ok: boolean, interrupted?: boolean, error?: string}>} 有没有把中断送出去。
     */
    async interrupt() {
      if (!available()) {
        return { ok: false, error: 'this host was not started by Luwi, so there is no sandbox to interrupt' }
      }
      const state = sessionOf()
      // 面板那边点完 Ctrl-C 会立刻把 fetch 掐掉, 所以这条中断可能比 run 到得还早:
      // 等一小会儿让它变成 active, 别把"早到"当成"没有命令在跑"
      const deadline = Date.now() + INTERRUPT_ARM_MS
      while (!state.active && Date.now() < deadline) await sleep(25)
      if (!state.active) return { ok: false, error: 'nothing is running in the terminal' }
      state.cancelRequested = true
      const sent = await send({ op: 'run', command: cancelScript(), timeoutMs: INTERRUPT_TIMEOUT_MS }, INTERRUPT_TIMEOUT_MS + SLACK_MS)
      if (!sent.ok) {
        state.cancelRequested = false
        return { ok: false, error: sent.error }
      }
      return { ok: true, interrupted: true }
    },
  }
}
